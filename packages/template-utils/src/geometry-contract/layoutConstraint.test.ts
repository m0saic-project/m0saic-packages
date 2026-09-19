import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { placeInsetPieces } from "../layout/placeInsetPieces";
import { checkLayout, type LayoutConstraint } from "./layoutConstraint";
import { withLayoutContract, assertLayout } from "./withLayoutContract";

// ── helpers ──────────────────────────────────────────────────
type LR = { x: number; y: number; w: number; h: number; label: string };

const taggedSource = (label: string): MosaicSource =>
  ({ type: "lavfi", color: "#000000", editor: { label } } as unknown as MosaicSource);

/** Build a doc via the real front door: labeled sources ride through placeInsetPieces
 *  (zero-drift), so the painted box the checker recovers == the intended rect. */
const labeledDoc = (rects: LR[], W: number, H: number): MosaicDocument => {
  const pieces = rects.map((r) => ({ rect: { x: r.x, y: r.y, w: r.w, h: r.h }, source: taggedSource(r.label) }));
  const { m0, sources } = placeInsetPieces({ rootW: W, rootH: H, pieces });
  return { kind: "mosaic_document", version: 1, assets: {} as any, m0: String(m0) as any, sources } as MosaicDocument;
};

const ctxFor = (w: number, h: number): MosaicEngineContext => {
  const t = { width: w, height: h, fps: 30, durationMs: 2000 };
  return { mode: "render", target: t, output: { ...t, workspaceDir: "/tmp/layout" }, media: {} } as unknown as MosaicEngineContext;
};

const run = (rects: LR[], W: number, H: number, constraints: LayoutConstraint[]) =>
  checkLayout(labeledDoc(rects, W, H), { canvasW: W, canvasH: H, constraints });

describe("checkLayout — label-keyed ratio invariants", () => {
  it("aspect — passes a square chip, fails a wide box", () => {
    const rects: LR[] = [
      { x: 100, y: 100, w: 200, h: 200, label: "chip" }, // square
      { x: 0, y: 400, w: 600, h: 200, label: "banner" }, // 3:1
    ];
    const ok = run(rects, 1000, 1000, [{ label: "chip", aspect: 1, aspectTolerance: 0.02 }]);
    expect(ok.ok).toBe(true);
    const bad = run(rects, 1000, 1000, [{ label: "banner", aspect: 1 }]);
    expect(bad.ok).toBe(false);
    expect(bad.violations[0].rule).toBe("aspect");
    expect(bad.violations[0].label).toBe("banner");
    expect(bad.violations[0].actual).toBe(3); // 600/200
  });

  it("width/height fractions — canvas-independent min/max", () => {
    const rects: LR[] = [{ x: 0, y: 400, w: 500, h: 200, label: "hero" }]; // 50% wide, 20% tall
    expect(run(rects, 1000, 1000, [{ label: "hero", minWidthFrac: 0.5 }]).ok).toBe(true);
    const tooNarrow = run(rects, 1000, 1000, [{ label: "hero", minWidthFrac: 0.6 }]);
    expect(tooNarrow.ok).toBe(false);
    expect(tooNarrow.violations[0].rule).toBe("min-width-frac");
    expect(tooNarrow.violations[0].actual).toBe(0.5);
    // "hero never exceeds this width"
    expect(run(rects, 1000, 1000, [{ label: "hero", maxWidthFrac: 0.4 }]).ok).toBe(false);
    expect(run(rects, 1000, 1000, [{ label: "hero", maxHeightFrac: 0.25 }]).ok).toBe(true);
  });

  it("within — the header must live in the top band", () => {
    const rects: LR[] = [{ x: 0, y: 0, w: 1000, h: 150, label: "header" }]; // top 15%
    expect(run(rects, 1000, 1000, [{ label: "header", within: { yFrac: [0, 0.2] } }]).ok).toBe(true);
    const escapes = run(rects, 1000, 1000, [{ label: "header", within: { yFrac: [0, 0.1] } }]);
    expect(escapes.ok).toBe(false);
    expect(escapes.violations[0].rule).toBe("within-y");
  });

  it("one-to-MANY — a constraint on a label checks EVERY frame tagged with it", () => {
    // Two cells share the label "cell"; one is square, one is 2:1.
    const rects: LR[] = [
      { x: 0, y: 0, w: 200, h: 200, label: "cell" }, // square ✓
      { x: 400, y: 0, w: 400, h: 200, label: "cell" }, // 2:1 ✗
    ];
    const res = run(rects, 1000, 1000, [{ label: "cell", aspect: 1 }]);
    expect(res.resolved["cell"].length).toBe(2); // both resolved
    expect(res.ok).toBe(false);
    expect(res.violations.length).toBe(1); // only the 2:1 one fails
    expect(res.violations[0].actual).toBe(2);
  });

  it("missing-label — a constraint whose label didn't land in this m0", () => {
    const res = run([{ x: 0, y: 0, w: 100, h: 100, label: "chip" }], 1000, 1000, [{ label: "ghost", aspect: 1 }]);
    expect(res.ok).toBe(false);
    expect(res.violations[0].rule).toBe("missing-label");
    expect(res.violations[0].label).toBe("ghost");
  });

  it("resolves label → node (stableKey + sourceIndex) and the backfill map", () => {
    const res = run([{ x: 100, y: 100, w: 200, h: 200, label: "chip" }], 1000, 1000, [{ label: "chip", aspect: 1 }]);
    expect(res.ok).toBe(true);
    const node = res.resolved["chip"][0];
    expect(typeof node.stableKey).toBe("string");
    expect(typeof node.sourceIndex).toBe("number");
    expect(res.resolvedLabels[node.stableKey]).toBe("chip");
  });

  it("holds across canvases — the same declaration passes at wildly different sizes", () => {
    // "chip square + hero ≥ 40% wide" — one declaration, many canvases.
    const constraints: LayoutConstraint[] = [
      { label: "chip", aspect: 1, aspectTolerance: 0.03 },
      { label: "hero", minWidthFrac: 0.4 },
    ];
    for (const [W, H] of [[1920, 1080], [1080, 1920], [386, 277]] as [number, number][]) {
      const rects: LR[] = [
        { x: Math.round(W * 0.05), y: Math.round(H * 0.05), w: Math.round(H * 0.1), h: Math.round(H * 0.1), label: "chip" },
        { x: 0, y: Math.round(H * 0.5), w: Math.round(W * 0.5), h: Math.round(H * 0.3), label: "hero" },
      ];
      expect(run(rects, W, H, constraints).ok).toBe(true);
    }
  });
});

