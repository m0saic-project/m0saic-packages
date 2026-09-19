import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete } from "@m0saic/dsl";
import { resolvePropBindings } from "@m0saic/template-utils";
import { AlpineProgressCard } from "./progress-card";

const W = 1280;
const H = 800;

function makeCtx(durationMs = 2000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: W, height: H, fps: 30, durationMs },
    output: { width: W, height: H, fps: 30, durationMs, workspaceDir: "/tmp/alpine-progress" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const render = async (props: Record<string, unknown>, durationMs?: number) =>
  (await AlpineProgressCard.render(props as never, makeCtx(durationMs))) as MosaicDocument;

const D = AlpineProgressCard.defaultProps as Record<string, unknown>;

const childrenOf = (doc: MosaicDocument): Record<string, MosaicDocument> =>
  (doc as { children?: Record<string, MosaicDocument> }).children ?? {};

/** Sources flattened across the top doc + any child docs (the grow-clip plot). */
function allSources(doc: MosaicDocument): MosaicSource[] {
  const out = [...((doc.sources ?? []) as MosaicSource[])];
  for (const c of Object.values(childrenOf(doc))) out.push(...((c.sources ?? []) as MosaicSource[]));
  return out;
}

/** Frames the engine paints == sources it consumes, at EVERY doc tier. */
function expectFramesMatchSources(doc: MosaicDocument): void {
  const check = (d: MosaicDocument) => {
    expect(isValidM0String(d.m0 as unknown as string)).toBe(true);
    const parsed = parseM0StringComplete(d.m0 as unknown as string, W, H);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe((d.sources ?? []).length);
  };
  check(doc);
  for (const c of Object.values(childrenOf(doc))) check(c);
}

const colorOf = (s: MosaicSource) => (s as { color?: string }).color;
const effectsOf = (s: MosaicSource) => (s as { effects?: { rounding?: unknown; stroke?: unknown } }).effects;
// A bar (track or fill) is a ROUNDED lavfi tile WITHOUT a stroke. The card surface
// is also rounded but carries a stroke (its border) — so stroke-absence excludes it.
const isBar = (s: MosaicSource) => (s as { type?: string }).type === "lavfi" && !!effectsOf(s)?.rounding && !effectsOf(s)?.stroke;
const overlayOf = (s: MosaicSource) => (s as { overlay?: { xExpr?: string } }).overlay;
const isText = (s: MosaicSource) => (s as { type?: string }).type === "text";
const TRACK = "#E2E8F0"; // theme.grid (light preset)
const isFill = (s: MosaicSource) => isBar(s) && colorOf(s) !== TRACK;

describe("AlpineProgressCard — metadata", () => {
  it("is the registered v1 primitive, not deprecated", () => {
    expect(AlpineProgressCard.id).toBe("@m0saic/alpine/progress-card/v1");
    expect(AlpineProgressCard.version).toBe(1);
    expect(AlpineProgressCard.primitive).toBe(true);
    expect((AlpineProgressCard as { deprecated?: unknown }).deprecated).toBeUndefined();
    expect(AlpineProgressCard.tags).toEqual(expect.arrayContaining(["alpine", "progress", "data-viz"]));
  });
});

describe("AlpineProgressCard — render shape", () => {
  it("renders valid m0 at every tier; frames match sources", async () => {
    const doc = await render({ ...D });
    expectFramesMatchSources(doc);
    expect(doc.backgroundColor).toBeDefined();
  });

  it("animated → fills carry a grow overlay + a clipping `plot` child; static → neither", async () => {
    const animated = await render({ ...D });
    expect(childrenOf(animated).plot).toBeDefined();
    expect(allSources(animated).filter(isFill).every((f) => overlayOf(f)?.xExpr != null)).toBe(true);

    const still = await render({ ...D, anim: { reduceMotion: true } });
    expect(childrenOf(still).plot).toBeUndefined();
    expect(allSources(still).filter(isFill).some((f) => overlayOf(f)?.xExpr != null)).toBe(false);
  });

  it("paints one fill per positive-value item", async () => {
    const doc = await render({ items: [{ label: "a", value: 50 }, { label: "b", value: 80 }, { label: "c", value: 20 }] });
    expect(allSources(doc).filter(isFill).length).toBe(3);
  });

  it("is deterministic — identical inputs yield byte-identical m0", async () => {
    expect((await render({ ...D })).m0).toBe((await render({ ...D })).m0);
  });
});

describe("AlpineProgressCard — colors", () => {
  it("default fills cycle the Alpine palette; a global barColor overrides all", async () => {
    const def = allSources(await render({ items: [{ label: "a", value: 50 }, { label: "b", value: 50 }] })).filter(isFill).map(colorOf);
    expect(new Set(def).size).toBeGreaterThan(1); // distinct palette colors

    const one = allSources(await render({ items: [{ label: "a", value: 50 }, { label: "b", value: 50 }], barColor: "#123456" })).filter(isFill).map(colorOf);
    expect(one.every((c) => c === "#123456")).toBe(true);
  });

  it("a per-item color wins; a cleared color falls back (never an empty color)", async () => {
    const fills = allSources(await render({ items: [{ label: "a", value: 50, color: "#FF0000" }, { label: "b", value: 50, color: "" }] })).filter(isFill);
    expect(fills.map(colorOf)).toContain("#FF0000");
    expect(fills.map(colorOf).some((c) => !c || c === "")).toBe(false);
  });
});

describe("AlpineProgressCard — value display", () => {
  it("bare value is a %, value/max derives a %, valueLabel overrides", async () => {
    // value 25 → "25%"; value 250/1000 → "25%"; explicit label wins
    const texts = (doc: MosaicDocument) =>
      allSources(doc).filter(isText).flatMap((s) => ((s as { layers?: Array<{ content?: { text?: string } }> }).layers ?? []).map((l) => l.content?.text));
    expect(texts(await render({ items: [{ label: "a", value: 25 }], anim: { reduceMotion: true } }))).toContain("25%");
    expect(texts(await render({ items: [{ label: "a", value: 250, max: 1000 }], anim: { reduceMotion: true } }))).toContain("25%");
    expect(texts(await render({ items: [{ label: "a", value: 25, valueLabel: "$680K" }], anim: { reduceMotion: true } }))).toContain("$680K");
  });

  it("showValue:false drops the value labels but keeps the bars", async () => {
    const withVal = allSources(await render({ items: [{ label: "a", value: 50 }] }));
    const noVal = allSources(await render({ items: [{ label: "a", value: 50 }], showValue: false }));
    expect(noVal.filter(isFill).length).toBe(1);
    expect(noVal.filter(isText).length).toBeLessThan(withVal.filter(isText).length);
  });
});

describe("AlpineProgressCard — edge cases", () => {
  it("clamps a >100% value to a full bar (valid, no overflow)", async () => {
    expectFramesMatchSources(await render({ items: [{ label: "x", value: 150 }] }));
  });

  it("an item with no value degrades safely to an empty track (no NaN, valid m0)", async () => {
    const doc = await render({ items: [{ label: "a" }, { label: "b", value: 60 }] });
    expectFramesMatchSources(doc);
    expect(/NaN/.test(doc.m0 as unknown as string)).toBe(false);
  });

  it("1 item and 8 items both render valid", async () => {
    expectFramesMatchSources(await render({ items: [{ label: "solo", value: 70 }] }));
    expectFramesMatchSources(await render({ items: Array.from({ length: 8 }, (_, i) => ({ label: `g${i}`, value: 10 + i * 11 })) }));
  });

  it("rejects empty items with an error mosaic, not a throw", async () => {
    const doc = await render({ items: [] });
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  });
});

describe("AlpineProgressCard — U-A0 shared-infra adoption", () => {
  const overlayA = (s: MosaicSource) => (s as { overlay?: { alpha?: string; enable?: string } }).overlay;
  it("intro reveal is geq-free: NO animated overlay.alpha; labels/values enable-gated (revealGate)", async () => {
    const all = allSources(await render(D));
    expect(all.some((s) => overlayA(s)?.alpha != null)).toBe(false);
    expect(all.filter((s) => overlayA(s)?.enable != null).length).toBeGreaterThan(0);
  });
  it("fills still grow (xExpr slide kept, opaque)", async () => {
    const all = allSources(await render(D));
    expect(all.filter((s) => overlayOf(s)?.xExpr != null).length).toBeGreaterThan(0);
  });
  it("a producer theme block overrides the card + title colors (resolveAlpineTheme)", async () => {
    const ctx = { mode: "render", target: { width: W, height: H, fps: 30, durationMs: 2000 }, output: { width: W, height: H, fps: 30, durationMs: 2000, workspaceDir: "/tmp/x" }, media: {}, upstreamData: { theme: { surface: "#654321", textPrimary: "#abcdef" } } } as unknown as MosaicEngineContext;
    const doc = (await AlpineProgressCard.render(D as never, ctx)) as MosaicDocument;
    const s = JSON.stringify(doc);
    expect(s).toContain("#654321");
    expect(s).toContain("#abcdef");
  });
});

describe("AlpineProgressCard — first-open cover (mosaic-branding theme)", () => {
  const coverCtx = {
    mode: "render" as const,
    target: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    output: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    media: {},
  } as unknown as MosaicEngineContext;

  it("branded pane + the template's own default render INLINED as hero", async () => {
    expect(typeof AlpineProgressCard.renderCover).toBe("function");
    const doc = (await AlpineProgressCard.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    const s = JSON.stringify(doc.sources);
    expect(s).toContain("Progress Card");
    // Band variant: no conversation pane, just brand + title.
    expect(s).not.toContain("START HERE");
    expect(s).not.toContain('"type":"mosaic","ref":"cover');
  });

  it("cover is deterministic", async () => {
    const a = (await AlpineProgressCard.renderCover!({} as never, coverCtx)) as MosaicDocument;
    const b = (await AlpineProgressCard.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(a.m0).toBe(b.m0);
  });
});

describe("AlpineProgressCard — prop bindings (Make inline edit)", () => {
  const schema = AlpineProgressCard.propsSchema;
  const bindingsOf = async (props: Record<string, unknown>) => {
    const doc = await render(props);
    return { doc, ...resolvePropBindings(doc, W, H, { propsSchema: schema }) };
  };
  type Bound = { sourceIndex: number; childPath: string[]; index?: number; path?: Array<string | number>; kind?: string };
  /** The bound source wherever it lives — the root doc or the grow-clip `plot` child. */
  const sourceOf = (doc: MosaicDocument, b: Bound): MosaicSource => {
    let owner = doc;
    for (const ref of b.childPath) owner = childrenOf(owner)[ref];
    return (owner.sources ?? [])[b.sourceIndex] as MosaicSource;
  };
  const labelAt = (doc: MosaicDocument, i: number) => ((doc.sources ?? [])[i] as { editor?: { label?: string } }).editor?.label;
  const labelOf = (doc: MosaicDocument, b: Bound) => (sourceOf(doc, b) as { editor?: { label?: string } }).editor?.label;
  const contentOf = (doc: MosaicDocument, b: Bound) =>
    ((sourceOf(doc, b) as { layers?: Array<{ content?: { kind?: string; text?: string; expr?: string } }> }).layers ?? [])[0]?.content;
  /** items bindings as { path, kind, label } — label = the bound source's tag (fill tiles are untagged). */
  const itemLeaves = (r: { doc: MosaicDocument; byProp: Record<string, Bound[]> }) =>
    (r.byProp.items ?? []).map((b) => ({ path: b.path, kind: b.kind, label: labelOf(r.doc, b) }));
  const find = (r: { byProp: Record<string, Bound[]> }, i: number, field: string, label?: string) =>
    r.byProp.items.find((b) => b.path![0] === i && b.path![1] === field && (label === undefined || labelOfBound(r, b) === label))!;
  const labelOfBound = (r: { byProp: Record<string, Bound[]> } & { doc?: MosaicDocument }, b: Bound) => labelOf((r as { doc: MosaicDocument }).doc, b);

  it("title → exactly one root rect: the card header (alpineCard binds its primary layer); items → leaf bindings", async () => {
    const r = await bindingsOf({ ...D, title: "Title", subtitle: "Subtitle" });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["barColor", "items", "subtitle", "title", "trackColor"]);
    expect(r.byProp.title).toHaveLength(1);
    const b = r.byProp.title[0];
    expect("index" in b).toBe(false);
    expect(b.childPath).toEqual([]);
    expect(labelAt(r.doc, b.sourceIndex)).toBe("card-header");
  });

  it("subtitle-only header binds subtitle; no header leaves only the items leaves", async () => {
    const sub = await bindingsOf({ ...D, title: undefined, subtitle: "Subtitle" });
    expect(sub.rejected).toEqual([]);
    expect(Object.keys(sub.byProp).sort()).toEqual(["barColor", "items", "subtitle", "trackColor"]);
    expect(sub.byProp.subtitle).toHaveLength(1);
    expect(sub.byProp.subtitle[0].childPath).toEqual([]);
    expect(labelAt(sub.doc, sub.byProp.subtitle[0].sourceIndex)).toBe("card-header");
    const none = await bindingsOf({ ...D, title: undefined, subtitle: undefined });
    expect(none.rejected).toEqual([]);
    expect(Object.keys(none.byProp).sort()).toEqual(["barColor", "items", "trackColor"]);
  });

  it("items[i].{label,value} → label text + value text (count-up expr) + the fill whose LENGTH is the value — all in the `plot` child when animated", async () => {
    const r = await bindingsOf({ ...D }); // 4 bare-value defaults, animated + countUp
    expect(r.rejected).toEqual([]);
    expect(r.byProp.items.every((b) => b.childPath.length === 1 && b.childPath[0] === "plot" && b.index === undefined)).toBe(true);
    const leaves = itemLeaves(r);
    for (let i = 0; i < 4; i++) {
      expect(leaves).toContainEqual({ path: [i, "label"], kind: "string", label: "row-label" });
      expect(leaves).toContainEqual({ path: [i, "value"], kind: "number", label: "row-value" });
      expect(leaves).toContainEqual({ path: [i, "value"], kind: "number", label: undefined }); // the fill tile
    }
    expect(leaves).toHaveLength(12);
    // the bound rects really show that item: literal label, count-up expr value, colored fill
    expect(contentOf(r.doc, find(r, 0, "label"))?.text).toBe("Q4 Sales");
    expect(contentOf(r.doc, find(r, 0, "value", "row-value"))?.kind).toBe("expr");
    const fills = r.byProp.items.filter((b) => labelOf(r.doc, b) === undefined).map((b) => sourceOf(r.doc, b));
    expect(fills).toHaveLength(4);
    expect(fills.every(isFill)).toBe(true);
    // the track (unfilled) tiles are NOT items-bound — they are not the value's visual (they bind trackColor)
    expect(fills.some((f) => colorOf(f) === TRACK)).toBe(false);
  });

  it("static (reduceMotion): the same leaves live in the ROOT doc; the value text is the literal %", async () => {
    const r = await bindingsOf({ ...D, anim: { reduceMotion: true } });
    expect(r.rejected).toEqual([]);
    expect(r.byProp.items.every((b) => b.childPath.length === 0)).toBe(true);
    expect(itemLeaves(r)).toHaveLength(12);
    expect(contentOf(r.doc, find(r, 1, "value", "row-value"))?.text).toBe("84%");
  });

  it("value text binds the leaf it SHOWS: bare → value; Display → valueLabel; value/max % merges two leaves → unbound (its fill still binds value)", async () => {
    const r = await bindingsOf({
      items: [
        { label: "bare", value: 40 },
        { label: "display", value: 40, valueLabel: "$680K" },
        { label: "ratio", value: 250, max: 1000 },
      ],
      anim: { reduceMotion: true },
    });
    expect(r.rejected).toEqual([]);
    const leaves = itemLeaves(r);
    expect(leaves).toContainEqual({ path: [0, "value"], kind: "number", label: "row-value" });
    expect(leaves).toContainEqual({ path: [1, "valueLabel"], kind: "string", label: "row-value" });
    expect(leaves.filter((l) => l.path![0] === 1 && l.label === "row-value")).toHaveLength(1); // one binding per source
    expect(leaves.some((l) => l.path![0] === 2 && l.label === "row-value")).toBe(false);
    for (let i = 0; i < 3; i++) expect(leaves).toContainEqual({ path: [i, "value"], kind: "number", label: undefined }); // every fill
    expect(contentOf(r.doc, find(r, 1, "valueLabel"))?.text).toBe("$680K");
    expect(contentOf(r.doc, find(r, 2, "label"))?.text).toBe("ratio");
  });

  it("filtered-out and truncated items keep the survivors at their ORIGINAL indices", async () => {
    const items: unknown[] = [{ label: "keep 0", value: 10 }, { value: 5 }, { label: "keep 2", value: 30 }]; // [1] has no label → dropped
    const r = await bindingsOf({ items, anim: { reduceMotion: true } });
    expect(r.rejected).toEqual([]);
    expect(r.byProp.items.filter((b) => b.path![1] === "label").map((b) => b.path![0])).toEqual([0, 2]);
    expect(contentOf(r.doc, find(r, 2, "label"))?.text).toBe("keep 2");
    // 10 items → MAX_ITEMS (8) drawn, indices 0..7
    const many = await bindingsOf({ items: Array.from({ length: 10 }, (_, i) => ({ label: `g${i}`, value: 10 + i * 5 })), anim: { reduceMotion: true } });
    expect(many.rejected).toEqual([]);
    expect(many.byProp.items.filter((b) => b.path![1] === "label").map((b) => b.path![0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("an empty / zero value keeps its text rect bound as an ADD handle; no fill is painted (no rect → no binding); showValue:false drops the value text", async () => {
    const r = await bindingsOf({ items: [{ label: "empty" }, { label: "zero", value: 0 }], anim: { reduceMotion: true } });
    expect(r.rejected).toEqual([]);
    const leaves = itemLeaves(r);
    expect(leaves).toContainEqual({ path: [0, "value"], kind: "number", label: "row-value" });
    expect(leaves).toContainEqual({ path: [1, "value"], kind: "number", label: "row-value" });
    expect(leaves.filter((l) => l.label === undefined)).toHaveLength(0); // no fills at all
    const noVal = await bindingsOf({ items: [{ label: "a", value: 50 }], showValue: false, anim: { reduceMotion: true } });
    expect(noVal.rejected).toEqual([]);
    expect(itemLeaves(noVal)).toEqual([
      { path: [0, "label"], kind: "string", label: "row-label" },
      { path: [0, "value"], kind: "number", label: undefined },
    ]);
    // no fill → no barColor entry either; the tracks still bind trackColor
    expect(r.byProp.barColor).toBeUndefined();
    expect(r.byProp.trackColor).toHaveLength(2);
  });

  it("colors: every fill takes barColor as a second entry (kind \"color\") beside its items[i].value — same source, value first; every track binds trackColor", async () => {
    const r = await bindingsOf({ ...D, barColor: "#123456", trackColor: "#ABCDEF" }); // animated → the `plot` child
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["barColor", "items", "subtitle", "title", "trackColor"]);
    const key = (b: Bound) => `${b.childPath.join("/")}#${b.sourceIndex}`;
    const fills = r.byProp.items.filter((b) => b.path![1] === "value" && labelOf(r.doc, b) === undefined);
    expect(fills).toHaveLength(4);
    expect(r.byProp.barColor).toHaveLength(4);
    expect(r.byProp.barColor.map(key).sort()).toEqual(fills.map(key).sort()); // exactly the fill tiles
    for (const c of r.byProp.barColor) {
      expect(c.kind).toBe("color");
      expect(c.path).toBeUndefined();
      expect(c.childPath).toEqual(["plot"]);
      const s = sourceOf(r.doc, c);
      expect(isFill(s)).toBe(true);
      expect(colorOf(s)).toBe("#123456"); // the bound tile's fill IS the prop
      // entry order on the source = importance: the value is the primary
      expect(((s as { editor?: { bindings?: Array<{ propKey: string }> } }).editor?.bindings ?? []).map((e) => e.propKey)).toEqual(["items", "barColor"]);
    }
    expect(r.byProp.trackColor).toHaveLength(4);
    for (const t of r.byProp.trackColor) {
      expect(t.kind).toBe("color");
      expect(t.childPath).toEqual(["plot"]);
      expect(labelOf(r.doc, t)).toBe("track");
      expect(colorOf(sourceOf(r.doc, t))).toBe("#ABCDEF");
    }
    // the label / value TEXT rects never carry a color entry
    const colored = new Set([...r.byProp.barColor, ...r.byProp.trackColor].map(key));
    expect(r.byProp.items.filter((b) => labelOf(r.doc, b) !== undefined).some((b) => colored.has(key(b)))).toBe(false);
  });

  it("a per-item color paints its fill → that fill's color entry is items[i].color (kind \"color\", ORIGINAL index) instead of barColor; the rest keep barColor; unset colors still bind (ADD handles)", async () => {
    const r = await bindingsOf({
      items: [{ label: "own", value: 30, color: "#FF0000" }, { value: 1 }, { label: "global", value: 60 }, { label: "blank", value: 20, color: "" }], // [1] has no label → dropped
      barColor: "#123456",
      anim: { reduceMotion: true },
    });
    expect(r.rejected).toEqual([]);
    const fillOf = (i: number) => r.byProp.items.find((b) => b.path![0] === i && b.path![1] === "value" && labelOf(r.doc, b) === undefined)!;
    const leaves = itemLeaves(r);
    expect(leaves).toContainEqual({ path: [0, "color"], kind: "color", label: undefined });
    expect(leaves).toContainEqual({ path: [3, "color"], kind: "color", label: undefined }); // the blank leaf is what resolveColor reads → an ADD handle
    expect(leaves.some((l) => l.path![1] === "color" && l.path![0] === 2)).toBe(false); // no own color → barColor paints it
    const own = find(r, 0, "color");
    expect(own.sourceIndex).toBe(fillOf(0).sourceIndex); // the SAME tile as its value entry
    expect(colorOf(sourceOf(r.doc, own))).toBe("#FF0000");
    expect(r.byProp.barColor).toHaveLength(1);
    expect(r.byProp.barColor[0].sourceIndex).toBe(fillOf(2).sourceIndex);
    expect(colorOf(sourceOf(r.doc, r.byProp.barColor[0]))).toBe("#123456");
    expect(r.byProp.trackColor).toHaveLength(3);
    // defaults: no barColor / trackColor set → still bound (the palette / theme grid paint; double-click SETS one)
    const d = await bindingsOf({ ...D, anim: { reduceMotion: true } });
    expect(d.rejected).toEqual([]);
    expect(d.byProp.barColor).toHaveLength(4);
    expect(d.byProp.barColor.every((c) => c.kind === "color" && c.childPath.length === 0)).toBe(true);
    expect(d.byProp.trackColor).toHaveLength(4);
    expect(d.byProp.trackColor.every((t) => t.kind === "color" && colorOf(sourceOf(d.doc, t)) === TRACK)).toBe(true);
  });
});
