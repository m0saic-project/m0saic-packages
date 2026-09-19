import type { MosaicDocument, MosaicEngineContext } from "@m0saic/types";
import { parseM0StringComplete } from "@m0saic/dsl";
import { placeRect, placeInsetRects, weightedSplit } from "@m0saic/dsl-stdlib";
import { checkDocGeometry, engineRecover } from "./checkDocGeometry";
import { assertGeometry } from "./assertGeometry";
import { withGeometryContract, formatViolationsMessage } from "./withGeometryContract";
import type { GeometryExpectation, GeometryViolation } from "./types";

// ── helpers ──────────────────────────────────────────────────
const docOf = (m0: string): MosaicDocument =>
  ({ kind: "mosaic_document", version: 1, assets: {} as any, m0: m0 as any, sources: [] } as MosaicDocument);

const ctxFor = (w: number, h: number): MosaicEngineContext => {
  const t = { width: w, height: h, fps: 30, durationMs: 2000 };
  return { mode: "render", target: t, output: { ...t, workspaceDir: "/tmp/geom" }, media: {} } as unknown as MosaicEngineContext;
};

const check = (m0: string, w: number, h: number, expectations: GeometryExpectation[], tolerancePx?: number) =>
  checkDocGeometry(docOf(m0), { canvasW: w, canvasH: h, expectations, tolerancePx });

