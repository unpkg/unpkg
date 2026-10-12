# unpkg-www

This package is the main home page for UNPKG. It is built and deployed as a [Cloudflare Worker](https://workers.cloudflare.com/).

## Development

Install dependencies and run the tests:

```
pnpm install
pnpm test
```

Boot the dev server and assets server (two separate tabs):

```
pnpm dev
pnpm dev:assets
```

## Deploying

Edit the worker configuration in `wrangler.json`, then:

```
pnpm run deploy
```

## Shield version pinning (optional)

`src/shield.ts` implements an optional integration with the Shield security
API: when a published package version is confirmed malicious, Shield serves
a rules feed (`GET {SHIELD_API_ORIGIN}/edge/rules`) and this worker rewrites
matching requests to a last-clean version (pin rules) or serves a static 403
stub (block rules) — before the cache lookup, so swapped requests benefit
from the (usually warm) clean-version cache entry.

Configuration (all optional; when `SHIELD_API_ORIGIN` or `SHIELD_API_KEY` is
unset the worker behaves exactly as if this module did not exist):

- `SHIELD_API_ORIGIN` — Shield API origin *including* the `/v1` prefix
  (a `wrangler.json` var; the dev environment points at local Shield)
- `SHIELD_API_KEY` — shared edge credential. A **secret**: set it with
  `wrangler secret put SHIELD_API_KEY` (or `.dev.vars` for local dev) and
  never commit it

Design properties reviewers should know:

- **Fail-open everywhere.** Shield API outages, corrupt cache entries, and
  unexpected exceptions all degrade to plain unpkg — Shield cannot delay or
  fail a request in any code path. The only outbound call the worker ever
  makes is the rules fetch, refreshed out-of-band (~30s soft TTL per
  isolate); enforcement events are never reported back.
- **Exact-version matching only.** Ranges and tags resolve to exact versions
  via short-lived redirects first; the swap catches the resolved fetch.
- **No purge needed.** Rewrites address the clean version's own cache key,
  and block stubs are `no-store` — rule changes propagate within about a
  minute with zero cache invalidation.
- **Contract tests.** `test/fixtures/edge_match_conformance.json` is the
  executable Shield↔unpkg matching contract, mirrored from the Shield API
  repo; both suites must pass every case. Run with `pnpm test`.
