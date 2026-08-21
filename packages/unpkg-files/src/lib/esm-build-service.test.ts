import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
  bundleSource,
  normalizeBuildOptions,
  parseAliases,
  parseDependencyOverrides,
  resolveBuildFilename,
  rewriteEsmImports,
  transformSource,
  UnsupportedDynamicRequireError,
} from "./esm-build-service.ts";

const registry = "https://registry.npmjs.org";

describe("parseDependencyOverrides", () => {
  it("parses package version overrides", () => {
    expect(parseDependencyOverrides("react@18.2.0,@scope/pkg@1.2.3")).toEqual({
      react: "18.2.0",
      "@scope/pkg": "1.2.3",
    });
  });
});

describe("parseAliases", () => {
  it("parses dependency aliases", () => {
    expect(parseAliases("react:preact/compat,react-dom:preact/compat")).toEqual({
      react: "preact/compat",
      "react-dom": "preact/compat",
    });
  });
});

describe("resolveBuildFilename", () => {
  let packageJson = {
    exports: {
      ".": {
        worker: "./worker.js",
        node: "./node.js",
        deno: "./deno.js",
        browser: {
          development: "./browser-development.js",
          production: "./browser-production.js",
        },
        import: "./import.js",
      },
    },
    module: "./module.js",
  };

  it("prefers browser production conditions by default", () => {
    expect(resolveBuildFilename(packageJson, undefined, options())).toBe("/browser-production.js");
  });

  it("prefers browser development conditions in dev mode", () => {
    expect(resolveBuildFilename(packageJson, undefined, options("dev"))).toBe("/browser-development.js");
  });

  it("honors custom conditions before default browser conditions", () => {
    expect(resolveBuildFilename(packageJson, undefined, options("conditions=worker"))).toBe("/worker.js");
  });

  it("uses runtime-native conditions for node and deno targets", () => {
    expect(resolveBuildFilename(packageJson, undefined, options("target=node"))).toBe("/node.js");
    expect(resolveBuildFilename(packageJson, undefined, options("target=deno"))).toBe("/deno.js");
  });

  it("resolves exported subpaths before building", () => {
    expect(
      resolveBuildFilename(
        {
          exports: {
            "./client": {
              browser: "./client.browser.js",
              import: "./client.js",
            },
          },
        },
        "/client",
        options()
      )
    ).toBe("/client.browser.js");
  });

  it("falls back to explicit filenames when no export matches", () => {
    expect(resolveBuildFilename(packageJson, "/dist/index.js", options())).toBe("/dist/index.js");
  });

  it("allows extensionless browser entrypoints", () => {
    expect(
      resolveBuildFilename(
        {
          browser: "./index",
          main: "./index.cjs",
        },
        undefined,
        options()
      )
    ).toBe("/index");
  });

  it("falls back to index.js for package roots without entrypoint fields", () => {
    expect(resolveBuildFilename({}, undefined, options())).toBe("/index.js");
  });
});

