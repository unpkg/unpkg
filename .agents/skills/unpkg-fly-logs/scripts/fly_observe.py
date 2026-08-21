#!/usr/bin/env python3
"""Read-only Fly.io log and metrics queries for UNPKG operations."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


UTC = dt.timezone.utc
APP_ALIASES = {
    "prod": "unpkg",
    "production": "unpkg",
    "staging": "unpkg-staging",
}


class QueryError(RuntimeError):
    pass


def resolve_app(value: str) -> str:
    return APP_ALIASES.get(value.lower(), value)


def parse_instant(value: str, *, relative_to: dt.datetime | None = None) -> dt.datetime:
    value = value.strip()
    if value == "now":
        return dt.datetime.now(UTC)
    duration = re.fullmatch(r"(\d+)([smhdw])", value)
    if duration:
        if relative_to is None:
            relative_to = dt.datetime.now(UTC)
        seconds = int(duration.group(1)) * {
            "s": 1,
            "m": 60,
            "h": 3600,
            "d": 86400,
            "w": 604800,
        }[duration.group(2)]
        return relative_to - dt.timedelta(seconds=seconds)
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise argparse.ArgumentTypeError(
            f"invalid time {value!r}; use RFC3339 or a duration such as 30m"
        ) from error
    if parsed.tzinfo is None:
        raise argparse.ArgumentTypeError("absolute timestamps must include a timezone")
    return parsed.astimezone(UTC)


def time_window(args: argparse.Namespace) -> tuple[dt.datetime, dt.datetime]:
    end = parse_instant(args.until)
    start = parse_instant(args.since, relative_to=end)
    if start >= end:
        raise QueryError("--since must resolve before --until")
    return start, end


def rfc3339(value: dt.datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def read_fly_token() -> str | None:
    token = os.environ.get("FLY_API_TOKEN")
    if token:
        return token.strip()
    if not shutil.which("fly"):
        return None
    result = subprocess.run(
        ["fly", "auth", "token", "--quiet"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def authorization_value(token: str) -> str:
    token = token.strip()
    if token.lower().startswith(("bearer ", "flyv1 ")):
        return token
    first = token.split(",", 1)[0]
    if first.startswith(("fm1r_", "fm2_")):
        return f"FlyV1 {token}"
    return f"Bearer {token}"


def grafana_headers() -> dict[str, str]:
    headers = {"Accept": "application/json"}
    token = os.environ.get("FLY_GRAFANA_TOKEN", "").strip()
    cookie = os.environ.get("FLY_GRAFANA_COOKIE", "").strip()
    if token:
        headers["Authorization"] = authorization_value(token)
    elif cookie:
        headers["Cookie"] = cookie
    else:
        raise QueryError(
            "Grafana authentication missing; set FLY_GRAFANA_TOKEN or FLY_GRAFANA_COOKIE"
        )
    return headers


def request_json(url: str, headers: dict[str, str]) -> Any:
    request = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        body = error.read(1000).decode("utf-8", "replace")
        raise QueryError(f"HTTP {error.code} from {url}: {body}") from error
    except urllib.error.URLError as error:
        raise QueryError(f"request failed for {url}: {error.reason}") from error


def request_text(url: str, headers: dict[str, str]) -> str:
    request = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        body = error.read(1000).decode("utf-8", "replace")
        raise QueryError(f"HTTP {error.code} from {url}: {body}") from error
    except urllib.error.URLError as error:
        raise QueryError(f"request failed for {url}: {error.reason}") from error


def grafana_datasources(base_url: str) -> list[dict[str, Any]]:
    value = request_json(f"{base_url.rstrip('/')}/api/datasources", grafana_headers())
    if not isinstance(value, list):
        raise QueryError("Grafana returned an unexpected datasource response")
    return [item for item in value if isinstance(item, dict)]


def choose_datasource(
    datasources: list[dict[str, Any]], kind: str, explicit_uid: str | None
) -> dict[str, Any]:
    if explicit_uid:
        matches = [item for item in datasources if item.get("uid") == explicit_uid]
    elif kind == "logs":
        matches = [
            item
            for item in datasources
            if item.get("type") == "victoriametrics-logs-datasource"
        ]
    else:
        matches = [item for item in datasources if item.get("type") == "prometheus"]
    if not matches:
        raise QueryError(f"no {kind} datasource found in the active Grafana organization")
    if len(matches) == 1:
        return matches[0]
    preferred = [
        item
        for item in matches
        if "fly" in str(item.get("name", "")).lower() or item.get("isDefault")
    ]
    if len(preferred) == 1:
        return preferred[0]
    choices = ", ".join(f"{item.get('name')} ({item.get('uid')})" for item in matches)
    raise QueryError(f"multiple {kind} datasources found; pass --datasource-uid: {choices}")


def nested_value(entry: dict[str, Any], dotted: str) -> Any:
    if dotted in entry:
        return entry[dotted]
    value: Any = entry
    for part in dotted.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def entry_timestamp(entry: dict[str, Any]) -> str:
    return str(entry.get("_time") or entry.get("timestamp") or entry.get("Timestamp") or "")


def print_entries(entries: list[dict[str, Any]], as_json: bool) -> None:
    entries.sort(key=entry_timestamp)
    for entry in entries:
        if as_json:
            print(json.dumps(entry, separators=(",", ":"), sort_keys=True))
            continue
        timestamp = entry_timestamp(entry)
        region = nested_value(entry, "fly.region") or entry.get("region") or entry.get("Region") or "-"
        machine = (
            nested_value(entry, "fly.app.instance")
            or entry.get("instance")
            or entry.get("Instance")
            or "-"
        )
        level = nested_value(entry, "log.level") or entry.get("level") or entry.get("Level") or "-"
        message = entry.get("message") or entry.get("Message") or nested_value(entry, "error.message") or ""
        print(f"{timestamp} {region} {machine} [{level}] {message}")


def quote_logsql(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def compose_logsql(args: argparse.Namespace) -> str:
    filters = [f'fly.app.name:="{quote_logsql(resolve_app(args.app))}"']
    if args.region:
        filters.append(f'fly.region:="{quote_logsql(args.region)}"')
    if args.machine:
        filters.append(f'fly.app.instance:="{quote_logsql(args.machine)}"')
    if args.query and args.query.strip() != "*":
        filters.append(f"({args.query.strip()})")
    return " AND ".join(filters)


def command_search(args: argparse.Namespace) -> None:
    start, end = time_window(args)
    query = compose_logsql(args)
    if args.dry_run:
        print(
            json.dumps(
                {
                    "app": resolve_app(args.app),
                    "start": rfc3339(start),
                    "end": rfc3339(end),
                    "query": query,
                    "limit": args.limit,
                },
                indent=2,
            )
        )
        return
    datasources = grafana_datasources(args.grafana_url)
    datasource = choose_datasource(datasources, "logs", args.datasource_uid)
    uid = urllib.parse.quote(str(datasource["uid"]), safe="")
    params = urllib.parse.urlencode(
        {
            "query": query,
            "start": rfc3339(start),
            "end": rfc3339(end),
            "limit": args.limit,
        }
    )
    url = f"{args.grafana_url.rstrip('/')}/api/datasources/proxy/uid/{uid}/select/logsql/query?{params}"
    body = request_text(url, grafana_headers())
    entries: list[dict[str, Any]] = []
    for line in body.splitlines():
        if line.strip():
            value = json.loads(line)
            if isinstance(value, dict):
                entries.append(value)
    print_entries(entries, args.json)
    if len(entries) >= args.limit:
        print(f"warning: result reached --limit {args.limit}; treat as truncated", file=sys.stderr)
    print(f"matched {len(entries)} log entries", file=sys.stderr)


def fly_log_entries(payload: Any) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    if not isinstance(payload, dict):
        return result
    for item in payload.get("data", []):
        if isinstance(item, dict) and isinstance(item.get("attributes"), dict):
            result.append(item["attributes"])
    return result


def command_buffer(args: argparse.Namespace) -> None:
    start, end = time_window(args)
    token = read_fly_token()
    if not token:
        raise QueryError("Fly authentication missing; run fly auth login or set FLY_API_TOKEN")
    pattern = re.compile(args.contains, re.IGNORECASE) if args.contains else None
    app = resolve_app(args.app)
    next_token = str(int(start.timestamp() * 1_000_000_000))
    headers = {"Accept": "application/json", "Authorization": authorization_value(token)}
    matches: list[dict[str, Any]] = []
    pages = 0
    complete = False
    while pages < args.max_pages and len(matches) < args.limit:
        params: dict[str, Any] = {"next_token": next_token}
        if args.region:
            params["region"] = args.region
        if args.machine:
            params["instance"] = args.machine
        url = f"https://api.fly.io/api/v1/apps/{urllib.parse.quote(app, safe='')}/logs?{urllib.parse.urlencode(params)}"
        payload = request_json(url, headers)
        pages += 1
        entries = fly_log_entries(payload)
        if not entries:
            complete = True
            break
        reached_end = False
        for entry in entries:
            raw_timestamp = entry.get("timestamp") or entry.get("Timestamp")
            if not raw_timestamp:
                continue
            timestamp = parse_instant(str(raw_timestamp))
            if timestamp >= end:
                reached_end = True
                continue
            haystack = json.dumps(entry, sort_keys=True)
            if pattern is None or pattern.search(haystack):
                matches.append(entry)
                if len(matches) >= args.limit:
                    break
        meta = payload.get("meta", {}) if isinstance(payload, dict) else {}
        new_token = str(meta.get("next_token") or "")
        if reached_end or not new_token or new_token == next_token:
            complete = reached_end or not new_token
            break
        next_token = new_token
    print_entries(matches, args.json)
    if not complete:
        print(
            f"warning: incomplete buffer scan after {pages} pages or {len(matches)} matches; narrow the interval or use Grafana search",
            file=sys.stderr,
        )
    print(f"matched {len(matches)} log entries across {pages} page(s)", file=sys.stderr)


def command_metrics(args: argparse.Namespace) -> None:
    start, end = time_window(args)
    app = resolve_app(args.app)
    if "$APP" not in args.query and not re.search(r"\bapp\s*=~?", args.query):
        raise QueryError(
            "metrics query must scope the app with an app label or the $APP placeholder"
        )
    query = args.query.replace("$APP", app)
    params = {
        "query": query,
        "start": f"{start.timestamp():.6f}",
        "end": f"{end.timestamp():.6f}",
        "step": args.step,
    }
    if args.dry_run:
        print(
            json.dumps(
                {
                    "app": app,
                    "start": rfc3339(start),
                    "end": rfc3339(end),
                    "step": args.step,
                    "query": query,
                    "transport": "fly" if args.org else "grafana",
                },
                indent=2,
            )
        )
        return
    if args.org:
        token = read_fly_token()
        if not token:
            raise QueryError("Fly authentication missing; run fly auth login or set FLY_API_TOKEN")
        url = f"https://api.fly.io/prometheus/{urllib.parse.quote(args.org, safe='')}/api/v1/query_range?{urllib.parse.urlencode(params)}"
        payload = request_json(
            url,
            {"Accept": "application/json", "Authorization": authorization_value(token)},
        )
    else:
        datasources = grafana_datasources(args.grafana_url)
        datasource = choose_datasource(datasources, "metrics", args.datasource_uid)
        uid = urllib.parse.quote(str(datasource["uid"]), safe="")
        url = f"{args.grafana_url.rstrip('/')}/api/datasources/proxy/uid/{uid}/api/v1/query_range?{urllib.parse.urlencode(params)}"
        payload = request_json(url, grafana_headers())
    print(json.dumps(payload, indent=2, sort_keys=True))


def command_doctor(args: argparse.Namespace) -> None:
    checks: dict[str, Any] = {
        "fly_cli": bool(shutil.which("fly")),
        "fly_authenticated": bool(read_fly_token()),
        "grafana_credential_present": bool(
            os.environ.get("FLY_GRAFANA_TOKEN") or os.environ.get("FLY_GRAFANA_COOKIE")
        ),
    }
    if checks["grafana_credential_present"]:
        try:
            datasources = grafana_datasources(args.grafana_url)
            checks["grafana_authenticated"] = True
            checks["datasources"] = [
                {
                    "name": item.get("name"),
                    "type": item.get("type"),
                    "uid": item.get("uid"),
                }
                for item in datasources
            ]
        except QueryError as error:
            checks["grafana_authenticated"] = False
            checks["grafana_error"] = str(error)
    print(json.dumps(checks, indent=2, sort_keys=True))


def add_window_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--since", default="1h", help="duration or RFC3339 start (default: 1h)")
    parser.add_argument("--until", default="now", help="RFC3339 end (default: now)")


def add_app_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--app", default="production", help="production, staging, or exact Fly app")
    parser.add_argument("--region")
    parser.add_argument("--machine")


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("value must be at least 1")
    return parsed


def search_limit(value: str) -> int:
    parsed = positive_int(value)
    if parsed > 10000:
        raise argparse.ArgumentTypeError("value must be at most 10000")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    doctor = subparsers.add_parser("doctor", help="check read-only API access")
    doctor.add_argument("--grafana-url", default="https://fly-metrics.net")
    doctor.set_defaults(func=command_doctor)

    search = subparsers.add_parser("search", help="server-side LogsQL search through Grafana")
    add_app_arguments(search)
    add_window_arguments(search)
    search.add_argument("--query", default="*", help="LogsQL appended to the exact app filter")
    search.add_argument("--limit", type=search_limit, default=500)
    search.add_argument("--datasource-uid")
    search.add_argument("--grafana-url", default="https://fly-metrics.net")
    search.add_argument("--json", action="store_true")
    search.add_argument("--dry-run", action="store_true")
    search.set_defaults(func=command_search)

    buffer = subparsers.add_parser("buffer", help="bounded direct Fly logs API fallback")
    add_app_arguments(buffer)
    add_window_arguments(buffer)
    buffer.add_argument("--contains", help="case-insensitive Python regular expression")
    buffer.add_argument("--limit", type=positive_int, default=500)
    buffer.add_argument("--max-pages", type=positive_int, default=50)
    buffer.add_argument("--json", action="store_true")
    buffer.set_defaults(func=command_buffer)

    metrics = subparsers.add_parser("metrics", help="MetricsQL range query through Grafana or Fly")
    metrics.add_argument("--app", default="production", help="available as $APP in --query")
    add_window_arguments(metrics)
    metrics.add_argument("--query", required=True, help="MetricsQL/PromQL; $APP expands to the Fly app")
    metrics.add_argument("--step", default="60s")
    metrics.add_argument(
        "--org",
        default=os.environ.get("FLY_ORG"),
        help="use Fly API for this org instead of Grafana",
    )
    metrics.add_argument("--datasource-uid")
    metrics.add_argument("--grafana-url", default="https://fly-metrics.net")
    metrics.add_argument("--dry-run", action="store_true")
    metrics.set_defaults(func=command_metrics)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        args.func(args)
    except (QueryError, json.JSONDecodeError, argparse.ArgumentTypeError, re.error) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
