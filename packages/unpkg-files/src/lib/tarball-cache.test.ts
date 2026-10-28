import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { TarballCache, resetDefaultTarballCacheForTests } from "./tarball-cache.ts";
import { getFile } from "./npm-files.ts";
import { packageTarballs } from "../../test/fixtures.ts";

async function tempCache(opts: Partial<{ maxBytes: number; admissionThreshold: number }> = {}) {
  let directory = await mkdtemp(path.join(os.tmpdir(), "unpkg-tarball-cache-test-"));
  let cache = new TarballCache({
    directory,
    maxBytes: opts.maxBytes ?? 1_000_000,
    admissionThreshold: opts.admissionThreshold ?? 2,
  });
  return { cache, directory };
}

function downloader(bytes: string, counter: { calls: number }) {
  return async (destPath: string) => {
    counter.calls++;
    await writeFile(destPath, bytes);
  };
}

describe("TarballCache seen-map bound", () => {
  it("caps remembered keys so crawl enumeration cannot grow memory forever", async () => {
    let directory = await mkdtemp(path.join(os.tmpdir(), "unpkg-seen-cap-"));
    let cache = new TarballCache({
      directory,
      maxBytes: 1_000_000,
      admissionThreshold: 2,
      maxSeenEntries: 100,
    });
    let counter = { calls: 0 };
    for (let i = 0; i < 500; i++) {
      let r = await cache.acquire(`one-off-${i}@1.0.0`, downloader("x", counter));
      await r.release();
    }
    expect(cache.seenSize()).toBeLessThanOrEqual(100);
    expect(cache.stats().seenEntries).toBeLessThanOrEqual(100);
    await rm(directory, { recursive: true, force: true });
  });
});

describe("TarballCache", () => {
  it("serves the second distinct request for a tarball without re-downloading", async () => {
    let { cache, directory } = await tempCache();
    let counter = { calls: 0 };
    let download = downloader("tarball-bytes", counter);

    let first = await cache.acquire("pkg@1.0.0", download);
    await first.release();
    let second = await cache.acquire("pkg@1.0.0", download);
    await second.release();
    let third = await cache.acquire("pkg@1.0.0", download);
    await third.release();

    // First request downloads (not yet admitted), second downloads and
    // promotes, third must be a cache hit.
    expect(counter.calls).toBe(2);
    expect(third.cached).toBe(true);
    await rm(directory, { recursive: true, force: true });
  });

  it("coalesces concurrent downloads of the same tarball (single-flight)", async () => {
    let { cache, directory } = await tempCache();
    let counter = { calls: 0 };
    let download = async (destPath: string) => {
      counter.calls++;
      await new Promise((r) => setTimeout(r, 25));
      await writeFile(destPath, "shared-bytes");
    };

    let results = await Promise.all([
      cache.acquire("herd@1.0.0", download),
      cache.acquire("herd@1.0.0", download),
      cache.acquire("herd@1.0.0", download),
      cache.acquire("herd@1.0.0", download),
    ]);
    for (let r of results) await r.release();

    expect(counter.calls).toBe(1);
    expect(results.every((r) => r.path === results[0].path)).toBe(true);
    await rm(directory, { recursive: true, force: true });
  });

  it("reports hits and downloads in stats()", async () => {
    let { cache, directory } = await tempCache();
    let counter = { calls: 0 };
    let download = downloader("stats-bytes", counter);
    for (let i = 0; i < 3; i++) {
      let r = await cache.acquire("stats@1.0.0", download);
      await r.release();
    }
    let stats = cache.stats();
    expect(stats.downloads).toBe(2);
    expect(stats.hits).toBe(1);
    expect(stats.downloadBytes).toBe(2 * "stats-bytes".length);
    expect(stats.entries).toBe(1);
    expect(stats.totalBytes).toBe("stats-bytes".length);
    expect(stats.promotedBytes).toBe("stats-bytes".length);
    expect(stats.evictions).toBe(0);
    expect(stats.evictedBytes).toBe(0);
    await rm(directory, { recursive: true, force: true });
  });

  it("does not retain tarballs requested only once (admission threshold)", async () => {
    let { cache, directory } = await tempCache();
    let counter = { calls: 0 };

    let only = await cache.acquire("one-off@1.0.0", downloader("x", counter));
    await only.release();

    let entries = await readdir(directory);
    expect(entries.filter((e) => e.endsWith(".tgz"))).toEqual([]);
    await rm(directory, { recursive: true, force: true });
  });

  it("evicts least-recently-used tarballs when over the byte cap", async () => {
    let { cache, directory } = await tempCache({ maxBytes: 12, admissionThreshold: 1 });
    let counter = { calls: 0 };
    let payload = "01234"; // 5 bytes each; cap holds two

    for (let key of ["a@1.0.0", "b@1.0.0"]) {
      let r = await cache.acquire(key, downloader(payload, counter));
      await r.release();
    }
    // Touch a so b is LRU, then add c: b must be evicted, a retained.
    let touch = await cache.acquire("a@1.0.0", downloader(payload, counter));
    await touch.release();
    let c = await cache.acquire("c@1.0.0", downloader(payload, counter));
    await c.release();

    let entries = (await readdir(directory)).filter((e) => e.endsWith(".tgz"));
    expect(entries.length).toBe(2);

    let callsBefore = counter.calls;
    let againA = await cache.acquire("a@1.0.0", downloader(payload, counter));
    await againA.release();
    expect(counter.calls).toBe(callsBefore); // a survived
    let againB = await cache.acquire("b@1.0.0", downloader(payload, counter));
    await againB.release();
    expect(counter.calls).toBe(callsBefore + 1); // b was evicted
    await rm(directory, { recursive: true, force: true });
  });
});

