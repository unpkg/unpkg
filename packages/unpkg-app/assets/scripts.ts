import { type HydrateComponentTable, hydrateAll } from "../src/hydration.ts";

import { CodeViewer } from "../src/components/code-viewer.tsx";
import { VersionSelector } from "../src/components/version-selector.tsx";

const StatefulComponents: HydrateComponentTable = {
  CodeViewer,
  VersionSelector,
};

hydrateAll(StatefulComponents);
let themeToggle = document.getElementById("theme-toggle");
themeToggle?.addEventListener("click", () => {
  let next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("unpkg-theme", next);
  } catch {}
  let cookie = `unpkg-theme=${next}; path=/; max-age=31536000; SameSite=Lax`;
  let parts = location.hostname.split(".");
  if (parts.length >= 2) cookie += `; domain=.${parts.slice(-2).join(".")}`;
  document.cookie = cookie;
});

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
