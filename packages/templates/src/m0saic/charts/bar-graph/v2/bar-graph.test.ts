import type { MosaicDocument, MosaicEngineContext, MosaicSource, MosaicThemeTokens } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete } from "@m0saic/dsl";
import { ChartsBarGraphV2 } from "./bar-graph";

const W = 1280;
const H = 720;

function makeCtx(upstreamTheme?: Partial<MosaicThemeTokens>): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: W, height: H, fps: 30, durationMs: 2000 },
    output: { width: W, height: H, fps: 30, durationMs: 2000, workspaceDir: "/tmp/bar-graph-v2" },
    media: {},
    ...(upstreamTheme ? { upstreamData: { theme: upstreamTheme } } : {}),
  } as unknown as MosaicEngineContext;
}

const render = async (props: Record<string, unknown>, upstreamTheme?: Partial<MosaicThemeTokens>) =>
  (await ChartsBarGraphV2.render(props as never, makeCtx(upstreamTheme))) as MosaicDocument;

const childrenOf = (doc: MosaicDocument): Record<string, MosaicDocument> =>
  (doc as { children?: Record<string, MosaicDocument> }).children ?? {};

/** Every source the doc paints, flattened across the top-level doc + child docs. */
function allSources(doc: MosaicDocument): MosaicSource[] {
  const out = [...((doc.sources ?? []) as MosaicSource[])];
  const kids = childrenOf(doc);
  for (const k of Object.keys(kids)) out.push(...((kids[k].sources ?? []) as MosaicSource[]));
  return out;
}

/** Frames the engine will paint == sources it will consume — a render-validity invariant. */
function expectFramesMatchSources(m0: string, sourceCount: number): void {
  expect(isValidM0String(m0)).toBe(true);
  const parsed = parseM0StringComplete(m0, W, H);
  expect(parsed.ok).toBe(true);
  expect(parsed.ok ? parsed.ir.renderFrames.length : -1).toBe(sourceCount);
}

const overlayOf = (s: MosaicSource) => (s as { overlay?: { alpha?: string; enable?: string; xExpr?: string; yExpr?: string; startAtSec?: number } }).overlay;
const colorOf = (s: MosaicSource) => (s as { color?: string }).color;
const isText = (s: MosaicSource) => (s as { type?: string }).type === "text";
const isLavfiColor = (s: MosaicSource) => (s as { type?: string }).type === "lavfi" && colorOf(s) !== undefined;
// An animated grow-in bar carries `overlay.startAtSec` (its per-bar reveal start) —
// true in BOTH modes. Gridlines/edge strips also use overlay x/yExpr for position
// but never carry startAtSec, so this cleanly isolates the bars.
const isGrowBar = (s: MosaicSource) => isLavfiColor(s) && overlayOf(s)?.startAtSec != null;
// A plain bar tile (animated fill or static reduceMotion bar): a color tile with
// neither the line-strip fitMode nor the card's effects.
const isBarTile = (s: MosaicSource) => isLavfiColor(s) && !(s as { fitMode?: string }).fitMode && !(s as { effects?: unknown }).effects;

const NEUTRAL = { bar: "#f97316", surfaceApp: "#0b0f14", surface: "#0f172a", textPrimary: "#f1f5f9" };

