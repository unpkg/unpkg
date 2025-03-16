import { type PackageFile, type PackageFileMetadata, type PackageFileListing } from "../../www/src/index.ts";

export { type PackageFile, type PackageFileMetadata, type PackageFileListing };

/**
 * Proxies all requests for files and metadata through to the raw worker service.
 */
export class WwwWorkerProxy {
  #service: Fetcher;
  #origin: string;

  constructor(service: Fetcher, origin: string) {
    this.#service = service;
    this.#origin = origin;
  }

  async getFileListing(packageName: string, version: string, filename: string): Promise<PackageFileListing> {
    let request = new Request(`${this.#origin}/${packageName}@${version}${filename}?meta`);
    let response = await this.#service.fetch(request);

    if (!response.ok) {
      throw new Error(`Failed to fetch file listing for ${request.url}: ${response.status}`);
    }
    if (!response.headers.get("Content-Type")!.startsWith("application/json")) {
      throw new Error(`Expected JSON response at ${request.url}, got ${response.headers.get("Content-Type")}`);
    }

    return response.json();
  }

  async getFile(packageName: string, version: string, filename: string): Promise<PackageFile | null> {
    let response = await this.#service.fetch(`${this.#origin}/${packageName}@${version}${filename}`);

    if (!response.ok) {
      return null;
    }

    let match = response.headers.get("Content-Digest")!.match(/(\w+)=:(.+?):/);
    let [algorithm, hash] = match!.slice(1);
    let buffer = await response.arrayBuffer();

    let file: PackageFile = {
      path: filename,
      body: new Uint8Array(buffer),
      type: response.headers.get("Content-Type")!,
      size: buffer.byteLength,
      integrity: `${algorithm}-${hash}`,
    };

    return file;
  }
}
