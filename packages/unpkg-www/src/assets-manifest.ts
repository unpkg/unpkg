import * as path from "node:path";
import * as fsp from "node:fs/promises";

import { env } from "./env.ts";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const rootDir = path.resolve(__dirname, "..");

/**
 * A map of entry points to their URLs.
 */
export type AssetsManifest = Map<string, string>;

export async function loadAssetsManifest(): Promise<AssetsManifest> {
  let json: Record<string, string>;
  switch (env.MODE) {
    case "development":
    case "test":
      json = await loadJson(path.join(rootDir, "assets-manifest.dev.json"));
      break;
    case "production":
    case "staging":
      try {
        json = await loadJson(path.join(rootDir, "assets-manifest.json"));
      } catch (error) {
        throw new Error("Failed to load assets-manifest.json. Did you run `pnpm run build:assets`?");
      }
      break;
  }

  let manifest: AssetsManifest = new Map();

  for (let [entryPoint, path] of Object.entries(json)) {
    if (env.ASSETS_ORIGIN) {
      manifest.set(entryPoint, new URL(path, env.ASSETS_ORIGIN).href);
    } else {
      manifest.set(entryPoint, path);
    }
  }

  return manifest;
}

async function loadJson(file: string): Promise<Record<string, string>> {
  return JSON.parse(await fsp.readFile(file, "utf-8"));
}
