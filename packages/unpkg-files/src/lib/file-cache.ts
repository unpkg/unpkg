import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { SubresourceIntegrityHasher } from "./subresource-integrity.ts";

export interface FileIndexEntry {
  path: string;
  offset: number;
  size: number;
  integrity: string;
}

// Tar variants this indexer refuses to guess at (GNU sparse files,
// pax sparse overrides). Refusal is safe: the caller falls back to
// the tar-stream parse path, which remains the source of truth.
export class TarIndexUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TarIndexUnsupportedError";
  }
}

export interface FileCacheOptions {
  directory: string;
  maxBytes: number;
  // Requests for a tarball before it earns an uncompressed copy.
  promotionThreshold?: number;
  maxEntryBytes?: number;
  // Entries younger than this are never evicted (same hysteresis as
  // the extracted tier).
  minResidenceMs?: number;
}

export interface FileHandle {
  tarPath: string;
  listing: FileIndexEntry[];
  get: (lowercasePath: string) => FileIndexEntry | undefined;
  release: () => Promise<void>;
}

interface Entry {
  createdAt: number;
  tarPath: string;
  listingPath: string;
  listing: FileIndexEntry[];
  byPath: Map<string, FileIndexEntry>;
  size: number;
  lastAccess: number;
  refs: number;
}

function buildIndex(listing: FileIndexEntry[]): Map<string, FileIndexEntry> {
  let map = new Map<string, FileIndexEntry>();
  for (let entry of listing) map.set(entry.path.toLowerCase(), entry);
  return map;
}

const BLOCK = 512;