describe("ChartsBarGraphV2 — document shape", () => {
  it("is registered as v2 and not deprecated", () => {
    expect(ChartsBarGraphV2.version).toBe(2);
    expect((ChartsBarGraphV2 as { deprecated?: unknown }).deprecated).toBeUndefined();
  });

  const cases: Array<[string, Record<string, unknown>]> = [
    ["defaults", ChartsBarGraphV2.defaultProps as Record<string, unknown>],
    ["vertical + titles + labels + preset", { values: [35, 60, 85, 45, 70], titles: { title: "T", subtitle: "S" }, labels: ["a", "b", "c", "d", "e"], appearance: { preset: "terminal" } }],
    ["horizontal + labels", { values: [35, 60, 85, 45, 70], labels: ["a", "b", "c", "d", "e"], layout: { orientation: "horizontal" }, titles: { title: "T" } }],
    ["light mode", { values: [35, 60, 85], anim: { renderMode: "light" }, labels: ["a", "b", "c"] }],
    ["no grid", { values: [10, 20, 30], grid: { show: false, count: 5 } }],
    ["explicit domain", { values: [50, 80], domain: { minValue: 0, maxValue: 100 }, labels: ["x", "y"] }],
    ["fixed barThickness (centered)", { values: [40, 70, 55], layout: { barThickness: 90 }, labels: ["a", "b", "c"] }],
    ["single bar", { values: [42], labels: ["only"] }],
    ["flush gap", { values: [3, 7, 5], layout: { gap: 0 } }],
  ];

  it.each(cases)("valid m0 with frames == sources — top-level AND every child doc: %s", async (_label, props) => {
    const doc = await render(props);
    expectFramesMatchSources(String(doc.m0), doc.sources!.length);
    const kids = childrenOf(doc);
    for (const k of Object.keys(kids)) expectFramesMatchSources(String(kids[k].m0), kids[k].sources!.length);
    expect(allSources(doc).length).toBeGreaterThan(0);
  });

  it("wraps the plot in a child doc (its buffer clips the grow-in bars at the baseline)", async () => {
    const doc = await render({ values: [35, 60, 85] });
    expect(childrenOf(doc).plot).toBeDefined();
  });

  it("is deterministic — identical props produce byte-identical output (both modes)", async () => {
    const shape = (d: MosaicDocument) => JSON.stringify({ m0: d.m0, sources: d.sources, children: childrenOf(d) });
    for (const renderMode of ["premium", "light"] as const) {
      const props = { values: [35, 60, 85, 45, 70], labels: ["a", "b", "c", "d", "e"], titles: { title: "T" }, anim: { renderMode } };
      const a = await render(props);
      const b = await render(props);
      expect(shape(a)).toBe(shape(b));
    }
  });

  it("fails fast (error mosaic, not a throw) on empty values", async () => {
    const doc = await render({ values: [] });
    expect(isValidM0String(String(doc.m0))).toBe(true);
  });
});

describe("ChartsBarGraphV2 — reveal modes (premium fade vs light enable-gate)", () => {
  it("premium (default): bars grow AND fade — overlay carries alpha + the grow expr", async () => {
    const doc = await render({ values: [35, 60, 85, 45, 70] }); // default renderMode = premium
    const bars = allSources(doc).filter(isGrowBar);
    expect(bars.length).toBe(5);
    bars.forEach((s) => {
      expect(overlayOf(s)!.alpha).toBeDefined();      // fade (the geq)
      expect(overlayOf(s)!.yExpr).toBeDefined();       // vertical grow slide
      expect(overlayOf(s)!.xExpr).toBeUndefined();
    });
    // No transparent base tiles — the clip is the nested plot child's buffer.
    expect(allSources(doc).some((s) => colorOf(s) === "black@0")).toBe(false);
  });

  it("light: bars grow opaquely — overlay carries the grow expr but NO alpha (no geq)", async () => {
    const doc = await render({ values: [35, 60, 85, 45, 70], anim: { renderMode: "light" } });
    const bars = allSources(doc).filter(isGrowBar);
    expect(bars.length).toBe(5);
    bars.forEach((s) => {
      expect(overlayOf(s)!.alpha).toBeUndefined();     // no fade → no per-pixel geq
      expect(overlayOf(s)!.yExpr).toBeDefined();        // grow slide kept
    });
    // No animated alpha ANYWHERE in light mode (bars or labels).
    expect(allSources(doc).some((s) => overlayOf(s)?.alpha != null)).toBe(false);
  });

  it("horizontal bars grow on X (xExpr), not Y — both modes", async () => {
    for (const renderMode of ["premium", "light"] as const) {
      const doc = await render({ values: [35, 60, 85], layout: { orientation: "horizontal" }, anim: { renderMode } });
      const bars = allSources(doc).filter(isGrowBar);
      expect(bars.length).toBe(3);
      bars.forEach((s) => {
        expect(overlayOf(s)!.xExpr).toBeDefined();
        expect(overlayOf(s)!.yExpr).toBeUndefined();
      });
    }
  });

  it("value labels: premium fades (alpha), light enable-gates (enable) — never both", async () => {
    const vl = { show: true, format: "compact", decimals: 0, suffix: "" };
    const premium = await render({ values: [35, 60, 85, 45, 70], valueLabels: vl });
    expect(allSources(premium).filter((s) => isText(s) && overlayOf(s)?.alpha).length).toBe(5);
    expect(allSources(premium).filter((s) => isText(s) && overlayOf(s)?.enable).length).toBe(0);

    const light = await render({ values: [35, 60, 85, 45, 70], valueLabels: vl, anim: { renderMode: "light" } });
    expect(allSources(light).filter((s) => isText(s) && overlayOf(s)?.enable).length).toBe(5);
    expect(allSources(light).filter((s) => isText(s) && overlayOf(s)?.alpha).length).toBe(0);
    // enable is the raw (unescaped) gate form the engine escapes itself.
    const enabled = allSources(light).find((s) => isText(s) && overlayOf(s)?.enable);
    expect(overlayOf(enabled!)!.enable).toMatch(/^gte\(t,[0-9.]+\)$/);
  });

  it("reduceMotion → static bars (no overlay) + static labels, in BOTH modes", async () => {
    for (const renderMode of ["premium", "light"] as const) {
      const doc = await render({ values: [35, 60, 85], valueLabels: { show: true, format: "raw", decimals: 0, suffix: "" }, anim: { renderMode, reduceMotion: true } });
      const bars = allSources(doc).filter(isBarTile);
      expect(bars.length).toBe(3);
      bars.forEach((s) => expect(overlayOf(s)).toBeUndefined());
      expect(allSources(doc).filter((s) => isText(s) && (overlayOf(s)?.alpha || overlayOf(s)?.enable)).length).toBe(0);
    }
  });
});