describe("checkLayout — asserts THROUGH nested children (the grid/v1 story)", () => {
  const nestedDoc = (childM0: string, childLabels: string[]): MosaicDocument =>
    ({
      kind: "mosaic_document", version: 1, assets: {} as any, m0: "1" as any,
      sources: [{ type: "mosaic", ref: "kid", editor: { label: "slot" } } as unknown as MosaicSource],
      children: { kid: { kind: "mosaic_document", version: 1, assets: {} as any, m0: childM0 as any, sources: childLabels.map(taggedSource) } },
    } as unknown as MosaicDocument);

  it("a child's label only resolves AFTER flatten (the parent's top-level m0 is trivial)", () => {
    const parent = nestedDoc("2(1,1)", ["left", "right"]);
    // auto-flatten (children present) → the nested "left" is present.
    const present = checkLayout(parent, { canvasW: 1000, canvasH: 1000, constraints: [{ label: "left" }] });
    expect(present.ok).toBe(true);
    expect(present.resolved["left"].length).toBe(1);
    // flatten:false → only the trivial top-level m0 is seen → "left" is invisible.
    const flat0 = checkLayout(parent, { canvasW: 1000, canvasH: 1000, constraints: [{ label: "left" }], flatten: false });
    expect(flat0.ok).toBe(false);
    expect(flat0.violations[0].rule).toBe("missing-label");
  });

  it("flatten FAILURE is the drop signal — the nested element cannot be present", () => {
    // A 3-col child needs ≥3px of width; at a 2px canvas it collapses
    // (SPLIT_EXCEEDS_AXIS) — exactly grid/v1's silent nested vanish.
    const parent = nestedDoc("3(1,1,1)", ["a", "b", "c"]);
    const dropped = checkLayout(parent, { canvasW: 2, canvasH: 2, constraints: [{ label: "a" }] });
    expect(dropped.ok).toBe(false);
    expect(dropped.violations[0].rule).toBe("missing-label");
    expect(dropped.violations[0].detail).toMatch(/collapsed|flatten failed/);
    // The SAME assertion passes at a canvas big enough to hold the grid.
    const held = checkLayout(parent, { canvasW: 900, canvasH: 300, constraints: [{ label: "a" }] });
    expect(held.ok).toBe(true);
  });
});

describe("checkLayout as a layout-search evaluator", () => {
  it("picks the packing that satisfies the invariants", () => {
    const W = 1200, H = 800;
    // Intent: a landscape hero (aspect ~ 3:2) that fills ≥ 60% width.
    const constraints: LayoutConstraint[] = [{ label: "hero", aspect: 1.5, aspectTolerance: 0.05, minWidthFrac: 0.6 }];
    // Candidate A — too narrow + too tall (portrait): fails.
    const A: LR[] = [{ x: 0, y: 0, w: 600, h: 800, label: "hero" }];
    // Candidate B — 900×600 = 1.5, 75% width: passes.
    const B: LR[] = [{ x: 0, y: 0, w: 900, h: 600, label: "hero" }];
    const pick = [A, B].find((cand) => checkLayout(labeledDoc(cand, W, H), { canvasW: W, canvasH: H, constraints }).ok);
    expect(pick).toBe(B);
  });
});

