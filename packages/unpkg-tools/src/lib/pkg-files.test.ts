import * as assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import * as fs from "node:fs";
import * as streamWeb from "node:stream/web";

import { packageTarballs } from "../../test/fixtures.ts";
import { getFile, listFiles } from "./pkg-files.ts";

const publicNpmRegistry = "https://registry.npmjs.org";

describe("pkg-files", () => {
  let globalFetch: typeof fetch | undefined;

  function tarballResponse(tarball: string): Response {
    let nodeStream = fs.createReadStream(tarball);
    let stream = streamWeb.ReadableStream.from(nodeStream) as unknown as ReadableStream<Uint8Array>;
    return new Response(stream, {
      headers: { "Content-Type": "application/octet-stream" },
    });
  }

  before(() => {
    globalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      let url = input instanceof Request ? input.url : input;

      switch (url.toString()) {
        case "https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.6.tgz":
          return tarballResponse(packageTarballs["@ffmpeg/core"]["0.12.6"]);
        case "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz":
          return tarballResponse(packageTarballs.lodash["4.17.21"]);
        case "https://registry.npmjs.org/material/-/material-5.16.7.tgz":
          return tarballResponse(packageTarballs.material["5.16.7"]);
        case "https://registry.npmjs.org/moment/-/moment-2.29.0.tgz":
          return tarballResponse(packageTarballs.moment["2.29.0"]);
        case "https://registry.npmjs.org/preact/-/preact-10.26.4.tgz":
          return tarballResponse(packageTarballs.preact["10.26.4"]);
        case "https://registry.npmjs.org/react/-/react-18.2.0.tgz":
          return tarballResponse(packageTarballs.react["18.2.0"]);
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

  describe("getFile", () => {
    it("fetches a file from @ffmpeg/core-0.12.6.tgz", async () => {
      let file = await getFile(publicNpmRegistry, "@ffmpeg/core", "0.12.6", "/dist/umd/ffmpeg-core.js");
      assert.ok(file);
      assert.equal(file.path, "/dist/umd/ffmpeg-core.js");
      assert.equal(file.size, 114673);
      assert.equal(file.type, "text/javascript");
      assert.match(file.integrity, /^sha256-[A-Za-z0-9+/=]{43}=$/);
    });
  });

  describe("listFiles", () => {
    it("lists files in @ffmpeg/core-0.12.6.tgz", async () => {
      let files = await listFiles(publicNpmRegistry, "@ffmpeg/core", "0.12.6");
      assert.equal(files.length, 5);
    });

    it("lists files in lodash-4.17.21.tgz", async () => {
      let files = await listFiles(publicNpmRegistry, "lodash", "4.17.21");
      assert.equal(files.length, 1054);
    });

    it("lists files in material-5.16.7.tgz", async () => {
      let files = await listFiles(publicNpmRegistry, "material", "5.16.7");
      assert.equal(files.length, 2923);
    });

    it("lists files in moment-2.29.0.tgz", async () => {
      let files = await listFiles(publicNpmRegistry, "moment", "2.29.0");
      assert.equal(files.length, 533);
    });

    it("lists files in preact-10.26.4.tgz", async () => {
      let files = await listFiles(publicNpmRegistry, "preact", "10.26.4");
      assert.equal(files.length, 134);
    });

    it("lists files in react-18.2.0.tgz", async () => {
      let files = await listFiles(publicNpmRegistry, "react", "18.2.0");
      assert.equal(files.length, 20);
    });
  });
});
