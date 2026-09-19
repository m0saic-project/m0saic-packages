import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete, getComplexityMetricsFast } from "@m0saic/dsl";
import { AlpineDonutV3 } from "./donut";
import { segmentsToAngles, MAX_SEGMENTS } from "../../../charts/donut/v3/geometry";
import { resolvePropBindings, type PropBindingResolution } from "@m0saic/template-utils";

const W = 1280;
const H = 800;

function makeCtx(width = W, height = H, durationMs = 2000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width, height, fps: 30, durationMs },
    output: { width, height, fps: 30, durationMs, workspaceDir: "/tmp/alpine-donut-v3" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const render = async (props: Record<string, unknown>, w = W, h = H) =>
  (await AlpineDonutV3.render(props as never, makeCtx(w, h))) as MosaicDocument;

const D = AlpineDonutV3.defaultProps as Record<string, unknown>;
const seg = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `S${i + 1}`, value: n - i }));

function expectFramesMatchSources(doc: MosaicDocument, w = W, h = H): void {
  expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  const parsed = parseM0StringComplete(doc.m0 as unknown as string, w, h);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe((doc.sources ?? []).length);
  expect((doc as { children?: unknown }).children).toBeUndefined();
}

const srcs = (doc: MosaicDocument) => (doc.sources ?? []) as MosaicSource[];
const isSector = (s: MosaicSource) => (s as { mask?: { kind?: string } }).mask?.kind === "inline-mask";
const alphaOf = (s: MosaicSource) => (s as { overlay?: { alpha?: string } }).overlay?.alpha;

describe("AlpineDonutV3 — metadata", () => {
  it("is the registered v3 primitive (not deprecated)", () => {
    expect(AlpineDonutV3.id).toBe("@m0saic/alpine/donut/v3");
    expect(AlpineDonutV3.version).toBe(3);
    expect(AlpineDonutV3.primitive).toBe(true);
    expect((AlpineDonutV3 as { deprecated?: unknown }).deprecated).toBeUndefined();
    expect(AlpineDonutV3.tags).toEqual(expect.arrayContaining(["alpine", "donut", "data-viz"]));
  });
});

describe("AlpineDonutV3 — render shape", () => {
  it("renders valid m0; frames match sources; no children", async () => {
    expectFramesMatchSources(await render({ ...D }));
  });
  it("is deterministic", async () => {
    expect((await render({ ...D })).m0).toBe((await render({ ...D })).m0);
  });
  it("rejects empty segments with an error mosaic, not a throw", async () => {
    expect(isValidM0String((await render({ ...D, segments: [] })).m0 as unknown as string)).toBe(true);
  });
});

describe("AlpineDonutV3 — premium = PIECEWISE clockwise draw-on (budgeted full-cell slivers)", () => {
  it("premium (default, animated) subdivides segments into budgeted slivers, each alpha-fading", async () => {
    // The old sweep's bbox-snapped crops printed white squares — gate-4 fail.
    // The piecewise FEEL stays: full-cell sliver masks, more than one per
    // segment, total bounded under the ~25-overlay mask cliff.
    const doc = await render({ ...D, segments: seg(3) });
    const sectors = srcs(doc).filter(isSector);
    expect(sectors.length).toBeGreaterThan(3); // pieces, not one chunk per segment
    expect(sectors.length).toBeLessThanOrEqual(14); // budgeted: 20 - N - 2 overlay layers
    expect(sectors.every((s) => alphaOf(s) != null)).toBe(true);
  });

  it("the sliver budget shrinks as segment count grows (cliff safety at MAX)", async () => {
    const doc = await render({ ...D, segments: seg(8) });
    const sectors = srcs(doc).filter(isSector);
    expect(sectors.length).toBeGreaterThanOrEqual(8);
    expect(sectors.length).toBeLessThanOrEqual(10); // 20 - N(8) - 2
  });

  it("bloom fades are staggered clockwise with arc-proportional durations", async () => {
    const doc = await render({ ...D, segments: seg(3) });
    const sectors = srcs(doc).filter(isSector);
    const startOf = (s: MosaicSource): number => {
      const a = String(alphaOf(s));
      const m = /\bt-([0-9.]+)/.exec(a) ?? /\(t-([0-9.]+)\)/.exec(a);
      return m ? Number(m[1]) : 0;
    };
    const starts = sectors.map(startOf);
    // strictly non-decreasing clockwise (first segment starts ~immediately —
    // its startDeg is offset by the half-gap, so not exactly 0)
    for (let i = 1; i < starts.length; i++) expect(starts[i]).toBeGreaterThanOrEqual(starts[i - 1]);
    expect(starts[0]).toBeLessThan(0.05);
  });

  it("light collapses to per-segment (one mask per segment, enable-gated)", async () => {
    const doc = await render({ ...D, segments: seg(3), anim: { ...(D.anim as object), renderMode: "light" } });
    const sectors = srcs(doc).filter(isSector);
    expect(sectors.length).toBe(3); // one mask per segment, not slivers
    expect(sectors.every((s) => (s as { overlay?: { enable?: string } }).overlay?.enable != null)).toBe(true);
    expect(sectors.some((s) => alphaOf(s) != null)).toBe(false); // geq-free
  });

  it("reduceMotion collapses to a static per-segment ring (no fades)", async () => {
    const doc = await render({ ...D, segments: seg(4), anim: { ...(D.anim as object), reduceMotion: true } });
    const sectors = srcs(doc).filter(isSector);
    expect(sectors.length).toBe(4);
    expect(sectors.some((s) => alphaOf(s) != null)).toBe(false);
  });
});

