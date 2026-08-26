import { type HydrateComponentTable, hydrateAll } from "../src/hydration.ts";

import { HomeNav } from "../src/components/home-nav.tsx";
import { RunDemo } from "../src/components/run-demo.tsx";

const StatefulComponents: HydrateComponentTable = {
  HomeNav,
  RunDemo,
};

hydrateAll(StatefulComponents);

declare global {
  interface Window {
    __DEV__: boolean;
  }
}

if (window.__DEV__) {
  new EventSource("http://localhost:8000/esbuild").addEventListener("change", () => {
    window.location.reload();
  });
}
