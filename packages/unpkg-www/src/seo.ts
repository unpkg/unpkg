// Crawler and agent discoverability files for unpkg.com. Served by exact-path
// routes in request-handler.tsx — before package parsing, so package URLs
// (including hypothetical packages named "robots.txt") keep working exactly
// as before. Only these four exact paths are intercepted.

export function robotsTxt(origin: string): string {
  return `User-agent: *
Allow: /

Sitemap: ${origin}/sitemap.xml
`;
}

export const MARKETING_PATHS = [
  "/",
  "/network",
  "/guides",
  "/guides/loading-files",
  "/guides/nobuild-apps",
  "/guides/inline-scripts",
  "/guides/browser-modules",
  "/guides/metadata-api",
  "/guides/cache-performance",
  "/guides/supply-chain-security",
  "/status",
  "/about",
] as const;

export function sitemapXml(origin: string): string {
  let urls = MARKETING_PATHS.map((path) => `  <url>\n    <loc>${origin}${path}</loc>\n  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export function llmsTxt(origin: string): string {
  return `# UNPKG

> UNPKG is a fast, global content delivery network for everything on npm. Load any file from any package with a URL like \`${origin}/:package@:version/:file\`.

## Use UNPKG

- [UNPKG home](${origin}/): URL pattern, semver ranges, nobuild apps, inline scripts, browser modules, metadata API, cache performance
- [Guides](${origin}/guides): a map of the UNPKG guides — files, nobuild apps, inline scripts, browser modules, metadata API, caching
- [Network](${origin}/network): how files are served — Cloudflare edge, digest-verified origin fetches, self-healing caches
- [Status](${origin}/status): the surfaces behind UNPKG and how changes ship safely
- [About](${origin}/about): the open source project, contacts, abuse and security reporting
- [Supply Chain Security](${origin}/guides/supply-chain-security): UNPKG Shield (currently in Beta) — edge defense for production traffic, adoption visibility for package owners

## Related

- [UNPKG Shield](https://shield.unpkg.com/): supply chain defense for the packages and domains you depend on — currently in Beta
- [Shield agent brief](https://shield.unpkg.com/llms.txt): machine-readable Shield product brief

## Full detail

- [llms-full.txt](${origin}/llms-full.txt): the complete machine-readable UNPKG brief
`;
}

export function llmsFullTxt(origin: string): string {
  return `# UNPKG — full brief

> UNPKG is a fast, global content delivery network for everything on npm. Use it to quickly and easily load any file from any package using a URL like \`${origin}/:package@:version/:file\`, where \`:package\` is the npm package name, \`:version\` is a version range or dist-tag (defaults to \`latest\`), and \`:file\` is the path to the file in the package.

## Loading files

Append \`?meta\` to any file URL for JSON metadata about the package, version, and file. Directory URLs (trailing \`/\`) list the files in that directory. Version-less and range URLs redirect to the permanent version-resolved URL; for the best cache hit rate, pin the full version number and file path.

## Beyond file serving

- Nobuild apps: load dependencies in browser-only apps with no build step.
- Inline scripts and browser modules: \`<script type="module">\` imports resolved through the CDN, plus an inline script runner at \`${origin}/run\`.
- Metadata API: JSON metadata for any package file via \`?meta\`.
- Cache performance: served from Cloudflare's global edge network; permanent URLs cache on version-pinned paths.

## Supply chain security

[UNPKG Shield](https://shield.unpkg.com/) (currently in Beta) defends the supply chain on top of UNPKG. It watches every npm release the moment it publishes and judges each change with its own diff-aware classifier — informed by OSV, the GitHub Advisory Database, and the OpenSSF malicious-packages feed. Arming a domain pins or swaps compromised packages at the edge before they reach a browser; unarmed domains stay in monitoring. Package owners can see which domains serve their packages and which versions are live. Join the Beta waitlist at https://shield.unpkg.com/register.

## Pages

- Home: ${origin}/
- Guides: ${origin}/guides
- Network: ${origin}/network
- Status: ${origin}/status
- About: ${origin}/about
- Supply Chain Security: ${origin}/guides/supply-chain-security
- UNPKG Shield: https://shield.unpkg.com/
- Shield agent brief: https://shield.unpkg.com/llms.txt
`;
}
