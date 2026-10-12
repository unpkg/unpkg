import { describe, expect, it, beforeEach } from "bun:test";
import type { ExecutionContext } from "@cloudflare/workers-types";

import fixtures from "../test/fixtures/edge_match_conformance.json";
import type { Env } from "./env.ts";
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
  SHIELD_API_ORIGIN: "https://shield.test/v1",
  SHIELD_API_KEY: "test-key",
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

function rulesResponse(rules: unknown[], v: number): Response {
  return new Response(JSON.stringify({ schema: 1, v, ts: new Date().toISOString(), rules }), {
    headers: { "Content-Type": "application/json" },
  });
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

  it("returns null without Shield env vars and never fetches", async () => {
    let fetched = 0;
    const { cache } = makeCache();
    const deps: ShieldDeps = { cache, fetch: async () => { fetched++; return rulesResponse([], 0); } };
    const captured: Promise<unknown>[] = [];
    const bare = { ...env, SHIELD_API_ORIGIN: undefined, SHIELD_API_KEY: undefined };
    expect(await getShieldRules(bare, makeContext(captured), deps)).toBeNull();
    expect(fetched).toBe(0);
    expect(captured).toHaveLength(0);
  });

  it("cold start returns null and warms the cache in the background", async () => {
    let fetched = 0;
    const { cache, store } = makeCache();
    const deps: ShieldDeps = {
      cache,
      fetch: async () => { fetched++; return rulesResponse(rules, 7); },
    };
    const captured: Promise<unknown>[] = [];
    expect(await getShieldRules(env, makeContext(captured), deps)).toBeNull();
    expect(captured).toHaveLength(1);
    await captured[0];
    expect(fetched).toBe(1);
    expect(store.has("https://shield-internal/rules")).toBe(true);
    // Warmed: the next call serves from memory without fetching.
    const state = await getShieldRules(env, makeContext([]), deps);
    expect(state).not.toBeNull();
    expect(state!.get("chalk")).toHaveLength(1);
    expect(fetched).toBe(1);
  });

  it("stale memory schedules a background refresh but serves stale rules", async () => {
    let fetched = 0;
    const { cache } = makeCache();
    const deps: ShieldDeps = {
      cache,
      fetch: async () => { fetched++; return rulesResponse(rules, 7); },
    };
    await refreshRules(env, deps);
    expect(fetched).toBe(1);
    __ageShieldRulesForTests(60_000);
    const captured: Promise<unknown>[] = [];
    const served = await getShieldRules(env, makeContext(captured), deps);
    expect(served).not.toBeNull();
    expect(served!.get("chalk")).toHaveLength(1);
    expect(captured).toHaveLength(1);
    await captured[0];
    expect(fetched).toBe(2);
  });

  it("concurrent refreshes collapse into one fetch (in-flight guard)", async () => {
    let fetched = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { cache } = makeCache();
    const deps: ShieldDeps = {
      cache,
      fetch: async () => { fetched++; await gate; return rulesResponse(rules, 7); },
    };
    const first = refreshRules(env, deps);
    const second = refreshRules(env, deps);
    release();
    await Promise.all([first, second]);
    expect(fetched).toBe(1);
  });

  it("failed refreshes do not schedule another attempt until the TTL elapses", async () => {
    // Without this gate, every request past a failed refresh would trigger
    // another origin fetch — an API brownout would turn request rate into
    // origin load. The gate bounds origin fetches to ~1/soft-TTL/isolate.
    let fetched = 0;
    const { cache } = makeCache();
    const deps: ShieldDeps = {
      cache,
      fetch: async () => { fetched++; return new Response("nope", { status: 500 }); },
    };
    const first: Promise<unknown>[] = [];
    expect(await getShieldRules(env, makeContext(first), deps)).toBeNull();
    expect(first).toHaveLength(1);
    await first[0];
    expect(fetched).toBe(1);
    const second: Promise<unknown>[] = [];
    expect(await getShieldRules(env, makeContext(second), deps)).toBeNull();
    expect(second).toHaveLength(0);
    expect(fetched).toBe(1);
    __ageShieldRulesForTests(60_000);
    const third: Promise<unknown>[] = [];
    expect(await getShieldRules(env, makeContext(third), deps)).toBeNull();
    expect(third).toHaveLength(1);
  });

  it("a slow stale fetch never regresses a newer cached entry", async () => {
    const { cache, store } = makeCache(rulesResponse(rules, 10));
    const deps: ShieldDeps = {
      cache,
      fetch: async () => rulesResponse([], 3),
    };
    await refreshRules(env, deps);
    const kept = (await store.get("https://shield-internal/rules")!.json()) as { v: number };
    expect(kept.v).toBe(10);
  });

  it("failed fetches fail open and keep serving stale rules", async () => {
    const { cache } = makeCache();
    const good: ShieldDeps = {
      cache,
      fetch: async () => rulesResponse(rules, 7),
    };
    await refreshRules(env, good);
    const bad: ShieldDeps = {
      cache,
      fetch: async () => new Response("nope", { status: 500 }),
    };
    await refreshRules(env, bad);
    const served = await getShieldRules(env, makeContext([]), bad);
    expect(served).not.toBeNull();
    expect(served!.get("chalk")).toHaveLength(1);
  });

  it("newer-schema payloads are ignored, keeping current rules", async () => {
    const { cache } = makeCache();
    const deps: ShieldDeps = { cache, fetch: async () => rulesResponse(rules, 7) };
    await refreshRules(env, deps);
    const newer: ShieldDeps = {
      cache,
      fetch: async () =>
        new Response(JSON.stringify({ schema: 99, v: 8, rules: [] }), {
          headers: { "Content-Type": "application/json" },
        }),
    };
    await refreshRules(env, newer);
    const served = await getShieldRules(env, makeContext([]), newer);
    expect(served!.get("chalk")).toHaveLength(1);
  });
});