describe("checkDocGeometry", () => {
  it("exact match — multi-rect placeRects geometry survives byte-exact (zip, tol 0)", () => {
    // Two lattice-aligned (multiples of pitch 16×9) non-overlapping rects →
    // insets are null and the m0 is placeRects-identical (exact). Frame paint
    // order = (y, x), so the expectations zip to the frames one-for-one.
    const rects = [
      { x: 160, y: 90, w: 320, h: 180 }, // upper-left
      { x: 960, y: 540, w: 480, h: 270 }, // lower-right
    ];
    const placed = placeInsetRects({ rootW: 1920, rootH: 1080, basis: 120, rects: rects.map((r) => ({ ...r, claimant: "F" })) });
    expect(placed.insets).toEqual([null, null]); // lattice-aligned → exact
    const res = check(String(placed.m0), 1920, 1080, rects.map((r, i) => ({ name: `r${i}`, rect: r })), 0);
    expect(res.ok).toBe(true);
    expect(res.violations).toEqual([]);
    // floors are populated for the matrix report.
    expect(typeof res.floors.maxSpreadPx).toBe("number");
    expect(res.floors.feasible).toBe(true);
  });

  it("1px ratio jitter passes at the default tolerance (healthy quantization is by-design)", () => {
    // 3 equal columns @ 1000 wide → cells drift ≤1px from the ideal thirds.
    const m0 = String(weightedSplit([1, 1, 1], "col"));
    const thirds: GeometryExpectation[] = [
      { name: "c0", rect: { x: 0, y: 0, w: 333, h: 300 } },
      { name: "c1", rect: { x: 333, y: 0, w: 334, h: 300 } },
      { name: "c2", rect: { x: 667, y: 0, w: 333, h: 300 } },
    ];
    // Default tol (1) → all cells within 1px → ok.
    expect(check(m0, 1000, 300, thirds).ok).toBe(true);
  });

  it("tolerance threshold — a 2px intent gap fails at tol 1, passes at tol 2", () => {
    const m0 = String(placeRect({ rootW: 800, rootH: 600, rectW: 200, rectH: 150, x: 100, y: 100 }).m0);
    const intent: GeometryExpectation[] = [{ name: "shifted", rect: { x: 102, y: 100, w: 200, h: 150 } }];
    expect(check(m0, 800, 600, intent, 1).ok).toBe(false);
    expect(check(m0, 800, 600, intent, 2).ok).toBe(true);
  });

  it("quantization catch — the 290×288 stat-card value-band squash (59→38px)", () => {
    // At the 290×288 desktop rail the quantizing insetNode placement crushed the
    // value band from an intended 59px to a realized 38px, clipping the 55px
    // digits. Stand in the squashed realization via an exact placeRect and prove
    // the contract catches the 21px size loss the STRING never revealed.
    const W = 290, H = 288;
    const m0 = String(placeRect({ rootW: W, rootH: H, rectW: 242, rectH: 38, x: 24, y: 96 }).m0);
    const res = check(m0, W, H, [{ name: "value-band", rect: { x: 24, y: 96, w: 242, h: 59 } }]);
    expect(res.ok).toBe(false);
    const v = res.violations.find((x) => x.kind === "size" && x.axis === "y");
    expect(v).toBeDefined();
    expect(v!.deltaPx).toBe(-21);
    expect(v!.name).toBe("value-band");
  });

  it("inset-recovery replay — a real placeInsetRects (cell, inset) recovers exact", () => {
    const rect = { x: 140, y: 150, w: 980, h: 92 };
    const placed = placeInsetRects({ rootW: 1920, rootH: 1080, basis: 120, rects: [{ ...rect, claimant: "F" }] });
    // The parsed frame is the OUTWARD-quantized cell; the checker replays the
    // engine floor math against the inset and asserts the recovered box == rect.
    const res = check(String(placed.m0), 1920, 1080, [{ name: "title", rect, inset: placed.insets[0]! }]);
    expect(res.ok).toBe(true);

    // Sanity: our engineRecover replica matches the reference on this cell.
    expect(engineRecover(placed.cells[0], placed.insets[0]!)).toEqual(rect);
  });

  it("inset-recovery catch — a corrupted inset fails to reproduce intent", () => {
    const rect = { x: 140, y: 150, w: 980, h: 92 };
    const placed = placeInsetRects({ rootW: 1920, rootH: 1080, basis: 120, rects: [{ ...rect, claimant: "F" }] });
    const badInset = { ...placed.insets[0]!, left: placed.insets[0]!.left + 0.1 };
    const res = check(String(placed.m0), 1920, 1080, [{ name: "title", rect, inset: badInset }]);
    expect(res.ok).toBe(false);
    expect(res.violations.some((v) => v.kind === "inset-recovery" && v.axis === "x")).toBe(true);
  });

  it("mask-scale — mask bounds must scale 1:1 (undistorted) into the painted box", () => {
    const m0 = String(placeRect({ rootW: 600, rootH: 400, rectW: 200, rectH: 100, x: 50, y: 50 }).m0);
    // box aspect 2.0; a 24×24 (aspect 1.0) mask would distort → violation.
    const bad = check(m0, 600, 400, [{ name: "chip", rect: { x: 50, y: 50, w: 200, h: 100 }, maskBounds: { width: 24, height: 24 } }]);
    expect(bad.ok).toBe(false);
    expect(bad.violations.some((v) => v.kind === "mask-scale")).toBe(true);
    // a 48×24 (aspect 2.0) mask matches the box → ok.
    const ok = check(m0, 600, 400, [{ name: "chip", rect: { x: 50, y: 50, w: 200, h: 100 }, maskBounds: { width: 48, height: 24 } }]);
    expect(ok.ok).toBe(true);
  });

  it("min-size — a realized box below the clip guard is flagged", () => {
    const m0 = String(placeRect({ rootW: 400, rootH: 400, rectW: 30, rectH: 40, x: 10, y: 10 }).m0);
    const res = check(m0, 400, 400, [{ name: "icon", rect: { x: 10, y: 10, w: 30, h: 40 }, minPx: { w: 40, h: 40 } }]);
    expect(res.ok).toBe(false);
    const v = res.violations.find((x) => x.kind === "min-size" && x.axis === "x");
    expect(v).toBeDefined();
    expect(v!.deltaPx).toBe(-10); // 30 realized − 40 min
  });

  it("missing-frame — an expectation whose center hits no frame (nearest mode)", () => {
    // One frame; two expectations → nearest-containing matching.
    const m0 = String(placeRect({ rootW: 1000, rootH: 1000, rectW: 100, rectH: 100, x: 50, y: 50 }).m0);
    const res = check(m0, 1000, 1000, [
      { name: "present", rect: { x: 50, y: 50, w: 100, h: 100 } }, // center (100,100) inside
      { name: "absent", rect: { x: 800, y: 800, w: 100, h: 100 } }, // center (850,850) outside
    ]);
    expect(res.ok).toBe(false);
    expect(res.violations.some((v) => v.kind === "missing-frame" && v.name === "absent")).toBe(true);
    expect(res.violations.some((v) => v.name === "present")).toBe(false);
  });

  // ── StableKey-based selection (guaranteed identity, assert a subset) ──
  const keyedM0 = () => {
    const rects = [
      { x: 160, y: 90, w: 320, h: 180 }, // upper-left
      { x: 960, y: 540, w: 480, h: 270 }, // lower-right (16:9)
    ];
    const m0 = String(
      placeInsetRects({ rootW: 1920, rootH: 1080, basis: 120, rects: rects.map((r) => ({ ...r, claimant: "F" })) }).m0,
    );
    const frames = parseM0StringComplete(m0, 1920, 1080);
    const keys = (frames.ok ? [...frames.ir.renderFrames] : [])
      .sort((a, b) => a.logicalIndex - b.logicalIndex)
      .map((f) => f.meta.stableKey);
    return { m0, rects, keys };
  };

  it("keyed selection — assert a SUBSET by StableKey, no need to enumerate every rect", () => {
    const { m0, rects, keys } = keyedM0();
    const heroKey = keys[1]; // the lower-right 480×270 frame; the other is ignored entirely
    const ok = check(m0, 1920, 1080, [{ name: "hero", stableKey: heroKey, rect: rects[1] }], 0);
    expect(ok.ok).toBe(true);
    // wrong dims on that key → size violation, and the untouched frame stays unasserted.
    const bad = check(m0, 1920, 1080, [{ name: "hero", stableKey: heroKey, rect: { ...rects[1], h: 300 } }], 0);
    expect(bad.ok).toBe(false);
    expect(bad.violations.some((v) => v.kind === "size" && v.axis === "y" && v.name === "hero")).toBe(true);
  });

  it("keyed missing — an unknown StableKey reports missing-frame (never mis-matches)", () => {
    const { m0, rects } = keyedM0();
    const res = check(m0, 1920, 1080, [{ name: "ghost", stableKey: "r/does/not/exist", rect: rects[0] }]);
    expect(res.ok).toBe(false);
    expect(res.violations[0].kind).toBe("missing-frame");
    expect(res.violations[0].detail).toMatch(/stableKey/);
  });

  it("keyed dims-only — check labeled chrome has X dims (expectSize/aspect), position unpinned", () => {
    const { m0, keys } = keyedM0();
    const heroKey = keys[1]; // realized 480×270 = 16:9
    expect(
      check(m0, 1920, 1080, [
        { name: "hero", stableKey: heroKey, expectSize: { w: 480, h: 270 }, expectAspect: 16 / 9, aspectTolerance: 0.01 },
      ]).ok,
    ).toBe(true);
    // wrong width by key, no rect position needed.
    const bad = check(m0, 1920, 1080, [{ name: "hero", stableKey: heroKey, expectSize: { w: 999, h: 270 } }]);
    expect(bad.ok).toBe(false);
    expect(bad.violations.some((v) => v.kind === "size" && v.axis === "x")).toBe(true);
  });

  it("resolves stableKey + sourceIndex (= logicalIndex, the sources[] index) for EVERY expectation — free from the one parse", () => {
    const { m0, rects, keys } = keyedM0();
    const res = check(m0, 1920, 1080, rects.map((r, i) => ({ name: `r${i}`, rect: r })), 0);
    expect(res.ok).toBe(true);
    // The stableKey ↔ sourceIndex(= sources[] index) bridge, per expectation.
    expect(res.matched).toEqual([
      { index: 0, name: "r0", stableKey: keys[0], sourceIndex: 0 },
      { index: 1, name: "r1", stableKey: keys[1], sourceIndex: 1 },
    ]);
  });

  it("a violation carries the matched frame's stableKey + sourceIndex (identity + source index)", () => {
    const { m0, keys } = keyedM0();
    const heroKey = keys[1];
    const res = check(m0, 1920, 1080, [{ name: "hero", stableKey: heroKey, rect: { x: 960, y: 540, w: 480, h: 300 } }], 0);
    expect(res.ok).toBe(false);
    const v = res.violations[0];
    expect(v.stableKey).toBe(heroKey);
    expect(v.sourceIndex).toBe(1);
  });

  it("missing-frame carries no identity (nothing was matched)", () => {
    const { m0, rects } = keyedM0();
    const res = check(m0, 1920, 1080, [{ name: "ghost", stableKey: "r/nope", rect: rects[0] }]);
    expect(res.violations[0].stableKey).toBeUndefined();
    expect(res.violations[0].sourceIndex).toBeUndefined();
    expect(res.matched[0]).toEqual({ index: 0, name: "ghost", stableKey: undefined, sourceIndex: undefined });
  });

  it("resolves source tags (editor.label) → stableKey and returns them for backfill", () => {
    const rect = { x: 160, y: 90, w: 320, h: 180 };
    const m0 = String(placeInsetRects({ rootW: 1920, rootH: 1080, basis: 120, rects: [{ ...rect, claimant: "F" }] }).m0);
    // A source carrying a human tag on editor.label — the "tag your source" path.
    const doc = {
      kind: "mosaic_document", version: 1, assets: {} as any,
      m0: m0 as any, sources: [{ type: "lavfi", color: "x", editor: { label: "hero" } } as any],
    } as MosaicDocument;
    const res = checkDocGeometry(doc, { canvasW: 1920, canvasH: 1080, expectations: [{ rect }] });
    expect(res.ok).toBe(true);
    // The tag flows source (by logicalIndex) → stableKey, on the match + the map.
    expect(res.matched[0].label).toBe("hero");
    expect(res.matched[0].sourceIndex).toBe(0);
    const key = res.matched[0].stableKey!;
    expect(res.resolvedLabels).toEqual({ [key]: "hero" });
  });

  it("empty expectations → ok with populated floors (nothing to assert)", () => {
    const m0 = String(placeRect({ rootW: 200, rootH: 200, rectW: 50, rectH: 50, x: 10, y: 10 }).m0);
    const res = check(m0, 200, 200, []);
    expect(res.ok).toBe(true);
    expect(res.violations).toEqual([]);
  });

  it("invalid m0 degrades to missing-frame — never throws", () => {
    const res = check("this-is-not-valid-m0!!!", 100, 100, [{ name: "x", rect: { x: 0, y: 0, w: 10, h: 10 } }]);
    expect(res.ok).toBe(false);
    expect(res.violations[0].kind).toBe("missing-frame");
    expect(res.floors.feasible).toBe(false);
  });
});

