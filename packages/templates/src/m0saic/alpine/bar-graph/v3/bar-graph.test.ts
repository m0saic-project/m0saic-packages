import type { MosaicDocument, MosaicSource } from "@m0saic/types";
import { findFrames } from "@m0saic/dsl-stdlib";
import { bakeDocumentInsets } from "@m0saic/platform";
import { ctxFor, entriesOn, keysOn, renderStatusOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { AlpineBarGraphV2 } from "../v2/bar-graph";
import { AlpineBarGraphV3 } from "./bar-graph";

const D = AlpineBarGraphV3.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await AlpineBarGraphV3.render({ ...D, ...props } as never, ctxFor(AlpineBarGraphV3, { w, h }))) as MosaicDocument;

vnextSuite({
  next: AlpineBarGraphV3,
  prev: AlpineBarGraphV2,
  // The look moved on purpose: every bar ends on its value's gridline, the lines are bands and the plot is its own
  // 5-smooth child (v2's bars ran short of their gridlines) — the "one scale" suite below proves how. The props,
  // handles and chrome are v2's, which the suite still holds.
  parity: false,
  bound: ["barColor", "bars.cornerRadius", "bars.thickness", "domain.maxValue", "domain.minValue", "grid.count", "labels", "preset", "subtitle", "title", "valueLabels.decimals", "valueLabels.suffix", "values"],
  unbound: { "theme.slug": "theme source", "theme.preset": "theme source", "theme.namespace": "theme source", "anim.introFrac": "timing", "bars.gap": "geometry" },
});

describe("@m0saic/alpine/bar-graph/v3 — handles", () => {
  it("a bar carries its value and colour (v1), then its rounding and thickness", async () => {
    expect(entriesOn(await render({}), "bar")).toEqual([
      { propKey: "values", index: 0 },
      { propKey: "barColor" },
      { propKey: "bars.cornerRadius" },
      { propKey: "bars.thickness" },
    ]);
  });

  it("a value label carries its suffix and precision; an axis tick the grid density and the domain", async () => {
    const doc = await render({});
    expect(keysOn(doc, "value-label")).toEqual(["values", "valueLabels.suffix", "valueLabels.decimals"]);
    expect(keysOn(doc, "axis-tick")).toEqual(["grid.count", "domain.minValue", "domain.maxValue"]);
  });

  it("no header: title + subtitle ride the first category label — or the first bar when there are no labels", async () => {
    expect(keysOn(await render({ title: "", subtitle: "" }), "cat-label")).toEqual(["labels", "title", "subtitle"]);
    expect(keysOn(await render({ title: "", subtitle: "", labels: [] }), "bar")).toEqual(["values", "barColor", "bars.cornerRadius", "bars.thickness", "title", "subtitle"]);
  });

  it("no values is an input the chart waits on, never an error", async () => {
    expect(renderStatusOf(await render({ values: [] }))).toBe("incomplete");
  });
});

// ── v3: one scale ────────────────────────────────────────────────────────

type Rect = { x: number; y: number; w: number; h: number };
const labelOf = (s: MosaicSource): string | undefined => (s as { editor?: { label?: string } }).editor?.label;

/** A document's leaves at their painted rects: its inset fibers baked into the m0, frames paired with sources in order. */
function painted(doc: MosaicDocument, width: number, height: number): Array<{ r: Rect; s: MosaicSource }> {
  const { children: _children, ...root } = doc;
  const baked = bakeDocumentInsets(root as MosaicDocument, { w: width, h: height });
  const flat = baked.ok ? baked.doc : (root as MosaicDocument);
  // The rendered leaves, as the engine pairs them with sources: frames (and a root that is itself a leaf) in logical order.
  const frames = findFrames(String(flat.m0), (f) => (f.kind === "frame" || f.kind === "root") && f.logicalIndex != null, { width, height }).sort((a, b) => (a.logicalIndex ?? 0) - (b.logicalIndex ?? 0));
  expect(frames).toHaveLength(flat.sources.length);
  return frames.map((f, i) => ({ r: { x: Math.round(f.x), y: Math.round(f.y), w: Math.round(f.width), h: Math.round(f.height) }, s: flat.sources[i] as MosaicSource }));
}

