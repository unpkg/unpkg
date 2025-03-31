import * as assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import * as fs from "node:fs";

import { packageInfo } from "../test/fixtures.ts";
import { handleRequest } from "./request-handler.tsx";

function dispatchFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let request = input instanceof Request ? input : new Request(input, init);
  return handleRequest(request);
}

describe("app request handler", () => {
  let globalFetch: typeof fetch | undefined;

  function infoResponse(infoPath: string): Response {
    let json = fs.readFileSync(infoPath, "utf8");
    return new Response(json, {
      headers: { "Content-Type": "application/json" },
    });
  }

  before(() => {
    globalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      let url = input instanceof Request ? input.url : input;

      switch (url.toString()) {
        case "https://registry.npmjs.org/react":
          return infoResponse(packageInfo.react);
        default:
          throw new Error(`Unexpected URL: ${url}`);
      }
    };
  });

  after(() => {
    if (globalFetch) {
      globalThis.fetch = globalFetch;
    }
  });

  it("redirects / to unpkg.com", async () => {
    let response = await dispatchFetch("https://app.unpkg.com/", { redirect: "manual" });
    assert.equal(response.status, 301);
    let location = response.headers.get("Location");
    assert.ok(location);
    assert.equal(location, "https://unpkg.com");
  });

  it("redirects trailing / to the bare URL", async () => {
    let response = await dispatchFetch("https://app.unpkg.com/react@18.2.0/", { redirect: "manual" });
    assert.equal(response.status, 301);
    let location = response.headers.get("Location");
    assert.ok(location);
    assert.equal(location, "https://app.unpkg.com/react@18.2.0");
  });

  it('redirects "/package/files" to "/package@version"', async () => {
    let response = await dispatchFetch("https://app.unpkg.com/react/files", { redirect: "manual" });
    assert.equal(response.status, 301);
    let location = response.headers.get("Location");
    assert.ok(location);
    assert.match(location, /^https:\/\/app\.unpkg\.com\/react@\d+\.\d+\.\d+$/);
  });

  it("resolves semver range on package root", async () => {
    let response = await dispatchFetch("https://app.unpkg.com/react@18", { redirect: "manual" });
    assert.equal(response.status, 302);
    let location = response.headers.get("Location");
    assert.ok(location);
    assert.match(location, /^https:\/\/app\.unpkg\.com\/react@18\.\d+\.\d+$/);
  });

  it("resolves semver range on specific filename", async () => {
    let response = await dispatchFetch("https://app.unpkg.com/react@18/files/index.js", { redirect: "manual" });
    assert.equal(response.status, 302);
    let location = response.headers.get("Location");
    assert.ok(location);
    assert.match(location, /^https:\/\/app\.unpkg\.com\/react@18\.\d+\.\d+\/files\/index\.js$/);
  });

  it("resolves npm tags", async () => {
    let response = await dispatchFetch("https://app.unpkg.com/react@latest/files/index.js", { redirect: "manual" });
    assert.equal(response.status, 302);
    let location = response.headers.get("Location");
    assert.ok(location);
    assert.match(location, /^https:\/\/app\.unpkg\.com\/react@\d+\.\d+\.\d+\/files\/index\.js$/);
  });
});
