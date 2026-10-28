import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ExtractedCache } from "./extracted-cache.ts";
import { getFile, listFiles } from "./npm-files.ts";
import { resetDefaultTarballCacheForTests, TarballCache } from "./tarball-cache.ts";
import { packageTarballs } from "../../test/fixtures.ts";

async function tempExtracted(opts: Partial<{ maxBytes: number; promotionThreshold: number; maxFiles: number }> = {}) {
  let directory = await mkdtemp(path.join(os.tmpdir(), "unpkg-extracted-test-"));
  let cache = new ExtractedCache({
    directory,
    maxBytes: opts.maxBytes ?? 1_000_000,
    promotionThreshold: opts.promotionThreshold ?? 3,
    maxFiles: opts.maxFiles ?? 10_000,
  });
  return { cache, directory };
}

describe("ExtractedCache", () => {
  it("promotes only after the hit threshold and extracts once (single-flight)", async () => {
    let { cache, directory } = await tempExtracted();
    let extracts = 0;
    let extractFn = async (dir: string) => {
      extracts++;
      await writeFile(path.join(dir, "a.js"), "aaa");
      return { size: 3, files: 1, listing: [{ path: "/a.js", size: 3, integrity: "sha256-x" }] };
    };

    expect(await cache.maybeExtract("p@1.0.0", extractFn)).toBeNull();
    expect(await cache.maybeExtract("p@1.0.0", extractFn)).toBeNull();
    let promoted = await cache.maybeExtract("p@1.0.0", extractFn);
    expect(promoted).not.toBeNull();
    expect(extracts).toBe(1);

    let again = await cache.maybeExtract("p@1.0.0", extractFn);
    expect(again?.directory).toBe(promoted!.directory);
    expect(extracts).toBe(1);
    await rm(directory, { recursive: true, force: true });
  });

  it("rejects packages over the file-count ceiling and does not retry", async () => {
    let { cache, directory } = await tempExtracted({ promotionThreshold: 1, maxFiles: 2 });
    let extracts = 0;
    let extractFn = async (dir: string) => {
      extracts++;
      return { size: 9, files: 99, listing: [] };
    };
    expect(await cache.maybeExtract("huge@1.0.0", extractFn)).toBeNull();
    expect(await cache.maybeExtract("huge@1.0.0", extractFn)).toBeNull();
    expect(extracts).toBe(1);
    await rm(directory, { recursive: true, force: true });
  });
});

describe("ExtractedCache eviction hysteresis", () => {
  it("never evicts entries younger than the minimum residence", async () => {
    let directory = await mkdtemp(path.join(os.tmpdir(), "unpkg-extracted-hyst-"));
    let cache = new ExtractedCache({
      directory,
      maxBytes: 12,
      promotionThreshold: 1,
      maxFiles: 100,
      minResidenceMs: 3_600_000,
    });
    let extractFn = async (dir: string) => {
      await writeFile(path.join(dir, "a.js"), "12345");
      return { size: 10, files: 1, listing: [{ path: "/a.js", size: 10, integrity: "sha256-x" }] };
    };
    let a = await cache.maybeExtract("a@1.0.0", extractFn);
    await a?.release();
    let b = await cache.maybeExtract("b@1.0.0", extractFn);
    await b?.release();
    // Over the 12-byte cap, but both entries are minutes old at most:
    // hysteresis keeps them rather than write-churning fresh trees.
    expect(cache.stats().entries).toBe(2);
    expect(cache.stats().evictions).toBe(0);
    await rm(directory, { recursive: true, force: true });
  });
});

describe("extracted tier integration (npm-files)", () => {
  it("serves repeated distinct files from the extracted tree", async () => {
    let tarballDir = await mkdtemp(path.join(os.tmpdir(), "unpkg-tier2-tarballs-"));
    let extractedDir = await mkdtemp(path.join(os.tmpdir(), "unpkg-tier2-extracted-"));
    resetDefaultTarballCacheForTests(
      new TarballCache({ directory: tarballDir, maxBytes: 100_000_000, admissionThreshold: 2 })
    );
    let { resetDefaultExtractedCacheForTests } = await import("./extracted-cache.ts");
    resetDefaultExtractedCacheForTests(
      new ExtractedCache({ directory: extractedDir, maxBytes: 100_000_000, promotionThreshold: 3, maxFiles: 10_000 })
    );

    let fetches = 0;
    let originalFetch = globalThis.fetch;
    // @ts-expect-error - test stub mirrors npm-files.test.ts
    globalThis.fetch = async (input: RequestInfo | URL) => {
      let url = input instanceof Request ? input.url : String(input);
      if (url === "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz") {
        fetches++;
        return new Response(Bun.file(packageTarballs.lodash["4.17.21"]));
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    try {
      let registry = "https://registry.npmjs.org";
      for (let name of ["/lodash.js", "/package.json", "/LICENSE", "/README.md"]) {
        let file = await getFile(registry, "lodash", "4.17.21", name);
        expect(file?.path).toBe(name);
      }
      let listing = await listFiles(registry, "lodash", "4.17.21", "/");
      expect(listing.length).toBe(1054);
      // Once extracted, getFile serves a streamed body (no whole-file
      // Buffer): bodyStream is set and yields the exact bytes.
      let streamed = await getFile(registry, "lodash", "4.17.21", "/package.json");
      expect(streamed?.bodyStream).toBeDefined();
      expect(streamed?.size).toBeGreaterThan(0);
      let bytes = new Uint8Array(await streamed!.bodyStream!.arrayBuffer());
      expect(bytes.byteLength).toBe(streamed!.size);
      expect(new TextDecoder().decode(bytes)).toContain('"name": "lodash"');
      // Tarball downloaded only during admission (2), extraction reuses it.
      expect(fetches).toBe(2);
      let extractedEntries = await readdir(extractedDir);
      expect(extractedEntries.some((e) => e.endsWith(".listing.json"))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      resetDefaultTarballCacheForTests(null);
      resetDefaultExtractedCacheForTests(null);
      await rm(tarballDir, { recursive: true, force: true });
      await rm(extractedDir, { recursive: true, force: true });
    }
  });
});
