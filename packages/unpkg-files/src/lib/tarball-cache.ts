import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";

export interface TarballCacheOptions {
  directory: string;
  maxBytes: number;
  // Requests for a tarball (including concurrent joiners) required before
  // it is retained. 1 = cache everything; 2 keeps one-off crawls of a
  // package version from evicting tarballs that are actually reused.
  admissionThreshold?: number;
  // Cap on remembered package@version keys. The seen map otherwise
  // grows ~115 bytes per distinct key forever under crawl traffic.
  maxSeenEntries?: number;
  // Tarballs larger than this are served from a temp file, never retained.
  maxTarballBytes?: number;
}

export interface AcquiredTarball {
  path: string;
  cached: boolean;
  release: () => Promise<void>;
}

export interface TarballCacheStats {
  hits: number;
  downloads: number;
  downloadBytes: number;
  entries: number;
  totalBytes: number;
  seenEntries: number;
  promotedBytes: number;
  evictions: number;
  evictedBytes: number;
}

interface Entry {
  path: string;
  size: number;
  lastAccess: number;
  refs: number;
}

const DEFAULT_MAX_TARBALL_BYTES = 256 * 1024 * 1024;

// Disk cache of compressed npm tarballs, keyed by package@version.
// Concurrent requests for the same tarball share one download
// (single-flight); retained tarballs are evicted least-recently-used
// once total bytes exceed maxBytes. Exact-version tarballs are
// immutable, so entries need no TTL.
export class TarballCache {
  private directory: string;
  private maxBytes: number;
  private admissionThreshold: number;
  private maxSeenEntries: number;
  private maxTarballBytes: number;
  private entries = new Map<string, Entry>();
  private inflight = new Map<string, Promise<Entry>>();
  private seen = new Map<string, number>();
  private totalBytes = 0;
  private accessSeq = 0;
  private hits = 0;
  private downloads = 0;
  private downloadBytes = 0;
  private promotedBytes = 0;
  private evictionCount = 0;
  private evictedBytes = 0;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private loaded: Promise<void> | null = null;

  constructor(options: TarballCacheOptions) {
    this.directory = options.directory;
    this.maxBytes = options.maxBytes;
    this.admissionThreshold = options.admissionThreshold ?? 2;
    this.maxSeenEntries = options.maxSeenEntries ?? 100_000;
    this.maxTarballBytes = options.maxTarballBytes ?? DEFAULT_MAX_TARBALL_BYTES;
  }

  seenCount(key: string): number {
    return this.seen.get(key) ?? 0;
  }