// Index an uncompressed tar file: per regular file, record the byte
// offset of its data, its size, and its SRI integrity. Handles ustar
// prefixes, pax extended headers ('x', path override), GNU longname
// ('L'), and base-256 sizes. This is the one genuinely new mechanism
// in this tier; the oracle tests in file-cache.test.ts validate it
// against whole-tree extraction entry by entry.
export async function indexTarFile(tarPath: string): Promise<FileIndexEntry[]> {
  let handle = await open(tarPath, "r");
  let entries: FileIndexEntry[] = [];
  try {
    let header = Buffer.alloc(BLOCK);
    let position = 0;
    let pendingLongName: string | null = null;
    let pendingPaxPath: string | null = null;
    let pendingPaxSize: number | null = null;

    let readData = async (size: number, collect: (chunk: Buffer) => void): Promise<void> => {
      let remaining = size;
      let chunkSize = 64 * 1024;
      while (remaining > 0) {
        let buf = Buffer.alloc(Math.min(chunkSize, remaining));
        let { bytesRead } = await handle.read(buf, 0, buf.length, position);
        if (bytesRead <= 0) throw new Error("Unexpected end of tar file");
        collect(buf.subarray(0, bytesRead));
        position += bytesRead;
        remaining -= bytesRead;
      }
      let padding = (BLOCK - (size % BLOCK)) % BLOCK;
      position += padding;
    };

    for (;;) {
      let { bytesRead } = await handle.read(header, 0, BLOCK, position);
      if (bytesRead < BLOCK) break;
      if (header.every((b) => b === 0)) break;
      position += BLOCK;

      let rawName = cString(header, 0, 100);
      let prefix = cString(header, 345, 155);
      if (prefix) rawName = `${prefix}/${rawName}`;
      let size = parseSize(header);
      let type = String.fromCharCode(header[156] ?? 0);
      let dataOffset = position;

      if (type === "S") {
        throw new TarIndexUnsupportedError(`GNU sparse entry not supported: ${rawName}`);
      }
      if (type === "x" || type === "g") {
        let chunks: Buffer[] = [];
        await readData(size, (c) => chunks.push(c));
        if (type === "x") {
          let records = parsePaxRecords(Buffer.concat(chunks));
          if ([...records.keys()].some((k) => k.startsWith("GNU.sparse"))) {
            throw new TarIndexUnsupportedError(`GNU sparse pax entry not supported: ${rawName}`);
          }
          pendingPaxPath = records.get("path") ?? pendingPaxPath;
          let paxSize = records.get("size");
          if (paxSize !== undefined) {
            let parsed = Number(paxSize);
            if (Number.isFinite(parsed) && parsed >= 0) pendingPaxSize = parsed;
          }
        }
        continue;
      }
      if (type === "L") {
        let chunks: Buffer[] = [];
        await readData(size, (c) => chunks.push(c));
        pendingLongName = Buffer.concat(chunks).toString("utf8").replace(/\0.*$/s, "");
        continue;
      }

      let resolved = pendingPaxPath ?? pendingLongName ?? rawName;
      // A pax size record overrides the (possibly truncated) header
      // size for the following entry; data length follows the pax
      // value, so offsets stay correct for >8 GB files.
      if (pendingPaxSize !== null) size = pendingPaxSize;
      pendingPaxPath = null;
      pendingLongName = null;
      pendingPaxSize = null;

      let isRegular = type === "0" || type === "\0" || type === "7" || type === "";
      // Same normalization as the tar-stream parse path.
      let name = resolved.replace(/^[^\/]+\//, "/");
      if (!isRegular || name.endsWith("/")) {
        await readData(size, () => {});
        continue;
      }
      let hasher = new SubresourceIntegrityHasher();
      await readData(size, (c) => hasher.update(c));
      entries.push({ path: name, offset: dataOffset, size, integrity: hasher.digest() });
    }
  } finally {
    await handle.close();
  }
  return entries;
}

function cString(buf: Buffer, offset: number, length: number): string {
  let slice = buf.subarray(offset, offset + length);
  let end = slice.indexOf(0);
  return slice.toString("utf8", 0, end === -1 ? slice.length : end);
}

function parseSize(header: Buffer): number {
  let first = header[124] ?? 0;
  if (first & 0x80) {
    // Base-256 (binary) size for very large files.
    let size = first & 0x7f;
    for (let i = 125; i < 136; i++) size = size * 256 + (header[i] ?? 0);
    return size;
  }
  let text = cString(header, 124, 12).trim();
  return text ? parseInt(text, 8) : 0;
}

function parsePaxRecords(data: Buffer): Map<string, string> {
  // Pax record lengths are BYTE counts. Parsing must stay in byte
  // space: decoding to a JS string first would shift every offset
  // after a multibyte character (e.g. an em-dash in a filename) and
  // corrupt the following records — cross-validation caught exactly
  // that on @pepicons/vue before this fix.
  let records = new Map<string, string>();
  let i = 0;
  while (i < data.length) {
    let space = data.indexOf(0x20, i);
    if (space === -1) break;
    let len = parseInt(data.toString("ascii", i, space), 10);
    if (!Number.isFinite(len) || len <= 0 || i + len > data.length) break;
    let record = data.toString("utf8", space + 1, i + len).replace(/\n$/, "");
    let eq = record.indexOf("=");
    if (eq > 0) records.set(record.slice(0, eq), record.slice(eq + 1));
    i += len;
  }
  return records;
}

// Tier: shared uncompressed tarballs with a per-file offset index.
// Serving a file is an index lookup plus a slice read of one on-disk
// file — no gunzip, no tar scan, and no whole-tree extraction, so
// there is no file-count ceiling. Single-flight builds, hit-count
// admission, byte-bounded LRU: same patterns as the other tiers.
export class FileCache {
  private directory: string;
  private maxBytes: number;
  private promotionThreshold: number;
  private maxEntryBytes: number;
  private minResidenceMs: number;
  private entries = new Map<string, Entry>();
  private inflight = new Map<string, Promise<Entry | null>>();
  private seen = new Map<string, number>();
  private rejected = new Set<string>();
  private totalBytes = 0;
  private accessSeq = 0;
  private hits = 0;
  private builds = 0;
  private buildFailures = 0;
  private evictionCount = 0;
  private evictedBytes = 0;
  private loaded: Promise<void> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: FileCacheOptions) {
    this.directory = options.directory;
    this.maxBytes = options.maxBytes;
    this.promotionThreshold = options.promotionThreshold ?? 3;
    this.maxEntryBytes = options.maxEntryBytes ?? options.maxBytes;
    this.minResidenceMs = options.minResidenceMs ?? 30 * 60_000;
  }

  stats(): {
    hits: number;
    builds: number;
    buildFailures: number;
    entries: number;
    totalBytes: number;
    rejected: number;
    evictions: number;
    evictedBytes: number;
  } {
    return {
      hits: this.hits,
      builds: this.builds,
      buildFailures: this.buildFailures,
      entries: this.entries.size,
      totalBytes: this.totalBytes,
      rejected: this.rejected.size,
      evictions: this.evictionCount,
      evictedBytes: this.evictedBytes,
    };
  }

  startStatsLogging(intervalMs = 60_000): void {
    if (this.statsTimer) return;
    this.statsTimer = setInterval(() => {
      let s = this.stats();
      console.log(
        `[file-cache] hits=${s.hits} builds=${s.builds} failures=${s.buildFailures} entries=${s.entries} totalBytes=${s.totalBytes} rejected=${s.rejected} evictions=${s.evictions} evictedBytes=${s.evictedBytes}`
      );
      // Eviction normally runs after builds; when builds are rare the
      // byte cap would otherwise stay exceeded as entries age past
      // their minimum residence. Sweep on the stats cadence instead.
      void this.evict();
    }, intervalMs);
    (this.statsTimer as unknown as { unref?: () => void }).unref?.();
  }

  // Returns the built entry if one exists. Never builds, never counts
  // a sighting: safe on the latency-critical getFile fast path.
  async peek(key: string): Promise<FileHandle | null> {
    await this.ensureLoaded();
    let existing = this.entries.get(key);
    if (!existing) return null;
    this.hits++;
    existing.refs++;
    existing.lastAccess = ++this.accessSeq;
    return this.wrap(existing);
  }

  // Counts the request, then builds the entry if this key has earned
  // one. Null means: serve from the compressed tarball as today.
  async maybeBuild(
    key: string,
    build: (stagingTarPath: string) => Promise<{ size: number; listing: FileIndexEntry[] } | null>
  ): Promise<FileHandle | null> {
    await this.ensureLoaded();
    this.seen.set(key, (this.seen.get(key) ?? 0) + 1);
    if (this.seen.size > 100_000) {
      let oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    if (this.rejected.size > 50_000) this.rejected.clear();

    let existing = this.entries.get(key);
    if (existing) {
      this.hits++;
      existing.refs++;
      existing.lastAccess = ++this.accessSeq;
      return this.wrap(existing);
    }
    if (this.rejected.has(key)) return null;
    if ((this.seen.get(key) ?? 0) < this.promotionThreshold) return null;

    let entry = await this.buildSingleFlight(key, build);
    if (!entry) return null;
    entry.refs++;
    return this.wrap(entry);
  }

  async evictKey(key: string): Promise<boolean> {
    let entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.totalBytes -= entry.size;
    this.evictionCount++;
    this.evictedBytes += entry.size;
    if (entry.refs <= 0) {
      await rm(entry.tarPath, { force: true });
      await rm(entry.listingPath, { force: true });
    }
    this.voidPersistDebounced();
    return true;
  }

  private wrap(entry: Entry): FileHandle {
    let released = false;
    return {
      tarPath: entry.tarPath,
      listing: entry.listing,
      get: (lowercasePath: string) => entry.byPath.get(lowercasePath),
      release: async () => {
        if (released) return;
        released = true;
        entry.refs--;
        if (entry.refs <= 0 && !this.isRetained(entry)) {
          await rm(entry.tarPath, { force: true });
          await rm(entry.listingPath, { force: true });
        }
      },
    };
  }

  private isRetained(entry: Entry): boolean {
    for (let e of this.entries.values()) if (e === entry) return true;
    return false;
  }

  private buildSingleFlight(
    key: string,
    build: (stagingTarPath: string) => Promise<{ size: number; listing: FileIndexEntry[] } | null>
  ): Promise<Entry | null> {
    let pending = this.inflight.get(key);
    if (pending) return pending;

    let promise = (async (): Promise<Entry | null> => {
      let hash = createHash("sha256").update(key).digest("hex");
      let staging = path.join(this.directory, `.building-${hash}-${process.pid}.tar`);
      let finalPath = path.join(this.directory, `${hash}.tar`);
      let listingPath = path.join(this.directory, `${hash}.listing.json`);
      await rm(staging, { force: true });
      let result: { size: number; listing: FileIndexEntry[] } | null;
      try {
        result = await build(staging);
      } catch (error) {
        // A build failure (unsupported tar variant, validation
        // mismatch, I/O error) must never fail the request: count
        // it, drop the staging file, and let the caller serve from
        // the compressed tarball as today.
        this.buildFailures++;
        console.error(`[file-cache] build failed for ${key}:`, error);
        await rm(staging, { force: true });
        return null;
      }
      if (!result) {
        // Build declined (e.g. tarball below the size gate): not a
        // rejection, just serve from the compressed tier as today.
        await rm(staging, { force: true });
        return null;
      }
      if (result.size > this.maxEntryBytes || result.size > this.maxBytes) {
        this.rejected.add(key);
        await rm(staging, { force: true });
        return null;
      }
      await writeFile(listingPath, JSON.stringify(result.listing));
      await rm(finalPath, { force: true });
      await rename(staging, finalPath);
      let entry: Entry = {
        createdAt: Date.now(),
        tarPath: finalPath,
        listingPath,
        listing: result.listing,
        byPath: buildIndex(result.listing),
        size: result.size,
        lastAccess: ++this.accessSeq,
        refs: 0,
      };
      this.entries.set(key, entry);
      this.totalBytes += result.size;
      this.builds++;
      await this.evict();
      this.voidPersistDebounced();
      return entry;
    })();

    this.inflight.set(key, promise);
    let clear = () => {
      if (this.inflight.get(key) === promise) this.inflight.delete(key);
    };
    void promise.then(clear, clear);
    return promise;
  }

  private async evict(): Promise<void> {
    if (this.totalBytes <= this.maxBytes) return;
    let sorted = [...this.entries.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    for (let [key, entry] of sorted) {
      if (this.totalBytes <= this.maxBytes) break;
      if (entry.refs > 0) continue;
      if (Date.now() - entry.createdAt < this.minResidenceMs) continue;
      this.entries.delete(key);
      this.totalBytes -= entry.size;
      this.evictionCount++;
      this.evictedBytes += entry.size;
      await rm(entry.tarPath, { force: true });
      await rm(entry.listingPath, { force: true });
    }
    this.voidPersistDebounced();
  }

  private indexPath(): string {
    return path.join(this.directory, "index.json");
  }

  voidPersistDebounced(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistIndex();
    }, 5_000);
    (this.persistTimer as unknown as { unref?: () => void }).unref?.();
  }

  private async persistIndex(): Promise<void> {
    try {
      let data: Record<string, { size: number; lastAccess: number; createdAt: number }> = {};
      for (let [key, entry] of this.entries) {
        data[key] = { size: entry.size, lastAccess: entry.lastAccess, createdAt: entry.createdAt };
      }
      let tmp = `${this.indexPath()}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(data));
      await rename(tmp, this.indexPath());
    } catch {}
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        await mkdir(this.directory, { recursive: true });
        try {
          let data = JSON.parse(await readFile(this.indexPath(), "utf8")) as Record<
            string,
            { size: number; lastAccess: number; createdAt?: number }
          >;
          for (let [key, row] of Object.entries(data)) {
            let hash = createHash("sha256").update(key).digest("hex");
            let tarPath = path.join(this.directory, `${hash}.tar`);
            let listingPath = path.join(this.directory, `${hash}.listing.json`);
            try {
              let listing = JSON.parse(await readFile(listingPath, "utf8")) as FileIndexEntry[];
              let info = await stat(tarPath);
              if (!info.isFile()) continue;
              this.entries.set(key, {
                createdAt: row.createdAt ?? Date.now(),
                tarPath,
                listingPath,
                listing,
                byPath: buildIndex(listing),
                size: row.size,
                lastAccess: row.lastAccess,
                refs: 0,
              });
              this.totalBytes += row.size;
              if (row.lastAccess > this.accessSeq) this.accessSeq = row.lastAccess;
            } catch {}
          }
        } catch {}
        try {
          let indexed = new Set(
            [...this.entries.values()].flatMap((e) => [path.basename(e.tarPath), path.basename(e.listingPath)])
          );
          for (let name of await readdir(this.directory)) {
            if (name.startsWith(".building-") || (name !== "index.json" && !indexed.has(name))) {
              await rm(path.join(this.directory, name), { recursive: true, force: true });
            }
          }
        } catch {}
      })();
    }
    return this.loaded;
  }
}

// Process-wide file tier, configured from the environment.
// UNPKG_FILE_CACHE=off disables it (other tiers still run).
let defaultFileCache: FileCache | null | undefined;

export function getDefaultFileCache(): FileCache | null {
  if (defaultFileCache !== undefined) return defaultFileCache ?? null;
  if (process.env.UNPKG_FILE_CACHE === "off") {
    defaultFileCache = null;
    return null;
  }
  let directory =
    process.env.UNPKG_FILE_CACHE_DIR ??
    path.join(process.env.UNPKG_TARBALL_CACHE_DIR ?? path.join(process.env.TMPDIR ?? "/tmp", "unpkg-tarball-cache"), "..", "unpkg-file-cache");
  let maxBytes = Number(process.env.UNPKG_FILE_CACHE_MAX_BYTES ?? 6_000_000_000);
  let threshold = Number(process.env.UNPKG_FILE_CACHE_PROMOTION ?? 3);
  let minResidence = Number(process.env.UNPKG_FILE_CACHE_MIN_RESIDENCE_MS ?? 30 * 60_000);
  defaultFileCache = new FileCache({
    directory,
    maxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 6_000_000_000,
    promotionThreshold: Number.isFinite(threshold) && threshold >= 1 ? threshold : 3,
    minResidenceMs: Number.isFinite(minResidence) && minResidence >= 0 ? minResidence : 30 * 60_000,
  });
  return defaultFileCache;
}

export function resetDefaultFileCacheForTests(cache: FileCache | null | undefined): void {
  defaultFileCache = cache;
}
