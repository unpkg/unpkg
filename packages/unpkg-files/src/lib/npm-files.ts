import { createReadStream, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import gunzipMaybe from "gunzip-maybe";
import tar from "tar-stream";
import type { PackageFile, PackageFileMetadata } from "unpkg-worker";

import { getContentType } from "./content-type.ts";
import { getDefaultTarballCache } from "./tarball-cache.ts";
import { getDefaultTarballLimiter, OverloadedError } from "./concurrency.ts";
import { getDefaultExtractedCache, type ExtractedHandle } from "./extracted-cache.ts";
import { getDefaultFileCache, indexTarFile, type FileHandle } from "./file-cache.ts";
import { SubresourceIntegrityHasher } from "./subresource-integrity.ts";

const TARBALL_FETCH_TIMEOUT_MS = 30_000;
export { OverloadedError };

export async function getFile(
  registry: string,
  packageName: string,
  version: string,
  filename: string
): Promise<PackageFile | null> {
  // File-tier fast path: serve a slice of the uncompressed tarball
  // at the indexed offset. Never builds here (builds happen inside
  // the limiter on the parse path); peek only serves built entries.
  let fileCache = getDefaultFileCache();
  if (fileCache) {
    let handle = await fileCache.peek(createTarballUrl(registry, packageName, version).toString());
    if (handle) {
      let entry = handle.get(filename.toLowerCase());
      if (!entry) {
        await handle.release();
        return null;
      }
      let streamed: PackageFile = {
        path: entry.path,
        body: new Uint8Array(0),
        bodyStream: Bun.file(handle.tarPath).slice(entry.offset, entry.offset + entry.size),
        size: entry.size,
        type: getContentType(entry.path),
        integrity: entry.integrity,
      };
      setTimeout(() => void handle.release(), 60_000).unref?.();
      return streamed;
    }
  }

  // Streamed fast path: for extracted (hot) packages, serve the file
  // as a lazy Bun.file blob instead of reading it into a JS Buffer.
  // Whole-file buffers at high concurrency are the native-allocator
  // churn behind origin RSS growth; a Blob body allocates none.
  let extracted = getDefaultExtractedCache();
  if (extracted) {
    let handle = await acquireExtractedHandle(registry, packageName, version);
    if (handle) {
      let entry = handle.listing.find(
        (candidate) => candidate.path.toLowerCase() === filename.toLowerCase()
      );
      if (!entry) {
        await handle.release();
        return null;
      }
      let filePath = path.join(handle.directory, ...entry.path.replace(/^\/+/, "").split("/"));
      let streamed: PackageFile = {
        path: entry.path,
        body: new Uint8Array(0),
        bodyStream: Bun.file(filePath),
        size: entry.size,
        type: getContentType(entry.path),
        integrity: entry.integrity,
      };
      // Hold the cache ref briefly so eviction cannot unlink the file
      // before the response body is read (Bun.file opens lazily).
      setTimeout(() => void handle.release(), 60_000).unref?.();
      return streamed;
    }
  }

  let file: PackageFile | null = null;

  await fetchAndParsePackage(registry, packageName, version, {
    buffer: true,
    extractedMode: "single",
    handler: (path, content, integrity, size, header) => {
      file = {
        path,
        body: content!,
        size,
        type: getContentType(path),
        integrity,
      };
      return true; // signal early exit
    },
    filter: (name) => name.toLowerCase() === filename.toLowerCase(),
  });

  return file;
}

export async function listFiles(
  registry: string,
  packageName: string,
  version: string,
  prefix = "/"
): Promise<PackageFileMetadata[]> {
  let files: PackageFileMetadata[] = [];

  await fetchAndParsePackage(registry, packageName, version, {
    extractedMode: "list",
    handler: (path, _content, integrity, size) => {
      files.push({
        path,
        size,
        type: getContentType(path),
        integrity,
      });
    },
    filter: (name) => !name.endsWith("/") && name.startsWith(prefix),
  });

  return files;
}

export async function withPackageFileDirectory<T>(
  registry: string,
  packageName: string,
  version: string,
  handler: (directory: string) => Promise<T>
): Promise<T> {
  let directory = await mkdtemp(path.join(os.tmpdir(), "unpkg-package-"));

  try {
    await fetchAndParsePackage(registry, packageName, version, {
      buffer: true,
      extractedMode: "all",
      async handler(filename, content) {
        let relativePath = filename.replace(/^\/+/, "");
        if (relativePath === "") return;

        let filePath = path.join(directory, ...relativePath.split("/"));
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, content!);
      },
      filter: (name) => !name.endsWith("/"),
    });

    return await handler(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

// Evict one exact package@version from every origin cache tier on
// this machine. The key in all tiers is the tarball URL, so one
// eviction per tier covers the whole package version. Returns which
// tiers actually held an entry. Note: this is cache eviction, not
// a blocklist — if the registry still serves the tarball, the next
// request re-downloads and re-caches it (by design; the registry
// is the source of truth, e.g. after a takedown it 404s instead).
export async function purgePackageVersion(
  registry: string,
  packageName: string,
  version: string
): Promise<{ tarball: boolean; file: boolean; extracted: boolean }> {
  let result = { tarball: false, file: false, extracted: false };
  let names = packageName === packageName.toLowerCase() ? [packageName] : [packageName, packageName.toLowerCase()];
  for (let name of names) {
    let key = createTarballUrl(registry, name, version).toString();
    let fileCache = getDefaultFileCache();
    if (fileCache) result.file = (await fileCache.evictKey(key)) || result.file;
    result.tarball = (await getDefaultTarballCache().evictKey(key)) || result.tarball;
    let extracted = getDefaultExtractedCache();
    if (extracted) result.extracted = (await extracted.evictKey(key)) || result.extracted;
  }
  return result;
}

export class PackageNotFoundError extends Error {
  registry: string;
  packageName: string;
  version: string;

  constructor(message: string, registry: string, packageName: string, version: string) {
    super(message);
    this.name = "PackageNotFoundError";
    this.registry = registry;
    this.packageName = packageName;
    this.version = version;
  }
}

export class TarballFetchTimeoutError extends Error {
  registry: string;
  packageName: string;
  version: string;
  timeoutMs: number;

  constructor(
    message: string,
    registry: string,
    packageName: string,
    version: string,
    timeoutMs: number
  ) {
    super(message);
    this.name = "TarballFetchTimeoutError";
    this.registry = registry;
    this.packageName = packageName;
    this.version = version;
    this.timeoutMs = timeoutMs;
  }
}

interface EntryHandlerOptions {
  buffer?: boolean;
  // How the extracted tier may answer without a tarball parse.
  extractedMode?: "single" | "list" | "all";
  handler: (
    name: string,
    content: Uint8Array | null,
    integrity: string,
    size: number,
    header: tar.Headers
  ) => boolean | void | Promise<boolean | void>;
  filter?: (name: string, header: tar.Headers) => boolean;
}

async function fetchAndParsePackage(
  registry: string,
  packageName: string,
  version: string,
  options: EntryHandlerOptions,
): Promise<void> {
  let limiter = getDefaultTarballLimiter();
  limiter.startStatsLogging();
  try {
    return await limiter.run(() => fetchAndParsePackageExact(registry, packageName, version, options));
  } catch (error) {
    // Tarball URLs are case-sensitive; fall back to the lowercase name for
    // requests that spell a lowercase package with different casing.
    if (error instanceof PackageNotFoundError && packageName !== packageName.toLowerCase()) {
      return fetchAndParsePackageExact(registry, packageName.toLowerCase(), version, options);
    }

    throw error;
  }
}

async function serveFromExtracted(handle: ExtractedHandle, options: EntryHandlerOptions): Promise<void> {
  let header = {} as tar.Headers;
  let mode = options.extractedMode ?? "all";

  if (mode === "single") {
    let entry = handle.listing.find(
      (candidate) => !options.filter || options.filter(candidate.path, header)
    );
    if (!entry) return;
    let content = await readFile(path.join(handle.directory, ...entry.path.replace(/^\/+/, "").split("/")));
    await options.handler(entry.path, content, entry.integrity, entry.size, header);
    return;
  }

  if (mode === "list") {
    for (let entry of handle.listing) {
      if (options.filter && !options.filter(entry.path, header)) continue;
      await options.handler(entry.path, null, entry.integrity, entry.size, header);
    }
    return;
  }

  for (let entry of handle.listing) {
    if (options.filter && !options.filter(entry.path, header)) continue;
    let content = await readFile(path.join(handle.directory, ...entry.path.replace(/^\/+/, "").split("/")));
    await options.handler(entry.path, content, entry.integrity, entry.size, header);
  }
}

async function extractTarballToDirectory(
  tarballPath: string,
  stagingDirectory: string
): Promise<{ size: number; files: number; listing: { path: string; size: number; integrity: string }[] }> {
  let listing: { path: string; size: number; integrity: string }[] = [];
  let totalSize = 0;
  await parseTarballFile(tarballPath, {
    buffer: true,
    extractedMode: "all",
    filter: (name) => !name.endsWith("/"),
    async handler(filename, content, integrity, size) {
      let relativePath = filename.replace(/^\/+/, "");
      if (relativePath === "") return;
      let filePath = path.join(stagingDirectory, ...relativePath.split("/"));
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content!);
      listing.push({ path: filename, size, integrity });
      totalSize += size;
    },
  });
  return { size: totalSize, files: listing.length, listing };
}

function createTarballDownload(registry: string, packageName: string, version: string) {
  let tarballUrl = createTarballUrl(registry, packageName, version);

  let fetchTarballResponse = async (): Promise<{ response: Response; signal: AbortSignal }> => {
    // Keep tarball work within the upstream request budget.
    let signal = AbortSignal.timeout(TARBALL_FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(tarballUrl, { signal });
    } catch (error) {
      if (isTimeoutError(error, signal)) {
        throw new TarballFetchTimeoutError(
          `Timed out fetching tarball: ${packageName}@${version}`,
          registry,
          packageName,
          version,
          TARBALL_FETCH_TIMEOUT_MS
        );
      }
      throw error;
    }
    if (!response.ok || !response.body) {
      if (response.status === 404) {
        throw new PackageNotFoundError(`Package not found: ${packageName}`, registry, packageName, version);
      }
      throw new Error(`Failed to fetch tarball: ${response.status} ${response.statusText}`);
    }
    return { response, signal };
  };

  let download = async (destPath: string): Promise<void> => {
    let { response, signal } = await fetchTarballResponse();
    try {
      await pipeline(Readable.from(response.body!), createWriteStream(destPath));
    } catch (error) {
      if (isTimeoutError(error, signal)) {
        throw new TarballFetchTimeoutError(
          `Timed out fetching tarball: ${packageName}@${version}`,
          registry,
          packageName,
          version,
          TARBALL_FETCH_TIMEOUT_MS
        );
      }
      throw error;
    }
  };

  return { tarballUrl, fetchTarballResponse, download };
}

async function acquireFileHandle(
  registry: string,
  packageName: string,
  version: string
): Promise<FileHandle | null> {
  let fileCache = getDefaultFileCache();
  if (!fileCache) return null;
  fileCache.startStatsLogging();
  let cache = getDefaultTarballCache();
  let { download } = createTarballDownload(registry, packageName, version);
  let key = createTarballUrl(registry, packageName, version).toString();
  return fileCache.maybeBuild(key, async (stagingTarPath) => {
    let acquired = await cache.acquire(key, download);
    try {
      // Size gate: small tarballs parse cheaply and never earn an
      // uncompressed copy. Declining is not a rejection.
      let minTarballBytes = Number(process.env.UNPKG_FILE_CACHE_MIN_TARBALL_BYTES ?? 262_144);
      if (Number.isFinite(minTarballBytes) && minTarballBytes > 0) {
        let tarballInfo = await stat(acquired.path);
        if (tarballInfo.size < minTarballBytes) return null;
      }
      await pipeline(createReadStream(acquired.path), gunzipMaybe(), createWriteStream(stagingTarPath));
      let listing = await indexTarFile(stagingTarPath);
      // Cross-validate the new index against the proven tar-stream
      // parse of the same tarball: every regular file must agree on
      // path, size, and integrity. Any mismatch throws, the build is
      // counted as a failure, and requests fall back to the parse
      // path — the file tier can lose performance, never correctness.
      if (process.env.UNPKG_FILE_CACHE_VALIDATE !== "off") {
        let parsed: { path: string; size: number; integrity: string }[] = [];
        await parseTarballFile(acquired.path, {
          filter: (name) => !name.endsWith("/"),
          handler: (name, _content, integrity, size, header) => {
            let type = (header as { type?: string }).type;
            if (type && type !== "file") return;
            parsed.push({ path: name, size, integrity });
          },
        });
        let keyOf = (e: { path: string; size: number; integrity: string }) =>
          `${e.path}\0${e.size}\0${e.integrity}`;
        let remaining = new Map<string, number>();
        for (let e of parsed) remaining.set(keyOf(e), (remaining.get(keyOf(e)) ?? 0) + 1);
        let mismatch = parsed.length !== listing.length;
        if (!mismatch) {
          for (let e of listing) {
            let count = remaining.get(keyOf(e)) ?? 0;
            if (count === 0) {
              mismatch = true;
              break;
            }
            remaining.set(keyOf(e), count - 1);
          }
        }
        if (mismatch) {
          throw new Error(
            `file-cache validation mismatch: index=${listing.length} entries, parse=${parsed.length} entries`
          );
        }
      }
      let info = await stat(stagingTarPath);
      return { size: info.size, listing };
    } finally {
      await acquired.release();
    }
  });
}

async function serveFromFileTier(handle: FileHandle, options: EntryHandlerOptions): Promise<void> {
  let header = {} as tar.Headers;
  let mode = options.extractedMode ?? "all";
  if (mode === "list") {
    for (let entry of handle.listing) {
      if (options.filter && !options.filter(entry.path, header)) continue;
      await options.handler(entry.path, null, entry.integrity, entry.size, header);
    }
    return;
  }
  if (mode === "single") {
    let entry = handle.listing.find(
      (candidate) => !options.filter || options.filter(candidate.path, header)
    );
    if (!entry) return;
    let bytes = new Uint8Array(
      await Bun.file(handle.tarPath).slice(entry.offset, entry.offset + entry.size).arrayBuffer()
    );
    await options.handler(entry.path, bytes, entry.integrity, entry.size, header);
    return;
  }
  // "all" mode needs a real directory; the file tier does not serve it.
}

async function acquireExtractedHandle(
  registry: string,
  packageName: string,
  version: string
): Promise<ExtractedHandle | null> {
  let extracted = getDefaultExtractedCache();
  if (!extracted) return null;
  extracted.startStatsLogging();
  let cache = getDefaultTarballCache();
  let { tarballUrl, download } = createTarballDownload(registry, packageName, version);
  let key = tarballUrl.toString();
  return extracted.maybeExtract(key, async (staging) => {
    let acquiredForExtract = await cache.acquire(key, download);
    try {
      return await extractTarballToDirectory(acquiredForExtract.path, staging);
    } finally {
      await acquiredForExtract.release();
    }
  });
}

async function fetchAndParsePackageExact(
  registry: string,
  packageName: string,
  version: string,
  options: EntryHandlerOptions,
): Promise<void> {
  let { tarballUrl, fetchTarballResponse, download } = createTarballDownload(registry, packageName, version);
  let cache = getDefaultTarballCache();
  cache.startStatsLogging();
  let key = tarballUrl.toString();

  // File tier: a proven-hot tarball may have an uncompressed copy
  // with an offset index. Serving from it avoids the gunzip + tar
  // scan without extracting a tree. "all" mode still needs a tree
  // or a parse, so it skips this tier.
  if ((options.extractedMode ?? "all") !== "all") {
    let fileHandle = await acquireFileHandle(registry, packageName, version);
    if (fileHandle) {
      try {
        await serveFromFileTier(fileHandle, options);
        return;
      } finally {
        await fileHandle.release();
      }
    }
  }

  // Tier 2: a proven-hot tarball may already have a shared extracted
  // tree. Serving from it avoids the gunzip + tar scan entirely.
  {
    let handle = await acquireExtractedHandle(registry, packageName, version);
    if (handle) {
      try {
        await serveFromExtracted(handle, options);
        return;
      } finally {
        await handle.release();
      }
    }
  }

  // First sightings stream-parse from the network (no staging write).
  // UNPKG_STREAM_FIRST_SIGHTINGS tunes how many: packages seen only
  // once or twice are crawl churn and never earn disk writes.
  let streamFirstSightings = Number(process.env.UNPKG_STREAM_FIRST_SIGHTINGS ?? 1);
  if (!Number.isFinite(streamFirstSightings) || streamFirstSightings < 0) streamFirstSightings = 1;
  if (!cache.hasEntry(key) && cache.seenCount(key) < streamFirstSightings) {
    cache.noteSeen(key);
    let { response, signal } = await fetchTarballResponse();
    try {
      await parseTarballSource(Readable.from(response.body as AsyncIterable<Uint8Array>), options);
    } catch (error) {
      if (isTimeoutError(error, signal)) {
        throw new TarballFetchTimeoutError(
          `Timed out fetching tarball: ${packageName}@${version}`,
          registry,
          packageName,
          version,
          TARBALL_FETCH_TIMEOUT_MS
        );
      }
      throw error;
    }
    return;
  }

  // Downloads (or reuses) the tarball on disk, then parses from the local
  // file. A retained tarball that fails to parse is corrupt: evict it and
  // retry once with a fresh download.
  for (let attempt = 0; attempt < 2; attempt++) {
    let acquired = await cache.acquire(key, download);
    try {
      await parseTarballFile(acquired.path, options);
      return;
    } catch (error) {
      if (!acquired.cached || attempt === 1) throw error;
      await acquired.release();
      await cache.evictKey(key);
    } finally {
      await acquired.release();
    }
  }
}

async function parseTarballFile(tarballPath: string, options: EntryHandlerOptions): Promise<void> {
  return parseTarballSource(createReadStream(tarballPath), options);
}

async function parseTarballSource(tarball: Readable, options: EntryHandlerOptions): Promise<void> {
  let gunzip = gunzipMaybe();
  let extract = tar.extract();
  let settled = false;
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    for (let stream of [tarball, gunzip, extract]) {
      try {
        stream.destroy();
      } catch (cleanupError) {
        console.error("Error destroying tarball stream:", cleanupError);
      }
    }
  };

  return new Promise((resolve, reject) => {
    const rejectWithCleanup = (error: unknown) => {
      settled = true;
      cleanup();
      reject(error);
    };

    extract.on("error", (error) => {
      if (settled) return;
      rejectWithCleanup(error);
    });

    gunzip.on("error", (error) => {
      if (settled) return;
      rejectWithCleanup(error);
    });

    tarball.on("error", (error) => {
      if (settled) return;
      rejectWithCleanup(error);
    });

    extract.on("finish", () => {
      if (settled) return;
      settled = true;
      resolve();
    });

    extract.on("entry", (header, stream, next) => {
      // Every npm tarball has a top-level directory named "package" or
      // similar. Strip it off to get the actual file path.
      let name = header.name.replace(/^[^\/]+\//, "/");

      if (header.type === "directory" || (options.filter && !options.filter(name, header))) {
        stream.resume();
        return next();
      }

      let hasher = new SubresourceIntegrityHasher();
      let chunks: Buffer[] | null = options.buffer ? [] : null;
      let size = 0;

      stream.on("error", (error) => {
        if (settled) return;
        if (!stream.destroyed) stream.destroy();
        rejectWithCleanup(error);
      });

      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        hasher.update(chunk);
        if (chunks) chunks.push(chunk);
      });

      stream.on("end", async () => {
        if (settled) return;
        try {
          let content = chunks
            ? chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
            : null;
          let integrity = hasher.digest();
          let done = await options.handler(name, content, integrity, size, header);
          if (done) {
            settled = true;
            if (!stream.destroyed) stream.destroy();
            cleanup();
            resolve();
          } else {
            next();
          }
        } catch (error) {
          settled = true;
          if (!stream.destroyed) stream.destroy();
          cleanup();
          reject(error);
        }
      });
    });

    void pipeline(tarball, gunzip, extract).catch((error) => {
      if (settled) return;
      rejectWithCleanup(error);
    });
  });
}

function createTarballUrl(registry: string, packageName: string, version: string): URL {
  // Tarball URLs are case-sensitive; legacy uppercase package names keep their case.
  let basename = packageName.split("/").pop()!;
  return new URL(`/${packageName}/-/${basename}-${version}.tgz`, registry);
}

function isTimeoutError(error: unknown, signal: AbortSignal): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || (signal.aborted && error.name === "AbortError"))
  );
}
