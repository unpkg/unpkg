import { createCacheableResponse } from "./cache-utils.ts";

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

export async function fetchFile(
  context: ExecutionContext,
  origin: string,
  packageName: string,
  version: string,
  filename: string
): Promise<Response | null> {
  if (filename === "" || filename === "/") {
    return null;
  }

  let url = new URL(`/file/${packageName.toLowerCase()}@${version}${filename}`, origin);
  let request = new Request(url);

  let cache = await caches.open("npm-files");
  let response = await cache.match(request);
  if (!response) {
    response = await fetch(request);

    if (response.ok) {
      context.waitUntil(cache.put(request, createCacheableResponse(response)));
    }
  }

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }

    throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
  }

  return response;
}

export async function getFile(
  context: ExecutionContext,
  origin: string,
  packageName: string,
  version: string,
  filename: string
): Promise<PackageFile | null> {
  let response = await fetchFile(context, origin, packageName, version, filename);

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

export async function listFiles(
  context: ExecutionContext,
  origin: string,
  packageName: string,
  version: string,
  prefix = "/"
): Promise<PackageFileMetadata[]> {
  let url = new URL(`/list/${packageName.toLowerCase()}@${version}${prefix}`, origin);
  let request = new Request(url);

  let cache = await caches.open("npm-file-listings");
  let response = await cache.match(request);

  if (!response) {
    response = await fetch(request);

    if (response.ok) {
      context.waitUntil(cache.put(request, createCacheableResponse(response)));
    }
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch file listing: ${response.status} ${response.statusText}`);
  }

  let json = (await response.json()) as PackageFileListing;

  if (json.files == null) {
    throw new Error(`Invalid response format: ${JSON.stringify(json)}`);
  }

  return json.files;
}
