import {
  createCacheableResponse,
  readOptionalResponseWithNetworkRetry,
  readResponseWithNetworkRetry,
  retryOnNetworkConnectionLost,
  waitUntilCachePut,
} from "./cache-utils.ts";

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

  let cache = await retryOnNetworkConnectionLost(() => caches.open("npm-info"));
  let result = await readOptionalResponseWithNetworkRetry(() => cache.match(request));

  if (result == null) {
    result = await readResponseWithNetworkRetry(() => fetch(request));

    if (result.response.ok) {
      waitUntilCachePut(
        context,
        cache,
        request,
        createCacheableResponse(result.response, result.body),
        "npm-info"
      );
    }
  }

  if (result.response.ok) {
    return JSON.parse(new TextDecoder().decode(result.body)) as PackageInfo;
  }

  return null;
}

function createPackageInfoUrl(registry: string, packageName: string): URL {
  return new URL(`/${packageName.toLowerCase()}`, registry);
}
