import type { ExecutionContext } from "@cloudflare/workers-types";

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

export async function getFile(
  context: ExecutionContext,
  filesOrigin: string,
  packageName: string,
  version: string,
  filename: string
): Promise<PackageFile | null> {
  if (filename === "" || filename === "/") {
    return null;
  }

  let request = new Request(createFileUrl(filesOrigin, packageName, version, filename));

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

  let path = filename;
  let body = new Uint8Array(await response.arrayBuffer());
  let size = body.length;
  let type = response.headers.get("Content-Type")!;

  let digest = response.headers.get("Content-Digest")!;
  let match = digest.match(/^([a-zA-Z0-9]+)=:([A-Za-z0-9+/=]+):$/);
  if (match == null) {
    throw new Error(`Invalid Content-Digest header: "${digest}"`);
  }

  let [algorithm, hash] = match.slice(1);
  let integrity = `${algorithm}-${hash}`;

  return { path, body, size, type, integrity };
}

function createFileUrl(filesOrigin: string, packageName: string, version: string, filename: string): URL {
  return new URL(`/file/${packageName.toLowerCase()}@${version}${filename}`, filesOrigin);
}

export async function listFiles(
  context: ExecutionContext,
  filesOrigin: string,
  packageName: string,
  version: string,
  prefix = "/"
): Promise<PackageFileMetadata[]> {
  let request = new Request(createListUrl(filesOrigin, packageName, version, prefix));

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

  let { files } = (await response.json()) as PackageFileListing;

  return files;
}

function createListUrl(filesOrigin: string, packageName: string, version: string, prefix: string): URL {
  return new URL(`/list/${packageName.toLowerCase()}@${version}${prefix}`, filesOrigin);
}
