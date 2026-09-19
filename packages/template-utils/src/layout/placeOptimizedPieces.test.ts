import { getComplexityMetricsFast, isValidM0String } from "@m0saic/dsl";
import { placeRects } from "@m0saic/dsl-stdlib";
import type { MosaicSource } from "@m0saic/types";
import { placeOptimizedPieces, type OptimizablePiece } from "./placeOptimizedPieces";
import { checkDocGeometry } from "../geometry-contract";

// Minimal distinguishable sources — the helper only carries them through.
const src = (id: string): MosaicSource => ({ type: "lavfi", color: id } as unknown as MosaicSource);

const CHROME: OptimizablePiece[] = [
  { rect: { x: 0, y: 0, w: 1920, h: 1080, importance: 0 }, source: src("surface") },
  { rect: { x: 140, y: 150, w: 980, h: 92, importance: 1 }, source: src("title") },
  { rect: { x: 142, y: 282, w: 760, h: 34, importance: 1 }, source: src("subtitle") },
  { rect: { x: 1160, y: 384, w: 290, h: 288, importance: 1 }, source: src("kpi") },
  { rect: { x: 387, y: 387, w: 590, h: 590, importance: 1 }, source: src("arc") },
];

const prec = (m0: string) => {
  const p = getComplexityMetricsFast(m0).precision;
  return { x: p.maxSplitX, y: p.maxSplitY };
};

describe("placeOptimizedPieces", () => {
  it("with zero drift matches the manual placeRects + source-mapping ritual", () => {
    const got = placeOptimizedPieces({ rootW: 1920, rootH: 1080, pieces: CHROME });

    // Manual ritual (what templates write today).
    const rects = CHROME.map((p) => ({ ...p.rect, claimant: "F" }));
    const placed = placeRects({ rootW: 1920, rootH: 1080, rects });
    const manualSources: MosaicSource[] = [];
    for (const lyr of placed.layers) {
      const ordered = [...lyr.rectIndices].sort(
        (a, b) => rects[a].y - rects[b].y || rects[a].x - rects[b].x,
      );
      for (const idx of ordered) manualSources.push(CHROME[idx].source);
    }

    expect(got.m0).toBe(placed.m0);
    expect(got.sources).toEqual(manualSources);
  });

  it("emits frame-ordered expectations (snapped rects) that round-trip GREEN through checkDocGeometry", () => {
    const got = placeOptimizedPieces({ rootW: 1920, rootH: 1080, driftPercent: 0.5, pieces: CHROME });
    expect(got.expectations.length).toBe(got.sources.length);
    expect(got.expectations.every((e) => e.tolerancePx === 0)).toBe(true);
    const doc = { kind: "mosaic_document", version: 1, assets: {}, m0: got.m0, sources: got.sources } as any;
    // Intent = the snapped rect (design truth); realized frame == snapped exactly.
    const res = checkDocGeometry(doc, { canvasW: 1920, canvasH: 1080, expectations: got.expectations });
    expect(res.ok).toBe(true);
    expect(res.violations).toEqual([]);
  });

  it("emits one source per rendered frame, in m0 order", () => {
    const got = placeOptimizedPieces({ rootW: 1920, rootH: 1080, pieces: CHROME, driftPercent: 0.5 });
    expect(isValidM0String(got.m0)).toBe(true);
    // Every piece is a painted frame → source count equals frame count.
    const frames = (String(got.m0).match(/F|(?<![0-9])1(?![0-9])/g) ?? []).length;
    expect(got.sources.length).toBe(frames);
    expect(got.sources.length).toBe(CHROME.length);
  });

  it("collapses the precision floor within the drift budget", () => {
    const exact = placeOptimizedPieces({ rootW: 1920, rootH: 1080, pieces: CHROME }); // drift 0
    const opt = placeOptimizedPieces({ rootW: 1920, rootH: 1080, pieces: CHROME, driftPercent: 0.5 });
    expect(prec(exact.m0)).toEqual({ x: 1920, y: 1080 });
    expect(opt.basis.x).toBeLessThan(1920);
    expect(opt.basis.y).toBeLessThan(1080);
    expect(opt.m0.length).toBeLessThan(exact.m0.length);
  });

  it("'exact' locks a piece — a coprime locked arc pins the layout to full precision", () => {
    const withLockedArc = CHROME.map((p) =>
      p.source === CHROME[4].source ? { ...p, drift: "exact" as const } : p,
    );
    const opt = placeOptimizedPieces({ rootW: 1920, rootH: 1080, pieces: withLockedArc, driftPercent: 0.5 });
    expect(prec(opt.m0)).toEqual({ x: 1920, y: 1080 });
  });

  it("throws on empty pieces", () => {
    expect(() => placeOptimizedPieces({ rootW: 100, rootH: 100, pieces: [] })).toThrow();
  });
});
