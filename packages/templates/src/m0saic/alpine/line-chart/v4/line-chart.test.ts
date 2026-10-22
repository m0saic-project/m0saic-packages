import type { MosaicDocument, MosaicSource } from "@m0saic/types";
import { findFrames } from "@m0saic/dsl-stdlib";
import { bakeDocumentInsets, flattenMosaicDocument } from "@m0saic/platform";
import { ctxFor, keysOn, renderStatusOf, sourcesOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { AlpineLineChartV3 } from "../v3/line-chart";
import { AlpineLineChartV4 } from "./line-chart";

const D = AlpineLineChartV4.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await AlpineLineChartV4.render({ ...D, ...props } as never, ctxFor(AlpineLineChartV4, { w, h }))) as MosaicDocument;

vnextSuite({
  next: AlpineLineChartV4,
  prev: AlpineLineChartV3,
  catalog: { primitive: true },
  // The look moved on purpose: every gridline, point and tick is a real cell on one exact scale inside a 5-smooth
  // plot child (v3 drew them as masks over the whole plot) — the "one scale" suite below proves how. The props,
  // handles and chrome are v3's, which the suite still holds.
  parity: false,
  bound: ["area.opacity", "domain.maxValue", "domain.minValue", "grid.count", "labels", "lineColor", "preset", "subtitle", "title", "values"],
  unbound: { "theme.slug": "theme source", "theme.preset": "theme source", "theme.namespace": "theme source", "anim.introFrac": "timing" },
});

describe("@m0saic/alpine/line-chart/v4 — handles", () => {
  it("a point is its value's own rect: it carries values[i] and the line colour; an x label carries its label", async () => {
    const doc = await render({});
    // The placer orders the plot's cells by where they sit, not by index: each point carries its own index once, and
    // together they cover every value.
    type Entry = Record<string, unknown>;
    const bindingsOn = (label: string): Entry[][] => sourcesOf(doc).filter((s) => s.editor?.label === label).map((s) => (s.editor?.bindings ?? (s.editor?.binding ? [s.editor.binding] : [])) as Entry[]);
    const values = D.values as number[];
    const points = bindingsOn("point");
    expect(points).toHaveLength(values.length);
    expect(points.map((b) => b[0]).sort((a, b) => Number(a.index) - Number(b.index))).toEqual(values.map((_, i) => ({ propKey: "values", index: i })));
    for (const b of points) expect(b[1]).toEqual({ propKey: "lineColor" });
    const labels = bindingsOn("x-label");
    expect(labels.length).toBeGreaterThan(0);
    for (const b of labels) expect(b).toEqual([{ propKey: "labels", index: expect.any(Number) }]);
    const indices = labels.map((b) => Number(b[0].index));
    expect(new Set(indices).size).toBe(indices.length);
    expect(indices).toContain(0);
  });

  it("a y tick carries the grid density and the domain", async () => {
    expect(keysOn(await render({}), "y-tick-label")).toEqual(["grid.count", "domain.minValue", "domain.maxValue"]);
  });

  it("no header: title + subtitle ride the first x label", async () => {
    expect(keysOn(await render({ title: "", subtitle: "" }), "x-label")).toEqual(["labels", "title", "subtitle"]);
  });

  it("no values is an input the chart waits on, never an error", async () => {
    expect(renderStatusOf(await render({ values: [] }))).toBe("incomplete");
  });
});

// ── v4: every mark a real cell, one scale ──────────────────────────────

const labelOf = (s: MosaicSource): string | undefined => (s as { editor?: { label?: string } }).editor?.label;

/** A document's leaves at their painted rects: insets baked, frames paired with sources in logical order. */
function painted(doc: MosaicDocument, width: number, height: number): Array<{ r: { x: number; y: number; w: number; h: number }; s: MosaicSource }> {
  const { children: _children, ...root } = doc;
  const baked = bakeDocumentInsets(root as MosaicDocument, { w: width, h: height });
  const flat = baked.ok ? baked.doc : (root as MosaicDocument);
  const frames = findFrames(String(flat.m0), (f) => (f.kind === "frame" || f.kind === "root") && f.logicalIndex != null, { width, height }).sort((a, b) => (a.logicalIndex ?? 0) - (b.logicalIndex ?? 0));
  expect(frames).toHaveLength(flat.sources.length);
  return frames.map((f, i) => ({ r: { x: Math.round(f.x), y: Math.round(f.y), w: Math.round(f.width), h: Math.round(f.height) }, s: flat.sources[i] as MosaicSource }));
}

describe("@m0saic/alpine/line-chart/v4 — one scale", () => {
  const onTicks = { values: [20, 40, 60, 80, 100], labels: ["a", "b", "c", "d", "e"], domain: { minValue: 0, maxValue: 100 }, grid: { show: true, count: 5 } };

  it("draws every point as a real cell centred on its value's gridline row", async () => {
    const doc = await render(onTicks, 1280, 960);
    const plot = doc.children?.plot as MosaicDocument;
    const { width, height } = plot.size!;
    const leaves = painted(plot, width, height);
    const dots = leaves.filter((l) => labelOf(l.s) === "point").map((l) => l.r.y + (l.r.h - 1) / 2);
    expect(dots).toHaveLength(5);
    // Row bands (gridlines and the axis): the band's line sits LINE_PAD (5) px in, `hExpr` thick.
    const rows = leaves
      .filter((l) => l.s.type === "lavfi" && (l.s as { size?: { hExpr?: string } }).size?.hExpr && l.r.w === width)
      .map((l) => l.r.y + 5 + Math.floor((Number((l.s as { size: { hExpr: string } }).size.hExpr) - 1) / 2));
    for (const d of dots) expect(rows.some((r) => Math.abs(r - d) <= 0.5)).toBe(true);
    // The curve and its fill are the only plot-filling layers (and the curtain while animating).
    expect(leaves.filter((l) => l.r.w === width && l.r.h === height).length).toBeLessThanOrEqual(3);
  });

  it("keeps the plot 5-smooth and readable when drawn scaled into a smaller cell", async () => {
    for (const [w, h] of [[1280, 800], [1280, 960], [1080, 1920], [733, 977]]) {
      const doc = await render({}, w, h);
      const plot = doc.children?.plot as MosaicDocument;
      for (const n of [plot.size!.width, plot.size!.height]) {
        let m = n;
        for (const p of [2, 3, 5]) while (m % p === 0) m /= p;
        expect(m).toBe(1);
      }
      // A hostile canvas (733 is prime) places exactly on that axis, a per-pixel lattice that only parses at its own
      // size; the plan canvases also parse scaled (the film draws the chart at 0.675 of its 1280x960).
      const scales = w === 733 ? [1] : [1, 0.675, 0.45];
      for (const k of scales) {
        expect(flattenMosaicDocument({ file: doc, width: Math.round(w * k), height: Math.round(h * k), resolveRef: () => null }).ok).toBe(true);
      }
    }
  });
});
