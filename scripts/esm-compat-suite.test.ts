import { describe, expect, it } from "bun:test";

import {
  compareSummaries,
  isCompatCase,
  type CompatCase,
  type FetchSummary,
} from "./esm-compat-suite.ts";

const moduleCase: CompatCase = {
  description: "module",
  expect: "module",
  path: "/react@18.3.1",
};

describe("compareSummaries", () => {
  it("rejects matching failures for cases that require a successful response", () => {
    let esmSh = summary({ ok: false, status: 404 });
    let esmUnpkg = summary({ ok: false, status: 404 });

    expect(compareSummaries(moduleCase, esmSh, esmUnpkg)).toEqual({
      failureCategory: "unexpected-failure",
      reason: "expected successful module response from esm.unpkg.com, got 404",
    });
  });

  it("accepts failures only when the case expects a diagnostic", () => {
    let diagnosticCase: CompatCase = {
      description: "diagnostic",
      expect: "diagnostic",
      path: "/missing",
    };
    let esmSh = summary({ ok: false, status: 404 });
    let esmUnpkg = summary({ ok: false, status: 415 });

    expect(compareSummaries(diagnosticCase, esmSh, esmUnpkg)).toEqual({
      failureCategory: null,
      reason: null,
    });
  });

  it("rejects successful responses with different content kinds", () => {
    let esmSh = summary({ contentType: "application/javascript", executableModule: true });
    let esmUnpkg = summary({ contentType: "text/css" });

    expect(compareSummaries(moduleCase, esmSh, esmUnpkg)).toEqual({
      failureCategory: "content-type-mismatch",
      reason: "response kind mismatch: esm.sh=javascript, esm.unpkg.com=css",
    });
  });

  it("allows a documented content-kind divergence while enforcing the expected UNPKG kind", () => {
    let cssCase: CompatCase = {
      contentParity: "expected-only",
      description: "intentional CSS behavior",
      expect: "css",
      path: "/style.css",
    };
    let esmSh = summary({ contentType: "application/javascript" });
    let esmUnpkg = summary({ contentType: "text/css", executableModule: false });

    expect(compareSummaries(cssCase, esmSh, esmUnpkg)).toEqual({ failureCategory: null, reason: null });
  });

  it("classifies timeouts separately from connectivity failures", () => {
    let esmSh = summary();
    let esmUnpkg = summary({ diagnosticCode: "TIMEOUT", ok: false, status: 0 });

    expect(compareSummaries(moduleCase, esmSh, esmUnpkg).failureCategory).toBe("timeout");
  });

  it("rejects successful responses with different status codes", () => {
    let esmSh = summary({ status: 200 });
    let esmUnpkg = summary({ status: 206 });

    expect(compareSummaries(moduleCase, esmSh, esmUnpkg)).toEqual({
      failureCategory: "status-mismatch",
      reason: "status mismatch: esm.sh=200, esm.unpkg.com=206",
    });
  });

  it("honors the declared TypeScript expectation", () => {
    let typesCase: CompatCase = {
      description: "types",
      expect: "typescript",
      path: "/@types/react@18.2.0",
    };
    let esmSh = summary({ contentType: "application/typescript" });
    let esmUnpkg = summary({ contentType: "application/typescript" });

    expect(compareSummaries(typesCase, esmSh, esmUnpkg)).toEqual({
      failureCategory: null,
      reason: null,
    });
  });

  it("does not let matching TypeScript responses override a JSON expectation", () => {
    let jsonCase: CompatCase = {
      description: "metadata",
      expect: "json",
      path: "/@types/react@18.2.0?meta",
    };
    let esmSh = summary({ contentType: "application/typescript" });
    let esmUnpkg = summary({ contentType: "application/typescript" });

    expect(compareSummaries(jsonCase, esmSh, esmUnpkg).failureCategory).toBe("content-type-mismatch");
  });

  it("checks UNPKG query preservation even when the baseline is unavailable", () => {
    let redirectCase: CompatCase = {
      description: "redirect query",
      expect: "module",
      path: "/react@18?dev",
      preserveRedirectQuery: ["dev"],
    };
    let esmSh = summary({ diagnosticCode: "FETCH_ERROR", ok: false, status: 0 });
    let esmUnpkg = summary({
      finalUrl: "https://esm.unpkg.com/react@18.3.1?target=es2022",
      redirectChain: [
        {
          location: "/react@18.3.1?target=es2022",
          status: 302,
          url: "https://esm.unpkg.com/react@18?dev",
        },
      ],
    });

    expect(compareSummaries(redirectCase, esmSh, esmUnpkg).failureCategory).toBe("redirect-mismatch");
  });

  it("rejects redirect target differences independent of origin and query order", () => {
    let redirectCase: CompatCase = {
      description: "asset redirect",
      expect: "css",
      path: "/normalize.css@8.0.1?target=es2020",
      redirectParity: "final-path-and-query",
    };
    let esmSh = summary({
      contentType: "text/css",
      finalUrl: "https://esm.sh/normalize.css@8.0.1/normalize.css",
      redirectChain: [
        {
          location: "/normalize.css@8.0.1/normalize.css",
          status: 301,
          url: "https://esm.sh/normalize.css@8.0.1?target=es2020",
        },
      ],
    });
    let esmUnpkg = summary({
      contentType: "text/css",
      finalUrl: "https://esm.unpkg.com/normalize.css@8.0.1/normalize.css?target=es2020",
      redirectChain: [
        {
          location: "/normalize.css@8.0.1/normalize.css?target=es2020",
          status: 301,
          url: "https://esm.unpkg.com/normalize.css@8.0.1?target=es2020",
        },
      ],
    });

    expect(compareSummaries(redirectCase, esmSh, esmUnpkg).failureCategory).toBe("redirect-mismatch");
  });
});

describe("isCompatCase", () => {
  it("accepts TypeScript and redirect query expectations", () => {
    expect(
      isCompatCase({
        description: "types redirect",
        expect: "typescript",
        path: "/@types/react@18.2.0?target=es2020",
        preserveRedirectQuery: ["target"],
        redirectParity: "final-path-and-query",
        contentParity: "expected-only",
      })
    ).toBe(true);
  });

  it("rejects empty query expectations and unknown parity modes", () => {
    expect(
      isCompatCase({ description: "empty", expect: "module", path: "/react", preserveRedirectQuery: [] })
    ).toBe(false);
    expect(
      isCompatCase({ description: "mode", expect: "module", path: "/react", redirectParity: "redirect-count" })
    ).toBe(false);
    expect(
      isCompatCase({ description: "content", expect: "module", path: "/react", contentParity: "ignore" })
    ).toBe(false);
  });
});

function summary(overrides: Partial<FetchSummary> = {}): FetchSummary {
  return {
    contentLength: 1,
    contentType: "application/javascript",
    diagnosticCode: null,
    durationMs: 1,
    executableModule: true,
    finalUrl: "https://example.com/react@18.3.1",
    headers: {},
    ok: true,
    redirectChain: [],
    status: 200,
    ...overrides,
  };
}