describe("checkLayout — relational constraints (image-collage taste)", () => {
  const photos = (rects: Array<{ x: number; y: number; w: number; h: number }>) =>
    labeledDoc(rects.map((r) => ({ ...r, label: "photo" })), 1000, 1000);
  const rel = (rs: Array<{ x: number; y: number; w: number; h: number }>, relations: Parameters<typeof checkLayout>[1]["relations"]) =>
    checkLayout(photos(rs), { canvasW: 1000, canvasH: 1000, relations });

  it("equal size — uniform thumbnails pass; a mismatch fails", () => {
    const uniform = [{ x: 100, y: 100, w: 200, h: 200 }, { x: 400, y: 100, w: 200, h: 200 }, { x: 700, y: 100, w: 200, h: 200 }];
    expect(rel(uniform, [{ label: "photo", equal: "size" }]).ok).toBe(true);
    const mixed = [{ x: 100, y: 100, w: 200, h: 200 }, { x: 400, y: 100, w: 200, h: 150 }, { x: 700, y: 100, w: 200, h: 200 }];
    const bad = rel(mixed, [{ label: "photo", equal: "size" }]);
    expect(bad.ok).toBe(false);
    expect(bad.violations.some((v) => v.rule === "equal-height")).toBe(true);
  });

  it("shorthand insets ({y}/{x}/scalar) collapse like the engine — no NaN vacuous pass", () => {
    // Regression (2026-08-20, found via the alpine bar-graph debugLayout demo):
    // a raw `placement.inset` in MosaicBoxFrac SHORTHAND form fed engineRecover
    // undefined edges → NaN boxes → every relation compared false and the
    // contract passed a deliberately doubled bar. The checker must collapse the
    // shorthand exactly like the engine does before applyInsetToRect.
    const W = 1000, H = 800;
    const src = (label: string, inset?: unknown): MosaicSource =>
      ({ type: "lavfi", color: "#000000", editor: { label }, ...(inset != null ? { placement: { inset } } : {}) } as unknown as MosaicSource);
    const doc2 = (a: MosaicSource, b: MosaicSource): MosaicDocument =>
      ({ kind: "mosaic_document", version: 1, assets: {} as any, m0: "2(F,F)" as any, sources: [a, b] } as MosaicDocument);

    // One box shrunk by a {y} shorthand inset, the sibling full-cell: recovered
    // heights differ 2× — the relation must FIRE (it vacuous-passed on NaN).
    const mixed = checkLayout(doc2(src("bar", { y: 0.25 }), src("bar")), {
      canvasW: W, canvasH: H, relations: [{ label: "bar", equal: "height" }],
    });
    expect(mixed.ok).toBe(false);
    expect(mixed.violations[0].rule).toBe("equal-height");

    // Same shorthand on both → uniform → passes, with REAL recovered boxes:
    // the 800-tall cells shrink to 800 − 2·floor(0.25·800) = 400px ⇒ exactly
    // half the canvas height (NaN boxes would trip max-height instead).
    const same = checkLayout(doc2(src("bar", { y: 0.25 }), src("bar", { y: 0.25 })), {
      canvasW: W, canvasH: H,
      relations: [{ label: "bar", equal: "height" }],
      constraints: [{ label: "bar", maxHeightFrac: 0.5 }],
    });
    expect(same.ok).toBe(true);

    // Scalar form ≡ the same fraction spelled per-side.
    const scalar = checkLayout(doc2(src("bar", 0.1), src("bar", { top: 0.1, bottom: 0.1, left: 0.1, right: 0.1 })), {
      canvasW: W, canvasH: H, relations: [{ label: "bar", equal: "size" }],
    });
    expect(scalar.ok).toBe(true);
  });

  it("a relations-only check still surfaces resolved nodes (for tooling / search)", () => {
    const three = [{ x: 100, y: 100, w: 200, h: 200 }, { x: 400, y: 100, w: 200, h: 200 }, { x: 700, y: 100, w: 200, h: 200 }];
    const res = checkLayout(photos(three), { canvasW: 1000, canvasH: 1000, relations: [{ label: "photo", equal: "size" }] });
    expect(res.resolved["photo"].length).toBe(3);
  });

  it("equal aspect — the landscape group stays a consistent shape", () => {
    const same = [{ x: 0, y: 0, w: 300, h: 200 }, { x: 0, y: 300, w: 150, h: 100 }]; // both 3:2
    expect(rel(same, [{ label: "photo", equal: "aspect" }]).ok).toBe(true);
    const diff = [{ x: 0, y: 0, w: 300, h: 200 }, { x: 0, y: 300, w: 200, h: 200 }]; // 1.5 vs 1
    expect(rel(diff, [{ label: "photo", equal: "aspect" }]).ok).toBe(false);
  });

  it("gutter — consistent spacing passes; ragged fails", () => {
    const even = [{ x: 0, y: 0, w: 200, h: 200 }, { x: 300, y: 0, w: 200, h: 200 }, { x: 600, y: 0, w: 200, h: 200 }]; // gaps 100, 100
    expect(rel(even, [{ label: "photo", gutter: { axis: "x" } }]).ok).toBe(true);
    const ragged = [{ x: 0, y: 0, w: 200, h: 200 }, { x: 300, y: 0, w: 200, h: 200 }, { x: 700, y: 0, w: 200, h: 200 }]; // gaps 100, 200
    const bad = rel(ragged, [{ label: "photo", gutter: { axis: "x" } }]);
    expect(bad.ok).toBe(false);
    expect(bad.violations[0].rule).toBe("gutter-uniform");
  });

  it("gutter target — assert an exact gap fraction of the canvas", () => {
    const even = [{ x: 0, y: 0, w: 200, h: 200 }, { x: 300, y: 0, w: 200, h: 200 }, { x: 600, y: 0, w: 200, h: 200 }]; // 100px = 10%
    expect(rel(even, [{ label: "photo", gutter: { axis: "x", target: 0.1 } }]).ok).toBe(true);
    expect(rel(even, [{ label: "photo", gutter: { axis: "x", target: 0.05 } }]).ok).toBe(false);
  });

  it("too-few — a relation needs ≥2 nodes", () => {
    const one = rel([{ x: 0, y: 0, w: 200, h: 200 }], [{ label: "photo", equal: "size" }]);
    expect(one.ok).toBe(false);
    expect(one.violations[0].rule).toBe("too-few");
  });

  it("the whole image-sheet contract — uniform thumbnails AND even gutters together", () => {
    const sheet = [
      { x: 100, y: 100, w: 200, h: 200 }, { x: 400, y: 100, w: 200, h: 200 }, { x: 700, y: 100, w: 200, h: 200 },
    ];
    const res = checkLayout(photos(sheet), {
      canvasW: 1000, canvasH: 1000,
      constraints: [{ label: "photo", aspect: 1 }],                       // each square
      relations: [{ label: "photo", equal: "size" }, { label: "photo", gutter: { axis: "x", target: 0.1 } }],
    });
    expect(res.ok).toBe(true);
  });
});

