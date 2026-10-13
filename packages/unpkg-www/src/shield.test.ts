import { describe, expect, it, beforeEach } from "bun:test";
import type { ExecutionContext } from "@cloudflare/workers-types";

import fixtures from "../test/fixtures/edge_match_conformance.json";
import type { Env, ShieldKV } from "./env.ts";
import {
  __ageShieldRulesForTests,
  __resetShieldStateForTests,
  buildBlockResponse,
  buildRulesMap,
  evaluateShieldRequest,
  getShieldRules,
  isPackagePath,
  refreshRules,
  type ShieldDeps,
} from "./shield.ts";

const env: Env = {
  APP_ORIGIN: "https://app.unpkg.com",
  ASSETS_ORIGIN: "https://unpkg.com",
  DEV: false,
  ESM_ORIGIN: "https://esm.unpkg.com",
  FILES_ORIGIN: "https://files.unpkg.com",
  MODE: "test",
  ORIGIN: "https://unpkg.com",
};

function makeContext(captured: Promise<unknown>[]): ExecutionContext {
  return { waitUntil(promise: Promise<unknown>) { captured.push(promise); } } as unknown as ExecutionContext;
}

function makeCache(initial?: Response): { cache: Cache; store: Map<string, Response> } {
  const store = new Map<string, Response>();
  if (initial) store.set("https://shield-internal/rules", initial);
  const cache = {
    // Clone like the real Cache API: bodies are single-use.
    async match(request: Request) { return store.has(request.url) ? store.get(request.url)!.clone() : null; },
    async put(request: Request, response: Response) { store.set(request.url, response.clone()); },
    async delete(request: Request) { return store.delete(request.url); },
  } as unknown as Cache;
  return { cache, store };
}

function kvPayload(rules: unknown[], v: number, refresh_s?: unknown): string {
  return JSON.stringify({ schema: 1, v, ts: new Date().toISOString(), rules, refresh_s });
}

