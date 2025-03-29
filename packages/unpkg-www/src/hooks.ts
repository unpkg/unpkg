import { useContext } from "preact/hooks";

import { AssetsContext } from "./assets-context.ts";

export function useAsset(entryPoint: string): string {
  let manifest = useContext(AssetsContext);

  let asset = manifest.get(entryPoint);
  if (asset) return asset;

  throw new Error(`Asset not found: ${entryPoint}`);
}
