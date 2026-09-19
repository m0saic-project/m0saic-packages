import type { MosaicDocument } from "@m0saic/types";
import { getFrameCount, parseM0StringToRenderFrames } from "@m0saic/dsl";
import {
  buildPaddedInstanceChild,
  buildPagePatternChild,
  planPageGrid,
  type PageGridKnobs,
  type PageGridPlan,
} from "./pageGrid";
import { buildTextChild } from "./content";

function makeInstance(plan: PageGridPlan): MosaicDocument {
  const art = buildTextChild({
    text: "yourbrand.com",
    color: "#ffffff",
    w: plan.contentW,
    h: plan.contentH,
  });
  return buildPaddedInstanceChild({ plan, art });
}

const BASE: PageGridKnobs = {
  canvasW: 1920,
  canvasH: 1080,
  contentW: 300,
  contentH: 75,
  angleDeg: -30,
  tileGapRatio: 0.08,
  stagger: true,
  maxTiles: 24,
};

describe("planPageGrid", () => {
  test("cell envelope closed-form: 0°, 90°, −30°", () => {
    const flat = planPageGrid({ ...BASE, angleDeg: 0, stagger: false });
    expect(flat.cellW).toBe(300);
    expect(flat.cellH).toBe(75);

    // The cell holds the content BOTH unrotated and rotated: at 90° the
    // pre-rotation box still needs the full 300 width, and the rotated
    // box needs 300 height → a 300×300 envelope.
    const quarter = planPageGrid({ ...BASE, angleDeg: 90, stagger: false });
    expect(quarter.cellW).toBe(300);
    expect(quarter.cellH).toBe(300);

    // −30°: rotated bbox width (≈298) is NARROWER than the content (300)
    // — the envelope keeps the content width; height takes the bbox.
    const rad = (30 * Math.PI) / 180;
    const tilted = planPageGrid(BASE);
    expect(tilted.cellW).toBe(Math.ceil(Math.max(300, 300 * Math.cos(rad) + 75 * Math.sin(rad))));
    expect(tilted.cellH).toBe(Math.ceil(300 * Math.sin(rad) + 75 * Math.cos(rad)));
  });

  test("envelope holds the content in BOTH rotation phases, all angles", () => {
    // Regression (rotation clip): the cell must be ≥ the content box
    // (pre-rotation draw) AND ≥ the rotated bbox (post-rotation), else
    // the in-place rotate clips.
    for (const angleDeg of [-90, -60, -30, -15, 0, 15, 30, 45, 60, 75, 90]) {
      const p = planPageGrid({ ...BASE, contentW: 300, contentH: 40, angleDeg });
      const rad = (angleDeg * Math.PI) / 180;
      const bboxW = p.contentW * Math.abs(Math.cos(rad)) + p.contentH * Math.abs(Math.sin(rad));
      const bboxH = p.contentW * Math.abs(Math.sin(rad)) + p.contentH * Math.abs(Math.cos(rad));
      expect(p.cellW).toBeGreaterThanOrEqual(p.contentW);
      expect(p.cellH).toBeGreaterThanOrEqual(p.contentH);
      expect(p.cellW).toBeGreaterThanOrEqual(Math.floor(bboxW));
      expect(p.cellH).toBeGreaterThanOrEqual(Math.floor(bboxH));
    }
  });

  test("respects maxTiles via a converging gap budget", () => {
    const p = planPageGrid({ ...BASE, contentW: 100, contentH: 25, maxTiles: 6, tileGapRatio: 0.01 });
    expect(p.cells.length).toBeLessThanOrEqual(6);
    expect(p.rows * p.cols).toBeLessThanOrEqual(6);
  });

  test("gap 0 budget loop still terminates", () => {
    const p = planPageGrid({ ...BASE, contentW: 50, contentH: 50, tileGapRatio: 0, maxTiles: 4 });
    expect(p.cells.length).toBeLessThanOrEqual(4);
  });

  test("all cells stay within the canvas; stagger drops overflow cells", () => {
    const p = planPageGrid(BASE);
    for (const c of p.cells) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(1920);
      expect(c.y + c.h).toBeLessThanOrEqual(1080);
    }
    const unstaggered = planPageGrid({ ...BASE, stagger: false });
    expect(p.cells.length).toBeLessThanOrEqual(unstaggered.cells.length);
  });

  test("oversized content shrinks (aspect preserved) so the rotated bbox fits", () => {
    const p = planPageGrid({ ...BASE, contentW: 4000, contentH: 1000, angleDeg: -45 });
    expect(p.cellW).toBeLessThanOrEqual(1920);
    expect(p.cellH).toBeLessThanOrEqual(1080);
    expect(p.contentW / p.contentH).toBeCloseTo(4, 1);
    expect(p.cells.length).toBeGreaterThanOrEqual(1);
  });

  test("determinism", () => {
    expect(planPageGrid(BASE)).toEqual(planPageGrid(BASE));
  });
});

