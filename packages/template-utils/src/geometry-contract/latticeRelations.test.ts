import type { MosaicDocument, MosaicLayoutViolation, MosaicSource } from "@m0saic/types";
import { placeInsetPieces } from "../layout/placeInsetPieces";
import { checkLayout, type RelationalConstraint } from "./layoutConstraint";
import { checkLatticeGutter, checkCoverage } from "./latticeRelations";

type Box = { x: number; y: number; w: number; h: number };

const gutterViolations = (spec: Parameters<typeof checkLatticeGutter>[1], boxes: Box[]): MosaicLayoutViolation[] => {
  const out: MosaicLayoutViolation[] = [];
  checkLatticeGutter("photo", spec, boxes, out);
  return out;
};

const coverageViolations = (
  spec: Parameters<typeof checkCoverage>[1],
  boxes: Box[],
  w: number,
  h: number,
): MosaicLayoutViolation[] => {
  const out: MosaicLayoutViolation[] = [];
  checkCoverage("photo", spec, boxes, w, h, out);
  return out;
};

describe("checkLatticeGutter — 2-D nearest-neighbor gutters", () => {
  // 2×2 lattice of 100×100 cells with 10px gaps.
  const grid2x2: Box[] = [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 110, y: 0, w: 100, h: 100 },
    { x: 0, y: 110, w: 100, h: 100 },
    { x: 110, y: 110, w: 100, h: 100 },
  ];

  it("passes an exact lattice against px targets on both axes", () => {
    expect(gutterViolations({ gutterXPx: 10, gutterYPx: 10 }, grid2x2)).toEqual([]);
  });

  it("flags a shifted cell (this is where the 1-D gutter relation breaks down)", () => {
    const shifted = grid2x2.map((b, i) => (i === 3 ? { ...b, x: 115 } : b));
    const out = gutterViolations({ gutterXPx: 10, gutterYPx: 10 }, shifted);
    expect(out.length).toBe(1);
    expect(out[0].rule).toBe("lattice-gutter");
    expect(out[0].actual).toBe(15);
    expect(out[0].detail).toMatch(/x-lattice/);
    // The 1-D relation cannot express this layout at all: boxes sorted by x
    // interleave rows, producing a NEGATIVE "gap" (110 − 200).
    const sorted = [...grid2x2].sort((a, b) => a.x - b.x);
    expect(sorted[1].x - (sorted[0].x + sorted[0].w)).toBeLessThan(0);
  });

  it("spans sample against every band they touch (tall cell beside stacked cells)", () => {
    const spanned: Box[] = [
      { x: 0, y: 0, w: 100, h: 210 },     // 1×2 tall span
      { x: 110, y: 0, w: 100, h: 100 },   // stacked pair to its right
      { x: 110, y: 110, w: 100, h: 100 },
    ];
    expect(gutterViolations({ gutterXPx: 10, gutterYPx: 10 }, spanned)).toEqual([]);
    // Nudge only the LOWER stacked cell: the tall span fronts TWO x-gutters
    // (one per band) and the second one drifts — nearest-neighbor sampling
    // would miss this; direct-adjacency sampling catches it.
    const nudged = [spanned[0], spanned[1], { ...spanned[2], x: 125 }];
    const out = gutterViolations({ gutterXPx: 10, gutterYPx: 10 }, nudged);
    expect(out.some((v) => v.rule === "lattice-gutter" && v.detail.includes("x-lattice"))).toBe(true);
  });

  it("without a target: asserts uniformity within 2·tolerancePx", () => {
    const jitter = grid2x2.map((b, i) => (i === 1 ? { ...b, x: 111 } : b)); // gaps 10 & 11
    expect(gutterViolations({}, jitter)).toEqual([]);
    const ragged = grid2x2.map((b, i) => (i === 1 ? { ...b, x: 120 } : b)); // gaps 10 & 20
    const out = gutterViolations({}, ragged);
    expect(out.length).toBe(1);
    expect(out[0].rule).toBe("lattice-gutter");
    expect(out[0].detail).toMatch(/not uniform/);
  });

  it("an axis with no adjacency checks nothing (single column)", () => {
    const column: Box[] = [
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 0, y: 110, w: 100, h: 100 },
    ];
    expect(gutterViolations({ gutterXPx: 10, gutterYPx: 10 }, column)).toEqual([]);
  });

  it("a HOLE in the cover reads as a giant gap — the packing-failure signal", () => {
    const holey: Box[] = [
      { x: 0, y: 0, w: 100, h: 100 },
      // middle cell missing
      { x: 220, y: 0, w: 100, h: 100 },
    ];
    const out = gutterViolations({ gutterXPx: 10 }, holey);
    expect(out.length).toBe(1);
    expect(out[0].actual).toBe(120); // 10 + 100 + 10
  });

  it("corner-kissing boxes are not neighbors", () => {
    const diagonal: Box[] = [
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 110, y: 110, w: 100, h: 100 }, // no cross-axis overlap
    ];
    expect(gutterViolations({ gutterXPx: 10, gutterYPx: 10 }, diagonal)).toEqual([]);
  });
});

