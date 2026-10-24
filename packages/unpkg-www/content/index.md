# UNPKG

> UNPKG is a fast, global content delivery network for everything on npm. Load any file from any package with a URL like `https://unpkg.com/:package@:version/:file`.

- `:package` — the package name on npm, including scope (`@scope/name`).
- `:version` — an exact version, a semver range, or a dist-tag. Omit it and `latest` is used.
- `:file` — the path to a file in the package. Omit it and UNPKG resolves the package's entry point from `package.json`.

## Quick start

Classic script tag:

```html
<script src="https://unpkg.com/preact@10.26.4/dist/preact.min.js"></script>
```

No-build app with an import map:

```html
<script type="importmap">
  {
    "imports": {
      "preact": "https://unpkg.com/preact@10.25.4/dist/preact.module.js",
      "preact/hooks": "https://unpkg.com/preact@10.25.4/hooks/dist/hooks.module.js"
    }
  }
</script>
<script type="module">
  import { h, render } from "preact";
</script>
```

## Choosing a version specifier

- Exact versions are permanent and cache best; updates are deliberate.
- Patch-level ranges (e.g. `preact@10.26`) receive bug fixes within a release line automatically — a good production default.
- Loose ranges and tags always resolve to the newest matching release, via a redirect to the permanent URL.

## Discovering package contents

Append `?meta` to any package or directory URL for JSON metadata (paths, sizes, MIME types, SHA-256 integrity hashes), e.g. `https://unpkg.com/react-router@7.3.0/?meta`. Add a trailing `/` to browse files in the package browser.

## Learn more

- Guides index: https://unpkg.com/guides.md
- Loading files: https://unpkg.com/guides/loading-files.md
- Nobuild apps: https://unpkg.com/guides/nobuild-apps.md
- Browser modules (esm.unpkg.com): https://unpkg.com/guides/browser-modules.md
- Metadata API: https://unpkg.com/guides/metadata-api.md
- Cache performance: https://unpkg.com/guides/cache-performance.md
- Supply chain security (UNPKG Shield): https://unpkg.com/guides/supply-chain-security.md
- Network and architecture: https://unpkg.com/network.md
- Status: https://unpkg.com/status.md
- About: https://unpkg.com/about.md
- Full machine-readable brief: https://unpkg.com/llms-full.txt
