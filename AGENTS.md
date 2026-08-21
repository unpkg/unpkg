## Project Context

This repository powers UNPKG, a CDN and web app for serving npm package files directly from package tarballs. It includes Cloudflare Workers for public request handling, a Bun origin service for package file access and transformations, and shared tooling for compatibility and release work.

## Repository Structure

- This is a pnpm workspace. Root scripts fan out to the packages under `packages/*`.
- `packages/unpkg-www` is the main `unpkg.com` Cloudflare Worker.
- `packages/unpkg-app` is the app/browse Cloudflare Worker.
- `packages/unpkg-esm` is the `esm.unpkg.com` Cloudflare Worker. It owns ESM-specific routing, metadata, raw/build proxying, inline transforms, and esm.sh-compatible request behavior.
- `packages/unpkg-files` is the Bun-based origin file server. Package file reads, tarball handling, and ESM build/transform work live here.
- `packages/unpkg-worker` contains shared Cloudflare Worker utilities used by the worker packages.
- `scripts` contains repo-level maintenance and compatibility runners, including the ESM compatibility, browser smoke, readiness, and corpus generation tools.
- `pnpm vendor:esm-sh` starts a pinned upstream esm.sh Docker image for local baseline corpus testing.

## Runtime And Tooling

- Node.js is used for tooling. The repo requires Node `>=23`.
- Bun is used for runtime and tests. The `unpkg-files` server runs on Bun, and package tests use `bun test`.
- Docker is used to run the pinned local esm.sh baseline for compatibility tests.
- Use pnpm for workspace commands and dependency management.
- Do not assume Node and Bun are interchangeable here: prefer the command already declared in `package.json` scripts.
- Local Cloudflare API tokens belong in `.env.local`, which is gitignored. Wrangler deploy scripts load it through `scripts/with-local-env.sh`; do not commit machine-specific token paths or secret values.

## Common Commands

- Install dependencies with `pnpm install`.
- Build everything with `pnpm run build`.
- Run the full repo test suite with `pnpm test`. This runs a build first via `pretest`.
- Run package-specific commands with `pnpm --filter <package> <script>`, for example `pnpm --filter unpkg-files test`.
- Start local development servers with the package `dev` scripts:
  - `pnpm --filter unpkg-www dev` for the main Worker on port 3000.
  - `pnpm --filter unpkg-app dev` for the app Worker on port 3001.
  - `pnpm --filter unpkg-esm dev` for the ESM Worker on port 3002.
  - `pnpm --filter unpkg-files dev` for the Bun file server on port 4000.

## Deployment Notes

- Deploy workers with their package scripts, for example `pnpm --filter unpkg-www deploy` or `pnpm --filter unpkg-esm deploy`.
- Deploy staging workers with `pnpm --filter <package> deploy:staging`.
- `unpkg-www` and `unpkg-app` have asset build steps wired into their package scripts and Wrangler configs; use those scripts so HTML/CSS/JS asset changes are built before deployment.
- `unpkg-esm` server-renders its beta HTML page with Preact components in the Worker and does not have a separate static asset build.
- Worker deploy scripts load local secrets through `scripts/with-local-env.sh`; keep Cloudflare tokens in `.env.local`.

## ESM Compatibility Tools

- Run the seed compatibility suite with `pnpm test:esm-compat`.
- Run a corpus with `pnpm test:esm-compat -- --corpus scripts/esm-compat-corpus.ecosystem.json`.
- Start the local esm.sh baseline with `pnpm vendor:esm-sh`, then compare against it with `pnpm test:esm-compat:local-baseline -- --corpus scripts/esm-compat-corpus.ecosystem.json`.
- Use `--dry-run` to validate and print corpus cases without network requests.
- Use `--ndjson` for long corpus runs so progress and per-case failures stream as newline-delimited JSON.
- Store local compatibility reports in `.reports/`. This directory is gitignored; run `pnpm clean:reports` before new report-producing runs when old output could be confused with fresh results.
- For live runs, set `ESM_UNPKG_ORIGIN` to the local, staging, or beta origin you intend to test. The default is `https://esm.unpkg.com`.
- The compatibility runner limits live checks with `--concurrency` and `--timeout-ms`, and can restart localhost `esm.sh`, `unpkg-esm`, or `unpkg-files` services when a local service becomes unreachable.
