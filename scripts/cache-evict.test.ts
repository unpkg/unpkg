import { describe, expect, it } from "bun:test";

import {
  buildOriginPurgeCommand,
  bumpDocument,
  emptyDocument,
  parseDocument,
  parseOriginPurgeOutput,
  parsePackageVersionArg,
  parseServingMachines,
} from "./cache-evict.ts";

describe("cache-evict", () => {
  it("parses scoped and unscoped package@version arguments", () => {
    expect(parsePackageVersionArg("lodash@4.17.20")).toEqual({ packageName: "lodash", version: "4.17.20" });
    expect(parsePackageVersionArg("@Scope/Pkg@1.0.0-beta.1")).toEqual({
      packageName: "@scope/pkg",
      version: "1.0.0-beta.1",
    });
    expect(() => parsePackageVersionArg("lodash")).toThrow();
    expect(() => parsePackageVersionArg("@scope/pkg")).toThrow();
  });

  it("bumps a generation and prunes expired entries", () => {
    const now = new Date("2026-10-23T00:00:00Z");
    const doc = {
      schema: 1 as const,
      v: 4,
      generations: {
        "old@1.0.0": { gen: 3, expires_at: "2025-01-01T00:00:00Z" },
        "keep@2.0.0": { gen: 1, expires_at: "2027-01-01T00:00:00Z" },
      },
    };
    const next = bumpDocument(doc, "keep@2.0.0", now);
    expect(next.v).toBe(5);
    expect(next.generations["keep@2.0.0"].gen).toBe(2);
    expect(next.generations["old@1.0.0"]).toBeUndefined();
    expect(Date.parse(next.generations["keep@2.0.0"].expires_at)).toBeGreaterThan(now.getTime());
  });

  it("starts new versions at generation 1", () => {
    const next = bumpDocument(emptyDocument(), "pkg@1.0.0", new Date("2026-10-23T00:00:00Z"));
    expect(next.generations["pkg@1.0.0"].gen).toBe(1);
    expect(next.v).toBe(1);
  });

  it("selects only serving machines for origin fan-out", () => {
    let machines = parseServingMachines(
      JSON.stringify([
        { id: "a", region: "ewr", state: "started", cordoned: false },
        { id: "b", region: "sjc", state: "started", cordoned: true },
        { id: "c", region: "sin", state: "stopped", cordoned: false },
      ])
    );
    expect(machines).toEqual([{ id: "a", region: "ewr" }]);
    expect(() => parseServingMachines("{}")).toThrow();
  });

  it("builds a shell-safe origin purge command and parses its result", () => {
    let command = buildOriginPurgeCommand("@scope/pkg", "1.0.0", "tok-123");
    expect(command).toContain("localhost:3000/_purge");
    expect(command).toContain("Bearer tok-123");
    expect(() => buildOriginPurgeCommand("pkg", "1.0.0", "bad'token")).toThrow();
    expect(
      parseOriginPurgeOutput('noise\nPURGE_RESULT 200 {"package":"x","evicted":{"tarball":true,"file":false,"extracted":false}}')
    ).toEqual({ tarball: true, file: false, extracted: false });
    expect(() => parseOriginPurgeOutput("PURGE_RESULT 401 Unauthorized")).toThrow();
    expect(() => parseOriginPurgeOutput("nothing here")).toThrow();
  });

  it("parses an existing document and defaults a missing one", () => {
    expect(parseDocument(null)).toEqual(emptyDocument());
    expect(parseDocument(JSON.stringify({ schema: 1, v: 2, generations: {} })).v).toBe(2);
    expect(() => parseDocument(JSON.stringify({ schema: 9, generations: {} }))).toThrow();
  });
});
