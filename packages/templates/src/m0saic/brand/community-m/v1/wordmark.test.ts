import { isValidM0String } from "@m0saic/dsl";
import { WORDMARK_BOUNDS } from "@m0saic/template-utils";
import { WORDMARK_ROW_SHARE, wordmarkBox, wordmarkRowDoc } from "./wordmark";

const ASPECT = WORDMARK_BOUNDS.width / WORDMARK_BOUNDS.height;

describe("wordmarkBox", () => {
  it("fills the row share at the wordmark's aspect, centred, whole px", () => {
    for (const [rowW, rowH] of [[3840, 96], [1920, 48], [1280, 32], [640, 20]] as const) {
      const b = wordmarkBox(rowW, rowH);
      expect(b.h).toBe(Math.round(rowH * WORDMARK_ROW_SHARE));
      expect(b.w / b.h).toBeCloseTo(ASPECT, 1);
      expect(b.x + b.w).toBeLessThanOrEqual(rowW);
      expect(b.y + b.h).toBeLessThanOrEqual(rowH);
      expect(Math.abs(b.x - (rowW - b.x - b.w))).toBeLessThanOrEqual(1);
      for (const v of Object.values(b)) expect(Number.isInteger(v)).toBe(true);
    }
    // 0.82 of a 96 px row at 1213:283 (founder 2026-09-16: "a tad larger" than the 0.7 / 67 px it shipped at).
    expect(wordmarkBox(3840, 96)).toEqual({ x: 1750, y: 8, w: 339, h: 79 });
  });

  it("caps the width on a narrow row and keeps the aspect", () => {
    const b = wordmarkBox(100, 96);
    expect(b.w).toBe(100);
    expect(b.h).toBe(Math.round(100 / ASPECT));
    expect(b.y + b.h).toBeLessThanOrEqual(96);
  });
});

describe("wordmarkRowDoc", () => {
  it("lays the two halves on one exact rect — letters in the ink, the 0 over them in the accent", () => {
    const doc = wordmarkRowDoc({ rowW: 3840, rowH: 96, fps: 30, durationMs: 2500, ink: "#F4F4F5", accent: "#f97316", canvasColor: "#0E1220" });
    expect(isValidM0String(doc.m0)).toBe(true);
    expect(doc.size).toEqual({ width: 3840, height: 96 });
    expect(doc.durationMs).toBe(2500);
    expect(doc.sources.length).toBe(2);
    const masks = doc.sources.map((s) => (s as { mask?: { kind: string; bounds: { width: number; height: number } } }).mask);
    for (const m of masks) {
      expect(m?.kind).toBe("inline-mask");
      expect(m?.bounds).toEqual({ x: 0, y: 0, width: WORDMARK_BOUNDS.width, height: WORDMARK_BOUNDS.height });
    }
    const colors = doc.sources.map((s) => (s as { color?: string }).color);
    expect(colors).toEqual(["#F4F4F5", "#f97316"]);
  });

  it("is deterministic", () => {
    const o = { rowW: 1920, rowH: 48, fps: 30, durationMs: 1000, ink: "#fff", accent: "#f97316", canvasColor: "#000" };
    expect(JSON.stringify(wordmarkRowDoc(o))).toBe(JSON.stringify(wordmarkRowDoc(o)));
  });
});
