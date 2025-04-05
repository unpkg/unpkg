import { createCacheableResponse } from "./cache-utils.ts";

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
  dependencies: Record<string, string>;
  description: string;
  devDependencies?: Record<string, string>;
  exports?: string | ExportConditions;
  homepage?: string;
  license?: string;
  main?: string;
  // See https://medium.com/webpack/webpack-and-rollup-the-same-but-different-a41ad427058c
  module?: string;
  name: string;
  peerDependencies?: Record<string, string>;
  repository?: { url: string; type?: string; directory?: string };
  unpkg?: string;
  version: string;
}

export interface ExportConditions {
  [condition: string]: string | ExportConditions;
}

export async function getPackageInfo(
  context: ExecutionContext,
  registry: string,
  packageName: string
): Promise<PackageInfo | null> {
  let request = new Request(createPackageInfoUrl(registry, packageName), {
    headers: { Accept: "application/json" },
  });

  let cache = await caches.open("npm-info");
  let response = await cache.match(request);

  if (!response) {
    response = await fetch(request);

    if (response && response.ok) {
      context.waitUntil(cache.put(request, createCacheableResponse(response)));
    }
  }

  if (response && response.ok) {
    return response.json();
  }

  return null;
}

function createPackageInfoUrl(registry: string, packageName: string): URL {
  return new URL(`/${packageName.toLowerCase()}`, registry);
}