describe("AlpineDonutV3 — RATIO precision (both paths compose)", () => {
  const precAt = async (mode: string, w: number, h: number) => {
    const d = await render({ ...D, anim: { ...(D.anim as object), renderMode: mode } }, w, h);
    const m = getComplexityMetricsFast(d.m0 as unknown as string);
    return Math.max(m.precision.maxSplitX, m.precision.maxSplitY);
  };
  it("premium stays bounded across a resolution sweep", async () => {
    for (const [w, h] of [[1280, 800], [2560, 1600], [1001, 733]] as const) {
      expect(await precAt("premium", w, h)).toBeLessThanOrEqual(200);
    }
  });
  it("light stays bounded too", async () => {
    expect(await precAt("light", 2560, 1600)).toBeLessThanOrEqual(200);
  });
});

describe("AlpineDonutV3 — chrome", () => {
  it("legend: 'none' drops the side legend but keeps the ring + center value", async () => {
    const withLegend = srcs(await render({ ...D, legend: "right" })).length;
    const noLegend = srcs(await render({ ...D, legend: "none" }));
    expect(noLegend.length).toBeLessThan(withLegend);
    expect(noLegend.filter(isSector).length).toBeGreaterThan(0);
  });

  it("packs valid at square + portrait aspects", async () => {
    expectFramesMatchSources(await render({ ...D }, 1080, 1080), 1080, 1080);
    expectFramesMatchSources(await render({ ...D }, 800, 1280), 800, 1280);
  });

  it("a single segment renders valid (full ring)", async () => {
    expectFramesMatchSources(await render({ ...D, segments: [{ label: "Only", value: 1 }] }));
  });
});

describe("AlpineDonutV3 — theming", () => {
  const themedCtx = (tokens: Record<string, unknown>): MosaicEngineContext =>
    ({ mode: "render", target: { width: W, height: H, fps: 30, durationMs: 2000 }, output: { width: W, height: H, fps: 30, durationMs: 2000 }, media: {}, upstreamData: { theme: tokens } } as unknown as MosaicEngineContext);

  it("a producer theme recolors the card + center text; unthemed default does not", async () => {
    expect(JSON.stringify(await render({ ...D }))).not.toContain("#101820");
    const themed = JSON.stringify((await AlpineDonutV3.render(D as never, themedCtx({ surface: "#101820", textPrimary: "#00FFCC" }))) as MosaicDocument);
    expect(themed).toContain("#101820");
    expect(themed).toContain("#00FFCC");
  });

  it("an explicit segment color still wins over a producer theme", async () => {
    const themed = JSON.stringify((await AlpineDonutV3.render({ ...D, segments: [{ label: "A", value: 1, color: "#123456" }, { label: "B", value: 1 }] } as never, themedCtx({ surface: "#101820" }))) as MosaicDocument);
    expect(themed).toContain("#123456");
  });
});

