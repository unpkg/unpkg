import { useContext } from "preact/hooks";

import { AssetsContext } from "./assets-context.ts";
import { HrefsContext } from "./hrefs-context.ts";
import type { HrefBuilder } from "./href-builder.ts";

export function useAsset(entryPoint: string): string {
  let manifest = useContext(AssetsContext);
  let asset = manifest.get(entryPoint);
  if (asset) return asset;
  throw new Error(`Asset not found: ${entryPoint}`);
}

export function useHrefs(): HrefBuilder {
  let hrefs = useContext(HrefsContext);
  if (hrefs) return hrefs;
  throw new Error("Hrefs context not found");
}
