import { type HydrateComponentTable, hydrateAll } from "./hydration.ts";

import { CodeViewer } from "./components/code-viewer.tsx";
import { VersionSelector } from "./components/version-selector.tsx";

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
