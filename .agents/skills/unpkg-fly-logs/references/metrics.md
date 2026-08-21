# Metrics correlation

Fly's managed metrics are Prometheus-compatible and use MetricsQL. Query the same UTC interval as the logs. Standard labels include `app`, `region`, `host`, and usually `instance`.

The helper uses Grafana's Prometheus datasource proxy when Grafana authentication is available. With `--org`, it instead uses Fly's official API at `https://api.fly.io/prometheus/<org-slug>/`.

## Examples

HTTP responses grouped by status:

```sh
python3 .agents/skills/unpkg-fly-logs/scripts/fly_observe.py metrics \
  --app production \
  --since 1h \
  --query 'sum by (status) (increase(fly_app_http_responses_count{app="unpkg"}[1h]))'
```

5xx responses by region:

```sh
python3 .agents/skills/unpkg-fly-logs/scripts/fly_observe.py metrics \
  --app unpkg \
  --since 1h \
  --query 'sum by (region, status) (increase(fly_app_http_responses_count{app="unpkg",status=~"5.."}[1h]))'
```

95th-percentile origin response time:

```sh
python3 .agents/skills/unpkg-fly-logs/scripts/fly_observe.py metrics \
  --app unpkg \
  --since 1h \
  --query 'histogram_quantile(0.95, sum by (le) (increase(fly_app_http_response_time_seconds_bucket{app="unpkg"}[1h])))'
```

Machine availability and abnormal exits:

```text
min by (region, instance) (fly_instance_up{app="unpkg"})
max_over_time(fly_instance_exit_oom{app="unpkg"}[1h])
max_over_time(fly_instance_exit_code{app="unpkg"}[1h])
```

Memory pressure and CPU throttling:

```text
1 - (fly_instance_memory_mem_available{app="unpkg"} / fly_instance_memory_mem_total{app="unpkg"})
sum by (region, instance) (increase(fly_instance_cpu_throttle{app="unpkg"}[1h]))
```

Choose a step appropriate to the interval: about 15 seconds for short windows, 60 seconds for hours, and 5 minutes for multi-day windows. Do not use `$__range` or other Grafana UI variables in API queries; substitute a concrete range such as `1h`.

Validate suspected infrastructure events against both metrics and logs. Metrics may establish when and where degradation happened, but not the root cause by themselves.

Official references: [Fly managed metrics](https://fly.io/docs/monitoring/metrics/) and [Grafana datasource HTTP API](https://grafana.com/docs/grafana/latest/developer-resources/api-reference/http-api/api-legacy/data_source/).
