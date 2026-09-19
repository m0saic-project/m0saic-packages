import { parseM0StringToRenderFrames, getFrameCount } from "@m0saic/dsl";
import {
  MIN_STAMP_PX,
  buildStampM0,
  resolveStampRect,
  type StampPosition,
} from "./stampLayout";

const W = 1920;
const H = 1080;

describe("resolveStampRect", () => {
  const base = {
    canvasW: W,
    canvasH: H,
    sizeRatio: 0.18,
    sizeBasis: "min" as const,
    marginRatio: 0.022,
    contentAspect: 2, // wide wordmark, w:h = 2:1
  };
  // min(W,H)=1080 → w = round(0.18*1080) = 194, h = 97, margin = round(0.022*1080) = 24
  const w = 194;
  const h = 97;
  const m = 24;

  test("nine-position matrix on 1920x1080", () => {
    const cases: Array<[StampPosition, number, number]> = [
      ["top-left", m, m],
      ["top-center", Math.floor((W - w) / 2), m],
      ["top-right", W - w - m, m],
      ["center-left", m, Math.floor((H - h) / 2)],
      ["center", Math.floor((W - w) / 2), Math.floor((H - h) / 2)],
      ["center-right", W - w - m, Math.floor((H - h) / 2)],
      ["bottom-left", m, H - h - m],
      ["bottom-center", Math.floor((W - w) / 2), H - h - m],
      ["bottom-right", W - w - m, H - h - m],
    ];
    for (const [position, x, y] of cases) {
      expect(resolveStampRect({ ...base, position })).toEqual({ x, y, w, h });
    }
  });

  test("portrait canvas (1080x1920) uses min basis and bottom-right anchors", () => {
    const r = resolveStampRect({ ...base, canvasW: 1080, canvasH: 1920, position: "bottom-right" });
    // min = 1080 → same w/h/margin as landscape
    expect(r).toEqual({ x: 1080 - w - m, y: 1920 - h - m, w, h });
  });

  test("basis width / height variants", () => {
    const rw = resolveStampRect({ ...base, position: "top-left", sizeBasis: "width" });
    expect(rw.w).toBe(Math.round(0.18 * W)); // 346
    expect(rw.h).toBe(Math.round(rw.w / 2));
    const rh = resolveStampRect({ ...base, position: "top-left", sizeBasis: "height" });
    expect(rh.w).toBe(Math.round(0.18 * H)); // 194
  });

  test("aspect drives height; tall content shrinks to vertical room", () => {
    // aspect 0.1 (very tall): w=194 → h=1940 > availH → clamp h, re-derive w
    const r = resolveStampRect({ ...base, position: "center", contentAspect: 0.1 });
    expect(r.h).toBe(H - 2 * m);
    expect(r.w).toBe(Math.round(r.h * 0.1));
  });

  test("tiny canvas clamps margin instead of throwing", () => {
    const r = resolveStampRect({
      ...base,
      canvasW: 30,
      canvasH: 30,
      position: "bottom-right",
      marginRatio: 0.25, // would leave 30-2*8=14 < MIN_STAMP_PX
    });
    expect(r.w).toBeGreaterThanOrEqual(Math.min(MIN_STAMP_PX, 30));
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(30);
    expect(r.y + r.h).toBeLessThanOrEqual(30);
  });

  test("rejects bad inputs", () => {
    expect(() => resolveStampRect({ ...base, position: "center", canvasW: 0 })).toThrow(/canvasW/);
    expect(() => resolveStampRect({ ...base, position: "center", sizeRatio: 0 })).toThrow(/sizeRatio/);
    expect(() => resolveStampRect({ ...base, position: "center", contentAspect: 0 })).toThrow(/contentAspect/);
    expect(() => resolveStampRect({ ...base, position: "center", contentAspect: Infinity })).toThrow(/contentAspect/);
    expect(() => resolveStampRect({ ...base, position: "center", marginRatio: -1 })).toThrow(/marginRatio/);
  });

  test("byte-determinism", () => {
    const a = resolveStampRect({ ...base, position: "bottom-right" });
    const b = resolveStampRect({ ...base, position: "bottom-right" });
    expect(a).toEqual(b);
  });
});

describe("buildStampM0", () => {
  const rect = { x: 1702, y: 959, w: 194, h: 97 };

  test("frame count = overlayCount + 1 (base F + one cell per layer)", () => {
    for (const overlayCount of [1, 2]) {
      const { m0 } = buildStampM0({ canvasW: W, canvasH: H, rect, overlayCount });
      expect(getFrameCount(String(m0))).toBe(overlayCount + 1);
    }
  });

  test("cell frame lands exactly on the rect", () => {
    const { m0, cellW, cellH } = buildStampM0({ canvasW: W, canvasH: H, rect, overlayCount: 1 });
    expect(cellW).toBe(rect.w);
    expect(cellH).toBe(rect.h);
    const frames = parseM0StringToRenderFrames(String(m0), W, H);
    // frames: [base F (full canvas), stamp cell]
    const cell = frames.find((f) => f.width === rect.w && f.height === rect.h);
    expect(cell).toBeDefined();
    expect(cell!.x).toBe(rect.x);
    expect(cell!.y).toBe(rect.y);
  });

  test("byte-determinism", () => {
    const a = buildStampM0({ canvasW: W, canvasH: H, rect, overlayCount: 2 });
    const b = buildStampM0({ canvasW: W, canvasH: H, rect, overlayCount: 2 });
    expect(String(a.m0)).toBe(String(b.m0));
  });

  test("rejects non-positive overlayCount", () => {
    expect(() => buildStampM0({ canvasW: W, canvasH: H, rect, overlayCount: 0 })).toThrow(/overlayCount/);
  });
});
