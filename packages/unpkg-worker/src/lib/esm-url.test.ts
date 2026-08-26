import { describe, expect, it } from "bun:test";

import { getEsmPackageSubpath, normalizeEsmRequestUrl, parseEsmPackagePathname } from "./esm-url.ts";

describe("parseEsmPackagePathname", () => {
  it("parses package roots", () => {
    expect(parseEsmPackagePathname("/react")).toEqual({
      externalAll: false,
      package: "react",
      scope: undefined,
      version: undefined,
      filename: undefined,
    });
  });

  it("parses scoped packages with versions and subpaths", () => {
    expect(parseEsmPackagePathname("/@scope/pkg@1.2.3/sub/module")).toEqual({
      externalAll: false,
      package: "@scope/pkg",
      scope: "@scope",
      version: "1.2.3",
      filename: "/sub/module",
    });
  });

  it("parses the esm.sh all-dependencies-external shorthand", () => {
    expect(parseEsmPackagePathname("/*swr@1.3.0")).toEqual({
      externalAll: true,
      package: "swr",
      scope: undefined,
      version: "1.3.0",
      filename: undefined,
    });
  });
});

describe("normalizeEsmRequestUrl", () => {
  it("keeps the default target implicit", () => {
    let result = normalizeEsmRequestUrl("https://esm.unpkg.com/react@18");
    expect("url" in result && result.url.search).toBe("");
    expect("target" in result && result.target).toBe("es2022");
  });

  it("strips an explicit default target", () => {
    let result = normalizeEsmRequestUrl("https://esm.unpkg.com/react@18?target=es2022");
    expect("url" in result && result.url.search).toBe("");
  });

  it("keeps non-default targets in the canonical URL", () => {
    let result = normalizeEsmRequestUrl("https://esm.unpkg.com/react@18?target=es2017");
    expect("url" in result && result.url.search).toBe("?target=es2017");
  });

  it("canonicalizes flag and list param values into one cache key", () => {
    let result = normalizeEsmRequestUrl(
      "https://esm.unpkg.com/react-dom@18.3.1?min=1&conditions=development&conditions=browser,development&junk=x"
    );

    expect("url" in result && result.url.search).toBe("?conditions=browser%2Cdevelopment&min=");
  });

  it("rejects ?meta combined with route-changing params", () => {
    for (let param of ["css", "module", "worker"]) {
      let result = normalizeEsmRequestUrl(`https://esm.unpkg.com/react-dom@18.3.1?meta&${param}`);

      expect("code" in result && result.code).toBe("INVALID_QUERY");
    }
  });

  it("rejects unsupported build params", () => {
    for (let param of ["bundle", "ignore-annotations", "keep-names", "no-bundle", "standalone"]) {
      let result = normalizeEsmRequestUrl(`https://esm.unpkg.com/react-dom@18.3.1?${param}`);

      expect("code" in result && result.code).toBe("INVALID_QUERY");
      expect("status" in result && result.status).toBe(400);
    }
  });

  it("rejects the denonext target", () => {
    let result = normalizeEsmRequestUrl("https://esm.unpkg.com/react-dom@18.3.1?target=denonext");

    expect("code" in result && result.code).toBe("UNSUPPORTED_TARGET");
  });

  it("accepts runtime-native esm.sh compatibility targets", () => {
    let result = normalizeEsmRequestUrl("https://esm.unpkg.com/react?target=node");

    expect("url" in result && result.url.search).toBe("?target=node");
  });

  it("rejects conflicting development and production flags", () => {
    expect(normalizeEsmRequestUrl("https://esm.unpkg.com/react?dev&env=production")).toEqual({
      code: "INVALID_QUERY",
      message: "?dev cannot be combined with ?env=production",
      status: 400,
    });
  });

  it("does not add a default target to raw requests", () => {
    let result = normalizeEsmRequestUrl("https://esm.unpkg.com/react@18/package.json?raw");

    expect("url" in result && result.url.search).toBe("?raw=");
  });

  it("rejects raw mode with transform options", () => {
    expect(normalizeEsmRequestUrl("https://esm.unpkg.com/react@18?raw&target=es2022")).toEqual({
      code: "INVALID_QUERY",
      message: "?raw cannot be combined with ?target",
      status: 400,
    });
  });

  it("does not add a default target to CSS requests", () => {
    let directCss = normalizeEsmRequestUrl("https://esm.unpkg.com/bootstrap@5.3.8/dist/css/bootstrap.min.css");
    let cssPackage = normalizeEsmRequestUrl("https://esm.unpkg.com/normalize.css@8.0.1");
    let cssModule = normalizeEsmRequestUrl("https://esm.unpkg.com/react-toastify@11.0.5/dist/ReactToastify.css?module");

    expect("url" in directCss && directCss.url.search).toBe("");
    expect("url" in cssPackage && cssPackage.url.search).toBe("");
    expect("url" in cssModule && cssModule.url.search).toBe("?module=");
  });

  it("does not add a default target to declaration assets", () => {
    let typesPackage = normalizeEsmRequestUrl("https://esm.unpkg.com/@types/react@18.2.0?dev");
    let declaration = normalizeEsmRequestUrl("https://esm.unpkg.com/preact@10.26.4/src/index.d.ts?dev");

    expect("url" in typesPackage && typesPackage.url.search).toBe("?dev=");
    expect("url" in declaration && declaration.url.search).toBe("?dev=");
  });
});

describe("getEsmPackageSubpath", () => {
  it("normalizes package roots to dot", () => {
    expect(getEsmPackageSubpath(undefined)).toBe(".");
    expect(getEsmPackageSubpath("/")).toBe(".");
  });

  it("normalizes package subpaths to export subpaths", () => {
    expect(getEsmPackageSubpath("/jsx-runtime")).toBe("./jsx-runtime");
  });
});
