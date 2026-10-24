// Machine-readable Markdown versions of the marketing pages and guides.
// Source files live in ../../content/ (kept as plain .md so they can be
// edited, diffed, and reused outside the Worker). They are served only
// through the agent-facing doors in request-handler.tsx: an explicit `.md`
// path, or an `Accept: text/markdown` request on the HTML path. Browsers
// always prefer text/html, so human visitors never land here by clicking.
import about from "../content/about.md" with { type: "text" };
import guidesIndex from "../content/guides.md" with { type: "text" };
import browserModules from "../content/guides/browser-modules.md" with { type: "text" };
import cachePerformance from "../content/guides/cache-performance.md" with { type: "text" };
import inlineScripts from "../content/guides/inline-scripts.md" with { type: "text" };
import loadingFiles from "../content/guides/loading-files.md" with { type: "text" };
import metadataApi from "../content/guides/metadata-api.md" with { type: "text" };
import nobuildApps from "../content/guides/nobuild-apps.md" with { type: "text" };
import supplyChainSecurity from "../content/guides/supply-chain-security.md" with { type: "text" };
import home from "../content/index.md" with { type: "text" };
import network from "../content/network.md" with { type: "text" };
import status from "../content/status.md" with { type: "text" };

/** Canonical HTML path -> Markdown source. Keys are exactly the sitemap paths. */
export const MARKETING_MARKDOWN: Record<string, string> = {
  "/": home,
  "/network": network,
  "/status": status,
  "/guides": guidesIndex,
  "/about": about,
  "/guides/loading-files": loadingFiles,
  "/guides/nobuild-apps": nobuildApps,
  "/guides/inline-scripts": inlineScripts,
  "/guides/browser-modules": browserModules,
  "/guides/metadata-api": metadataApi,
  "/guides/cache-performance": cachePerformance,
  "/guides/supply-chain-security": supplyChainSecurity,
};

/** The `.md` URL for a canonical path (the homepage is `/index.md`). */
export function markdownPathFor(path: string): string {
  return path === "/" ? "/index.md" : `${path}.md`;
}
