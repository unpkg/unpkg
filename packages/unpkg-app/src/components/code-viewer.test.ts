import { describe, expect, it } from "bun:test";

import { parseLineHash } from "./code-viewer.tsx";

describe("parseLineHash", () => {
  it("parses single lines, ranges, and multiple selections", () => {
    expect(parseLineHash("#L58", 100)).toEqual([58]);
    expect(parseLineHash("#L58-59", 100)).toEqual([58, 59]);
    expect(parseLineHash("#L2-4,8,10-11", 100)).toEqual([2, 3, 4, 8, 10, 11]);
  });

  it("deduplicates overlapping ranges", () => {
    expect(parseLineHash("#L2-4,3-5", 100)).toEqual([2, 3, 4, 5]);
  });

  it("rejects malformed and reversed ranges", () => {
    expect(parseLineHash("#L1foo", 100)).toEqual([]);
    expect(parseLineHash("#L0-2", 100)).toEqual([]);
    expect(parseLineHash("#L5-2", 100)).toEqual([]);
    expect(parseLineHash("#L1-2,nope", 100)).toEqual([]);
    expect(parseLineHash("#L9007199254740992", 100)).toEqual([]);
  });

  it("bounds ranges to the number of lines before expanding them", () => {
    expect(parseLineHash("#L3-4294967295", 5)).toEqual([3, 4, 5]);
    expect(parseLineHash("#L6-4294967295", 5)).toEqual([]);
  });
});
