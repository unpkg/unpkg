import { afterEach, describe, expect, it, spyOn } from "bun:test";

import type { Env } from "./env.ts";
import worker from "./worker.ts";

const env: Env = {
  ASSETS_ORIGIN: "https://app.unpkg.com",
  DEV: false,
  FILES_ORIGIN: "https://files.unpkg.com",
  MODE: "test",
  ORIGIN: "https://app.unpkg.com",
  WWW_ORIGIN: "https://unpkg.com",
};

const context = {
  waitUntil() {},
} as unknown as ExecutionContext;

let originalCaches = globalThis.caches;

afterEach(() => {
  globalThis.caches = originalCaches;
});

describe("worker", () => {
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
      let response = await worker.fetch(new Request("https://app.unpkg.com/example"), env, context);

      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("1");
    } finally {
      error.mockRestore();
    }
  });
});