describe("first-seen streaming (npm-files)", () => {
  it("serves a one-off package without writing a staging tarball", async () => {
    let directory = await mkdtemp(path.join(os.tmpdir(), "unpkg-first-seen-"));
    resetDefaultTarballCacheForTests(
      new TarballCache({ directory, maxBytes: 100_000_000, admissionThreshold: 2 })
    );
    let fetches = 0;
    let originalFetch = globalThis.fetch;
    // @ts-expect-error - test stub mirrors npm-files.test.ts
    globalThis.fetch = async (input: RequestInfo | URL) => {
      let url = input instanceof Request ? input.url : String(input);
      if (url === "https://registry.npmjs.org/preact/-/preact-10.26.4.tgz") {
        fetches++;
        return new Response(Bun.file(packageTarballs.preact["10.26.4"]));
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    try {
      let file = await getFile("https://registry.npmjs.org", "preact", "10.26.4", "/package.json");
      expect(file?.path).toBe("/package.json");
      expect(fetches).toBe(1);
      let entries = await readdir(directory);
      expect(entries.filter((e) => e.endsWith(".tgz") || e.includes("staging"))).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
      resetDefaultTarballCacheForTests(null);
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("tarball cache integration (npm-files)", () => {
  it("downloads a tarball once for repeated distinct-file requests", async () => {
    let directory = await mkdtemp(path.join(os.tmpdir(), "unpkg-tarball-integ-"));
    resetDefaultTarballCacheForTests(
      new TarballCache({ directory, maxBytes: 100_000_000, admissionThreshold: 2 })
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
      let f1 = await getFile(registry, "lodash", "4.17.21", "/lodash.js");
      let f2 = await getFile(registry, "lodash", "4.17.21", "/package.json");
      let f3 = await getFile(registry, "lodash", "4.17.21", "/LICENSE");
      expect(f1?.path).toBe("/lodash.js");
      expect(f2?.path).toBe("/package.json");
      expect(f3?.path).toBe("/LICENSE");
      // Admission on 2nd request: exactly 2 downloads for 3 distinct files.
      expect(fetches).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
      resetDefaultTarballCacheForTests(null);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
