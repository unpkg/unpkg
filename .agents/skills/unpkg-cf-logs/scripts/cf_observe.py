#!/usr/bin/env python3
"""Read-only Cloudflare Workers Observability queries for UNPKG operations."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any


UTC = dt.timezone.utc
API_BASE = "https://api.cloudflare.com/client/v4"
PRODUCTION_SERVICES = ("unpkg-www", "unpkg-app", "unpkg-esm")
STAGING_SERVICES = tuple(f"{name}-staging" for name in PRODUCTION_SERVICES)
SERVICE_ALIASES = {
    "prod": PRODUCTION_SERVICES,
    "production": PRODUCTION_SERVICES,
    "staging": STAGING_SERVICES,
    "all": PRODUCTION_SERVICES + STAGING_SERVICES,
    "www": ("unpkg-www",),
    "app": ("unpkg-app",),
    "esm": ("unpkg-esm",),
    "www-staging": ("unpkg-www-staging",),
    "app-staging": ("unpkg-app-staging",),
    "esm-staging": ("unpkg-esm-staging",),
}
VALID_TYPES = ("string", "number", "boolean")
EXISTENCE_OPERATIONS = {"exists", "is_null", "EXISTS", "DOES_NOT_EXIST"}


class QueryError(RuntimeError):
    pass


def parse_instant(value: str, *, relative_to: dt.datetime | None = None) -> dt.datetime:
    value = value.strip()
    if value == "now":
        return dt.datetime.now(UTC)
    import re

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


def epoch_ms(value: dt.datetime) -> int:
    return int(value.timestamp() * 1000)


def iso_time(value: int | float | str | None) -> str:
    if value is None:
        return "-"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    if number > 10_000_000_000:
        number /= 1000
    return dt.datetime.fromtimestamp(number, UTC).isoformat().replace("+00:00", "Z")


def wrangler_executable() -> str | None:
    direct = shutil.which("wrangler")
    if direct:
        return direct
    script = pathlib.Path(__file__).resolve()
    for parent in script.parents:
        candidates = (
            parent / "node_modules/.bin/wrangler",
            parent / "packages/unpkg-www/node_modules/.bin/wrangler",
        )
        for candidate in candidates:
            if candidate.is_file() and os.access(candidate, os.X_OK):
                return str(candidate)
    return None


def wrangler_json(*arguments: str) -> Any | None:
    executable = wrangler_executable()
    if executable is None:
        return None
    try:
        result = subprocess.run(
            [executable, *arguments],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        return None
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


def authentication_headers() -> tuple[dict[str, str], str]:
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    api_key = os.environ.get("CLOUDFLARE_API_KEY", "").strip()
    email = os.environ.get("CLOUDFLARE_EMAIL", "").strip()
    if token:
        return {"Authorization": f"Bearer {token}"}, "CLOUDFLARE_API_TOKEN"
    if api_key and email:
        return {"X-Auth-Key": api_key, "X-Auth-Email": email}, "API key and email"
    credentials = wrangler_json("auth", "token", "--json")
    if isinstance(credentials, dict):
        kind = credentials.get("type")
        if kind in {"api_token", "oauth"} and credentials.get("token"):
            return {
                "Authorization": f"Bearer {str(credentials['token']).strip()}"
            }, f"Wrangler {kind}"
        if kind == "api_key" and credentials.get("key") and credentials.get("email"):
            return {
                "X-Auth-Key": str(credentials["key"]).strip(),
                "X-Auth-Email": str(credentials["email"]).strip(),
            }, "Wrangler API key"
    raise QueryError(
        "Cloudflare authentication missing; set CLOUDFLARE_API_TOKEN, set the legacy "
        "CLOUDFLARE_API_KEY and CLOUDFLARE_EMAIL pair, or log in with a recent Wrangler"
    )


def api_request(
    method: str,
    path: str,
    headers: dict[str, str],
    body: dict[str, Any] | None = None,
) -> Any:
    request_headers = {
        **headers,
        "Accept": "application/json",
        "User-Agent": "unpkg-cf-logs/1",
    }
    data = None
    if body is not None:
        request_headers["Content-Type"] = "application/json"
        data = json.dumps(body, separators=(",", ":")).encode()
    request = urllib.request.Request(
        f"{API_BASE}{path}", headers=request_headers, data=data, method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            envelope = json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read(2000).decode("utf-8", "replace")
        raise QueryError(f"Cloudflare API returned HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise QueryError(f"Cloudflare API request failed: {error.reason}") from error
    if not isinstance(envelope, dict):
        raise QueryError("Cloudflare API returned an unexpected response")
    if envelope.get("success") is False:
        raise QueryError(f"Cloudflare API query failed: {json.dumps(envelope.get('errors'))}")
    return envelope.get("result")


def accounts_from_wrangler(value: Any) -> list[tuple[str, str]]:
    found: dict[str, str] = {}

    def walk(node: Any, parent_key: str = "") -> None:
        if isinstance(node, list):
            for item in node:
                walk(item, parent_key)
            return
        if not isinstance(node, dict):
            return
        identifier = node.get("id") or node.get("account_id") or node.get("accountId")
        name = node.get("name") or node.get("account_name") or node.get("accountName")
        if parent_key.lower() in {"account", "accounts", "memberships"} and identifier:
            found[str(identifier)] = str(name or identifier)
        for key, child in node.items():
            walk(child, str(key))

    walk(value)
    return sorted(found.items(), key=lambda item: item[1].lower())


def resolve_account_id(
    explicit: str | None, headers: dict[str, str]
) -> tuple[str, str | None]:
    if explicit:
        return explicit, None
    environment_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
    if environment_id:
        return environment_id, os.environ.get("CLOUDFLARE_ACCOUNT_NAME")
    accounts = accounts_from_wrangler(wrangler_json("whoami", "--json"))
    if not accounts:
        result = api_request("GET", "/accounts?per_page=50", headers)
        if isinstance(result, list):
            accounts = [
                (str(item["id"]), str(item.get("name") or item["id"]))
                for item in result
                if isinstance(item, dict) and item.get("id")
            ]
    requested_name = os.environ.get("CLOUDFLARE_ACCOUNT_NAME", "").strip()
    if requested_name:
        matches = [item for item in accounts if item[1] == requested_name]
        if len(matches) == 1:
            return matches[0]
        raise QueryError(f"Cloudflare account {requested_name!r} was not uniquely found")
    if len(accounts) == 1:
        return accounts[0]
    if not accounts:
        raise QueryError(
            "could not discover a Cloudflare account; set CLOUDFLARE_ACCOUNT_ID or pass --account-id"
        )
    choices = ", ".join(f"{name} ({identifier})" for identifier, name in accounts)
    raise QueryError(
        "multiple Cloudflare accounts are available; set CLOUDFLARE_ACCOUNT_ID or pass "
        f"--account-id. Available accounts: {choices}"
    )


def resolve_services(values: list[str] | None) -> list[str]:
    requested = values or ["production"]
    resolved: list[str] = []
    for value in requested:
        for part in value.split(","):
            name = part.strip()
            services = SERVICE_ALIASES.get(name.lower(), (name,))
            for service in services:
                if service and service not in resolved:
                    resolved.append(service)
    if not resolved:
        raise QueryError("at least one Worker service is required")
    return resolved


def coerce_value(value: str, value_type: str) -> str | int | float | bool:
    if value_type == "string":
        return value
    if value_type == "boolean":
        lowered = value.lower()
        if lowered not in {"true", "false"}:
            raise QueryError(f"boolean filter value must be true or false, got {value!r}")
        return lowered == "true"
    try:
        number = float(value)
    except ValueError as error:
        raise QueryError(f"numeric filter value must be a number, got {value!r}") from error
    return int(number) if number.is_integer() else number


def build_filters(args: argparse.Namespace) -> list[dict[str, Any]]:
    services = resolve_services(args.service)
    service_filters = [
        {
            "key": "$metadata.service",
            "operation": "eq",
            "type": "string",
            "value": service,
        }
        for service in services
    ]
    service_filter: dict[str, Any] = (
        service_filters[0]
        if len(service_filters) == 1
        else {
            "kind": "group",
            "filterCombination": "or",
            "filters": service_filters,
        }
    )
    filters = [service_filter]
    for key, operation, value_type, value in args.filter or []:
        item: dict[str, Any] = {
            "key": key,
            "operation": operation,
            "type": value_type,
        }
        if operation not in EXISTENCE_OPERATIONS and value != "-":
            item["value"] = coerce_value(value, value_type)
        filters.append(item)
    return filters


def query_parameters(args: argparse.Namespace) -> dict[str, Any]:
    parameters: dict[str, Any] = {
        "filterCombination": "and",
        "filters": build_filters(args),
    }
    if args.dataset:
        parameters["datasets"] = args.dataset
    if args.search is not None:
        parameters["needle"] = {
            "value": args.search,
            "isRegex": args.regex,
            "matchCase": args.case_sensitive,
        }
    return parameters


def query_body(
    args: argparse.Namespace, view: str, *, limit: int | None = None
) -> tuple[dict[str, Any], tuple[dt.datetime, dt.datetime]]:
    start, end = time_window(args)
    body: dict[str, Any] = {
        "queryId": f"unpkg-cf-logs-{uuid.uuid4()}",
        "timeframe": {"from": epoch_ms(start), "to": epoch_ms(end)},
        "view": view,
        "dry": True,
        "parameters": query_parameters(args),
    }
    if limit is not None:
        body["limit"] = limit
    return body, (start, end)


def telemetry_request(
    account_id: str,
    endpoint: str,
    headers: dict[str, str],
    body: dict[str, Any],
) -> Any:
    encoded = urllib.parse.quote(account_id, safe="")
    return api_request(
        "POST", f"/accounts/{encoded}/workers/observability/telemetry/{endpoint}", headers, body
    )


def event_metadata(event: dict[str, Any]) -> dict[str, Any]:
    value = event.get("$metadata")
    return value if isinstance(value, dict) else {}


def event_message(event: dict[str, Any]) -> str:
    metadata = event_metadata(event)
    value = metadata.get("error") or metadata.get("message") or event.get("source")
    if isinstance(value, (dict, list)):
        return json.dumps(value, separators=(",", ":"), sort_keys=True)
    return str(value or "")


def print_event(event: dict[str, Any]) -> None:
    metadata = event_metadata(event)
    workers = event.get("$workers") if isinstance(event.get("$workers"), dict) else {}
    status = metadata.get("statusCode") or workers.get("outcome") or "-"
    columns = (
        iso_time(event.get("timestamp")),
        metadata.get("service") or workers.get("scriptName") or "-",
        metadata.get("level") or "-",
        status,
        event_message(event).replace("\n", " ")[:1000],
    )
    print("\t".join(str(value) for value in columns))


def command_doctor(args: argparse.Namespace) -> None:
    headers, auth_source = authentication_headers()
    account_id, account_name = resolve_account_id(args.account_id, headers)
    end = dt.datetime.now(UTC)
    start = end - dt.timedelta(hours=24)
    body = {
        "from": epoch_ms(start),
        "to": epoch_ms(end),
        "limit": 1,
    }
    result = telemetry_request(account_id, "keys", headers, body)
    print(f"Authentication: {auth_source}")
    print(f"Account: {account_name or account_id} ({account_id})")
    print("Workers Observability query access: ok")
    print(f"Schema probe results: {len(result) if isinstance(result, list) else 'unknown'}")


def command_keys(args: argparse.Namespace) -> None:
    headers, _ = authentication_headers()
    account_id, _ = resolve_account_id(args.account_id, headers)
    start, end = time_window(args)
    body: dict[str, Any] = {
        "from": epoch_ms(start),
        "to": epoch_ms(end),
        "limit": args.limit,
        "filters": build_filters(args),
    }
    if args.dataset:
        body["datasets"] = args.dataset
    if args.key_needle:
        body["keyNeedle"] = {"value": args.key_needle, "matchCase": False}
    if args.search is not None:
        body["needle"] = {
            "value": args.search,
            "isRegex": args.regex,
            "matchCase": args.case_sensitive,
        }
    print(json.dumps(telemetry_request(account_id, "keys", headers, body), indent=2))


def command_values(args: argparse.Namespace) -> None:
    headers, _ = authentication_headers()
    account_id, _ = resolve_account_id(args.account_id, headers)
    start, end = time_window(args)
    body: dict[str, Any] = {
        "datasets": args.dataset or [],
        "key": args.key,
        "type": args.type,
        "timeframe": {"from": epoch_ms(start), "to": epoch_ms(end)},
        "limit": args.limit,
        "filters": build_filters(args),
    }
    if args.search is not None:
        body["needle"] = {
            "value": args.search,
            "isRegex": args.regex,
            "matchCase": args.case_sensitive,
        }
    print(json.dumps(telemetry_request(account_id, "values", headers, body), indent=2))


def command_events(args: argparse.Namespace) -> None:
    headers, _ = authentication_headers()
    account_id, _ = resolve_account_id(args.account_id, headers)
    body, window = query_body(args, "events", limit=args.limit)
    pages: list[dict[str, Any]] = []
    request_bodies: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    matched: int | None = None
    cursor: str | None = None
    last_page_size = 0
    for _ in range(args.pages):
        if cursor:
            body["offset"] = cursor
            body["offsetDirection"] = "next"
        request_bodies.append(json.loads(json.dumps(body)))
        result = telemetry_request(account_id, "query", headers, body)
        if not isinstance(result, dict):
            raise QueryError("Cloudflare returned an unexpected event query result")
        pages.append(result)
        event_result = result.get("events")
        page_events = event_result.get("events", []) if isinstance(event_result, dict) else []
        page_events = [item for item in page_events if isinstance(item, dict)]
        last_page_size = len(page_events)
        if isinstance(event_result, dict) and isinstance(event_result.get("count"), (int, float)):
            matched = int(event_result["count"])
        events.extend(page_events)
        if last_page_size < args.limit:
            break
        next_cursor = event_metadata(page_events[-1]).get("id") if page_events else None
        if not next_cursor or next_cursor == cursor:
            break
        cursor = str(next_cursor)
    next_cursor = (
        str(event_metadata(events[-1]).get("id"))
        if events and last_page_size == args.limit and event_metadata(events[-1]).get("id")
        else None
    )
    if args.json:
        output = {
            "timeframe": {
                "from": window[0].isoformat().replace("+00:00", "Z"),
                "to": window[1].isoformat().replace("+00:00", "Z"),
            },
            "services": resolve_services(args.service),
            "matched": matched,
            "returned": len(events),
            "pages": len(pages),
            "nextCursor": next_cursor,
            "statistics": [page.get("statistics") for page in pages],
            "requests": request_bodies,
            "events": events,
        }
        print(json.dumps(output, indent=2, sort_keys=True))
    else:
        events.sort(key=lambda item: item.get("timestamp", 0))
        for event in events:
            print_event(event)
        incomplete = (matched is not None and matched > len(events)) or next_cursor is not None
        print(
            f"returned={len(events)} matched={matched if matched is not None else 'unknown'} "
            f"pages={len(pages)} incomplete={'yes' if incomplete else 'no'}",
            file=sys.stderr,
        )


def parse_calculation(value: str) -> dict[str, Any]:
    parts = value.split(":", 3)
    if len(parts) not in {3, 4}:
        raise QueryError(
            f"invalid calculation {value!r}; use OPERATOR:KEY:TYPE[:ALIAS]"
        )
    operator, key, key_type = parts[:3]
    if key_type not in VALID_TYPES:
        raise QueryError(f"invalid calculation type {key_type!r}")
    result: dict[str, Any] = {"operator": operator, "key": key, "keyType": key_type}
    if len(parts) == 4 and parts[3]:
        result["alias"] = parts[3]
    return result


def parse_group_by(value: str) -> dict[str, str]:
    try:
        key, key_type = value.rsplit(":", 1)
    except ValueError as error:
        raise QueryError(f"invalid group {value!r}; use KEY:TYPE") from error
    if key_type not in VALID_TYPES:
        raise QueryError(f"invalid group type {key_type!r}")
    return {"value": key, "type": key_type}


def command_calculate(args: argparse.Namespace) -> None:
    headers, _ = authentication_headers()
    account_id, _ = resolve_account_id(args.account_id, headers)
    body, _ = query_body(args, "calculations", limit=args.limit)
    calculations = [parse_calculation(value) for value in args.calculation or []]
    if args.count is not None:
        count: dict[str, str] = {"operator": "count"}
        if args.count:
            count["alias"] = args.count
        calculations.insert(0, count)
    if not calculations:
        calculations.append({"operator": "count", "alias": "count"})
    body["parameters"]["calculations"] = calculations
    if args.group_by:
        body["parameters"]["groupBys"] = [parse_group_by(value) for value in args.group_by]
    if args.order_by:
        body["parameters"]["orderBy"] = {"value": args.order_by, "order": args.order}
    body["chart"] = args.chart
    body["ignoreSeries"] = not args.chart
    body["chartType"] = "timeseries_and_aggregate" if args.chart else "aggregate"
    print(json.dumps(telemetry_request(account_id, "query", headers, body), indent=2))


def command_query(args: argparse.Namespace) -> None:
    headers, _ = authentication_headers()
    account_id, _ = resolve_account_id(args.account_id, headers)
    if args.file == "-":
        body = json.load(sys.stdin)
    else:
        with open(args.file, encoding="utf-8") as handle:
            body = json.load(handle)
    if not isinstance(body, dict):
        raise QueryError("raw query body must be a JSON object")
    timeframe = body.get("timeframe")
    if not isinstance(timeframe, dict) or "from" not in timeframe or "to" not in timeframe:
        raise QueryError("raw query body must contain timeframe.from and timeframe.to in epoch milliseconds")
    body["dry"] = True
    body.setdefault("queryId", f"unpkg-cf-logs-{uuid.uuid4()}")
    print(json.dumps(telemetry_request(account_id, "query", headers, body), indent=2))


def add_account_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--account-id", help="Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)")


def add_time_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--since", default="1h", help="RFC3339 start or duration before --until")
    parser.add_argument("--until", default="now", help="RFC3339 end (default: now)")


def add_filter_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--service",
        action="append",
        help="production, staging, all, www, app, esm, a staging alias, or exact Worker name",
    )
    parser.add_argument("--dataset", action="append", help="telemetry dataset (repeatable)")
    parser.add_argument(
        "--filter",
        action="append",
        nargs=4,
        metavar=("KEY", "OP", "TYPE", "VALUE"),
        help="typed field filter; use VALUE '-' for an existence operation",
    )
    parser.add_argument("--search", help="full-text search across event fields")
    parser.add_argument("--regex", action="store_true", help="treat --search as an RE2 expression")
    parser.add_argument("--case-sensitive", action="store_true", help="make --search case-sensitive")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Read-only UNPKG Cloudflare Workers log queries and aggregations"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    doctor = subparsers.add_parser("doctor", help="verify authentication, account, and query access")
    add_account_argument(doctor)
    doctor.set_defaults(handler=command_doctor)

    keys = subparsers.add_parser("keys", help="discover indexed telemetry fields")
    add_account_argument(keys)
    add_time_arguments(keys)
    add_filter_arguments(keys)
    keys.add_argument("--key-needle", help="case-insensitive key-name search")
    keys.add_argument("--limit", type=int, default=1000)
    keys.set_defaults(handler=command_keys)

    values = subparsers.add_parser("values", help="discover values for an indexed field")
    add_account_argument(values)
    add_time_arguments(values)
    add_filter_arguments(values)
    values.add_argument("--key", required=True)
    values.add_argument("--type", choices=VALID_TYPES, required=True)
    values.add_argument("--limit", type=int, default=1000)
    values.set_defaults(handler=command_values)

    events = subparsers.add_parser("events", help="search and paginate individual log events")
    add_account_argument(events)
    add_time_arguments(events)
    add_filter_arguments(events)
    events.add_argument("--limit", type=int, default=200, choices=range(1, 2001), metavar="1..2000")
    events.add_argument("--pages", type=int, default=1, choices=range(1, 101), metavar="1..100")
    events.add_argument("--json", action="store_true", help="emit one structured JSON document")
    events.set_defaults(handler=command_events)

    calculate = subparsers.add_parser("calculate", help="run server-side log aggregations")
    add_account_argument(calculate)
    add_time_arguments(calculate)
    add_filter_arguments(calculate)
    calculate.add_argument(
        "--count",
        nargs="?",
        const="count",
        help="add a row count, optionally with an alias",
    )
    calculate.add_argument(
        "--calculation",
        action="append",
        help="OPERATOR:KEY:TYPE[:ALIAS] (repeatable)",
    )
    calculate.add_argument("--group-by", action="append", help="KEY:TYPE (repeatable)")
    calculate.add_argument("--order-by", help="calculation alias/operator for grouped results")
    calculate.add_argument("--order", choices=("asc", "desc"), default="desc")
    calculate.add_argument("--limit", type=int, default=100, choices=range(1, 2001), metavar="1..2000")
    calculate.add_argument("--chart", action="store_true", help="include time-series data")
    calculate.set_defaults(handler=command_calculate)

    raw = subparsers.add_parser("query", help="run an arbitrary dry-run telemetry query body")
    add_account_argument(raw)
    raw.add_argument("--file", required=True, help="JSON request file, or - for stdin")
    raw.set_defaults(handler=command_query)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        args.handler(args)
    except (QueryError, argparse.ArgumentTypeError, json.JSONDecodeError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
