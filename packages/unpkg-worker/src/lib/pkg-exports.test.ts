import { expect, describe, it } from "bun:test";

import type { PackageJson } from "./npm-info.ts";
import { resolvePackageExport } from "./pkg-exports.ts";

describe("resolvePackageExport", () => {
  describe("when package.module is a string", () => {
    let packageJson = {
      module: "./dist/module.mjs",
    } as unknown as PackageJson;

    it("does not resolve /", () => {
      expect(resolvePackageExport(packageJson, "/")).toBe(null);
    });

    describe("when useModuleField is used", () => {
      it("resolves /", () => {
        expect(resolvePackageExport(packageJson, "/", { useModuleField: true })).toBe("/dist/module.mjs");
      });
    });
  });

  describe("when package.module AND package.unpkg are strings", () => {
    let packageJson = {
      module: "./dist/module.mjs",
      unpkg: "./dist/unpkg.js",
    } as unknown as PackageJson;

    it("resolves / using the unpkg field", () => {
      expect(resolvePackageExport(packageJson, "/")).toBe("/dist/unpkg.js");
    });

    describe("when useModuleField is used", () => {
      it("resolves / using the module field", () => {
        expect(resolvePackageExport(packageJson, "/", { useModuleField: true })).toBe("/dist/module.mjs");
      });
    });
  });

  describe("when package.browser is a string", () => {
    let packageJson = {
      browser: "./dist/browser.js",
    } as unknown as PackageJson;

    it("does not resolve /", () => {
      expect(resolvePackageExport(packageJson, "/")).toBe(null);
    });

    describe("when useBrowserField is used", () => {
      it("resolves /", () => {
        expect(resolvePackageExport(packageJson, "/", { useBrowserField: true })).toBe("/dist/browser.js");
      });
    });
  });

  describe("when package.browser AND package.unpkg are strings", () => {
    let packageJson = {
      browser: "./dist/browser.js",
      unpkg: "./dist/unpkg.js",
    } as unknown as PackageJson;

    it("resolves / using the unpkg field", () => {
      expect(resolvePackageExport(packageJson, "/")).toBe("/dist/unpkg.js");
    });

    describe("when useBrowserField is used", () => {
      it("resolves / using the browser field", () => {
        expect(resolvePackageExport(packageJson, "/", { useBrowserField: true })).toBe("/dist/browser.js");
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
      expect(resolvePackageExport(packageJson, "/")).toBe(null);
    });

    it('does not resolve "/subpath"', () => {
      expect(resolvePackageExport(packageJson, "/subpath")).toBe(null);
    });

    it("does not resolve a custom filename", () => {
      expect(resolvePackageExport(packageJson, "/path/to/file")).toBe(null);
    });

    describe("when useBrowserField is used", () => {
      it("resolves /", () => {
        expect(resolvePackageExport(packageJson, "/", { useBrowserField: true })).toBe("/dist/browser.js");
      });

      it('resolves "/subpath"', () => {
        expect(resolvePackageExport(packageJson, "/subpath", { useBrowserField: true })).toBe("/dist/subpath.js");
      });

      it("does not resolve a custom filename", () => {
        expect(resolvePackageExport(packageJson, "/path/to/file", { useBrowserField: true })).toBe(null);
      });
    });
  });

  describe("when package.unpkg is a string", () => {
    let packageJson = {
      unpkg: "./dist/unpkg.js",
      exports: "./dist/index.js",
    } as unknown as PackageJson;

    it("resolves /", () => {
      expect(resolvePackageExport(packageJson, "/")).toBe("/dist/unpkg.js");
    });

    it("does not resolve a custom filename", () => {
      expect(resolvePackageExport(packageJson, "/path/to/file")).toBe(null);
    });

    describe("when export conditions are provided", () => {
      it("resolves / using the exports field", () => {
        expect(resolvePackageExport(packageJson, "/", { conditions: ["default"] })).toBe("/dist/index.js");
      });
    });
  });

  describe("when package.exports is a string", () => {
    let packageJson = {
      exports: "./dist/index.js",
    } as PackageJson;

    it("resolves /", () => {
      expect(resolvePackageExport(packageJson, "/")).toBe("/dist/index.js");
    });

    it("does not resolve a custom filename", () => {
      expect(resolvePackageExport(packageJson, "/path/to/file")).toBe(null);
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
      expect(resolvePackageExport(packageJson, "/")).toBe("/dist/index.js");
    });

    it('resolves "/" with matching conditions', () => {
      expect(resolvePackageExport(packageJson, "/", { conditions: ["import"] })).toBe("/dist/index.mjs");
    });

    it('resolves "/" to the first matching export with multiple matching conditions', () => {
      expect(resolvePackageExport(packageJson, "/", { conditions: ["import", "require"] })).toBe("/dist/index.mjs");
    });

    it("does not resolve a custom filename", () => {
      expect(resolvePackageExport(packageJson, "/path/to/file")).toBe(null);
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
      expect(resolvePackageExport(packageJson, "/")).toBe("/dist/index.js");
    });

    it('resolves "/subpath"', () => {
      expect(resolvePackageExport(packageJson, "/subpath")).toBe("/dist/subpath.js");
    });

    it("does not resolve a custom filename", () => {
      expect(resolvePackageExport(packageJson, "/path/to/file")).toBe(null);
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
      expect(resolvePackageExport(packageJson, "/")).toBe("/dist/index.js");
    });

    it("resolves / with matching conditions", () => {
      expect(resolvePackageExport(packageJson, "/", { conditions: ["import"] })).toBe("/dist/index.mjs");
    });

    it("resolves / to the first matching export with multiple matching conditions", () => {
      expect(resolvePackageExport(packageJson, "/", { conditions: ["import", "require"] })).toBe("/dist/index.mjs");
    });

    it("does not resolve / with non-matching conditions", () => {
      expect(resolvePackageExport(packageJson, "/", { conditions: ["worker"] })).toBe(null);
    });

    it('resolves "/subpath"', () => {
      expect(resolvePackageExport(packageJson, "/subpath")).toBe("/dist/subpath.js");
    });

    it('resolves "/subpath" with matching conditions', () => {
      expect(resolvePackageExport(packageJson, "/subpath", { conditions: ["import"] })).toBe("/dist/subpath.mjs");
    });

    it('resolves "/subpath" to the first matching export with multiple matching conditions', () => {
      expect(resolvePackageExport(packageJson, "/subpath", { conditions: ["import", "require"] })).toBe(
        "/dist/subpath.mjs"
      );
    });

    it('does not resolve "/subpath" with non-matching conditions', () => {
      expect(resolvePackageExport(packageJson, "/subpath", { conditions: ["worker"] })).toBe(null);
    });

    it("does not resolve a custom filename", () => {
      expect(resolvePackageExport(packageJson, "/path/to/file")).toBe(null);
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
      expect(resolvePackageExport(packageJson, "/")).toBe("/dist/index.js");
    });

    it("does not resolve a custom filename", () => {
      expect(resolvePackageExport(packageJson, "/path/to/file")).toBe(null);
    });
  });

  describe("when package.main is a string", () => {
    let packageJson = {
      main: "./dist/main.js",
    } as unknown as PackageJson;

    it("resolves /", () => {
      expect(resolvePackageExport(packageJson, "/")).toBe("/dist/main.js");
    });

    it("does not resolve a custom filename", () => {
      expect(resolvePackageExport(packageJson, "/path/to/file")).toBe(null);
    });
  });
});
