import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete, getComplexityMetricsFast } from "@m0saic/dsl";
import { AlpineKpiCardV2 } from "./kpi-card";
import { resolvePropBindings, type PropBindingResolution } from "@m0saic/template-utils";

const W = 1280;
const H = 800;

function makeCtx(width = W, height = H, durationMs = 2000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width, height, fps: 30, durationMs },
    output: { width, height, fps: 30, durationMs, workspaceDir: "/tmp/alpine-kpi-v2" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const render = async (props: Record<string, unknown>, w = W, h = H) =>
  (await AlpineKpiCardV2.render(props as never, makeCtx(w, h))) as MosaicDocument;

const D = AlpineKpiCardV2.defaultProps as Record<string, unknown>;
const srcs = (doc: MosaicDocument) => (doc.sources ?? []) as MosaicSource[];
const isText = (s: MosaicSource) => (s as { type?: string }).type === "text";
const maskPath = (s: MosaicSource) => (s as { mask?: { localPath?: string } }).mask?.localPath ?? "";
const isTriangle = (s: MosaicSource) => { const p = maskPath(s); return !!p && p.length < 120 && (p.match(/L/g)?.length ?? 0) === 2; };
const isSparkArea = (s: MosaicSource) => maskPath(s).length > 500;
const colorOf = (s: MosaicSource) => (s as { color?: string }).color;
const fontColorsOf = (s: MosaicSource) => ((s as { layers?: Array<{ style?: { fontColor?: string } }> }).layers ?? []).map((l) => l.style?.fontColor);

const POSITIVE = "#16A34A";
const NEGATIVE = "#DC2626";
const PRIMARY = "#2563EB";

function expectFramesMatchSources(doc: MosaicDocument, w = W, h = H): void {
  expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  const parsed = parseM0StringComplete(doc.m0 as unknown as string, w, h);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe((doc.sources ?? []).length);
  expect((doc as { children?: unknown }).children).toBeUndefined();
}

describe("AlpineKpiCardV2 — metadata", () => {
  it("is the registered v2 primitive (not deprecated)", () => {
    expect(AlpineKpiCardV2.id).toBe("@m0saic/alpine/kpi-card/v2");
    expect(AlpineKpiCardV2.version).toBe(2);
    expect(AlpineKpiCardV2.primitive).toBe(true);
    expect((AlpineKpiCardV2 as { deprecated?: unknown }).deprecated).toBeUndefined();
    expect(AlpineKpiCardV2.tags).toEqual(expect.arrayContaining(["alpine", "kpi", "data-viz"]));
  });
});

describe("AlpineKpiCardV2 — render shape", () => {
  it("renders a valid m0 document; frames match sources (no children)", async () => {
    const doc = await render({ ...D });
    expectFramesMatchSources(doc);
    expect(doc.backgroundColor).toBeDefined();
    expect(srcs(doc).some(isText)).toBe(true);
  });

  it("is deterministic — identical inputs yield byte-identical m0", async () => {
    expect((await render({ ...D })).m0).toBe((await render({ ...D })).m0);
  });

  it("count-up: animated value is an expr (video) source; reduceMotion is a literal", async () => {
    const animated = await render({ ...D });
    const exprVal = srcs(animated).find((s) => isText(s) && (s as { renderMode?: { kind?: string } }).renderMode?.kind === "video");
    expect(exprVal).toBeDefined();
    const still = await render({ ...D, anim: { reduceMotion: true } });
    expect(srcs(still).some((s) => (s as { renderMode?: { kind?: string } }).renderMode?.kind === "video")).toBe(false);
  });
});

describe("AlpineKpiCardV2 — RATIO precision (the v2 win)", () => {
  const precAt = async (w: number, h: number) => {
    const d = await render({ ...D, anim: { reduceMotion: true } }, w, h);
    const m = getComplexityMetricsFast(d.m0 as unknown as string);
    return { x: m.precision.maxSplitX, y: m.precision.maxSplitY };
  };
  it("sparkline no longer pins the canvas: precision flat across a 2× sweep", async () => {
    const lo = await precAt(1280, 800);
    const hi = await precAt(2560, 1600);
    // v1 roughly DOUBLED here (320→640). The content-hug pill's px weights
    // shift the basis ±1 across canvases — flat within a hair, never tracking.
    expect(Math.abs(hi.x - lo.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(hi.y - lo.y)).toBeLessThanOrEqual(2);
    expect(lo.x).toBeLessThanOrEqual(160);
    expect(lo.y).toBeLessThanOrEqual(160);
  });
});

describe("AlpineKpiCardV2 — delta pill", () => {
  it("up / down render a triangle arrow; flat and no-delta render none", async () => {
    expect(srcs(await render({ ...D, direction: "up" })).some(isTriangle)).toBe(true);
    expect(srcs(await render({ ...D, direction: "down", delta: "-3%" })).some(isTriangle)).toBe(true);
    expect(srcs(await render({ ...D, direction: "flat", delta: "0%" })).some(isTriangle)).toBe(false);
    expect(srcs(await render({ ...D, delta: "" })).some(isTriangle)).toBe(false);
  });
});

describe("AlpineKpiCardV2 — direction-aware sparkline", () => {
  it("color tracks direction: up=positive, down=negative, flat=primary", async () => {
    const up = srcs(await render({ ...D, direction: "up" })).find(isSparkArea);
    const down = srcs(await render({ ...D, direction: "down", delta: "-3%" })).find(isSparkArea);
    const flat = srcs(await render({ ...D, direction: "flat", delta: "0%" })).find(isSparkArea);
    expect(colorOf(up!)).toBe(POSITIVE);
    expect(colorOf(down!)).toBe(NEGATIVE);
    expect(colorOf(flat!)).toBe(PRIMARY);
  });

  it("auto-generates a trend when no data is given; explicit data still wins", async () => {
    expect(srcs(await render({ label: "x", value: "9", direction: "up" })).some(isSparkArea)).toBe(true);
    expect(srcs(await render({ label: "x", value: "9", direction: "down", delta: "-1%" })).some(isSparkArea)).toBe(true);
  });

  it("explicit [] hides the sparkline; explicit data shows it", async () => {
    expect(srcs(await render({ label: "x", value: "9", sparkline: [] })).some(isSparkArea)).toBe(false);
    expect(srcs(await render({ label: "x", value: "9", sparkline: [1, 5, 3, 8] })).some(isSparkArea)).toBe(true);
  });
});

describe("AlpineKpiCardV2 — color knobs fail safe", () => {
  it("a cleared / 'none' / blank valueColor falls back to the theme (never blanks the value)", async () => {
    for (const vc of ["", "none", "  "]) {
      const doc = await render({ label: "x", value: "4.8%", valueColor: vc, anim: { reduceMotion: true } });
      expect(srcs(doc).flatMap(fontColorsOf).some((c) => !c || c === "" || c === "none")).toBe(false);
      expectFramesMatchSources(doc);
    }
  });

  it("an explicit valueColor is honored", async () => {
    const doc = await render({ label: "x", value: "9", valueColor: "#FF0000", anim: { reduceMotion: true } });
    expect(srcs(doc).flatMap(fontColorsOf)).toContain("#FF0000");
  });
});

describe("AlpineKpiCardV2 — edge cases", () => {
  it("non-numeric value renders (count-up no-ops, no garble)", async () => {
    expectFramesMatchSources(await render({ label: "x", value: "N/A" }));
  });

  it("title/subtitle header, no-delta, no-sublabel, dark, long value all valid", async () => {
    expectFramesMatchSources(await render({ ...D, title: "Q2", subtitle: "Finance", preset: "dark" }));
    expectFramesMatchSources(await render({ ...D, delta: "" }));
    expectFramesMatchSources(await render({ ...D, sublabel: "" }));
    expectFramesMatchSources(await render({ label: "REV", value: "$1,284,500", delta: "+8.3%", direction: "up" }));
  });

  it("rejects an empty value with an error mosaic, not a throw", async () => {
    const doc = await render({ label: "x", value: "" });
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  });
});

describe("AlpineKpiCardV2 — two-mode reveal + theming", () => {
  const timeAlpha = (s: MosaicSource) => { const a = (s as { overlay?: { alpha?: string } }).overlay?.alpha; return a != null && /\blt\b|\bt\b/.test(String(a)); };
  const enableOf = (s: MosaicSource) => (s as { overlay?: { enable?: string } }).overlay?.enable;
  const themedCtx = (tokens: Record<string, unknown>): MosaicEngineContext =>
    ({ mode: "render", target: { width: 1280, height: 800, fps: 30, durationMs: 2000 }, output: {}, media: {}, upstreamData: { theme: tokens } } as unknown as MosaicEngineContext);

  it("premium (default): soft alpha fades (a geq) — no enable gates", async () => {
    const all = srcs(await render({ ...D }));
    expect(all.some(timeAlpha)).toBe(true);
    expect(all.some((s) => enableOf(s) != null)).toBe(false);
  });

  it("light: geq-free — zero time-varying alpha; enable gates present", async () => {
    const all = srcs(await render({ ...D, anim: { renderMode: "light" } }));
    expect(all.some(timeAlpha)).toBe(false);
    expect(all.some((s) => enableOf(s) != null)).toBe(true);
  });

  it("a producer theme recolors the card; explicit valueColor still wins", async () => {
    const plain = JSON.stringify(await render({ ...D }));
    expect(plain).not.toContain("#101820");
    const themed = JSON.stringify((await AlpineKpiCardV2.render(D as never, themedCtx({ surface: "#101820" }))) as MosaicDocument);
    expect(themed).toContain("#101820");
    const explicit = JSON.stringify((await AlpineKpiCardV2.render({ ...D, valueColor: "#123456" } as never, themedCtx({ textPrimary: "#00FFCC" }))) as MosaicDocument);
    expect(explicit).toContain("#123456");
  });
});

describe("AlpineKpiCardV2 — content-hug pill + value width-cap + contract (gate 6)", () => {
  const STILL = { renderMode: "premium", introFrac: 0.7, countUp: true, easing: "easeOut", reduceMotion: true } as const;

  it("contract (delta-pill width bounds) passes at the stretch-repro canvases", async () => {
    for (const [w, h] of [[1280, 708], [1920, 480], [720, 1280], [640, 360], [359, 641]] as Array<[number, number]>) {
      const doc = await render({ ...D, anim: STILL, debugLayout: true }, w, h);
      expect((doc as { editor?: { layoutContract?: { ok?: boolean } } }).editor?.layoutContract?.ok).toBe(true);
    }
  });

  it("value font width-caps at narrow canvases (no more clipped $48,25)", async () => {
    const wide = await render({ ...D, anim: STILL }, 1280, 708);
    const narrow = await render({ ...D, anim: STILL }, 720, 1280);
    const valueFontOf = (doc: MosaicDocument): number => {
      const sizes = ((doc.sources ?? []) as MosaicSource[])
        .filter((s) => (s as { type?: string }).type === "text")
        .flatMap((s) => ((s as { layers?: Array<{ style?: { fontSize?: number } }> }).layers ?? []).map((l) => l.style?.fontSize ?? 0));
      return Math.max(...sizes);
    };
    // 720×1280: H-scaled font would be 192px; the width cap binds far below it.
    expect(valueFontOf(narrow)).toBeLessThanOrEqual(Math.floor((720 * 0.94) / ((D.value as string).length * 0.62)) + 1);
    expect(valueFontOf(wide)).toBeGreaterThan(valueFontOf(narrow) * 0.5); // sanity: wide stays big
  });

  it("debugLayout off (default) leaves the doc unstamped — zero-cost path", async () => {
    const doc = await render({ ...D, anim: STILL });
    expect((doc as { editor?: { layoutContract?: unknown } }).editor?.layoutContract).toBeUndefined();
  });

  it("no delta → no pill tag, contract trivially green", async () => {
    const doc = await render({ ...D, anim: STILL, delta: "", debugLayout: true });
    const tags = ((doc.sources ?? []) as MosaicSource[]).filter((s) => (s as { editor?: { label?: string } }).editor?.label === "delta-pill");
    expect(tags.length).toBe(0);
    expect((doc as { editor?: { layoutContract?: { ok?: boolean } } }).editor?.layoutContract?.ok).toBe(true);
  });
});

describe("AlpineKpiCardV2 — pinned pill + triangle aspect + cover (gate 6, take 2)", () => {
  const STILL = { renderMode: "premium", introFrac: 0.7, countUp: true, easing: "easeOut", reduceMotion: true } as const;

  it("contract (pill width bounds; arrow-aspect deferred to the zip-misalignment candidate) passes at hostile canvases", async () => {
    for (const [w, h] of [[1280, 708], [1920, 480], [720, 1280], [640, 360], [900, 900], [733, 977]] as Array<[number, number]>) {
      const doc = await render({ ...D, anim: STILL, debugLayout: true }, w, h);
      expect((doc as { editor?: { layoutContract?: { ok?: boolean } } }).editor?.layoutContract?.ok).toBe(true);
    }
  });

  it("the arrow tile carries the contract tag", async () => {
    const doc = await render({ ...D, anim: STILL });
    const arrows = ((doc.sources ?? []) as MosaicSource[]).filter((s) => (s as { editor?: { label?: string } }).editor?.label === "delta-arrow");
    expect(arrows.length).toBe(1);
  });

  it("declares a branded cover: pane + inlined default render, self-contained", async () => {
    expect(typeof AlpineKpiCardV2.renderCover).toBe("function");
    const doc = (await AlpineKpiCardV2.renderCover!({} as never, makeCtx())) as MosaicDocument;
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    const s = JSON.stringify(doc.sources);
    expect(s).toContain("KPI Card");
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
    const a = (await AlpineKpiCardV2.renderCover!({} as never, makeCtx())) as MosaicDocument;
    const b = (await AlpineKpiCardV2.renderCover!({} as never, makeCtx())) as MosaicDocument;
    expect(a.m0).toBe(b.m0);
  });
});

describe("AlpineKpiCardV2 — prop bindings (Make inline edit)", () => {
  const schema = AlpineKpiCardV2.propsSchema;
  const bindingsOf = async (props: Record<string, unknown>, w = W, h = H) => {
    const doc = await render(props, w, h);
    return { doc, ...resolvePropBindings(doc, w, h, { propsSchema: schema }) };
  };
  const labelAt = (doc: MosaicDocument, i: number) => (srcs(doc)[i] as { editor?: { label?: string } }).editor?.label;
  const contentAt = (doc: MosaicDocument, i: number) =>
    (srcs(doc)[i] as { layers?: Array<{ content?: { kind?: string; text?: string } }> }).layers?.[0]?.content;
  const one = (r: PropBindingResolution, key: string) => {
    expect(r.byProp[key]).toHaveLength(1);
    const b = r.byProp[key][0];
    expect("index" in b).toBe(false);
    expect(b.childPath).toEqual([]);
    return b;
  };

  it("binds label / value / delta / sublabel to their rects; title rides the alpineCard header (primary layer)", async () => {
    const r = await bindingsOf({ ...D, title: "Revenue", subtitle: "FY26" });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["delta", "label", "sublabel", "subtitle", "title", "value", "valueColor"]);
    expect(labelAt(r.doc, one(r, "label").sourceIndex)).toBe("kpi-label");
    expect(labelAt(r.doc, one(r, "delta").sourceIndex)).toBe("kpi-delta");
    expect(labelAt(r.doc, one(r, "sublabel").sourceIndex)).toBe("kpi-sublabel");
    expect(labelAt(r.doc, one(r, "title").sourceIndex)).toBe("card-header");
    // default anim counts the value up → the bound rect is the (untagged) expr-text source
    expect(contentAt(r.doc, one(r, "value").sourceIndex)?.kind).toBe("expr");
    // one binding per source: the two-layer header binds title only
    expect(r.byProp.subtitle).toHaveLength(1); // second header layer binds too (stacked Title / Subtitle form)
    expect(r.byProp.subtitle[0].layer).toBe(1);
    expect(r.byProp.subtitle[0].sourceIndex).toBe(r.byProp.title[0].sourceIndex);
  });

  it("static value (reduceMotion) binds the tagged kpi-value rect; subtitle-only header binds subtitle", async () => {
    const r = await bindingsOf({ ...D, subtitle: "FY26", anim: { reduceMotion: true } });
    expect(r.rejected).toEqual([]);
    const v = one(r, "value");
    expect(labelAt(r.doc, v.sourceIndex)).toBe("kpi-value");
    expect(contentAt(r.doc, v.sourceIndex)?.text).toBe(D.value);
    expect(labelAt(r.doc, one(r, "subtitle").sourceIndex)).toBe("card-header");
    expect(r.byProp.title).toBeUndefined();
  });

  it("no delta / no sublabel → no rect → no binding (never adds a rect); the sparkline never binds; valueColor rides the value rect", async () => {
    const bare = await bindingsOf({ label: "Score", value: "86", sparkline: [1, 2, 3], valueColor: "#ff0000" });
    expect(bare.rejected).toEqual([]);
    expect(Object.keys(bare.byProp).sort()).toEqual(["label", "value", "valueColor"]);
    // sublabel without a delta still owns its own rect
    const sub = await bindingsOf({ label: "Score", value: "86", sublabel: "vs last month" });
    expect(sub.rejected).toEqual([]);
    expect(Object.keys(sub.byProp).sort()).toEqual(["label", "sublabel", "value", "valueColor"]);
    expect(labelAt(sub.doc, one(sub, "sublabel").sourceIndex)).toBe("kpi-sublabel");
  });

  it("binds the same set for every direction × render mode and at a portrait canvas", async () => {
    for (const direction of ["up", "down", "flat"]) {
      for (const renderMode of ["premium", "light"]) {
        const r = await bindingsOf({ ...D, direction, anim: { ...(D.anim as object), renderMode } });
        expect(r.rejected).toEqual([]);
        expect(Object.keys(r.byProp).sort()).toEqual(["delta", "label", "sublabel", "value", "valueColor"]);
      }
    }
    const portrait = await bindingsOf({ ...D }, 720, 1280);
    expect(portrait.rejected).toEqual([]);
    expect(Object.keys(portrait.byProp).sort()).toEqual(["delta", "label", "sublabel", "value", "valueColor"]);
  });

  it("valueColor rides the VALUE rect as a second entry (kind \"color\") — same source, value first; count-up and static alike", async () => {
    const entriesAt = (doc: MosaicDocument, i: number) =>
      ((srcs(doc)[i] as { editor?: { bindings?: Array<{ propKey: string; kind?: string }> } }).editor?.bindings ?? []).map((e) => e.propKey);
    for (const anim of [D.anim, { ...(D.anim as object), reduceMotion: true }]) {
      const r = await bindingsOf({ ...D, valueColor: "#ff0000", anim });
      expect(r.rejected).toEqual([]);
      const v = one(r, "value");
      const c = one(r, "valueColor");
      expect(v.kind).toBe("string");
      expect(c.kind).toBe("color");
      expect(c.sourceIndex).toBe(v.sourceIndex); // ONE rect, two entries → a stacked value + color form
      expect(fontColorsOf(srcs(r.doc)[v.sourceIndex])).toEqual(["#ff0000"]); // the bound rect's ink IS the prop
      expect(entriesAt(r.doc, v.sourceIndex)).toEqual(["value", "valueColor"]); // entry order = importance
      // no other rect carries the color
      expect(Object.values(r.byProp).flat().filter((b) => b.kind === "color")).toHaveLength(1);
    }
    // unset → still bound (the theme title color paints; double-click is the handle to SET one)
    const d = await bindingsOf({ ...D });
    expect(d.rejected).toEqual([]);
    expect(one(d, "valueColor").kind).toBe("color");
    expect(one(d, "valueColor").sourceIndex).toBe(one(d, "value").sourceIndex);
  });
});