describe("withLayoutContract (dev tripwire)", () => {
  it("zero-cost when off — returns the same doc reference", () => {
    const doc = labeledDoc([{ x: 0, y: 0, w: 100, h: 100, label: "chip" }], 1000, 1000);
    expect(withLayoutContract(doc, ctxFor(1000, 1000), { templateId: "@t", constraints: [{ label: "chip", aspect: 9 }] })).toBe(doc);
  });

  it("on pass — returns the GREEN contract wireframe, stamped ok:true", () => {
    // 2026-08-20: debug on now draws the contract in BOTH directions — a
    // silently-passing no-op was indistinguishable from a contract that never
    // ran. Members render green; the banner lists the measured rules.
    const doc = labeledDoc([{ x: 100, y: 100, w: 200, h: 200, label: "chip" }], 1000, 1000);
    const out = withLayoutContract(doc, ctxFor(1000, 1000), { templateId: "@t/pass", debug: true, constraints: [{ label: "chip", aspect: 1 }] });
    expect(out.editor?.layoutContract?.ok).toBe(true);
    expect(out.editor?.layoutContract?.constraintCount).toBe(1);
    const colors = (out.sources as Array<{ color?: string }>).map((s) => s?.color);
    expect(colors).toContain("#2ea043@0.30"); // the chip, green
    expect(colors).not.toContain("#f85149@0.35");
  });

  it("on fail — returns the violation WIREFRAME (offenders red), stamped ok:false", () => {
    // 2026-08-20: the fail path now DRAWS the violation — a gray-box wireframe
    // with the offending cells highlighted red + a text banner — instead of the
    // prose-only error mosaic (which remains the fallback when the wireframe
    // can't be built). See violationWireframe.test.ts for the builder's own suite.
    const doc = { ...labeledDoc([{ x: 0, y: 0, w: 600, h: 200, label: "banner" }], 1000, 1000), fps: 30, durationMs: 2000, size: { width: 1000, height: 1000 } } as MosaicDocument;
    const out = withLayoutContract(doc, ctxFor(1000, 1000), { templateId: "@t/fail", debug: true, constraints: [{ label: "banner", aspect: 1 }] });
    expect(out.editor?.layoutContract?.ok).toBe(false);
    const colors = (out.sources as Array<{ color?: string }>).map((s) => s?.color);
    expect(colors).toContain("#f85149@0.35"); // the offending box, highlighted
    expect(colors).toContain("#0d1117"); // wireframe background
  });

  it("flatten:false passes through — judges only the parent's top-level geometry", () => {
    // A parent whose top-level m0 places one labeled "slot" (a nested-mosaic ref)
    // over a 2-cell child. The pulse beats are shaped like this: chrome lives at
    // top level, content is nested. A chrome-only contract must skip flatten.
    const parent = {
      kind: "mosaic_document", version: 1, assets: {} as any, m0: "1" as any,
      sources: [{ type: "mosaic", ref: "kid", editor: { label: "slot" } } as unknown as MosaicSource],
      children: { kid: { kind: "mosaic_document", version: 1, assets: {} as any, m0: "2(1,1)" as any, sources: ["left", "right"].map(taggedSource) } },
      fps: 30, durationMs: 2000, size: { width: 1000, height: 1000 },
    } as unknown as MosaicDocument;
    const stamp = (d: MosaicDocument) => d.editor?.layoutContract;
    // auto-flatten (children present) → the nested "left" resolves → judged.
    expect(stamp(withLayoutContract(parent, ctxFor(1000, 1000), { templateId: "@t", debug: true, constraints: [{ label: "left" }] }))?.ok).toBe(true);
    // flatten:false → the child is NOT expanded → "left" is invisible (missing).
    expect(stamp(withLayoutContract(parent, ctxFor(1000, 1000), { templateId: "@t", debug: true, flatten: false, constraints: [{ label: "left" }] }))?.ok).toBe(false);
    // …but the top-level "slot" IS judged under flatten:false (present in root m0).
    expect(stamp(withLayoutContract(parent, ctxFor(1000, 1000), { templateId: "@t", debug: true, flatten: false, constraints: [{ label: "slot", within: { xFrac: [0, 1] } }] }))?.ok).toBe(true);
  });
});

