import { parseM0StringToRenderFrames, validateM0String } from "@m0saic/dsl";
import { evaluateM0, quantizationSpread } from "@m0saic/dsl-stdlib";
import { checkLayout, engineRecover } from "@m0saic/template-utils";
import type { MosaicDocument, MosaicSource } from "@m0saic/types";
import { emitCollageLayout, emitLatticeM0 } from "./emit";
import { solveCollage } from "./packer/solve";
import type { PlacedSpan } from "./packer/types";

const span = (imageIndex: number, spanClass: string, c0: number, r0: number, cs: number, rs: number): PlacedSpan =>
  ({ imageIndex, span: spanClass, c0, r0, cs, rs } as PlacedSpan);

const seedMix = (): number[] => [
  ...Array.from({ length: 34 }, (_, i) => 1.2 + (i % 7) * 0.1),
  ...Array.from({ length: 14 }, (_, i) => 0.55 + (i % 5) * 0.05),
  1.0,
];

const SEED_OPTS = {
  canvasW: 1920, canvasH: 1280, gutterXPx: 20, gutterYPx: 18, marginPx: 20,
  minCellPx: 100, maxCellPx: 260, aspects: seedMix(), seed: 1,
};

const lavfi = (label: string): MosaicSource =>
  ({ type: "lavfi", color: "#202020", editor: { owner: "template", label } } as unknown as MosaicSource);

function emitSeed() {
  const [best] = solveCollage(SEED_OPTS);
  return {
    best,
    layout: emitCollageLayout({
      placed: best.placed,
      cols: best.candidate.cols,
      rows: best.candidate.rows,
      canvasW: SEED_OPTS.canvasW,
      canvasH: SEED_OPTS.canvasH,
      gutterXPx: SEED_OPTS.gutterXPx,
      gutterYPx: SEED_OPTS.gutterYPx,
      marginPx: SEED_OPTS.marginPx,
      sourceFor: (i) => lavfi(`img:${i}`),
    }),
  };
}

describe("emitLatticeM0 — guillotine decomposition", () => {
  it("a single span emits the trivial frame", () => {
    expect(String(emitLatticeM0([span(0, "1x1", 0, 0, 1, 1)], 1, 1))).toBe("1");
  });

  it("staggered cover decomposes with alternating axes (col groups, band rhythms)", () => {
    // Left group: two stacked 2x1; right: two 1x2 side by side — the row
    // boundary y=1 is crossed on the right, so no full horizontal cut exists.
    const placed = [
      span(0, "2x1", 0, 0, 2, 1),
      span(1, "2x1", 0, 1, 2, 1),
      span(2, "1x2", 2, 0, 1, 2),
      span(3, "1x2", 3, 0, 1, 2),
    ];
    const m0 = String(emitLatticeM0(placed, 4, 2));
    expect(validateM0String(m0).ok).toBe(true);
    const frames = parseM0StringToRenderFrames(m0, 400, 200);
    expect(frames.length).toBe(4);
    const rects = frames.map((f) => `${f.x},${f.y},${f.width},${f.height}`).sort();
    expect(rects).toEqual(["0,0,200,100", "0,100,200,100", "200,0,100,200", "300,0,100,200"].sort());
  });

  it("throws on a non-guillotine pinwheel", () => {
    const pinwheel = [
      span(0, "2x1", 0, 0, 2, 1),
      span(1, "1x2", 2, 0, 1, 2),
      span(2, "2x1", 1, 2, 2, 1),
      span(3, "1x2", 0, 1, 1, 2),
      span(4, "1x1", 1, 1, 1, 1),
    ];
    expect(() => emitLatticeM0(pinwheel, 3, 3)).toThrow(/non-guillotine/);
  });

  it("throws on a non-exact cover", () => {
    expect(() => emitLatticeM0([span(0, "1x1", 0, 0, 1, 1)], 2, 2)).toThrow(/cover area/);
  });

  it("fillers emit as null tiles — no frame, background shows", () => {
    const placed = [
      span(0, "2x1", 0, 0, 2, 1),
      span(1, "1x1", 0, 1, 1, 1),
      span(-1, "1x1", 1, 1, 1, 1), // filler
    ];
    const m0 = String(emitLatticeM0(placed, 2, 2));
    expect(validateM0String(m0).ok).toBe(true);
    expect(m0).toContain("-");
    expect(parseM0StringToRenderFrames(m0, 200, 200).length).toBe(2);
  });
});

