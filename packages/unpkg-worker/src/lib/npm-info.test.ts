import { afterEach, describe, expect, it, spyOn } from "bun:test";

import { getPackageInfo } from "./npm-info.ts";

const context = {
  waitUntil() {},
} as unknown as ExecutionContext;

let originalCaches = globalThis.caches;

afterEach(() => {
  globalThis.caches = originalCaches;
});

describe("getPackageInfo", () => {
  it("parses cached metadata without pre-buffering the response body", async () => {
    let jsonCalls = 0;
    let arrayBufferCalls = 0;
    let response = {
      ok: true,
      async json() {
        jsonCalls += 1;
        return { name: "example", time: {} };
      },
      async arrayBuffer() {
        arrayBufferCalls += 1;
        throw new Error("Package metadata should not be eagerly buffered");
      },
    } as unknown as Response;

    globalThis.caches = {
      async open() {
        return {
          async match() {
            return response;
          },
        };
      },
    } as unknown as CacheStorage;

    let packageInfo = await getPackageInfo(context, "https://registry.npmjs.org", "example");

    expect(packageInfo?.name).toBe("example");
    expect(jsonCalls).toBe(1);
    expect(arrayBufferCalls).toBe(0);
  });

  it("labels cache-match failures without changing the thrown error", async () => {
    let failure = new Error("Network connection lost.");
    let caught: unknown;
    let warn = spyOn(console, "warn").mockImplementation(() => {});

    globalThis.caches = {
      async open() {
        return {
          async match() {
            throw failure;
          },
        };
      },
    } as unknown as CacheStorage;

    try {
      try {
        await getPackageInfo(context, "https://registry.npmjs.org", "example");
      } catch (error) {
        caught = error;
      }

      expect(caught).toBe(failure);
      expect(warn).toHaveBeenCalledWith("Worker I/O failed (npm-info:cache-match): Network connection lost.");
    } finally {
      warn.mockRestore();
    }
  });
});
