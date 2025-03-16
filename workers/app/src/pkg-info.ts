import { createCacheableResponse } from "./cache-utils.ts";
import { type Env } from "./env.ts";

export interface PackageInfo {
  description?: string;
  "dist-tags": Record<string, string>;
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
  versions: Record<string, PackageJson>;
}

export interface PackageJson {
  // See https://github.com/defunctzombie/package-browser-field-spec
  browser?: string | Record<string, string>;
  dependencies: Record<string, string>;
  description: string;
  exports?: string | ExportConditions;
  homepage?: string;
  license?: string;
  main?: string;
  // See https://medium.com/webpack/webpack-and-rollup-the-same-but-different-a41ad427058c
  module?: string;
  name: string;
  repository?: { url: string; type?: string; directory?: string };
  unpkg?: string;
  version: string;
}

export interface ExportConditions {
  [condition: string]: string | ExportConditions;
}

export async function fetchPackageInfo(
  req: { package: string },
  env: Env,
  ctx: ExecutionContext,
): Promise<PackageInfo | null> {
  let request = new Request(createPackageInfoUrl(req.package), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  let cache = await caches.open("npm-package-info");
  let response = await cache.match(request);

  if (response == null) {
    if (env.MODE !== "test") {
      console.debug(`Fetching package info for ${req.package}`);
    }

    response = await fetch(request);

    if (response.status === 404) {
      return null;
    }

    ctx.waitUntil(cache.put(request, createCacheableResponse(response)));
  }

  return response.json();
}

function createPackageInfoUrl(packageName: string): URL {
  return new URL(`/${packageName}`, "https://registry.npmjs.org");
}