describe("withLayoutContract stays debug-only (best-effort ruling)", () => {
  // Founder ruling 2026-08-22: no production enforcement tier. A clipping
  // string with debug OFF must render anyway — the SAME doc reference, zero
  // cost — because a usable video with slightly cut text beats no video.
  it("debug OFF + clipping text — returns the SAME doc reference (render anyway)", () => {
    const textSource = {
      type: "text", editor: { label: "cap" }, visual: { backgroundColor: "black@0" },
      layers: [{ content: { kind: "literal", text: "CLIPPED WIDE STRING" }, style: { fontSize: 22 } }],
    } as unknown as MosaicSource;
    const { m0, sources } = placeInsetPieces({
      rootW: 1000, rootH: 1000,
      pieces: [{ rect: { x: 0, y: 0, w: 46, h: 40 }, source: textSource }],
    });
    const doc = { kind: "mosaic_document", version: 1, assets: {} as any, m0: String(m0) as any, sources } as MosaicDocument;
    const out = withLayoutContract(doc, ctxFor(1000, 1000), { templateId: "@t/besteffort", constraints: [{ label: "cap", textFits: {} }] });
    expect(out).toBe(doc);
  });
});

describe("assertLayout (throwing sibling)", () => {
  const doc = () => labeledDoc([{ x: 0, y: 0, w: 600, h: 200, label: "banner" }], 1000, 1000);
  it("throws on violation", () => {
    expect(() => assertLayout(doc(), ctxFor(1000, 1000), "@t", { constraints: [{ label: "banner", aspect: 1 }] })).toThrow(/layout contract violated/);
  });
  it("does not throw when invariants hold", () => {
    expect(() => assertLayout(doc(), ctxFor(1000, 1000), "@t", { constraints: [{ label: "banner", aspect: 3, aspectTolerance: 0.02 }] })).not.toThrow();
  });
});

describe("tolerancePx — absolute escape for equal-* at tiny paint sizes", () => {
  // 11px vs 12px bars: 8.3% spread — any sane fraction fails, but it IS the
  // engine's healthy equal-split ±1px. tolerancePx 1 passes it; 2px real
  // starvation (10 vs 12) still fails; aspect never uses the px escape.
  const bars = (hs: number[]) =>
    labeledDoc(hs.map((h, i) => ({ x: 0, y: i * 20, w: 100, h, label: "bar" })), 1000, 1000);
  const rel = (hs: number[], relations: Parameters<typeof checkLayout>[1]["relations"]) =>
    checkLayout(bars(hs), { canvasW: 1000, canvasH: 1000, relations });

  it("passes healthy ±1px that a pure fraction would false-red", () => {
    expect(rel([12, 11], [{ label: "bar", equal: "height", tolerance: 0.02 }]).ok).toBe(false);
    expect(rel([12, 11], [{ label: "bar", equal: "height", tolerance: 0.02, tolerancePx: 1 }]).ok).toBe(true);
  });

  it("still fails real starvation beyond the px escape", () => {
    const r = rel([12, 10], [{ label: "bar", equal: "height", tolerance: 0.02, tolerancePx: 1 }]);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.rule === "equal-height")).toBe(true);
  });

  it("aspect ignores the px escape (unitless metric)", () => {
    const chips = labeledDoc([
      { x: 0, y: 0, w: 12, h: 12, label: "chip" },
      { x: 0, y: 20, w: 12, h: 11, label: "chip" },
    ], 1000, 1000);
    const r = checkLayout(chips, { canvasW: 1000, canvasH: 1000, relations: [{ label: "chip", equal: "aspect", tolerance: 0.02, tolerancePx: 5 }] });
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.rule === "equal-aspect")).toBe(true);
  });
});

describe("xCenters / yCenters — the position lock (axis ticks ↔ mask-drawn features)", () => {
  const ticks = (xs: number[]): LR[] => xs.map((x, i) => ({ x, y: 500, w: 4, h: 8, label: "x-tick" }));

  it("passes ticks centered at the expected positions (±tolerance)", () => {
    const r = run(ticks([98, 198, 298]), 1000, 1000, [{ label: "x-tick", xCenters: [100, 200, 300], centerTolerancePx: 4 }]);
    expect(r.ok).toBe(true);
  });

  it("fails a shifted tick with the axis, index and both positions in the detail", () => {
    const r = run(ticks([98, 258, 298]), 1000, 1000, [{ label: "x-tick", xCenters: [100, 200, 300], centerTolerancePx: 4 }]);
    expect(r.ok).toBe(false);
    const v = r.violations.find((x) => x.rule === "x-center");
    expect(v).toBeDefined();
    expect(v!.detail).toContain("[1]");
    expect(v!.actual).toBe(260);
  });

  it("fails on count mismatch (a tick vanished)", () => {
    const r = run(ticks([98, 198]), 1000, 1000, [{ label: "x-tick", xCenters: [100, 200, 300] }]);
    expect(r.violations.some((x) => x.rule === "center-count")).toBe(true);
  });

  it("yCenters checks the other axis independently", () => {
    const rects: LR[] = [{ x: 10, y: 96, w: 8, h: 8, label: "dot" }, { x: 10, y: 296, w: 8, h: 8, label: "dot" }];
    expect(run(rects, 1000, 1000, [{ label: "dot", yCenters: [100, 300], centerTolerancePx: 4 }]).ok).toBe(true);
    expect(run(rects, 1000, 1000, [{ label: "dot", yCenters: [100, 340], centerTolerancePx: 4 }]).ok).toBe(false);
  });
});

