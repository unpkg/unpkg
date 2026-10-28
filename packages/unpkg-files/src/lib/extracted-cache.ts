import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ExtractedFileEntry {
  path: string;
  size: number;
  integrity: string;
}

export interface ExtractedCacheOptions {
  directory: string;
  maxBytes: number;
  // Requests for a tarball before it earns an extracted tree. Extracted
  // files cost 5-6x the disk of the .tgz, so only proven-hot tarballs
  // are promoted out of the compressed tier.
  promotionThreshold?: number;
  // Packages with more files than this stay in the compressed tier;
  // tens of thousands of tiny files are inode-expensive to extract.
  maxFiles?: number;
  maxEntryBytes?: number;
  // Entries younger than this are never evicted; without a minimum
  // residence, at-cap LRU recycles fresh trees in a write loop.
  minResidenceMs?: number;
}

export interface ExtractedHandle {
  directory: string;
  listing: ExtractedFileEntry[];
  release: () => Promise<void>;
}

interface Entry {
  createdAt: number;
  directory: string;
  listingPath: string;
  listing: ExtractedFileEntry[];
  size: number;
  lastAccess: number;
  refs: number;
}

const DEFAULT_MAX_ENTRY_BYTES = 512 * 1024 * 1024;

// Tier-2 cache: shared extracted package trees for hot tarballs.
// Serving from a tree replaces a gunzip + sequential tar scan with a
// direct file read (and /list with a lookup in the listing captured
// during the single extraction). Single-flight, hit-count admission,
// byte-bounded LRU — same patterns as the compressed tarball tier.
export class ExtractedCache {
  private directory: string;
  private maxBytes: number;
  private promotionThreshold: number;
  private maxFiles: number;
  private maxEntryBytes: number;
  private minResidenceMs: number;
  private entries = new Map<string, Entry>();
  private inflight = new Map<string, Promise<Entry | null>>();
  private seen = new Map<string, number>();
  private rejected = new Set<string>();
  private totalBytes = 0;
  private accessSeq = 0;
  private hits = 0;
  private extractions = 0;
  private evictionCount = 0;
  private evictedBytes = 0;
  private loaded: Promise<void> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: ExtractedCacheOptions) {
    this.directory = options.directory;
    this.maxBytes = options.maxBytes;
    this.promotionThreshold = options.promotionThreshold ?? 5;
    this.maxFiles = options.maxFiles ?? 5_000;
    this.maxEntryBytes = options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES;
    this.minResidenceMs = options.minResidenceMs ?? 30 * 60_000;
  }

  stats(): {
    hits: number;
    extractions: number;
    entries: number;
    totalBytes: number;
    rejected: number;
    evictions: number;
    evictedBytes: number;
  } {
    return {
      hits: this.hits,
      extractions: this.extractions,
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
        `[extracted-cache] hits=${s.hits} extractions=${s.extractions} entries=${s.entries} totalBytes=${s.totalBytes} rejected=${s.rejected} evictions=${s.evictions} evictedBytes=${s.evictedBytes}`
      );
    }, intervalMs);
    (this.statsTimer as unknown as { unref?: () => void }).unref?.();
  }

  // Counts the request, then returns the extracted tree if this key
  // has one (or earns one now). Null means: serve from the tarball.
  async maybeExtract(
    key: string,
    extract: (stagingDirectory: string) => Promise<{ size: number; files: number; listing: ExtractedFileEntry[] }>
  ): Promise<ExtractedHandle | null> {
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

    let entry = await this.extractSingleFlight(key, extract);
    if (!entry) return null;
    entry.refs++;
    return this.wrap(entry);
  }

  private wrap(entry: Entry): ExtractedHandle {
    let released = false;
    return {
      directory: entry.directory,
      listing: entry.listing,
      release: async () => {
        if (released) return;
        released = true;
        entry.refs--;
      },
    };
  }

  private extractSingleFlight(
    key: string,
    extract: (stagingDirectory: string) => Promise<{ size: number; files: number; listing: ExtractedFileEntry[] }>
  ): Promise<Entry | null> {
    let pending = this.inflight.get(key);
    if (pending) return pending;

    let promise = (async (): Promise<Entry | null> => {
      let hash = createHash("sha256").update(key).digest("hex");
      let staging = path.join(this.directory, `.extracting-${hash}-${process.pid}`);
      let finalDirectory = path.join(this.directory, hash);
      let listingPath = path.join(this.directory, `${hash}.listing.json`);
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
      let result: { size: number; files: number; listing: ExtractedFileEntry[] };
      try {
        result = await extract(staging);
      } catch (error) {
        await rm(staging, { recursive: true, force: true });
        throw error;
      }
      if (result.files > this.maxFiles || result.size > this.maxEntryBytes || result.size > this.maxBytes) {
        this.rejected.add(key);
        await rm(staging, { recursive: true, force: true });
        return null;
      }
      await writeFile(listingPath, JSON.stringify(result.listing));
      await rm(finalDirectory, { recursive: true, force: true });
      await rename(staging, finalDirectory);
      let entry: Entry = {
        createdAt: Date.now(),
        directory: finalDirectory,
        listingPath,
        listing: result.listing,
        size: result.size,
        lastAccess: ++this.accessSeq,
        refs: 0,
      };
      this.entries.set(key, entry);
      this.totalBytes += result.size;
      this.extractions++;
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
      await rm(entry.directory, { recursive: true, force: true });
      await rm(entry.listingPath, { force: true });
    }
    this.voidPersistDebounced();
  }

  private indexPath(): string {
    return path.join(this.directory, "index.json");
  }

  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  voidPersistDebounced(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.voidPersistDebounced();
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
            let directory = path.join(this.directory, hash);
            let listingPath = path.join(this.directory, `${hash}.listing.json`);
            try {
              let listing = JSON.parse(await readFile(listingPath, "utf8")) as ExtractedFileEntry[];
              let info = await stat(directory);
              if (!info.isDirectory()) continue;
              this.entries.set(key, {
                createdAt: row.createdAt ?? Date.now(),
                directory,
                listingPath,
                listing,
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
            [...this.entries.values()].flatMap((e) => [path.basename(e.directory), path.basename(e.listingPath)])
          );
          for (let name of await readdir(this.directory)) {
            if (name.startsWith(".extracting-") || (name !== "index.json" && !indexed.has(name))) {
              await rm(path.join(this.directory, name), { recursive: true, force: true });
            }
          }
        } catch {}
      })();
    }
    return this.loaded;
  }
}

