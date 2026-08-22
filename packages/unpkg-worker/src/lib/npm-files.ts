import {
  createCacheableResponse,
  readOptionalResponseWithNetworkRetry,
  readResponseWithNetworkRetry,
  retryOnNetworkConnectionLost,
  waitUntilCachePut,
} from "./cache-utils.ts";

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

export interface PackageFileResponse {
  body: ArrayBuffer;
  response: Response;
}

export async function fetchFile(
  context: ExecutionContext,
  origin: string,
  packageName: string,
  version: string,
  filename: string
): Promise<Response | null> {
  let result = await fetchFileResponse(context, origin, packageName, version, filename);
  return result == null ? null : new Response(result.body, result.response);
}

export async function fetchFileResponse(
  context: ExecutionContext,
  origin: string,
  packageName: string,
  version: string,
  filename: string
): Promise<PackageFileResponse | null> {
  if (filename === "" || filename === "/") {
    return null;
  }

  let url = new URL(`/file/${packageName.toLowerCase()}@${version}${filename}`, origin);
  let request = new Request(url);

  let cache = await retryOnNetworkConnectionLost(() => caches.open("npm-files"));
  let result = await readOptionalResponseWithNetworkRetry(() => cache.match(request));
  if (result == null) {
    result = await readResponseWithNetworkRetry(() => fetch(request));

    if (result.response.ok) {
      waitUntilCachePut(
        context,
        cache,
        request,
        createCacheableResponse(result.response, result.body),
        "npm-files"
      );
    }
  }

  if (!result.response.ok) {
    if (result.response.status === 404) {
      return null;
    }

    throw new Error(`Failed to fetch file: ${result.response.status} ${result.response.statusText}`);
  }

  return result;
}

export async function getFile(
  context: ExecutionContext,
  origin: string,
  packageName: string,
  version: string,
  filename: string
): Promise<PackageFile | null> {
  let result = await fetchFileResponse(context, origin, packageName, version, filename);

  if (result == null) {
    return null;
  }

  let path = filename;
  let body = new Uint8Array(result.body);
  let size = body.length;

  let type = result.response.headers.get("Content-Type");
  if (type == null) {
    throw new Error(`Missing Content-Type header for file: "${filename}"`);
  }

  let digest = result.response.headers.get("Content-Digest");
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

export async function listFiles(
  context: ExecutionContext,
  origin: string,
  packageName: string,
  version: string,
  prefix = "/"
): Promise<PackageFileMetadata[]> {
  let url = new URL(`/list/${packageName.toLowerCase()}@${version}${prefix}`, origin);
  let request = new Request(url);

  let cache = await retryOnNetworkConnectionLost(() => caches.open("npm-file-listings"));
  let result = await readOptionalResponseWithNetworkRetry(() => cache.match(request));

  if (result == null) {
    result = await readResponseWithNetworkRetry(() => fetch(request));

    if (result.response.ok) {
      waitUntilCachePut(
        context,
        cache,
        request,
        createCacheableResponse(result.response, result.body),
        "npm-file-listings"
      );
    }
  }

  if (!result.response.ok) {
    throw new Error(`Failed to fetch file listing: ${result.response.status} ${result.response.statusText}`);
  }

  let json = JSON.parse(new TextDecoder().decode(result.body)) as PackageFileListing;

  if (json.files == null) {
    throw new Error(`Invalid response format: ${JSON.stringify(json)}`);
  }

  return json.files;
}
