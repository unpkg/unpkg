import { expect, describe, it, beforeAll, afterAll } from "bun:test";

import { packageTarballs } from "../../test/fixtures.ts";
import { handleRequest } from "./request-handler.ts";

function dispatchFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let request = input instanceof Request ? input : new Request(input, init);
  return handleRequest(request);
}

function fileResponse(path: string): Response {
  return new Response(Bun.file(path));
}

describe("handleRequest", () => {
  let globalFetch: typeof fetch | undefined;

  beforeAll(() => {
    globalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      let request = input instanceof Request ? input : new Request(input, init);
      let url = new URL(request.url);

      switch (url.href) {
        case "https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.6.tgz":
          return fileResponse(packageTarballs["@ffmpeg/core"]["0.12.6"]);
        case "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz":
          return fileResponse(packageTarballs.lodash["4.17.21"]);
        case "https://registry.npmjs.org/preact/-/preact-10.26.4.tgz":
          return fileResponse(packageTarballs.preact["10.26.4"]);
        case "https://registry.npmjs.org/react/-/react-18.2.0.tgz":
          return fileResponse(packageTarballs.react["18.2.0"]);
        case "https://registry.npmjs.org/missing-package/-/missing-package-0.0.0.tgz":
          return new Response("Not Found", { status: 404 });
        default:
          throw new Error(`Unexpected URL: ${url}`);
      }
    }) as unknown as typeof fetch;
  });

  afterAll(() => {
    if (globalFetch) {
      globalThis.fetch = globalFetch;
    }
  });

  describe("/file requests", () => {
    it("serves a file", async () => {
      let response = await dispatchFetch("https://files.unpkg.com/file/@ffmpeg/core@0.12.6/package.json");
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
    });

    it("serves a file in a subdirectory", async () => {
      let response = await dispatchFetch("https://files.unpkg.com/file/react@18.2.0/cjs/react.development.js");
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toMatch(/^text\/javascript/);
    });

    it("matches package names in any case", async () => {
      let response = await dispatchFetch("https://files.unpkg.com/file/React@18.2.0/package.json");
      expect(response.status).toBe(200);
    });

    it("matches filenames in any case", async () => {
      let response = await dispatchFetch("https://files.unpkg.com/file/react@18.2.0/readme.md");
      expect(response.status).toBe(200);
    });

    it("returns 404 for a missing package name in the URL", async () => {
      let response = await dispatchFetch("https://files.unpkg.com/file");
      expect(response.status).toBe(404);
    });

    it("returns 404 for a missing version in the URL", async () => {
      let response = await dispatchFetch("https://files.unpkg.com/file/react/package.json");
      expect(response.status).toBe(404);
    });

    it("returns 404 for an unresolved version", async () => {
      let response = await dispatchFetch("https://files.unpkg.com/file/react@18/package.json");
      expect(response.status).toBe(404);
    });

    it("returns 404 for a missing filename in the URL", async () => {
      let response = await dispatchFetch("https://files.unpkg.com/file/react@18.2.0/");
      expect(response.status).toBe(404);
    });

    it("returns 404 for a missing package", async () => {
      let response = await dispatchFetch("https://files.unpkg.com/file/missing-package@0.0.0/package.json");
      expect(response.status).toBe(404);
    });

    it("returns 404 for a missing file", async () => {
      let response = await dispatchFetch("https://files.unpkg.com/file/react@18.2.0/missing-file.txt");
      expect(response.status).toBe(404);
    });
  });

  describe("/list requests", () => {
    it("lists the files in a package", async () => {
      let response = await dispatchFetch("https://files.unpkg.com/list/react@18.2.0");
      expect(response.status).toBe(200);
      let json = (await response.json()) as any;
      expect(json.prefix).toBe("/");
      expect(Array.isArray(json.files)).toBe(true);
      expect(json.files.length).toBe(20);
    });

    it("lists the files in a package subdirectory", async () => {
      let response = await dispatchFetch("https://files.unpkg.com/list/react@18.2.0/cjs");
      expect(response.status).toBe(200);
      let json = (await response.json()) as any;
      expect(json.prefix).toBe("/cjs");
      expect(Array.isArray(json.files)).toBe(true);
      expect(json.files.length).toBe(10);
    });

    it("lists the files in a package with more than 1000 files", async () => {
      let response = await dispatchFetch("https://files.unpkg.com/list/lodash@4.17.21");
      expect(response.status).toBe(200);
      let json = (await response.json()) as any;
      expect(json.prefix).toBe("/");
      expect(Array.isArray(json.files)).toBe(true);
      expect(json.files.length).toBe(1054);
    });

    it("returns 404 for a missing package", async () => {
      let response = await dispatchFetch("https://files.unpkg.com/list");
      expect(response.status).toBe(404);
    });

    it("returns 404 for a missing version", async () => {
      let response = await dispatchFetch("https://files.unpkg.com/list/react");
      expect(response.status).toBe(404);
    });

    it("returns 404 for an unresolved version", async () => {
      let response = await dispatchFetch("https://files.unpkg.com/list/react@18");
      expect(response.status).toBe(404);
    });
  });
});
