import { getComplexityMetricsFast, isValidM0String } from "@m0saic/dsl";
import { placeRects } from "@m0saic/dsl-stdlib";
import type { MosaicSource } from "@m0saic/types";
import { placeInsetPieces, type InsetPiece } from "./placeInsetPieces";
import { checkDocGeometry } from "../geometry-contract";

// Minimal distinguishable sources — the helper only carries them through.
const src = (id: string): MosaicSource => ({ type: "lavfi", color: id } as unknown as MosaicSource);
const colorOf = (s: MosaicSource) => (s as unknown as { color: string }).color;
const insetOf = (s: MosaicSource) =>
  (s as unknown as { placement?: { inset?: { top: number; right: number; bottom: number; left: number } } })
    .placement?.inset;

const CHROME: InsetPiece[] = [
  { rect: { x: 0, y: 0, w: 1920, h: 1080, importance: 0 }, source: src("surface") }, // lattice-aligned
  { rect: { x: 140, y: 150, w: 980, h: 92, importance: 1 }, source: src("title") },
  { rect: { x: 142, y: 282, w: 760, h: 34, importance: 1 }, source: src("subtitle") },
  { rect: { x: 1160, y: 384, w: 290, h: 288, importance: 1 }, source: src("kpi") },
  { rect: { x: 387, y: 387, w: 590, h: 590, importance: 1 }, source: src("arc") },
];

const prec = (m0: string) => {
  const p = getComplexityMetricsFast(m0).precision;
  return { x: p.maxSplitX, y: p.maxSplitY };
};