describe("textFits — the static Make-vs-render text lock", () => {
  const textDoc = (text: string, fontSize: number, cellW: number): MosaicDocument => {
    const textSource = {
      type: "text", editor: { label: "cap" }, visual: { backgroundColor: "black@0" },
      layers: [{ content: { kind: "literal", text }, style: { fontSize } }],
    } as unknown as MosaicSource;
    const { m0, sources } = placeInsetPieces({
      rootW: 1000, rootH: 1000,
      pieces: [{ rect: { x: 0, y: 0, w: cellW, h: 40 }, source: textSource }],
    });
    return { kind: "mosaic_document", version: 1, assets: {} as any, m0: String(m0) as any, sources } as MosaicDocument;
  };

  it("passes text that fits its box at the conservative CLI em-width", () => {
    const r = checkLayout(textDoc("W1", 20, 200), { canvasW: 1000, canvasH: 1000, constraints: [{ label: "cap", textFits: {} }] });
    expect(r.ok).toBe(true);
  });

  it("fails text whose estimated CLI width exceeds the box (the W11→N11 clip class)", () => {
    // 3 chars @ 22px × 0.72em ≈ 48px — a 46px cell clips in the CLI even
    // though the app's narrower rasterizer fits it.
    const r = checkLayout(textDoc("W11", 22, 46), { canvasW: 1000, canvasH: 1000, constraints: [{ label: "cap", textFits: {} }] });
    expect(r.ok).toBe(false);
    const v = r.violations.find((x) => x.rule === "text-fit");
    expect(v).toBeDefined();
    expect(v!.detail).toContain("clips in the CLI");
  });

  it("skips expr-content and non-text sources (nothing static to measure)", () => {
    const doc = textDoc("ignored", 22, 46) as { sources?: Array<{ layers?: Array<{ content?: { kind?: string } }> }> };
    doc.sources![0].layers![0].content!.kind = "expr";
    const r = checkLayout(doc as never, { canvasW: 1000, canvasH: 1000, constraints: [{ label: "cap", textFits: {} }] });
    expect(r.ok).toBe(true);
  });
});

// ── bindProp — the prop ↔ rect binding helper (sibling of tag) ─────────────
import { bindProp, bindProps, tag, stripPropBindings } from "./layoutConstraint";

describe("bindProp", () => {
  const src = (): MosaicSource => ({ type: "lavfi", color: "#000000" } as unknown as MosaicSource);

  it("returns the same reference and writes editor.binding", () => {
    const s = src();
    expect(bindProp(s, "title")).toBe(s);
    expect((s as any).editor).toEqual({ binding: { propKey: "title" } });
    // no `index` key at all when omitted (stable deep-equals for tests/goldens)
    expect("index" in (s as any).editor.binding).toBe(false);
  });

  it("carries a list element index", () => {
    expect((bindProp(src(), "labels", 2) as any).editor.binding).toEqual({ propKey: "labels", index: 2 });
    expect((bindProp(src(), "values", 0) as any).editor.binding).toEqual({ propKey: "values", index: 0 });
  });

  it("composes with tag in either order", () => {
    const a = tag(bindProp(src(), "labels", 1), "cat-label");
    const b = bindProp(tag(src(), "cat-label"), "labels", 1);
    expect((a as any).editor).toEqual({ label: "cat-label", binding: { propKey: "labels", index: 1 } });
    expect((a as any).editor).toEqual((b as any).editor);
  });

  it("re-binding replaces the previous binding", () => {
    const s = bindProp(bindProp(src(), "a", 3), "b");
    expect((s as any).editor.binding).toEqual({ propKey: "b" });
  });

  it("rejects bad inputs", () => {
    expect(() => bindProp(src(), "")).toThrow(/propKey/);
    expect(() => bindProp(src(), "values", -1)).toThrow(/index/);
    expect(() => bindProp(src(), "values", 1.5)).toThrow(/index/);
  });
});

describe("bindPropPath — structured (json/list) leaves", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { bindPropPath } = require("./layoutConstraint") as typeof import("./layoutConstraint");
  const src = (): MosaicSource => ({ type: "text", layers: [] } as unknown as MosaicSource);

  it("writes propKey + a copied path + kind, composing with tag", () => {
    const path = [2, "title"];
    const s = tag(bindPropPath(src(), "rows", path, "string"), "row-title");
    expect((s as any).editor).toEqual({ label: "row-title", binding: { propKey: "rows", path: [2, "title"], kind: "string" } });
    path.push("x");
    expect((s as any).editor.binding.path).toEqual([2, "title"]); // copied, not aliased
    expect((bindPropPath(src(), "rows", [0, "reviewers", 1], "string") as any).editor.binding.path).toEqual([0, "reviewers", 1]);
  });

  it("rejects bad inputs", () => {
    expect(() => bindPropPath(src(), "", [0], "string")).toThrow(/propKey/);
    expect(() => bindPropPath(src(), "rows", [], "string")).toThrow(/path/);
    expect(() => bindPropPath(src(), "rows", [-1, "t"], "string")).toThrow(/segment/);
    expect(() => bindPropPath(src(), "rows", [0, ""], "string")).toThrow(/segment/);
    expect(() => bindPropPath(src(), "rows", [0, "pr"], "boolean" as never)).toThrow(/kind/);
  });
});

