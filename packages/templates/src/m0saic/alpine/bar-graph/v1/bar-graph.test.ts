import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete } from "@m0saic/dsl";
import { AlpineBarGraph } from "./bar-graph";
import { ALPINE_PRESETS } from "../../_shared/alpine-theme";

const W = 1280;
const H = 800;

function makeCtx(durationMs = 2000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: W, height: H, fps: 30, durationMs },
    output: { width: W, height: H, fps: 30, durationMs, workspaceDir: "/tmp/alpine-bar-graph" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const render = async (props: Record<string, unknown>, durationMs?: number) =>
  (await AlpineBarGraph.render(props as never, makeCtx(durationMs))) as MosaicDocument;

const D = AlpineBarGraph.defaultProps as Record<string, unknown>;

const childrenOf = (doc: MosaicDocument): Record<string, MosaicDocument> =>
  (doc as { children?: Record<string, MosaicDocument> }).children ?? {};

/** Every source painted, flattened across the top-level doc + child docs. */
function allSources(doc: MosaicDocument): MosaicSource[] {
  const out = [...((doc.sources ?? []) as MosaicSource[])];
  const kids = childrenOf(doc);
  for (const k of Object.keys(kids)) out.push(...((kids[k].sources ?? []) as MosaicSource[]));
  return out;
}

/** Frames the engine paints == sources it consumes — the render-validity invariant. */
function expectFramesMatchSources(doc: MosaicDocument): void {
  expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  const parsed = parseM0StringComplete(doc.m0 as unknown as string, W, H);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) {
    expect(parsed.ir.renderFrames.length).toBe((doc.sources ?? []).length);
  }
}

const colorOf = (s: MosaicSource) => (s as { color?: string }).color;
const overlayOf = (s: MosaicSource) => (s as { overlay?: { alpha?: string; xExpr?: string; yExpr?: string } }).overlay;
const effectsOf = (s: MosaicSource) => (s as { effects?: { rounding?: unknown; stroke?: unknown } }).effects;
const isText = (s: MosaicSource) => (s as { type?: string }).type === "text";
// A bar tile: a ROUNDED lavfi-color tile WITHOUT a stroke. The card surface is
// also a rounded color tile but carries a `stroke` (its border) — so the
// stroke-absence cleanly separates bars from the card.
const isBarTile = (s: MosaicSource) =>
  (s as { type?: string }).type === "lavfi" &&
  colorOf(s) !== undefined &&
  !!effectsOf(s)?.rounding &&
  !effectsOf(s)?.stroke;

describe("AlpineBarGraph — metadata", () => {
  it("is the registered v1 primitive, not deprecated", () => {
    expect(AlpineBarGraph.id).toBe("@m0saic/alpine/bar-graph/v1");
    expect(AlpineBarGraph.version).toBe(1);
    expect(AlpineBarGraph.primitive).toBe(true);
    expect((AlpineBarGraph as { deprecated?: unknown }).deprecated).toBeUndefined();
    expect(AlpineBarGraph.tags).toEqual(expect.arrayContaining(["alpine", "bar-graph", "data-viz"]));
  });

  it("no pinned barColor default → falls through to the theme primary (themeable, still concrete)", async () => {
    expect(D.barColor).toBeUndefined(); // unset so a preset/producer theme can recolor the bars
    // unthemed light → the resolved bars are the alpine light primary, a concrete hex.
    const doc = await render({ ...D, anim: { reduceMotion: true } });
    expect(JSON.stringify(doc)).toContain(ALPINE_PRESETS.light.primary);
  });
});

