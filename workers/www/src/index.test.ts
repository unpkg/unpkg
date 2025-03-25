import * as assert from "node:assert/strict";
import { describe, it, after } from "node:test";

import { miniflare as mf } from "../test/miniflare.ts";

describe("www worker", () => {
  after(() => mf.dispose());

  describe("file requests", () => {
    it("resolves tag", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/react@latest/index.js", { redirect: "manual" });
      assert.equal(response.status, 302);
      let location = response.headers.get("Location");
      assert.ok(location);
      assert.match(location, /^https:\/\/unpkg\.com\/react@\d+\.\d+\.\d+\/index\.js/);
    });

    it("resolves semver range", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/react@^18/index.js", { redirect: "manual" });
      assert.equal(response.status, 302);
      let location = response.headers.get("Location");
      assert.ok(location);
      assert.match(location, /^https:\/\/unpkg\.com\/react@18\.\d+\.\d+\/index\.js/);
    });

    it("resolves tag and filename in a single redirect", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/react@latest", {
        redirect: "manual",
      });
      assert.equal(response.status, 302);
      let location = response.headers.get("Location");
      assert.ok(location);
      assert.match(location, /^https:\/\/unpkg\.com\/react@\d+\.\d+\.\d+\/index\.js/);
    });

    it("resolves semver range and filename in a single redirect", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/react@^18", {
        redirect: "manual",
      });
      assert.equal(response.status, 302);
      let location = response.headers.get("Location");
      assert.ok(location);
      assert.match(location, /^https:\/\/unpkg\.com\/react@18\.\d+\.\d+\/index\.js/);
    });

    it("returns 404 for invalid version specifiers", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/react@not-valid/");
      assert.equal(response.status, 404);
    });

    it("serves a file", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/react@18.2.0/package.json");
      assert.equal(response.status, 200);
      assert.ok(response.headers.has("Access-Control-Allow-Origin"));
      assert.ok(response.headers.has("Cache-Control"));
      assert.ok(response.headers.has("Content-Digest"));
      assert.match(response.headers.get("Content-Type")!, /^application\/json/);
      assert.match(await response.text(), /"name": "react"/);
    });

    it("serves a file in a subdirectory", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/react@18.2.0/cjs/react.development.js");
      assert.equal(response.status, 200);
      assert.ok(response.headers.has("Access-Control-Allow-Origin"));
      assert.ok(response.headers.has("Cache-Control"));
      assert.ok(response.headers.has("Content-Digest"));
      assert.match(response.headers.get("Content-Type")!, /^text\/javascript/);
      assert.match(await response.text(), /React.createElement/);
    });

    it("matches filenames in a case-insensitive way", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/react@18.2.0/readme.md");
      assert.equal(response.status, 200);
    });

    it("returns 404 for a missing file", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/react@18.2.0/missing-file.txt");
      assert.equal(response.status, 404);
    });

    it('serves JavaScript files with "charset=utf-8"', async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/react@18.2.0");
      assert.equal(response.status, 200);
      assert.match(response.headers.get("Content-Type")!, /^text\/javascript; charset=utf-8/);
    });

    describe("the unpkg field in package.json", () => {
      it("resolves files correctly", async () => {
        let response = await mf.dispatchFetch("https://unpkg.com/preact@10.25.4", { redirect: "manual" });
        assert.equal(response.status, 302);
        let location = response.headers.get("Location");
        assert.ok(location);
        assert.equal(location, "https://unpkg.com/preact@10.25.4/dist/preact.min.js");
      });

      it('resolves using "exports" field when conditions are present', async () => {
        let response = await mf.dispatchFetch("https://unpkg.com/preact@10.25.4?conditions=browser", {
          redirect: "manual",
        });
        assert.equal(response.status, 302);
        let location = response.headers.get("Location");
        assert.ok(location);
        assert.equal(location, "https://unpkg.com/preact@10.25.4/dist/preact.module.js?conditions=browser");
      });
    });

    it('resolves using "exports" field in package.json', async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/react@19.0.0", {
        redirect: "manual",
      });
      assert.equal(response.status, 302);
      let location = response.headers.get("Location");
      assert.ok(location);
      assert.equal(location, "https://unpkg.com/react@19.0.0/index.js");
    });

    it('resolves using "exports" field and the "default" condition in package.json', async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/react@19.0.0?conditions=default", {
        redirect: "manual",
      });
      assert.equal(response.status, 302);
      let location = response.headers.get("Location");
      assert.ok(location);
      assert.equal(location, "https://unpkg.com/react@19.0.0/index.js?conditions=default");
    });

    it('resolves using "exports" field and a custom condition in package.json', async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/react@19.0.0?conditions=react-server", {
        redirect: "manual",
      });
      assert.equal(response.status, 302);
      let location = response.headers.get("Location");
      assert.ok(location);
      assert.equal(location, "https://unpkg.com/react@19.0.0/react.react-server.js?conditions=react-server");
    });

    it('resolves using a custom filename with "exports" field in package.json', async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/react@19.0.0/compiler-runtime", { redirect: "manual" });
      assert.equal(response.status, 302);
      let location = response.headers.get("Location");
      assert.ok(location);
      assert.equal(location, "https://unpkg.com/react@19.0.0/compiler-runtime.js");
    });

    it('resolves using a custom filename with "exports" field and custom conditions in package.json', async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/preact@10.25.4/hooks?conditions=import", {
        redirect: "manual",
      });
      assert.equal(response.status, 302);
      let location = response.headers.get("Location");
      assert.ok(location);
      assert.equal(location, "https://unpkg.com/preact@10.25.4/hooks/dist/hooks.mjs?conditions=import");
    });

    it('resolves to "main" when "exports" field has no "default" condition', async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/vitessce@3.5.9", {
        redirect: "manual",
      });
      assert.equal(response.status, 302);
      let location = response.headers.get("Location");
      assert.ok(location);
      assert.equal(location, "https://unpkg.com/vitessce@3.5.9/dist/index.min.js");
    });

    it("resolves to a matching .js file when the extension is missing", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/preact@10.26.4/src/component", {
        redirect: "manual",
      });
      assert.equal(response.status, 302);
      let location = response.headers.get("Location");
      assert.ok(location);
      assert.equal(location, "https://unpkg.com/preact@10.26.4/src/component.js");
    });

    it("resolves to an index.js file when a directory is requested", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/preact@10.26.4/src", {
        redirect: "manual",
      });
      assert.equal(response.status, 302);
      let location = response.headers.get("Location");
      assert.ok(location);
      assert.equal(location, "https://unpkg.com/preact@10.26.4/src/index.js");
    });
  });

  describe("?meta requests", () => {
    it("redirects to a trailing / on the root package request", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/react@18.2.0?meta", { redirect: "manual" });
      assert.equal(response.status, 302);
      let location = response.headers.get("Location");
      assert.ok(location);
      assert.equal(location, "https://unpkg.com/react@18.2.0/?meta");
    });

    it("resolves semver range", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/react@^18/?meta", { redirect: "manual" });
      assert.equal(response.status, 302);
      let location = response.headers.get("Location");
      assert.ok(location);
      assert.match(location, /^https:\/\/unpkg\.com\/react@18\.\d+\.\d+\/\?meta$/);
    });

    it("resolves both semver and trailing / in a single redirect", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/react@^18?meta", { redirect: "manual" });
      assert.equal(response.status, 302);
      let location = response.headers.get("Location");
      assert.ok(location);
      assert.match(location, /^https:\/\/unpkg\.com\/react@18\.\d+\.\d+\/\?meta$/);
    });

    it("lists the files in a package", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/react@18.2.0/?meta");
      assert.equal(response.status, 200);
      let json = (await response.json()) as any;
      assert.equal(json.prefix, "/");
      assert.ok(Array.isArray(json.files));
      assert.equal(json.files.length, 20);
    });

    it("lists the files in a package subdirectory", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/react@18.2.0/cjs?meta");
      assert.equal(response.status, 200);
      let json = (await response.json()) as any;
      assert.equal(json.prefix, "/cjs/");
      assert.ok(Array.isArray(json.files));
      assert.equal(json.files.length, 10);
    });

    it("lists the files in a package with more than 1000 files", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/lodash@4.17.21/?meta");
      assert.equal(response.status, 200);
      let json = (await response.json()) as any;
      assert.equal(json.prefix, "/");
      assert.ok(Array.isArray(json.files));
      assert.equal(json.files.length, 1054);
    });
  });

  describe("?module requests", () => {
    it("rewrites imports in JavaScript files", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/preact@10.26.4/src/component.js?module");
      assert.equal(response.status, 200);
      let text = await response.text();
      assert.match(text, /import { assign } from '\.\/util\?module';/);
    });
  });

  describe("/browse/* requests", () => {
    it("redirects to the package root", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/browse/react@18.2.0/", { redirect: "manual" });
      assert.equal(response.status, 302);
      let location = response.headers.get("Location");
      assert.ok(location);
      assert.equal(location, "https://app.unpkg.com/react@18.2.0");
    });

    it("redirects to a specific file in the package root", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/browse/react@18.2.0/package.json", {
        redirect: "manual",
      });
      assert.equal(response.status, 302);
      let location = response.headers.get("Location");
      assert.ok(location);
      assert.equal(location, "https://app.unpkg.com/react@18.2.0/files/package.json");
    });

    it("redirects to a subdirectory", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/browse/react@18.2.0/cjs/", { redirect: "manual" });
      assert.equal(response.status, 302);
      let location = response.headers.get("Location");
      assert.ok(location);
      assert.equal(location, "https://app.unpkg.com/react@18.2.0/files/cjs");
    });

    it("redirects to a specific file in a subdirectory", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/browse/react@18.2.0/cjs/react.development.js", {
        redirect: "manual",
      });
      assert.equal(response.status, 302);
      let location = response.headers.get("Location");
      assert.ok(location);
      assert.equal(location, "https://app.unpkg.com/react@18.2.0/files/cjs/react.development.js");
    });
  });

  describe("/pkg/ index requests", () => {
    it("redirects the package root", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/react@18.2.0/", {
        redirect: "manual",
      });
      assert.equal(response.status, 302);
      let location = response.headers.get("Location");
      assert.ok(location);
      assert.equal(location, "https://app.unpkg.com/react@18.2.0");
    });

    it("redirects a subdirectory", async () => {
      let response = await mf.dispatchFetch("https://unpkg.com/react@18.2.0/cjs/", { redirect: "manual" });
      assert.equal(response.status, 302);
      let location = response.headers.get("Location");
      assert.ok(location);
      assert.equal(location, "https://app.unpkg.com/react@18.2.0/files/cjs");
    });
  });
});
