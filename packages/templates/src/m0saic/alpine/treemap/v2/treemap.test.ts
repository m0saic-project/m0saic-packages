import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete, getComplexityMetricsFast } from "@m0saic/dsl";
import { resolvePropBindings } from "@m0saic/template-utils";
import { AlpineTreemapV2 } from "./treemap";

function makeCtx(width: number, height: number, durationMs = 2000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width, height, fps: 30, durationMs },
    output: { width, height, fps: 30, durationMs, workspaceDir: "/tmp/alpine-treemap-v2" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const render = async (props: Record<string, unknown>, w = 1280, h = 800) =>
  (await AlpineTreemapV2.render(props as never, makeCtx(w, h))) as MosaicDocument;

const D = AlpineTreemapV2.defaultProps as Record<string, unknown>;
const srcs = (doc: MosaicDocument) => (doc.sources ?? []) as MosaicSource[];
const colorOf = (s: MosaicSource) => (s as { color?: string }).color;
const effectsOf = (s: MosaicSource) => (s as { effects?: { rounding?: { borderRadius?: number } } }).effects;
const isText = (s: MosaicSource) => (s as { type?: string }).type === "text";
const isTile = (s: MosaicSource) => (s as { type?: string }).type === "lavfi";
const textOf = (s: MosaicSource) => ((s as { layers?: Array<{ content?: { text?: string } }> }).layers ?? [])[0]?.content?.text;
const tiles = (doc: MosaicDocument) => srcs(doc).filter(isTile);
const texts = (doc: MosaicDocument) => srcs(doc).filter(isText).map(textOf);

function expectFramesMatchSources(doc: MosaicDocument, w: number, h: number): void {
  expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  const parsed = parseM0StringComplete(doc.m0 as unknown as string, w, h);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe((doc.sources ?? []).length);
  expect((doc as { children?: unknown }).children).toBeUndefined();
}

function tileRects(doc: MosaicDocument, w: number, h: number) {
  const parsed = parseM0StringComplete(doc.m0 as unknown as string, w, h);
  if (!parsed.ok) return [] as Array<{ x: number; y: number; width: number; height: number }>;
  return parsed.ir.renderFrames.map((f) => ({ x: (f as any).x, y: (f as any).y, width: (f as any).width, height: (f as any).height }));
}

describe("AlpineTreemapV2 — metadata", () => {
  it("is the registered v2 primitive (not deprecated)", () => {
    expect(AlpineTreemapV2.id).toBe("@m0saic/alpine/treemap/v2");
    expect(AlpineTreemapV2.version).toBe(2);
    expect(AlpineTreemapV2.primitive).toBe(true);
    expect((AlpineTreemapV2 as { deprecated?: unknown }).deprecated).toBeUndefined();
    expect(AlpineTreemapV2.tags).toEqual(expect.arrayContaining(["alpine", "treemap", "data-viz"]));
  });
});

describe("AlpineTreemapV2 — render shape", () => {
  it("renders valid m0; frames match sources; no children", async () => {
    const doc = await render({ ...D });
    expectFramesMatchSources(doc, 1280, 800);
    expect(doc.backgroundColor).toBeDefined();
  });

  it("is deterministic — identical inputs yield byte-identical m0", async () => {
    expect((await render({ ...D })).m0).toBe((await render({ ...D })).m0);
  });

  it("emits one tile per (positive-value) item", async () => {
    const doc = await render({ items: [{ label: "a", value: 5 }, { label: "b", value: 3 }, { label: "c", value: 2 }], anim: { reduceMotion: true } });
    expect(tiles(doc).length).toBeGreaterThanOrEqual(4);
  });

  it("drops items with value <= 0", async () => {
    const t = texts(await render({ items: [{ label: "keep", value: 10 }, { label: "drop", value: 0 }, { label: "neg", value: -5 }], anim: { reduceMotion: true } }));
    expect(t).toContain("keep");
    expect(t).not.toContain("drop");
    expect(t).not.toContain("neg");
  });
});

describe("AlpineTreemapV2 — RATIO precision (the v2 win)", () => {
  const precAt = async (w: number, h: number) => {
    const d = await render({ ...D, anim: { reduceMotion: true } }, w, h);
    const m = getComplexityMetricsFast(d.m0 as unknown as string);
    return { x: m.precision.maxSplitX, y: m.precision.maxSplitY };
  };
  it("precision stays bounded by the split basis cap (never tracks the canvas)", async () => {
    // The squarify weights normalize to the ~120 basis cap, so precision saturates
    // there rather than doubling with the canvas the way v1's placeRects did.
    const BOUND = 130;
    for (const [w, h] of [[1280, 800], [2560, 1600], [5120, 3200]] as const) {
      const p = await precAt(w, h);
      expect(p.x).toBeLessThanOrEqual(BOUND);
      expect(p.y).toBeLessThanOrEqual(BOUND);
    }
  });
});

describe("AlpineTreemapV2 — squarified layout", () => {
  it("the biggest value is the biggest tile", async () => {
    const w = 1280, h = 800;
    const doc = await render({ items: [{ label: "big", value: 60 }, { label: "mid", value: 30 }, { label: "small", value: 10 }], showValue: false, anim: { reduceMotion: true } }, w, h);
    const rects = tileRects(doc, w, h).map((r) => r.width * r.height).sort((a, b) => b - a);
    const tileAreas = rects.slice(1); // drop the card surface (largest)
    expect(tileAreas[0]).toBeGreaterThan(tileAreas[1] * 1.5);
  });

  it("packs valid at horizontal, square, and vertical aspects", async () => {
    expectFramesMatchSources(await render({ ...D }, 1280, 800), 1280, 800);
    expectFramesMatchSources(await render({ ...D }, 1080, 1080), 1080, 1080);
    expectFramesMatchSources(await render({ ...D }, 1080, 1920), 1080, 1920);
  });

  it("caps at 12 items", async () => {
    const doc = await render({ items: Array.from({ length: 16 }, (_, i) => ({ label: `i${i}`, value: 16 - i })), showValue: false, anim: { reduceMotion: true } });
    expect(tiles(doc).length).toBe(13);
  });
});

describe("AlpineTreemapV2 — colors", () => {
  it("tiles cycle the palette; a per-item color overrides; a cleared color falls back", async () => {
    const doc = await render({ items: [{ label: "a", value: 9, color: "#123456" }, { label: "b", value: 5, color: "" }, { label: "c", value: 3 }], anim: { reduceMotion: true } });
    const cols = tiles(doc).map(colorOf);
    expect(cols).toContain("#123456");
    expect(cols.some((c) => !c || c === "")).toBe(false);
  });
});

describe("AlpineTreemapV2 — value modes", () => {
  it("percent (default) shows shares; value shows compact numbers; none hides them", async () => {
    const pct = texts(await render({ items: [{ label: "Eng", value: 75 }, { label: "Ops", value: 25 }], valueMode: "percent", anim: { reduceMotion: true } }));
    expect(pct).toContain("75%");
    const val = texts(await render({ items: [{ label: "Big", value: 1200000 }, { label: "Small", value: 510000 }], valueMode: "value", anim: { reduceMotion: true } }));
    expect(val).toContain("1.2M");
    expect(val.some((s) => s === "510K")).toBe(true);
    const none = texts(await render({ items: [{ label: "Eng", value: 75 }, { label: "Ops", value: 25 }], valueMode: "none", anim: { reduceMotion: true } }));
    expect(none).not.toContain("75%");
    expect(none).toContain("Eng");
  });

  it("showValue:false hides the value line", async () => {
    const t = texts(await render({ items: [{ label: "Eng", value: 75 }, { label: "Ops", value: 25 }], showValue: false, anim: { reduceMotion: true } }));
    expect(t).not.toContain("75%");
    expect(t).toContain("Eng");
  });
});

describe("AlpineTreemapV2 — corner radius", () => {
  it("cornerRadius reaches the tiles' rounding effect", async () => {
    const doc = await render({ ...D, tiles: { cornerRadius: 0.3 }, anim: { reduceMotion: true } });
    const radii = tiles(doc).map((s) => effectsOf(s)?.rounding?.borderRadius).filter((r): r is number => typeof r === "number");
    expect(radii).toContain(0.3);
  });
});

describe("AlpineTreemapV2 — animation", () => {
  it("animated tiles carry a fade overlay; reduceMotion is static", async () => {
    const animated = tiles(await render({ ...D }));
    expect(animated.some((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha)).toBe(true);
    const still = tiles(await render({ ...D, anim: { reduceMotion: true } }));
    expect(still.some((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha)).toBe(false);
  });
});

describe("AlpineTreemapV2 — edge cases", () => {
  it("a single item renders valid", async () => {
    expectFramesMatchSources(await render({ items: [{ label: "Solo", value: 1 }] }, 1280, 800), 1280, 800);
  });

  it("dark preset renders valid", async () => {
    expectFramesMatchSources(await render({ ...D, preset: "dark" }, 1280, 800), 1280, 800);
  });

  it("rejects empty / all-zero items with an error mosaic, not a throw", async () => {
    expect(isValidM0String((await render({ items: [] })).m0 as unknown as string)).toBe(true);
    expect(isValidM0String((await render({ items: [{ label: "z", value: 0 }] })).m0 as unknown as string)).toBe(true);
  });
});

describe("AlpineTreemapV2 — two-mode reveal + theming", () => {
  const mk = (): MosaicEngineContext => ({ mode: "render", target: { width: 1280, height: 800, fps: 30, durationMs: 2000 }, output: { width: 1280, height: 800, fps: 30, durationMs: 2000 }, media: {} } as unknown as MosaicEngineContext);
  const rr = async (p: Record<string, unknown>) => (await AlpineTreemapV2.render({ ...(AlpineTreemapV2.defaultProps as object), ...p } as never, mk())) as MosaicDocument;
  const S = (d: MosaicDocument) => (d.sources ?? []) as MosaicSource[];
  const timeAlpha = (s: MosaicSource) => { const a = (s as { overlay?: { alpha?: string } }).overlay?.alpha; return a != null && /\blt\b|\bt\b/.test(String(a)); };
  const en = (s: MosaicSource) => (s as { overlay?: { enable?: string } }).overlay?.enable;

  it("premium (default): alpha fades (a geq) — no enable gates", async () => {
    const all = S(await rr({}));
    expect(all.some(timeAlpha)).toBe(true);
    expect(all.some((s) => en(s) != null)).toBe(false);
  });
  it("light: geq-free — zero time-alpha; enable gates present", async () => {
    const all = S(await rr({ anim: { renderMode: "light" } }));
    expect(all.some(timeAlpha)).toBe(false);
    expect(all.some((s) => en(s) != null)).toBe(true);
  });
  it("a producer theme recolors the card", async () => {
    const themed = ({ mode: "render", target: { width: 1280, height: 800, fps: 30, durationMs: 2000 }, output: {}, media: {}, upstreamData: { theme: { surface: "#101820" } } } as unknown as MosaicEngineContext);
    expect(JSON.stringify((await AlpineTreemapV2.render(AlpineTreemapV2.defaultProps as never, themed)) as MosaicDocument)).toContain("#101820");
  });
});

describe("AlpineTreemapV2 — first-open cover (mosaic-branding theme)", () => {
  const coverCtx = {
    mode: "render" as const,
    target: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    output: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    media: {},
  } as unknown as MosaicEngineContext;

  it("branded pane + the template's own default render INLINED as hero", async () => {
    expect(typeof AlpineTreemapV2.renderCover).toBe("function");
    const doc = (await AlpineTreemapV2.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    const s = JSON.stringify(doc.sources);
    expect(s).toContain("Treemap");
    // Band variant: no conversation pane, just brand + title.
    expect(s).not.toContain("START HERE");
    expect(s).not.toContain('"type":"mosaic","ref":"cover');
  });

  it("cover is deterministic", async () => {
    const a = (await AlpineTreemapV2.renderCover!({} as never, coverCtx)) as MosaicDocument;
    const b = (await AlpineTreemapV2.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(a.m0).toBe(b.m0);
  });
});

describe("AlpineTreemapV2 — prop bindings (Make inline edit)", () => {
  const schema = AlpineTreemapV2.propsSchema;
  const bindingsOf = async (props: Record<string, unknown>) => {
    const doc = await render(props, 1280, 800);
    return { doc, ...resolvePropBindings(doc, 1280, 800, { propsSchema: schema }) };
  };
  type Bound = { sourceIndex: number; childPath: string[]; index?: number; path?: Array<string | number>; kind?: string };
  type Res = { doc: MosaicDocument; byProp: Record<string, Bound[]> };
  const labelAt = (doc: MosaicDocument, i: number) => (srcs(doc)[i] as { editor?: { label?: string } }).editor?.label;
  /** items bindings as { path, kind, label } — label = the bound source's tag (tile surfaces are untagged). */
  const itemLeaves = (r: Res) => (r.byProp.items ?? []).map((b) => ({ path: b.path, kind: b.kind, label: labelAt(r.doc, b.sourceIndex) }));
  const find = (r: Res, i: number, field: string, label?: string) =>
    r.byProp.items.find((b) => b.path![0] === i && b.path![1] === field && (label === undefined || labelAt(r.doc, b.sourceIndex) === label))!;
  const textOfBound = (r: Res, b: Bound) => textOf(srcs(r.doc)[b.sourceIndex]);
  const surfacesOf = (r: Res) => r.byProp.items.filter((b) => labelAt(r.doc, b.sourceIndex) === undefined);

  it("title → exactly one root rect: the card header (alpineCard binds its primary layer); items → leaf bindings", async () => {
    const r = await bindingsOf({ ...D, title: "Title", subtitle: "Subtitle" });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["items", "subtitle", "title"]);
    expect(r.byProp.title).toHaveLength(1);
    const b = r.byProp.title[0];
    expect("index" in b).toBe(false);
    expect(b.childPath).toEqual([]);
    expect(labelAt(r.doc, b.sourceIndex)).toBe("card-header");
  });

  it("subtitle-only header binds subtitle; no header leaves only the items leaves", async () => {
    const sub = await bindingsOf({ ...D, title: undefined, subtitle: "Subtitle" });
    expect(sub.rejected).toEqual([]);
    expect(Object.keys(sub.byProp).sort()).toEqual(["items", "subtitle"]);
    expect(sub.byProp.subtitle).toHaveLength(1);
    expect(sub.byProp.subtitle[0].childPath).toEqual([]);
    expect(labelAt(sub.doc, sub.byProp.subtitle[0].sourceIndex)).toBe("card-header");
    const none = await bindingsOf({ ...D, title: undefined, subtitle: undefined });
    expect(none.rejected).toEqual([]);
    expect(Object.keys(none.byProp)).toEqual(["items"]);
  });

  it("items[i].{label,value} → the tile-name text + the tile surface whose AREA is the value (root doc); the % share is derived → unbound", async () => {
    const r = await bindingsOf({ ...D }); // 5 defaults, percent mode, animated premium
    expect(r.rejected).toEqual([]);
    expect(r.byProp.items.every((b) => b.childPath.length === 0 && b.index === undefined)).toBe(true);
    const leaves = itemLeaves(r);
    for (let i = 0; i < 5; i++) {
      expect(leaves).toContainEqual({ path: [i, "label"], kind: "string", label: "tile-name" });
      expect(leaves).toContainEqual({ path: [i, "value"], kind: "number", label: undefined }); // the surface
    }
    expect(leaves.some((l) => l.label === "tile-value")).toBe(false); // "42%" = value/total
    expect(leaves).toHaveLength(10);
    expect(textOfBound(r, find(r, 0, "label"))).toBe("Engineering");
    const surfaces = surfacesOf(r).map((b) => srcs(r.doc)[b.sourceIndex]);
    expect(surfaces).toHaveLength(5);
    expect(surfaces.every(isTile)).toBe(true);
  });

  it("valueMode:\"value\" draws the raw leaf (compact) → the tile-value text binds items[i].value too; percent stays unbound", async () => {
    const r = await bindingsOf({ items: [{ label: "Big", value: 1200000 }, { label: "Small", value: 510000 }], valueMode: "value", anim: { reduceMotion: true } });
    expect(r.rejected).toEqual([]);
    const leaves = itemLeaves(r);
    expect(leaves).toContainEqual({ path: [0, "value"], kind: "number", label: "tile-value" });
    expect(leaves).toContainEqual({ path: [1, "value"], kind: "number", label: "tile-value" });
    expect(textOfBound(r, find(r, 0, "value", "tile-value"))).toBe("1.2M");
    const pct = await bindingsOf({ items: [{ label: "Big", value: 75 }, { label: "Small", value: 25 }], valueMode: "percent", anim: { reduceMotion: true } });
    expect(pct.rejected).toEqual([]);
    expect(itemLeaves(pct).some((l) => l.label === "tile-value")).toBe(false);
  });

  it("size-sorted draw order keeps ORIGINAL prop indices (unsorted input)", async () => {
    // Drawn biggest→smallest: big(1), mid(2), small(0) — the paths must not follow the draw order.
    const r = await bindingsOf({ items: [{ label: "small", value: 5 }, { label: "big", value: 50 }, { label: "mid", value: 20 }], showValue: false, anim: { reduceMotion: true } });
    expect(r.rejected).toEqual([]);
    expect(textOfBound(r, find(r, 0, "label"))).toBe("small");
    expect(textOfBound(r, find(r, 1, "label"))).toBe("big");
    expect(textOfBound(r, find(r, 2, "label"))).toBe("mid");
    // draw (source) order really is big → mid → small
    expect(r.byProp.items.filter((b) => b.path![1] === "label").map((b) => b.path![0])).toEqual([1, 2, 0]);
    // and the biggest painted surface is the one bound to items[1]
    const rects = tileRects(r.doc, 1280, 800);
    const area = (b: Bound) => rects[b.sourceIndex].width * rects[b.sourceIndex].height;
    const biggest = surfacesOf(r).reduce((a, b) => (area(a) >= area(b) ? a : b));
    expect(biggest.path).toEqual([1, "value"]);
  });

  it("culled (value ≤ 0) and truncated (>12) items keep the survivors at their ORIGINAL indices", async () => {
    const r = await bindingsOf({ items: [{ label: "zero", value: 0 }, { label: "a", value: 10 }, { label: "neg", value: -5 }, { label: "b", value: 30 }], showValue: false, anim: { reduceMotion: true } });
    expect(r.rejected).toEqual([]);
    expect(r.byProp.items.filter((b) => b.path![1] === "label").map((b) => b.path![0]).sort()).toEqual([1, 3]);
    expect(surfacesOf(r).map((b) => b.path![0]).sort()).toEqual([1, 3]);
    // 16 items → the first 12 (input order) are drawn whatever their size; a surface per survivor
    const many = await bindingsOf({ items: Array.from({ length: 16 }, (_, i) => ({ label: `i${i}`, value: 16 - i })), showValue: false, anim: { reduceMotion: true } });
    expect(many.rejected).toEqual([]);
    expect(surfacesOf(many).map((b) => Number(b.path![0])).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("bindings ride the animated sources in both reveal modes (premium fade / light gate)", async () => {
    for (const anim of [{ renderMode: "premium" }, { renderMode: "light" }]) {
      const r = await bindingsOf({ ...D, anim });
      expect(r.rejected).toEqual([]);
      expect(Object.keys(r.byProp).sort()).toEqual(["items", "subtitle", "title"]);
      expect(itemLeaves(r)).toHaveLength(10);
    }
  });
});
