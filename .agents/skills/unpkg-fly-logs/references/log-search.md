# Log search

Fly's managed search retains roughly seven days of logs in VictoriaLogs and exposes them through Grafana. Use LogsQL field filters over the structured Fly envelope.

## Query with the helper

Production errors from the last hour:

```sh
python3 .agents/skills/unpkg-fly-logs/scripts/fly_observe.py search \
  --app production \
  --since 1h \
  --query 'log.level:in("error", "fatal") OR http.response.status_code:>=500' \
  --limit 500
```

One request or package-related failure:

```sh
python3 .agents/skills/unpkg-fly-logs/scripts/fly_observe.py search \
  --app unpkg \
  --since 30m \
  --query 'http.request.id:="REQUEST_ID" OR "PACKAGE_OR_PATH"' \
  --limit 200
```

Add `--region sjc` or `--machine <id>` when known. Add `--json` to retain the structured fields. Use `--until 2026-08-21T18:30:00Z` with either a relative `--since` duration or an absolute timestamp.

The helper always prepends an exact `fly.app.name` filter. Useful fields include:

- `fly.app.name`, `fly.app.instance`, `fly.region`
- `event.provider`, `log.level`, `message`, `error.message`, `error.code`
- `http.request.id`, `http.request.method`, `http.response.status_code`, `url.full`
- `_time` or `timestamp`

Use exact filters (`field:="value"`) for identifiers and quoted phrases for literal text. Begin with the most discriminating known value. The returned order is normalized by timestamp.

## Direct Fly API fallback

If Grafana authentication is unavailable, query Fly's historical HTTP endpoint for a narrow interval and apply a local regular expression:

```sh
python3 .agents/skills/unpkg-fly-logs/scripts/fly_observe.py buffer \
  --app production \
  --since 10m \
  --contains 'timeout|ECONNRESET|status.?5[0-9][0-9]' \
  --limit 500
```

This endpoint pages chronologically from `--since`. The helper reports when its page cap or result cap makes the result incomplete. Do not describe an incomplete buffer scan as a definitive zero-match search.

`fly logs -a <app> --no-tail --json` is useful only for a quick recent check. It is not a replacement for the time-bounded server-side search.

Official references: [Fly log search](https://fly.io/docs/monitoring/search-logs/), [Fly logs API options](https://fly.io/docs/monitoring/logs-api-options/), and [LogsQL](https://docs.victoriametrics.com/victorialogs/logsql/).