describe("AlpineBarGraph — two-mode reveal + theming (F4 U-A6)", () => {
  const timeAlpha = (s: MosaicSource) => { const a = (s as { overlay?: { alpha?: string } }).overlay?.alpha; return a != null && /\blt\b|\bt\b/.test(String(a)); };
  const enableOf = (s: MosaicSource) => (s as { overlay?: { enable?: string } }).overlay?.enable;
  const themedCtx = (tokens: Record<string, unknown>): MosaicEngineContext =>
    ({ mode: "render", target: { width: W, height: H, fps: 30, durationMs: 2000 }, output: {}, media: {}, upstreamData: { theme: tokens } } as unknown as MosaicEngineContext);

  it("premium (default): bars + labels fade (a geq) — no enable gates", async () => {
    const all = allSources(await render({ ...D }));
    expect(all.some(timeAlpha)).toBe(true);
    expect(all.some((s) => enableOf(s) != null)).toBe(false);
  });

  it("light: geq-free — zero time-alpha; bars grow (xExpr), labels enable-gate", async () => {
    const all = allSources(await render({ ...D, anim: { renderMode: "light" } }));
    expect(all.some(timeAlpha)).toBe(false);
    expect(all.some((s) => overlayOf(s)?.xExpr != null)).toBe(true);   // bars still grow
    expect(all.some((s) => enableOf(s) != null)).toBe(true);           // labels gated
  });

  it("a producer theme recolors the card + bars; explicit barColor still wins", async () => {
    const plain = JSON.stringify(await render({ ...D }));
    expect(plain).not.toContain("#101820");
    const themed = JSON.stringify((await AlpineBarGraph.render(D as never, themedCtx({ surface: "#101820", accent: "#00FFCC" }))) as MosaicDocument);
    expect(themed).toContain("#101820"); // card
    expect(themed).toContain("#00FFCC"); // bars
    const explicit = JSON.stringify((await AlpineBarGraph.render({ ...D, barColor: "#123456" } as never, themedCtx({ accent: "#00FFCC" }))) as MosaicDocument);
    expect(explicit).toContain("#123456");
  });

  it("domain group (min/max) overrides the auto axis", async () => {
    const auto = JSON.stringify(await render({ ...D, anim: { reduceMotion: true } }));
    const fixed = JSON.stringify(await render({ ...D, anim: { reduceMotion: true }, domain: { minValue: 0, maxValue: 100000 } }));
    expect(fixed).not.toBe(auto); // a wildly different domain reshapes the bars
  });
});

describe("AlpineBarGraph — render shape (both orientations)", () => {
  for (const orientation of ["horizontal", "vertical"] as const) {
    describe(orientation, () => {
      it("renders a valid m0 document; frames match sources at every doc tier", async () => {
        const doc = await render({ ...D, orientation });
        expectFramesMatchSources(doc);
        for (const child of Object.values(childrenOf(doc))) expectFramesMatchSources(child);
        expect(doc.backgroundColor).toBeDefined();
      });

      it("paints one rounded bar tile per value, plus category + value labels", async () => {
        const doc = await render({ ...D, orientation, values: [10, 20, 30], labels: ["a", "b", "c"] });
        const srcs = allSources(doc);
        expect(srcs.filter(isBarTile).length).toBe(3);
        // category labels (a/b/c) + value labels + tick labels are all text sources
        expect(srcs.filter(isText).length).toBeGreaterThanOrEqual(3);
      });

      it("animated → bars carry an intro overlay + a clipping `plot` child; static → neither", async () => {
        const animated = await render({ ...D, orientation });
        expect(childrenOf(animated).plot).toBeDefined();
        expect(allSources(animated).filter(isBarTile).every((b) => overlayOf(b)?.alpha != null)).toBe(true);

        const still = await render({ ...D, orientation, anim: { introFrac: 0.7, ease: "smoothstep", reduceMotion: true } });
        expect(childrenOf(still).plot).toBeUndefined();
        expect(allSources(still).filter(isBarTile).some((b) => overlayOf(b) != null)).toBe(false);
      });

      it("is deterministic — identical inputs yield byte-identical m0", async () => {
        const a = await render({ ...D, orientation });
        const b = await render({ ...D, orientation });
        expect(a.m0).toBe(b.m0);
      });
    });
  }

  it("the grow axis differs by orientation (horizontal → xExpr, vertical → yExpr)", async () => {
    const h = allSources(await render({ ...D, orientation: "horizontal" })).filter(isBarTile);
    const v = allSources(await render({ ...D, orientation: "vertical" })).filter(isBarTile);
    expect(h.every((b) => overlayOf(b)?.xExpr != null && overlayOf(b)?.yExpr == null)).toBe(true);
    expect(v.every((b) => overlayOf(b)?.yExpr != null && overlayOf(b)?.xExpr == null)).toBe(true);
  });

  it("rejects empty values with an error mosaic, not a throw", async () => {
    const doc = await render({ ...D, values: [] });
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  });
});

