import { expect, describe, it, beforeAll, afterAll } from "bun:test";

import { packageInfo } from "../test/fixtures.ts";
import { handleRequest } from "./request-handler.tsx";

function dispatchFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let request = input instanceof Request ? input : new Request(input, init);
  return handleRequest(request);
}

describe("handleRequest", () => {
  let globalFetch: typeof fetch | undefined;

  function fileResponse(path: string): Response {
    return new Response(Bun.file(path));
  }

  beforeAll(() => {
    globalFetch = globalThis.fetch;

    // Does not implement Bun's non-spec fetch.preconnect API - https://bun.sh/docs/api/fetch#preconnect-to-a-host
    // @ts-expect-error
    globalThis.fetch = async (input: RequestInfo | URL) => {
      let url = input instanceof Request ? input.url : input;

      switch (url.toString()) {
        case "https://registry.npmjs.org/react":
          return fileResponse(packageInfo.react);
        default:
          throw new Error(`Unexpected URL: ${url}`);
      }
    };
  });

  afterAll(() => {
    if (globalFetch) {
      globalThis.fetch = globalFetch;
    }
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
    expect(location).toBeTruthy();
    expect(location).toBe("https://app.unpkg.com/react@18.2.0");
  });

  it('redirects "/package/files" to "/package@version"', async () => {
    let response = await dispatchFetch("https://app.unpkg.com/react/files", { redirect: "manual" });
    expect(response.status).toBe(301);
    let location = response.headers.get("Location");
    expect(location).toBeTruthy();
    expect(location).toMatch(/^https:\/\/app\.unpkg\.com\/react@\d+\.\d+\.\d+$/);
  });

  it("resolves semver range on package root", async () => {
    let response = await dispatchFetch("https://app.unpkg.com/react@18", { redirect: "manual" });
    expect(response.status).toBe(302);
    let location = response.headers.get("Location");
    expect(location).toBeTruthy();
    expect(location).toMatch(/^https:\/\/app\.unpkg\.com\/react@18\.\d+\.\d+$/);
  });

  it("resolves semver range on specific filename", async () => {
    let response = await dispatchFetch("https://app.unpkg.com/react@18/files/index.js", { redirect: "manual" });
    expect(response.status).toBe(302);
    let location = response.headers.get("Location");
    expect(location).toBeTruthy();
    expect(location).toMatch(/^https:\/\/app\.unpkg\.com\/react@18\.\d+\.\d+\/files\/index\.js$/);
  });

  it("resolves http: protocol to https:", async () => {
    let response = await dispatchFetch("http://app.unpkg.com/react@18/files/index.js", { redirect: "manual" });
    expect(response.status).toBe(302);
    let location = response.headers.get("Location");
    expect(location).toBeTruthy();
    expect(location).toMatch(/^https:\/\/app\.unpkg\.com\/react@18\.\d+\.\d+\/files\/index\.js$/);
  });

  it("resolves npm tags", async () => {
    let response = await dispatchFetch("https://app.unpkg.com/react@latest/files/index.js", { redirect: "manual" });
    expect(response.status).toBe(302);
    let location = response.headers.get("Location");
    expect(location).toBeTruthy();
    expect(location).toMatch(/^https:\/\/app\.unpkg\.com\/react@\d+\.\d+\.\d+\/files\/index\.js$/);
  });
});
