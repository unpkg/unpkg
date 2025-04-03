import { Readable } from "node:stream";

import gunzipMaybe from "gunzip-maybe";
import tar from "tar-stream";

import { getContentType } from "./content-type.ts";
import { getSubresourceIntegrity } from "./subresource-integrity.ts";

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
  registry: string,
  packageName: string,
  version: string,
  filename: string
): Promise<PackageFile | null> {
  let file: PackageFile | null = null;

  await parsePackage(registry, packageName, version, (path, content) => {
    if (path.toLowerCase() !== filename.toLowerCase()) {
      return;
    }

    file = {
      path,
      body: content,
      size: content.length,
      type: getContentType(path),
      integrity: getSubresourceIntegrity(content),
    };
  });

  return file;
}

export async function listFiles(
  registry: string,
  packageName: string,
  version: string,
  prefix = "/"
): Promise<PackageFileMetadata[]> {
  let files: PackageFileMetadata[] = [];

  await parsePackage(registry, packageName, version, async (path, content) => {
    if (path.endsWith("/") || !path.startsWith(prefix)) {
      return;
    }

    files.push({
      path,
      size: content.length,
      type: getContentType(path),
      integrity: getSubresourceIntegrity(content),
    });
  });

  return files;
}

async function parsePackage(
  registry: string,
  packageName: string,
  version: string,
  handler: (name: string, content: Uint8Array, header: tar.Headers) => void
): Promise<void> {
  let tarballUrl = createTarballUrl(registry, packageName, version);

  let response = await fetch(tarballUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to fetch tarball (${response.status})`);
  }

  let tarball = Readable.from(response.body!);
  let gunzip = gunzipMaybe();
  let extract = tar.extract();

  const cleanup = () => {
    try {
      // Destroy all streams in the pipeline
      tarball.destroy();
      gunzip.destroy();
      extract.destroy();

      // If the response body is a ReadableStream, cancel it
      if (response.body && typeof response.body.cancel === "function") {
        response.body.cancel();
      }
    } catch (cleanupError) {
      console.error("Error during cleanup:", cleanupError);
    }
  };

  return new Promise((resolve, reject) => {
    extract.on("error", (error) => {
      cleanup();
      reject(error);
    });

    gunzip.on("error", (error) => {
      cleanup();
      reject(error);
    });

    tarball.on("error", (error) => {
      cleanup();
      reject(error);
    });

    extract.on("finish", () => {
      resolve();
    });

    extract.on("entry", (header, stream, next) => {
      if (header.type === "directory") {
        stream.resume();
        return next();
      }

      let chunks: Buffer[] = [];

      stream.on("error", (error) => {
        cleanup();
        reject(error);
      });

      stream.on("data", (chunk) => {
        chunks.push(chunk);
      });

      stream.on("end", () => {
        try {
          // Every npm tarball has a top-level directory named "package" or
          // similar. Strip it off to get the actual file path.
          let name = header.name.replace(/^[^\/]+\//, "/");
          handler(name, Buffer.concat(chunks), header);
          next();
        } catch (error) {
          cleanup();
          reject(error);
        }
      });
    });

    tarball.pipe(gunzip).pipe(extract);
  });
}

// export async function parsePackage(
//   registry: string,
//   packageName: string,
//   version: string,
//   handler: (name: string, content: Uint8Array, header: tar.Headers) => void
// ): Promise<void> {
//   let tarballUrl = createTarballUrl(registry, packageName, version);
//   let response = await fetch(tarballUrl);

//   if (!response.ok || !response.body) {
//     throw new Error(`Failed to fetch tarball (${response.status})`);
//   }

//   let readable = Readable.from(response.body!);

//   return new Promise((resolve, reject) => {
//     let extract = tar.extract();

//     extract.on("error", (error) => {
//       reject(error);
//     });

//     extract.on("finish", () => {
//       resolve();
//     });

//     extract.on("entry", (header, stream, next) => {
//       if (header.type === "directory") {
//         stream.resume();
//         return next();
//       }

//       let chunks: Buffer[] = [];

//       stream.on("data", (chunk) => {
//         chunks.push(chunk);
//       });

//       stream.on("end", () => {
//         // Every npm tarball has a top-level directory named "package" or
//         // similar. Strip it off to get the actual file path.
//         let name = header.name.replace(/^[^\/]+\//, "/");
//         handler(name, Buffer.concat(chunks), header);
//         next();
//       });
//     });

//     readable.pipe(gunzip()).pipe(extract);
//   });
// }

function createTarballUrl(registry: string, packageName: string, version: string): URL {
  let basename = packageName.split("/").pop()!.toLowerCase();
  return new URL(`/${packageName.toLowerCase()}/-/${basename}-${version}.tgz`, registry);
}
