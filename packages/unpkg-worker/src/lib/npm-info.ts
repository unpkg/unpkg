import { createCacheableResponse, observeIoOperation, waitUntilCachePut } from "./cache-utils.ts";

export interface PackageInfo {
  description?: string;
  "dist-tags"?: Record<string, string>;
  homepage?: string;
  keywords?: string[];
  license?: string;
  maintainers?: { name: string; email?: string }[];
  name: string;
  repository?: {
    type: string;
    url: string;
    directory?: string;
  };
  time: Record<string, string>; // timestamps of published versions
  versions?: Record<string, PackageJson>;
}

export interface PackageJson {
  // See https://github.com/defunctzombie/package-browser-field-spec
  browser?: string | Record<string, string>;
  css?: string;
  dependencies: Record<string, string>;
  description: string;
  devDependencies?: Record<string, string>;
  exports?: ExportTarget;
  homepage?: string;
  license?: string;
  main?: string;
  // See https://medium.com/webpack/webpack-and-rollup-the-same-but-different-a41ad427058c
  module?: string;
  name: string;
  peerDependencies?: Record<string, string>;
  repository?: { url: string; type?: string; directory?: string };
  style?: string;
  types?: string;
  typesVersions?: Record<string, Record<string, string[]>>;
  typings?: string;
  unpkg?: string;
  version: string;
}

export type ExportTarget = string | null | ExportConditions;

export interface ExportConditions {
  [condition: string]: ExportTarget;
}

export async function getPackageInfo(
  context: ExecutionContext,
  registry: string,
  packageName: string
): Promise<PackageInfo | null> {
  let request = new Request(createPackageInfoUrl(registry, packageName), {
    headers: { Accept: "application/json" },
  });

  let cache = await observeIoOperation("npm-info:cache-open", () => caches.open("npm-info"));
  let response = await observeIoOperation("npm-info:cache-match", () => cache.match(request));

  if (!response) {
    response = await observeIoOperation("npm-info:registry-fetch", () => fetch(request));

    if (response && response.ok) {
      waitUntilCachePut(context, cache, request, createCacheableResponse(response), "npm-info");
    }
  }

  if (response && response.ok) {
    return observeIoOperation("npm-info:response-json", () => response.json());
  }

  return null;
}

function createPackageInfoUrl(registry: string, packageName: string): URL {
  return new URL(`/${packageName.toLowerCase()}`, registry);
}
