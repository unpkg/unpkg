import { type HydrateComponentTable, hydrateAll } from "../src/hydration.ts";

import { HomeNav } from "../src/components/home-nav.tsx";
import { RunDemo } from "../src/components/run-demo.tsx";
import { StatusChecks } from "../src/components/status-checks.tsx";
import { UrlBuilder } from "../src/components/url-builder.tsx";

const StatefulComponents: HydrateComponentTable = {
  HomeNav,
  RunDemo,
  StatusChecks,
  UrlBuilder,
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
  new EventSource("http://localhost:8000/esbuild").addEventListener("change", () => {
    window.location.reload();
  });
}
