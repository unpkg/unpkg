# Authentication

The helper reads credentials from the environment and never writes them.

## Fly API

First check the existing CLI session without displaying its token:

```sh
fly auth whoami
fly apps list --json
```

If the session is authenticated, the helper can obtain the short-lived CLI token internally with `fly auth token --quiet`. Alternatively set `FLY_API_TOKEN` to an org-scoped read-only token. Do not pass tokens on command lines because they can appear in shell history or process listings.

When an organization slug is needed, use `fly orgs list --json` and verify which organization owns `unpkg` or `unpkg-staging`. Set `FLY_ORG` only for the current shell if convenient.

## Managed Grafana

Log search through `https://fly-metrics.net` requires an authenticated Grafana session. The helper supports either:

- `FLY_GRAFANA_TOKEN`: a Grafana service-account/API token with query-only access.
- `FLY_GRAFANA_COOKIE`: the complete `Cookie` header from an already authenticated managed-Grafana session.

Prefer a read-only Grafana token. A session cookie is a fallback and should remain only in the current shell. Never store either value in the skill, repository, `.env.local`, command output, or a report.

Check access and discover datasource UIDs without printing credentials:

```sh
python3 .agents/skills/unpkg-fly-logs/scripts/fly_observe.py doctor
```

Managed Grafana scopes datasources to the currently selected Fly organization. If results omit a known app, switch or reauthenticate to the owning organization before changing queries.