describe("AlpineDonutV3 — gate 4: content-hugging legend + layout contract", () => {
  const STILL = { renderMode: "premium", introFrac: 0.7, countUp: true, easing: "easeOut", reduceMotion: true } as const;
  const HOSTILE: Array<[number, number]> = [
    [1280, 708],
    [1920, 480], // legend % drifted ~600px from its label before the hug fix
    [720, 1280], // label/% collision repro
    [607, 401],
    [541, 743], // swatch ±2px spread repro (interleaved legend stack)
    [733, 977],
  ];

  it("contract (swatch equal-size, 2% + 1px) passes at every hostile canvas", async () => {
    for (const [w, h] of HOSTILE) {
      const doc = await render({ ...D, anim: STILL, debugLayout: true }, w, h);
      const stamp = (doc as { editor?: { layoutContract?: { ok?: boolean } } }).editor?.layoutContract;
      expect(stamp?.ok).toBe(true);
    }
  });

  it("swatch tiles carry the contract tag + a centering inset", async () => {
    const doc = await render({ ...D, anim: STILL });
    const tiles = ((doc.sources ?? []) as MosaicSource[]).filter((s) => (s as { editor?: { label?: string } }).editor?.label === "legend-swatch");
    expect(tiles.length).toBe(3);
    for (const t of tiles) {
      expect((t as { placement?: { inset?: { y?: number } } }).placement?.inset?.y).toBeCloseTo(0.25, 5);
    }
  });

  it("debugLayout off (default) leaves the doc unstamped — zero-cost path", async () => {
    const doc = await render({ ...D, anim: STILL });
    expect((doc as { editor?: { layoutContract?: unknown } }).editor?.layoutContract).toBeUndefined();
  });

  it("legend:none renders no swatch tags and no contract relations trip", async () => {
    const doc = await render({ ...D, anim: STILL, legend: "none", debugLayout: true });
    const tiles = ((doc.sources ?? []) as MosaicSource[]).filter((s) => (s as { editor?: { label?: string } }).editor?.label === "legend-swatch");
    expect(tiles.length).toBe(0);
    expect((doc as { editor?: { layoutContract?: { ok?: boolean } } }).editor?.layoutContract?.ok).toBe(true);
  });

  it("long labels at a narrow legend shrink the font instead of colliding (renders feasible)", async () => {
    const doc = await render({
      ...D, anim: STILL,
      segments: [
        { label: "An Extremely Long Enterprise Segment Label", value: 60 },
        { label: "Another Long One For Good Measure", value: 40 },
      ],
    }, 720, 1280);
    const parsed = parseM0StringComplete(doc.m0 as unknown as string, 720, 1280);
    expect(parsed.ok).toBe(true);
  });
});

describe("AlpineDonutV3 — centerValue '' derives the sum (stress-07 finding)", () => {
  it("empty string falls back to the derived total, same as omitted", async () => {
    const doc = await render({ ...D, centerValue: "", segments: [{ label: "A", value: 60 }, { label: "B", value: 40 }] });
    expect(JSON.stringify(doc.sources)).toContain("100"); // 60+40 derived into the hole
  });
});