describe("buildPaddedInstanceChild", () => {
  test("pads the art to CELL dims as real geometry (centered frame)", () => {
    const plan = planPageGrid(BASE);
    const instance = makeInstance(plan);
    expect(instance.size).toEqual({ width: plan.cellW, height: plan.cellH });
    // one frame = the centered art rect at content dims
    expect(getFrameCount(String(instance.m0))).toBe(1);
    const [frame] = parseM0StringToRenderFrames(String(instance.m0), plan.cellW, plan.cellH);
    expect(frame!.width).toBe(plan.contentW);
    expect(frame!.height).toBe(plan.contentH);
    expect(Math.abs(frame!.x - (plan.cellW - plan.contentW) / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(frame!.y - (plan.cellH - plan.contentH) / 2)).toBeLessThanOrEqual(1);
    expect(instance.children?.wm_art).toBeDefined();
  });

  test("angle 0 (cell == content) skips the wrapper", () => {
    const flat = planPageGrid({ ...BASE, angleDeg: 0 });
    const art = buildTextChild({ text: "yourbrand.com", color: "#ffffff", w: flat.contentW, h: flat.contentH });
    expect(buildPaddedInstanceChild({ plan: flat, art })).toBe(art);
  });
});

describe("buildPagePatternChild", () => {
  const plan = planPageGrid(BASE);
  const instance = makeInstance(plan);

  test("one shared cell-sized instance child, one mosaic source per cell with rotate and NO inset", () => {
    const child = buildPagePatternChild({
      canvasW: 1920,
      canvasH: 1080,
      plan,
      angleDeg: -30,
      instance,
    });
    expect(child.size).toEqual({ width: 1920, height: 1080 });
    expect(getFrameCount(String(child.m0))).toBe(plan.cells.length);
    expect(child.sources).toHaveLength(plan.cells.length);
    expect(child.children?.wm_content).toBe(instance);
    for (const s of child.sources) {
      expect(s.type).toBe("mosaic");
      expect((s as { ref?: string }).ref).toBe("wm_content");
      expect((s as { effects?: { rotate?: number } }).effects?.rotate).toBe(-30);
      // inset/padding would shrink the pre-rotation buffer and re-clip
      expect((s as { placement?: { inset?: unknown; padding?: unknown } }).placement).toEqual({ fit: "contain" });
    }
  });

  test("rejects an instance child whose size mismatches the cell", () => {
    const wrongSize = { ...instance, size: { width: plan.cellW - 1, height: plan.cellH } };
    expect(() =>
      buildPagePatternChild({ canvasW: 1920, canvasH: 1080, plan, angleDeg: -30, instance: wrongSize }),
    ).toThrow(/must declare size/);
  });

  test("sources bind to frames in paint order (y then x)", () => {
    const child = buildPagePatternChild({
      canvasW: 1920,
      canvasH: 1080,
      plan,
      angleDeg: -30,
      instance,
    }) as MosaicDocument;
    const frames = parseM0StringToRenderFrames(String(child.m0), 1920, 1080);
    expect(frames).toHaveLength(plan.cells.length);
    // every planned cell appears exactly once among the parsed frames
    const key = (r: { x: number; y: number }) => `${r.x},${r.y}`;
    const parsed = new Set(frames.map((f) => key(f)));
    for (const c of plan.cells) expect(parsed.has(key(c))).toBe(true);
  });

  test("angle 0 emits no effects block", () => {
    const flat = planPageGrid({ ...BASE, angleDeg: 0 });
    const child = buildPagePatternChild({
      canvasW: 1920,
      canvasH: 1080,
      plan: flat,
      angleDeg: 0,
      instance: makeInstance(flat),
    });
    for (const s of child.sources) {
      expect((s as { effects?: unknown }).effects).toBeUndefined();
    }
  });

  test("empty plan throws", () => {
    expect(() =>
      buildPagePatternChild({
        canvasW: 1920,
        canvasH: 1080,
        plan: { ...plan, cells: [] },
        angleDeg: -30,
        instance,
      }),
    ).toThrow(/no cells/);
  });
});
