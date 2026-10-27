import { afterEach, describe, expect, it } from "bun:test";

import type { Env, ShieldKV } from "./env.ts";
import { __resetCacheGenerationsForTests } from "./cache-generations.ts";
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
  __resetCacheGenerationsForTests();
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

function immutableCachedResponse(body: BodyInit | null, init: ResponseInit): Response {
  let response = new Response(body, init);
  // Bun's Response headers are mutable, unlike a workerd Cache API response.
  for (let method of ["set", "append", "delete"] as const) {
    Object.defineProperty(response.headers, method, {
      value() {
        throw new TypeError("Can't modify immutable headers.");
      },
    });
  }
  return response;
}

describe("worker", () => {
  it.each([
    ["If-Modified-Since", "Tue, 04 Aug 2026 07:34:22 GMT"],
    ["If-None-Match", '"cached-file"'],
  ])("preserves an immutable cached 304 for %s", async (header, value) => {
    let cachedResponse = immutableCachedResponse(null, {
      status: 304,
      statusText: "Not Modified",
      headers: {
        "Cache-Control": "public, max-age=31536000",
        "Content-Type": "text/javascript; charset=utf-8",
        "Last-Modified": "Tue, 04 Aug 2026 07:34:22 GMT",
        ETag: '"cached-file"',
      },
    });
    expect(() => cachedResponse.headers.set("X-Robots-Tag", "noindex")).toThrow("immutable headers");

    globalThis.caches = {
      default: {
        async match(request: Request) {
          expect(request.headers.get(header)).toBe(value);
          return cachedResponse;
        },
      },
    } as unknown as CacheStorage;
    globalThis.fetch = (async () => {
      throw new Error("A cached 304 must not fetch from the origin");
    }) as unknown as typeof fetch;

    let response = await worker.fetch(
      workerRequest("https://unpkg.com/example@1.0.0/index.js", { headers: { [header]: value } }),
      {} as Env,
      context
    );

    expect(response.status).toBe(304);
    expect(response.statusText).toBe("Not Modified");
    expect(response.body).toBeNull();
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    for (let name of ["Cache-Control", "Content-Type", "Last-Modified", "ETag"]) {
      expect(response.headers.get(name)).toBe(cachedResponse.headers.get(name));
    }
    expect(cachedResponse.headers.get("X-Robots-Tag")).toBeNull();
  });

  it("serves an immutable cached file without verification metadata", async () => {
    let cachedResponse = immutableCachedResponse("hello", {
      headers: {
        "Cache-Control": "public, max-age=31536000",
        "Content-Type": "text/javascript; charset=utf-8",
      },
    });
    expect(() => cachedResponse.headers.set("X-Robots-Tag", "noindex")).toThrow("immutable headers");

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
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000");
    expect(await response.text()).toBe("hello");
    expect(cachedResponse.headers.get("X-Robots-Tag")).toBeNull();
  });

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

  it("serves a Shield pin as no-store while caching the clean URL normally", async () => {
    const rules = [{ pkg: "example", from: ["1.0.0"], to: "1.0.1", domains: ["customer.test"] }];
    const kv: ShieldKV = {
      async get() {
        return JSON.stringify({ schema: 1, v: 9, rules });
      },
    };

    const matchedPackageUrls: string[] = [];
    const puts: string[] = [];
    const cleanCachedResponse = new Response("clean-body", {
      headers: {
        "Cache-Control": "public, max-age=31536000",
        "Content-Length": "10",
        "Content-Type": "text/javascript",
      },
    });

    globalThis.caches = {
      default: {
        async match(request: Request) {
          if (request.url.includes("shield-internal")) {
            return shieldRulesResponse(rules).clone();
          }
          matchedPackageUrls.push(request.url);
          if (request.url === "https://unpkg.com/example@1.0.1/index.js") {
            return cleanCachedResponse;
          }
          return new Response("malicious-body", {
            headers: {
              "Cache-Control": "public, max-age=31536000",
              "Content-Length": "14",
              "Content-Type": "text/javascript",
            },
          });
        },
        async put(request: Request) {
          if (request.url.includes("shield-internal")) return;
          puts.push(request.url);
        },
      },
    } as unknown as CacheStorage;

    const waited: Promise<unknown>[] = [];
    const ctx = {
      waitUntil(promise: Promise<unknown>) {
        waited.push(promise);
      },
    } as unknown as ExecutionContext;

    let response = await worker.fetch(
      workerRequest("https://unpkg.com/example@1.0.0/index.js", {
        headers: { Referer: "https://customer.test/" },
      }),
      { ...shieldEnv, SHIELD_RULES: kv },
      ctx
    );
    await Promise.all(waited);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("clean-body");
    // The browser must not retain substitute bytes under the malicious URL.
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    // Only the rewritten (clean) URL is looked up; the malicious cache
    // entry is never consulted for a shielded request.
    expect(matchedPackageUrls).toEqual(["https://unpkg.com/example@1.0.1/index.js"]);
    // A cache hit is not rewritten to the cache, and the stored clean entry
    // keeps its normal lifetime — only the browser-facing copy changes.
    expect(puts).toHaveLength(0);
    expect(cleanCachedResponse.headers.get("Cache-Control")).toBe("public, max-age=31536000");
  });

  it("leaves non-matched domains on the original response and headers", async () => {
    const rules = [{ pkg: "example", from: ["1.0.0"], to: "1.0.1", domains: ["customer.test"] }];
    const kv: ShieldKV = {
      async get() {
        return JSON.stringify({ schema: 1, v: 9, rules });
      },
    };

    globalThis.caches = {
      default: {
        async match(request: Request) {
          if (request.url.includes("shield-internal")) {
            return shieldRulesResponse(rules).clone();
          }
          return new Response("malicious-body", {
            headers: {
              "Cache-Control": "public, max-age=31536000",
              "Content-Length": "14",
              "Content-Type": "text/javascript",
            },
          });
        },
        async put() {},
      },
    } as unknown as CacheStorage;

    const waited: Promise<unknown>[] = [];
    const ctx = {
      waitUntil(promise: Promise<unknown>) {
        waited.push(promise);
      },
    } as unknown as ExecutionContext;

    let response = await worker.fetch(
      workerRequest("https://unpkg.com/example@1.0.0/index.js", {
        headers: { Referer: "https://other.test/" },
      }),
      { ...shieldEnv, SHIELD_RULES: kv },
      ctx
    );
    await Promise.all(waited);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("malicious-body");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000");
  });

  it("on a cache miss, stores the clean URL with its normal lifetime and serves no-store", async () => {
    const rules = [{ pkg: "example", from: ["1.0.0"], to: "1.0.1", domains: ["customer.test"] }];
    const kv: ShieldKV = {
      async get() {
        return JSON.stringify({ schema: 1, v: 9, rules });
      },
    };

    const body = "clean-body";
    const digest = new Bun.CryptoHasher("sha256").update(body).digest("base64");
    const puts: { url: string; cacheControl: string | null; body: Promise<string> }[] = [];

    globalThis.caches = {
      default: {
        async match(request: Request) {
          if (request.url.includes("shield-internal")) {
            return shieldRulesResponse(rules).clone();
          }
          return undefined;
        },
        async put(request: Request, response: Response) {
          if (request.url.includes("shield-internal")) return;
          puts.push({
            url: request.url,
            cacheControl: response.headers.get("Cache-Control"),
            body: response.text(),
          });
        },
      },
      async open() {
        return {
          async match() {
            return null;
          },
          async put() {},
          async delete() {
            return true;
          },
        };
      },
    } as unknown as CacheStorage;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      let request = input instanceof Request ? input : new Request(input, init);
      let url = new URL(request.url);

      if (url.href === "https://registry.npmjs.org/example") {
        return Response.json({
          name: "example",
          "dist-tags": { latest: "1.0.1" },
          versions: {
            "1.0.1": { name: "example", version: "1.0.1", main: "index.js" },
          },
          time: { "1.0.1": "2024-01-01T00:00:00.000Z" },
        });
      }
      if (url.origin === "https://files.test" && url.pathname === "/list/example@1.0.1/") {
        return Response.json({
          package: "example",
          version: "1.0.1",
          prefix: "/",
          files: [{ path: "/index.js", size: body.length, type: "text/javascript", integrity: `sha256-${digest}` }],
        });
      }
      if (url.origin === "https://files.test" && url.pathname === "/file/example@1.0.1/index.js") {
        return new Response(body, {
          headers: {
            "Content-Digest": `sha256=:${digest}:`,
            "Content-Length": String(body.length),
            "Content-Type": "text/javascript",
          },
        });
      }
      throw new Error(`Unexpected URL: ${url.href}`);
    }) as unknown as typeof fetch;

    const waited: Promise<unknown>[] = [];
    const ctx = {
      waitUntil(promise: Promise<unknown>) {
        waited.push(promise);
      },
    } as unknown as ExecutionContext;

    let response = await worker.fetch(
      workerRequest("https://unpkg.com/example@1.0.0/index.js", {
        headers: { Referer: "https://customer.test/" },
      }),
      {
        ...shieldEnv,
        SHIELD_RULES: kv,
        APP_ORIGIN: "https://app.unpkg.com",
        ASSETS_ORIGIN: "https://unpkg.com",
        DEV: false,
        ESM_ORIGIN: "https://esm.unpkg.com",
        FILES_ORIGIN: "https://files.test",
        MODE: "test",
        ORIGIN: "https://unpkg.com",
      } as Env,
      ctx
    );
    await Promise.all(waited);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(body);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    // The cache.put clone is taken before the no-store mutation: the edge
    // entry belongs to the clean URL and keeps its normal lifetime.
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toBe("https://unpkg.com/example@1.0.1/index.js");
    expect(puts[0].cacheControl).toBe("public, max-age=31536000");
    expect(await puts[0].body).toBe(body);
  });

  it("serves a generation-scoped cache entry after an eviction bump", async () => {
    const generations = {
      schema: 1,
      v: 1,
      generations: {
        "example@1.0.0": { gen: 2, expires_at: "2027-12-01T00:00:00Z" },
      },
    };
    const matchedPackageUrls: string[] = [];
    const puts: string[] = [];

    globalThis.caches = {
      default: {
        async match(request: Request) {
          if (request.url.includes("cache-generations")) {
            return new Response(JSON.stringify(generations), {
              headers: { "Content-Type": "application/json" },
            });
          }
          if (request.url.includes("shield-internal")) {
            return shieldRulesResponse([]).clone();
          }
          matchedPackageUrls.push(request.url);
          const body = request.url.includes("__unpkg_g=2") ? "fresh-body" : "stale-body";
          return new Response(body, {
            headers: {
              "Cache-Control": "public, max-age=31536000",
              "Content-Length": "10",
              "Content-Type": "text/javascript",
            },
          });
        },
        async put(request: Request) {
          if (request.url.includes("cache-generations") || request.url.includes("shield-internal")) return;
          puts.push(request.url);
        },
      },
    } as unknown as CacheStorage;

    const waited: Promise<unknown>[] = [];
    const ctx = {
      waitUntil(promise: Promise<unknown>) {
        waited.push(promise);
      },
    } as unknown as ExecutionContext;

    let response = await worker.fetch(
      workerRequest("https://unpkg.com/example@1.0.0/index.js"),
      {
        ...shieldEnv,
        CACHE_GENERATIONS: {
          async get() {
            return JSON.stringify(generations);
          },
        },
      } as Env,
      ctx
    );
    await Promise.all(waited);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("fresh-body");
    expect(matchedPackageUrls).toEqual(["https://unpkg.com/example@1.0.0/index.js?__unpkg_g=2"]);
    expect(puts).toEqual([]);
  });

  it("ignores a client-supplied generation parameter on cache keys", async () => {
    const matchedPackageUrls: string[] = [];
    globalThis.caches = {
      default: {
        async match(request: Request) {
          if (request.url.includes("cache-generations") || request.url.includes("shield-internal")) {
            return shieldRulesResponse([]).clone();
          }
          matchedPackageUrls.push(request.url);
          return new Response("canonical!", {
            headers: {
              "Cache-Control": "public, max-age=31536000",
              "Content-Length": "10",
              "Content-Type": "text/javascript",
            },
          });
        },
        async put() {},
      },
    } as unknown as CacheStorage;

    let response = await worker.fetch(
      workerRequest("https://unpkg.com/example@1.0.0/index.js?__unpkg_g=7"),
      shieldEnv,
      context
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("canonical!");
    expect(matchedPackageUrls).toEqual(["https://unpkg.com/example@1.0.0/index.js"]);
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

  it("strips the internal verification marker from a cached response", async () => {
    let cachedResponse = new Response("hello", {
      headers: {
        "Cache-Control": "public, max-age=31536000",
        "Content-Type": "text/javascript",
        "X-Unpkg-Body-Verification": "verified",
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
    expect(response.headers.get("X-Unpkg-Body-Verification")).toBeNull();
    expect(await response.text()).toBe("hello");
  });
});
