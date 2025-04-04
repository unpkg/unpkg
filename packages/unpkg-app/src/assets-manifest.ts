import type { Env } from "./env.ts";

/**
 * A map of entry points to their URLs.
 */
export type AssetsManifest = Map<string, string>;

export async function loadAssetsManifest(env: Env): Promise<AssetsManifest> {
  let mod: { default: Record<string, string> };
  switch (env.MODE) {
    case "development":
    case "test":
      mod = await import("../assets-manifest.dev.json");
      break;
    case "production":
    case "staging":
      try {
        // @ts-ignore - This file is generated at build time
        mod = await import("../assets-manifest.json");
      } catch (error) {
        throw new Error("Failed to load assets-manifest.json. Did you run `pnpm build:assets`?");
      }
      break;
  }

  let manifest: AssetsManifest = new Map();

  for (let [entryPoint, path] of Object.entries(mod.default)) {
    manifest.set(entryPoint, new URL(path, env.ASSETS_ORIGIN).href);
  }

  return manifest;
}