describe("ChartsBarGraphV2 — theming", () => {
  it("unthemed default renders the neutral preset colors (byte-stable palette)", async () => {
    const doc = await render(ChartsBarGraphV2.defaultProps as Record<string, unknown>);
    const s = JSON.stringify({ sources: doc.sources, children: childrenOf(doc), bg: doc.backgroundColor });
    expect(doc.backgroundColor).toBe(NEUTRAL.surfaceApp);   // surfaceApp ← preset bg
    expect(s).toContain(NEUTRAL.bar);                        // bar fill
    expect(s).toContain(NEUTRAL.textPrimary);               // title / value labels
  });

  it("a producer theme block overrides surface / text / dataPalette", async () => {
    const pub = { surfaceApp: "#123456", surface: "#654321", textPrimary: "#abcdef", dataPalette: ["#ff00ff"] } as Partial<MosaicThemeTokens>;
    // clear barColor so the producer dataPalette can show through
    const doc = await render({ ...(ChartsBarGraphV2.defaultProps as Record<string, unknown>), appearance: { barColor: undefined }, theme: {} }, pub);
    expect(doc.backgroundColor).toBe("#123456");
    const s = JSON.stringify({ sources: doc.sources, children: childrenOf(doc) });
    expect(s).toContain("#654321"); // surface (card)
    expect(s).toContain("#abcdef"); // textPrimary
    expect(s).toContain("#ff00ff"); // dataPalette[0] (bars)
  });

  it("explicit appearance.barColor wins over a producer's dataPalette", async () => {
    const pub = { dataPalette: ["#ff00ff"] } as Partial<MosaicThemeTokens>;
    const doc = await render({ values: [10, 20, 30], appearance: { barColor: "#00ff00" }, theme: {} }, pub);
    const s = JSON.stringify({ sources: doc.sources, children: childrenOf(doc) });
    expect(s).toContain("#00ff00");
    expect(s).not.toContain("#ff00ff");
  });
});

describe("ChartsBarGraphV2 — domain (nice axis)", () => {
  const tickTexts = (doc: MosaicDocument) =>
    (allSources(doc).filter(isText) as Array<{ layers?: Array<{ content?: { text?: string } }> }>)
      .map((s) => s.layers?.[0]?.content?.text ?? "");

  it("snaps an auto domain to round numbers so the top tick is a nice max", async () => {
    // values max 85 → nice max 100, 5 intervals → tick rail 0..100.
    const texts = tickTexts(await render({ values: [35, 60, 85, 45, 70] }));
    expect(texts).toContain("100");
    expect(texts).toContain("0");
  });

  it("honors an explicit domain verbatim (no nice rounding)", async () => {
    const texts = tickTexts(await render({ values: [50, 80], domain: { minValue: 0, maxValue: 90 }, grid: { show: true, count: 3 } }));
    expect(texts).toContain("90");
  });
});