describe("bindProps / bindPropPath — onClear (what an EMPTY commit means)", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { bindProps, bindPropPath } = require("./layoutConstraint") as typeof import("./layoutConstraint");
  const src = (): MosaicSource => ({ type: "text", layers: [] } as unknown as MosaicSource);

  it("bindProps forwards onClear per entry (and still strips fields it does not know)", () => {
    const s = bindProps(src(), [
      { propKey: "days", path: [2, "day"], kind: "number", onClear: "remove-element" },
      { propKey: "days", path: [2, "title"], kind: "string" },
      { propKey: "labels", index: 1, onClear: "remove-element" },
      { propKey: "title", onClear: "unset-leaf" },
      { propKey: "days", path: [2, "note"], kind: "string", onClear: "unset-leaf", stray: 1 } as never,
    ]);
    expect((s as any).editor.bindings).toEqual([
      { propKey: "days", path: [2, "day"], kind: "number", onClear: "remove-element" },
      { propKey: "days", path: [2, "title"], kind: "string" },
      { propKey: "labels", index: 1, onClear: "remove-element" },
      { propKey: "title", onClear: "unset-leaf" },
      { propKey: "days", path: [2, "note"], kind: "string", onClear: "unset-leaf" },
    ]);
  });

  it("bindPropPath takes onClear through opts", () => {
    expect((bindPropPath(src(), "days", [0, "day"], "number", { onClear: "remove-element" }) as any).editor.binding).toEqual({
      propKey: "days",
      path: [0, "day"],
      kind: "number",
      onClear: "remove-element",
    });
    expect((bindPropPath(src(), "days", [0, "day"], "number", {}) as any).editor.binding).toEqual({ propKey: "days", path: [0, "day"], kind: "number" });
  });

  it("refuses, at author time, an action its leaf cannot honor", () => {
    expect(() => bindProps(src(), [{ propKey: "title", onClear: "remove-element" }])).toThrow(/needs an element/);
    expect(() => bindProps(src(), [{ propKey: "rows", path: ["title"], kind: "string", onClear: "remove-element" }])).toThrow(/needs an element/);
    expect(() => bindProps(src(), [{ propKey: "labels", index: 1, onClear: "unset-leaf" }])).toThrow(/keyed leaf/);
    expect(() => bindProps(src(), [{ propKey: "rows", path: [0, "reviewers", 1], kind: "string", onClear: "unset-leaf" }])).toThrow(/keyed leaf/);
    expect(() => bindProps(src(), [{ propKey: "rows", path: [0, "t"], kind: "string", onClear: "delete" as never }])).toThrow(/onClear/);
    expect(() => bindPropPath(src(), "rows", ["t"], "string", { onClear: "remove-element" })).toThrow(/needs an element/);
    expect(() => bindPropPath(src(), "rows", [0], "string", { onClear: "unset-leaf" })).toThrow(/keyed leaf/);
  });
});

describe("bindProps / bindPropPath — seedDraft (the prefill for an EMPTY leaf)", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { bindProps, bindPropPath } = require("./layoutConstraint") as typeof import("./layoutConstraint");
  const src = (): MosaicSource => ({ type: "text", layers: [] } as unknown as MosaicSource);

  it("bindProps forwards seedDraft per entry — the drop-calendar add handle", () => {
    const s = bindProps(src(), [
      { propKey: "days", path: [6, "day"], kind: "number", onClear: "remove-element", seedDraft: "17" },
      { propKey: "days", path: [6, "title"], kind: "string" },
      { propKey: "labels", index: 2, seedDraft: "Slot 3" },
    ]);
    expect((s as any).editor.bindings).toEqual([
      { propKey: "days", path: [6, "day"], kind: "number", onClear: "remove-element", seedDraft: "17" },
      { propKey: "days", path: [6, "title"], kind: "string" },
      { propKey: "labels", index: 2, seedDraft: "Slot 3" },
    ]);
  });

  it("bindPropPath takes seedDraft through opts", () => {
    expect((bindPropPath(src(), "days", [6, "day"], "number", { onClear: "remove-element", seedDraft: "17" }) as any).editor.binding).toEqual({
      propKey: "days",
      path: [6, "day"],
      kind: "number",
      onClear: "remove-element",
      seedDraft: "17",
    });
  });

  it("refuses, at author time, a blank seed or a non-numeric seed on a number leaf", () => {
    expect(() => bindProps(src(), [{ propKey: "days", path: [6, "day"], kind: "number", seedDraft: "Tue" }])).toThrow(/not a number/);
    expect(() => bindProps(src(), [{ propKey: "days", path: [6, "title"], kind: "string", seedDraft: "  " }])).toThrow(/non-blank/);
    expect(() => bindProps(src(), [{ propKey: "days", path: [6, "day"], kind: "number", seedDraft: 17 as never }])).toThrow(/non-blank string/);
    expect(() => bindPropPath(src(), "days", [6, "day"], "number", { seedDraft: "" })).toThrow(/non-blank/);
    expect(() => bindPropPath(src(), "days", [6, "day"], "number", { seedDraft: "x" })).toThrow(/not a number/);
    // a string leaf takes any non-blank text
    expect((bindPropPath(src(), "days", [6, "title"], "string", { seedDraft: "Tue" }) as any).editor.binding.seedDraft).toBe("Tue");
  });
});

