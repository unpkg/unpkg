import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { ExecutionContext } from "@cloudflare/workers-types";
import { handleRequest as handleFilesRequest } from "unpkg-files";

import { packageInfo, packageTarballs } from "../test/fixtures.ts";
import type { Env } from "./env.ts";
import { handleRequest, resolveTypesPath } from "./request-handler.ts";

const env: Env = {
  FILES_ORIGIN: "https://files.unpkg.com",
  MODE: "test",
  ORIGIN: "https://esm.unpkg.com",
  WWW_ORIGIN: "https://unpkg.com",
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

function dispatchFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let request = input instanceof Request ? input : new Request(input, init);
  return handleRequest(request, env, context);
}

function fileResponse(path: string): Response {
  return new Response(Bun.file(path));
}

const defaultCacheStore = new Map<string, Response>();

describe("handleRequest", () => {
  let globalCaches: CacheStorage | undefined;
  let globalFetch: typeof fetch | undefined;

  beforeAll(() => {
    globalCaches = globalThis.caches;
    globalFetch = globalThis.fetch;

    globalThis.caches = {
      default: {
        async match(request: Request) {
          return defaultCacheStore.get(request.url)?.clone();
        },
        async put(request: Request, response: Response) {
          defaultCacheStore.set(request.url, response);
        },
      },
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
        if (url.pathname === "/file/cesium@1.144.0/Build/Cesium/Cesium.js") {
          return new Response("export const Cesium = {};", {
            headers: { "Content-Type": "application/javascript" },
          });
        }
        if (url.pathname === "/build/cesium@1.144.0/Build/Cesium/Cesium.js") {
          return new Response("Build input not found", { status: 404 });
        }

        if (url.pathname === "/file/@babel/runtime@7.26.0/helpers/extends.js") {
          return new Response("export default Object.assign;\n", {
            headers: { "Content-Type": "application/javascript" },
          });
        }

        if (url.pathname === "/file/normalize.css@8.0.1/normalize.css") {
          return new Response("html { line-height: 1.15; }\n", {
            headers: {
              "Cache-Control": "public, max-age=31536000",
              "Content-Length": "28",
              "Content-Type": "text/css",
            },
          });
        }

        return handleFilesRequest(request);
      }

      switch (url.href) {
        case "https://registry.npmjs.org/cesium":
          return Response.json(cesiumPackageInfo);
        case "https://registry.npmjs.org/normalize.css":
          return Response.json({
            name: "normalize.css",
            "dist-tags": { latest: "8.0.1" },
            versions: {
              "8.0.1": {
                name: "normalize.css",
                version: "8.0.1",
                main: "normalize.css",
              },
            },
          });
        case "https://registry.npmjs.org/bootstrap":
          return Response.json({
            name: "bootstrap",
            "dist-tags": { latest: "5.3.8" },
            versions: {
              "5.3.8": {
                name: "bootstrap",
                version: "5.3.8",
                main: "dist/js/bootstrap.js",
                module: "dist/js/bootstrap.esm.js",
                style: "dist/css/bootstrap.css",
              },
            },
          });
        case "https://registry.npmjs.org/@babel/runtime":
          return Response.json({
            name: "@babel/runtime",
            "dist-tags": { latest: "7.26.0" },
            versions: {
              "7.26.0": {
                name: "@babel/runtime",
                version: "7.26.0",
                exports: {
                  "./helpers/*": "./helpers/*.js",
                },
              },
            },
          });
        case "https://registry.npmjs.org/@types/react":
          return Response.json({
            name: "@types/react",
            "dist-tags": { latest: "18.2.0" },
            versions: {
              "18.2.0": {
                name: "@types/react",
                version: "18.2.0",
                types: "index.d.ts",
              },
            },
          });
        case "https://registry.npmjs.org/preact":
          return fileResponse(packageInfo.preact);
        case "https://registry.npmjs.org/react":
          return fileResponse(packageInfo.react);
        case "https://registry.npmjs.org/run":
        case "https://registry.npmjs.org/tsx":
          return new Response("Not found", { status: 404 });
        case "https://registry.npmjs.org/JSONStream":
          return Response.json({
            name: "JSONStream",
            "dist-tags": { latest: "1.3.5" },
            versions: {
              "1.3.5": { name: "JSONStream", version: "1.3.5", main: "index.js" },
            },
          });
        case "https://registry.npmjs.org/jsonstream":
          return Response.json({
            name: "jsonstream",
            "dist-tags": { latest: "1.0.3" },
            versions: {
              "1.0.3": { name: "jsonstream", version: "1.0.3", main: "index.js" },
            },
          });
        case "https://registry.npmjs.org/React":
          return new Response("Not found", { status: 404 });
        case "https://registry.npmjs.org/preact/-/preact-10.26.4.tgz":
          return fileResponse(packageTarballs.preact["10.26.4"]);
        case "https://registry.npmjs.org/react/-/react-18.2.0.tgz":
          return fileResponse(packageTarballs.react["18.2.0"]);
        default:
          throw new Error(`Unexpected URL: ${url}`);
      }
    }) as unknown as typeof fetch;
  });

  afterAll(() => {
    globalThis.caches = globalCaches!;
    globalThis.fetch = globalFetch!;
  });

  it("serves the beta home page from /", async () => {
    let response = await dispatchFetch("https://esm.unpkg.com/");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/^text\/html/);

    let html = await response.text();
    expect(html).toContain('<meta name="color-scheme" content="light dark"/>');
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain('<link rel="icon" type="image/png" href="/favicon.png"/>');
    expect(html).toContain("UNPKG ESM");
    expect(html).toContain("esm.unpkg.com is currently in beta.");
    expect(html).toContain("https://unpkg.com/#browser-modules");
    expect(html).toContain('class="inline-link text-blue-600"');
    expect(html).toContain("https://esm.unpkg.com/react@18.3.1");
    expect(html).toContain('href="https://github.com/unpkg"');
    expect(html).toContain('href="https://x.com/unpkg"');
    expect(html).toContain('aria-label="UNPKG on GitHub"');
    expect(html).toContain('aria-label="UNPKG on X"');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain("footer a:focus-visible");
    expect(html).not.toContain("Packages are resolved from npm and served by UNPKG.");
    expect(html).not.toContain("Inline scripts");
    expect(html).not.toContain("https://unpkg.com/run");
    expect(html).not.toContain("text/tsx");
    expect(html).not.toContain("https://esm.unpkg.com/run");
    expect(html).not.toContain("https://esm.unpkg.com/tsx");
    expect(html).toContain("hljs-listing");
    expect(html).toContain("hljs-tag");
  });

  it("redirects /index.html to /", async () => {
    let response = await dispatchFetch("https://esm.unpkg.com/index.html", { redirect: "manual" });

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/");
  });

  it("resolves semver ranges with a normalized temporary redirect", async () => {
    let response = await dispatchFetch("https://esm.unpkg.com/react@^18?meta", { redirect: "manual" });
    expect(response.status).toBe(302);
    let location = response.headers.get("Location");
    expect(location).not.toBeNull();
    expect(location).toMatch(/^\/react@18\.\d+\.\d+\?meta=&target=es2022$/);
  });

  it("serves legacy uppercase package names without falling back to lowercase", async () => {
    // JSONStream and jsonstream are different packages; the uppercase request
    // must resolve the uppercase package, not redirect to the lowercase one.
    let response = await dispatchFetch("https://esm.unpkg.com/JSONStream", { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/JSONStream@1.3.5?target=es2022");
  });

  it("redirects mixed-case requests to the canonical package name", async () => {
    let response = await dispatchFetch("https://esm.unpkg.com/React@18.2.0", { redirect: "manual" });
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/react@18.2.0?target=es2022");
  });

  it("rejects unsupported build params with a JSON diagnostic", async () => {
    let response = await dispatchFetch("https://esm.unpkg.com/preact@10.26.4?standalone");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_QUERY",
        message: "?standalone is not supported",
      },
    });
  });

  it("hashes and caches the exact artifact bytes for ?meta integrity", async () => {
    defaultCacheStore.clear();

    let response = await dispatchFetch("https://esm.unpkg.com/react@18.2.0?meta=&target=es2022");
    expect(response.status).toBe(200);
    let json = (await response.json()) as any;

    // The integrity hash must be computed from the artifact cached under the
    // module URL, so a later module request serves exactly the hashed bytes.
    await Bun.sleep(0);
    let cached = defaultCacheStore.get("https://esm.unpkg.com/react@18.2.0?target=es2022");
    expect(cached).toBeDefined();

    let bytes = await cached!.clone().arrayBuffer();
    let digest = await crypto.subtle.digest("SHA-384", bytes);
    let expected = `sha384-${btoa(String.fromCharCode(...new Uint8Array(digest)))}`;
    expect(json.integrity).toBe(expected);
  });

  it("returns build metadata for exact package URLs", async () => {
    let redirectResponse = await dispatchFetch("https://esm.unpkg.com/react@18.2.0?meta", { redirect: "manual" });
    expect(redirectResponse.status).toBe(301);

    let response = await dispatchFetch(`https://esm.unpkg.com${redirectResponse.headers.get("Location")}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");

    let json = (await response.json()) as any;
    expect(json.name).toBe("react");
    expect(json.version).toBe("18.2.0");
    expect(json.subpath).toBe(".");
    expect(json.target).toBe("es2022");
    expect(json.module).toBe("https://esm.unpkg.com/react@18.2.0?target=es2022");
    expect(json.types).toBeNull();
    expect(json.integrity).toMatch(/^sha384-/);
  });

  it("returns type metadata for packages with declarations", async () => {
    let redirectResponse = await dispatchFetch("https://esm.unpkg.com/preact@10.26.4?meta", { redirect: "manual" });
    expect(redirectResponse.status).toBe(301);

    let response = await dispatchFetch(`https://esm.unpkg.com${redirectResponse.headers.get("Location")}`);
    expect(response.status).toBe(200);

    let json = (await response.json()) as any;
    expect(json.types).toBe("https://esm.unpkg.com/preact@10.26.4/src/index.d.ts");
  });

  it("returns JSON diagnostics for invalid query combinations", async () => {
    let response = await dispatchFetch("https://esm.unpkg.com/react?dev&env=production");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_QUERY",
        message: "?dev cannot be combined with ?env=production",
      },
    });

    response = await dispatchFetch("https://esm.unpkg.com/react@18.2.0?raw&target=es2022");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_QUERY",
        message: "?raw cannot be combined with ?target",
      },
    });
  });

  it("proxies build artifacts from the files origin", async () => {
    let redirectResponse = await dispatchFetch("https://esm.unpkg.com/preact@10.26.4/src/component.js", {
      redirect: "manual",
    });
    expect(redirectResponse.status).toBe(301);

    let response = await dispatchFetch(`https://esm.unpkg.com${redirectResponse.headers.get("Location")}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/javascript; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.has("X-UNPKG-Build-Key")).toBe(true);
  });

  it("adds TypeScript declaration headers to build artifacts", async () => {
    let redirectResponse = await dispatchFetch("https://esm.unpkg.com/preact@10.26.4", {
      redirect: "manual",
    });
    expect(redirectResponse.status).toBe(301);

    let response = await dispatchFetch(`https://esm.unpkg.com${redirectResponse.headers.get("Location")}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-TypeScript-Types")).toBe("https://esm.unpkg.com/preact@10.26.4/src/index.d.ts");
  });

  it("omits TypeScript declaration headers with no-dts", async () => {
    let redirectResponse = await dispatchFetch("https://esm.unpkg.com/preact@10.26.4?no-dts", {
      redirect: "manual",
    });
    expect(redirectResponse.status).toBe(301);

    let response = await dispatchFetch(`https://esm.unpkg.com${redirectResponse.headers.get("Location")}`);
    expect(response.status).toBe(200);
    expect(response.headers.has("X-TypeScript-Types")).toBe(false);
  });

  it("serves raw files without adding a default target", async () => {
    let redirectResponse = await dispatchFetch("https://esm.unpkg.com/react@18.2.0/package.json?raw", {
      redirect: "manual",
    });
    expect(redirectResponse.status).toBe(301);
    expect(redirectResponse.headers.get("Location")).toBe("/react@18.2.0/package.json?raw=");

    let response = await dispatchFetch(`https://esm.unpkg.com${redirectResponse.headers.get("Location")}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(await response.text()).toMatch(/"name": "react"/);
  });

  it("serves explicit raw files blocked by null package exports", async () => {
    let redirectResponse = await dispatchFetch("https://esm.unpkg.com/cesium@1.144.0/Build/Cesium/Cesium.js?raw", {
      redirect: "manual",
    });
    expect(redirectResponse.status).toBe(301);

    let response = await dispatchFetch(`https://esm.unpkg.com${redirectResponse.headers.get("Location")}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("export const Cesium = {};");
  });

  it("does not build explicit files blocked by null package exports", async () => {
    let redirectResponse = await dispatchFetch("https://esm.unpkg.com/cesium@1.144.0/Build/Cesium/Cesium.js", {
      redirect: "manual",
    });
    expect(redirectResponse.status).toBe(301);

    let response = await dispatchFetch(`https://esm.unpkg.com${redirectResponse.headers.get("Location")}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: {
        code: "BUILD_FAILED",
      },
    });
  });

  it("redirects raw package roots to their import entry", async () => {
    let reactResponse = await dispatchFetch("https://esm.unpkg.com/react@18.2.0?raw=", {
      redirect: "manual",
    });
    expect(reactResponse.status).toBe(301);
    expect(reactResponse.headers.get("Location")).toBe("/react@18.2.0/index.js?raw=");

    let preactResponse = await dispatchFetch("https://esm.unpkg.com/preact@10.26.4?raw=", {
      redirect: "manual",
    });
    expect(preactResponse.status).toBe(301);
    expect(preactResponse.headers.get("Location")).toBe("/preact@10.26.4/dist/preact.mjs?raw=");
  });

  it("redirects raw exported subpaths to their source asset", async () => {
    let response = await dispatchFetch("https://esm.unpkg.com/react@18.2.0/jsx-runtime?raw=", {
      redirect: "manual",
    });

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/react@18.2.0/jsx-runtime.js?raw=");
  });

  it("resolves extensionless raw subpaths when export patterns are unavailable", async () => {
    let response = await dispatchFetch("https://esm.unpkg.com/@babel/runtime@7.26.0/helpers/extends?raw=", {
      redirect: "manual",
    });

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/@babel/runtime@7.26.0/helpers/extends.js?raw=");
  });

  it("prefers a package module entry over an unrelated stylesheet for raw requests", async () => {
    let response = await dispatchFetch("https://esm.unpkg.com/bootstrap@5.3.8?raw=", {
      redirect: "manual",
    });

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/bootstrap@5.3.8/dist/js/bootstrap.esm.js?raw=");
  });

  it("redirects CSS package roots to their stylesheet entry", async () => {
    let response = await dispatchFetch("https://esm.unpkg.com/normalize.css@8.0.1", {
      redirect: "manual",
    });

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/normalize.css@8.0.1/normalize.css");
  });

  it("strips irrelevant build queries when redirecting CSS package roots", async () => {
    let response = await dispatchFetch("https://esm.unpkg.com/normalize.css@8.0.1?target=es2020", {
      redirect: "manual",
    });

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/normalize.css@8.0.1/normalize.css");
  });

  it("preserves module mode when redirecting CSS package roots", async () => {
    let normalizedResponse = await dispatchFetch("https://esm.unpkg.com/normalize.css@8.0.1?module", {
      redirect: "manual",
    });
    expect(normalizedResponse.status).toBe(301);

    let response = await dispatchFetch(`https://esm.unpkg.com${normalizedResponse.headers.get("Location")}`, {
      redirect: "manual",
    });
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/normalize.css@8.0.1/normalize.css?module=");
  });

  it("redirects raw CSS package roots to their stylesheet entry", async () => {
    let normalizedResponse = await dispatchFetch("https://esm.unpkg.com/normalize.css@8.0.1?raw", {
      redirect: "manual",
    });
    expect(normalizedResponse.status).toBe(301);

    let response = await dispatchFetch(`https://esm.unpkg.com${normalizedResponse.headers.get("Location")}`, {
      redirect: "manual",
    });
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/normalize.css@8.0.1/normalize.css");
  });

  it("serves direct CSS files as stylesheets", async () => {
    let response = await dispatchFetch("https://esm.unpkg.com/normalize.css@8.0.1/normalize.css");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await response.text()).toContain("line-height");
  });

  it("serves CSS files as constructable stylesheet modules", async () => {
    let response = await dispatchFetch("https://esm.unpkg.com/normalize.css@8.0.1/normalize.css?module=");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/javascript; charset=utf-8");
    let text = await response.text();
    expect(text).toContain("new CSSStyleSheet()");
    expect(text).toContain("export default stylesheet");
  });

  it("returns a diagnostic when an explicit CSS request has no stylesheet entry", async () => {
    let response = await dispatchFetch("https://esm.unpkg.com/react@18.3.1?css=");

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.json()).toMatchObject({
      error: {
        code: "CSS_NOT_FOUND",
      },
    });
  });

  it("serves declaration files without building them", async () => {
    let response = await dispatchFetch("https://esm.unpkg.com/preact@10.26.4/src/index.d.ts", {
      redirect: "manual",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/typescript; charset=utf-8");
    expect(await response.text()).toContain("export as namespace preact");
  });

  it("redirects types-only package metadata requests to declarations", async () => {
    let redirectResponse = await dispatchFetch("https://esm.unpkg.com/@types/react@18.2.0?meta", {
      redirect: "manual",
    });
    expect(redirectResponse.status).toBe(301);

    let response = await dispatchFetch(`https://esm.unpkg.com${redirectResponse.headers.get("Location")}`, {
      redirect: "manual",
    });
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/@types/react@18.2.0/index.d.ts");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=300");
  });

  it("strips build queries when redirecting types-only packages to declarations", async () => {
    let response = await dispatchFetch("https://esm.unpkg.com/@types/react@18.2.0?target=es2020", {
      redirect: "manual",
    });

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/@types/react@18.2.0/index.d.ts");
  });

  it("returns module worker wrappers", async () => {
    let redirectResponse = await dispatchFetch("https://esm.unpkg.com/preact@10.26.4/src/component.js?worker", {
      redirect: "manual",
    });
    expect(redirectResponse.status).toBe(301);

    let response = await dispatchFetch(`https://esm.unpkg.com${redirectResponse.headers.get("Location")}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/javascript; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(await response.text()).toContain(
      'return new Worker("https://esm.unpkg.com/preact@10.26.4/src/component.js?target=es2022", { type: "module", ...options });'
    );
  });

  it("does not serve inline runner helpers from the ESM subdomain", async () => {
    let response = await dispatchFetch("https://esm.unpkg.com/run");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "PACKAGE_NOT_FOUND",
        message: "Package not found: run",
      },
    });

    response = await dispatchFetch("https://esm.unpkg.com/tsx");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "PACKAGE_NOT_FOUND",
        message: "Package not found: tsx",
      },
    });
  });

  it("proxies inline transforms to the files origin", async () => {
    let response = await dispatchFetch("https://esm.unpkg.com/transform?target=es2022&jsx=automatic&external=*", {
      method: "POST",
      body: JSON.stringify({
        filename: "/inline.tsx",
        source: "export const view: JSX.Element = <div />;",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await response.text()).toContain('from "react/jsx-runtime";');
  });
});

describe("resolveTypesPath", () => {
  it("uses the declared root types path instead of applying a typesVersions wildcard to an empty subpath", () => {
    expect(
      resolveTypesPath(
        {
          types: "index.d.ts",
          typesVersions: {
            "<=5.6": {
              "*": ["ts5.6/*"],
            },
          },
        },
        "."
      )
    ).toBe("index.d.ts");
  });

  it("resolves declaration paths from typesVersions", () => {
    expect(
      resolveTypesPath(
        {
          dependencies: {},
          description: "",
          name: "pkg",
          typesVersions: {
            "*": {
              "*": ["dist/*"],
              "subpath": ["dist/subpath.d.ts"],
            },
          },
          version: "1.0.0",
        },
        "./subpath"
      )
    ).toBe("dist/subpath.d.ts");
  });

  it("prefers export-specific types over typesVersions", () => {
    expect(
      resolveTypesPath(
        {
          dependencies: {},
          description: "",
          exports: {
            "./subpath": {
              types: "./types/subpath.d.ts",
              import: "./dist/subpath.js",
            },
          },
          name: "pkg",
          typesVersions: {
            "*": {
              "subpath": ["dist/subpath.d.ts"],
            },
          },
          version: "1.0.0",
        },
        "./subpath"
      )
    ).toBe("./types/subpath.d.ts");
  });

  it("resolves nested types export conditions before typesVersions", () => {
    expect(
      resolveTypesPath(
        {
          dependencies: {},
          description: "",
          exports: {
            ".": {
              "types@<=5.0": {
                default: "./ts5.0/index.d.ts",
              },
              types: {
                default: "./index.d.ts",
              },
            },
          },
          name: "@types/pkg",
          types: "index.d.ts",
          typesVersions: {
            "<=5.0": {
              "*": ["ts5.0/*"],
            },
          },
          version: "1.0.0",
        },
        "."
      )
    ).toBe("./index.d.ts");
  });
});
