import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import gunzipMaybe from "gunzip-maybe";
import tar from "tar-stream";
import type { PackageFile, PackageFileMetadata } from "unpkg-worker";

import { getContentType } from "./content-type.ts";
import { SubresourceIntegrityHasher } from "./subresource-integrity.ts";

const TARBALL_FETCH_TIMEOUT_MS = 30_000;
export async function getFile(
  registry: string,
  packageName: string,
  version: string,
  filename: string
): Promise<PackageFile | null> {
  let file: PackageFile | null = null;

  await fetchAndParsePackage(registry, packageName, version, {
    buffer: true,
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
  try {
    return await fetchAndParsePackageExact(registry, packageName, version, options);
  } catch (error) {
    // Tarball URLs are case-sensitive; fall back to the lowercase name for
    // requests that spell a lowercase package with different casing.
    if (error instanceof PackageNotFoundError && packageName !== packageName.toLowerCase()) {
      return fetchAndParsePackageExact(registry, packageName.toLowerCase(), version, options);
    }

    throw error;
  }
}

async function fetchAndParsePackageExact(
  registry: string,
  packageName: string,
  version: string,
  options: EntryHandlerOptions,
): Promise<void> {
  let tarballUrl = createTarballUrl(registry, packageName, version);
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

  let tarball = Readable.from(response.body!);
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

    if (response.body && !response.body.locked) {
      void response.body.cancel().catch((cleanupError) => {
        if (!isTimeoutError(cleanupError, signal)) {
          console.error("Error canceling tarball response body:", cleanupError);
        }
      });
    }
  };

  return new Promise((resolve, reject) => {
    const rejectWithCleanup = (error: unknown) => {
      settled = true;
      cleanup();

      if (isTimeoutError(error, signal)) {
        reject(
          new TarballFetchTimeoutError(
            `Timed out fetching tarball: ${packageName}@${version}`,
            registry,
            packageName,
            version,
            TARBALL_FETCH_TIMEOUT_MS
          )
        );
      } else {
        reject(error);
      }
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

    // Bun can surface a second unhandled rejection when a web response body
    // aborts inside a manual .pipe() chain. pipeline() observes that rejection
    // while the stream listeners above preserve the original error handling.
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
