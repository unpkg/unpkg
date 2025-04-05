import { expect, describe, it, beforeAll, afterAll } from "bun:test";
import type { ExecutionContext } from "@cloudflare/workers-types";
import { handleRequest as handleFilesRequest } from "unpkg-files";

import { packageInfo, packageTarballs } from "../test/fixtures.ts";
import type { Env } from "./env.ts";
import { handleRequest } from "./request-handler.tsx";

const env: Env = {
  APP_ORIGIN: "https://app.unpkg.com",
  ASSETS_ORIGIN: "https://unpkg.com",
  DEV: false,
  FILES_ORIGIN: "https://files.unpkg.com",
  MODE: "test",
  ORIGIN: "https://unpkg.com",
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

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      let request = input instanceof Request ? input : new Request(input, init);
      let url = new URL(request.url);

      if (url.origin === env.FILES_ORIGIN) {
        // Run the request through the file server. This allows us to write integration tests
        // that run without booting the file server.
        return handleFilesRequest(request);
      }

      switch (url.href) {
        case "https://registry.npmjs.org/lodash":
          return fileResponse(packageInfo.lodash);
        case "https://registry.npmjs.org/preact":
          return fileResponse(packageInfo.preact);
        case "https://registry.npmjs.org/react":
          return fileResponse(packageInfo.react);
        case "https://registry.npmjs.org/vitessce":
          return fileResponse(packageInfo.vitessce);
        case "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz":
          return fileResponse(packageTarballs.lodash["4.17.21"]);
        case "https://registry.npmjs.org/preact/-/preact-10.26.4.tgz":
          return fileResponse(packageTarballs.preact["10.26.4"]);
        case "https://registry.npmjs.org/react/-/react-18.2.0.tgz":
          return fileResponse(packageTarballs.react["18.2.0"]);
        case "https://registry.npmjs.org/vitessce/-/vitessce-3.5.9.tgz":
          return fileResponse(packageTarballs.vitessce["3.5.9"]);
        default:
          throw new Error(`Unexpected URL: ${url}`);
      }
    }) as unknown as typeof fetch;
  });

  afterAll(() => {
    if (globalCaches) globalThis.caches = globalCaches;
    if (globalFetch) globalThis.fetch = globalFetch;
  });

  describe("file requests", () => {
    it("returns 404 for invalid version specifiers", async () => {
      let response = await dispatchFetch("https://unpkg.com/react@not-valid/");
      expect(response.status).toBe(404);
    });

    it("serves a file", async () => {
      let response = await dispatchFetch("https://unpkg.com/react@18.2.0/package.json");
      expect(response.status).toBe(200);
      expect(response.headers.has("Access-Control-Allow-Origin")).toBeTruthy();
      expect(response.headers.has("Cache-Control")).toBeTruthy();
      expect(response.headers.has("Content-Digest")).toBeTruthy();
      expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
      expect(await response.text()).toMatch(/"name": "react"/);
    });

    it("serves a file in a subdirectory", async () => {
      let response = await dispatchFetch("https://unpkg.com/react@18.2.0/cjs/react.development.js");
      expect(response.status).toBe(200);
      expect(response.headers.has("Access-Control-Allow-Origin")).toBeTruthy();
      expect(response.headers.has("Cache-Control")).toBeTruthy();
      expect(response.headers.has("Content-Digest")).toBeTruthy();
      expect(response.headers.get("Content-Type")).toMatch(/^text\/javascript/);
      expect(await response.text()).toMatch(/React.createElement/);
    });

    it("matches package names in any case", async () => {
      let response = await dispatchFetch("https://unpkg.com/React@18.2.0/package.json");
      expect(response.status).toBe(200);
    });

    it("matches filenames in any case", async () => {
      let response = await dispatchFetch("https://unpkg.com/react@18.2.0/readme.md");
      expect(response.status).toBe(200);
    });

    it("returns 404 for a missing file", async () => {
      let response = await dispatchFetch("https://unpkg.com/react@18.2.0/missing-file.txt");
      expect(response.status).toBe(404);
    });

    it("resolves npm tags", async () => {
      let response = await dispatchFetch("https://unpkg.com/react@latest/index.js", { redirect: "manual" });
      expect(response.status).toBe(302);
      let location = response.headers.get("Location");
      expect(location).not.toBeNull();
      expect(location).toMatch(/^\/react@\d+\.\d+\.\d+\/index\.js/);
    });

    it("resolves npm tag and filename in a single redirect", async () => {
      let response = await dispatchFetch("https://unpkg.com/react@latest", { redirect: "manual" });
      expect(response.status).toBe(302);
      let location = response.headers.get("Location");
      expect(location).not.toBeNull();
      expect(location).toMatch(/^\/react@\d+\.\d+\.\d+\/index\.js/);
    });

    it("resolves semver ranges", async () => {
      let response = await dispatchFetch("https://unpkg.com/react@^18/index.js", { redirect: "manual" });
      expect(response.status).toBe(302);
      let location = response.headers.get("Location");
      expect(location).not.toBeNull();
      expect(location).toMatch(/^\/react@18\.\d+\.\d+\/index\.js/);
    });

    it("resolves semver range and filename in a single redirect", async () => {
      let response = await dispatchFetch("https://unpkg.com/react@^18", { redirect: "manual" });
      expect(response.status).toBe(302);
      let location = response.headers.get("Location");
      expect(location).not.toBeNull();
      expect(location).toMatch(/^\/react@18\.\d+\.\d+\/index\.js/);
    });

    it('serves JavaScript files with "charset=utf-8"', async () => {
      let response = await dispatchFetch("https://unpkg.com/react@18.2.0/index.js");
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toMatch(/^text\/javascript; charset=utf-8/);
    });

    it('resolves using "exports" field in package.json', async () => {
      let response = await dispatchFetch("https://unpkg.com/react@19.0.0", { redirect: "manual" });
      expect(response.status).toBe(301);
      let location = response.headers.get("Location");
      expect(location).not.toBeNull();
      expect(location).toBe("/react@19.0.0/index.js");
    });

    it('resolves using "exports" field and the "default" condition in package.json', async () => {
      let response = await dispatchFetch("https://unpkg.com/react@19.0.0?conditions=default", { redirect: "manual" });
      expect(response.status).toBe(301);
      let location = response.headers.get("Location");
      expect(location).not.toBeNull();
      expect(location).toBe("/react@19.0.0/index.js?conditions=default");
    });

    it('resolves using "exports" field and a custom condition in package.json', async () => {
      let response = await dispatchFetch("https://unpkg.com/react@19.0.0?conditions=react-server", {
        redirect: "manual",
      });
      expect(response.status).toBe(301);
      let location = response.headers.get("Location");
      expect(location).not.toBeNull();
      expect(location).toBe("/react@19.0.0/react.react-server.js?conditions=react-server");
    });

    it('resolves using a custom filename with "exports" field in package.json', async () => {
      let response = await dispatchFetch("https://unpkg.com/react@19.0.0/compiler-runtime", { redirect: "manual" });
      expect(response.status).toBe(301);
      let location = response.headers.get("Location");
      expect(location).not.toBeNull();
      expect(location).toBe("/react@19.0.0/compiler-runtime.js");
    });

    it('resolves using a custom filename with "exports" field and custom conditions in package.json', async () => {
      let response = await dispatchFetch("https://unpkg.com/preact@10.25.4/hooks?conditions=import", {
        redirect: "manual",
      });
      expect(response.status).toBe(301);
      let location = response.headers.get("Location");
      expect(location).not.toBeNull();
      expect(location).toBe("/preact@10.25.4/hooks/dist/hooks.mjs?conditions=import");
    });

    it('resolves to "main" when "exports" field has no "default" condition', async () => {
      let response = await dispatchFetch("https://unpkg.com/vitessce@3.5.9", { redirect: "manual" });
      expect(response.status).toBe(301);
      let location = response.headers.get("Location");
      expect(location).not.toBeNull();
      expect(location).toBe("/vitessce@3.5.9/dist/index.min.js");
    });

    it("resolves to a matching .js file when the extension is missing", async () => {
      let response = await dispatchFetch("https://unpkg.com/preact@10.26.4/src/component", { redirect: "manual" });
      expect(response.status).toBe(301);
      let location = response.headers.get("Location");
      expect(location).not.toBeNull();
      expect(location).toBe("/preact@10.26.4/src/component.js");
    });

    it("resolves to an index.js file when a directory is requested", async () => {
      let response = await dispatchFetch("https://unpkg.com/preact@10.26.4/src", { redirect: "manual" });
      expect(response.status).toBe(301);
      let location = response.headers.get("Location");
      expect(location).not.toBeNull();
      expect(location).toBe("/preact@10.26.4/src/index.js");
    });

    describe("the unpkg field in package.json", () => {
      it("resolves files correctly", async () => {
        let response = await dispatchFetch("https://unpkg.com/preact@10.25.4", { redirect: "manual" });
        expect(response.status).toBe(301);
        let location = response.headers.get("Location");
        expect(location).not.toBeNull();
        expect(location).toBe("/preact@10.25.4/dist/preact.min.js");
      });

      it('resolves using "exports" field when conditions are present', async () => {
        let response = await dispatchFetch("https://unpkg.com/preact@10.25.4?conditions=browser", {
          redirect: "manual",
        });
        expect(response.status).toBe(301);
        let location = response.headers.get("Location");
        expect(location).not.toBeNull();
        expect(location).toBe("/preact@10.25.4/dist/preact.module.js?conditions=browser");
      });
    });
  });

  describe("?meta requests", () => {
    it("resolves semver range with a relative, temporary redirect", async () => {
      let response = await dispatchFetch("https://unpkg.com/react@^18?meta", { redirect: "manual" });
      expect(response.status).toBe(302);
      let location = response.headers.get("Location");
      expect(location).not.toBeNull();
      expect(location).toMatch(/^\/react@18\.\d+\.\d+\/\?meta$/);
    });

    it("lists the files in a package", async () => {
      let response = await dispatchFetch("https://unpkg.com/react@18.2.0/?meta");
      expect(response.status).toBe(200);
      let json = (await response.json()) as any;
      expect(json.prefix).toBe("/");
      expect(Array.isArray(json.files)).toBeTruthy();
      expect(json.files.length).toBe(20);
    });

    it("lists the files in a package subdirectory", async () => {
      let response = await dispatchFetch("https://unpkg.com/react@18.2.0/cjs?meta");
      expect(response.status).toBe(200);
      let json = (await response.json()) as any;
      expect(json.prefix).toBe("/cjs/");
      expect(Array.isArray(json.files)).toBeTruthy();
      expect(json.files.length).toBe(10);
    });

    it("lists the files in a package with more than 1000 files", async () => {
      let response = await dispatchFetch("https://unpkg.com/lodash@4.17.21/?meta");
      expect(response.status).toBe(200);
      let json = (await response.json()) as any;
      expect(json.prefix).toBe("/");
      expect(Array.isArray(json.files)).toBeTruthy();
      expect(json.files.length).toBe(1054);
    });
  });

  describe("?module requests", () => {
    it("rewrites imports in JavaScript files", async () => {
      let response = await dispatchFetch("https://unpkg.com/preact@10.26.4/src/component.js?module");
      expect(response.status).toBe(200);
      let text = await response.text();
      expect(text).toMatch(/import { assign } from '\.\/util\?module';/);
    });
  });

  describe("/browse/* requests", () => {
    it("redirects to the package root", async () => {
      let response = await dispatchFetch("https://unpkg.com/browse/react@18.2.0/", { redirect: "manual" });
      expect(response.status).toBe(301);
      let location = response.headers.get("Location");
      expect(location).not.toBeNull();
      expect(location).toBe("https://app.unpkg.com/react@18.2.0");
    });

    it("redirects to a specific file in the package root", async () => {
      let response = await dispatchFetch("https://unpkg.com/browse/react@18.2.0/package.json", { redirect: "manual" });
      expect(response.status).toBe(301);
      let location = response.headers.get("Location");
      expect(location).not.toBeNull();
      expect(location).toBe("https://app.unpkg.com/react@18.2.0/files/package.json");
    });

    it("redirects to a subdirectory", async () => {
      let response = await dispatchFetch("https://unpkg.com/browse/react@18.2.0/cjs/", { redirect: "manual" });
      expect(response.status).toBe(301);
      let location = response.headers.get("Location");
      expect(location).not.toBeNull();
      expect(location).toBe("https://app.unpkg.com/react@18.2.0/files/cjs");
    });

    it("redirects to a specific file in a subdirectory", async () => {
      let response = await dispatchFetch("https://unpkg.com/browse/react@18.2.0/cjs/react.development.js", {
        redirect: "manual",
      });
      expect(response.status).toBe(301);
      let location = response.headers.get("Location");
      expect(location).not.toBeNull();
      expect(location).toBe("https://app.unpkg.com/react@18.2.0/files/cjs/react.development.js");
    });
  });

  describe("/pkg/ index requests", () => {
    it("resolves semver range with a temporary redirect", async () => {
      let response = await dispatchFetch("https://unpkg.com/react@18/", { redirect: "manual" });
      expect(response.status).toBe(302);
      let location = response.headers.get("Location");
      expect(location).not.toBeNull();
      expect(location).toMatch(/^https:\/\/app\.unpkg\.com\/react@18\.\d+\.\d+/);
    });

    it("redirects the package root", async () => {
      let response = await dispatchFetch("https://unpkg.com/react@18.2.0/", { redirect: "manual" });
      expect(response.status).toBe(301);
      let location = response.headers.get("Location");
      expect(location).not.toBeNull();
      expect(location).toBe("https://app.unpkg.com/react@18.2.0");
    });

    it("redirects a subdirectory", async () => {
      let response = await dispatchFetch("https://unpkg.com/react@18.2.0/cjs/", { redirect: "manual" });
      expect(response.status).toBe(301);
      let location = response.headers.get("Location");
      expect(location).not.toBeNull();
      expect(location).toBe("https://app.unpkg.com/react@18.2.0/files/cjs");
    });
  });
});