describe("emitCollageLayout — the full emission (seed solve)", () => {
  it("stays tiny, ratio, and feasible — the anti-trace", () => {
    const { best, layout } = emitSeed();
    // The hand-traced source m0 was 165,971 chars with a 1920-px basis and a
    // 1766-px feasibility floor. The emitted equivalent:
    expect(String(layout.m0).length).toBeLessThan(2000);
    const ev = evaluateM0(String(layout.m0), { width: 1920, height: 1280 });
    expect(ev.precision.maxSplitAny).toBeLessThanOrEqual(Math.max(best.candidate.cols, best.candidate.rows));
    expect(ev.feasibility.minWidthPx).toBeLessThanOrEqual(best.candidate.cols);
    expect(ev.feasibility.minHeightPx).toBeLessThanOrEqual(best.candidate.rows);
    expect(ev.feasible).toBe(true);
  });

  it("recovers every painted target EXACTLY under the engine floor at the emit canvas", () => {
    const { layout } = emitSeed();
    expect(layout.maxClampPx).toBe(0);
    layout.cells.forEach((cell, li) => {
      const inset = (layout.sources[li] as { placement?: { inset?: { top: number; right: number; bottom: number; left: number } } })
        .placement?.inset;
      const recovered = inset ? engineRecover(cell.raw, inset) : cell.raw;
      expect(recovered).toEqual(cell.target);
    });
  });

  it("pixel-exact gutters and margins between every adjacent pair", () => {
    const { layout } = emitSeed();
    const boxes = layout.cells.map((c) => c.target);
    // Margins: extremes of the painted grid sit exactly marginPx from the canvas.
    expect(Math.min(...boxes.map((b) => b.x))).toBe(20);
    expect(Math.min(...boxes.map((b) => b.y))).toBe(20);
    expect(Math.max(...boxes.map((b) => b.x + b.w))).toBe(1920 - 20);
    expect(Math.max(...boxes.map((b) => b.y + b.h))).toBe(1280 - 20);
    // Gutters: every x-adjacent pair (sharing a band) gaps exactly 20; y → 18.
    for (const a of boxes) {
      for (const b of boxes) {
        if (a === b) continue;
        const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (yOverlap > 2 && b.x > a.x && b.x - (a.x + a.w) >= 0 && b.x - (a.x + a.w) < 30)
          expect(b.x - (a.x + a.w)).toBe(20);
        const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        if (xOverlap > 2 && b.y > a.y && b.y - (a.y + a.h) >= 0 && b.y - (a.y + a.h) < 30)
          expect(b.y - (a.y + a.h)).toBe(18);
      }
    }
  });

  it("null-space accounting closes exactly (gutters + margins are the ONLY null space)", () => {
    const { best, layout } = emitSeed();
    const { cols, rows } = best.candidate;
    const innerW = 1920 - 40;
    const innerH = 1280 - 40;
    // Full unit-grid structural null (Phase 1 identity)…
    const gutterArea =
      (cols - 1) * 20 * innerH + (rows - 1) * 18 * innerW - (cols - 1) * (rows - 1) * 20 * 18;
    const marginArea = 1920 * 1280 - innerW * innerH;
    // …minus the gutter strips ABSORBED by multi-unit spans (a cs×rs span
    // paints over (cs−1) vertical and (rs−1) horizontal interior strips).
    const absorbed = layout.cells.reduce((a, c) => {
      const { cs, rs } = c.span;
      return a + (cs - 1) * 20 * c.target.h + (rs - 1) * 18 * c.target.w - (cs - 1) * (rs - 1) * 20 * 18;
    }, 0);
    const painted = layout.cells.reduce((a, c) => a + c.target.w * c.target.h, 0);
    expect(painted + gutterArea + marginArea - absorbed).toBe(1920 * 1280);
    expect(layout.expectedNullFrac).toBeCloseTo((gutterArea + marginArea - absorbed) / (1920 * 1280), 12);
  });

  it("quantization: sub-px-per-split at the emit canvas, bounded across foreign canvases", () => {
    const { layout } = emitSeed();
    const m0 = String(layout.m0);
    expect(quantizationSpread(m0, 1920, 1280).maxSpreadPx).toBeLessThanOrEqual(1);
    // Foreign canvases only matter for COMPOSED use (the template regenerates
    // per canvas). Nested splits compound remainders; measured worst 2.25px
    // across this sweep (2026-07-11).
    let worst = 0;
    for (const h of [240, 480, 720, 1080, 1440, 2160])
      for (const [aw, ah] of [[16, 9], [9, 16], [1, 1]] as const)
        worst = Math.max(worst, quantizationSpread(m0, Math.round((h * aw) / ah), h).maxSpreadPx);
    expect(worst).toBeLessThanOrEqual(3);
  });

  it("sources are logicalIndex-aligned and every image lands exactly once", () => {
    const { layout } = emitSeed();
    expect(layout.sources.length).toBe(49);
    const labels = layout.cells.map((c, li) => {
      const src = layout.sources[li] as { editor?: { label?: string } };
      expect(src.editor?.label).toBe(`img:${c.imageIndex}`);
      return c.imageIndex;
    });
    expect([...labels].sort((a, b) => a - b)).toEqual(Array.from({ length: 49 }, (_, i) => i));
  });

  it("rejects a sourceFor that pre-sets placement.inset", () => {
    const [best] = solveCollage(SEED_OPTS);
    expect(() =>
      emitCollageLayout({
        placed: best.placed, cols: best.candidate.cols, rows: best.candidate.rows,
        canvasW: 1920, canvasH: 1280, gutterXPx: 20, gutterYPx: 18, marginPx: 20,
        sourceFor: () =>
          ({ type: "lavfi", color: "#000", placement: { inset: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 } } } as unknown as MosaicSource),
      }),
    ).toThrow(/placement\.inset/);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(emitSeed().layout)).toBe(JSON.stringify(emitSeed().layout));
  });
});