describe("formatViolationsMessage (error-mosaic payload budget)", () => {
  it("caps at 6 lines + a '...and N more' summary", () => {
    const vs: GeometryViolation[] = Array.from({ length: 8 }, (_, i) => ({
      index: i,
      kind: "size" as const,
      intended: { x: 0, y: 0, w: 1, h: 1 },
      detail: `v${i}`,
    }));
    const msg = formatViolationsMessage(vs);
    const lines = msg.split("\n");
    expect(lines.length).toBe(7); // 6 shown + 1 summary
    expect(msg).toMatch(/\.\.\.and 2 more violations\./);
  });

  it("no summary line when under the cap", () => {
    const vs: GeometryViolation[] = [{ index: 0, kind: "position", intended: { x: 0, y: 0, w: 1, h: 1 }, detail: "one" }];
    expect(formatViolationsMessage(vs)).toBe("one");
  });
});

describe("withGeometryContract (dev tripwire)", () => {
  it("zero-cost when off — returns the SAME doc reference, unparsed", () => {
    const doc = docOf(String(placeRect({ rootW: 100, rootH: 100, rectW: 50, rectH: 50, x: 10, y: 10 }).m0));
    const out = withGeometryContract(doc, ctxFor(100, 100), {
      templateId: "@test/off",
      expectations: [{ rect: { x: 0, y: 0, w: 1, h: 1 } }], // would fail if checked
    });
    expect(out).toBe(doc);
    // debug: false is explicit-identical.
    expect(withGeometryContract(doc, ctxFor(100, 100), { templateId: "@t", debug: false, expectations: [] })).toBe(doc);
  });

  // 2026-08-20: debug on now DRAWS the contract in both directions (same
  // treatment as the layout contract): pass → green wireframe + "N elements
  // exact" banner; fail → realized red + intended amber ghost. A silently
  // passing no-op was indistinguishable from a contract that never ran.
  const colorsOf = (d: MosaicDocument): Array<string | undefined> =>
    (d.sources as Array<{ color?: string }>).map((s) => s?.color);

  it("on pass — returns the GREEN wireframe, stamp carries the identity map", () => {
    const m0 = String(placeRect({ rootW: 480, rootH: 480, rectW: 100, rectH: 100, x: 20, y: 20 }).m0);
    const doc = { ...docOf(m0), fps: 30, durationMs: 2000, size: { width: 480, height: 480 } } as MosaicDocument;
    const out = withGeometryContract(doc, ctxFor(480, 480), {
      templateId: "@test/pass",
      debug: true,
      expectations: [{ name: "r", rect: { x: 20, y: 20, w: 100, h: 100 } }],
    });
    expect(out.editor?.geometryContract?.ok).toBe(true);
    expect(out.editor?.geometryContract?.templateId).toBe("@test/pass");
    expect(out.editor?.geometryContract?.canvas).toEqual({ w: 480, h: 480 });
    expect(out.editor?.geometryContract?.expectationCount).toBe(1);
    // The stamp carries the resolved identity map (stableKey ↔ sources index).
    expect(out.editor?.geometryContract?.matched.length).toBe(1);
    expect(out.editor?.geometryContract?.matched[0].sourceIndex).toBe(0);
    expect(typeof out.editor?.geometryContract?.matched[0].stableKey).toBe("string");
    // The doc IS the wireframe now: expected element green, nothing red.
    expect(String(out.m0)).not.toBe(m0);
    expect(colorsOf(out)).toContain("#2ea043@0.30");
    expect(colorsOf(out)).not.toContain("#f85149@0.35");
    const texts = (out.sources as Array<{ type?: string; layers?: Array<{ content?: { text?: string } }> }>)
      .filter((s) => s.type === "text")
      .map((s) => s.layers?.[0]?.content?.text ?? "");
    expect(texts.some((t) => t.includes("GEOMETRY_CONTRACT OK"))).toBe(true);
    expect(texts.some((t) => t.includes("1 element exact"))).toBe(true);
  });

  it("on pass — the stamp's matched map still resolves source tags (labels ride the stamp, not the wireframe)", () => {
    const rect = { x: 160, y: 90, w: 320, h: 180 };
    const m0 = String(placeInsetRects({ rootW: 1920, rootH: 1080, basis: 120, rects: [{ ...rect, claimant: "F" }] }).m0);
    const doc = {
      kind: "mosaic_document", version: 1, assets: {} as any, m0: m0 as any,
      sources: [{ type: "lavfi", color: "x", editor: { label: "hero" } } as any],
      fps: 30, durationMs: 2000, size: { width: 1920, height: 1080 },
    } as MosaicDocument;
    const out = withGeometryContract(doc, ctxFor(1920, 1080), { templateId: "@t", debug: true, expectations: [{ name: "hero", rect }] });
    // The wireframe replaces the doc, so doc.labels backfill no longer applies;
    // the identity map lives in the stamp (label + stableKey per match).
    expect(out.editor?.geometryContract?.ok).toBe(true);
    expect(out.editor?.geometryContract?.matched[0].label).toBe("hero");
    expect(typeof out.editor?.geometryContract?.matched[0].stableKey).toBe("string");
  });

  it("on fail — returns the wireframe (realized red + intended amber ghost), stamped ok:false, timing carried", () => {
    const W = 290, H = 288;
    const m0 = String(placeRect({ rootW: W, rootH: H, rectW: 242, rectH: 38, x: 24, y: 96 }).m0);
    const doc = { ...docOf(m0), fps: 30, durationMs: 2000, size: { width: W, height: H } } as MosaicDocument;
    const out = withGeometryContract(doc, ctxFor(W, H), {
      templateId: "@test/squash",
      debug: true,
      expectations: [{ name: "value-band", rect: { x: 24, y: 96, w: 242, h: 59 } }],
    });
    // The wireframe shows the drift: realized red, intended amber ghost.
    expect(colorsOf(out)).toContain("#f85149@0.35");
    expect(colorsOf(out)).toContain("#d29922@0.10");
    // stamp present and ok:false.
    expect(out.editor?.geometryContract?.ok).toBe(false);
    expect(out.editor?.geometryContract?.violations.length).toBeGreaterThan(0);
    // timing/size carried so it renders in the same slot.
    expect(out.fps).toBe(30);
    expect(out.durationMs).toBe(2000);
    expect(out.size).toEqual({ width: W, height: H });
  });
});

describe("assertGeometry (throwing sibling)", () => {
  it("throws on violation, with the readout", () => {
    const W = 290, H = 288;
    const doc = docOf(String(placeRect({ rootW: W, rootH: H, rectW: 242, rectH: 38, x: 24, y: 96 }).m0));
    expect(() =>
      assertGeometry(doc, ctxFor(W, H), "@test/squash", {
        expectations: [{ name: "value-band", rect: { x: 24, y: 96, w: 242, h: 59 } }],
      }),
    ).toThrow(/geometry contract violated/);
  });

  it("does not throw when the geometry holds", () => {
    const doc = docOf(String(placeRect({ rootW: 480, rootH: 480, rectW: 100, rectH: 100, x: 20, y: 20 }).m0));
    expect(() =>
      assertGeometry(doc, ctxFor(480, 480), "@test/pass", {
        expectations: [{ rect: { x: 20, y: 20, w: 100, h: 100 } }],
      }),
    ).not.toThrow();
  });
});
