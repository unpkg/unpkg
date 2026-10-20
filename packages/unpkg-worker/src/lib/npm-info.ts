import { createCacheableResponse, isCacheableResponse } from "./cache-utils.ts";
import { fetchVerifiedResponse } from "./origin-fetch.ts";

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
  // The npm registry is case-sensitive and legacy packages with uppercase names
  // exist (often alongside an unrelated lowercase package), so try the name as
  // given first and fall back to lowercase — but only on a definitive 404. A
  // transient registry error must not silently resolve an unrelated package.
  let result = await fetchPackageInfo(context, registry, packageName);
  if (result.packageInfo == null && result.notFound && packageName !== packageName.toLowerCase()) {
    result = await fetchPackageInfo(context, registry, packageName.toLowerCase());
  }

  return result.packageInfo;
}

async function fetchPackageInfo(
  context: ExecutionContext,
  registry: string,
  packageName: string
): Promise<{ packageInfo: PackageInfo | null; notFound: boolean }> {
  let request = new Request(new URL(`/${packageName}`, registry), {
    headers: { Accept: "application/json" },
  });

  let cache = await caches.open("npm-info");
  let cached = await cache.match(request);

  if (cached) {
    try {
      let packageInfo = JSON.parse(await cached.text()) as PackageInfo;
      return { packageInfo, notFound: false };
    } catch {
      // A cached packument that no longer parses is corrupt. Evict and
      // refetch rather than failing every request until it expires.
      console.warn(`Evicting corrupt npm-info cache entry: ${request.url}`);
      await cache.delete(request);
    }
  }

  let verified = await fetchVerifiedResponse(() => new Request(request));
  let response = verified.response;

  if (response.ok) {
    let text = await response.text();
    // Parse before caching so an unparseable body is never stored.
    let packageInfo = JSON.parse(text) as PackageInfo;

    if (verified.bodyVerified && isCacheableResponse(response)) {
      context.waitUntil(cache.put(request, createCacheableResponse(new Response(text, response))));
    }

    return { packageInfo, notFound: false };
  }

  return { packageInfo: null, notFound: response.status === 404 };
}
