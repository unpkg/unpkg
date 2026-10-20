import { afterEach, describe, expect, it } from "bun:test";

import { sha256Base64 } from "./cache-utils.ts";
import { fetchFile, listFiles } from "./npm-files.ts";
import { BODY_VERIFICATION_HEADER, type OriginFetchOptions } from "./origin-fetch.ts";

const encoder = new TextEncoder();

class FakeCache {
  store = new Map<string, Response>();

  async match(request: Request): Promise<Response | undefined> {
    let response = this.store.get(request.url);
    return response ? response.clone() : undefined;
  }

  async put(request: Request, response: Response): Promise<void> {
    this.store.set(request.url, response.clone());
  }

  async delete(request: Request): Promise<boolean> {
    return this.store.delete(request.url);
  }
}

let fakeCaches = new Map<string, FakeCache>();
let waitUntilPromises: Promise<unknown>[] = [];

const context = {
  waitUntil(promise: Promise<unknown>) {
    waitUntilPromises.push(promise);
  },
} as unknown as ExecutionContext;

async function flushWaitUntil(): Promise<void> {
  await Promise.all(waitUntilPromises.splice(0));
}

globalThis.caches = {
  async open(name: string) {
    if (!fakeCaches.has(name)) {
      fakeCaches.set(name, new FakeCache());
    }
    return fakeCaches.get(name);
  },
} as unknown as CacheStorage;

afterEach(() => {
  fakeCaches.clear();
  waitUntilPromises = [];
});

const ORIGIN = "https://files.test";

async function fullHeaders(body: Uint8Array, extra: Record<string, string> = {}): Promise<Headers> {
  return new Headers({
    "Cache-Control": "public, max-age=31536000",
    "Content-Length": String(body.byteLength),
    "Content-Digest": `sha256=:${await sha256Base64(body)}:`,
    "Content-Type": "text/javascript",
    ...extra,
  });
}

function fetchOptions(fetchFn: typeof fetch): OriginFetchOptions {
  return { fetchFn, retryDelayMs: 0, sleepFn: async () => {} };
}

