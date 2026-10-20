import { afterEach, describe, expect, it } from "bun:test";

import type { Env, ShieldKV } from "./env.ts";
import { __resetShieldStateForTests } from "./shield.ts";
import worker from "./worker.ts";

const context = {
  waitUntil() {
    throw new Error("A cache hit should not write to the cache");
  },
} as unknown as ExecutionContext;

const capturingContext = {
  waited: [] as Promise<unknown>[],
  waitUntil(promise: Promise<unknown>) {
    capturingContext.waited.push(promise);
  },
} as unknown as ExecutionContext & { waited: Promise<unknown>[] };

// Shield reads rules from KV only; this binding stands in for the real one.
const shieldEnv = {
  SHIELD_RULES: {
    async get(): Promise<string | null> {
      return null;
    },
  },
} as Env;

let originalCaches = globalThis.caches;
let originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.caches = originalCaches;
  globalThis.fetch = originalFetch;
  __resetShieldStateForTests();
});

function shieldRulesResponse(rules: unknown[]): Response {
  return new Response(
    JSON.stringify({ schema: 1, v: 9, ts: new Date().toISOString(), rules }),
    { headers: { "Content-Type": "application/json" } }
  );
}

// worker.fetch expects an incoming Request (with CfProperties); the DOM
// Request built in tests is equivalent at runtime.
type WorkerRequest = Parameters<typeof worker.fetch>[0];

function workerRequest(url: string, init?: RequestInit): WorkerRequest {
  return new Request(url, init) as unknown as WorkerRequest;
}

describe("worker", () => {
  it("adds a UTF-8 charset to cached text responses", async () => {
    let cachedResponse = new Response('.icon::after { content: "×"; }', {
      headers: {
        "Cache-Control": "public, max-age=31536000",
        "Content-Type": "text/css",
      },
    });

    globalThis.caches = {
      default: {
        async match() {
          return cachedResponse;
        },
      },
    } as unknown as CacheStorage;

    let response = await worker.fetch(workerRequest("https://unpkg.com/example@1.0.0/styles.css"), {} as Env, context);

    expect(response.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
    expect(await response.text()).toContain("×");
  });

  it("serves the request when the Shield rules cache fails (API-down fail-open)", async () => {
    let cachedResponse = new Response("body { color: red; }", {
      headers: {
        "Cache-Control": "public, max-age=31536000",
        "Content-Type": "text/css",
      },
    });

    globalThis.caches = {
      default: {
        async match(request: Request) {
          // Shield rules lookup explodes; the package lookup hits.
          if (request.url.includes("shield-internal")) throw new Error("cache unavailable");
          return cachedResponse;
        },
      },
    } as unknown as CacheStorage;

    let response = await worker.fetch(
      workerRequest("https://unpkg.com/example@1.0.0/styles.css"),
      shieldEnv,
      capturingContext
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("color: red");
  });

  it("serves the request when Shield itself throws (fail-open guard)", async () => {
    let cachedResponse = new Response("body { color: blue; }", {
      headers: {
        "Cache-Control": "public, max-age=31536000",
        "Content-Type": "text/css",
      },
    });

    globalThis.caches = {
      default: {
        async match(request: Request) {
          // Cold Shield state (miss) plus the throwing context below makes
          // getShieldRules reject; the package lookup itself hits.
          if (request.url.includes("shield-internal")) return null;
          return cachedResponse;
        },
      },
    } as unknown as CacheStorage;

    let response = await worker.fetch(
      workerRequest("https://unpkg.com/example@1.0.0/styles.css"),
      shieldEnv,
      context // waitUntil throws: without the guard this request would 500
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("color: blue");
  });

  it("serves the block stub without touching package origins", async () => {
    const rules = [{ action: "block", pkg: "example", from: ["1.0.0"], domains: ["*"] }];
    const gets: string[] = [];
    const kv: ShieldKV = {
      async get(key: string, type: "text") {
        gets.push(`${key}:${type}`);
        return JSON.stringify({ schema: 1, v: 9, rules });
      },
    };

    globalThis.caches = {
      default: {
        async match(request: Request) {
          if (request.url.includes("shield-internal")) return shieldRulesResponse(rules).clone();
          throw new Error("block path must not reach the package cache");
        },
        async put() {},
      },
    } as unknown as CacheStorage;

    globalThis.fetch = (async () => {
      throw new Error("block path must not fetch");
    }) as unknown as typeof fetch;

    const waited: Promise<unknown>[] = [];
    const ctx = { waitUntil(promise: Promise<unknown>) { waited.push(promise); } } as unknown as ExecutionContext;

    let blocked = await worker.fetch(
      workerRequest("https://unpkg.com/example@1.0.0/index.js", {
        headers: { Referer: "https://customer.test/" },
      }),
      { ...shieldEnv, SHIELD_RULES: kv },
      ctx
    );

    expect(blocked.status).toBe(403);
    expect(blocked.headers.get("Cache-Control")).toBe("no-store");
    expect(await blocked.text()).toContain("example@1.0.0");
    await Promise.all(waited);
    // The only outbound call the worker ever makes is the KV rules read.
    expect(gets).toEqual(["shield:edge-rules:v1:text"]);
  });

  it("serves a cached response whose body matches its Content-Length", async () => {
    let cachedResponse = new Response("hello", {
      headers: {
        "Cache-Control": "public, max-age=31536000",
        "Content-Length": "5",
        "Content-Type": "text/javascript",
      },
    });

    globalThis.caches = {
      default: {
        async match() {
          return cachedResponse;
        },
      },
    } as unknown as CacheStorage;

    let response = await worker.fetch(
      workerRequest("https://unpkg.com/example@1.0.0/index.js"),
      {} as Env,
      context
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello");
  });

  it("errors and evicts a corrupt cached response instead of serving it as good", async () => {
    let deleted = false;
    // A truncated body carrying the complete response's Content-Length.
    let corruptResponse = new Response("bad", {
      headers: {
        "Cache-Control": "public, max-age=31536000",
        "Content-Length": "100",
        "Content-Type": "text/javascript",
      },
    });

    globalThis.caches = {
      default: {
        async match() {
          return corruptResponse;
        },
        async delete() {
          deleted = true;
          return true;
        },
      },
    } as unknown as CacheStorage;

    let response = await worker.fetch(
      workerRequest("https://unpkg.com/example@1.0.0/index.js"),
      {} as Env,
      context
    );

    // The audit errors the stream at end-of-body rather than letting a
    // known-truncated body complete as a successful response, and the
    // entry is evicted so the next request refetches.
    await expect(response.text()).rejects.toThrow();
    expect(deleted).toBe(true);
  });
});
