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
  ESM_ORIGIN: "https://esm.unpkg.com",
  FILES_ORIGIN: "https://files.unpkg.com",
  MODE: "test",
  ORIGIN: "https://unpkg.com",
};

const context = {
  waitUntil() {},
} as unknown as ExecutionContext;

const cesiumPackageInfo = {
  name: "cesium",
  "dist-tags": { latest: "1.144.0" },
  versions: {
    "1.144.0": {
      name: "cesium",
      version: "1.144.0",
      exports: {
        ".": "./Source/Cesium.js",
        "./Build/*": "./Build/*",
        "./Build/*.js": null,
      },
    },
  },
};

const mqttPackageInfo = {
  name: "mqtt",
  "dist-tags": { latest: "5.15.2" },
  versions: {
    "5.15.2": {
      name: "mqtt",
      version: "5.15.2",
      browser: {
        "./server.js": "./client.js",
      },
      exports: {
        ".": "./build/index.js",
        "./alias": "./intermediate.js",
        "./bar": "./foo",
        "./foo": "./missing.js",
        "./intermediate.js": "./final.js",
        "./legacy": "./missing-target.mjs",
        "./conditional.js": {
          browser: "./browser.js",
          default: "./conditional.js",
        },
        "./conditional-wildcard": {
          browser: "./dist/mqtt.min.js",
          default: "./dist/mqtt.min.js",
        },
        "./conditional-server": {
          foo: "./server.js",
        },
        "./dist/*": "./dist/*.js",
        "./object-dist/*": {
          default: "./object-dist/*.js",
        },
      },
    },
  },
};

function dispatchFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let request = input instanceof Request ? input : new Request(input, init);
  return handleRequest(request, env, context);
}

function fileResponse(path: string): Response {
  return new Response(Bun.file(path));
}

