import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PackageJson } from "./unpkg-client.ts";
import { resolvePackageExport } from "./pkg-exports.ts";

describe("resolvePackageExport", () => {
  describe("when package.module is a string", () => {
    let packageJson = {
      module: "./dist/module.mjs",
    } as unknown as PackageJson;

    it("does not resolve /", () => {
      assert.equal(resolvePackageExport(packageJson, "/"), null);
    });

    describe("when useModuleField is used", () => {
      it("resolves /", () => {
        assert.equal(resolvePackageExport(packageJson, "/", { useModuleField: true }), "/dist/module.mjs");
      });
    });
  });

  describe("when package.module AND package.unpkg are strings", () => {
    let packageJson = {
      module: "./dist/module.mjs",
      unpkg: "./dist/unpkg.js",
    } as unknown as PackageJson;

    it("resolves / using the unpkg field", () => {
      assert.equal(resolvePackageExport(packageJson, "/"), "/dist/unpkg.js");
    });

    describe("when useModuleField is used", () => {
      it("resolves / using the module field", () => {
        assert.equal(resolvePackageExport(packageJson, "/", { useModuleField: true }), "/dist/module.mjs");
      });
    });
  });

  describe("when package.browser is a string", () => {
    let packageJson = {
      browser: "./dist/browser.js",
    } as unknown as PackageJson;

    it("does not resolve /", () => {
      assert.equal(resolvePackageExport(packageJson, "/"), null);
    });

    describe("when useBrowserField is used", () => {
      it("resolves /", () => {
        assert.equal(resolvePackageExport(packageJson, "/", { useBrowserField: true }), "/dist/browser.js");
      });
    });
  });

  describe("when package.browser AND package.unpkg are strings", () => {
    let packageJson = {
      browser: "./dist/browser.js",
      unpkg: "./dist/unpkg.js",
    } as unknown as PackageJson;

    it("resolves / using the unpkg field", () => {
      assert.equal(resolvePackageExport(packageJson, "/"), "/dist/unpkg.js");
    });

    describe("when useBrowserField is used", () => {
      it("resolves / using the browser field", () => {
        assert.equal(resolvePackageExport(packageJson, "/", { useBrowserField: true }), "/dist/browser.js");
      });
    });
  });

  describe("when package.browser is an object with subpaths", () => {
    let packageJson = {
      browser: {
        ".": "./dist/browser.js",
        "./subpath": "./dist/subpath.js",
      },
    } as unknown as PackageJson;

    it("does not resolve /", () => {
      assert.equal(resolvePackageExport(packageJson, "/"), null);
    });

    it('does not resolve "/subpath"', () => {
      assert.equal(resolvePackageExport(packageJson, "/subpath"), null);
    });

    it("does not resolve a custom filename", () => {
      assert.equal(resolvePackageExport(packageJson, "/path/to/file"), null);
    });

    describe("when useBrowserField is used", () => {
      it("resolves /", () => {
        assert.equal(resolvePackageExport(packageJson, "/", { useBrowserField: true }), "/dist/browser.js");
      });

      it('resolves "/subpath"', () => {
        assert.equal(resolvePackageExport(packageJson, "/subpath", { useBrowserField: true }), "/dist/subpath.js");
      });

      it("does not resolve a custom filename", () => {
        assert.equal(resolvePackageExport(packageJson, "/path/to/file", { useBrowserField: true }), null);
      });
    });
  });

  describe("when package.unpkg is a string", () => {
    let packageJson = {
      unpkg: "./dist/unpkg.js",
      exports: "./dist/index.js",
    } as unknown as PackageJson;

    it("resolves /", () => {
      assert.equal(resolvePackageExport(packageJson, "/"), "/dist/unpkg.js");
    });

    it("does not resolve a custom filename", () => {
      assert.equal(resolvePackageExport(packageJson, "/path/to/file"), null);
    });

    describe("when export conditions are provided", () => {
      it("resolves / using the exports field", () => {
        assert.equal(resolvePackageExport(packageJson, "/", { conditions: ["default"] }), "/dist/index.js");
      });
    });
  });

  describe("when package.exports is a string", () => {
    let packageJson = {
      exports: "./dist/index.js",
    } as PackageJson;

    it("resolves /", () => {
      assert.equal(resolvePackageExport(packageJson, "/"), "/dist/index.js");
    });

    it("does not resolve a custom filename", () => {
      assert.equal(resolvePackageExport(packageJson, "/path/to/file"), null);
    });
  });

  describe("when package.exports is an object with export conditions", () => {
    let packageJson = {
      exports: {
        import: "./dist/index.mjs",
        require: "./dist/index.cjs",
        default: "./dist/index.js",
      },
    } as unknown as PackageJson;

    it("resolves /", () => {
      assert.equal(resolvePackageExport(packageJson, "/"), "/dist/index.js");
    });

    it('resolves "/" with matching conditions', () => {
      assert.equal(resolvePackageExport(packageJson, "/", { conditions: ["import"] }), "/dist/index.mjs");
    });

    it('resolves "/" to the first matching export with multiple matching conditions', () => {
      assert.equal(resolvePackageExport(packageJson, "/", { conditions: ["import", "require"] }), "/dist/index.mjs");
    });

    it("does not resolve a custom filename", () => {
      assert.equal(resolvePackageExport(packageJson, "/path/to/file"), null);
    });
  });

  describe("when package.exports is an object with subpaths", () => {
    let packageJson = {
      exports: {
        ".": "./dist/index.js",
        "./subpath": "./dist/subpath.js",
      },
    } as unknown as PackageJson;

    it("resolves /", () => {
      assert.equal(resolvePackageExport(packageJson, "/"), "/dist/index.js");
    });

    it('resolves "/subpath"', () => {
      assert.equal(resolvePackageExport(packageJson, "/subpath"), "/dist/subpath.js");
    });

    it("does not resolve a custom filename", () => {
      assert.equal(resolvePackageExport(packageJson, "/path/to/file"), null);
    });
  });

  describe("when package.exports is a nested object with subpaths and export conditions", () => {
    let packageJson = {
      exports: {
        ".": {
          import: "./dist/index.mjs",
          require: "./dist/index.cjs",
          default: "./dist/index.js",
        },
        "./subpath": {
          import: "./dist/subpath.mjs",
          require: "./dist/subpath.cjs",
          default: "./dist/subpath.js",
        },
      },
    } as unknown as PackageJson;

    it("resolves /", () => {
      assert.equal(resolvePackageExport(packageJson, "/"), "/dist/index.js");
    });

    it("resolves / with matching conditions", () => {
      assert.equal(resolvePackageExport(packageJson, "/", { conditions: ["import"] }), "/dist/index.mjs");
    });

    it("resolves / to the first matching export with multiple matching conditions", () => {
      assert.equal(resolvePackageExport(packageJson, "/", { conditions: ["import", "require"] }), "/dist/index.mjs");
    });

    it("does not resolve / with non-matching conditions", () => {
      assert.equal(resolvePackageExport(packageJson, "/", { conditions: ["worker"] }), null);
    });

    it('resolves "/subpath"', () => {
      assert.equal(resolvePackageExport(packageJson, "/subpath"), "/dist/subpath.js");
    });

    it('resolves "/subpath" with matching conditions', () => {
      assert.equal(resolvePackageExport(packageJson, "/subpath", { conditions: ["import"] }), "/dist/subpath.mjs");
    });

    it('resolves "/subpath" to the first matching export with multiple matching conditions', () => {
      assert.equal(
        resolvePackageExport(packageJson, "/subpath", { conditions: ["import", "require"] }),
        "/dist/subpath.mjs",
      );
    });

    it('does not resolve "/subpath" with non-matching conditions', () => {
      assert.equal(resolvePackageExport(packageJson, "/subpath", { conditions: ["worker"] }), null);
    });

    it("does not resolve a custom filename", () => {
      assert.equal(resolvePackageExport(packageJson, "/path/to/file"), null);
    });
  });

  describe("when package.exports is an object with export conditions that do not match", () => {
    let packageJson = {
      exports: {
        import: "./dist/index.mjs",
        require: "./dist/index.cjs",
      },
      main: "./dist/index.js",
    } as unknown as PackageJson;

    it('resolves / to the "main" field', () => {
      assert.equal(resolvePackageExport(packageJson, "/"), "/dist/index.js");
    });

    it("does not resolve a custom filename", () => {
      assert.equal(resolvePackageExport(packageJson, "/path/to/file"), null);
    });
  });

  describe("when package.main is a string", () => {
    let packageJson = {
      main: "./dist/main.js",
    } as unknown as PackageJson;

    it("resolves /", () => {
      assert.equal(resolvePackageExport(packageJson, "/"), "/dist/main.js");
    });

    it("does not resolve a custom filename", () => {
      assert.equal(resolvePackageExport(packageJson, "/path/to/file"), null);
    });
  });
});
