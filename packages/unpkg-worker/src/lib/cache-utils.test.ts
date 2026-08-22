import { describe, expect, it, spyOn } from "bun:test";

import { waitUntilCachePut } from "./cache-utils.ts";

describe("waitUntilCachePut", () => {
  it("handles transient cache write failures without rejecting the invocation", async () => {
    let pending: Promise<unknown> | undefined;
    let context = {
      waitUntil(promise: Promise<unknown>) {
        pending = promise;
      },
    } as unknown as ExecutionContext;
    let cache = {
      async put() {
        throw new Error("Network connection lost.");
      },
    } as unknown as Cache;
    let warn = spyOn(console, "warn").mockImplementation(() => {});

    try {
      waitUntilCachePut(
        context,
        cache,
        new Request("https://registry.npmjs.org/react"),
        Response.json({}),
        "npm-info"
      );

      expect(pending).toBeDefined();
      await expect(pending!).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith("Cache write failed (npm-info): Network connection lost.");
    } finally {
      warn.mockRestore();
    }
  });
});
