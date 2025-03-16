import { type HydrateComponentTable, hydrateAll } from "./hydration.ts";

import { HomeNav } from "./components/home.tsx";

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
