import { describe, expect, it } from "bun:test";
import { render } from "preact-render-to-string";
import type { PackageFile, PackageFileMetadata, PackageInfo } from "unpkg-worker";

import type { Env } from "../env.ts";
import { HrefBuilder } from "../href-builder.ts";
import { HrefsContext } from "../hrefs-context.ts";

import { FileDetail, maxTextPreviewSize } from "./file-detail.tsx";

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
    let lines = Array.from(
      { length: 36_707 },
      (_, index) => `line ${index.toString().padStart(5, "0")} ${"x".repeat(24)}`,
    );
    let text = lines.join("\n");
    let lastLine = lines.at(-1) ?? "";
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

    expect(text.length).toBeLessThan(maxTextPreviewSize);
    expect(lastLine).not.toBe("");
    expect(html).toContain(lastLine);
    expect(html).not.toContain("&quot;key&quot;:&quot;CodeViewer&quot;");
    expect(html.match(/id="L\d+"/g) ?? []).toHaveLength(0);
    expect(html.length).toBeLessThan(text.length * 2);
  });

  it("links to the raw file when a text file is too large to preview", () => {
    let file: PackageFileMetadata = {
      integrity: "sha256-test",
      path: "/large.txt",
      size: maxTextPreviewSize + 1,
      type: "text/plain",
    };

    let html = render(
      <HrefsContext.Provider value={new HrefBuilder(env)}>
        <FileDetail packageInfo={packageInfo} version="1.0.0" filename="/large.txt" file={file} />
      </HrefsContext.Provider>,
    );

    expect(html).toContain("This file is too large to preview.");
    expect(html).toContain('href="https://unpkg.com/example@1.0.0/large.txt"');
  });

  it("renders line-heavy files as static plaintext", () => {
    let text = Array.from({ length: 2_001 }, () => "x").join("\n");
    let file: PackageFile = {
      body: new TextEncoder().encode(text),
      integrity: "sha256-test",
      path: "/many-lines.txt",
      size: text.length,
      type: "text/plain",
    };

    let html = render(
      <HrefsContext.Provider value={new HrefBuilder(env)}>
        <FileDetail packageInfo={packageInfo} version="1.0.0" filename="/many-lines.txt" file={file} />
      </HrefsContext.Provider>,
    );

    expect(html).not.toContain("&quot;key&quot;:&quot;CodeViewer&quot;");
    expect(html.match(/id="L\d+"/g) ?? []).toHaveLength(0);
  });

  it("counts a newline-dense preview without interactive line elements", () => {
    let text = "x\n".repeat(1_000_000);
    let file: PackageFile = {
      body: new TextEncoder().encode(text),
      integrity: "sha256-test",
      path: "/dense-lines.txt",
      size: text.length,
      type: "text/plain",
    };

    let html = render(
      <HrefsContext.Provider value={new HrefBuilder(env)}>
        <FileDetail packageInfo={packageInfo} version="1.0.0" filename="/dense-lines.txt" file={file} />
      </HrefsContext.Provider>,
    );

    expect(text.length).toBeLessThan(maxTextPreviewSize);
    expect(html).toContain("1,000,001 lines");
    expect(html).not.toContain("&quot;key&quot;:&quot;CodeViewer&quot;");
  });

  it("does not render text whose escaped output exceeds the preview budget", () => {
    let text = "&".repeat(maxTextPreviewSize);
    let file: PackageFile = {
      body: new TextEncoder().encode(text),
      integrity: "sha256-test",
      path: "/escaped-output.txt",
      size: text.length,
      type: "text/plain",
    };

    let html = render(
      <HrefsContext.Provider value={new HrefBuilder(env)}>
        <FileDetail packageInfo={packageInfo} version="1.0.0" filename="/escaped-output.txt" file={file} />
      </HrefsContext.Provider>,
    );

    expect(html).toContain("This file is too large to preview.");
    expect(html.length).toBeLessThan(100_000);
  });
});