describe("ChartsBarGraphV2 — first-open cover (mosaic-branding theme)", () => {
  const coverCtx = {
    mode: "render" as const,
    target: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    output: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    media: {},
  } as unknown as MosaicEngineContext;

  it("branded pane + the template's own default render INLINED as hero", async () => {
    expect(typeof ChartsBarGraphV2.renderCover).toBe("function");
    const doc = (await ChartsBarGraphV2.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    const s = JSON.stringify(doc.sources);
    expect(s).toContain("Bar Graph");
    // Band variant: no conversation pane, just brand + title.
    expect(s).not.toContain("START HERE");
    expect(s).not.toContain('"type":"mosaic","ref":"cover');
  });

  it("cover is deterministic", async () => {
    const a = (await ChartsBarGraphV2.renderCover!({} as never, coverCtx)) as MosaicDocument;
    const b = (await ChartsBarGraphV2.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(a.m0).toBe(b.m0);
  });
});

// ── Prop bindings — labels / values / titles map to the rects that show them ─
import { resolvePropBindings } from "@m0saic/template-utils";

describe("ChartsBarGraphV2 — prop bindings (Make inline edit)", () => {
  const schema = ChartsBarGraphV2.propsSchema;
  const VALUES = [12, 40, 7, 25];
  const LABELS = ["Q1", "Q2", "Q3", "Q4"];
  const bindingsOf = async (props: Record<string, unknown>) => {
    const doc = await render(props);
    return { doc, ...resolvePropBindings(doc, W, H, { propsSchema: schema }) };
  };
  const labelOfSource = (doc: MosaicDocument, childPath: string[], i: number): string | undefined => {
    const owner = childPath.length ? childrenOf(doc)[childPath[0]] : doc;
    return ((owner.sources ?? [])[i] as { editor?: { label?: string } }).editor?.label;
  };

  for (const orientation of ["vertical", "horizontal"] as const) {
    it(`${orientation}: labels[i] → cat-label rects (root), values[i] → bars + value labels (plot child)`, async () => {
      const r = await bindingsOf({ values: VALUES, labels: LABELS, orientation, titles: { title: "Sales", subtitle: "FY26" } });
      expect(r.rejected).toEqual([]);

      // category labels: one per bar, index-aligned, in the ROOT doc
      expect(r.byProp.labels.map((b) => b.index)).toEqual([0, 1, 2, 3]);
      for (const b of r.byProp.labels) {
        expect(b.childPath).toEqual([]);
        expect(labelOfSource(r.doc, b.childPath, b.sourceIndex)).toBe("cat-label");
      }

      // values: every index has at least the bar (a value label may be dropped
      // on tall bars), all inside the clipping `plot` child
      const perIndex = new Map<number, string[]>();
      for (const b of r.byProp.values) {
        expect(b.childPath).toEqual(["plot"]);
        const lbl = labelOfSource(r.doc, b.childPath, b.sourceIndex);
        expect(["bar", "value-label"]).toContain(lbl);
        perIndex.set(b.index!, [...(perIndex.get(b.index!) ?? []), lbl!]);
      }
      expect([...perIndex.keys()].sort()).toEqual([0, 1, 2, 3]);
      for (const i of [0, 1, 2, 3]) expect(perIndex.get(i)).toContain("bar");

      // header: ONE rect, two layers → title (layer 0) + subtitle (layer 1) both bind it
      expect(r.byProp["titles.title"]).toHaveLength(1);
      expect(r.byProp["titles.title"][0].childPath).toEqual([]);
      expect(r.byProp["titles.title"][0].layer).toBe(0);
      expect(labelOfSource(r.doc, [], r.byProp["titles.title"][0].sourceIndex)).toBe("chart-header");
      expect(r.byProp["titles.subtitle"]).toHaveLength(1);
      expect(r.byProp["titles.subtitle"][0].layer).toBe(1);
      expect(r.byProp["titles.subtitle"][0].sourceIndex).toBe(r.byProp["titles.title"][0].sourceIndex);
    });
  }

  it("subtitle-only header binds titles.subtitle; no header → no title binding", async () => {
    const sub = await bindingsOf({ values: VALUES, titles: { subtitle: "FY26" } });
    expect(sub.rejected).toEqual([]);
    expect(sub.byProp["titles.subtitle"]).toHaveLength(1);
    expect(sub.byProp["titles.title"]).toBeUndefined();

    const none = await bindingsOf({ values: VALUES });
    expect(none.rejected).toEqual([]);
    expect(none.byProp["titles.title"]).toBeUndefined();
    expect(none.byProp["titles.subtitle"]).toBeUndefined();
    expect(none.byProp.labels).toBeUndefined();
    expect(none.byProp.values.length).toBeGreaterThanOrEqual(VALUES.length);
  });
});