function fileMetadata(path: string) {
  return {
    path,
    size: 0,
    type: "text/javascript",
    integrity: "sha256-dGVzdA==",
  };
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
        if (url.pathname === "/list/cesium@1.144.0/") {
          return Response.json({
            package: "cesium",
            version: "1.144.0",
            prefix: "/",
            files: [
              {
                path: "/Build/Cesium/Cesium.js",
                size: 22,
                type: "text/javascript",
                integrity: "sha256-dGVzdA==",
              },
            ],
          });
        }
        if (url.pathname === "/file/cesium@1.144.0/Build/Cesium/Cesium.js") {
          return new Response("export const Cesium = {};", {
            headers: {
              "Content-Digest": "sha256=:dGVzdA==:",
              "Content-Type": "text/javascript",
            },
          });
        }
        if (url.pathname === "/list/mqtt@5.15.2/") {
          return Response.json({
            package: "mqtt",
            version: "5.15.2",
            prefix: "/",
            files: [
              "/bar",
              "/browser.js",
              "/build/index.js",
              "/client.js",
              "/conditional.js",
              "/dist/mqtt.min.js",
              "/final.js",
              "/intermediate.js",
              "/legacy.js",
              "/object-dist/example.js",
              "/server.js",
            ].map(fileMetadata),
          });
        }
        if (url.pathname === "/file/mqtt@5.15.2/dist/mqtt.min.js") {
          return new Response("export const mqtt = {};", {
            headers: {
              "Content-Digest": "sha256=:dGVzdA==:",
              "Content-Type": "text/javascript",
            },
          });
        }
        if (url.pathname === "/file/mqtt@5.15.2/intermediate.js") {
          return new Response("export const intermediate = {};", {
            headers: {
              "Content-Digest": "sha256=:dGVzdA==:",
              "Content-Type": "text/javascript",
            },
          });
        }
        if (url.pathname === "/file/mqtt@5.15.2/object-dist/example.js") {
          return new Response("export const example = {};", {
            headers: {
              "Content-Digest": "sha256=:dGVzdA==:",
              "Content-Type": "text/javascript",
            },
          });
        }
        if (url.pathname === "/list/react@19.0.0/") {
          return Response.json({
            package: "react",
            version: "19.0.0",
            prefix: "/",
            files: [fileMetadata("/compiler-runtime.js")],
          });
        }
        if (url.pathname === "/list/preact@10.25.4/") {
          return Response.json({
            package: "preact",
            version: "10.25.4",
            prefix: "/",
            files: [fileMetadata("/hooks/dist/hooks.mjs")],
          });
        }

        // Run the request through the file server. This allows us to write integration tests
        // that run without booting the file server.
        return handleFilesRequest(request);
      }

      switch (url.href) {
        case "https://registry.npmjs.org/cesium":
          return Response.json(cesiumPackageInfo);
        case "https://registry.npmjs.org/lodash":
          return fileResponse(packageInfo.lodash);
        case "https://registry.npmjs.org/mqtt":
          return Response.json(mqttPackageInfo);
        case "https://registry.npmjs.org/preact":
          return fileResponse(packageInfo.preact);
        case "https://registry.npmjs.org/react":
          return fileResponse(packageInfo.react);
        case "https://registry.npmjs.org/run":
          return new Response("Not found", { status: 404 });
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

  it("renders home page links with configured staging origins", async () => {
    let stagingEnv: Env = {
      ...env,
      APP_ORIGIN: "https://app.unpkg.dev",
      ASSETS_ORIGIN: "https://unpkg.dev",
      ESM_ORIGIN: "https://esm.unpkg.dev",
      FILES_ORIGIN: "https://fly.unpkg.dev",
      MODE: "test",
      ORIGIN: "https://unpkg.dev",
    };
    let response = await handleRequest(new Request("https://unpkg.dev/"), stagingEnv, context);
    let html = await response.text();

    expect(html).toContain('<meta name="color-scheme" content="light dark"/>');
    expect(html).toContain('media="(prefers-color-scheme: dark)"');
    expect(html).toContain('code-dark.css" media="(prefers-color-scheme: dark)"');
    expect(html).toContain('href="https://esm.unpkg.dev/"');
    expect(html).toContain('href="https://esm.unpkg.dev/preact"');
    expect(html).toContain('href="https://esm.unpkg.dev/react-dom@18/client"');
    expect(html).toContain("https://unpkg.dev/run");
    expect(html).toContain('section id="inline-scripts"');
    expect(html).toContain('href="#inline-scripts"');
    expect(html).toContain(">Inline Scripts<");
    expect(html).toContain(">Segment<");
    expect(html).toContain(">Parameter<");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("hljs-dark-listing");
    expect(html).toContain("hljs-frame");
    expect(html).not.toContain('class="hljs-listing');
    expect(html).toContain("focus-visible:outline-slate-500");
    expect(html).toContain("section-permalink");
    expect(html).toContain("inline-link text-blue-600");
    expect(html).toContain(">esm.unpkg.com/preact<");
    expect(html).toContain(">esm.unpkg.com/react-dom@18/client<");
    expect(html).toContain('href="https://github.com/unpkg"');
    expect(html).toContain('href="https://x.com/unpkg"');
    expect(html).toContain('aria-label="UNPKG on GitHub"');
    expect(html).toContain('aria-label="UNPKG on X"');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).not.toContain("react@18/client");
    expect(html).not.toContain('href="https://esm.unpkg.com/');
    expect(html).not.toContain("https://esm.unpkg.dev/tsx");
  });

  it("serves the inline script runner from the exact /run path", async () => {
    let response = await dispatchFetch("https://unpkg.com/run");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/javascript; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=300");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");

    let code = await response.text();
    expect(code).toContain('const transformOrigin = "https://esm.unpkg.com";');
    expect(code).toContain('"text/tsx"');
    expect(code).toContain('new URL("/transform?" + transformSearchParams(script), transformOrigin)');
    expect(code).toContain("export async function run");
    expect(code).not.toContain('params.set("external"');
  });

  it("does not intercept package URLs that begin with /run", async () => {
    let response = await dispatchFetch("https://unpkg.com/run/anything");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Package not found: run");

    response = await dispatchFetch("https://unpkg.com/run@1.0.0");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Package not found: run");
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

    it("serves explicit files blocked by null package exports", async () => {
      let redirectResponse = await dispatchFetch("https://unpkg.com/cesium@latest/Build/Cesium/Cesium.js", {
        redirect: "manual",
      });
      expect(redirectResponse.status).toBe(302);
      expect(redirectResponse.headers.get("Location")).toBe("/cesium@1.144.0/Build/Cesium/Cesium.js");

      let response = await dispatchFetch("https://unpkg.com/cesium@1.144.0/Build/Cesium/Cesium.js");
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toMatch(/^text\/javascript/);
      expect(await response.text()).toBe("export const Cesium = {};");
    });

    it("serves physical files that also match wildcard export subpaths", async () => {
      let response = await dispatchFetch("https://unpkg.com/mqtt@5.15.2/dist/mqtt.min.js?cache-bust", {
        redirect: "manual",
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Location")).toBeNull();
      expect(await response.text()).toBe("export const mqtt = {};");
    });

    it("serves physical files that match default conditional wildcard exports", async () => {
      let response = await dispatchFetch("https://unpkg.com/mqtt@5.15.2/object-dist/example.js", {
        redirect: "manual",
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Location")).toBeNull();
      expect(await response.text()).toBe("export const example = {};");
    });

    it("pins unversioned physical wildcard export targets without changing the filename", async () => {
      let response = await dispatchFetch("https://unpkg.com/mqtt/dist/mqtt.min.js?cache-bust", {
        redirect: "manual",
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/mqtt@5.15.2/dist/mqtt.min.js?cache-bust");

      let pinnedResponse = await dispatchFetch(
        new URL(response.headers.get("Location")!, "https://unpkg.com"),
        { redirect: "manual" },
      );
      expect(pinnedResponse.status).toBe(200);
      expect(pinnedResponse.headers.get("Location")).toBeNull();
    });

    it("resolves wildcard export subpaths once and then serves their physical target", async () => {
      let response = await dispatchFetch("https://unpkg.com/mqtt/dist/mqtt.min", {
        redirect: "manual",
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/mqtt@5.15.2/dist/mqtt.min.js");

      let targetResponse = await dispatchFetch(
        new URL(response.headers.get("Location")!, "https://unpkg.com"),
        { redirect: "manual" },
      );
      expect(targetResponse.status).toBe(200);
      expect(targetResponse.headers.get("Location")).toBeNull();
    });

    it("serves the first physical target in a finite export chain", async () => {
      let response = await dispatchFetch("https://unpkg.com/mqtt@5.15.2/alias", {
        redirect: "manual",
      });

      expect(response.status).toBe(301);
      expect(response.headers.get("Location")).toBe("/mqtt@5.15.2/intermediate.js");

      let targetResponse = await dispatchFetch(
        new URL(response.headers.get("Location")!, "https://unpkg.com"),
        { redirect: "manual" },
      );
      expect(targetResponse.status).toBe(200);
      expect(targetResponse.headers.get("Location")).toBeNull();
      expect(await targetResponse.text()).toBe("export const intermediate = {};");
    });

    it("honors explicit browser mappings for physical files", async () => {
      let response = await dispatchFetch("https://unpkg.com/mqtt@5.15.2/server.js?browser", {
        redirect: "manual",
      });

      expect(response.status).toBe(301);
      expect(response.headers.get("Location")).toBe("/mqtt@5.15.2/client.js");
    });

    it("honors explicit export conditions for physical files", async () => {
      let response = await dispatchFetch("https://unpkg.com/mqtt@5.15.2/conditional.js?conditions=browser", {
        redirect: "manual",
      });

      expect(response.status).toBe(301);
      expect(response.headers.get("Location")).toBe("/mqtt@5.15.2/browser.js");
    });

    it("does not re-resolve conditional targets that match wildcard exports", async () => {
      let response = await dispatchFetch("https://unpkg.com/mqtt@5.15.2/conditional-wildcard?conditions=browser", {
        redirect: "manual",
      });

      expect(response.status).toBe(301);
      expect(response.headers.get("Location")).toBe("/mqtt@5.15.2/dist/mqtt.min.js");

      let targetResponse = await dispatchFetch(
        new URL(response.headers.get("Location")!, "https://unpkg.com"),
        { redirect: "manual" },
      );
      expect(targetResponse.status).toBe(200);
      expect(targetResponse.headers.get("Location")).toBeNull();
    });

    it("does not carry unused resolver flags onto physical targets", async () => {
      let response = await dispatchFetch("https://unpkg.com/mqtt@5.15.2/conditional-server?conditions=foo&browser", {
        redirect: "manual",
      });

      expect(response.status).toBe(301);
      expect(response.headers.get("Location")).toBe("/mqtt@5.15.2/server.js");
    });

    it("serves physical predecessors at stale redirect targets", async () => {
      let response = await dispatchFetch("https://unpkg.com/mqtt@5.15.2/dist/mqtt.min.js.js", {
        redirect: "manual",
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Location")).toBeNull();
      expect(await response.text()).toBe("export const mqtt = {};");
    });

    it("does not recover arbitrary reverse export mappings", async () => {
      let response = await dispatchFetch("https://unpkg.com/mqtt@5.15.2/foo", {
        redirect: "manual",
      });

      expect(response.status).toBe(404);
      expect(response.headers.get("Location")).toBeNull();
    });

    it("does not redirect repeatedly when a wildcard export target is missing", async () => {
      let response = await dispatchFetch("https://unpkg.com/mqtt@5.15.2/dist/missing", {
        redirect: "manual",
      });

      expect(response.status).toBe(404);
      expect(response.headers.get("Location")).toBeNull();
    });

    it("does not use legacy resolution when an export target is missing", async () => {
      let response = await dispatchFetch("https://unpkg.com/mqtt@5.15.2/legacy", {
        redirect: "manual",
      });

      expect(response.status).toBe(404);
      expect(response.headers.get("Location")).toBeNull();
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
      expect(location).toBe("/react@19.0.0/index.js");
    });

    it('resolves using "exports" field and a custom condition in package.json', async () => {
      let response = await dispatchFetch("https://unpkg.com/react@19.0.0?conditions=react-server", {
        redirect: "manual",
      });
      expect(response.status).toBe(301);
      let location = response.headers.get("Location");
      expect(location).not.toBeNull();
      expect(location).toBe("/react@19.0.0/react.react-server.js");
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
      expect(location).toBe("/preact@10.25.4/hooks/dist/hooks.mjs");
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

    it('serves JavaScript files with "charset=utf-8"', async () => {
      let response = await dispatchFetch("https://unpkg.com/react@18.2.0/index.js");
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toMatch(/^text\/javascript; charset=utf-8/);
    });

    it('serves non-JavaScript text files with "charset=utf-8"', async () => {
      let response = await dispatchFetch("https://unpkg.com/react@18.2.0/LICENSE");
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    });

    it("adds CORS headers to the response", async () => {
      let response = await dispatchFetch("https://unpkg.com/react@18.2.0/index.js");
      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Headers")).toBe("*");
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, HEAD, OPTIONS");
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Expose-Headers")).toBe("*");
      expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
    });
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
      expect(location).toBe("/preact@10.25.4/dist/preact.module.js");
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

    it("adds CORS headers to the response", async () => {
      let response = await dispatchFetch("https://unpkg.com/preact@10.26.4/src/component.js?module");
      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Headers")).toBe("*");
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, HEAD, OPTIONS");
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Expose-Headers")).toBe("*");
      expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
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
