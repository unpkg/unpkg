# UNPKG

UNPKG is a fast, global content delivery network for everything on npm. Load any file from any package with a URL — no install, no build step:

```
https://unpkg.com/:package@:version/:file
```

- `:package` is the package name on npm, including scope (`@scope/name`).
- `:version` is an exact version, a semver range, or a dist-tag. Omit it and `latest` is used.
- `:file` is the path to a file in the package. Omit it and UNPKG resolves the package's entry point from `package.json` (`exports` first, then `main`; a package can choose its UNPKG default with the `unpkg` field).

Examples:

- https://unpkg.com/preact@10.26.4/dist/preact.min.js
- https://unpkg.com/react@18.3.1/umd/react.production.min.js
- https://unpkg.com/three@0.174.0/build/three.module.min.js

## Quick start

Load a library with a classic script tag:

```html
<script src="https://unpkg.com/preact@10.26.4/dist/preact.min.js"></script>
```

Or build a browser app with no build step, using an import map and native ES modules:

```html
<script type="importmap">
  {
    "imports": {
      "preact": "https://unpkg.com/preact@10.25.4/dist/preact.module.js",
      "preact/hooks": "https://unpkg.com/preact@10.25.4/hooks/dist/hooks.module.js",
      "htm": "https://unpkg.com/htm@3.1.1/dist/htm.module.js"
    }
  }
</script>
<script type="module">
  import { h, render } from "preact";
  // your app here
</script>
```

Append `?module` to a package URL and UNPKG rewrites its bare imports to UNPKG URLs, so many packages work directly in a module script. For packages that are not published as browser-ready modules, [esm.unpkg.com](https://esm.unpkg.com) converts them first (currently in beta) — see the browser modules guide below.

## Choosing a version specifier

Ranges and tags (`preact@^10`, `preact@latest`) redirect to the exact version they resolve to, so the response you ultimately get is always a permanent URL.

- **Exact versions** (e.g. `preact@10.26.4`) are permanent and cache best. Bug fixes arrive only when you update the URL.
- **Patch-level ranges** (e.g. `preact@10.26`) take bug fixes within a release line automatically, while major and minor changes stay deliberate. This is a good default for production pages.
- **Loose ranges and tags** always give you the newest matching release, at the cost of a redirect on the way in.

The security side of letting versions move is what [UNPKG Shield](https://shield.unpkg.com/) (currently in beta) is for: it watches every npm release as it publishes and can pin or swap a compromised version at the edge before a browser executes it.

## Discovering what's in a package

Append `?meta` to any package or directory URL for JSON metadata — file paths, sizes, MIME types, and SHA-256 integrity hashes:

```
https://unpkg.com/react-router@7.3.0/?meta
https://unpkg.com/react-router@7.3.0/dist/?meta
```

Add a trailing `/` to a package URL (e.g. https://unpkg.com/react/) to browse its files in the package browser.

## Guides

- [Loading files](https://unpkg.com/guides/loading-files) — the URL pattern, versions, entry points, and exports
- [Nobuild apps](https://unpkg.com/guides/nobuild-apps) — import maps and native modules, no bundler
- [Inline scripts](https://unpkg.com/guides/inline-scripts) — run TypeScript/JSX inline with the `/run` helper
- [Browser modules](https://unpkg.com/guides/browser-modules) — esm.unpkg.com parameters and behavior
- [Metadata API](https://unpkg.com/guides/metadata-api) — the `?meta` JSON format
- [Cache performance](https://unpkg.com/guides/cache-performance) — permanent URLs and the pinning trade-off
- [Supply chain security](https://unpkg.com/guides/supply-chain-security) — how UNPKG Shield works, and how it differs from SRI
- [Network](https://unpkg.com/network) — how files are served, cached, and verified

Machine-readable versions of the site are available for agents and crawlers: every page above is also served as Markdown (append `.md` to the URL, or send `Accept: text/markdown`), and https://unpkg.com/llms.txt indexes the full set.

## Development

This repository contains the production source for UNPKG. There are 5 packages:

- [`unpkg-www`](./packages/unpkg-www/) is the main UNPKG website and package file CDN worker
- [`unpkg-app`](./packages/unpkg-app/) is the package browser app worker
- [`unpkg-esm`](./packages/unpkg-esm/) is the `esm.unpkg.com` package import worker for browser-ready ESM, CSS modules, import maps, and inline TS/TSX transforms
- [`unpkg-files`](./packages/unpkg-files/) is the Bun file server backend that fetches npm tarballs, extracts files, and builds ESM artifacts for the workers
- [`unpkg-worker`](./packages/unpkg-worker/) is the shared TypeScript library used by the workers and the files backend

We use [pnpm](https://pnpm.io/) for workspace tooling and [Bun](https://bun.sh/) for the runtime and tests. Install these first.

Next, install all dependencies and run the tests:

```sh
pnpm install
pnpm test
```

Then start the file server and each worker, plus the asset servers for the two HTML apps:

```sh
pnpm --filter unpkg-files dev
pnpm --filter unpkg-www dev
pnpm --filter unpkg-www dev:assets
pnpm --filter unpkg-app dev
pnpm --filter unpkg-app dev:assets
pnpm --filter unpkg-esm dev
```

The local services listen on these ports:

- `unpkg-www`: `http://localhost:3000`
- `unpkg-app`: `http://localhost:3001`
- `unpkg-esm`: `http://localhost:3002`
- `unpkg-files`: `http://localhost:4000`

## Deploying

The `unpkg-files` backend is deployed on [Fly.io](https://fly.io). You'll need an account.

Next, adjust the Fly config in `packages/unpkg-files/fly.json` (you'll need your own app `name`) and deploy:

```sh
pnpm --filter unpkg-files run deploy
```

To deploy the workers, you'll need a [Cloudflare](https://cloudflare.com) account. You will also need to (1) edit the `wrangler.json` file in each worker and update its [`routes`](https://developers.cloudflare.com/workers/wrangler/configuration/) to your own domain(s) and (2) adjust each worker's environment `vars` (in `wrangler.json`) so they can find one another in production.

For API token authentication, create a local `.env.local` file from `.env.example` and set `CLOUDFLARE_API_TOKEN`. The worker deploy scripts load `.env.local` automatically before invoking Wrangler. Use a token with the Cloudflare permissions needed for the operation you are running, such as worker deploy permissions for deploys and cache purge permissions when purging CDN entries.

Once you've done that, you can deploy all workers with:

```sh
pnpm run deploy:workers
```

Or deploy each worker individually with:

```sh
pnpm --filter unpkg-www run deploy
pnpm --filter unpkg-app run deploy
pnpm --filter unpkg-esm run deploy
```

## License

Please see [LICENSE](./LICENSE) for more information.
