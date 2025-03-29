import { type HydrateComponentTable, hydrateAll } from "../src/hydration.ts";

import { CodeViewer } from "../src/components/code-viewer.tsx";
import { VersionSelector } from "../src/components/version-selector.tsx";

const StatefulComponents: HydrateComponentTable = {
  CodeViewer,
  VersionSelector,
};

hydrateAll(StatefulComponents);

declare global {
  interface Window {
    __DEV__: boolean;
  }
}

if (window.__DEV__) {
  new EventSource("http://localhost:8001/esbuild").addEventListener("change", () => {
    window.location.reload();
  });
}