describe("checkCoverage — null-space accounting", () => {
  it("passes when painted + planned null == canvas", () => {
    // 4 boxes of 480×480 on a 1000×1000 canvas → painted 921600, null 7.84%.
    const boxes: Box[] = [
      { x: 10, y: 10, w: 480, h: 480 },
      { x: 510, y: 10, w: 480, h: 480 },
      { x: 10, y: 510, w: 480, h: 480 },
      { x: 510, y: 510, w: 480, h: 480 },
    ];
    expect(coverageViolations({ expectedNullFrac: 0.0784 }, boxes, 1000, 1000)).toEqual([]);
    const out = coverageViolations({ expectedNullFrac: 0.2 }, boxes, 1000, 1000);
    expect(out.length).toBe(1);
    expect(out[0].rule).toBe("coverage");
    expect(out[0].actual).toBeCloseTo(0.078, 2);
  });

  it("overlapping boxes are corrected AND called out (an emitter bug, not coverage)", () => {
    const overlapping: Box[] = [
      { x: 0, y: 0, w: 500, h: 500 },
      { x: 400, y: 0, w: 500, h: 500 }, // 100×500 overlap
    ];
    // Overlap-corrected painted = 450000 → null 0.55: the corrected number passes…
    expect(coverageViolations({ expectedNullFrac: 0.55 }, overlapping, 1000, 1000)).toEqual([]);
    // …and when the plan disagrees, the violation names the overlap.
    const out = coverageViolations({ expectedNullFrac: 0.5 }, overlapping, 1000, 1000);
    expect(out.length).toBe(1);
    expect(out[0].detail).toMatch(/OVERLAP/);
  });
});

describe("checkLayout — lattice + coverage relations end-to-end", () => {
  const taggedSource = (label: string): MosaicSource =>
    ({ type: "lavfi", color: "#000000", editor: { label } } as unknown as MosaicSource);

  const photoDoc = (rects: Box[], W: number, H: number): MosaicDocument => {
    const pieces = rects.map((rect) => ({ rect, source: taggedSource("photo") }));
    const { m0, sources } = placeInsetPieces({ rootW: W, rootH: H, pieces });
    return { kind: "mosaic_document", version: 1, assets: {} as any, m0: String(m0) as any, sources } as MosaicDocument;
  };

  // A 2×2 photo lattice: 200×200 cells, 100px gutters, painted 160000 of 1e6.
  const sheet: Box[] = [
    { x: 100, y: 100, w: 200, h: 200 },
    { x: 400, y: 100, w: 200, h: 200 },
    { x: 100, y: 400, w: 200, h: 200 },
    { x: 400, y: 400, w: 200, h: 200 },
  ];

  const run = (rects: Box[], relations: RelationalConstraint[]) =>
    checkLayout(photoDoc(rects, 1000, 1000), { canvasW: 1000, canvasH: 1000, relations });

  it("the collage contract: lattice gutters + coverage hold together", () => {
    const res = run(sheet, [
      { label: "photo", lattice: { gutterXPx: 100, gutterYPx: 100 } },
      { label: "photo", coverage: { expectedNullFrac: 0.84 } },
    ]);
    expect(res.ok).toBe(true);
    expect(res.resolved["photo"].length).toBe(4);
  });

  it("a broken lattice fails with the new rules", () => {
    const broken = sheet.map((b, i) => (i === 1 ? { ...b, x: 420 } : b));
    const res = run(broken, [
      { label: "photo", lattice: { gutterXPx: 100, gutterYPx: 100 } },
      { label: "photo", coverage: { expectedNullFrac: 0.9 } },
    ]);
    expect(res.ok).toBe(false);
    expect(res.violations.some((v) => v.rule === "lattice-gutter")).toBe(true);
    expect(res.violations.some((v) => v.rule === "coverage")).toBe(true);
  });

  it("coverage is meaningful from a SINGLE node (one-image sheet)", () => {
    const one: Box[] = [{ x: 100, y: 100, w: 800, h: 800 }];
    const res = run(one, [{ label: "photo", coverage: { expectedNullFrac: 0.36 } }]);
    expect(res.ok).toBe(true);
    // Pairwise relations still demand ≥2.
    const pair = run(one, [{ label: "photo", equal: "size" }]);
    expect(pair.ok).toBe(false);
    expect(pair.violations[0].rule).toBe("too-few");
  });
});
