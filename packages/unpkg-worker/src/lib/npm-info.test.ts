import { afterEach, describe, expect, it } from "bun:test";

import { getPackageInfo } from "./npm-info.ts";

const context = {
  waitUntil() {},
} as unknown as ExecutionContext;

let originalCaches = globalThis.caches;

afterEach(() => {
  globalThis.caches = originalCaches;
});

describe("getPackageInfo", () => {
  it("retries transient named-cache open and read failures", async () => {
    let openAttempts = 0;
    let matchAttempts = 0;
    let cache = {
      async match() {
        matchAttempts += 1;
        if (matchAttempts === 1) throw new Error("Network connection lost.");

        return Response.json({
          name: "example",
          time: {},
        });
      },
    } as unknown as Cache;

    globalThis.caches = {
      async open() {
        openAttempts += 1;
        if (openAttempts === 1) throw new Error("Network connection lost.");
        return cache;
      },
    } as unknown as CacheStorage;

    let packageInfo = await getPackageInfo(context, "https://registry.npmjs.org", "example");

    expect(packageInfo?.name).toBe("example");
    expect(openAttempts).toBe(2);
    expect(matchAttempts).toBe(2);
  });
});
