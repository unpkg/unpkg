import { type HydrateComponentTable, hydrateAll } from "../src/hydration.ts";

import { HomeNav } from "../src/components/home-nav.tsx";

const StatefulComponents: HydrateComponentTable = {
  HomeNav,
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
