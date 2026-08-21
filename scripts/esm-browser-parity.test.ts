import { describe, expect, it } from "bun:test";

import { compareExportKeys } from "./esm-browser-parity.ts";

describe("compareExportKeys", () => {
  it("ignores export ordering", () => {
    expect(compareExportKeys(["render", "default", "hydrate"], ["default", "hydrate", "render"])).toBeNull();
  });

  it("reports missing and extra exports", () => {
    expect(compareExportKeys(["createRoot", "hydrateRoot"], ["createRoot", "render"])).toBe(
      'export surface mismatch: missing=["hydrateRoot"], extra=["render"]'
    );
  });
});
