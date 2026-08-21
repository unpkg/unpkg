# UNPKG Deployment Runbook

Read this before a live deployment. Commands assume the repository root and current checked-in scripts.

## Preconditions

- Confirm the requested environment: `staging` or `production`.
- Confirm the affected services from the diff and [architecture.md](architecture.md).
- Inspect `git status`, current branch/commit, and relevant config. Do not include unrelated working-tree changes unintentionally.
- Install with pnpm and respect the checked-in package manager/runtime versions. Node is used for tooling, Bun for runtime/tests, Wrangler for Cloudflare, and Fly CLI for the origin.
- Cloudflare: put `CLOUDFLARE_API_TOKEN` in root `.env.local`, which is gitignored and loaded by `scripts/with-local-env.sh`. Use a token with permissions for the requested operation.
- Fly.io: authenticate the Fly CLI to the account containing `unpkg` / `unpkg-staging`.
- Do not echo credentials or paste them into commands that will enter logs or shell history.

Useful read-only credential checks include `fly auth whoami` and the Wrangler authentication/account command supported by the installed workspace version. Prefer the package scripts for actual deployment.

## Pre-deploy validation

Choose checks based on impact, escalating for shared or cross-service changes:

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm test
```

For a narrow change, a package-specific build and test may be sufficient:

```sh
pnpm --filter <package> build
pnpm --filter <package> test
```

For ESM routing, build, transform, or compatibility changes, run the deployed-origin compatibility and browser checks:

```sh
ESM_UNPKG_ORIGIN=https://esm.unpkg.dev pnpm test:esm-compat -- --corpus scripts/esm-compat-corpus.seed.json --skip-baseline
pnpm test:esm-browser -- --corpus scripts/esm-compat-corpus.seed.json --origin https://esm.unpkg.dev --run-origin https://unpkg.dev
```

Do not claim the browser suite ran unless Chromium/Playwright was available and the command completed successfully.

## Staging deployment

Deploy only affected services. When a release changes both the Fly origin contract and its consumers, deploy and verify the origin before the workers.

```sh
pnpm --filter unpkg-files run deploy:staging
pnpm run deploy:workers:staging
```

The worker aggregate runs `unpkg-www`, then `unpkg-app`, then `unpkg-esm`. Individual staging commands are:

```sh
pnpm --filter unpkg-www run deploy:staging
pnpm --filter unpkg-app run deploy:staging
pnpm --filter unpkg-esm run deploy:staging
```

## Production deployment

Production requires explicit user intent. Prefer a successful staging exercise first for changes that cross service boundaries or affect routing, caching, transforms, or generated assets.

```sh
pnpm --filter unpkg-files run deploy
pnpm run deploy:workers
```

The aggregate deploys Cloudflare Workers only. Individual production commands are:

```sh
pnpm --filter unpkg-www run deploy
pnpm --filter unpkg-app run deploy
pnpm --filter unpkg-esm run deploy
```

Do not deploy `unpkg-files` when it is unaffected merely because the root aggregate excludes it. Conversely, never describe `deploy:workers` as a complete all-service deployment.

## Post-deploy verification

First confirm that the provider reported a successful release and retain its version or deployment identifier when available. Then check every deployed service's health endpoint.

Staging:

```sh
curl --fail --silent --show-error https://fly.unpkg.dev/_health
curl --fail --silent --show-error https://unpkg.dev/_health
curl --fail --silent --show-error https://app.unpkg.dev/_health
curl --fail --silent --show-error https://esm.unpkg.dev/_health
```

Production:

```sh
curl --fail --silent --show-error https://fly.unpkg.com/_health
curl --fail --silent --show-error https://unpkg.com/_health
curl --fail --silent --show-error https://app.unpkg.com/_health
curl --fail --silent --show-error https://esm.unpkg.com/_health
```

Verify behavior, not just liveness. Select checks that cross the changed boundary, for example:

- Fetch a concrete package file through `unpkg-www` and inspect status, redirects, content type, and body.
- Open or fetch a concrete package listing/file page through `unpkg-app`.
- Import or fetch representative exact-version modules through `unpkg-esm`; run the compatibility and browser smoke suites for meaningful ESM changes.
- Exercise the relevant `/file`, `/list`, `/build`, or `/transform` origin behavior when `unpkg-files` changed.
- Verify hashed assets and page rendering when `unpkg-www` or `unpkg-app` assets changed.
- Check that staging responses use staging origins and links; an accidentally mixed environment is a release failure.

Exact package versions make post-deploy checks reproducible and avoid dist-tag movement. Avoid cache-busting production package URLs unless the validation specifically requires a cold path and the operational cost is acceptable.

## Coordinated rollout and failure rules

- Maintain compatibility during multi-service rollout where possible. Origin changes should tolerate the currently deployed workers until the new workers are healthy.
- If the origin deploy fails, do not deploy workers that require its new contract.
- If one worker in an aggregate fails, identify which preceding workers already deployed; the command is sequential and does not roll them back automatically.
- If health or behavior checks fail, stop, preserve logs and deployment IDs, and determine whether the failure is code, configuration, routing, cache, credentials, or provider state.
- A retry is appropriate only after identifying a transient provider failure or correcting the cause. Do not loop live deploys.

## Rollback preparation

Before rolling back, identify the last known-good commit/provider revision, the failing service, and whether a cross-service contract requires coordinated rollback. Prefer provider-supported rollback or redeploying a known-good revision. Do not use destructive Git commands, rewrite the user's working tree, disable public routes, or purge broad caches without explicit authorization and a scoped recovery plan.

After rollback, repeat the same health and behavior checks and report the resulting provider revision.

## Deployment report

Report:

- Environment and services deployed
- Source commit or exact working-tree state
- Provider deployment IDs/versions when available
- Pre-deploy checks and post-deploy smoke checks, with outcomes
- Any service intentionally not deployed
- Failures, partial rollout state, rollback action, or remaining risk
