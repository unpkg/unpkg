import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { createGunzip, createGzip } from "node:zlib";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, open, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import os from "node:os";
import path from "node:path";

import { FileCache, indexTarFile, TarIndexUnsupportedError } from "./file-cache.ts";
import { getFile, listFiles } from "./npm-files.ts";
import { getSubresourceIntegrity } from "./subresource-integrity.ts";
import { resetDefaultTarballCacheForTests, TarballCache } from "./tarball-cache.ts";
import { resetDefaultFileCacheForTests } from "./file-cache.ts";
import { resetDefaultExtractedCacheForTests } from "./extracted-cache.ts";
import { packageTarballs } from "../../test/fixtures.ts";

async function gunzipToTar(tgz: string, dir: string): Promise<string> {
  let tarPath = path.join(dir, "pkg.tar");
  await pipeline(createReadStream(tgz), createGunzip(), createWriteStream(tarPath));
  return tarPath;
}

async function sliceBytes(tarPath: string, offset: number, size: number): Promise<Buffer> {
  let handle = await open(tarPath, "r");
  try {
    let buf = Buffer.alloc(size);
    await handle.read(buf, 0, size, offset);
    return buf;
  } finally {
    await handle.close();
  }
}

async function walk(dir: string, base = dir): Promise<string[]> {
  let out: string[] = [];
  for (let entry of await readdir(dir, { withFileTypes: true })) {
    let full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

describe("indexTarFile oracle (vs system tar extraction)", () => {
  for (let [name, tgz] of [
    ["lodash", packageTarballs.lodash["4.17.21"]],
    ["react", packageTarballs.react["18.2.0"]],
    ["preact", packageTarballs.preact["10.26.4"]],
  ] as const) {
    it(`matches extracted bytes, sizes, and integrity for every file in ${name}`, async () => {
      let dir = await mkdtemp(path.join(os.tmpdir(), "unpkg-filecache-oracle-"));
      try {
        let tarPath = await gunzipToTar(tgz, dir);
        let index = await indexTarFile(tarPath);
        expect(index.length).toBeGreaterThan(0);

        let extractDir = path.join(dir, "extracted");
        await mkdir(extractDir, { recursive: true });
        execFileSync("tar", ["-xzf", tgz, "-C", extractDir]);
        let roots = await readdir(extractDir);
        expect(roots.length).toBe(1);
        let root = path.join(extractDir, roots[0]!);
        let files = await walk(root);
        expect(index.length).toBe(files.length);

        let byPath = new Map(index.map((e) => [e.path, e]));
        for (let rel of files) {
          let entry = byPath.get(`/${rel}`);
          expect(entry, `index missing /${rel}`).toBeDefined();
          let expected = await readFile(path.join(root, rel));
          expect(entry!.size).toBe(expected.length);
          expect(entry!.integrity).toBe(getSubresourceIntegrity(expected));
          let actual = await sliceBytes(tarPath, entry!.offset, entry!.size);
          expect(Buffer.compare(actual, expected)).toBe(0);
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
});

describe("indexTarFile synthetic edge cases", () => {
  it("handles long paths, empty files, and binary content", async () => {
    let dir = await mkdtemp(path.join(os.tmpdir(), "unpkg-filecache-synth-"));
    try {
      let pkg = path.join(dir, "package");
      let longRel = `${"verylongdirectoryname".repeat(3)}/${"nested".repeat(10)}/deep-file.js`;
      await mkdir(path.join(pkg, path.dirname(longRel)), { recursive: true });
      await mkdir(path.join(pkg, "empty-dir"), { recursive: true });
      await writeFile(path.join(pkg, longRel), "deep content");
      await writeFile(path.join(pkg, "empty.js"), "");
      await writeFile(path.join(pkg, "bin.dat"), Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 256)));
      let tgz = path.join(dir, "synth.tgz");
      execFileSync("tar", ["-czf", tgz, "-C", dir, "package"]);
      let tarPath = await gunzipToTar(tgz, dir);
      let index = await indexTarFile(tarPath);
      let byPath = new Map(index.map((e) => [e.path, e]));
      expect(byPath.get(`/${longRel}`)?.size).toBe(12);
      expect(byPath.get("/empty.js")?.size).toBe(0);
      let bin = byPath.get("/bin.dat")!;
      expect(bin.size).toBe(5000);
      let bytes = await sliceBytes(tarPath, bin.offset, bin.size);
      expect(bytes[4097]).toBe(4097 % 256);
      let deep = byPath.get(`/${longRel}`)!;
      expect((await sliceBytes(tarPath, deep.offset, deep.size)).toString()).toBe("deep content");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function tarHeader(name: string, size: number, type: string): Buffer {
  let header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "utf8");
  header.write(size.toString(8).padStart(11, "0") + " ", 124, 12, "utf8");
  header.write(type, 156, 1, "utf8");
  header.write("ustar\0", 257, 6, "utf8");
  header.write("00", 263, 2, "utf8");
  header.fill(0x20, 148, 156);
  let sum = [...header].reduce((a, b) => a + b, 0);
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf8");
  return header;
}

function tarData(content: Buffer): Buffer {
  let padding = (512 - (content.length % 512)) % 512;
  return Buffer.concat([content, Buffer.alloc(padding)]);
}

function paxRecord(key: string, value: string): Buffer {
  // Pax lengths are byte counts, including for multibyte values.
  let kv = `${key}=${value}\n`;
  let kvBytes = Buffer.byteLength(kv, "utf8");
  let len = kvBytes + 2;
  while (String(len).length + 1 + kvBytes !== len) len = String(len).length + 1 + kvBytes;
  return Buffer.from(`${len} ${kv}`, "utf8");
}

describe("indexTarFile unsupported variants", () => {
  it("rejects GNU sparse entries instead of guessing offsets", async () => {
    let dir = await mkdtemp(path.join(os.tmpdir(), "unpkg-filecache-sparse-"));
    try {
      let tarPath = path.join(dir, "sparse.tar");
      await writeFile(
        tarPath,
        Buffer.concat([
          tarHeader("package/sparse.bin", 5, "S"),
          tarData(Buffer.from("hello")),
          tarHeader("package/real.js", 4, "0"),
          tarData(Buffer.from("real")),
          Buffer.alloc(1024),
        ])
      );
      await expect(indexTarFile(tarPath)).rejects.toBeInstanceOf(TarIndexUnsupportedError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("parses pax paths with multibyte characters by byte offsets", async () => {
    let dir = await mkdtemp(path.join(os.tmpdir(), "unpkg-filecache-paxpath-"));
    try {
      let tarPath = path.join(dir, "paxpath.tar");
      // Regression: pax record lengths are byte counts. Parsing the
      // header as a JS string shifted offsets after the em-dash and
      // corrupted this path in production (@pepicons/vue); build
      // cross-validation caught it before any bad bytes shipped.
      let pax = paxRecord("path", "package/Color \u2014 CSS.vue.d.ts");
      await writeFile(
        tarPath,
        Buffer.concat([
          tarHeader("package/pax", pax.length, "x"),
          tarData(pax),
          tarHeader("package/Color", 5, "0"),
          tarData(Buffer.from("hello")),
          Buffer.alloc(1024),
        ])
      );
      let index = await indexTarFile(tarPath);
      expect(index.length).toBe(1);
      expect(index[0]!.path).toBe("/Color \u2014 CSS.vue.d.ts");
      expect((await sliceBytes(tarPath, index[0]!.offset, index[0]!.size)).toString()).toBe("hello");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("honors a pax size override for the following entry", async () => {
    let dir = await mkdtemp(path.join(os.tmpdir(), "unpkg-filecache-paxsize-"));
    try {
      let tarPath = path.join(dir, "pax.tar");
      let pax = paxRecord("size", "5");
      await writeFile(
        tarPath,
        Buffer.concat([
          tarHeader("package/pax", pax.length, "x"),
          tarData(pax),
          // Header size deliberately 0: the pax record is authoritative.
          tarHeader("package/big.bin", 0, "0"),
          tarData(Buffer.from("hello")),
          tarHeader("package/after.js", 4, "0"),
          tarData(Buffer.from("real")),
          Buffer.alloc(1024),
        ])
      );
      let index = await indexTarFile(tarPath);
      let big = index.find((e) => e.path === "/big.bin");
      expect(big?.size).toBe(5);
      expect((await sliceBytes(tarPath, big!.offset, big!.size)).toString()).toBe("hello");
      let after = index.find((e) => e.path === "/after.js");
      expect((await sliceBytes(tarPath, after!.offset, after!.size)).toString()).toBe("real");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("FileCache", () => {
  it("promotes only after the threshold and builds once (single-flight)", async () => {
    let directory = await mkdtemp(path.join(os.tmpdir(), "unpkg-filecache-unit-"));
    let cache = new FileCache({ directory, maxBytes: 1_000_000, promotionThreshold: 3 });
    let builds = 0;
    let buildFn = async (staging: string) => {
      builds++;
      await writeFile(staging, "x".repeat(100));
      return { size: 100, listing: [{ path: "/a.js", offset: 0, size: 3, integrity: "sha256-x" }] };
    };
    expect(await cache.maybeBuild("p@1.0.0", buildFn)).toBeNull();
    expect(await cache.maybeBuild("p@1.0.0", buildFn)).toBeNull();
    let promoted = await cache.maybeBuild("p@1.0.0", buildFn);
    expect(promoted).not.toBeNull();
    expect(builds).toBe(1);
    let [a, b] = await Promise.all([cache.maybeBuild("p@1.0.0", buildFn), cache.peek("p@1.0.0")]);
    expect(builds).toBe(1);
    expect(a?.tarPath).toBe(promoted!.tarPath);
    expect(b?.tarPath).toBe(promoted!.tarPath);
    await a?.release();
    await b?.release();
    await promoted?.release();
    await rm(directory, { recursive: true, force: true });
  });

  it("counts a throwing build as a failure and falls back without rejecting", async () => {
    let directory = await mkdtemp(path.join(os.tmpdir(), "unpkg-filecache-throw-"));
    let cache = new FileCache({ directory, maxBytes: 1_000_000, promotionThreshold: 1 });
    let attempts = 0;
    let buildFn = async () => {
      attempts++;
      throw new Error("unsupported tar variant");
    };
    expect(await cache.maybeBuild("weird@1.0.0", buildFn)).toBeNull();
    expect(await cache.maybeBuild("weird@1.0.0", buildFn)).toBeNull();
    expect(attempts).toBe(2);
    expect(cache.stats().buildFailures).toBe(2);
    expect(cache.stats().rejected).toBe(0);
    expect(cache.stats().entries).toBe(0);
    await rm(directory, { recursive: true, force: true });
  });

  it("treats a declined build as a skip, not a rejection", async () => {
    let directory = await mkdtemp(path.join(os.tmpdir(), "unpkg-filecache-skip-"));
    let cache = new FileCache({ directory, maxBytes: 1_000_000, promotionThreshold: 1 });
    let builds = 0;
    let buildFn = async () => {
      builds++;
      return null;
    };
    expect(await cache.maybeBuild("small@1.0.0", buildFn)).toBeNull();
    expect(await cache.maybeBuild("small@1.0.0", buildFn)).toBeNull();
    expect(builds).toBe(2);
    expect(cache.stats().rejected).toBe(0);
    expect(cache.stats().entries).toBe(0);
    await rm(directory, { recursive: true, force: true });
  });

  it("rejects entries over the byte cap and does not retry", async () => {
    let directory = await mkdtemp(path.join(os.tmpdir(), "unpkg-filecache-reject-"));
    let cache = new FileCache({ directory, maxBytes: 10, promotionThreshold: 1 });
    let builds = 0;
    let buildFn = async (staging: string) => {
      builds++;
      await writeFile(staging, "x".repeat(100));
      return { size: 100, listing: [] };
    };
    expect(await cache.maybeBuild("huge@1.0.0", buildFn)).toBeNull();
    expect(await cache.maybeBuild("huge@1.0.0", buildFn)).toBeNull();
    expect(builds).toBe(1);
    expect(cache.stats().rejected).toBe(1);
    await rm(directory, { recursive: true, force: true });
  });

  it("never evicts entries younger than the minimum residence", async () => {
    let directory = await mkdtemp(path.join(os.tmpdir(), "unpkg-filecache-hyst-"));
    let cache = new FileCache({
      directory,
      maxBytes: 12,
      promotionThreshold: 1,
      minResidenceMs: 3_600_000,
    });
    let buildFn = async (staging: string) => {
      await writeFile(staging, "1234567890");
      return { size: 10, listing: [] };
    };
    let a = await cache.maybeBuild("a@1.0.0", buildFn);
    await a?.release();
    let b = await cache.maybeBuild("b@1.0.0", buildFn);
    await b?.release();
    expect(cache.stats().entries).toBe(2);
    expect(cache.stats().evictions).toBe(0);
    await rm(directory, { recursive: true, force: true });
  });
});

describe("file tier integration (npm-files)", () => {
  it("serves repeated distinct files from the offset index with one download + one build", async () => {
    let tarballDir = await mkdtemp(path.join(os.tmpdir(), "unpkg-filetier-tarballs-"));
    let fileDir = await mkdtemp(path.join(os.tmpdir(), "unpkg-filetier-files-"));
    resetDefaultTarballCacheForTests(
      new TarballCache({ directory: tarballDir, maxBytes: 100_000_000, admissionThreshold: 2 })
    );
    resetDefaultExtractedCacheForTests(null);
    let fileCache = new FileCache({ directory: fileDir, maxBytes: 100_000_000, promotionThreshold: 3 });
    resetDefaultFileCacheForTests(fileCache);

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
      for (let name of ["/lodash.js", "/package.json", "/LICENSE", "/README.md", "/lodash.js"]) {
        let file = await getFile(registry, "lodash", "4.17.21", name);
        expect(file?.path).toBe(name);
        expect(file?.size).toBeGreaterThan(0);
      }
      expect(fileCache.stats().builds).toBe(1);
      // After the build, getFile serves a streamed slice body.
      let streamed = await getFile(registry, "lodash", "4.17.21", "/package.json");
      expect(streamed?.bodyStream).toBeDefined();
      let bytes = new Uint8Array(await streamed!.bodyStream!.arrayBuffer());
      expect(bytes.byteLength).toBe(streamed!.size);
      expect(new TextDecoder().decode(bytes)).toContain('"name": "lodash"');
      // /list comes from the index with no further downloads.
      let listing = await listFiles(registry, "lodash", "4.17.21", "/");
      expect(listing.length).toBe(1054);
      expect(fetches).toBe(2);
      // Missing file is a clean null, not an error.
      expect(await getFile(registry, "lodash", "4.17.21", "/does-not-exist.js")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      resetDefaultTarballCacheForTests(null);
      resetDefaultExtractedCacheForTests(undefined);
      resetDefaultFileCacheForTests(undefined);
      await rm(tarballDir, { recursive: true, force: true });
      await rm(fileDir, { recursive: true, force: true });
    }
  });

  it("serves via the parse fallback when the tarball is an unsupported variant", async () => {
    let tarballDir = await mkdtemp(path.join(os.tmpdir(), "unpkg-filetier-fallback-tarballs-"));
    let fileDir = await mkdtemp(path.join(os.tmpdir(), "unpkg-filetier-fallback-files-"));
    // A tar containing a GNU sparse entry: the indexer refuses it,
    // the request must still be served by the tar-stream parse path.
    let tarPath = path.join(tarballDir, "sparse.tar");
    await writeFile(
      tarPath,
      Buffer.concat([
        tarHeader("package/sparse.bin", 5, "S"),
        tarData(Buffer.from("hello")),
        tarHeader("package/real.js", 4, "0"),
        tarData(Buffer.from("real")),
        Buffer.alloc(1024),
      ])
    );
    let fixtureDir = await mkdtemp(path.join(os.tmpdir(), "unpkg-filetier-fallback-fixture-"));
    let tgzPath = path.join(fixtureDir, "sparsepkg.tgz");
    await pipeline(createReadStream(tarPath), createGzip(), createWriteStream(tgzPath));

    resetDefaultTarballCacheForTests(
      new TarballCache({ directory: tarballDir, maxBytes: 100_000_000, admissionThreshold: 2 })
    );
    resetDefaultExtractedCacheForTests(null);
    let fileCache = new FileCache({ directory: fileDir, maxBytes: 100_000_000, promotionThreshold: 1 });
    resetDefaultFileCacheForTests(fileCache);
    // Disable the size gate so the tiny fixture reaches the indexer.
    let previousGate = process.env.UNPKG_FILE_CACHE_MIN_TARBALL_BYTES;
    process.env.UNPKG_FILE_CACHE_MIN_TARBALL_BYTES = "0";

    let originalFetch = globalThis.fetch;
    // @ts-expect-error - test stub mirrors npm-files.test.ts
    globalThis.fetch = async (input: RequestInfo | URL) => {
      let url = input instanceof Request ? input.url : String(input);
      if (url === "https://registry.npmjs.org/sparsepkg/-/sparsepkg-1.0.0.tgz") {
        return new Response(Bun.file(tgzPath));
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    try {
      let file = await getFile("https://registry.npmjs.org", "sparsepkg", "1.0.0", "/real.js");
      expect(file?.path).toBe("/real.js");
      expect(new TextDecoder().decode(file!.body)).toBe("real");
      // The indexer refused the sparse entry; no entry was built and
      // the failure was counted, not surfaced as a request error.
      expect(fileCache.stats().buildFailures).toBeGreaterThan(0);
      expect(fileCache.stats().entries).toBe(0);
      await rm(fixtureDir, { recursive: true, force: true });
      if (previousGate === undefined) delete process.env.UNPKG_FILE_CACHE_MIN_TARBALL_BYTES;
      else process.env.UNPKG_FILE_CACHE_MIN_TARBALL_BYTES = previousGate;
    } finally {
      globalThis.fetch = originalFetch;
      resetDefaultTarballCacheForTests(null);
      resetDefaultExtractedCacheForTests(undefined);
      resetDefaultFileCacheForTests(undefined);
      await rm(tarballDir, { recursive: true, force: true });
      await rm(fileDir, { recursive: true, force: true });
    }
  });
});
