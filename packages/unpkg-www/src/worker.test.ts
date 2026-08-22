import { afterEach, describe, expect, it } from "bun:test";

import type { Env } from "./env.ts";
import worker from "./worker.ts";

const context = {
  waitUntil() {
    throw new Error("A cache hit should not write to the cache");
  },
} as unknown as ExecutionContext;

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
});
