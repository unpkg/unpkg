# Authentication

The helper reads credentials from the environment or an existing Wrangler session and never writes them. API authentication is mandatory for this skill.

Do not authenticate through or automate the Cloudflare dashboard. Do not use Computer Use, an in-app browser, an external browser, browser cookies, local storage, or other browser-session material to obtain or query logs. If only a signed-in webpage is available, stop and request API credentials or a compatible Wrangler login.

## Preferred setup

First check Wrangler without displaying its token:

```sh
wrangler whoami
python3 .agents/skills/unpkg-cf-logs/scripts/cf_observe.py doctor
```

The helper tries credentials in this order:

1. `CLOUDFLARE_API_TOKEN`.
2. `CLOUDFLARE_API_KEY` plus `CLOUDFLARE_EMAIL` for legacy authentication.
3. `wrangler auth token --json` from an existing Wrangler login.

Cloudflare's telemetry query, key, and value endpoints currently document `Workers Observability Write` as the required token permission even though the helper only runs queries. Scope an API token to the UNPKG account and no more resources than needed. Prefer the Wrangler OAuth session when it already has suitable access.

The account ID is resolved from `--account-id`, then `CLOUDFLARE_ACCOUNT_ID`, then Wrangler/account discovery. If more than one account is visible, set the ID explicitly. `CLOUDFLARE_ACCOUNT_NAME` may be used to select an exact account name during API discovery.

Repository-local Cloudflare variables may be loaded without committing them:

```sh
./scripts/with-local-env.sh \
  python3 .agents/skills/unpkg-cf-logs/scripts/cf_observe.py doctor
```

Keep tokens in the current environment or the gitignored `.env.local`. Never pass tokens as command-line arguments, paste them into prompts, store them in the skill, or include them in command output.

## Authentication errors

- `401`: the credential is missing, malformed, expired, or revoked.
- `403`: the credential usually lacks account access or the Workers Observability permission.
- Multiple accounts: pass `--account-id` or set `CLOUDFLARE_ACCOUNT_ID`; do not select the first account silently.
- Older Wrangler versions may not provide `auth token`. In that case, use an environment token or update/install Wrangler outside this investigation only when the user authorizes dependency changes.
- A browser login is not an authentication fallback for this skill.

Official references: [Wrangler authentication commands](https://developers.cloudflare.com/workers/wrangler/commands/general/#auth), [Workers Observability API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/), and [run a telemetry query](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/).
