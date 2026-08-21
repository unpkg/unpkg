import { describe, expect, it } from "bun:test";

import {
  compareFinalPathAndQuery,
  comparePreservedQueryParams,
  comparePreservedQueryParamsAcrossRedirects,
} from "./esm-compat-redirects.ts";

describe("compareFinalPathAndQuery", () => {
  it("ignores origins and query parameter ordering", () => {
    expect(
      compareFinalPathAndQuery(
        "https://esm.sh/react@18.3.1?dev=&target=es2020",
        "https://esm.unpkg.com/react@18.3.1?target=es2020&dev="
      )
    ).toBeNull();
  });

  it("reports changed final asset queries", () => {
    expect(
      compareFinalPathAndQuery(
        "https://esm.sh/normalize.css@8.0.1/normalize.css",
        "https://esm.unpkg.com/normalize.css@8.0.1/normalize.css?target=es2020"
      )
    ).toContain("final redirect target mismatch");
  });
});

describe("comparePreservedQueryParams", () => {
  it("accepts preserved flags, values, and duplicate parameters", () => {
    expect(
      comparePreservedQueryParams(
        "https://esm.unpkg.com/react@18?conditions=browser&conditions=development&dev",
        "https://esm.unpkg.com/react@18.3.1?dev=&conditions=development&conditions=browser&target=es2022",
        ["conditions", "dev"]
      )
    ).toBeNull();
  });

  it("reports dropped parameters", () => {
    expect(
      comparePreservedQueryParams(
        "https://esm.unpkg.com/react@18?dev&target=es2020",
        "https://esm.unpkg.com/react@18.3.1?target=es2020",
        ["dev", "target"]
      )
    ).toContain("redirect dropped or changed query parameter dev");
  });

  it("rejects expectations for parameters absent from the request", () => {
    expect(
      comparePreservedQueryParams(
        "https://esm.unpkg.com/react@18?dev",
        "https://esm.unpkg.com/react@18.3.1?dev=",
        ["external"]
      )
    ).toContain("missing request parameter");
  });
});

describe("comparePreservedQueryParamsAcrossRedirects", () => {
  it("checks every redirect destination instead of only the final URL", () => {
    expect(
      comparePreservedQueryParamsAcrossRedirects(
        "https://esm.unpkg.com/react@18?dev",
        [
          {
            location: "/react@18.3.1?target=es2022",
            url: "https://esm.unpkg.com/react@18?dev",
          },
          {
            location: "/react@18.3.1?dev=&target=es2022",
            url: "https://esm.unpkg.com/react@18.3.1?target=es2022",
          },
        ],
        "https://esm.unpkg.com/react@18.3.1?dev=&target=es2022",
        ["dev"]
      )
    ).toContain("redirect hop 1");
  });

  it("reports redirects without Location headers", () => {
    expect(
      comparePreservedQueryParamsAcrossRedirects(
        "https://esm.unpkg.com/react@18?dev",
        [{ location: null, url: "https://esm.unpkg.com/react@18?dev" }],
        "https://esm.unpkg.com/react@18?dev",
        ["dev"]
      )
    ).toContain("missing a Location header");
  });
});
