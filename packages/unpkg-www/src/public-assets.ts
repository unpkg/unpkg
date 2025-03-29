import * as path from "node:path";
import * as fsp from "node:fs/promises";

import { lookup } from "mrmime";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const rootDir = path.resolve(__dirname, "..");

export async function findPublicAsset(request: Request): Promise<File | null> {
  let pathname = new URL(request.url).pathname;
  let filePath = path.join(rootDir, "public", pathname);

  try {
    let stats = await fsp.stat(filePath);
    if (stats.isFile()) {
      let contents = await fsp.readFile(filePath);
      let name = path.basename(filePath);
      let type = lookup(name) ?? "application/octet-stream";
      return new File([contents], name, { type, lastModified: stats.mtimeMs });
    }
  } catch (error) {
    // Ignore errors, we'll return null if the file doesn't exist
  }

  return null;
}
