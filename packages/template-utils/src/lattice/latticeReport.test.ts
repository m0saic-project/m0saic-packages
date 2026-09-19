import { weightedSplit } from "@m0saic/dsl-stdlib";
import { LATTICE_SMALL_BASIS, latticeReport, latticeViolations } from "./latticeReport";

/** An equal N-way column split. */
const eq = (n: number, axis: "col" | "row" = "col"): string => String(weightedSplit(Array(n).fill(1), axis, { mode: "literal" }));
/** A weighted split whose total is exactly `total` (two bands). */
const basis = (total: number, axis: "col" | "row" = "col"): string => String(weightedSplit([1, total - 1], axis, { mode: "literal" }));

describe("latticeReport", () => {
  it("a layout without splits has lattice 1 on both axes and is smooth", () => {
    const r = latticeReport(["1", "1{1}"]);
    expect(r.counts).toEqual([]);
    expect(r.selfLattice).toEqual({ x: 1, y: 1 });
    expect(r.maxN).toBe(1);
    expect(r.smooth).toBe(true);
    expect(r.offenders).toEqual([]);
    expect(r.skipped).toBe(0);
  });

  it("censuses distinct counts per axis with occurrences and factorisation", () => {
    const r = latticeReport([basis(121), basis(121, "row"), eq(3), eq(3)]);
    expect(r.counts).toEqual([
      { n: 121, cols: 1, rows: 1, roughPart: 121, factors: "11²" },
      { n: 3, cols: 2, rows: 0, roughPart: 1, factors: "3" },
    ]);
    expect(r.selfLattice).toEqual({ x: 363, y: 121 });
    expect(r.maxN).toBe(121);
    expect(r.smooth).toBe(false);
    expect(r.offenders.map((c) => c.n)).toEqual([121]);
  });

  it("small rough counts are content fill, not offenders", () => {
    const r = latticeReport([eq(7, "row"), eq(11)]);
    expect(r.smooth).toBe(false);
    expect(r.offenders).toEqual([]);
    expect(r.smallRough.map((c) => c.n)).toEqual([11, 7]);
    expect(LATTICE_SMALL_BASIS).toBe(12);
    // The carve-out is a boundary, not a suggestion: 13 is an offender, 12 (smooth anyway) is not.
    expect(latticeReport([eq(13)]).offenders.map((c) => c.n)).toEqual([13]);
    expect(latticeReport([eq(14)], { smallBasis: 14 }).offenders).toEqual([]);
  });

  it("allow moves a declared content count out of the offenders", () => {
    const r = latticeReport([eq(53)], { allow: [53] });
    expect(r.offenders).toEqual([]);
    expect(r.allowed.map((c) => c.n)).toEqual([53]);
    expect(r.smooth).toBe(false);
  });

  it("skips invalid strings instead of guessing", () => {
    const r = latticeReport(["3(1,1)", basis(120)]);
    expect(r.skipped).toBe(1);
    expect(r.counts.map((c) => c.n)).toEqual([120]);
  });

  it("the corpus signature: the Alpine card is LCM(120, 121) = 14,520", () => {
    const r = latticeReport([basis(120), basis(121)]);
    expect(r.selfLattice.x).toBe(14520);
  });
});

describe("latticeViolations", () => {
  it("is empty for a 5-smooth layout on a 5-smooth canvas", () => {
    const m0 = String(weightedSplit([59, 1802, 59], "col", { precision: 120 }));
    expect(latticeViolations([m0, eq(12), eq(7, "row")], { canvas: { width: 1920, height: 1080 } })).toEqual([]);
  });

  it("names the count, its occurrences, the rough factor, the LCM cost, and the fencepost hint", () => {
    const [v] = latticeViolations([basis(121), basis(121), basis(121, "row")]);
    expect(v.key).toBe("N=121");
    expect(v.detail).toContain("split count 121 (col ×2, row ×1) = 11² is not 5-smooth (rough part 121)");
    expect(v.detail).toContain("LCM 14,520");
    expect(v.detail).toContain("one slot off 120");
    expect(v.detail).toContain("weightedSplit(…, { precision: 120 })");
  });

  it("lists the nearest 5-smooth counts without the fencepost hint when it is more than a slot away", () => {
    const [v] = latticeViolations([basis(259)]); // 7·37 — the qr/rounded self-lattice
    expect(v.key).toBe("N=259");
    expect(v.detail).toContain("Nearest 5-smooth counts: 256 · 270.");
    expect(v.detail).not.toContain("one slot off");
  });

  it("orders offenders by count descending and reports each distinct count once", () => {
    const keys = latticeViolations([basis(119), basis(121), basis(121), eq(46)]).map((v) => v.key);
    expect(keys).toEqual(["N=121", "N=119", "N=46"]);
  });

  it("reports a rough canvas axis once, first", () => {
    const out = latticeViolations([basis(121)], { canvas: { width: 1200, height: 628 } });
    expect(out.map((v) => v.key)).toEqual(["canvas", "N=121"]);
    expect(out[0].detail).toContain("height 628 = 2²·157 is not 5-smooth");
    expect(out[0].detail).not.toContain("width 1200");
  });

  it("charges a rough canvas for the counts it explains, and keeps construction artefacts separate", () => {
    // 1130 = 2·5·113 and 678 = 2·3·113 (a 7:4 print card): a 113-slot split on either axis is the
    // canvas's doing; 137 (prime) and 49 (7²) are not — 113 is divisible by neither.
    const out = latticeViolations([basis(113), basis(113, "row"), basis(137, "row"), eq(49)], { canvas: { width: 1130, height: 678 } });
    expect(out.map((v) => v.key)).toEqual(["canvas", "N=137", "N=49"]);
    expect(out[0].detail).toContain("width 1130 = 2·5·113, height 678 = 2·3·113 is not 5-smooth");
    expect(out[0].detail).toContain("split counts inheriting it: 113 (col ×1, row ×1)");
    // A count is inherited only if EVERY axis it splits explains it: 113 as a ROW split under a
    // smooth height is construction, even though the width would explain a column split.
    const mixed = latticeViolations([basis(113, "row")], { canvas: { width: 1130, height: 720 } });
    expect(mixed.map((v) => v.key)).toEqual(["canvas", "N=113"]);
    expect(mixed[0].detail).not.toContain("inheriting");
  });

  it("a physical canvas is not reported, but still explains the counts it hands down", () => {
    const out = latticeViolations([basis(113), basis(137, "row")], { canvas: { width: 1130, height: 678 }, physicalCanvas: true });
    expect(out.map((v) => v.key)).toEqual(["N=137"]);
  });

  it("honours allow and the small-basis carve-out", () => {
    expect(latticeViolations([eq(53), eq(7)], { allow: [53] })).toEqual([]);
  });
});
