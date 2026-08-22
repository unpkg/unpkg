import { describe, expect, it, spyOn } from "bun:test";

import { observeIoOperation, waitUntilCachePut } from "./cache-utils.ts";

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

describe("observeIoOperation", () => {
  it("returns successful operation results without logging", async () => {
    let warn = spyOn(console, "warn").mockImplementation(() => {});

    try {
      await expect(observeIoOperation("npm-info:cache-match", async () => "ok")).resolves.toBe("ok");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("logs the operation and rethrows the original error", async () => {
    let failure = new Error("Network connection lost.");
    let caught: unknown;
    let warn = spyOn(console, "warn").mockImplementation(() => {});

    try {
      try {
        await observeIoOperation("npm-info:cache-match", async () => {
          throw failure;
        });
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
