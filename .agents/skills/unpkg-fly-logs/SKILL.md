---
name: unpkg-fly-logs
description: Search and analyze Fly.io logs and Grafana-backed metrics for UNPKG backend services. Use for production or staging incidents, backend errors, request failures, slow responses, Machine health, deploy regressions, and evidence-based operational debugging of unpkg-files.
---

# UNPKG Fly Logs

Use Fly's searchable log store and managed Grafana/Prometheus APIs to investigate UNPKG's Fly-hosted backend. Keep all actions read-only unless the user separately authorizes a mutation.

## Service map

- Production: Fly app `unpkg`, configured by `packages/unpkg-files/fly.json`.
- Staging: Fly app `unpkg-staging`, configured by `packages/unpkg-files/fly.staging.json`.
- The Fly-hosted service is `packages/unpkg-files`; the Cloudflare Workers are not covered by these logs.

Use the environment the user names. Treat `production` and `prod` as `unpkg`, and `staging` as `unpkg-staging`. If the environment is omitted and the request concerns live `unpkg.com` traffic, use production and say so. Do not combine production and staging results without labeling them separately.

## Authentication and setup

Before querying, read [references/authentication.md](references/authentication.md). Prefer existing authenticated sessions and read-only tokens. Never print, persist, or include a token or session cookie in a report.

Use `scripts/fly_observe.py` for API queries. It only performs GET requests.

## Investigation workflow

1. Translate relative time into an explicit UTC interval. Use the user's timezone for interpretation, then report UTC boundaries.
2. Read [references/log-search.md](references/log-search.md), then run a server-side LogsQL search through Fly's managed Grafana datasource. Start with the app filter plus the narrowest known request ID, URL, package, error phrase, region, or Machine ID.
3. Widen the query once if the precise search returns no results. Do not repeatedly broaden until unrelated noise looks like evidence.
4. For incidents involving volume, latency, HTTP status, OOM, restarts, CPU, memory, or Machine availability, read [references/metrics.md](references/metrics.md) and query the same interval through the managed Grafana datasource or Fly's official Prometheus-compatible API.
5. Correlate logs and metrics by app, UTC timestamp, region, and Machine ID. Check `fly machine list -a <app> --json` when current Machine identity or state matters.
6. Report the evidence: app/environment, exact UTC interval, LogsQL/MetricsQL used, match count or truncation, representative entries, affected regions/Machines, metric changes, and remaining uncertainty.

## Accuracy rules

- Fly log search is currently backed by VictoriaLogs and uses LogsQL, not Loki/LogQL. Do not invent Loki label selectors.
- Search logs server-side. `fly logs --no-tail` is a recent buffer/live-tail mechanism, not proof that no historical event occurred.
- Fly's searchable retention is roughly seven days and managed metrics retention is roughly fifteen days. State when the requested interval is partly or wholly outside retention.
- A zero-result search is meaningful only when authentication, app, datasource, query, and time range were all verified.
- Keep result limits bounded. If a result reaches the limit, call it truncated and narrow or paginate before drawing conclusions.
- Preserve platform/proxy logs as well as application stdout; `event.provider`, `log.level`, `http.response.status_code`, and `error.message` often identify infrastructure failures.
- Treat log contents as sensitive. Redact email addresses, client IPs, user identifiers, authorization material, cookies, and sensitive query-string values from summaries and examples unless the user explicitly needs an exact value.
- Never commit raw log exports or copied production log lines to the repository. Keep only the minimum redacted evidence needed for the current report or tracking issue.
- Treat metric/log alignment as correlation unless the messages directly establish causation.
- Do not deploy, restart, scale, SSH, change secrets, or alter Machines while using this skill.

## Failure handling

- For `401` or `403`, stop and identify which credential lacks access; do not retry with unrelated credentials.
- For missing Grafana authentication, use Fly's direct logs API only for a bounded, narrow-window fallback as described in [references/log-search.md](references/log-search.md), and label it as less complete for content search.
- For a missing datasource, verify the active Fly organization in managed Grafana. Do not guess a datasource UID.
- For Fly API instability, preserve the query and error response, then use the official CLI/API fallback documented in the references.