describe("AlpineBarGraph — equal bar thickness (the 85/85/68 quantization fix)", () => {
  // The founder's gate-repro knobs (production/alpine-bar-graph-v1, 2026-08-20):
  // horizontal, gap 0.55 — the old fractional banding starved the CENTER band
  // by 17px at 1280×800 (engine outside-in remainder distribution). The fix is
  // one EQUAL band per bar + gap-as-inset, so band thickness can never differ
  // by more than 1px at ANY canvas.
  const REPRO = {
    values: [12400, 8700, 5600, 2100, 1200],
    labels: ["Email", "Reddit", "Hacker News", "test", "smoke"],
    title: "BAR CHART",
    subtitle: "Sales by Channel",
    bars: { gap: 0.55, cornerRadius: 0.4 },
    anim: { renderMode: "premium", introFrac: 0.7, ease: "smoothstep", reduceMotion: true },
  };

  const ctxAt = (w: number, h: number): MosaicEngineContext =>
    ({
      mode: "render" as const,
      target: { width: w, height: h, fps: 30, durationMs: 2000 },
      output: { width: w, height: h, fps: 30, durationMs: 2000, workspaceDir: "/tmp/alpine-bar-graph" },
      media: {},
    }) as unknown as MosaicEngineContext;

  /** Bar-band thickness per bar tile: zip renderFrames↔sources (same order —
   *  locked by expectFramesMatchSources) and read the bar frames' cross-axis. */
  async function barBandSizes(props: Record<string, unknown>, w: number, h: number, axis: "height" | "width"): Promise<number[]> {
    const doc = (await AlpineBarGraph.render(props as never, ctxAt(w, h))) as MosaicDocument;
    const parsed = parseM0StringComplete(doc.m0 as unknown as string, w, h);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return [];
    const frames = parsed.ir.renderFrames;
    const srcs = (doc.sources ?? []) as MosaicSource[];
    expect(frames.length).toBe(srcs.length);
    return srcs.flatMap((s, i) => (isBarTile(s) ? [frames[i][axis]] : []));
  }

  const HOSTILE_CANVASES: Array<[number, number]> = [
    [1280, 800], // the gate repro
    [1001, 733], // near-prime dims
    [1920, 1080],
    [640, 400],
    [607, 401], // prime-ish small
    [640, 360], // ~33px bars: healthy ±1px ≈ 3% — locks the 0.035 tolerance
    [1920, 480], // ultrawide banner
  ];

  it("horizontal: every bar band within 1px of the others at every canvas", async () => {
    for (const [w, h] of HOSTILE_CANVASES) {
      const heights = await barBandSizes({ ...REPRO, orientation: "horizontal" }, w, h, "height");
      expect(heights).toHaveLength(5);
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
    }
  });

  it("vertical: every bar band within 1px of the others at every canvas", async () => {
    for (const [w, h] of HOSTILE_CANVASES) {
      const widths = await barBandSizes({ ...REPRO, orientation: "vertical" }, w, h, "width");
      expect(widths).toHaveLength(5);
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    }
  });

  it("debugLayout contract passes (animated → checks THROUGH the plot child flatten)", async () => {
    for (const orientation of ["horizontal", "vertical"] as const) {
      const doc = await render({
        ...REPRO,
        orientation,
        anim: { renderMode: "premium", introFrac: 0.7, ease: "smoothstep", reduceMotion: false },
        debugLayout: true,
      });
      const stamp = (doc as { editor?: { layoutContract?: { ok?: boolean } } }).editor?.layoutContract;
      expect(stamp?.ok).toBe(true);
    }
  });

  it("debugLayout off (default) leaves the doc unstamped — zero-cost path", async () => {
    const doc = await render({ ...REPRO, orientation: "horizontal" });
    expect((doc as { editor?: { layoutContract?: unknown } }).editor?.layoutContract).toBeUndefined();
  });
});

