import { weightedSplit } from "@m0saic/dsl-stdlib";
import { splitCounts } from "./splitCounts";

describe("splitCounts", () => {
  it("collects every column and row split count, in source order, with repeats", () => {
    expect(splitCounts("1")).toEqual({ cols: [], rows: [] });
    expect(splitCounts("3(1,1,1)")).toEqual({ cols: [3], rows: [] });
    expect(splitCounts("2[1,1]")).toEqual({ cols: [], rows: [2] });
    expect(splitCounts("2(121(0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1),1)")).toEqual({
      cols: [2, 121],
      rows: [],
    });
    expect(splitCounts("2[3(1,1,1),3(1,1,1)]")).toEqual({ cols: [3, 3], rows: [2] });
  });

  it("walks overlays and nested splits", () => {
    expect(splitCounts("1{4(1,1,1,1)}")).toEqual({ cols: [4], rows: [] });
    expect(splitCounts("2[1{7(1,1,1,1,1,1,1)},5(1,1,1,1,1)]")).toEqual({ cols: [7, 5], rows: [2] });
  });

  it("ignores passthrough and null tiles, and multi-digit counts keep their zeros", () => {
    expect(splitCounts("10(0,0,0,0,0,0,0,0,0,1)")).toEqual({ cols: [10], rows: [] });
    expect(splitCounts("3(-,0,1)")).toEqual({ cols: [3], rows: [] });
    expect(splitCounts("100[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1]")).toEqual({
      cols: [],
      rows: [100],
    });
  });

  it("canonicalises pretty form first (F → 1, > → 0, whitespace)", () => {
    expect(splitCounts("3( F, >, F )")).toEqual({ cols: [3], rows: [] });
    expect(splitCounts(" 2[ F , F ] ")).toEqual({ cols: [], rows: [2] });
  });

  it("agrees with the builders' emitted totals", () => {
    expect(splitCounts(String(weightedSplit([35, 65], "col")))).toEqual({ cols: [20], rows: [] });
    expect(splitCounts(String(weightedSplit([59, 1802, 59], "col", { precision: 120 })))).toEqual({ cols: [30], rows: [] });
    expect(splitCounts(String(weightedSplit([1, 120], "col", { mode: "literal" })))).toEqual({ cols: [121], rows: [] });
  });
});
