import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PackageJson } from "./pkg-info.ts";
import { resolvePackageExport } from "./pkg-exports.ts";

describe("resolvePackageExport", () => {
  it("resolves when package.exports is a string", () => {
    let packageJson = {
      exports: "./dist/index.js",
    } as PackageJson;
    assert.equal(resolvePackageExport(packageJson), "/dist/index.js");
  });
});