describe("rewriteEsmImports", () => {
  let globalFetch: typeof fetch | undefined;

  beforeAll(() => {
    globalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      let request = input instanceof Request ? input : new Request(input);
      let url = new URL(request.url);

      switch (url.href) {
        case "https://registry.npmjs.org/react":
          return Response.json(packageInfo("react", ["18.2.0", "18.3.1"], "18.3.1"));
        case "https://registry.npmjs.org/preact":
          return Response.json(packageInfo("preact", ["10.25.4", "10.26.4"], "10.26.4"));
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

  it("rewrites bare imports to exact esm.unpkg.com versions", async () => {
    let code = 'import React from "react";';
    let result = await rewriteEsmImports(code, registry, "https://esm.unpkg.com", { react: "^18" }, options());

    expect(result).toBe('import React from "https://esm.unpkg.com/react@18.3.1";');
  });

  it("applies dependency version overrides", async () => {
    let code = 'import React from "react";';
    let result = await rewriteEsmImports(code, registry, "https://esm.unpkg.com", { react: "^18" }, options("deps=react@18.2.0"));

    expect(result).toBe('import React from "https://esm.unpkg.com/react@18.2.0?deps=react%4018.2.0";');
  });

  it("applies aliases before version resolution", async () => {
    let code = 'import React from "react";';
    let result = await rewriteEsmImports(
      code,
      registry,
      "https://esm.unpkg.com",
      { react: "^18" },
      options("alias=react:preact/compat&deps=preact@10.25.4")
    );

    expect(result).toBe(
      'import React from "https://esm.unpkg.com/preact@10.25.4/compat?deps=preact%4010.25.4&alias=react%3Apreact%2Fcompat";'
    );
  });

  it("keeps externalized dependencies as bare specifiers", async () => {
    let code = 'import React from "react";';
    let result = await rewriteEsmImports(code, registry, "https://esm.unpkg.com", { react: "^18" }, options("external=react"));

    expect(result).toBe('import React from "react";');
  });

  it("propagates dependency graph controls to rewritten dependencies", async () => {
    let code = 'import React from "react";';
    let result = await rewriteEsmImports(
      code,
      registry,
      "https://esm.unpkg.com",
      { react: "^18" },
      options("bundle&deps=react@18.2.0&alias=react:preact/compat&external=react-dom")
    );

    expect(result).toBe(
      'import React from "https://esm.unpkg.com/preact@10.26.4/compat?bundle=&external=react-dom&deps=react%4018.2.0&alias=react%3Apreact%2Fcompat";'
    );
  });

  it("propagates build options to rewritten dependencies", async () => {
    let code = 'import React from "react";';
    let result = await rewriteEsmImports(
      code,
      registry,
      "https://esm.unpkg.com",
      { react: "^18" },
      options("dev&target=es2017&conditions=browser,development&keep-names&ignore-annotations&min&sourcemap")
    );

    expect(result).toBe(
      'import React from "https://esm.unpkg.com/react@18.3.1?dev=&target=es2017&conditions=browser%2Cdevelopment&ignore-annotations=&keep-names=&min=&sourcemap=";'
    );
  });

  it("propagates standalone mode to rewritten dependencies", async () => {
    let code = 'import React from "react";';
    let result = await rewriteEsmImports(code, registry, "https://esm.unpkg.com", { react: "^18" }, options("standalone"));

    expect(result).toBe('import React from "https://esm.unpkg.com/react@18.3.1?standalone=";');
  });

  it("rewrites local imports with the active target", async () => {
    let code = 'import util from "./util";';
    let result = await rewriteEsmImports(code, registry, "https://esm.unpkg.com", {}, options());

    expect(result).toBe('import util from "./util?target=es2022";');
  });

  it("rewrites common Node builtins to browser polyfills", async () => {
    let code = 'import process from "node:process";';
    let result = await rewriteEsmImports(code, registry, "https://esm.unpkg.com", {}, options());

    expect(result).toBe('import process from "https://esm.unpkg.com/@jspm/core@2/nodelibs/browser/process";');
  });

  it("rewrites additional browser-compatible Node builtins to polyfills", async () => {
    let code = 'import crypto from "node:crypto";\nimport os from "os";';
    let result = await rewriteEsmImports(code, registry, "https://esm.unpkg.com", {}, options());

    expect(result).toContain('from "https://esm.unpkg.com/@jspm/core@2/nodelibs/browser/crypto"');
    expect(result).toContain('from "https://esm.unpkg.com/@jspm/core@2/nodelibs/browser/os"');
  });

  it("rewrites Node-only builtins to browser polyfills", async () => {
    let code = 'import fs from "node:fs";';
    let result = await rewriteEsmImports(code, registry, "https://esm.unpkg.com", {}, options());

    expect(result).toBe('import fs from "https://esm.unpkg.com/@jspm/core@2/nodelibs/browser/fs";');
  });

  it("rewrites additional Node-only builtins to browser polyfills", async () => {
    let code = 'import workerThreads from "node:worker_threads";';
    let result = await rewriteEsmImports(code, registry, "https://esm.unpkg.com", {}, options());

    expect(result).toBe(
      'import workerThreads from "https://esm.unpkg.com/@jspm/core@2/nodelibs/browser/worker_threads";'
    );
  });

  it("preserves Node builtins for runtime-native targets", async () => {
    let code = 'import fs from "node:fs";\nimport crypto from "node:crypto";\nimport process from "node:process";';
    let result = await rewriteEsmImports(code, registry, "https://esm.unpkg.com", {}, options("target=node"));

    expect(result).toBe(code);
  });
});

describe("transformSource", () => {
  it("transforms CommonJS default exports", async () => {
    let result = await transformSource(
      "module.exports = function value() { return 1; };",
      "/src/index.cjs",
      options()
    );

    expect(result.code).toContain("export default");
    expect(result.code).toContain("__commonJS");
  });

  it("adds named exports for simple CommonJS export assignments", async () => {
    let result = await transformSource(
      "exports.answer = 42;",
      "/src/index.cjs",
      options()
    );

    expect(result.code).toContain("export { __unpkg_cjs_default as default };");
    expect(result.code).toContain("export const answer = __unpkg_cjs_default.answer;");
  });

  it("rejects dynamic require with a clear diagnostic", async () => {
    await expect(transformSource("require(name);", "/src/index.cjs", options())).rejects.toBeInstanceOf(
      UnsupportedDynamicRequireError
    );
  });

  it("transforms TypeScript and replaces NODE_ENV", async () => {
    let result = await transformSource(
      "export const mode: string = process.env.NODE_ENV;",
      "/src/index.ts",
      options("target=es2017&env=development")
    );

    expect(result.code).toContain('const mode = "development";');
  });

  it("transforms JSX with the automatic runtime", async () => {
    let result = await transformSource(
      "export const view = <div />;",
      "/src/index.jsx",
      options("jsx=automatic&jsxImportSource=preact")
    );

    expect(result.code).toContain("preact/jsx-runtime");
  });

  it("minifies output when requested", async () => {
    let result = await transformSource(
      "export const value = 1 + 2;",
      "/src/index.js",
      options("min")
    );

    expect(result.code.trim()).toMatch(/^const \w=3;export\{\w as value\};$/);
  });
});

describe("bundleSource", () => {
  it("bundles package self-references as package-internal imports", async () => {
    let packageDirectory = await mkdtemp(path.join(tmpdir(), "unpkg-esm-self-reference-"));

    try {
      await writeFile(
        path.join(packageDirectory, "package.json"),
        JSON.stringify({
          name: "self-referencing-package",
          exports: {
            ".": "./index.js",
            "./client": "./client.js",
          },
        })
      );
      await writeFile(path.join(packageDirectory, "index.js"), "exports.createRoot = () => 'ok';");
      await writeFile(
        path.join(packageDirectory, "client.js"),
        "var root = require('self-referencing-package'); exports.createRoot = root.createRoot;"
      );

      let result = await bundleSource(
        packageDirectory,
        {
          name: "self-referencing-package",
          exports: {
            ".": "./index.js",
            "./client": "./client.js",
          },
        },
        "self-referencing-package",
        "1.0.0",
        "/client.js",
        "var root = require('self-referencing-package'); exports.createRoot = root.createRoot;",
        options()
      );

      expect(result.code).not.toContain('Dynamic require of "self-referencing-package"');
      expect(result.code).toContain("createRoot");
      expect(result.code).toContain("export { __unpkg_cjs_default as default };");
      expect(result.code).toContain("export const createRoot = __unpkg_cjs_default.createRoot;");
    } finally {
      await rm(packageDirectory, { force: true, recursive: true });
    }
  });

  it("converts CommonJS dependency requires into static ESM imports", async () => {
    let packageDirectory = await mkdtemp(path.join(tmpdir(), "unpkg-esm-dependency-require-"));

    try {
      let result = await bundleSource(
        packageDirectory,
        { name: "dependency-require-package" },
        "dependency-require-package",
        "1.0.0",
        "/index.js",
        "var React = require('react'); exports.version = React.version;",
        options()
      );

      expect(result.code).not.toContain('Dynamic require of "react"');
      expect(result.code).toContain('from "react"');
    } finally {
      await rm(packageDirectory, { force: true, recursive: true });
    }
  });

  it("adds named exports from bundled CommonJS modules", async () => {
    let packageDirectory = await mkdtemp(path.join(tmpdir(), "unpkg-esm-bundled-cjs-exports-"));

    try {
      await writeFile(path.join(packageDirectory, "production.js"), "exports.createContext = () => 'ok';");
      let result = await bundleSource(
        packageDirectory,
        { name: "bundled-cjs-exports-package" },
        "bundled-cjs-exports-package",
        "1.0.0",
        "/index.js",
        "module.exports = require('./production.js');",
        options()
      );

      expect(result.code).toContain("export const createContext = __unpkg_cjs_default.createContext;");
    } finally {
      await rm(packageDirectory, { force: true, recursive: true });
    }
  });

  it("does not leak dependency exports when the CommonJS entry declares its own surface", async () => {
    let packageDirectory = await mkdtemp(path.join(tmpdir(), "unpkg-esm-bundled-cjs-private-exports-"));

    try {
      await writeFile(
        path.join(packageDirectory, "root.js"),
        "exports.createRoot = () => 'ok'; exports.privateInternal = true;"
      );
      let result = await bundleSource(
        packageDirectory,
        { name: "bundled-cjs-private-exports-package" },
        "bundled-cjs-private-exports-package",
        "1.0.0",
        "/client.js",
        "var root = require('./root.js'); exports.createRoot = root.createRoot;",
        options()
      );

      expect(result.code).toContain("export const createRoot = __unpkg_cjs_default.createRoot;");
      expect(result.code).not.toContain("export const privateInternal");
    } finally {
      await rm(packageDirectory, { force: true, recursive: true });
    }
  });

  it("adds named exports from CommonJS object exports", async () => {
    let result = await transformSource(
      "const camelCase = () => 'ok'; module.exports = { camelCase, forEach: function () { return { nested: true }; } };",
      "/index.js",
      options()
    );

    expect(result.code).toContain("export const camelCase = __unpkg_cjs_default.camelCase;");
    expect(result.code).toContain("export const forEach = __unpkg_cjs_default.forEach;");
  });

  it("preserves ESM dependency re-exports as external ESM", async () => {
    let packageDirectory = await mkdtemp(path.join(tmpdir(), "unpkg-esm-dependency-reexport-"));

    try {
      let result = await bundleSource(
        packageDirectory,
        { name: "dependency-reexport-package" },
        "dependency-reexport-package",
        "1.0.0",
        "/index.js",
        "export * from 'react';",
        options()
      );

      expect(result.code).toContain('export * from "react";');
    } finally {
      await rm(packageDirectory, { force: true, recursive: true });
    }
  });
});

function options(search = "") {
  return normalizeBuildOptions(new URLSearchParams(search));
}

function packageInfo(name: string, versions: string[], latest: string) {
  return {
    name,
    "dist-tags": {
      latest,
    },
    time: {},
    versions: Object.fromEntries(versions.map((version) => [version, { name, version, dependencies: {}, description: "" }])),
  };
}