  noteSeen(key: string): void {
    this.seen.set(key, (this.seen.get(key) ?? 0) + 1);
    if (this.seen.size > this.maxSeenEntries) {
      let oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
  }

  seenSize(): number {
    return this.seen.size;
  }

  hasEntry(key: string): boolean {
    return this.entries.has(key);
  }

  async acquire(
    key: string,
    download: (destPath: string) => Promise<void>
  ): Promise<AcquiredTarball> {
    await this.ensureLoaded();
    this.noteSeen(key);

    let existing = this.entries.get(key);
    if (existing && existing.size > 0) {
      this.hits++;
      existing.refs++;
      existing.lastAccess = ++this.accessSeq;
      // No utimes touch here: LRU order lives in memory, and a
      // metadata write per hit is pure disk-throttle fuel.
      return this.wrap(existing, true);
    }

    let entry = await this.downloadSingleFlight(key, download);
    entry.refs++;
    return this.wrap(entry, this.entries.get(key) === entry);
  }

  stats(): TarballCacheStats {
    return {
      hits: this.hits,
      downloads: this.downloads,
      downloadBytes: this.downloadBytes,
      entries: this.entries.size,
      totalBytes: this.totalBytes,
      seenEntries: this.seen.size,
      promotedBytes: this.promotedBytes,
      evictions: this.evictionCount,
      evictedBytes: this.evictedBytes,
    };
  }

  // Periodic one-line stats so cache behavior is visible in `fly logs`
  // without per-request log noise. Idempotent; unref'd so it never
  // keeps a test process alive.
  startStatsLogging(intervalMs = 60_000): void {
    if (this.statsTimer) return;
    this.statsTimer = setInterval(() => {
      let s = this.stats();
      console.log(
        `[tarball-cache] hits=${s.hits} downloads=${s.downloads} downloadBytes=${s.downloadBytes} entries=${s.entries} totalBytes=${s.totalBytes} seen=${s.seenEntries} promotedBytes=${s.promotedBytes} evictions=${s.evictions} evictedBytes=${s.evictedBytes}`
      );
    }, intervalMs);
    (this.statsTimer as unknown as { unref?: () => void }).unref?.();
  }

  async evictKey(key: string): Promise<boolean> {
    let entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.totalBytes -= entry.size;
    this.evictionCount++;
    this.evictedBytes += entry.size;
    if (entry.refs <= 0) await rm(entry.path, { force: true });
    this.voidPersistDebounced();
    return true;
  }

  private wrap(entry: Entry, cached: boolean): AcquiredTarball {
    let released = false;
    return {
      path: entry.path,
      cached,
      release: async () => {
        if (released) return;
        released = true;
        entry.refs--;
        if (entry.refs <= 0 && !this.isRetained(entry)) {
          await rm(entry.path, { force: true });
        }
      },
    };
  }

  private isRetained(entry: Entry): boolean {
    for (let e of this.entries.values()) if (e === entry) return true;
    return false;
  }

  private downloadSingleFlight(
    key: string,
    download: (destPath: string) => Promise<void>
  ): Promise<Entry> {
    let pending = this.inflight.get(key);
    if (pending) return pending;

    let promise = (async (): Promise<Entry> => {
      let staging = path.join(
        this.directory,
        `.staging-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`
      );
      this.downloads++;
      try {
        await download(staging);
      } catch (error) {
        await rm(staging, { force: true });
        throw error;
      }

      let info = await stat(staging);
      this.downloadBytes += info.size;
      let entry: Entry = { path: staging, size: info.size, lastAccess: ++this.accessSeq, refs: 0 };
      let wanted = (this.seen.get(key) ?? 0) >= this.admissionThreshold;
      if (wanted && info.size <= this.maxTarballBytes && info.size <= this.maxBytes) {
        let finalPath = path.join(this.directory, `${createHash("sha256").update(key).digest("hex")}.tgz`);
        await rename(staging, finalPath);
        entry.path = finalPath;
        this.entries.set(key, entry);
        this.totalBytes += info.size;
        this.promotedBytes += info.size;
        await this.evict();
        this.voidPersistDebounced();
      }
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
      this.entries.delete(key);
      this.totalBytes -= entry.size;
      this.evictionCount++;
      this.evictedBytes += entry.size;
      await rm(entry.path, { force: true });
    }
    this.voidPersistDebounced();
  }

  private indexPath(): string {
    return path.join(this.directory, "index.json");
  }

  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  // Index persists are debounced: promotion/eviction can fire
  // hundreds of times a minute under crawl load, and each persist is
  // a write+rename. A few seconds of index loss on crash is fine -
  // unindexed files are cleaned up on next load.
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
      let data: Record<string, { file: string; size: number; lastAccess: number }> = {};
      for (let [key, entry] of this.entries) {
        data[key] = { file: path.basename(entry.path), size: entry.size, lastAccess: entry.lastAccess };
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
        // Recover retained tarballs across restarts (e.g. on a Fly
        // Volume) via the sidecar index; drop index rows whose file is
        // gone and stray staging files from a crashed process.
        try {
          let data = JSON.parse(await readFile(this.indexPath(), "utf8")) as Record<
            string,
            { file: string; size: number; lastAccess: number }
          >;
          for (let [key, row] of Object.entries(data)) {
            let filePath = path.join(this.directory, row.file);
            try {
              let info = await stat(filePath);
              this.entries.set(key, { path: filePath, size: info.size, lastAccess: row.lastAccess, refs: 0 });
              if (row.lastAccess > this.accessSeq) this.accessSeq = row.lastAccess;
              this.totalBytes += info.size;
            } catch {}
          }
        } catch {}
        try {
          let indexed = new Set([...this.entries.values()].map((e) => path.basename(e.path)));
          for (let name of await readdir(this.directory)) {
            if (name.startsWith(".staging-") || (name.endsWith(".tgz") && !indexed.has(name))) {
              await rm(path.join(this.directory, name), { force: true });
            }
          }
        } catch {}
      })();
    }
    return this.loaded;
  }
}

// Process-wide cache configured from the environment. Tests and the
// offline bench can disable retention with UNPKG_TARBALL_CACHE=off,
// which still downloads through a temp file (maxBytes 0 retains
// nothing) so the parse path is identical either way.
let defaultCache: TarballCache | null | undefined;

export function getDefaultTarballCache(): TarballCache {
  if (defaultCache) return defaultCache;
  if (process.env.UNPKG_TARBALL_CACHE === "off") {
    defaultCache = new TarballCache({
      directory: path.join(process.env.TMPDIR ?? "/tmp", `unpkg-tarball-ephemeral-${process.pid}`),
      maxBytes: 0,
      admissionThreshold: Number.MAX_SAFE_INTEGER,
    });
    return defaultCache;
  }
  let directory =
    process.env.UNPKG_TARBALL_CACHE_DIR ??
    path.join(process.env.TMPDIR ?? "/tmp", "unpkg-tarball-cache");
  let maxBytes = Number(process.env.UNPKG_TARBALL_CACHE_MAX_BYTES ?? 25_000_000_000);
  let admissionThreshold = Number(process.env.UNPKG_TARBALL_CACHE_ADMISSION ?? 2);
  defaultCache = new TarballCache({
    directory,
    maxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 25_000_000_000,
    admissionThreshold: Number.isFinite(admissionThreshold) && admissionThreshold >= 1 ? admissionThreshold : 2,
  });
  return defaultCache;
}

export function resetDefaultTarballCacheForTests(cache: TarballCache | null): void {
  defaultCache = cache;
}
