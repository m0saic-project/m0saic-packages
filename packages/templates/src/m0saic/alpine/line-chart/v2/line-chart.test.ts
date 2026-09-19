import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete, getComplexityMetricsFast } from "@m0saic/dsl";
import { AlpineLineChartV2 } from "./line-chart";
import { ALPINE_PRESETS } from "../../_shared/alpine-theme";

const W = 1280;
const H = 800;

function makeCtx(width = W, height = H, durationMs = 2000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width, height, fps: 30, durationMs },
    output: { width, height, fps: 30, durationMs, workspaceDir: "/tmp/alpine-line-chart-v2" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const render = async (props: Record<string, unknown>, w = W, h = H) =>
  (await AlpineLineChartV2.render(props as never, makeCtx(w, h))) as MosaicDocument;

const D = AlpineLineChartV2.defaultProps as Record<string, unknown>;

const srcs = (doc: MosaicDocument) => (doc.sources ?? []) as MosaicSource[];
const isText = (s: MosaicSource) => (s as { type?: string }).type === "text";
const isLabelText = (s: MosaicSource) => isText(s) && ((s as { layers?: unknown[] }).layers?.length ?? 0) === 1;
const isMask = (s: MosaicSource) => !!(s as { mask?: unknown }).mask;
const isCurtain = (s: MosaicSource) => (s as { overlay?: { xExpr?: string } }).overlay?.xExpr != null;

function expectFramesMatchSources(doc: MosaicDocument, w = W, h = H): void {
  expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  const parsed = parseM0StringComplete(doc.m0 as unknown as string, w, h);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe((doc.sources ?? []).length);
  expect((doc as { children?: unknown }).children).toBeUndefined();
}

describe("AlpineLineChartV2 — metadata", () => {
  it("is the registered v2 primitive (not deprecated)", () => {
    expect(AlpineLineChartV2.id).toBe("@m0saic/alpine/line-chart/v2");
    expect(AlpineLineChartV2.version).toBe(2);
    expect(AlpineLineChartV2.primitive).toBe(true);
    expect((AlpineLineChartV2 as { deprecated?: unknown }).deprecated).toBeUndefined();
    expect(AlpineLineChartV2.tags).toEqual(expect.arrayContaining(["alpine", "line-chart", "data-viz"]));
  });

  it("no pinned lineColor default → falls through to the theme primary", async () => {
    expect(D.lineColor).toBeUndefined();
    const doc = await render({ ...D });
    expect(JSON.stringify(doc)).toContain(ALPINE_PRESETS.light.primary);
  });
});

describe("AlpineLineChartV2 — RATIO precision (the v2 win)", () => {
  const precAt = async (w: number, h: number) => {
    const d = await render({ ...D, anim: { introFrac: 0.7, ease: "easeOut", reduceMotion: true } }, w, h);
    const m = getComplexityMetricsFast(d.m0 as unknown as string);
    return { x: m.precision.maxSplitX, y: m.precision.maxSplitY };
  };
  it("plot marks no longer pin the canvas: precision flat across a 2× sweep", async () => {
    const lo = await precAt(1280, 800);
    const hi = await precAt(2560, 1600);
    expect(hi.x).toBe(lo.x); // v1 roughly doubled; ratio holds flat
    expect(hi.y).toBe(lo.y);
    expect(lo.x).toBeLessThanOrEqual(160);
    expect(lo.y).toBeLessThanOrEqual(160);
  });
});

describe("AlpineLineChartV2 — theming", () => {
  const themedCtx = (tokens: Record<string, unknown>): MosaicEngineContext =>
    ({ mode: "render", target: { width: W, height: H, fps: 30, durationMs: 2000 }, output: { width: W, height: H, fps: 30, durationMs: 2000 }, media: {}, upstreamData: { theme: tokens } } as unknown as MosaicEngineContext);

  it("a producer theme recolors the card + line; unthemed default does not carry those tokens", async () => {
    const plain = JSON.stringify(await render({ ...D }));
    expect(plain).not.toContain("#101820");
    const themed = JSON.stringify((await AlpineLineChartV2.render(D as never, themedCtx({ surface: "#101820", accent: "#00FFCC" }))) as MosaicDocument);
    expect(themed).toContain("#101820");
    expect(themed).toContain("#00FFCC");
  });

  it("an explicit lineColor still wins over the producer accent", async () => {
    const themed = JSON.stringify((await AlpineLineChartV2.render({ ...D, lineColor: "#123456" } as never, themedCtx({ accent: "#00FFCC" }))) as MosaicDocument);
    expect(themed).toContain("#123456");
    expect(themed).not.toContain("#00FFCC");
  });
});

describe("AlpineLineChartV2 — render shape", () => {
  it("renders a valid m0 document; frames match sources (no children)", async () => {
    const doc = await render({ ...D });
    expectFramesMatchSources(doc);
    expect(doc.backgroundColor).toBeDefined();
    expect(srcs(doc).some(isMask)).toBe(true);
    expect(srcs(doc).some(isLabelText)).toBe(true);
  });

  for (const curve of ["smooth", "linear", "stepped"] as const) {
    it(`renders a valid document for curve=${curve}`, async () => {
      expectFramesMatchSources(await render({ ...D, curve }));
    });
  }

  it("animated default carries the curtain wipe (overlay.xExpr); reduceMotion has none", async () => {
    const animated = await render({ ...D });
    expect(srcs(animated).some(isCurtain)).toBe(true);
    const still = await render({ ...D, anim: { introFrac: 0.7, ease: "easeOut", reduceMotion: true } });
    expect(srcs(still).some(isCurtain)).toBe(false);
    expectFramesMatchSources(still);
  });

  it("is deterministic — identical inputs yield byte-identical m0", async () => {
    expect((await render({ ...D })).m0).toBe((await render({ ...D })).m0);
  });
});

describe("AlpineLineChartV2 — tile efficiency (marks combined into single masks)", () => {
  it("tile count stays roughly FLAT as point count grows (N points add ~0 tiles)", async () => {
    const few = srcs(await render({ values: [1, 2, 3, 4, 5] })).length;
    const many = srcs(await render({ values: Array.from({ length: 40 }, (_, i) => i + 1) })).length;
    expect(many - few).toBeLessThanOrEqual(4);
  });
});

describe("AlpineLineChartV2 — labels", () => {
  it("decimates x-labels so dense labels never overlap (kept < provided)", async () => {
    const N = 24;
    const doc = await render({
      values: Array.from({ length: N }, (_, i) => i + 1),
      labels: Array.from({ length: N }, (_, i) => `Month${i}`),
      grid: { show: true, count: 4 },
    });
    expectFramesMatchSources(doc);
    const labelTexts = srcs(doc).filter(isLabelText).length;
    expect(labelTexts).toBeLessThan(N);
  });

  it("shows every label when they comfortably fit", async () => {
    const doc = await render({ values: [3, 6, 4, 8], labels: ["A", "B", "C", "D"], grid: { show: false, count: 4 } });
    expect(srcs(doc).filter(isLabelText).length).toBe(4);
  });
});

describe("AlpineLineChartV2 — edge cases", () => {
  it("clamps the smooth-curve overshoot for a run of zeros (valid, no crash)", async () => {
    expectFramesMatchSources(await render({ values: [12, 19, 15, 25, 22, 30, 28, 36, 0, 0, 0, 0, 0, 0, 0, 0] }));
  });

  it("handles all-zero, negatives, flat, single, and 2-point series", async () => {
    for (const v of [[0, 0, 0, 0], [-3, 4, -1, 6], [5, 5, 5, 5], [7], [4, 9]]) {
      expectFramesMatchSources(await render({ values: v }));
    }
  });

  it("toggling area / points / grid / labels stays valid", async () => {
    expectFramesMatchSources(await render({ ...D, area: { show: false } }));
    expectFramesMatchSources(await render({ ...D, points: { show: false } }));
    expectFramesMatchSources(await render({ ...D, grid: { show: false, count: 4 } }));
    expectFramesMatchSources(await render({ values: [3, 6, 4, 8] }));
  });

  it("explicit domain group (min/max) overrides the auto axis", async () => {
    const auto = await render({ ...D });
    const fixed = await render({ ...D, domain: { minValue: 0, maxValue: 100 } });
    expectFramesMatchSources(fixed);
    expect(fixed.m0).not.toBe(auto.m0);
  });

  it("rejects empty values with an error mosaic, not a throw", async () => {
    const doc = await render({ values: [] });
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  });
});

describe("AlpineLineChartV2 — first-open cover", () => {
  const ctxCover = (): MosaicEngineContext =>
    ({
      mode: "render" as const,
      target: { width: 1280, height: 708, fps: 30, durationMs: 2000 },
      output: { width: 1280, height: 708, fps: 30, durationMs: 2000, workspaceDir: "/tmp/alpine-line-chart" },
      media: {},
    }) as unknown as MosaicEngineContext;

  it("declares a branded cover: pane + inlined default render, self-contained", async () => {
    expect(typeof AlpineLineChartV2.renderCover).toBe("function");
    const doc = (await AlpineLineChartV2.renderCover!({} as never, ctxCover())) as MosaicDocument;
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    const s = JSON.stringify(doc.sources);
    expect(s).toContain("Line Chart");
    // Band variant: no conversation pane, just brand + title.
    expect(s).not.toContain("START HERE");
    // Inline-flat hero (gate-15/21 keeper): no nested cover child refs; the
    // brand M is the only media source and rides THIS doc's manifest.
    expect(s).not.toContain('"type":"mosaic","ref":"cover');
    const assetIds = new Set(Object.keys(doc.assets ?? {}));
    const media = ((doc.sources ?? []) as Array<{ type?: string; assetId?: string }>).filter(
      (x) => x.type === "media",
    );
    expect(media.every((x) => assetIds.has(String(x.assetId)))).toBe(true);
  });

  it("cover is deterministic", async () => {
    const a = (await AlpineLineChartV2.renderCover!({} as never, ctxCover())) as MosaicDocument;
    const b = (await AlpineLineChartV2.renderCover!({} as never, ctxCover())) as MosaicDocument;
    expect(a.m0).toBe(b.m0);
  });
});

describe("AlpineLineChartV2 — x-tick position lock + centered labels (gate 8, founder ruling)", () => {
  const ctxT = (w = 1280, h = 708): MosaicEngineContext =>
    ({
      mode: "render" as const,
      target: { width: w, height: h, fps: 30, durationMs: 2000 },
      output: { width: w, height: h, fps: 30, durationMs: 2000, workspaceDir: "/tmp/alpine-line-chart" },
      media: {},
    }) as unknown as MosaicEngineContext;

  it("contract (x-tick span-frac lock) passes at hostile canvases", async () => {
    for (const [w, h] of [[1280, 708], [1001, 733], [720, 1280], [640, 360], [1920, 480], [607, 401], [733, 977]] as Array<[number, number]>) {
      const doc = (await AlpineLineChartV2.render({ ...D, debugLayout: true } as never, ctxT(w, h))) as MosaicDocument;
      expect((doc as { editor?: { layoutContract?: { ok?: boolean } } }).editor?.layoutContract?.ok).toBe(true);
    }
  });

  it("ticks render only at labeled (kept) positions and carry the contract tag", async () => {
    const doc = (await AlpineLineChartV2.render(D as never, ctxT())) as MosaicDocument;
    const ticks = ((doc.sources ?? []) as MosaicSource[]).filter((s) => (s as { editor?: { label?: string } }).editor?.label === "x-tick");
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.length).toBeLessThanOrEqual((D.labels as string[]).length);
  });

  it("no labels → no tick band, contract trivially green", async () => {
    const doc = (await AlpineLineChartV2.render({ ...D, labels: [], debugLayout: true } as never, ctxT())) as MosaicDocument;
    const ticks = ((doc.sources ?? []) as MosaicSource[]).filter((s) => (s as { editor?: { label?: string } }).editor?.label === "x-tick");
    expect(ticks.length).toBe(0);
    expect((doc as { editor?: { layoutContract?: { ok?: boolean } } }).editor?.layoutContract?.ok).toBe(true);
  });

  it("debugLayout off (default) leaves the doc unstamped — zero-cost path", async () => {
    const doc = (await AlpineLineChartV2.render(D as never, ctxT())) as MosaicDocument;
    expect((doc as { editor?: { layoutContract?: unknown } }).editor?.layoutContract).toBeUndefined();
  });
});

