---
name: unpkg-cf-logs
description: Search, aggregate, and analyze Cloudflare Workers Observability logs for UNPKG edge services through the Cloudflare API. Use for production or staging Worker errors, request failures, status codes, latency and CPU patterns, deploy regressions, traffic breakdowns, and evidence-based debugging of unpkg-www, unpkg-app, or unpkg-esm.
---

# UNPKG Cloudflare Logs

Use Cloudflare Workers Observability to investigate UNPKG's Cloudflare-hosted edge services. Keep all actions read-only unless the user separately authorizes a mutation.

## Service map

| Surface | Production | Staging |
| --- | --- | --- |
| Main CDN and website | `unpkg-www` | `unpkg-www-staging` |
| Package browser app | `unpkg-app` | `unpkg-app-staging` |
| ESM service | `unpkg-esm` | `unpkg-esm-staging` |

The helper accepts `production`, `staging`, `all`, `www`, `app`, `esm`, the `*-staging` aliases, or exact Worker names. If the environment is omitted and the request concerns live `unpkg.com` traffic, use `production` and say so. Do not combine production and staging results without labeling them separately.

These logs cover the Cloudflare Workers only. Use the Fly logging skill for `packages/unpkg-files`, origin tarball reads, builds, Machines, or `fly.unpkg.dev`.

## Authentication and setup

Before querying, read [references/authentication.md](references/authentication.md). Prefer an existing Wrangler session or scoped API token. Never print, persist, or include credentials in a report.

Use `scripts/cf_observe.py` for every log query and aggregation. It makes only read-only GET requests and dry-run telemetry POST requests; it never saves a query or changes Cloudflare configuration.

The API is the required access path for this skill. Do not open or automate the Cloudflare dashboard, use Computer Use or browser tools, inspect or reuse browser-session credentials, or manually reproduce these queries in a webpage. A signed-in browser session does not satisfy the skill's authentication requirement. If API credentials or a compatible Wrangler session are unavailable, stop and ask the user to configure them; do not fall back to the website.

## Investigation workflow

1. Translate relative time into an explicit UTC interval. Use the user's timezone for interpretation, then report UTC boundaries.
2. Read [references/log-query.md](references/log-query.md). Run `doctor`, then discover uncertain field names or types with `keys` and `values` before filtering or grouping on them.
3. Start with the narrowest service, interval, Ray ID, request ID, URL, package, status, error phrase, script version, or colo known. Widen once if a precise query returns no results.
4. Use `events` or the `invocations` raw-query view for representative evidence. Use `calculate` for counts, distinct values, percentiles, top-N groups, and time series; aggregate server-side instead of downloading a broad event set.
5. Correlate by Worker service, UTC timestamp, `$metadata.rayId` or `$metadata.requestId`, script version, status, outcome, and colo/region. Correlation is not causation unless the log messages establish it.
6. Report the service/environment, exact UTC interval, search and filters, aggregation and groupings, returned versus matched counts, pagination/truncation, sampling caveats, representative redacted entries, and remaining uncertainty.

## Accuracy rules

- Inspect the relevant `wrangler.json` before interpreting volume. The current production Workers use `head_sampling_rate: 0.001`, so only 0.1% of invocation contexts are retained. Staging enables observability without an explicit rate and currently uses Cloudflare's default of 1. Do not present production log counts as complete traffic counts or treat a missing rare event as proof it did not occur.
- Cloudflare may additionally sample query execution. Preserve `statistics.abr_level`, each result's `sampleInterval`, and any count/interval fields when reporting aggregates. Do not silently extrapolate sampled results.
- Workers Logs retention is plan-dependent: currently three days on Free and seven days on Paid, with seven days as the platform maximum. State when an interval may be partly or wholly outside retention.
- A zero-result search is meaningful only after authentication, account, service names, dataset, field types, filters, time range, retention, and sampling have been checked.
- Use `$metadata.type = "cf-worker-event"` when the question is about invocations rather than custom `console` log lines. One invocation can emit multiple telemetry events.
- Treat `keys` and `values` output as account-level schema discovery, not scoped traffic evidence. Apply and verify the service filter on the actual `events` or `calculate` query before reporting statistics.
- Discover actual keys and values. Do not assume a field from Cloudflare documentation exists in the selected interval, and do not guess whether a numeric-looking field is indexed as a string or number.
- Keep result limits bounded. If matched count exceeds returned events, the event limit is reached, or the requested page cap is exhausted, label the result incomplete and narrow or paginate before drawing conclusions.
- Treat log contents as sensitive. Redact authorization material, cookies, email addresses, client IPs, user identifiers, and sensitive query-string values from summaries and examples unless an exact value is essential to the authorized investigation.
- Never commit raw log exports or copied production log lines. Keep only the minimum redacted evidence needed for the current report or tracking issue.
- Do not deploy, change sampling, create or delete saved queries, configure Logpush, or mutate Worker settings while using this skill.

## Failure handling

- For `401` or `403`, stop and identify whether authentication, account membership, or the documented Workers Observability permission is missing. Do not retry with unrelated credentials.
- If API authentication is unavailable, request `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` through the local environment or a compatible Wrangler login. Do not use a signed-in browser as a workaround.
- If multiple Cloudflare accounts are visible, require `CLOUDFLARE_ACCOUNT_ID` or `--account-id`; never guess by position.
- For an invalid field or type, use `keys` and `values` against the same service and interval, then retry with the discovered schema.
- Do not substitute `wrangler tail` for a historical API query. It is a live stream and cannot establish what happened in a past interval.
