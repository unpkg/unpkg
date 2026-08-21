# Log query and aggregation

Cloudflare's Workers Observability API provides field discovery, value discovery, individual events, invocation-grouped events, traces, and server-side calculations. Run these operations only through `scripts/cf_observe.py`; do not use the Cloudflare dashboard or browser automation. Query the persisted store for historical investigations; `wrangler tail` is only a live stream and is not a substitute.

## Discover the schema

List service-related keys seen in production during the last hour:

```sh
python3 .agents/skills/unpkg-cf-logs/scripts/cf_observe.py keys \
  --service production --since 1h --key-needle service
```

List status values using the actual type returned by `keys`:

```sh
python3 .agents/skills/unpkg-cf-logs/scripts/cf_observe.py values \
  --service production --since 1h \
  --key '$workers.event.response.status' --type number
```

Useful common fields include `$metadata.service`, `$metadata.type`, `$metadata.level`, `$metadata.message`, `$metadata.error`, `$metadata.rayId`, `$metadata.requestId`, `$metadata.duration`, `$workers.event.response.status`, `$workers.event.request.path`, `$workers.event.request.cf.country`, `$workers.outcome`, `$workers.cpuTimeMs`, and `$workers.wallTimeMs`. Treat these as discovery hints, not a guaranteed schema.

The discovery endpoints can return account-wide candidate keys or values even when a service filter is supplied. Do not use their output as traffic evidence. Scope statistics with `events` or `calculate`, and verify the returned `run.query.parameters.filters` contains the intended exact Worker name.

## Search events

Recent ESM errors:

```sh
python3 .agents/skills/unpkg-cf-logs/scripts/cf_observe.py events \
  --service esm --since 30m \
  --filter '$metadata.level' eq string error \
  --limit 200
```

5xx invocation logs for the main Worker:

```sh
python3 .agents/skills/unpkg-cf-logs/scripts/cf_observe.py events \
  --service www --since 1h \
  --filter '$metadata.type' eq string cf-worker-event \
  --filter '$workers.event.response.status' gte number 500 \
  --filter '$workers.event.response.status' lt number 600 \
  --pages 3 --limit 500 --json
```

Search a Ray ID, package, URL fragment, or error phrase with `--search`. Add `--regex` for RE2 syntax and `--case-sensitive` only when needed. A filter has four values: `KEY OPERATION TYPE VALUE`. Use `-` as the placeholder for `exists` or `is_null`; equality filters preserve a literal `-` value. Invalid types and operations fail before the API request.

The helper prints concise events by default. `--json` emits one structured document with all fetched events, requested and effective run timeframes, applied filters, query statistics, matched and returned counts, the cursor, and the exact request bodies. This authenticated output can contain sensitive machine data; redact reports and never commit raw output.

## Aggregate server-side

Count recorded 5xx invocation events by production Worker:

```sh
python3 .agents/skills/unpkg-cf-logs/scripts/cf_observe.py calculate \
  --service production --since 1h --count invocation_estimate \
  --filter '$metadata.type' eq string cf-worker-event \
  --filter '$workers.event.response.status' gte number 500 \
  --filter '$workers.event.response.status' lt number 600 \
  --group-by '$metadata.service:string' \
  --order-by invocation_estimate --order desc --limit 20
```

CPU percentiles by Worker:

```sh
python3 .agents/skills/unpkg-cf-logs/scripts/cf_observe.py calculate \
  --service production --since 1h \
  --calculation 'p95:$workers.cpuTimeMs:number:p95_cpu_ms' \
  --calculation 'p99:$workers.cpuTimeMs:number:p99_cpu_ms' \
  --group-by '$metadata.service:string' --chart
```

`--calculation` uses `OPERATOR:KEY:TYPE[:ALIAS]`. `--group-by` uses `KEY:TYPE`. Supported operators are API-defined and include `uniq`, `min`, `max`, `sum`, `avg`, `median`, `p90`, `p95`, `p99`, `stddev`, and `variance`. Use `--count [ALIAS]` for row counts.

After filtering to `cf-worker-event`, counts represent Worker invocations rather than custom console lines. Cloudflare can sampling-weight calculations, so counts may be estimates rather than raw observed rows. Production's current 0.1% head sample can omit rare failures. Preserve `statistics.abr_level`, `sampleInterval`, and `interval`, and do not present low-frequency estimates as exact.

## Arbitrary API queries

For nested filter groups, havings, comparison periods, invocation/trace views, or API features not exposed by the convenience commands, send a complete request body from a file or stdin:

```sh
python3 .agents/skills/unpkg-cf-logs/scripts/cf_observe.py query --file query.json
python3 .agents/skills/unpkg-cf-logs/scripts/cf_observe.py query --file - < query.json
```

The helper forces `dry: true`, replaces any query ID with a fresh ad-hoc ID, retention-bounds the required timeframe, enforces limits at or below 2000, and injects the allowlisted UNPKG service scope selected with `--service`. Unknown Worker names and filter trees that cannot be safely scoped are rejected. Use the returned `$metadata.id` as `offset` for cursor pagination.

Official references: [Query Builder](https://developers.cloudflare.com/workers/observability/query-builder/), [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), [telemetry query API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/), [keys API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/keys/), and [values API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/values/).
