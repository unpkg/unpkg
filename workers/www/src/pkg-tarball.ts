import { createCacheableResponse } from "./cache-utils.js";
import { type Env } from "./env.ts";
import { GunzipStream } from "./gunzip.ts";
import { HttpError } from "./http-error.js";
import { type TarEntry, parseTarStream } from "./tar.ts";

export async function fetchPackageTarball(
  req: { package: string; version: string },
  env: Env,
  ctx: ExecutionContext,
  handler: (entry: TarEntry, filename: string) => void,
): Promise<void> {
  let request = new Request(createTarballUrl(req.package, req.version));

  let cache = await caches.open("npm-tarballs");
  let response = await cache.match(request);

  if (response == null) {
    if (env.MODE !== "test") {
      console.debug(`Fetching tarball for ${req.package}@${req.version}`);
    }

    response = await fetch(request);

    if (response.status === 404) {
      throw new HttpError(`Package not found: ${req.package}@${req.version} (${response.status})`, 404);
    }
    if (!response.ok || !response.body) {
      throw new HttpError(`Failed to fetch tarball for ${req.package}@${req.version} (${response.status})`, 500);
    }

    ctx.waitUntil(cache.put(request, createCacheableResponse(response)));
  }

  if (!response.body) {
    throw new HttpError(`Failed to fetch tarball for ${req.package}@${req.version} (no body)`, 500);
  }

  // We use node:zlib instead of DecompressionStream('gzip') because the latter has issues with
  // decompressing some npm tarballs in my experiments.
  // let stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  let stream = response.body.pipeThrough(new GunzipStream());

  for await (let entry of parseTarStream(stream)) {
    // Every npm package file has a `package` prefix, strip it here
    let path = entry.name.replace(/^package\//, "/");
    handler(entry, path);
  }
}

function createTarballUrl(packageName: string, version: string): URL {
  return new URL(`/${packageName}/-/${basename(packageName)}-${version}.tgz`, "https://registry.npmjs.org");
}

function basename(packageName: string): string {
  return packageName.includes("/") ? packageName.split("/")[1] : packageName;
}
