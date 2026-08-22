import { describe, expect, it, spyOn } from "bun:test";

import { isCacheableResponse, retryOnNetworkConnectionLost, waitUntilCachePut } from "./cache-utils.ts";

describe("isCacheableResponse", () => {
  let request = new Request("https://unpkg.com/react");

  it.each([200, 301, 302])("caches status %d responses with cache control", (status) => {
    let response = new Response(null, {
      status,
      headers: { "Cache-Control": "public, max-age=60" },
    });

    expect(isCacheableResponse(request, response)).toBe(true);
  });

  it("does not cache responses without cache control", () => {
    expect(isCacheableResponse(request, new Response(null))).toBe(false);
  });

  it("does not cache non-GET requests", () => {
    let postRequest = new Request(request, { method: "POST" });
    let response = new Response(null, {
      headers: { "Cache-Control": "public, max-age=60" },
    });

    expect(isCacheableResponse(postRequest, response)).toBe(false);
  });
});

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

describe("retryOnNetworkConnectionLost", () => {
  it("retries one transient connection failure", async () => {
    let attempts = 0;

    let result = await retryOnNetworkConnectionLost(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Network connection lost.");
      return "ok";
    }, 0);

    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("does not retry other errors", async () => {
    let attempts = 0;
    let operation = async () => {
      attempts += 1;
      throw new Error("Invalid response");
    };

    await expect(retryOnNetworkConnectionLost(operation, 0)).rejects.toThrow("Invalid response");
    expect(attempts).toBe(1);
  });
});