describe("bindProp / bindProps / bindPropPath — media leaves (a drop target in Make)", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { bindProp, bindProps, bindPropPath } = require("./layoutConstraint") as typeof import("./layoutConstraint");
  const src = (): MosaicSource => ({ type: "media", mediaType: "image" } as unknown as MosaicSource);

  it("a media / media[] prop needs no kind — bindProp with the element index is the whole binding", () => {
    expect((bindProp(src(), "facecam") as any).editor.binding).toEqual({ propKey: "facecam" });
    expect((bindProp(src(), "teasers", 2) as any).editor.binding).toEqual({ propKey: "teasers", index: 2 });
  });

  it("a structured leaf holding a path binds with kind media (bindProps + bindPropPath)", () => {
    expect((bindPropPath(src(), "rows", [1, "image"], "media", { onClear: "unset-leaf" }) as any).editor.binding).toEqual({
      propKey: "rows",
      path: [1, "image"],
      kind: "media",
      onClear: "unset-leaf",
    });
    const s = bindProps(src(), [
      { propKey: "teasers", index: 4, kind: "media" },
      { propKey: "days", path: [3, "teaser"], kind: "number", seedDraft: "5" },
    ]);
    expect((s as any).editor.bindings).toEqual([
      { propKey: "teasers", index: 4, kind: "media" },
      { propKey: "days", path: [3, "teaser"], kind: "number", seedDraft: "5" },
    ]);
  });

  it("refuses, at author time, a seedDraft on a media (or rect) leaf — a path is never typed", () => {
    expect(() => bindProps(src(), [{ propKey: "teasers", index: 0, kind: "media", seedDraft: "C:/x.png" }])).toThrow(/no meaning on a "media" leaf/);
    expect(() => bindPropPath(src(), "rows", [0, "image"], "media", { seedDraft: "x" })).toThrow(/no meaning on a "media" leaf/);
    expect(() => bindProps(src(), [{ propKey: "facecamRegion", kind: "rect", seedDraft: "x" }])).toThrow(/no meaning on a "rect" leaf/);
    // remove-element on a media[] element is honorable; unset-leaf on it is not
    expect(() => bindProps(src(), [{ propKey: "teasers", index: 0, kind: "media", onClear: "remove-element" }])).not.toThrow();
    expect(() => bindProps(src(), [{ propKey: "teasers", index: 0, kind: "media", onClear: "unset-leaf" }])).toThrow(/keyed leaf/);
  });
});

describe("bindProps — companion (a seeded leaf only the media drop fills)", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { bindProps } = require("./layoutConstraint") as typeof import("./layoutConstraint");
  const src = (): MosaicSource => ({ type: "text", layers: [] } as unknown as MosaicSource);

  it("forwards companion: true on a seeded leaf — the drop-calendar date cell", () => {
    const s = bindProps(src(), [
      { propKey: "days", path: [6, "day"], kind: "number", onClear: "remove-element", seedDraft: "14" },
      { propKey: "days", path: [6, "title"], kind: "string" },
      { propKey: "teasers", index: 2, kind: "media" },
      { propKey: "days", path: [6, "teaser"], kind: "number", seedDraft: "3", companion: true },
    ]);
    expect((s as any).editor.bindings[3]).toEqual({ propKey: "days", path: [6, "teaser"], kind: "number", seedDraft: "3", companion: true });
    expect("companion" in (s as any).editor.bindings[0]).toBe(false);
  });

  it("refuses, at author time, a companion without a seed, on a media / rect leaf, or not literally true", () => {
    expect(() => bindProps(src(), [{ propKey: "days", path: [6, "teaser"], kind: "number", companion: true }])).toThrow(/needs a seedDraft/);
    expect(() => bindProps(src(), [{ propKey: "teasers", index: 0, kind: "media", companion: true }])).toThrow(/needs a seedDraft/);
    expect(() => bindProps(src(), [{ propKey: "region", kind: "rect", companion: true }])).toThrow(/needs a seedDraft/);
    expect(() => bindProps(src(), [{ propKey: "days", path: [6, "teaser"], kind: "number", seedDraft: "3", companion: false as never }])).toThrow(/must be true/);
  });
});

describe("stripPropBindings — a host that composes another template's render owns its provenance", () => {
  it("drops binding / bindings on every source (root + children) and keeps the rest of editor", () => {
    const a = bindProp({ type: "lavfi", editor: { label: "headline" } } as unknown as MosaicSource, "headline");
    const b = bindProps({ type: "text", layers: [{}, {}] } as unknown as MosaicSource, [{ propKey: "alias", layer: 1 }]);
    const c = { type: "lavfi", editor: { label: "plain" } } as unknown as MosaicSource;
    const kid = bindProp({ type: "lavfi" } as unknown as MosaicSource, "inner");
    const doc = { sources: [a, b, c], children: { k: { sources: [kid] } } };
    const out = stripPropBindings(doc);
    expect(out).toBe(doc);
    const ed = (x: MosaicSource) => (x as { editor?: Record<string, unknown> }).editor;
    expect(ed(a)).toEqual({ label: "headline" });
    expect(ed(b)).toEqual({});
    expect(ed(c)).toEqual({ label: "plain" });
    expect(ed(kid)).toEqual({});
  });

  it("is a no-op on a document with no editor metadata at all", () => {
    const doc = { sources: [{ type: "lavfi" } as unknown as MosaicSource] };
    expect(() => stripPropBindings(doc)).not.toThrow();
    expect((doc.sources[0] as { editor?: unknown }).editor).toBeUndefined();
  });
});
