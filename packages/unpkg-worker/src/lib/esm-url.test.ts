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
  it("adds the default target", () => {
    let result = normalizeEsmRequestUrl("https://esm.unpkg.com/react@18");
    expect("url" in result && result.url.search).toBe("?target=es2022");
  });

  it("normalizes import-map-friendly path query syntax", () => {
    let result = normalizeEsmRequestUrl("https://esm.unpkg.com/react-dom@18.3.1&dev/client");

    expect("url" in result && result.url.pathname).toBe("/react-dom@18.3.1/client");
    expect("url" in result && result.url.search).toBe("?dev=&target=es2022");
  });

  it("normalizes import-map-friendly trailing slash query syntax", () => {
    let result = normalizeEsmRequestUrl("https://esm.unpkg.com/react-dom@18.3.1&dev/");

    expect("url" in result && result.url.pathname).toBe("/react-dom@18.3.1/");
    expect("url" in result && result.url.search).toBe("?dev=&target=es2022");
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
