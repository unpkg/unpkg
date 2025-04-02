import * as path from "node:path";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const publicDir = path.resolve(__dirname, "..", "public");

export async function findPublicAsset(filename: string): Promise<Bun.BunFile | null> {
  let file = Bun.file(path.join(publicDir, filename));
  if (await file.exists()) return file;
  return null;
}
