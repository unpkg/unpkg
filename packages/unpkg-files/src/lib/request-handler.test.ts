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
        case "https://registry.npmjs.org/React/-/React-18.2.0.tgz":
          // The real registry is case-sensitive: no uppercase React tarball exists.
          return new Response("Not found", { status: 404 });
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
        case "https://registry.npmjs.org/timeout-package/-/timeout-package-0.0.0.tgz":
          throw new DOMException("The operation timed out.", "TimeoutError");
        case "https://registry.npmjs.org/stalled-package/-/stalled-package-0.0.0.tgz": {
          let signal = init?.signal;
          return new Response(
            new ReadableStream({
              start(controller) {
                // Resolve the response headers, then stall while reading a gzip body
                // until the fetch timeout aborts it.
                controller.enqueue(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]));
                signal?.addEventListener(
                  "abort",
                  () => controller.error(signal.reason),
                  { once: true }
                );
              },
            })
          );
        }
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

    it("returns 504 when fetching a package times out", async () => {
      let response = await dispatchFetch(
        "https://files.unpkg.com/file/timeout-package@0.0.0/package.json"
      );
      expect(response.status).toBe(504);
    });

    it("survives a timeout while consuming a tarball body", async () => {
      let timeout = AbortSignal.timeout;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      AbortSignal.timeout = () => {
        let controller = new AbortController();
        timeoutId = setTimeout(() => {
          controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
        }, 10);
        return controller.signal;
      };

      try {
        let response = await dispatchFetch(
          "https://files.unpkg.com/file/stalled-package@0.0.0/package.json"
        );
        expect(response.status).toBe(504);

        let healthResponse = await dispatchFetch("https://files.unpkg.com/_health");
        expect(healthResponse.status).toBe(200);
        await Bun.sleep(10);
      } finally {
        clearTimeout(timeoutId);
        AbortSignal.timeout = timeout;
      }
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

  describe("/build requests", () => {
    it("builds an ESM artifact for a JavaScript file", async () => {
      let response = await dispatchFetch("https://files.unpkg.com/build/preact@10.26.4/src/component.js?target=es2022");
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/javascript; charset=utf-8");
      expect(response.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=300");
      expect(response.headers.has("X-UNPKG-Build-Key")).toBe(true);
      expect(response.headers.get("X-UNPKG-Build-Input")).toBe("/src/component.js");
    });

    it("bundles package-internal imports by default", async () => {
      let response = await dispatchFetch("https://files.unpkg.com/build/preact@10.26.4/src/component.js?target=es2022");
      expect(response.status).toBe(200);
      let text = await response.text();
      expect(text).toContain("// unpkg-package:/src/util");
      expect(text).not.toContain('from "./util?target=es2022";');
    });

    it("resolves package roots before building", async () => {
      let response = await dispatchFetch("https://files.unpkg.com/build/preact@10.26.4?target=es2022");
      expect(response.status).toBe(200);
      expect(response.headers.get("X-UNPKG-Build-Input")).toBe("/dist/preact.module.js");
    });

    it("returns 404 when the build input does not exist", async () => {
      let response = await dispatchFetch("https://files.unpkg.com/build/preact@10.26.4/missing.js?target=es2022");
      expect(response.status).toBe(404);
    });

    it("returns 415 for unsupported source types", async () => {
      let response = await dispatchFetch("https://files.unpkg.com/build/preact@10.26.4/component.vue?target=es2022");
      expect(response.status).toBe(415);
    });
  });

  describe("/transform requests", () => {
    it("transforms inline TSX source", async () => {
      let response = await dispatchFetch("https://files.unpkg.com/transform?target=es2022&jsx=automatic&external=*", {
        method: "POST",
        body: JSON.stringify({
          filename: "/inline.tsx",
          source: "export const view: JSX.Element = <div />;",
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/javascript; charset=utf-8");
      expect(await response.text()).toContain('from "react/jsx-runtime";');
    });
  });
});
