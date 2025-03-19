import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PackageJson } from "./pkg-info.ts";
import { resolvePackageExport } from "./pkg-exports.ts";

describe("resolvePackageExport", () => {
  it("resolves when package.exports is a string", () => {
    let packageJson = {
      exports: "./dist/index.js",
    } as PackageJson;
    assert.equal(resolvePackageExport(packageJson, "/"), "/dist/index.js");
  });

  it("resolves when package.exports is an object with export conditions", () => {
    let packageJson = {
      exports: { import: "./dist/index.js", require: "./dist/index.cjs", default: "./dist/index.js" },
    } as unknown as PackageJson;
    assert.equal(resolvePackageExport(packageJson, "/"), "/dist/index.js");
  });

  it('resolves when package.exports is an object with "." key', () => {
    let packageJson = {
      exports: { ".": "./dist/index.js" },
    } as unknown as PackageJson;
    assert.equal(resolvePackageExport(packageJson, "/"), "/dist/index.js");
  });

  it('resolves when package.exports is an object with "." key and conditions', () => {
    let packageJson = {
      exports: { ".": { default: "./dist/index.js" } },
    } as unknown as PackageJson;
    assert.equal(resolvePackageExport(packageJson, "/", { conditions: ["default"] }), "/dist/index.js");
  });

  it("resolves to the first matching export when package.exports is an object with multiple matching conditions", () => {
    let packageJson = {
      exports: { ".": { default: "./dist/default.js", require: "./dist/common.js" } },
    } as unknown as PackageJson;
    assert.equal(resolvePackageExport(packageJson, "/", { conditions: ["default", "require"] }), "/dist/default.js");
  });

  describe("when supported conditions are explicitly provided", () => {
    it("resolves to the first matching condition", () => {
      let packageJson = {
        exports: { ".": { default: "./dist/default.js", require: "./dist/common.js" } },
      } as unknown as PackageJson;
      assert.equal(resolvePackageExport(packageJson, "/", { conditions: ["default", "require"] }), "/dist/default.js");
    });
  });

  describe("when no supported conditions are explicitly provided", () => {
    it("resolves first to the default condition", () => {
      let packageJson = {
        exports: { ".": { default: "./dist/default.js", unpkg: "./dist/unpkg.js" } },
      } as unknown as PackageJson;
      assert.equal(resolvePackageExport(packageJson, "/"), "/dist/default.js");
    });

    it("resolves to the unpkg condition when it is listed first in package.exports", () => {
      let packageJson = {
        exports: { ".": { unpkg: "./dist/unpkg.js", default: "./dist/default.js" } },
      } as unknown as PackageJson;
      assert.equal(resolvePackageExport(packageJson, "/"), "/dist/unpkg.js");
    });
  });

  describe("when using the legacy browser field", () => {
    it('resolves to the browser field when the entry is "."', () => {
      let packageJson = {
        browser: "./dist/browser.js",
      } as unknown as PackageJson;
      assert.equal(resolvePackageExport(packageJson, "/", { useLegacyBrowserField: true }), "/dist/browser.js");
    });
  });

  describe("when using the legacy module field", () => {
    it('resolves to the module field when the entry is "."', () => {
      let packageJson = {
        module: "./dist/module.mjs",
      } as unknown as PackageJson;
      assert.equal(resolvePackageExport(packageJson, "/", { useLegacyModuleField: true }), "/dist/module.mjs");
    });
  });

  it('resolves to the unpkg field when the entry is "."', () => {
    let packageJson = {
      unpkg: "./dist/unpkg.js",
    } as PackageJson;
    assert.equal(resolvePackageExport(packageJson, "/"), "/dist/unpkg.js");
  });

  it('resolves to the main field when the entry is "."', () => {
    let packageJson = {
      main: "./dist/main.js",
    } as PackageJson;
    assert.equal(resolvePackageExport(packageJson, "/"), "/dist/main.js");
  });
});
