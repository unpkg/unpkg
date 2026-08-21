#!/usr/bin/env python3
"""Regression tests for the UNPKG Cloudflare observability helper."""

from __future__ import annotations

import contextlib
import importlib.util
import ipaddress
import io
import json
import pathlib
import re
import unittest
from unittest import mock


SCRIPT = pathlib.Path(__file__).with_name("cf_observe.py")
SPEC = importlib.util.spec_from_file_location("cf_observe", SCRIPT)
assert SPEC and SPEC.loader
cf_observe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cf_observe)


def applied_run(filters: list[dict[str, object]], events: list[dict[str, object]] | None = None):
    return {
        "run": {
            "status": "COMPLETED",
            "timeframe": {"from": 1, "to": 2},
            "query": {"parameters": {"filterCombination": "and", "filters": filters}},
        },
        "statistics": {"abr_level": 1},
        "events": {"count": len(events or []), "events": events or []},
    }


class HelperTests(unittest.TestCase):
    def setUp(self) -> None:
        self.parser = cf_observe.build_parser()

    def test_production_scope_uses_exact_or_group(self) -> None:
        args = self.parser.parse_args(["events", "--service", "production"])
        service_filter = cf_observe.build_filters(args)[0]
        self.assertEqual(service_filter["kind"], "group")
        self.assertEqual(service_filter["filterCombination"], "or")
        self.assertEqual(
            {item["value"] for item in service_filter["filters"]},
            set(cf_observe.PRODUCTION_SERVICES),
        )

    def test_filter_validation_and_literal_hyphen(self) -> None:
        args = self.parser.parse_args(
            [
                "events",
                "--service",
                "www",
                "--filter",
                "$metadata.message",
                "eq",
                "string",
                "-",
            ]
        )
        self.assertEqual(cf_observe.build_filters(args)[1]["value"], "-")
        args.filter = [["field", "not-an-operation", "string", "value"]]
        with self.assertRaises(cf_observe.QueryError):
            cf_observe.build_filters(args)
        args.filter = [["field", "eq", "nonsense", "value"]]
        with self.assertRaises(cf_observe.QueryError):
            cf_observe.build_filters(args)

    def test_unknown_service_fails_closed(self) -> None:
        with self.assertRaises(cf_observe.QueryError):
            cf_observe.resolve_services(["unrelated-worker"])

    def test_retention_and_future_bounds(self) -> None:
        args = self.parser.parse_args(["events", "--since", "30d"])
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            window = cf_observe.time_window(args)
        self.assertIsNotNone(window.warning)
        self.assertLessEqual(window.end - window.start, cf_observe.MAX_RETENTION)

        future = cf_observe.dt.datetime.now(cf_observe.UTC) + cf_observe.dt.timedelta(days=1)
        args = self.parser.parse_args(
            ["events", "--until", future.isoformat(), "--since", "1h"]
        )
        with self.assertRaises(cf_observe.QueryError):
            cf_observe.time_window(args)

    def test_query_result_requires_exact_service_conjunct(self) -> None:
        leaf = {
            "kind": "filter",
            "key": "$metadata.service",
            "operation": "eq",
            "type": "string",
            "value": "unpkg-www",
        }
        result = applied_run([leaf])
        self.assertIs(
            cf_observe.validate_query_result(result, expected_services=["unpkg-www"]),
            result,
        )

        result["run"]["query"]["parameters"]["filterCombination"] = "or"
        with self.assertRaises(cf_observe.QueryError):
            cf_observe.validate_query_result(result, expected_services=["unpkg-www"])

        production_filter = cf_observe.build_service_filter(
            list(cf_observe.PRODUCTION_SERVICES)
        )
        for item in production_filter["filters"]:
            item["kind"] = "filter"
        production = applied_run([production_filter])
        self.assertIs(
            cf_observe.validate_query_result(
                production,
                expected_services=list(cf_observe.PRODUCTION_SERVICES),
            ),
            production,
        )

        result["run"]["query"]["parameters"]["filterCombination"] = "and"
        result["run"]["query"]["parameters"]["filters"].append(
            {
                "key": "$metadata.service",
                "operation": "eq",
                "type": "string",
                "value": "unpkg-app",
            }
        )
        with self.assertRaises(cf_observe.QueryError):
            cf_observe.validate_query_result(result, expected_services=["unpkg-www"])

    def test_query_result_requires_completed_effective_run(self) -> None:
        invalid = [
            {},
            {"run": {}},
            {"run": {"status": "STARTED"}},
            {"run": {"status": "COMPLETED", "timeframe": {"from": 2, "to": 1}}},
        ]
        for result in invalid:
            with self.subTest(result=result), self.assertRaises(cf_observe.QueryError):
                cf_observe.validate_query_result(result)

    def test_plain_event_preserves_status_zero_and_escapes_controls(self) -> None:
        event = {
            "timestamp": 1,
            "$metadata": {
                "service": "unpkg-app",
                "level": "info",
                "message": "line\tbreak\u202e",
            },
            "$workers": {"event": {"response": {"status": 0}}},
        }
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            cf_observe.print_event(event)
        rendered = output.getvalue()
        self.assertIn("\t0\t", rendered)
        self.assertNotIn(chr(0x202E), rendered)
        self.assertIn("\\u202e", rendered)

    def test_event_pagination_uses_raw_page_cursor_and_deduplicates(self) -> None:
        service_filter = {
            "key": "$metadata.service",
            "operation": "eq",
            "type": "string",
            "value": "unpkg-www",
        }
        page_one = applied_run(
            [service_filter],
            [
                {"timestamp": 1, "$metadata": {"id": "a", "service": "unpkg-www"}},
                {"timestamp": 2, "$metadata": {"id": "b", "service": "unpkg-www"}},
            ],
        )
        page_two = applied_run(
            [service_filter],
            [
                {"timestamp": 2, "$metadata": {"id": "b", "service": "unpkg-www"}},
                {"timestamp": 3, "$metadata": {"id": "c", "service": "unpkg-www"}},
            ],
        )
        page_one["events"]["count"] = 3
        page_two["events"]["count"] = 3
        responses = iter((page_one, page_two))
        bodies: list[dict[str, object]] = []

        def query(_account, _endpoint, _headers, body):
            bodies.append(json.loads(json.dumps(body)))
            return next(responses)

        args = self.parser.parse_args(
            ["events", "--service", "www", "--limit", "2", "--pages", "2", "--json"]
        )
        output = io.StringIO()
        with (
            mock.patch.object(
                cf_observe,
                "authentication_headers",
                return_value=({"Authorization": "synthetic"}, "test auth"),
            ),
            mock.patch.object(cf_observe, "resolve_account_id", return_value=("a" * 32, None)),
            mock.patch.object(cf_observe, "telemetry_request", side_effect=query),
            contextlib.redirect_stdout(output),
        ):
            cf_observe.command_events(args)

        rendered = json.loads(output.getvalue())
        self.assertEqual(bodies[1]["offset"], "b")
        self.assertEqual(rendered["returned"], 3)
        self.assertIsNone(rendered["nextCursor"])
        self.assertEqual(len(rendered["effectiveRuns"]), 2)

    def test_raw_query_scope_depth_limits_and_timeframe(self) -> None:
        body = {
            "timeframe": {"from": 1, "to": 2},
            "parameters": {
                "filterCombination": "or",
                "filters": [
                    {"key": "$metadata.level", "operation": "eq", "type": "string", "value": "error"}
                ],
            },
            "limit": 200,
        }
        cf_observe.validate_query_limits(body)
        cf_observe.scope_raw_query(body, ["unpkg-www"])
        self.assertEqual(body["parameters"]["filterCombination"], "and")
        self.assertLessEqual(
            cf_observe.max_filter_depth(body["parameters"]["filters"]),
            cf_observe.MAX_FILTER_DEPTH,
        )
        body["limit"] = cf_observe.MAX_QUERY_LIMIT + 1
        with self.assertRaises(cf_observe.QueryError):
            cf_observe.validate_query_limits(body)

        now_ms = cf_observe.epoch_ms(cf_observe.dt.datetime.now(cf_observe.UTC))
        future = {"timeframe": {"from": now_ms, "to": now_ms + 86_400_000}}
        with self.assertRaises(cf_observe.QueryError):
            cf_observe.normalize_raw_timeframe(future)

    def test_transient_errors_retry_but_auth_errors_do_not(self) -> None:
        transient = cf_observe.urllib.error.HTTPError(
            "https://api.invalid",
            503,
            "unavailable",
            {"Retry-After": "0"},
            io.BytesIO(json.dumps({"errors": [{"code": 1}]}).encode()),
        )
        success = io.BytesIO(json.dumps({"success": True, "result": {"ok": True}}).encode())
        with (
            mock.patch.object(
                cf_observe.urllib.request, "urlopen", side_effect=[transient, success]
            ) as urlopen,
            mock.patch.object(cf_observe.time, "sleep"),
            mock.patch.object(cf_observe.random, "uniform", return_value=0),
        ):
            self.assertEqual(cf_observe.api_request("GET", "/test", {}), {"ok": True})
        self.assertEqual(urlopen.call_count, 2)

        unauthorized = cf_observe.urllib.error.HTTPError(
            "https://api.invalid",
            401,
            "unauthorized",
            {},
            io.BytesIO(json.dumps({"errors": [{"code": 1000}]}).encode()),
        )
        with mock.patch.object(
            cf_observe.urllib.request, "urlopen", side_effect=unauthorized
        ) as urlopen:
            with self.assertRaises(cf_observe.QueryError):
                cf_observe.api_request("GET", "/test", {})
        self.assertEqual(urlopen.call_count, 1)

    def test_skill_source_contains_no_literal_pii_or_credentials(self) -> None:
        skill_root = SCRIPT.parents[1]
        text_parts = []
        for path in skill_root.rglob("*"):
            if not path.is_file() or "__pycache__" in path.parts:
                continue
            try:
                text_parts.append(path.read_text(encoding="utf-8"))
            except UnicodeDecodeError:
                continue
        content = "\n".join(text_parts)
        patterns = (
            re.compile(r"(?i)[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}"),
            re.compile(r"(?i)bearer\s+[a-z0-9._-]{12,}"),
            re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
            re.compile(r"(?i)\b[a-f0-9]{32}\b"),
            re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"),
            re.compile(r"\+\d(?:[\d .()-]*\d){7,}"),
            re.compile(
                r"(?i)\b(?:api[_-]?key|access[_-]?token|token|secret|password)"
                r"\s*[:=]\s*['\"][^'\"]{8,}['\"]"
            ),
            re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
        )
        for pattern in patterns:
            with self.subTest(pattern=pattern.pattern):
                self.assertIsNone(pattern.search(content))

        ipv6_candidates = re.findall(
            r"(?i)(?<![0-9a-f:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![0-9a-f:])",
            content,
        )
        for candidate in ipv6_candidates:
            try:
                address = ipaddress.ip_address(candidate)
            except ValueError:
                continue
            with self.subTest(ipv6=candidate):
                self.assertNotEqual(address.version, 6)


if __name__ == "__main__":
    unittest.main()
