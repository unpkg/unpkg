import { afterEach, describe, expect, it } from "bun:test";

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

  it("does not cache version redirect responses", async () => {
    globalThis.caches = {
      default: {
        async match() {
          return undefined;
        },
        async put() {
          throw new Error("Redirect responses should not be cached");
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

    let response = await worker.fetch(new Request("https://unpkg.com/example"), env, context);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/example@1.0.0");
  });
});
