import { beforeEach, describe, expect, it } from "bun:test";

import {
  __resetCacheGenerationsForTests,
  getCacheGeneration,
  getRequestCacheGeneration,
  parseGenerationsPayload,
  setRequestCacheGeneration,
  type CacheGenerationsKV,
} from "./cache-generations.ts";

const NOW = Date.parse("2026-10-23T00:00:00Z");
const FUTURE = "2027-12-01T00:00:00Z";
const PAST = "2025-01-01T00:00:00Z";

function payload(generations: unknown, v = 3): string {
  return JSON.stringify({ schema: 1, v, generations });
}

const emptyCache = {
  async match() {
    return undefined;
  },
  async put() {},
  async delete() {
    return true;
  },
} as unknown as Cache;

function kvWith(text: string | null): CacheGenerationsKV {
  return {
    async get() {
      return text;
    },
  };
}

describe("cache generations", () => {
  beforeEach(() => {
    __resetCacheGenerationsForTests();
  });

  it("parses object and compact entry forms and lowercases keys", () => {
    const parsed = parseGenerationsPayload(
      payload({
        "Lodash@4.17.20": { gen: 2, expires_at: FUTURE },
        "preact@10.26.4": [1, Math.floor(Date.parse(FUTURE) / 1000)],
      })
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.generations.get("lodash@4.17.20")?.generation).toBe(2);
    expect(parsed!.generations.get("preact@10.26.4")?.generation).toBe(1);
    expect(parsed!.version).toBe(3);
  });

  it("skips malformed entries and rejects malformed payloads", () => {
    const parsed = parseGenerationsPayload(
      payload({
        "good@1.0.0": { gen: 1, expires_at: FUTURE },
        "zero@1.0.0": { gen: 0, expires_at: FUTURE },
        "frac@1.0.0": { gen: 1.5, expires_at: FUTURE },
        "noexpiry@1.0.0": { gen: 1 },
        "junk@1.0.0": "nope",
      })
    );
    expect([...parsed!.generations.keys()]).toEqual(["good@1.0.0"]);
    expect(parseGenerationsPayload("not json")).toBeNull();
    expect(parseGenerationsPayload(JSON.stringify({ schema: 1, v: 9 }))).toBeNull();
    expect(parseGenerationsPayload(JSON.stringify({ schema: 1, v: 9, generations: [] }))).toBeNull();
    expect(parseGenerationsPayload(JSON.stringify({ schema: 2, generations: {} }))).toBeNull();
  });

  it("returns the generation for an evicted version from KV", async () => {
    const deps = {
      kv: kvWith(payload({ "lodash@4.17.20": { gen: 2, expires_at: FUTURE } })),
      cache: emptyCache,
      now: () => NOW,
    };
    // Cold start: the first lookup in an isolate returns 0 while the
    // document warms in the background (same contract as Shield rules).
    expect(await getCacheGeneration({}, undefined, "lodash", "4.17.20", deps)).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await getCacheGeneration({}, undefined, "lodash", "4.17.20", deps)).toBe(2);
    expect(await getCacheGeneration({}, undefined, "lodash", "4.17.21", deps)).toBe(0);
    expect(await getCacheGeneration({}, undefined, "react", "18.2.0", deps)).toBe(0);
  });

  it("treats expired entries as generation 0", async () => {
    const deps = {
      kv: kvWith(payload({ "lodash@4.17.20": { gen: 2, expires_at: PAST } })),
      cache: emptyCache,
      now: () => NOW,
    };
    expect(await getCacheGeneration({}, undefined, "lodash", "4.17.20", deps)).toBe(0);
  });

  it("is inert when the binding is unset", async () => {
    expect(await getCacheGeneration({}, undefined, "lodash", "4.17.20", { cache: emptyCache, now: () => NOW })).toBe(0);
  });

  it("fails open when KV throws", async () => {
    const kv: CacheGenerationsKV = {
      async get() {
        throw new Error("kv down");
      },
    };
    const deps = { kv, cache: emptyCache, now: () => NOW };
    expect(await getCacheGeneration({}, undefined, "lodash", "4.17.20", deps)).toBe(0);
  });

  it("hands the resolved generation to the handler via the request", () => {
    const request = new Request("https://unpkg.com/lodash@4.17.20/index.js");
    expect(getRequestCacheGeneration(request)).toBe(0);
    setRequestCacheGeneration(request, 4);
    expect(getRequestCacheGeneration(request)).toBe(4);
    setRequestCacheGeneration(request, 0);
    expect(getRequestCacheGeneration(request)).toBe(4);
  });
});
