import { describe, expect, it } from "bun:test";
import { render } from "preact-render-to-string";
import type { PackageFile, PackageInfo } from "unpkg-worker";

import type { Env } from "../env.ts";
import { HrefBuilder } from "../href-builder.ts";
import { HrefsContext } from "../hrefs-context.ts";

import { FileDetail } from "./file-detail.tsx";

const env: Env = {
  ASSETS_ORIGIN: "https://app.unpkg.com",
  DEV: false,
  FILES_ORIGIN: "https://files.unpkg.com",
  MODE: "test",
  ORIGIN: "https://app.unpkg.com",
  WWW_ORIGIN: "https://unpkg.com",
};

const packageInfo: PackageInfo = {
  name: "example",
  time: {},
  "dist-tags": { latest: "1.0.0" },
  versions: {
    "1.0.0": {
      dependencies: {},
      description: "An example package",
      name: "example",
      version: "1.0.0",
    },
  },
};

describe("FileDetail", () => {
  it("renders all of a text file that is too large to highlight", () => {
    let text = `${"a".repeat(50_001)}end-of-file`;
    let file: PackageFile = {
      body: new TextEncoder().encode(text),
      integrity: "sha256-test",
      path: "/large.txt",
      size: text.length,
      type: "text/plain",
    };

    let html = render(
      <HrefsContext.Provider value={new HrefBuilder(env)}>
        <FileDetail packageInfo={packageInfo} version="1.0.0" filename="/large.txt" file={file} />
      </HrefsContext.Provider>,
    );

    expect(html).toContain("end-of-file");
  });
});