describe("fetchFile", () => {
  it("serves a verified file and serves the next request from cache", async () => {
    let body = encoder.encode("export const x = 1;");
    let headers = await fullHeaders(body);
    let calls = 0;
    let fetchFn = (async () => {
      calls++;
      return new Response(body, { headers });
    }) as typeof fetch;

    let first = await fetchFile(context, ORIGIN, "pkg", "1.0.0", "/index.js", fetchOptions(fetchFn));
    expect(await first!.text()).toBe("export const x = 1;");
    await flushWaitUntil();

    let second = await fetchFile(context, ORIGIN, "pkg", "1.0.0", "/index.js", fetchOptions(fetchFn));
    expect(await second!.text()).toBe("export const x = 1;");
    expect(calls).toBe(1);
  });

  it("retries a truncated origin body and caches only the complete file", async () => {
    let full = encoder.encode("0123456789".repeat(10));
    let headers = await fullHeaders(full);
    let calls = 0;
    let fetchFn = (async () => {
      calls++;
      return new Response(calls === 1 ? full.subarray(0, 37) : full, { headers });
    }) as typeof fetch;

    let response = await fetchFile(context, ORIGIN, "pkg", "1.0.0", "/index.js", fetchOptions(fetchFn));
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(full);
    expect(calls).toBe(2);
    await flushWaitUntil();

    let cached = await fetchFile(context, ORIGIN, "pkg", "1.0.0", "/index.js", fetchOptions(fetchFn));
    expect(new Uint8Array(await cached!.arrayBuffer())).toEqual(full);
    expect(calls).toBe(2);
  });

  it("retries origin 5xx responses", async () => {
    let body = encoder.encode("export const x = 1;");
    let headers = await fullHeaders(body);
    let calls = 0;
    let fetchFn = (async () => {
      calls++;
      if (calls < 3) return new Response("Bad Gateway", { status: 502 });
      return new Response(body, { headers });
    }) as typeof fetch;

    let response = await fetchFile(context, ORIGIN, "pkg", "1.0.0", "/index.js", fetchOptions(fetchFn));
    expect(await response!.text()).toBe("export const x = 1;");
    expect(calls).toBe(3);
  });

  it("heals a corrupt cached entry by refetching and replacing it", async () => {
    let full = encoder.encode("0123456789".repeat(10));
    let headers = await fullHeaders(full);

    let cache = fakeCaches.get("npm-files") ?? new FakeCache();
    fakeCaches.set("npm-files", cache);
    let url = `${ORIGIN}/file/pkg@1.0.0/index.js`;
    // Poisoned entry: a truncated body carrying the complete file's headers.
    await cache.put(new Request(url), new Response(full.subarray(0, 37), { headers }));

    let calls = 0;
    let fetchFn = (async () => {
      calls++;
      return new Response(full, { headers });
    }) as typeof fetch;

    let response = await fetchFile(context, ORIGIN, "pkg", "1.0.0", "/index.js", fetchOptions(fetchFn));
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(full);
    expect(calls).toBe(1);
    await flushWaitUntil();

    let stored = await cache.match(new Request(url));
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(full);
  });

  it("serves a no-store response without caching it", async () => {
    let body = encoder.encode("ephemeral content");
    let headers = await fullHeaders(body, { "Cache-Control": "no-store, no-cache" });
    let calls = 0;
    let fetchFn = (async () => {
      calls++;
      return new Response(body, { headers });
    }) as typeof fetch;

    let first = await fetchFile(context, ORIGIN, "pkg", "1.0.0", "/index.js", fetchOptions(fetchFn));
    expect(await first!.text()).toBe("ephemeral content");
    await flushWaitUntil();

    let second = await fetchFile(context, ORIGIN, "pkg", "1.0.0", "/index.js", fetchOptions(fetchFn));
    expect(await second!.text()).toBe("ephemeral content");
    expect(calls).toBe(2);
  });

  it("marks buffer-backed bodies as verified and streamed bodies as pending", async () => {
    let body = encoder.encode("export const x = 1;");
    let headers = await fullHeaders(body);
    let fetchFn = (async () => new Response(body, { headers })) as typeof fetch;

    let buffered = await fetchFile(context, ORIGIN, "pkg", "1.0.0", "/index.js", fetchOptions(fetchFn));
    expect(buffered!.headers.get(BODY_VERIFICATION_HEADER)).toBe("verified");
    await buffered!.text();
    await flushWaitUntil();

    let streamed = await fetchFile(context, ORIGIN, "other", "1.0.0", "/index.js", {
      ...fetchOptions(fetchFn),
      bufferThresholdBytes: 4,
    });
    expect(streamed!.headers.get(BODY_VERIFICATION_HEADER)).toBe("pending");
    expect(await streamed!.text()).toBe("export const x = 1;");
    await flushWaitUntil();
  });

  it("returns null for a 404 without caching or retrying", async () => {
    let calls = 0;
    let fetchFn = (async () => {
      calls++;
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    let response = await fetchFile(context, ORIGIN, "pkg", "1.0.0", "/missing.js", fetchOptions(fetchFn));
    expect(response).toBeNull();
    expect(calls).toBe(1);
  });
});

describe("listFiles", () => {
  const listing = {
    package: "pkg",
    version: "1.0.0",
    prefix: "/",
    files: [{ path: "/index.js", size: 3, type: "text/javascript", integrity: "sha256-xxx" }],
  };

  it("heals a corrupt cached listing", async () => {
    let cache = new FakeCache();
    fakeCaches.set("npm-file-listings", cache);
    await cache.put(
      new Request(`${ORIGIN}/list/pkg@1.0.0/`),
      new Response('{"files": [', { headers: { "Content-Type": "application/json" } })
    );

    let fetchFn = (async () => Response.json(listing)) as typeof fetch;

    let files = await listFiles(context, ORIGIN, "pkg", "1.0.0", "/", fetchOptions(fetchFn));
    expect(files).toEqual(listing.files);
  });

  it("bounds total origin fetches for persistently truncated listings", async () => {
    let fullText = JSON.stringify(listing);
    let calls = 0;
    let fetchFn = (async () => {
      calls++;
      return new Response(fullText.slice(0, 10), {
        headers: {
          "Content-Length": String(fullText.length),
          "Content-Type": "application/json",
        },
      });
    }) as typeof fetch;

    await expect(listFiles(context, ORIGIN, "pkg", "1.0.0", "/", fetchOptions(fetchFn))).rejects.toThrow();
    expect(calls).toBe(3);
  });

  it("bounds total origin fetches for persistently unparseable listings", async () => {
    let calls = 0;
    let fetchFn = (async () => {
      calls++;
      return new Response('{"files": [', { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    await expect(listFiles(context, ORIGIN, "pkg", "1.0.0", "/", fetchOptions(fetchFn))).rejects.toThrow();
    expect(calls).toBe(3);
  });

  it("does not cache an unparseable listing and retries", async () => {
    let calls = 0;
    let fetchFn = (async () => {
      calls++;
      if (calls === 1) {
        return new Response('{"files": [', { headers: { "Content-Type": "application/json" } });
      }
      return Response.json(listing);
    }) as typeof fetch;

    let files = await listFiles(context, ORIGIN, "pkg", "1.0.0", "/", fetchOptions(fetchFn));
    expect(files).toEqual(listing.files);
    expect(calls).toBe(2);
    await flushWaitUntil();

    // Second call is served from the cache written for the good listing.
    let again = await listFiles(context, ORIGIN, "pkg", "1.0.0", "/", fetchOptions(fetchFn));
    expect(again).toEqual(listing.files);
    expect(calls).toBe(2);
  });
});

