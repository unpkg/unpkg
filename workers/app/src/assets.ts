import { createContext } from "preact";

export const AssetsContext = createContext(new Map() as AssetsManifest);

/**
 * A map of entry points to their URLs.
 */
export type AssetsManifest = Map<string, string>;

export async function loadAssetsManifest({
  origin,
  dev = true,
}: {
  origin: string;
  dev?: boolean;
}): Promise<AssetsManifest> {
  let mod: { default: Record<string, string> };
  if (dev) {
    mod = await import("../assets-manifest.dev.json");
  } else {
    try {
      // @ts-ignore
      mod = await import("../assets-manifest.json");
    } catch (error) {
      throw new Error("Failed to load assets manifest. Did you forget to run `pnpm run build:assets`?");
    }
  }

  let manifest: AssetsManifest = new Map();

  for (let [entryPoint, path] of Object.entries(mod.default)) {
    manifest.set(entryPoint, new URL(path, origin).href);
  }

  return manifest;
}