describe("@m0saic/alpine/bar-graph/v3 — one scale", () => {
  const onTicks = { values: [20, 40, 60, 80, 100], labels: ["a", "b", "c", "d", "e"], domain: { minValue: 0, maxValue: 100 }, grid: { show: true, count: 5 } };

  it.each([["vertical"], ["horizontal"]])("%s: every bar ends on its value's gridline, the bars one thickness", async (orientation) => {
    const doc = await render({ ...onTicks, orientation }, 1280, 960);
    const plot = doc.children?.plot as MosaicDocument;
    expect(plot?.size).toBeDefined();
    const { width, height } = plot.size!;
    const leaves = painted(plot, width, height);
    const bars = leaves.filter((l) => labelOf(l.s) === "bar").map((l) => l.r);
    expect(bars).toHaveLength(5);
    const vertical = orientation === "vertical";
    // Gridlines: the unlabelled full-span line bands (the axes' bands are unlabelled too, but sit on the plot's edges).
    const lines = leaves.filter((l) => !labelOf(l.s) && l.s.type === "lavfi" && (vertical ? l.r.w === width && l.r.y > 0 && l.r.y + l.r.h < height : l.r.h === height && l.r.x > 0 && l.r.x + l.r.w < width)).map((l) => l.r);
    expect(lines).toHaveLength(5);
    const ends = bars.map((b) => (vertical ? b.y : b.x + b.w)).sort((a, b) => a - b);
    // A line is a band, LINE_PAD (5) px either side of the drawn line: the line's first row (column) is inside it.
    const marks = lines.map((g) => (vertical ? g.y + 5 + Math.floor((g.h - 10 - 1) / 2) : g.x + 5 + Math.floor((g.w - 10 - 1) / 2) + 1)).sort((a, b) => a - b);
    expect(ends).toEqual(marks);
    expect(new Set(bars.map((b) => (vertical ? b.w : b.h))).size).toBe(1);
  });

  it("centres each tick label on its line", async () => {
    const doc = await render({ ...onTicks, orientation: "vertical" }, 1280, 960);
    const root = painted(doc, 1280, 960);
    const plotCell = root.find((l) => l.s.type === "mosaic")!.r;
    const plot = doc.children?.plot as MosaicDocument;
    const lines = painted(plot, plot.size!.width, plot.size!.height).filter((l) => !labelOf(l.s) && l.s.type === "lavfi" && l.r.w === plot.size!.width && l.r.y > 0 && l.r.y + l.r.h < plot.size!.height);
    const ticks = root.filter((l) => labelOf(l.s) === "axis-tick").map((l) => l.r.y + l.r.h / 2).sort((a, b) => a - b);
    expect(ticks).toHaveLength(6);
    // The five gridlines (20..100) and the baseline (0), top first.
    const rows = [...lines.map((g) => plotCell.y + g.r.y + 5 + Math.floor((g.r.h - 11) / 2)), plotCell.y + plot.size!.height].sort((a, b) => a - b);
    ticks.forEach((c, i) => expect(Math.abs(c - rows[i])).toBeLessThanOrEqual(1));
  });

  it("keeps the plot's own canvas 5-smooth on both axes", async () => {
    for (const [w, h] of [[1280, 800], [1280, 960], [1080, 1920], [733, 977]]) {
      const plot = (await render({ orientation: "vertical" }, w, h)).children?.plot as MosaicDocument;
      for (const n of [plot.size!.width, plot.size!.height]) {
        let m = n;
        for (const p of [2, 3, 5]) while (m % p === 0) m /= p;
        expect(m).toBe(1);
      }
    }
  });
});
