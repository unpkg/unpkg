import { expect, describe, it, beforeAll, afterAll } from "bun:test";

import { packageInfo } from "../test/fixtures.ts";
import type { Env } from "./env.ts";
import { handleRequest } from "./request-handler.tsx";

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

function dispatchFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let request = input instanceof Request ? input : new Request(input, init);
  return handleRequest(request, env, context);
}

function fileResponse(path: string): Response {
  return new Response(Bun.file(path));
}

describe("handleRequest", () => {
  let globalCaches: CacheStorage | undefined;
  let globalFetch: typeof fetch | undefined;

  beforeAll(() => {
    globalCaches = globalThis.caches;
    globalFetch = globalThis.fetch;

    globalThis.caches = {
      async open() {
        return {
          async match() {
            return null;
          },
          async put() {},
        };
      },
    } as unknown as CacheStorage;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      let url = input instanceof Request ? input.url : input;

      switch (url.toString()) {
        case "https://registry.npmjs.org/react":
          return fileResponse(packageInfo.react);
        default:
          throw new Error(`Unexpected URL: ${url}`);
      }
    }) as unknown as typeof fetch;
  });

  afterAll(() => {
    if (globalCaches) globalThis.caches = globalCaches;
    if (globalFetch) globalThis.fetch = globalFetch;
  });

  it("redirects / to unpkg.com", async () => {
    let response = await dispatchFetch("https://app.unpkg.com/", { redirect: "manual" });
    expect(response.status).toBe(301);
    let location = response.headers.get("Location");
    expect(location).toBeTruthy();
    expect(location).toBe("https://unpkg.com");
  });

  it("redirects trailing / to the bare URL", async () => {
    let response = await dispatchFetch("https://app.unpkg.com/react@18.2.0/", { redirect: "manual" });
    expect(response.status).toBe(301);
    let location = response.headers.get("Location");
    expect(location).toBe("/react@18.2.0");
  });

  it('redirects "/:package/files" to "/package@version"', async () => {
    let response = await dispatchFetch("https://app.unpkg.com/react/files", { redirect: "manual" });
    expect(response.status).toBe(301);
    let location = response.headers.get("Location");
    expect(location).toMatch(/^\/react@\d+\.\d+\.\d+$/);
  });

  it("matches package names in any case", async () => {
    let response = await dispatchFetch("https://app.unpkg.com/React/files", { redirect: "manual" });
    expect(response.status).toBe(301);
    let location = response.headers.get("Location");
    expect(location).toMatch(/^\/react@\d+\.\d+\.\d+$/);
  });

  it('redirects "/:package@:version/files" to "/package@version"', async () => {
    let response = await dispatchFetch("https://app.unpkg.com/react@18.2.0/files", { redirect: "manual" });
    expect(response.status).toBe(301);
    let location = response.headers.get("Location");
    expect(location).toBe("/react@18.2.0");
  });

  it("resolves semver range on package root", async () => {
    let response = await dispatchFetch("https://app.unpkg.com/react@18", { redirect: "manual" });
    expect(response.status).toBe(302);
    let location = response.headers.get("Location");
    expect(location).toBeTruthy();
    expect(location).toMatch(/^\/react@18\.\d+\.\d+$/);
  });

  it("resolves semver range on specific filename", async () => {
    let response = await dispatchFetch("https://app.unpkg.com/react@18/files/index.js", { redirect: "manual" });
    expect(response.status).toBe(302);
    let location = response.headers.get("Location");
    expect(location).toBeTruthy();
    expect(location).toMatch(/^\/react@18\.\d+\.\d+\/files\/index\.js$/);
  });

  it("resolves http: protocol to https:", async () => {
    let response = await dispatchFetch("http://app.unpkg.com/react@18/files/index.js", { redirect: "manual" });
    expect(response.status).toBe(302);
    let location = response.headers.get("Location");
    expect(location).toBeTruthy();
    expect(location).toMatch(/^\/react@18\.\d+\.\d+\/files\/index\.js$/);
  });

  it("resolves npm tags", async () => {
    let response = await dispatchFetch("https://app.unpkg.com/react@latest/files/index.js", { redirect: "manual" });
    expect(response.status).toBe(302);
    let location = response.headers.get("Location");
    expect(location).toBeTruthy();
    expect(location).toMatch(/^\/react@\d+\.\d+\.\d+\/files\/index\.js$/);
  });
});
