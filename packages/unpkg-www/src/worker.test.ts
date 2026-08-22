import { afterEach, describe, expect, it, spyOn } from "bun:test";

import type { Env } from "./env.ts";
import worker from "./worker.ts";

const context = {
  waitUntil() {
    throw new Error("A cache hit should not write to the cache");
  },
} as unknown as ExecutionContext;

const env: Env = {
  APP_ORIGIN: "https://app.unpkg.com",
  ASSETS_ORIGIN: "https://unpkg.com",
  DEV: false,
  ESM_ORIGIN: "https://esm.unpkg.com",
  FILES_ORIGIN: "https://files.unpkg.com",
  MODE: "test",
  ORIGIN: "https://unpkg.com",
};

let originalCaches = globalThis.caches;

afterEach(() => {
  globalThis.caches = originalCaches;
});

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

    let response = await worker.fetch(new Request("https://unpkg.com/example@1.0.0/styles.css"), {} as Env, context);

    expect(response.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
    expect(await response.text()).toContain("×");
  });

  it("caches version redirect responses", async () => {
    let cachedStatus: number | undefined;
    let pending: Promise<unknown>[] = [];
    let redirectContext = {
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
    } as unknown as ExecutionContext;

    globalThis.caches = {
      default: {
        async match() {
          return undefined;
        },
        async put(_request, response) {
          cachedStatus = response.status;
        },
      },
      async open(cacheName) {
        expect(cacheName).toBe("npm-info");
        return {
          async match() {
            return Response.json({
              name: "example",
              "dist-tags": { latest: "1.0.0" },
              time: {},
              versions: {
                "1.0.0": {
                  name: "example",
                  version: "1.0.0",
                  description: "Example package",
                  dependencies: {},
                },
              },
            });
          },
        };
      },
    } as unknown as CacheStorage;

    let response = await worker.fetch(new Request("https://unpkg.com/example"), env, redirectContext);
    await Promise.all(pending);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/example@1.0.0");
    expect(cachedStatus).toBe(302);
  });

  it("returns a retryable 503 when the cache connection remains unavailable", async () => {
    globalThis.caches = {
      default: {
        async match() {
          throw new Error("Network connection lost.");
        },
      },
    } as unknown as CacheStorage;
    let error = spyOn(console, "error").mockImplementation(() => {});

    try {
      let response = await worker.fetch(new Request("https://unpkg.com/example"), env, context);

      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("1");
    } finally {
      error.mockRestore();
    }
  });
});