describe("AlpineBarGraph — bars.thickness (the direct thickness dial)", () => {
  const STILL = { renderMode: "premium", introFrac: 0.7, ease: "smoothstep", reduceMotion: true } as const;
  const ctxAt = (w: number, h: number): MosaicEngineContext =>
    ({
      mode: "render" as const,
      target: { width: w, height: h, fps: 30, durationMs: 2000 },
      output: { width: w, height: h, fps: 30, durationMs: 2000, workspaceDir: "/tmp/alpine-bar-graph" },
      media: {},
    }) as unknown as MosaicEngineContext;

  it("unset → byte-identical to the legacy gap path (defaults unchanged)", async () => {
    const a = await render({ ...D, anim: STILL });
    const b = await render({ ...D, anim: STILL, bars: { gap: 0.55, cornerRadius: 0.4 } });
    expect(a.m0).toBe(b.m0);
    expect(JSON.stringify(a.sources)).toBe(JSON.stringify(b.sources));
  });

  it("thickness overrides gap: tile inset = (1-t)/2 on the thickness axis, per orientation", async () => {
    const doc = await render({ ...D, anim: STILL, bars: { gap: 0.55, cornerRadius: 0.4, thickness: 0.3 } });
    const bars = allSources(doc).filter((s) => (s as { editor?: { label?: string } }).editor?.label === "bar");
    expect(bars.length).toBe(5);
    for (const b of bars) {
      expect((b as { placement?: { inset?: { y?: number } } }).placement?.inset?.y).toBeCloseTo(0.35, 5); // horizontal → y
    }
    const v = await render({ ...D, anim: STILL, orientation: "vertical", bars: { gap: 0.55, cornerRadius: 0.4, thickness: 0.9 } });
    const vb = allSources(v).filter((s) => (s as { editor?: { label?: string } }).editor?.label === "bar");
    for (const b of vb) {
      expect((b as { placement?: { inset?: { x?: number } } }).placement?.inset?.x).toBeCloseTo(0.05, 5); // vertical → x
    }
  });

  it("contract stays green across thickness extremes at hostile canvases", async () => {
    for (const t of [0.1, 1]) {
      for (const [w, h] of [[1920, 480], [640, 360], [733, 977]] as Array<[number, number]>) {
        const doc = (await AlpineBarGraph.render(
          { ...D, anim: STILL, debugLayout: true, orientation: t === 0.1 ? "vertical" : "horizontal", bars: { gap: 0.55, cornerRadius: 0.4, thickness: t } } as never,
          ctxAt(w, h),
        )) as MosaicDocument;
        expect((doc as { editor?: { layoutContract?: { ok?: boolean } } }).editor?.layoutContract?.ok).toBe(true);
      }
    }
  });
});