function makeKv(values: (string | null | Error)[]): { kv: ShieldKV; gets: string[] } {
  const gets: string[] = [];
  let i = 0;
  const kv: ShieldKV = {
    async get(key: string, type: "text") {
      gets.push(`${key}:${type}`);
      const next = values[Math.min(i++, values.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { kv, gets };
}

function withKv(base: Env, kv: ShieldKV): Env {
  return { ...base, SHIELD_RULES: kv };
}

function decide(rules: unknown[], path: string, search: string, referer: string | null, origin: string | null) {
  const { map } = buildRulesMap(rules);
  const url = new URL(`${path}${search}`, "https://unpkg.com");
  const headers = new Headers();
  if (referer) headers.set("Referer", referer);
  if (origin) headers.set("Origin", origin);
  return evaluateShieldRequest(url, new Request(url, { headers }), map);
}

beforeEach(() => {
  __resetShieldStateForTests();
});

describe("edge-match conformance (shared contract fixtures)", () => {
  for (const testCase of fixtures.cases as Array<{
    name: string;
    rules: unknown[];
    path: string;
    search: string;
    referer: string | null;
    origin: string | null;
    expect: string | null | { block: boolean };
  }>) {
    it(testCase.name, () => {
      const decision = decide(testCase.rules, testCase.path, testCase.search, testCase.referer, testCase.origin);
      const expected = testCase.expect;
      if (expected == null) {
        expect(decision.type).toBe("none");
      } else if (typeof expected === "object") {
        expect(decision.type).toBe("block");
      } else {
        expect(decision.type).toBe("rewrite");
        if (decision.type === "rewrite") expect(decision.location).toBe(expected);
      }
    });
  }
});

describe("isPackagePath fast precheck", () => {
  it("matches package paths only", () => {
    expect(isPackagePath("/chalk@5.0.1/index.js")).toBe(true);
    expect(isPackagePath("/@solana/web3.js@1.95.5/lib/x.js")).toBe(true);
    expect(isPackagePath("/")).toBe(false);
    expect(isPackagePath("/_health")).toBe(false);
    expect(isPackagePath("/run")).toBe(false);
    expect(isPackagePath("/index.html")).toBe(false);
  });
});

describe("rule refs", () => {
  it("carries refs from rule to decision for tooling attribution", () => {
    const { map } = buildRulesMap([
      { pkg: "chalk", from: ["5.0.1"], to: "5.0.0", domains: ["nytimes.com"], refs: ["rem-1", "rem-2"] },
    ]);
    const url = new URL("/chalk@5.0.1/index.js", "https://unpkg.com");
    const request = new Request(url, { headers: { Referer: "https://nytimes.com/" } });
    const decision = evaluateShieldRequest(url, request, map);
    expect(decision.type).toBe("rewrite");
    if (decision.type === "rewrite") expect(decision.rule.refs).toEqual(["rem-1", "rem-2"]);
  });
});

describe("block stub", () => {
  it("is a static no-store 403 reflecting only package@version as text", async () => {
    const response = buildBlockResponse("evil-pkg", "9.9.9");
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toContain("evil-pkg@9.9.9");
  });
});

describe("rules fetching and caching", () => {
  const rules = [{ pkg: "chalk", from: ["5.0.1"], to: "5.0.0", domains: ["nytimes.com"] }];

  it("returns null without the KV binding and never reads", async () => {
    const { cache } = makeCache();
    const { kv, gets } = makeKv([kvPayload(rules, 7)]);
    // Even with a KV override in deps, the missing binding disables Shield.
    const deps: ShieldDeps = { cache, kv };
    const captured: Promise<unknown>[] = [];
    expect(await getShieldRules(env, makeContext(captured), deps)).toBeNull();
    expect(gets).toHaveLength(0);
    expect(captured).toHaveLength(0);
  });

  it("cold start returns null and warms the cache in the background", async () => {
    const { cache, store } = makeCache();
    const { kv, gets } = makeKv([kvPayload(rules, 7)]);
    const shEnv = withKv(env, kv);
    // No deps.kv: exercises the env.SHIELD_RULES fallthrough.
    const deps: ShieldDeps = { cache };
    const captured: Promise<unknown>[] = [];
    expect(await getShieldRules(shEnv, makeContext(captured), deps)).toBeNull();
    expect(captured).toHaveLength(1);
    await captured[0];
    expect(gets).toEqual(["shield:edge-rules:v1:text"]);
    expect(store.has("https://shield-internal/rules")).toBe(true);
    // Warmed: the next call serves from memory without reading.
    const state = await getShieldRules(shEnv, makeContext([]), deps);
    expect(state).not.toBeNull();
    expect(state!.get("chalk")).toHaveLength(1);
    expect(gets).toHaveLength(1);
  });

  it("stale memory schedules a background refresh but serves stale rules", async () => {
    const { cache } = makeCache();
    const { kv, gets } = makeKv([kvPayload(rules, 7)]);
    const shEnv = withKv(env, kv);
    const deps: ShieldDeps = { cache, kv };
    await refreshRules(shEnv, deps);
    expect(gets).toHaveLength(1);
    __ageShieldRulesForTests(60_000);
    const captured: Promise<unknown>[] = [];
    const served = await getShieldRules(shEnv, makeContext(captured), deps);
    expect(served).not.toBeNull();
    expect(served!.get("chalk")).toHaveLength(1);
    expect(captured).toHaveLength(1);
    await captured[0];
    expect(gets).toHaveLength(2);
  });

  it("concurrent refreshes collapse into one read (in-flight guard)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { cache } = makeCache();
    const gets: string[] = [];
    const kv: ShieldKV = {
      async get(key: string, type: "text") {
        gets.push(`${key}:${type}`);
        await gate;
        return kvPayload(rules, 7);
      },
    };
    const shEnv = withKv(env, kv);
    const deps: ShieldDeps = { cache, kv };
    const first = refreshRules(shEnv, deps);
    const second = refreshRules(shEnv, deps);
    release();
    await Promise.all([first, second]);
    expect(gets).toHaveLength(1);
  });

  it("failed refreshes do not schedule another attempt until the TTL elapses", async () => {
    // Without this gate, every request past a failed refresh would trigger
    // another KV read — an outage would turn request rate into billed
    // reads. The gate bounds KV reads to ~1/soft-TTL/isolate.
    const { cache } = makeCache();
    const { kv, gets } = makeKv([new Error("kv down")]);
    const shEnv = withKv(env, kv);
    const deps: ShieldDeps = { cache, kv };
    const first: Promise<unknown>[] = [];
    expect(await getShieldRules(shEnv, makeContext(first), deps)).toBeNull();
    expect(first).toHaveLength(1);
    await first[0];
    expect(gets).toHaveLength(1);
    const second: Promise<unknown>[] = [];
    expect(await getShieldRules(shEnv, makeContext(second), deps)).toBeNull();
    expect(second).toHaveLength(0);
    expect(gets).toHaveLength(1);
    __ageShieldRulesForTests(60_000);
    const third: Promise<unknown>[] = [];
    expect(await getShieldRules(shEnv, makeContext(third), deps)).toBeNull();
    expect(third).toHaveLength(1);
  });

  it("a slow stale read never regresses a newer cached entry", async () => {
    const { cache, store } = makeCache(
      new Response(kvPayload(rules, 10), { headers: { "Content-Type": "application/json" } })
    );
    const { kv } = makeKv([kvPayload([], 3)]);
    const shEnv = withKv(env, kv);
    await refreshRules(shEnv, { cache, kv });
    const kept = (await store.get("https://shield-internal/rules")!.json()) as { v: number };
    expect(kept.v).toBe(10);
  });

  it("failed reads fail open and keep serving stale rules", async () => {
    const { cache } = makeCache();
    const good = makeKv([kvPayload(rules, 7)]);
    const shEnv = withKv(env, good.kv);
    await refreshRules(shEnv, { cache, kv: good.kv });
    const bad = makeKv([new Error("kv down")]);
    await refreshRules(shEnv, { cache, kv: bad.kv });
    const served = await getShieldRules(shEnv, makeContext([]), { cache, kv: bad.kv });
    expect(served).not.toBeNull();
    expect(served!.get("chalk")).toHaveLength(1);
  });

  it("newer-schema payloads are ignored, keeping current rules", async () => {
    const { cache } = makeCache();
    const good = makeKv([kvPayload(rules, 7)]);
    const shEnv = withKv(env, good.kv);
    await refreshRules(shEnv, { cache, kv: good.kv });
    const newer = makeKv([JSON.stringify({ schema: 99, v: 8, rules: [] })]);
    await refreshRules(shEnv, { cache, kv: newer.kv });
    const served = await getShieldRules(shEnv, makeContext([]), { cache, kv: newer.kv });
    expect(served!.get("chalk")).toHaveLength(1);
  });
});

describe("KV edge cases", () => {
  const rules = [{ pkg: "chalk", from: ["5.0.1"], to: "5.0.0", domains: ["nytimes.com"] }];

  it("KV null reads as an empty ruleset and does not re-read within the TTL", async () => {
    const { cache } = makeCache();
    const { kv, gets } = makeKv([null]);
    const shEnv = withKv(env, kv);
    const deps: ShieldDeps = { cache, kv };
    await refreshRules(shEnv, deps);
    expect(gets).toHaveLength(1);
    // An empty map is served (fail-open), not null — and the null result
    // is cached: no second KV read (null is billable; an uncached null
    // would re-read per request).
    const served = await getShieldRules(shEnv, makeContext([]), deps);
    expect(served).not.toBeNull();
    expect(served!.size).toBe(0);
    await getShieldRules(shEnv, makeContext([]), deps);
    expect(gets).toHaveLength(1);
  });

  it("corrupt KV values are ignored, keeping stale rules", async () => {
    const { cache } = makeCache();
    const good = makeKv([kvPayload(rules, 7)]);
    const shEnv = withKv(env, good.kv);
    await refreshRules(shEnv, { cache, kv: good.kv });
    const corrupt = makeKv(["{not-json"]);
    await refreshRules(shEnv, { cache, kv: corrupt.kv });
    const served = await getShieldRules(shEnv, makeContext([]), { cache, kv: corrupt.kv });
    expect(served!.get("chalk")).toHaveLength(1);
  });

  it("an older KV version never regresses accepted memory", async () => {
    const { cache } = makeCache();
    // Accept v=10 first.
    const first = makeKv([kvPayload(rules, 10)]);
    const shEnv = withKv(env, first.kv);
    await refreshRules(shEnv, { cache, kv: first.kv });
    // A reordered read hands back v=3 with different content.
    const { kv, gets } = makeKv([kvPayload([], 3)]);
    await refreshRules(shEnv, { cache, kv });
    expect(gets).toHaveLength(1);
    const served = await getShieldRules(shEnv, makeContext([]), { cache, kv });
    expect(served!.get("chalk")).toHaveLength(1);
  });

  it("refresh_s recenters the soft TTL and clamps to 15..600s", async () => {
    // Adopt 300s: a 60s-old snapshot is still fresh (band is 250-350s).
    {
      const { cache } = makeCache();
      const { kv } = makeKv([kvPayload(rules, 7, 300)]);
      const shEnv = withKv(env, kv);
      const deps: ShieldDeps = { cache, kv };
      await refreshRules(shEnv, deps);
      __ageShieldRulesForTests(60_000);
      const captured: Promise<unknown>[] = [];
      await getShieldRules(shEnv, makeContext(captured), deps);
      expect(captured).toHaveLength(0);
    }
    // Upper clamp: 99999s pins to 600s (band 500-700s); 400s-old is fresh.
    __resetShieldStateForTests();
    {
      const { cache } = makeCache();
      const { kv } = makeKv([kvPayload(rules, 7, 99999)]);
      const shEnv = withKv(env, kv);
      const deps: ShieldDeps = { cache, kv };
      await refreshRules(shEnv, deps);
      __ageShieldRulesForTests(400_000);
      const captured: Promise<unknown>[] = [];
      await getShieldRules(shEnv, makeContext(captured), deps);
      expect(captured).toHaveLength(0);
    }
    // Lower clamp: 1s pins to 15s (band 12.5-17.5s); 20s-old refreshes.
    __resetShieldStateForTests();
    {
      const { cache } = makeCache();
      const { kv } = makeKv([kvPayload(rules, 7, 1)]);
      const shEnv = withKv(env, kv);
      const deps: ShieldDeps = { cache, kv };
      await refreshRules(shEnv, deps);
      __ageShieldRulesForTests(20_000);
      const captured: Promise<unknown>[] = [];
      await getShieldRules(shEnv, makeContext(captured), deps);
      expect(captured).toHaveLength(1);
    }
    // Invalid refresh_s is ignored: 60s-old exceeds the default band.
    __resetShieldStateForTests();
    {
      const { cache } = makeCache();
      const { kv } = makeKv([kvPayload(rules, 7, "soon")]);
      const shEnv = withKv(env, kv);
      const deps: ShieldDeps = { cache, kv };
      await refreshRules(shEnv, deps);
      __ageShieldRulesForTests(60_000);
      const captured: Promise<unknown>[] = [];
      await getShieldRules(shEnv, makeContext(captured), deps);
      expect(captured).toHaveLength(1);
    }
  });
});