// Process-wide extracted tier, configured from the environment.
// UNPKG_EXTRACTED_CACHE=off disables it (compressed tier still runs).
let defaultExtracted: ExtractedCache | null | undefined;

export function getDefaultExtractedCache(): ExtractedCache | null {
  if (defaultExtracted !== undefined) return defaultExtracted ?? null;
  if (process.env.UNPKG_EXTRACTED_CACHE === "off") {
    defaultExtracted = null;
    return null;
  }
  let directory =
    process.env.UNPKG_EXTRACTED_CACHE_DIR ??
    path.join(process.env.UNPKG_TARBALL_CACHE_DIR ?? path.join(process.env.TMPDIR ?? "/tmp", "unpkg-tarball-cache"), "..", "unpkg-extracted-cache");
  let maxBytes = Number(process.env.UNPKG_EXTRACTED_CACHE_MAX_BYTES ?? 8_000_000_000);
  let threshold = Number(process.env.UNPKG_EXTRACTED_CACHE_PROMOTION ?? 5);
  let maxFiles = Number(process.env.UNPKG_EXTRACTED_CACHE_MAX_FILES ?? 5_000);
  let minResidence = Number(process.env.UNPKG_EXTRACTED_CACHE_MIN_RESIDENCE_MS ?? 30 * 60_000);
  defaultExtracted = new ExtractedCache({
    directory,
    maxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 8_000_000_000,
    promotionThreshold: Number.isFinite(threshold) && threshold >= 1 ? threshold : 5,
    maxFiles: Number.isFinite(maxFiles) && maxFiles >= 1 ? maxFiles : 5_000,
    minResidenceMs: Number.isFinite(minResidence) && minResidence >= 0 ? minResidence : 30 * 60_000,
  });
  return defaultExtracted;
}

export function resetDefaultExtractedCacheForTests(cache: ExtractedCache | null | undefined): void {
  defaultExtracted = cache;
}
