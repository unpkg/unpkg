import * as assert from "node:assert/strict";
import { describe, it, after } from "node:test";

import { miniflare as mf } from "../test/miniflare.ts";

describe("app worker", () => {
  after(() => mf.dispose());

  it("redirects / to unpkg.com", async () => {
    let response = await mf.dispatchFetch("https://app.unpkg.com/", {
      redirect: "manual",
    });
    assert.equal(response.status, 302);
    let location = response.headers.get("Location");
    assert.ok(location);
    assert.equal(location, "https://unpkg.com");
  });

  it("redirects trailing / to the bare URL", async () => {
    let response = await mf.dispatchFetch("https://app.unpkg.com/react@18.2.0/", { redirect: "manual" });
    assert.equal(response.status, 301);
    let location = response.headers.get("Location");
    assert.ok(location);
    assert.equal(location, "https://app.unpkg.com/react@18.2.0");
  });

  it('redirects "/package/files" to "/package@version"', async () => {
    let response = await mf.dispatchFetch("https://app.unpkg.com/react/files", {
      redirect: "manual",
    });
    assert.equal(response.status, 302);
    let location = response.headers.get("Location");
    assert.ok(location);
    assert.match(location, /^https:\/\/app\.unpkg\.com\/react@\d+\.\d+\.\d+$/);
  });

  it("resolves semver ranges", async () => {
    let response = await mf.dispatchFetch("https://app.unpkg.com/react@18/files/index.js", {
      redirect: "manual",
    });
    assert.equal(response.status, 302);
    let location = response.headers.get("Location");
    assert.ok(location);
    assert.match(location, /^https:\/\/app\.unpkg\.com\/react@18\.\d+\.\d+\/files\/index\.js$/);
  });

  it("resolves npm tags", async () => {
    let response = await mf.dispatchFetch("https://app.unpkg.com/react@latest/files/index.js", { redirect: "manual" });
    assert.equal(response.status, 302);
    let location = response.headers.get("Location");
    assert.ok(location);
    assert.match(location, /^https:\/\/app\.unpkg\.com\/react@\d+\.\d+\.\d+\/files\/index\.js$/);
  });
});
