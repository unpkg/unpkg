import {
  createCacheableResponse,
  getContentLength,
  isCacheableResponse,
  parseContentDigest,
  verifyBody,
} from "./cache-utils.ts";
import {
  DEFAULT_BUFFER_THRESHOLD_BYTES,
  fetchVerifiedResponse,
  markBodyVerification,
  wrapWithVerificationAudit,
  type OriginFetchOptions,
} from "./origin-fetch.ts";

export interface PackageFile {
  path: string;
  body: Uint8Array;
  size: number;
  type: string;
  integrity: string;
}

export type PackageFileMetadata = Omit<PackageFile, "body">;

export interface PackageFileListing {
  package: string;
  version: string;
  prefix: string;
  files: PackageFileMetadata[];
}

// Validates a cached file response before serving it. Returns a verified
// response, or null when the entry is corrupt or unverifiable (in which
// case the entry is evicted and the caller refetches). Entries from the
// files origin always carry Content-Length and Content-Digest; an entry
// with neither cannot be checked and is not trusted.
async function healCachedFileResponse(
  cache: Cache,
  request: Request,
  cached: Response,
  options: OriginFetchOptions
): Promise<{ response: Response; pendingVerification: boolean } | null> {
  if (!isCacheableResponse(cached)) {
    await cache.delete(request);
    return null;
  }

  let length = getContentLength(cached.headers);
  let digest = parseContentDigest(cached.headers);

  if (length == null && digest == null) {
    await cache.delete(request);
    return null;
  }

  let threshold = options.bufferThresholdBytes ?? DEFAULT_BUFFER_THRESHOLD_BYTES;

  if (length != null && length <= threshold) {
    let buffer: ArrayBuffer;
    try {
      buffer = await cached.arrayBuffer();
    } catch {
      await cache.delete(request);
      return null;
    }

    let verification = await verifyBody(cached.headers, new Uint8Array(buffer));
    if (!verification.ok) {
      console.warn(
        `Evicting corrupt npm-files cache entry (${verification.reason}): ${request.url}`
      );
      await cache.delete(request);
      return null;
    }

    return { response: new Response(buffer, cached), pendingVerification: false };
  }

  if (cached.body == null) {
    await cache.delete(request);
    return null;
  }

  // Large entries stream through an audit; a mismatch errors the stream
  // and evicts the entry so the next request refetches.
  return {
    response: new Response(
      wrapWithVerificationAudit(cached.body, cached.headers, () => {
        void cache.delete(request);
      }),
      cached
    ),
    pendingVerification: true,
  };
}



export async function fetchFile(
  context: ExecutionContext,
  origin: string,
  packageName: string,
  version: string,
  filename: string,
  options: OriginFetchOptions = {}
): Promise<Response | null> {
  if (filename === "" || filename === "/") {
    return null;
  }

  let url = new URL(`/file/${packageName.toLowerCase()}@${version}${filename}`, origin);
  let request = new Request(url);

  let cache = await caches.open("npm-files");
  let cached = await cache.match(request);
  if (cached) {
    let healed = await healCachedFileResponse(cache, request, cached, options);
    if (healed != null) {
      return markBodyVerification(healed.response, healed.pendingVerification);
    }
  }

  let verified = await fetchVerifiedResponse(() => new Request(url), options);
  let response = verified.response;

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }

    throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
  }

  // A streamed body can still fail verification, and an unverified-digest
  // body must not be stored by an outer cache layer either. Both are
  // marked pending; only final, buffer-backed bodies are marked verified.
  markBodyVerification(response, verified.streamed || !verified.bodyVerified);

  if (verified.bodyVerified && isCacheableResponse(response)) {
    let cacheResponse = createCacheableResponse(response.clone());
    // The entry only stands if the body verifies end-to-end. For streamed
    // bodies this settles after the cache write, so evict on rejection.
    context.waitUntil(
      cache
        .put(request, cacheResponse)
        .then(() => verified.done)
        .catch(async () => {
          await cache.delete(request).catch(() => {});
        })
    );
  }

  return response;
}

export async function getFile(
  context: ExecutionContext,
  origin: string,
  packageName: string,
  version: string,
  filename: string,
  options: OriginFetchOptions = {}
): Promise<PackageFile | null> {
  let response = await fetchFile(context, origin, packageName, version, filename, options);

  if (response == null) {
    return null;
  }

  let path = filename;
  let body = new Uint8Array(await response.arrayBuffer());
  let size = body.length;

  let type = response.headers.get("Content-Type");
  if (type == null) {
    throw new Error(`Missing Content-Type header for file: "${filename}"`);
  }

  let digest = response.headers.get("Content-Digest");
  if (digest == null) {
    throw new Error(`Missing Content-Digest header for file: "${filename}"`);
  }

  let match = digest.match(/^([a-zA-Z0-9]+)=:([A-Za-z0-9+/=]+):$/);
  if (match == null) {
    throw new Error(`Invalid Content-Digest header: "${digest}"`);
  }

  let [algorithm, hash] = match.slice(1);
  let integrity = `${algorithm}-${hash}`;

  return { path, body, size, type, integrity };
}

function parseFileListing(text: string): PackageFileListing {
  let json = JSON.parse(text) as PackageFileListing;

  if (json.files == null) {
    throw new Error(`Invalid response format: ${text.slice(0, 200)}`);
  }

  return json;
}

export async function listFiles(
  context: ExecutionContext,
  origin: string,
  packageName: string,
  version: string,
  prefix = "/",
  options: OriginFetchOptions = {}
): Promise<PackageFileMetadata[]> {
  let url = new URL(`/list/${packageName.toLowerCase()}@${version}${prefix}`, origin);
  let request = new Request(url);

  let cache = await caches.open("npm-file-listings");
  let cached = await cache.match(request);

  if (cached) {
    try {
      let listing = parseFileListing(await cached.text());
      return listing.files;
    } catch {
      // A cached listing that no longer parses is corrupt (for example a
      // truncated body cached earlier). Evict and refetch.
      console.warn(`Evicting corrupt npm-file-listings cache entry: ${request.url}`);
      await cache.delete(request);
    }
  }

  let maxAttempts = options.maxAttempts ?? 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // This loop owns the attempt budget (fetch failures and unparseable
    // bodies alike), so each iteration makes a single origin fetch.
    let verified;
    try {
      verified = await fetchVerifiedResponse(() => new Request(url), { ...options, maxAttempts: 1 });
    } catch (error) {
      lastError = error;
      continue;
    }
    let response = verified.response;

    if (!response.ok) {
      throw new Error(`Failed to fetch file listing: ${response.status} ${response.statusText}`);
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      lastError = error;
      continue;
    }

    let listing: PackageFileListing;
    try {
      listing = parseFileListing(text);
    } catch (error) {
      // Unparseable bodies are never cached; retry in case the body was
      // truncated or corrupted in transit.
      lastError = error;
      continue;
    }

    if (verified.bodyVerified && isCacheableResponse(response)) {
      context.waitUntil(
        cache.put(request, createCacheableResponse(new Response(text, response)))
      );
    }

    return listing.files;
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to fetch file listing");
}