// ── Prop bindings — labels / title map to the rects that show them ──────────
import { resolvePropBindings } from "@m0saic/template-utils";

describe("AlpineLineChartV2 — prop bindings (Make inline edit)", () => {
  const schema = AlpineLineChartV2.propsSchema;
  type Bound = { editor?: { label?: string; binding?: unknown }; layers?: Array<{ content?: { text?: string } }> };
  const bindingsOf = async (props: Record<string, unknown>) => {
    const doc = await render(props);
    return { doc, ...resolvePropBindings(doc, W, H, { propsSchema: schema }) };
  };
  const sourceAt = (doc: MosaicDocument, i: number): Bound => (doc.sources ?? [])[i] as Bound;
  const labelOf = (s: MosaicSource) => (s as Bound).editor?.label;
  const colorOf = (s: MosaicSource) => (s as { color?: string }).color;

  it("labels[i] → every kept x-label rect (root, index-aligned); title → card-header (subtitle = secondary layer)", async () => {
    const LABELS = ["A", "B", "C", "D"];
    const r = await bindingsOf({ values: [3, 6, 4, 8], labels: LABELS, title: "T", subtitle: "S", grid: { show: false, count: 4 } });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["labels", "lineColor", "subtitle", "title"]);
    expect(r.byProp.labels.map((b) => b.index)).toEqual([0, 1, 2, 3]);
    for (const b of r.byProp.labels) {
      expect(b.childPath).toEqual([]);
      const s = sourceAt(r.doc, b.sourceIndex);
      expect(s.editor?.label).toBe("x-label");
      expect(s.layers?.[0]?.content?.text).toBe(LABELS[b.index!]);
    }
    expect(r.byProp.title).toHaveLength(1);
    expect(r.byProp.title[0].childPath).toEqual([]);
    expect(sourceAt(r.doc, r.byProp.title[0].sourceIndex).editor?.label).toBe("card-header");
    expect(r.byProp.subtitle).toHaveLength(1); // second header layer binds too (stacked Title / Subtitle form)
    expect(r.byProp.subtitle[0].layer).toBe(1);
    expect(r.byProp.subtitle[0].sourceIndex).toBe(r.byProp.title[0].sourceIndex);
  });

  it("decimated labels: only the KEPT labels bind, each at its ORIGINAL index (text matches labels[index])", async () => {
    const N = 24;
    const LABELS = Array.from({ length: N }, (_, i) => `Month${i}`);
    const r = await bindingsOf({ values: Array.from({ length: N }, (_, i) => i + 1), labels: LABELS, grid: { show: true, count: 4 } });
    expect(r.rejected).toEqual([]);
    const kept = srcs(r.doc).filter((s) => labelOf(s) === "x-label").length;
    expect(kept).toBeLessThan(N);
    expect(r.byProp.labels).toHaveLength(kept);
    const idx = r.byProp.labels.map((b) => b.index!);
    expect(idx.every((i, k) => i >= 0 && i < N && (k === 0 || i > idx[k - 1]))).toBe(true);
    for (const b of r.byProp.labels) expect(sourceAt(r.doc, b.sourceIndex).layers?.[0]?.content?.text).toBe(LABELS[b.index!]);
  });

  it("values are NOT bound: line / area / markers are combined masks (no per-value rect); ticks + rail are derived", async () => {
    const r = await bindingsOf({ ...D });
    expect(r.rejected).toEqual([]);
    expect(r.byProp.values).toBeUndefined();
    expect(Object.keys(r.byProp).sort()).toEqual(["labels", "lineColor", "subtitle", "title"]);
    // the only mask bindings are the lineColor handles; ticks / rail / other masks carry none
    const lineBound = new Set(r.byProp.lineColor.map((b) => b.sourceIndex));
    srcs(r.doc).forEach((s, i) => {
      if (labelOf(s) === "x-tick" || labelOf(s) === "y-tick-label") expect((s as Bound).editor?.binding).toBeUndefined();
      if (isMask(s) && !lineBound.has(i)) expect((s as Bound).editor?.binding).toBeUndefined();
      if (isMask(s) && lineBound.has(i)) expect((s as Bound).editor?.binding).toEqual({ propKey: "lineColor" });
    });
  });

  it("lineColor → the area-fill, line and marker masks (1:N, kind color); grid / axis / halo masks + the curtain stay unbound", async () => {
    const r = await bindingsOf({ ...D, lineColor: "#123456" });
    expect(r.rejected).toEqual([]);
    expect(r.byProp.lineColor).toHaveLength(3); // area + line + markers (defaults show both)
    for (const b of r.byProp.lineColor) {
      expect(b).toMatchObject({ kind: "color", childPath: [] });
      expect("index" in b).toBe(false);
      const s = srcs(r.doc)[b.sourceIndex];
      expect(isMask(s)).toBe(true);
      expect(colorOf(s)).toBe("#123456");
    }
    // every mask NOT painted with lineColor (grid, axis, marker halos) and the curtain tile are unbound
    const bound = new Set(Object.values(r.byProp).flat().map((b) => b.sourceIndex));
    let others = 0;
    srcs(r.doc).forEach((s, i) => {
      if ((isMask(s) && colorOf(s) !== "#123456") || isCurtain(s)) { others++; expect(bound.has(i)).toBe(false); }
    });
    expect(others).toBeGreaterThanOrEqual(3); // grid + axis + halos (+ curtain)
    // area + points off → only the line mask carries the handle
    const bare = await bindingsOf({ ...D, lineColor: "#123456", area: { show: false, opacity: 0 }, points: { show: false } });
    expect(bare.rejected).toEqual([]);
    expect(bare.byProp.lineColor).toHaveLength(1);
    expect(colorOf(srcs(bare.doc)[bare.byProp.lineColor[0].sourceIndex])).toBe("#123456");
    // unset lineColor → the masks paint the theme primary but stay handles (double-click to SET)
    const def = await bindingsOf({ ...D });
    expect(def.rejected).toEqual([]);
    expect(def.byProp.lineColor).toHaveLength(3);
  });

  it("subtitle-only header binds subtitle; no header + no labels → only the lineColor masks remain", async () => {
    const sub = await bindingsOf({ values: [3, 6, 4, 8], subtitle: "FY26" });
    expect(sub.rejected).toEqual([]);
    expect(Object.keys(sub.byProp).sort()).toEqual(["lineColor", "subtitle"]);
    expect(sourceAt(sub.doc, sub.byProp.subtitle[0].sourceIndex).editor?.label).toBe("card-header");

    const none = await bindingsOf({ values: [3, 6, 4, 8] });
    expect(none.rejected).toEqual([]);
    expect(Object.keys(none.byProp)).toEqual(["lineColor"]);
  });
});
