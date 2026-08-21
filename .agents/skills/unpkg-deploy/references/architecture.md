# UNPKG Architecture

Use this reference to identify service ownership, downstream dependencies, and deployment scope. Confirm details in the current source and configuration before a live operation.

## Request topology

```text
Browser / client
  |-- unpkg.com, www.unpkg.com ------> unpkg-www (Cloudflare Worker)
  |                                      |-- npm registry metadata
  |                                      |-- file/list requests --> unpkg-files
  |                                      `-- /run transforms ----> unpkg-esm
  |-- app.unpkg.com ------------------> unpkg-app (Cloudflare Worker)
  |                                      |-- npm registry metadata
  |                                      `-- file/list requests --> unpkg-files
  `-- esm.unpkg.com ------------------> unpkg-esm (Cloudflare Worker)
                                         |-- npm registry metadata
                                         `-- file/build/transform --> unpkg-files

unpkg-files (Fly.io Bun service) ------> registry.npmjs.org tarballs

unpkg-worker = shared TypeScript library bundled into all four runtimes
```

Cloudflare provides the public edge, custom domains, and response caching. The workers resolve package metadata and shape public behavior. The Fly origin performs tarball extraction and CPU-intensive ESM build/transform work.

## Service ownership

### `packages/unpkg-www`

- Public domains: `unpkg.com` and `www.unpkg.com`; staging: `unpkg.dev` and `www.unpkg.dev`.
- Serves the homepage and primary package-file CDN behavior.
- Resolves npm package metadata at the edge, retrieves file bodies/listings from `unpkg-files`, redirects browser views to `unpkg-app`, and serves `/run` using `unpkg-esm` as its transform origin.
- Deployable: Cloudflare Worker `unpkg-www` / `unpkg-www-staging`.
- Has a generated asset pipeline. Its `predeploy` and Wrangler build configuration run `build:assets`.

### `packages/unpkg-app`

- Public domain: `app.unpkg.com`; staging: `app.unpkg.dev`.
- Server-renders package directory and file-browser pages.
- Resolves npm metadata and retrieves file bodies/listings from `unpkg-files`; links canonical file URLs back to `unpkg-www`.
- Deployable: Cloudflare Worker `unpkg-app` / `unpkg-app-staging`.
- Has a generated asset pipeline like `unpkg-www`.

### `packages/unpkg-esm`

- Public domain: `esm.unpkg.com`; staging: `esm.unpkg.dev`.
- Owns ESM-specific URL normalization, version/export resolution, response metadata, raw/build proxying, inline transforms, and esm.sh-compatible request behavior.
- Resolves npm metadata at the edge and sends `/file`, `/build`, and `/transform` work to `unpkg-files`.
- Deployable: Cloudflare Worker `unpkg-esm` / `unpkg-esm-staging`.
- Its home page is rendered by Worker code; it does not use the `unpkg-www`/`unpkg-app` generated asset pipeline.

### `packages/unpkg-files`

- Public origin consumed by workers: `fly.unpkg.com`; staging: `fly.unpkg.dev`.
- Fly apps: `unpkg` and `unpkg-staging`.
- Bun origin that fetches npm tarballs, decompresses and extracts files, lists tarball contents, builds ESM artifacts, and performs inline TS/TSX/JSX transforms.
- Important endpoints: `/_health`, `/file/...`, `/list/...`, `/build/...`, and `POST /transform`.
- Deployable: Fly.io container built from `packages/unpkg-files/Dockerfile` with the repository root as build context.

### `packages/unpkg-worker`

- Shared utilities for package URL parsing, npm metadata, file-origin access, export/version resolution, import rewriting, and related behavior.
- Not independently deployed. It is a workspace dependency of every deployable service.
- A runtime change here usually requires rebuilding, testing, and deploying all four consumers. Narrow type-only or test-only changes may not.

## Environments and local ports

| Service | Local | Staging | Production |
| --- | --- | --- | --- |
| `unpkg-www` | `http://localhost:3000` | `https://unpkg.dev` | `https://unpkg.com` |
| `unpkg-app` | `http://localhost:3001` | `https://app.unpkg.dev` | `https://app.unpkg.com` |
| `unpkg-esm` | `http://localhost:3002` | `https://esm.unpkg.dev` | `https://esm.unpkg.com` |
| `unpkg-files` | `http://localhost:4000` | `https://fly.unpkg.dev` | `https://fly.unpkg.com` |

Worker-to-service origins are defined separately for the default production config and `env.dev` / `env.staging` in each `wrangler.json`. Keep the environment internally consistent: staging workers must point to staging origins and production workers to production origins.

## Change-to-service guide

- `packages/unpkg-www/**`: deploy `unpkg-www`.
- `packages/unpkg-app/**`: deploy `unpkg-app`.
- `packages/unpkg-esm/**`: deploy `unpkg-esm`.
- `packages/unpkg-files/**`: deploy `unpkg-files`; also exercise public worker behavior that depends on the changed origin endpoint.
- `packages/unpkg-worker/**`: deploy every consuming runtime affected by the change, commonly all four.
- `scripts/build-assets.ts` or `scripts/serve-assets.ts`: assess both asset-bearing workers, `unpkg-www` and `unpkg-app`.
- Root dependency, workspace, TypeScript, or build changes: use the dependency graph and built output to determine all affected runtimes; do not assume a single package.
- ESM contract changes can span `unpkg-esm`, `unpkg-files`, and `unpkg-worker`. Test the edge worker and origin together.

Tests, documentation, fixtures, or tooling-only changes do not automatically require a runtime deployment. Base scope on runtime output rather than directory names alone.

## Source-of-truth files

- Root orchestration: `package.json`
- Cloudflare names, routes, origins, and environment vars: `packages/unpkg-{www,app,esm}/wrangler.json`
- Fly apps, sizing, health checks, and mode: `packages/unpkg-files/fly.json` and `fly.staging.json`
- Container build/runtime: `packages/unpkg-files/Dockerfile`
- Service entrypoints and behavior: each package's `src/worker.ts` or `src/server.ts` and request handler
- CI baseline: `.github/workflows/ci.yml`