describe("the full stack: solve → emit → checkLayout (Phases 1+2+3)", () => {
  it("the emitted collage satisfies its own declared contract", () => {
    const { best, layout } = emitSeed();
    const doc = {
      kind: "mosaic_document", version: 1, assets: {} as never,
      m0: layout.m0, sources: layout.sources,
    } as unknown as MosaicDocument;

    // Per-image planned visible aspect (tight: recovery is exact at emit canvas).
    const constraints = layout.cells.map((c) => ({
      label: `img:${c.imageIndex}`,
      aspect: c.target.w / c.target.h,
      aspectTolerance: 0.02,
    }));
    // Equal-size per span class via the string[] label form.
    const byClass = new Map<string, string[]>();
    for (const c of layout.cells) {
      const key = c.span.span;
      byClass.set(key, [...(byClass.get(key) ?? []), `img:${c.imageIndex}`]);
    }
    const relations = [
      { label: "img-all" as string | string[], lattice: { gutterXPx: 20, gutterYPx: 18 } },
      { label: "img-all" as string | string[], coverage: { expectedNullFrac: layout.expectedNullFrac } },
      ...[...byClass.values()].filter((ls) => ls.length >= 2).map((ls) => ({ label: ls, equal: "size" as const, tolerance: 0.03 })),
    ];
    // "img-all" isn't a real label — use the union of all per-image labels.
    const allLabels = layout.cells.map((c) => `img:${c.imageIndex}`);
    relations[0].label = allLabels;
    relations[1].label = allLabels;

    const res = checkLayout(doc, { canvasW: 1920, canvasH: 1280, constraints, relations });
    expect(res.violations).toEqual([]);
    expect(res.ok).toBe(true);
    expect(Object.keys(res.resolvedLabels).length).toBe(49);
  });

  it("catches a broken emission (perturbed inset) via the lattice relation", () => {
    const { layout } = emitSeed();
    const sources = layout.sources.map((s, i) =>
      i === 3
        ? ({ ...s, placement: { ...(s as { placement?: object }).placement, inset: { top: 0.5, right: 0.5, bottom: 0.01, left: 0.01 } } } as MosaicSource)
        : s,
    );
    const doc = {
      kind: "mosaic_document", version: 1, assets: {} as never, m0: layout.m0, sources,
    } as unknown as MosaicDocument;
    const allLabels = layout.cells.map((c) => `img:${c.imageIndex}`);
    const res = checkLayout(doc, {
      canvasW: 1920, canvasH: 1280,
      relations: [{ label: allLabels, lattice: { gutterXPx: 20, gutterYPx: 18 } }],
    });
    expect(res.ok).toBe(false);
    expect(res.violations.some((v) => v.rule === "lattice-gutter")).toBe(true);
  });
});