describe("placeInsetPieces", () => {
  it("collapses precision with zero drift and wires recovery insets onto cloned sources", () => {
    const got = placeInsetPieces({ rootW: 1920, rootH: 1080, pieces: CHROME });
    expect(isValidM0String(got.m0)).toBe(true);
    expect(got.pitch).toEqual({ x: 16, y: 9 });
    expect(got.basis).toEqual({ x: 120, y: 120 });
    const p = prec(got.m0);
    expect(p.x).toBeLessThanOrEqual(120);
    expect(p.y).toBeLessThanOrEqual(120);

    // One source per frame, all pieces carried through.
    expect(got.sources.length).toBe(CHROME.length);

    // The full-canvas surface is lattice-aligned → passed through UNTOUCHED
    // (same reference, no placement added).
    const surface = got.sources.find((s) => colorOf(s) === "surface")!;
    expect(surface).toBe(CHROME[0].source);
    expect(insetOf(surface)).toBeUndefined();

    // A coprime piece gets a recovery inset on a CLONE; the caller's source
    // object is never mutated.
    const title = got.sources.find((s) => colorOf(s) === "title")!;
    expect(title).not.toBe(CHROME[1].source);
    expect(insetOf(title)).toBeDefined();
    expect(insetOf(CHROME[1].source)).toBeUndefined();

    // The inset recovers the exact rect under the engine's floor math.
    const cellIdx = CHROME.findIndex((p2) => colorOf(p2.source) === "title");
    expect(cellIdx).toBe(1);
    const inset = insetOf(title)!;
    // Derive the title's quantized cell with the same outward math (pitch 16, 9)
    // and prove the engine's floor recovers the exact rect (140, 150, 980, 92).
    const cx = Math.floor(140 / 16) * 16;
    const cw = Math.ceil((140 + 980) / 16) * 16 - cx;
    const cy = Math.floor(150 / 9) * 9;
    const ch = Math.ceil((150 + 92) / 9) * 9 - cy;
    const l = Math.floor(inset.left * cw);
    const r = Math.floor(inset.right * cw);
    const t = Math.floor(inset.top * ch);
    const b = Math.floor(inset.bottom * ch);
    expect(cx + l).toBe(140);
    expect(cw - l - r).toBe(980);
    expect(cy + t).toBe(150);
    expect(ch - t - b).toBe(92);
  });

  it("orders sources by layer then quantized-cell band order (the placeRects ritual)", () => {
    const got = placeInsetPieces({ rootW: 1920, rootH: 1080, pieces: CHROME });
    // Manual ritual over the QUANTIZED cells.
    const pitch = { x: 16, y: 9 };
    const q = (v: number, p: number, up: boolean) =>
      up ? Math.ceil(v / p) * p : Math.floor(v / p) * p;
    const cells = CHROME.map(({ rect: r }) => {
      const x = q(r.x, pitch.x, false);
      const y = q(r.y, pitch.y, false);
      return {
        x,
        y,
        w: q(r.x + r.w, pitch.x, true) - x,
        h: q(r.y + r.h, pitch.y, true) - y,
        importance: r.importance,
        claimant: "F",
      };
    });
    const placed = placeRects({ rootW: 1920, rootH: 1080, rects: cells });
    const manual: string[] = [];
    for (const lyr of placed.layers) {
      const ordered = [...lyr.rectIndices].sort(
        (a, b) => cells[a].y - cells[b].y || cells[a].x - cells[b].x,
      );
      for (const idx of ordered) manual.push(colorOf(CHROME[idx].source));
    }
    expect(got.m0).toBe(placed.m0);
    expect(got.sources.map(colorOf)).toEqual(manual);
  });

  it("preserves existing placement fields when adding the inset", () => {
    const withAlign = {
      rect: { x: 141, y: 67, w: 129, h: 43 },
      source: { type: "lavfi", color: "c", placement: { hAlign: "left" } } as unknown as MosaicSource,
    };
    const got = placeInsetPieces({ rootW: 1280, rootH: 720, pieces: [withAlign] });
    const placement = (got.sources[0] as unknown as { placement: Record<string, unknown> }).placement;
    expect(placement.hAlign).toBe("left");
    expect(placement.inset).toBeDefined();
  });

  it("throws when a source already carries placement.inset", () => {
    const bad = {
      rect: { x: 141, y: 67, w: 129, h: 43 },
      source: { type: "lavfi", color: "c", placement: { inset: 0.1 } } as unknown as MosaicSource,
    };
    expect(() => placeInsetPieces({ rootW: 1280, rootH: 720, pieces: [bad] })).toThrow(
      /already carries placement\.inset/,
    );
  });

  it("degrades hostile axes to exact by default (a runtime primitive must render anywhere)", () => {
    const got = placeInsetPieces({
      rootW: 997, // prime
      rootH: 720,
      pieces: [{ rect: { x: 141, y: 67, w: 50, h: 300 }, source: src("chip") }],
    });
    expect(got.hostile).toEqual({ x: true, y: false });
    expect(got.pitch.x).toBe(1);
    expect(isValidM0String(got.m0)).toBe(true);
    // onHostile: "throw" is available for generation-time callers.
    expect(() =>
      placeInsetPieces({
        rootW: 997,
        rootH: 720,
        onHostile: "throw",
        pieces: [{ rect: { x: 141, y: 67, w: 50, h: 300 }, source: src("chip") }],
      }),
    ).toThrow(/no usable divisor pitch/);
  });

  it("throws on empty pieces", () => {
    expect(() => placeInsetPieces({ rootW: 100, rootH: 100, pieces: [] })).toThrow(/non-empty/);
  });

  it("emits frame-ordered expectations that round-trip GREEN through checkDocGeometry", () => {
    const got = placeInsetPieces({ rootW: 1920, rootH: 1080, pieces: CHROME });
    // One expectation per source (frame), in the same paint order → zip-checkable.
    expect(got.expectations.length).toBe(got.sources.length);
    expect(got.expectations.every((e) => e.tolerancePx === 0)).toBe(true);
    const doc = { kind: "mosaic_document", version: 1, assets: {}, m0: got.m0, sources: got.sources } as any;
    const res = checkDocGeometry(doc, { canvasW: 1920, canvasH: 1080, expectations: got.expectations });
    // Zero drift: the inset-recovery replay reproduces every intent exactly.
    expect(res.ok).toBe(true);
    expect(res.violations).toEqual([]);
  });

  it("extracts inline-mask bounds into the expectation (mask-scale guard) and stays green", () => {
    const masked: InsetPiece = {
      rect: { x: 200, y: 100, w: 120, h: 120 },
      source: {
        type: "lavfi",
        color: "g",
        mask: { kind: "inline-mask", localPath: "M0 0h24v24H0Z", bounds: { x: 0, y: 0, width: 24, height: 24 } },
      } as unknown as MosaicSource,
    };
    const got = placeInsetPieces({ rootW: 1280, rootH: 720, pieces: [masked] });
    expect(got.expectations[0].maskBounds).toEqual({ width: 24, height: 24 });
    const doc = { kind: "mosaic_document", version: 1, assets: {}, m0: got.m0, sources: got.sources } as any;
    // Recovered box 120×120 (square) ← mask bounds 24×24 (square): 1:1, no distortion.
    expect(checkDocGeometry(doc, { canvasW: 1280, canvasH: 720, expectations: got.expectations }).ok).toBe(true);
  });
});
