import { describe, expect, it } from "bun:test";

import {
  getContentLength,
  isCacheableResponse,
  parseContentDigest,
  sha256Base64,
  verifyBody,
} from "./cache-utils.ts";

describe("isCacheableResponse", () => {
  it("allows responses without Cache-Control", () => {
    expect(isCacheableResponse(new Response("x"))).toBe(true);
  });

  it("allows public responses", () => {
    let response = new Response("x", { headers: { "Cache-Control": "public, max-age=31536000" } });
    expect(isCacheableResponse(response)).toBe(true);
  });

  it("rejects no-store, no-cache, and private responses", () => {
    for (let value of ["no-store", "no-cache", "private", "public, no-store", "NO-STORE, no-cache"]) {
      let response = new Response("x", { headers: { "Cache-Control": value } });
      expect(isCacheableResponse(response)).toBe(false);
    }
  });
});

describe("getContentLength", () => {
  it("parses a valid length", () => {
    expect(getContentLength(new Headers({ "Content-Length": "1813119" }))).toBe(1813119);
    expect(getContentLength(new Headers({ "Content-Length": "0" }))).toBe(0);
  });

  it("returns null when absent or invalid", () => {
    expect(getContentLength(new Headers())).toBeNull();
    expect(getContentLength(new Headers({ "Content-Length": "abc" }))).toBeNull();
    expect(getContentLength(new Headers({ "Content-Length": "-1" }))).toBeNull();
  });
});

describe("parseContentDigest", () => {
  it("parses a sha256 digest", () => {
    let headers = new Headers({ "Content-Digest": "sha256=:n4bQgYhMfWWaL+qgxVrQFaO/TxsrC4Is0V1sFbDwCgg=:" });
    expect(parseContentDigest(headers)).toEqual({
      algorithm: "sha256",
      hash: "n4bQgYhMfWWaL+qgxVrQFaO/TxsrC4Is0V1sFbDwCgg=",
    });
  });

  it("returns null when absent or malformed", () => {
    expect(parseContentDigest(new Headers())).toBeNull();
    expect(parseContentDigest(new Headers({ "Content-Digest": "nonsense" }))).toBeNull();
  });
});

describe("sha256Base64", () => {
  it("matches known SHA-256 vectors", async () => {
    // SHA-256("") and SHA-256("test"), base64-encoded.
    expect(await sha256Base64(new Uint8Array())).toBe("47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=");
    expect(await sha256Base64(new TextEncoder().encode("test"))).toBe(
      "n4bQgYhMfWWaL+qgxVrQFaO/TxsrC4Is0V1sFbDwCgg="
    );
  });
});

describe("verifyBody", () => {
  it("accepts a self-consistent body", async () => {
    let body = new TextEncoder().encode("test");
    let headers = new Headers({
      "Content-Length": "4",
      "Content-Digest": "sha256=:n4bQgYhMfWWaL+qgxVrQFaO/TxsrC4Is0V1sFbDwCgg=:",
    });
    expect(await verifyBody(headers, body)).toEqual({ ok: true });
  });

  it("accepts any content whose headers describe it, with no external expectation", async () => {
    let body = new TextEncoder().encode("completely different bytes than anyone expected");
    let headers = new Headers({
      "Content-Length": String(body.byteLength),
      "Content-Digest": `sha256=:${await sha256Base64(body)}:`,
    });
    expect(await verifyBody(headers, body)).toEqual({ ok: true });
  });

  it("rejects a truncated body", async () => {
    let headers = new Headers({ "Content-Length": "10" });
    expect(await verifyBody(headers, new TextEncoder().encode("short"))).toEqual({
      ok: false,
      reason: "length",
    });
  });

  it("rejects a digest mismatch", async () => {
    let headers = new Headers({
      "Content-Length": "4",
      "Content-Digest": "sha256=:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=:",
    });
    expect(await verifyBody(headers, new TextEncoder().encode("test"))).toEqual({
      ok: false,
      reason: "digest",
    });
  });

  it("skips checks whose headers are absent", async () => {
    expect(await verifyBody(new Headers(), new TextEncoder().encode("anything"))).toEqual({
      ok: true,
    });
  });
});
