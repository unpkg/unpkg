import type { ExecutionContext } from "@cloudflare/workers-types";

import { getContentType } from "./content-type.ts";
import { GunzipStream } from "./gunzip.ts";
import { getSubresourceIngtegrity } from "./subresource-integrity.ts";
import { type TarEntry, parseTarStream } from "./tar.ts";

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

const publicNpmRegistry = "https://registry.npmjs.org";

export interface RegistryClientOptions {
  executionContext?: ExecutionContext;
  mode?: string;
  npmRegistry?: string;
}

export class RegistryClient {
  #executionContext: ExecutionContext | null;
  #mode: string;
  #npmRegistry: string;

  constructor(options?: RegistryClientOptions) {
    this.#executionContext = options?.executionContext ?? null;
    this.#mode = options?.mode ?? "production";
    this.#npmRegistry = options?.npmRegistry ?? publicNpmRegistry;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo | null> {
    let request = new Request(createPackageInfoUrl(this.#npmRegistry, packageName), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    let cache = await caches.open("npm-package-info");
    let response = await cache.match(request);

    if (response == null) {
      if (this.#mode !== "test") {
        console.debug(`Fetching package info for ${packageName}`);
      }

      response = await fetch(request);

      if (response.status === 404) {
        return null;
      }

      if (this.#executionContext) {
        this.#executionContext.waitUntil(cache.put(request, createCacheableResponse(response)));
      }
    }

    return response.json();
  }

  async getFile(packageName: string, version: string, filename: string): Promise<PackageFile | null> {
    let file: PackageFile | null = null;

    await this.#fetchPackageTarball(packageName, version, async (entry, path) => {
      if (path.toLowerCase() !== filename.toLowerCase()) {
        return;
      }

      file = {
        path,
        body: entry.content,
        size: entry.size,
        type: getContentType(path),
        integrity: await getSubresourceIngtegrity(entry.content),
      };
    });

    return file;
  }

  async listFiles(packageName: string, version: string, prefix: string): Promise<PackageFileMetadata[]> {
    let files: PackageFileMetadata[] = [];

    await this.#fetchPackageTarball(packageName, version, async (entry, path) => {
      if (path.endsWith("/") || !path.startsWith(prefix)) {
        return;
      }

      files.push({
        path,
        size: entry.size,
        type: getContentType(path),
        integrity: await getSubresourceIngtegrity(entry.content),
      });
    });

    return files;
  }

  async #fetchPackageTarball(
    packageName: string,
    version: string,
    handler: (entry: TarEntry, filename: string) => void,
  ): Promise<void> {
    let request = new Request(createTarballUrl(this.#npmRegistry, packageName, version));

    let cache = await caches.open("npm-tarballs");
    let response = await cache.match(request);

    if (response == null) {
      if (this.#mode !== "test") {
        console.debug(`Fetching tarball for ${packageName}@${version}`);
      }

      response = await fetch(request);

      if (response.status === 404) {
        throw new Error(`Package not found: ${packageName}@${version} (${response.status})`);
      }
      if (!response.ok || !response.body) {
        throw new Error(`Failed to fetch tarball for ${packageName}@${version} (${response.status})`);
      }

      if (this.#executionContext) {
        this.#executionContext.waitUntil(cache.put(request, createCacheableResponse(response)));
      }
    }

    if (!response.body) {
      throw new Error(`Failed to fetch tarball for ${packageName}@${version} (no body)`);
    }

    // Use node:zlib instead of DecompressionStream('gzip') because the latter has issues with
    // decompressing some npm tarballs in my experiments.
    // let stream = response.body.pipeThrough(new DecompressionStream("gzip"));
    let stream = response.body.pipeThrough(new GunzipStream());

    for await (let entry of parseTarStream(stream)) {
      // Most packages have header names that look like `package/index.js`
      // so we shorten that to just `/index.js` here. A few packages use a
      // prefix other than `package/`. e.g. the firebase package uses the
      // `firebase_npm/` prefix. So we just strip the first dir name.
      let path = entry.name.replace(/^[^/]+\/?/, "/");
      handler(entry, path);
    }
  }
}

function createPackageInfoUrl(registry: string, packageName: string): URL {
  return new URL(`/${packageName}`, registry);
}

function createTarballUrl(registry: string, packageName: string, version: string): URL {
  return new URL(`/${packageName}/-/${packageBasename(packageName)}-${version}.tgz`, registry);
}

function packageBasename(packageName: string): string {
  return packageName.includes("/") ? packageName.split("/")[1] : packageName;
}

function createCacheableResponse(response: Response): Response {
  let clone = response.clone();
  let headers = new Headers(clone.headers);

  // Cloudflare cannot cache responses with Set-Cookie headers
  // See https://developers.cloudflare.com/workers/runtime-apis/cache/
  headers.delete("Set-Cookie");

  return new Response(clone.body, {
    status: clone.status,
    headers,
  });
}
