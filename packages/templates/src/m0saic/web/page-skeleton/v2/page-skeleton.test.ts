import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, handlesOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { PageSkeleton } from "../v1/page-skeleton";
import { SAMPLE_CAPTURE } from "../v1/sample-capture";
import { fillPropForKind, PageSkeletonV2 } from "./page-skeleton";

const D = PageSkeletonV2.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await PageSkeletonV2.render({ ...D, ...props } as never, ctxFor(PageSkeletonV2, { w, h }))) as MosaicDocument;

const UNBOUND = {
  capture: "the pasted page capture (a rect is edited through its overrides row)",
  overrides: "per-rect rows (a rect carries its own row once it has one)",
  "appearance.uniformRadiusPx": "uniform radius mode",
  "motion.bandWidth": "shimmer mode",
};
const OVERRIDES = [{ i: 1, fill: "#ff0000" }, { i: 2, shape: "pill" }, { i: 9, radiusPx: 4 }, { i: 3, hide: true }];

vnextSuite({
  next: PageSkeletonV2,
  prev: PageSkeleton,
  cases: [
    { name: "still PNG", props: { outputFormat: "png" } },
    { name: "shimmer, horizontal, wide band", props: { motion: { mode: "shimmer", direction: "horizontal", bandWidth: 0.5, minOpacity: 0.4 } } },
    { name: "uniform radius, dark page, own fills", props: { appearance: { bg: "#101014", fill: "#333333", textFill: "#444444", imageFill: "#555555", radiusMode: "uniform", uniformRadiusPx: 12 } } },
    { name: "override rows", props: { overrides: OVERRIDES } },
    { name: "pure rects, no text lines, fill scale, portrait", props: { outputFormat: "png", behavior: { pureRects: true, showTextLines: false, scaleMode: "fill", maxRects: 40 } }, w: 1080, h: 1920 },
    { name: "debug + indices", props: { outputFormat: "png", debugIndices: true } },
    { name: "a bad capture is still the error card", props: { capture: "{not json" } },
  ],
  bound: ["appearance.fill", "appearance.imageFill", "appearance.textFill", "behavior.maxRects", "motion.minOpacity"],
  unbound: UNBOUND,
});

describe("@m0saic/web/page-skeleton/v2 — handles", () => {
  type Entry = { propKey: string; path?: Array<string | number>; kind?: string };
  type Rect = { i: number; k: string; keys: string[]; entries: Entry[]; animated: boolean };
  const rectsOf = (doc: MosaicDocument): Rect[] =>
    (doc.sources as Array<{ lavfi?: string; editor?: { label?: string; bindings?: Entry[]; binding?: Entry } }>).flatMap((s) => {
      const m = /^Capture rect (\d+) · (\w+)$/.exec(s.editor?.label ?? "");
      if (!m) return [];
      const entries = s.editor?.bindings ?? (s.editor?.binding ? [s.editor.binding] : []);
      return [{ i: Number(m[1]), k: m[2], keys: entries.map((e) => e.propKey), entries, animated: typeof s.lavfi === "string" }];
    });

  it("defaults (pulse): a rect carries its kind's fill, the resting opacity if it breathes, and the rect cap (v1 bound nothing)", async () => {
    const rects = rectsOf(await render({}));
    expect(rects.length).toBe(SAMPLE_CAPTURE.rects.length);
    for (const r of rects) {
      expect(r.keys).toEqual([fillPropForKind(r.k as never), ...(r.animated ? ["motion.minOpacity"] : []), "behavior.maxRects"]);
    }
    expect(new Set(rects.map((r) => r.keys[0]))).toEqual(new Set(["appearance.fill", "appearance.textFill", "appearance.imageFill"]));
    expect(rects.some((r) => r.animated)).toBe(true);
  });

  it("a still has no loop, so no rect offers the loop's knobs", async () => {
    const rects = rectsOf(await render({ outputFormat: "png" }));
    expect(rects.flatMap((r) => r.keys).filter((k) => k.startsWith("motion."))).toEqual([]);
  });

  it("the mode-only knobs appear in their mode: band width under shimmer, uniform radius under uniform", async () => {
    const shimmer = rectsOf(await render({ motion: { mode: "shimmer", direction: "diagonal", bandWidth: 0.3, minOpacity: 0.68 } }));
    for (const r of shimmer.filter((x) => x.animated)) expect(r.keys).toEqual(expect.arrayContaining(["motion.minOpacity", "motion.bandWidth"]));
    const uniform = rectsOf(await render({ appearance: { ...(D.appearance as object), radiusMode: "uniform" } }));
    for (const r of uniform) expect(r.keys).toContain("appearance.uniformRadiusPx");
    const captured = rectsOf(await render({}));
    expect(captured.flatMap((r) => r.keys)).not.toContain("appearance.uniformRadiusPx");
    expect(captured.flatMap((r) => r.keys)).not.toContain("motion.bandWidth");
  });

  it("a rect with an overrides row carries ITS row first (fill, radius); the row's fill replaces the kind's, its shape the uniform radius", async () => {
    const doc = await render({ overrides: OVERRIDES, appearance: { ...(D.appearance as object), radiusMode: "uniform" } });
    const byIndex = new Map(rectsOf(doc).map((r) => [r.i, r]));
    expect(byIndex.has(3)).toBe(false); // hidden
    const filled = byIndex.get(1)!;
    expect(filled.entries.slice(0, 2)).toEqual([
      { propKey: "overrides", path: [0, "fill"], kind: "color" },
      { propKey: "overrides", path: [0, "radiusPx"], kind: "number" },
    ]);
    expect(filled.keys).not.toContain(fillPropForKind(filled.k as never));
    expect(filled.keys).toContain("appearance.uniformRadiusPx");
    const pill = byIndex.get(2)!;
    expect(pill.entries[0]).toEqual({ propKey: "overrides", path: [1, "fill"], kind: "color" });
    expect(pill.keys).toContain(fillPropForKind(pill.k as never));
    expect(pill.keys).not.toContain("appearance.uniformRadiusPx");
    expect(byIndex.get(9)!.keys).not.toContain("appearance.uniformRadiusPx");
    expect(byIndex.get(0)!.keys[0]).toBe("appearance.fill"); // no row → no overrides leaf
  });

  it("nothing is rejected in any mode", async () => {
    const ctx = ctxFor(PageSkeletonV2);
    for (const props of [{}, { overrides: OVERRIDES }, { motion: { mode: "shimmer", direction: "vertical", bandWidth: 0.2, minOpacity: 0.5 } }, { outputFormat: "png", debugIndices: true, behavior: { pureRects: true } }]) {
      const doc = await PageSkeletonV2.render({ ...D, ...props } as never, ctx);
      expect(handlesOf(doc, PageSkeletonV2, ctx).rejected).toEqual([]);
    }
  });
});