describe("AlpineBarGraph — first-open cover (mosaic-branding theme)", () => {
  // The premium grow-in means the true first frame under-sells the chart;
  // the cover is the branded chat pane + the template's OWN static default
  // chart as the real-material hero (gate: mosaic-branding cover rollout).
  const coverCtx = {
    mode: "render" as const,
    target: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    output: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    media: {},
  } as unknown as MosaicEngineContext;

  it("declares a cover: branded pane + inlined static chart hero", async () => {
    expect(typeof AlpineBarGraph.renderCover).toBe("function");
    const doc = (await AlpineBarGraph.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    const s = JSON.stringify(doc.sources);
    expect(s).toContain("Bar Graph");
    // Copy word-wraps across text sources — assert wrap-safe fragments.
    expect(s).toContain("A bar chart.");
    // Band variant: no conversation pane, just brand + title.
    expect(s).not.toContain("START HERE");
    // Inline-flat hero (gate-15/21 keeper: rounded bar caps are procedural
    // masks — never a nested child composite): no cover child refs, the
    // default chart's bars ride the top-level sources.
    expect(s).not.toContain('"type":"mosaic","ref":"cover');
    expect((doc as { children?: unknown }).children).toBeUndefined();
    expect(s).toContain('"label":"bar"');
    // Self-contained: any media source (the brand M) resolves to a bundled
    // asset in THIS doc's manifest — nothing ambient.
    const assetIds = new Set(Object.keys(doc.assets ?? {}));
    const all = (doc.sources ?? []) as Array<{ type?: string; assetId?: string }>;
    expect(
      all.filter((x) => x.type === "media").every((x) => assetIds.has(String(x.assetId))),
    ).toBe(true);
  });

  it("is deterministic and survives the REGISTERED (wrapped) path", async () => {
    const a = (await AlpineBarGraph.renderCover!({} as never, coverCtx)) as MosaicDocument;
    const b = (await AlpineBarGraph.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(a.m0).toBe(b.m0);
    // The production path renders the REGISTERED instance (gate-20 keeper) —
    // the wrapper must preserve a working renderCover.
    const { requireTemplate } = require("@m0saic/template-utils");
    const wrapped = requireTemplate("@m0saic/alpine/bar-graph/v1");
    const viaWrapped = (await wrapped.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(isValidM0String(viaWrapped.m0 as unknown as string)).toBe(true);
    expect(JSON.stringify(viaWrapped.sources)).toContain("A bar chart.");
  });
});

// ── Prop bindings — labels / values / title map to the rects that show them ─
import { resolvePropBindings } from "@m0saic/template-utils";

describe("AlpineBarGraph — prop bindings (Make inline edit)", () => {
  const schema = AlpineBarGraph.propsSchema;
  const VALUES = [12400, 8700, 5600, 2100];
  const LABELS = ["Email", "Reddit", "Hacker News", "Other"];
  const IDX = [0, 1, 2, 3];
  const STILL = { renderMode: "premium", introFrac: 0.7, ease: "smoothstep", reduceMotion: true };
  const bindingsOf = async (props: Record<string, unknown>) => {
    const doc = await render(props);
    return { doc, ...resolvePropBindings(doc, W, H, { propsSchema: schema }) };
  };
  type Bound = { editor?: { label?: string; binding?: unknown }; layers?: Array<{ content?: { text?: string } }> };
  const sourceAt = (doc: MosaicDocument, childPath: string[], i: number): Bound => {
    const owner = childPath.length ? childrenOf(doc)[childPath[0]] : doc;
    return (owner.sources ?? [])[i] as Bound;
  };
  /** values[i] → sorted tags of every source bound to index i. */
  const valueTagsByIndex = (r: Awaited<ReturnType<typeof bindingsOf>>): Map<number, string[]> => {
    const per = new Map<number, string[]>();
    for (const b of r.byProp.values ?? []) {
      const lbl = sourceAt(r.doc, b.childPath, b.sourceIndex).editor?.label ?? "?";
      per.set(b.index!, [...(per.get(b.index!) ?? []), lbl].sort());
    }
    return per;
  };

  for (const orientation of ["horizontal", "vertical"] as const) {
    it(`${orientation} (animated): labels[i] → cat-label (root); values[i] → bar + value-label (plot child); title → card-header`, async () => {
      const r = await bindingsOf({ ...D, orientation, values: VALUES, labels: LABELS, title: "Sales", subtitle: "By channel" });
      expect(r.rejected).toEqual([]);
      expect(Object.keys(r.byProp).sort()).toEqual(["barColor", "labels", "subtitle", "title", "values"]);

      // category labels: one per bar, index-aligned, ROOT doc, text = labels[i]
      expect(r.byProp.labels.map((b) => b.index)).toEqual(IDX);
      for (const b of r.byProp.labels) {
        expect(b.childPath).toEqual([]);
        const s = sourceAt(r.doc, b.childPath, b.sourceIndex);
        expect(s.editor?.label).toBe("cat-label");
        expect(s.layers?.[0]?.content?.text).toBe(LABELS[b.index!]);
      }

      // values: every index has its bar (a max-height vertical bar drops its
      // label band), all inside the clipping `plot` child
      for (const b of r.byProp.values) expect(b.childPath).toEqual(["plot"]);
      const per = valueTagsByIndex(r);
      expect([...per.keys()].sort()).toEqual(IDX);
      for (const i of IDX) {
        expect(per.get(i)).toContain("bar");
        expect(per.get(i)!.every((l) => l === "bar" || l === "value-label")).toBe(true);
      }
      // the horizontal inline label always has its gutter → bar + label per bar
      if (orientation === "horizontal") for (const i of IDX) expect(per.get(i)).toEqual(["bar", "value-label"]);

      // header: alpineCard binds its PRIMARY layer (title) — one root rect
      expect(r.byProp.title).toHaveLength(1);
      expect(r.byProp.title[0].childPath).toEqual([]);
      expect(sourceAt(r.doc, [], r.byProp.title[0].sourceIndex).editor?.label).toBe("card-header");
      expect(r.byProp.subtitle).toHaveLength(1); // second header layer binds too (stacked Title / Subtitle form)
    expect(r.byProp.subtitle[0].layer).toBe(1);
    expect(r.byProp.subtitle[0].sourceIndex).toBe(r.byProp.title[0].sourceIndex);

      // derived text (axis ticks) never binds
      const ticks = (allSources(r.doc) as Bound[]).filter((s) => s.editor?.label === "axis-tick");
      expect(ticks.length).toBeGreaterThan(0);
      expect(ticks.every((s) => s.editor?.binding === undefined)).toBe(true);
    });

    it(`${orientation} (reduceMotion): no plot child → the same bindings ride the ROOT doc`, async () => {
      const r = await bindingsOf({ ...D, orientation, values: VALUES, labels: LABELS, anim: STILL });
      expect(r.rejected).toEqual([]);
      expect(childrenOf(r.doc).plot).toBeUndefined();
      expect(r.byProp.labels.map((b) => b.index)).toEqual(IDX);
      for (const b of [...r.byProp.labels, ...r.byProp.values]) expect(b.childPath).toEqual([]);
      const per = valueTagsByIndex(r);
      expect([...per.keys()].sort()).toEqual(IDX);
      for (const i of IDX) expect(per.get(i)).toContain("bar");
    });
  }

  it("vertical: a max-height bar drops its value-label band but keeps the bar binding (why the bar binds too)", async () => {
    const r = await bindingsOf({ ...D, orientation: "vertical", values: [100, 5, 50], labels: ["max", "min", "mid"], domain: { minValue: 0, maxValue: 100 }, anim: STILL });
    expect(r.rejected).toEqual([]);
    const per = valueTagsByIndex(r);
    expect(per.get(0)).toEqual(["bar"]); // label band dropped — the bar is still a handle
    expect(per.get(1)).toEqual(["bar", "value-label"]);
    expect(per.get(2)).toEqual(["bar", "value-label"]);
  });

  it("value labels off → each values[i] binds exactly its bar; no labels / subtitle-only header", async () => {
    const off = await bindingsOf({ values: VALUES, valueLabels: { show: false, format: "compact", decimals: 1, suffix: "" }, subtitle: "FY26" });
    expect(off.rejected).toEqual([]);
    expect(Object.keys(off.byProp).sort()).toEqual(["barColor", "subtitle", "values"]);
    expect(off.byProp.values.map((b) => b.index)).toEqual(IDX);
    for (const i of IDX) expect(valueTagsByIndex(off).get(i)).toEqual(["bar"]);
    // subtitle-only header → the subtitle is the primary layer
    expect(off.byProp.subtitle).toHaveLength(1);
    expect(sourceAt(off.doc, [], off.byProp.subtitle[0].sourceIndex).editor?.label).toBe("card-header");

    const bare = await bindingsOf({ values: VALUES });
    expect(bare.rejected).toEqual([]);
    expect(Object.keys(bare.byProp).sort()).toEqual(["barColor", "values"]);
  });

  it("barColor rides EVERY bar tile as a second entry (kind \"color\") beside its values[i] — same source, value first; both orientations, animated + still", async () => {
    type Tile = Bound & { type?: string; color?: string; editor?: { label?: string; bindings?: Array<{ propKey: string }> } };
    const key = (b: { childPath: string[]; sourceIndex: number }) => `${b.childPath.join("/")}#${b.sourceIndex}`;
    for (const orientation of ["horizontal", "vertical"] as const) {
      for (const anim of [undefined, STILL]) {
        const r = await bindingsOf({ ...D, orientation, values: VALUES, labels: LABELS, barColor: "#ff0000", ...(anim ? { anim } : {}) });
        expect(r.rejected).toEqual([]);
        const bars = r.byProp.values.filter((b) => sourceAt(r.doc, b.childPath, b.sourceIndex).editor?.label === "bar");
        expect(bars).toHaveLength(VALUES.length);
        expect(bars.every((b) => b.kind === "number")).toBe(true);
        // one color entry per bar, on exactly the bar's source (childPath + sourceIndex)
        expect(r.byProp.barColor).toHaveLength(VALUES.length);
        expect(r.byProp.barColor.map(key).sort()).toEqual(bars.map(key).sort());
        for (const c of r.byProp.barColor) {
          expect(c.kind).toBe("color");
          expect("index" in c).toBe(false);
          const s = sourceAt(r.doc, c.childPath, c.sourceIndex) as Tile;
          expect(s.type).toBe("lavfi");
          expect(s.color).toBe("#ff0000"); // the bound tile's fill IS the prop
          expect(s.editor?.bindings?.map((e) => e.propKey)).toEqual(["values", "barColor"]); // entry order = importance
        }
        // the value-label TEXT never carries the color
        const labels = r.byProp.values.filter((b) => sourceAt(r.doc, b.childPath, b.sourceIndex).editor?.label === "value-label");
        expect(labels.length).toBeGreaterThan(0);
        expect(labels.some((b) => r.byProp.barColor.some((c) => key(c) === key(b)))).toBe(false);
      }
    }
    // unset → still bound (the theme primary paints; double-click is the handle to SET one)
    const d = await bindingsOf({ ...D, values: VALUES, anim: STILL });
    expect(d.rejected).toEqual([]);
    expect(d.byProp.barColor).toHaveLength(VALUES.length);
    expect(d.byProp.barColor.every((c) => c.kind === "color")).toBe(true);
  });
});