describe("AlpineDonutV3 — first-open cover (mosaic-branding theme)", () => {
  const coverCtx = {
    mode: "render" as const,
    target: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    output: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    media: {},
  } as unknown as MosaicEngineContext;

  it("branded pane + the template's own default render INLINED as hero", async () => {
    expect(typeof AlpineDonutV3.renderCover).toBe("function");
    const doc = (await AlpineDonutV3.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    const s = JSON.stringify(doc.sources);
    // Band variant: no conversation pane, just brand + title.
    expect(s).not.toContain("START HERE");
    // Inline-flat hero (gate-15/21 keeper): no nested cover child refs.
    expect(s).not.toContain('"type":"mosaic","ref":"cover');
  });

  it("cover is deterministic", async () => {
    const a = (await AlpineDonutV3.renderCover!({} as never, coverCtx)) as MosaicDocument;
    const b = (await AlpineDonutV3.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(a.m0).toBe(b.m0);
  });
});

describe("AlpineDonutV3 — prop bindings (Make inline edit)", () => {
  const schema = AlpineDonutV3.propsSchema;
  const bindingsOf = async (props: Record<string, unknown>, w = W, h = H) => {
    const doc = await render(props, w, h);
    return { doc, ...resolvePropBindings(doc, w, h, { propsSchema: schema }) };
  };
  const labelAt = (doc: MosaicDocument, i: number) => (srcs(doc)[i] as { editor?: { label?: string } }).editor?.label;
  const contentAt = (doc: MosaicDocument, i: number) =>
    (srcs(doc)[i] as { layers?: Array<{ content?: { kind?: string; text?: string } }> }).layers?.[0]?.content;
  const colorAt = (doc: MosaicDocument, i: number) => (srcs(doc)[i] as { color?: string }).color;
  const one = (r: PropBindingResolution, key: string) => {
    expect(r.byProp[key]).toHaveLength(1);
    const b = r.byProp[key][0];
    expect("index" in b).toBe(false);
    expect(b.childPath).toEqual([]);
    return b;
  };
  const isSwatch = (s: MosaicSource) => (s as { editor?: { label?: string } }).editor?.label === "legend-swatch";
  const valueLeaves = (r: PropBindingResolution) => (r.byProp.segments ?? []).filter((b) => b.path?.[1] === "value");
  const labelLeaves = (r: PropBindingResolution) => (r.byProp.segments ?? []).filter((b) => b.path?.[1] === "label");
  const colorLeaves = (r: PropBindingResolution) => (r.byProp.segments ?? []).filter((b) => b.path?.[1] === "color");
  /** Every ring slice AND every legend swatch carries exactly one `segments[i].color`
   *  leaf (kind color, root doc) — and nothing else does. Returns the color leaves. */
  const expectColorLeavesCoverSlicesAndSwatches = (r: { doc: MosaicDocument } & PropBindingResolution) => {
    const colors = colorLeaves(r);
    const colorIdx = new Set(colors.map((b) => b.sourceIndex));
    expect(colorIdx.size).toBe(colors.length); // one binding per source
    srcs(r.doc).forEach((s, i) => expect(colorIdx.has(i)).toBe(isSector(s) || isSwatch(s)));
    for (const b of colors) {
      expect(b.kind).toBe("color");
      expect(b.childPath).toEqual([]);
      expect(b.index).toBeUndefined();
      expect(typeof b.path![0]).toBe("number");
    }
    return colors;
  };
  const slicesOf = (r: { doc: MosaicDocument } & PropBindingResolution) => colorLeaves(r).filter((b) => isSector(srcs(r.doc)[b.sourceIndex]));
  const swatchesOf = (r: { doc: MosaicDocument } & PropBindingResolution) => colorLeaves(r).filter((b) => isSwatch(srcs(r.doc)[b.sourceIndex]));

  it("binds centerValue + centerLabel to the two center rects; title rides the alpineCard header (primary layer)", async () => {
    const r = await bindingsOf({ ...D });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["centerLabel", "centerValue", "segments", "subtitle", "title"]);
    const v = one(r, "centerValue");
    expect(labelAt(r.doc, v.sourceIndex)).toBe("center-value");
    // default anim counts the center value up → the bound rect is the expr-text source
    expect(contentAt(r.doc, v.sourceIndex)?.kind).toBe("expr");
    expect(labelAt(r.doc, one(r, "centerLabel").sourceIndex)).toBe("center-label");
    expect(labelAt(r.doc, one(r, "title").sourceIndex)).toBe("card-header");
    expect(r.byProp.subtitle).toHaveLength(1); // second header layer binds too (stacked Title / Subtitle form)
    expect(r.byProp.subtitle[0].layer).toBe(1);
    expect(r.byProp.subtitle[0].sourceIndex).toBe(r.byProp.title[0].sourceIndex);
  });

  it("derived center (centerValue omitted) stays bound — the handle to ADD one; no caption → no rect → no binding", async () => {
    const r = await bindingsOf({ segments: seg(3), anim: { reduceMotion: true } });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["centerValue", "segments"]);
    const v = one(r, "centerValue");
    expect(labelAt(r.doc, v.sourceIndex)).toBe("center-value");
    expect(contentAt(r.doc, v.sourceIndex)?.text).toBe("6");
  });

  it("subtitle-only header binds subtitle; % labels (ring + legend) edit segments[i].value; slices + swatches edit segments[i].color", async () => {
    const r = await bindingsOf({ ...D, title: undefined, subtitle: "Revenue Mix", legend: "right", segmentLabels: "percent" });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["centerLabel", "centerValue", "segments", "subtitle"]);
    expect(labelAt(r.doc, one(r, "subtitle").sourceIndex)).toBe("card-header");
    expect(labelLeaves(r)).toHaveLength(3); // the three legend LABEL rects
    // every % rect (legend-pct always; seg-label when the slice is wide enough) is a `value` leaf, kind number
    const values = valueLeaves(r);
    expect(values.length).toBeGreaterThanOrEqual(3);
    for (const b of values) {
      expect(b.kind).toBe("number");
      expect(["legend-pct", "seg-label"]).toContain(labelAt(r.doc, b.sourceIndex));
    }
    expect(values.filter((b) => labelAt(r.doc, b.sourceIndex) === "legend-pct").map((b) => b.path![0])).toEqual([0, 1, 2]);
    // the slices (premium slivers) + swatches are each segment's COLOR on screen → `color` leaves (a picker)
    const colors = expectColorLeavesCoverSlicesAndSwatches(r);
    expect(colors.length).toBeGreaterThan(3 + 3); // several slivers per segment + one swatch each
    // ...and no text rect is ever a color leaf
    for (const b of Object.values(r.byProp).flat()) {
      const s = srcs(r.doc)[b.sourceIndex];
      expect(b.kind === "color").toBe(isSector(s) || isSwatch(s));
    }
  });

  it("binds the same set in both render modes, with the legend off, and at a portrait canvas", async () => {
    for (const renderMode of ["premium", "light"]) {
      const r = await bindingsOf({ ...D, anim: { ...(D.anim as object), renderMode } });
      expect(r.rejected).toEqual([]);
      expect(Object.keys(r.byProp).sort()).toEqual(["centerLabel", "centerValue", "segments", "subtitle", "title"]);
    }
    // legend:none → no label rect exists → no `label` leaf and no swatch (never add a rect);
    // the ring's % labels still bind their segment's value, its slices their color
    const noLegend = await bindingsOf({ ...D, legend: "none" }, 720, 1280);
    expect(noLegend.rejected).toEqual([]);
    expect(Object.keys(noLegend.byProp).sort()).toEqual(["centerLabel", "centerValue", "segments", "subtitle", "title"]);
    expect(labelLeaves(noLegend)).toHaveLength(0);
    expect(valueLeaves(noLegend).length).toBeGreaterThan(0);
    expect(swatchesOf(noLegend)).toHaveLength(0);
    expect(slicesOf(noLegend).length).toBeGreaterThan(0);
    // ...and with ring labels off as well, `segments` keeps ONLY the slices' color leaves
    const nothing = await bindingsOf({ ...D, legend: "none", segmentLabels: "none" }, 720, 1280);
    expect(nothing.rejected).toEqual([]);
    expect(labelLeaves(nothing)).toHaveLength(0);
    expect(valueLeaves(nothing)).toHaveLength(0);
    expect(colorLeaves(nothing).length).toBeGreaterThan(0);
    expect(colorLeaves(nothing)).toHaveLength(nothing.byProp.segments.length);
  });

  it("segments[i].label → the legend-label rect; segments[i].value → its % rects; segments[i].color → slices + swatches (leaf bindings, root doc)", async () => {
    const r = await bindingsOf({ ...D });
    expect(r.rejected).toEqual([]);
    const leaves = labelLeaves(r).map((b) => ({ path: b.path, kind: b.kind, childPath: b.childPath, label: labelAt(r.doc, b.sourceIndex) }));
    expect(leaves).toEqual([0, 1, 2].map((i) => ({ path: [i, "label"], kind: "string", childPath: [], label: "legend-label" })));
    expect(r.byProp.segments.every((b) => b.index === undefined)).toBe(true);
    expect(contentAt(r.doc, labelLeaves(r)[0].sourceIndex)?.text).toBe("Enterprise");
    // The % text is a rendering of ONE leaf (this segment's value) → bound as a number.
    const values = valueLeaves(r);
    expect(values.length).toBeGreaterThanOrEqual(3);
    expect(values.every((b) => b.kind === "number" && b.childPath.length === 0)).toBe(true);
    // The slice's / swatch's FILL is the segment's color → bound as a color (Make opens a picker).
    const colors = expectColorLeavesCoverSlicesAndSwatches(r);
    expect(swatchesOf(r).map((b) => b.path)).toEqual([[0, "color"], [1, "color"], [2, "color"]]);
    // every bound tile is painted with the color the leaf edits (slice and swatch agree per segment)
    const palette = (D.segments as Array<{ color: string }>).map((s) => s.color);
    for (const b of colors) expect(colorAt(r.doc, b.sourceIndex)).toBe(palette[b.path![0] as number]);
  });

  it("segments[i].color: light / static = ONE slice per segment; premium = a bounded handful of slivers per segment (≤14 total), all at the segment's index", async () => {
    const light = await bindingsOf({ ...D, anim: { ...(D.anim as object), renderMode: "light" } });
    expect(light.rejected).toEqual([]);
    expectColorLeavesCoverSlicesAndSwatches(light);
    expect(slicesOf(light).map((b) => b.path)).toEqual([[0, "color"], [1, "color"], [2, "color"]]);
    const premium = await bindingsOf({ ...D });
    expect(premium.rejected).toEqual([]);
    expectColorLeavesCoverSlicesAndSwatches(premium);
    const slivers = slicesOf(premium);
    expect(slivers.length).toBeGreaterThan(3);
    expect(slivers.length).toBeLessThanOrEqual(14);
    expect(new Set(slivers.map((b) => b.path![0]))).toEqual(new Set([0, 1, 2]));
    // every sliver of a segment paints THAT segment's color
    const palette = (D.segments as Array<{ color: string }>).map((s) => s.color);
    for (const b of slivers) expect(colorAt(premium.doc, b.sourceIndex)).toBe(palette[b.path![0] as number]);
  });

  it("sliced / filtered segments keep their ORIGINAL indices; an empty label / absent color still binds (ADD handle)", async () => {
    const segments = [
      { label: "keep 0", value: 10, color: "#123456" },
      { label: "zero", value: 0 }, // filtered out (non-positive)
      { label: "", value: 5 }, // drawn with an empty label + palette color → both rects are ADD handles
      { label: "nan", value: Number.NaN }, // filtered out
      { label: "keep 4", value: 3 },
    ];
    const r = await bindingsOf({ ...D, segments, anim: { reduceMotion: true } });
    expect(r.rejected).toEqual([]);
    expect(labelLeaves(r).map((b) => b.path)).toEqual([[0, "label"], [2, "label"], [4, "label"]]);
    expect(contentAt(r.doc, labelLeaves(r)[2].sourceIndex)?.text).toBe("keep 4");
    expect(labelAt(r.doc, labelLeaves(r)[1].sourceIndex)).toBe("legend-label");
    // the value leaves follow the same ORIGINAL indices
    expect(new Set(valueLeaves(r).map((b) => b.path![0]))).toEqual(new Set([0, 2, 4]));
    // static ring: ONE slice per drawn segment + ONE swatch each, both at the ORIGINAL index
    expectColorLeavesCoverSlicesAndSwatches(r);
    expect(slicesOf(r).map((b) => b.path)).toEqual([[0, "color"], [2, "color"], [4, "color"]]);
    expect(swatchesOf(r).map((b) => b.path)).toEqual([[0, "color"], [2, "color"], [4, "color"]]);
    // the explicit color paints its slice; the palette-fallback segments (no `color` in the prop) are bound all the same
    expect(colorAt(r.doc, slicesOf(r)[0].sourceIndex)).toBe("#123456");
    expect(colorAt(r.doc, swatchesOf(r)[0].sourceIndex)).toBe("#123456");
    expect(colorAt(r.doc, slicesOf(r)[1].sourceIndex)).toBe(colorAt(r.doc, swatchesOf(r)[1].sourceIndex));
    // Truncation happens BEFORE the filter: MAX_SEGMENTS of MAX_SEGMENTS+1 → 0..MAX-1.
    const many = await bindingsOf({ ...D, segments: seg(MAX_SEGMENTS + 1), anim: { reduceMotion: true } });
    expect(many.rejected).toEqual([]);
    expect(labelLeaves(many).map((b) => b.path?.[0])).toEqual(Array.from({ length: MAX_SEGMENTS }, (_, i) => i));
    expect(slicesOf(many).map((b) => b.path?.[0])).toEqual(Array.from({ length: MAX_SEGMENTS }, (_, i) => i));
    expect(swatchesOf(many).map((b) => b.path?.[0])).toEqual(Array.from({ length: MAX_SEGMENTS }, (_, i) => i));
  });
});
