import { expect, describe, it, beforeAll, afterAll } from "bun:test";

import type { PackageFile } from "unpkg-worker";

import { packageTarballs } from "../../test/fixtures.ts";
import { getFile, listFiles } from "./npm-files.ts";

const publicNpmRegistry = "https://registry.npmjs.org";

describe("npm files", () => {
  let globalFetch: typeof fetch | undefined;

  function fileResponse(file: string): Response {
    return new Response(Bun.file(file));
  }

  beforeAll(() => {
    globalFetch = globalThis.fetch;

    // Does not implement Bun's non-spec fetch.preconnect API - https://bun.sh/docs/api/fetch#preconnect-to-a-host
    // @ts-expect-error
    globalThis.fetch = async (input: RequestInfo | URL) => {
      let url = input instanceof Request ? input.url : input;

      switch (url.toString()) {
        case "https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.6.tgz":
          return fileResponse(packageTarballs["@ffmpeg/core"]["0.12.6"]);
        case "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz":
          return fileResponse(packageTarballs.lodash["4.17.21"]);
        case "https://registry.npmjs.org/preact/-/preact-10.26.4.tgz":
          return fileResponse(packageTarballs.preact["10.26.4"]);
        case "https://registry.npmjs.org/react/-/react-18.2.0.tgz":
          return fileResponse(packageTarballs.react["18.2.0"]);
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

  describe("getFile", () => {
    it("fetches a file from @ffmpeg/core-0.12.6.tgz", async () => {
      let file = (await getFile(
        publicNpmRegistry,
        "@ffmpeg/core",
        "0.12.6",
        "/dist/umd/ffmpeg-core.js"
      )) as PackageFile;
      expect(file).not.toBeNull();
      expect(file.path).toBe("/dist/umd/ffmpeg-core.js");
      expect(file.size).toBe(114673);
      expect(file.type).toBe("text/javascript");
      expect(file.integrity).toMatch(/^sha256-[A-Za-z0-9+/=]{43}=$/);
    });
  });

  describe("listFiles", () => {
    it("lists files in @ffmpeg/core-0.12.6.tgz", async () => {
      let files = await listFiles(publicNpmRegistry, "@ffmpeg/core", "0.12.6");
      expect(files.length).toBe(5);
    });

    it("lists files in lodash-4.17.21.tgz", async () => {
      let files = await listFiles(publicNpmRegistry, "lodash", "4.17.21");
      expect(files.length).toBe(1054);
    });

    it("lists files in preact-10.26.4.tgz", async () => {
      let files = await listFiles(publicNpmRegistry, "preact", "10.26.4");
      expect(files.length).toBe(134);
    });

    it("lists files in react-18.2.0.tgz", async () => {
      let files = await listFiles(publicNpmRegistry, "react", "18.2.0");
      expect(files.length).toBe(20);
    });
  });
});
