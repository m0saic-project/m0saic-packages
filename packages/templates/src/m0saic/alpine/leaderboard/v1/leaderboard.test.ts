import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete } from "@m0saic/dsl";
import { resolvePropBindings } from "@m0saic/template-utils";
import { AlpineLeaderboard } from "./leaderboard";

const W = 1280;
const H = 800;

function makeCtx(durationMs = 2000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: W, height: H, fps: 30, durationMs },
    output: { width: W, height: H, fps: 30, durationMs, workspaceDir: "/tmp/alpine-leaderboard" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const render = async (props: Record<string, unknown>, durationMs?: number) =>
  (await AlpineLeaderboard.render(props as never, makeCtx(durationMs))) as MosaicDocument;

const D = AlpineLeaderboard.defaultProps as Record<string, unknown>;
const srcs = (doc: MosaicDocument) => (doc.sources ?? []) as MosaicSource[];
const colorOf = (s: MosaicSource) => (s as { color?: string }).color;
const effectsOf = (s: MosaicSource) => (s as { effects?: { rounding?: { borderRadius?: number }; stroke?: unknown } }).effects;
const overlayOf = (s: MosaicSource) => (s as { overlay?: { alpha?: string } }).overlay;
const isText = (s: MosaicSource) => (s as { type?: string }).type === "text";
const textOf = (s: MosaicSource) => ((s as { layers?: Array<{ content?: { text?: string } }> }).layers ?? [])[0]?.content?.text;
/** A rank badge: a rounded lavfi tile, no stroke, with the badge corner radius (0.32). */
const isBadge = (s: MosaicSource) =>
  (s as { type?: string }).type === "lavfi" && !effectsOf(s)?.stroke && effectsOf(s)?.rounding?.borderRadius === 0.32;
/** A row wash: a rounded lavfi tile (radius 0.18) carrying a constant overlay.alpha. */
const isWash = (s: MosaicSource) =>
  (s as { type?: string }).type === "lavfi" && effectsOf(s)?.rounding?.borderRadius === 0.18;

const GOLD = "#F59E0B";

function expectFramesMatchSources(doc: MosaicDocument): void {
  expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  const parsed = parseM0StringComplete(doc.m0 as unknown as string, W, H);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe((doc.sources ?? []).length);
  expect((doc as { children?: unknown }).children).toBeUndefined();
}

/** The rendered row names, top→bottom (m0 frame order). */
function namesInOrder(doc: MosaicDocument, names: string[]): string[] {
  return srcs(doc).map(textOf).filter((t): t is string => !!t && names.includes(t));
}

describe("AlpineLeaderboard — metadata", () => {
  it("is the registered v1 primitive, not deprecated", () => {
    expect(AlpineLeaderboard.id).toBe("@m0saic/alpine/leaderboard/v1");
    expect(AlpineLeaderboard.version).toBe(1);
    expect(AlpineLeaderboard.primitive).toBe(true);
    expect((AlpineLeaderboard as { deprecated?: unknown }).deprecated).toBeUndefined();
    expect(AlpineLeaderboard.tags).toEqual(expect.arrayContaining(["alpine", "leaderboard", "data-viz"]));
  });
});

describe("AlpineLeaderboard — render shape", () => {
  it("renders valid m0; frames match sources; no children", async () => {
    const doc = await render({ ...D });
    expectFramesMatchSources(doc);
    expect(doc.backgroundColor).toBeDefined();
  });

  it("paints one rank badge per item", async () => {
    const doc = await render({ items: [{ name: "a", value: 5 }, { name: "b", value: 9 }, { name: "c", value: 1 }] });
    expect(srcs(doc).filter(isBadge).length).toBe(3);
  });

  it("is deterministic — identical inputs yield byte-identical m0", async () => {
    expect((await render({ ...D })).m0).toBe((await render({ ...D })).m0);
  });

  it("caps at 8 rows", async () => {
    const doc = await render({ items: Array.from({ length: 12 }, (_, i) => ({ name: `p${i}`, value: i })) });
    expect(srcs(doc).filter(isBadge).length).toBe(8);
  });
});

describe("AlpineLeaderboard — ranking", () => {
  it("auto-sorts by value descending (rank reflects the score)", async () => {
    const doc = await render({ items: [{ name: "low", value: 10 }, { name: "high", value: 90 }, { name: "mid", value: 50 }] });
    expect(namesInOrder(doc, ["low", "mid", "high"])).toEqual(["high", "mid", "low"]);
  });

  it("preSorted keeps the input order", async () => {
    const doc = await render({ items: [{ name: "low", value: 10 }, { name: "high", value: 90 }, { name: "mid", value: 50 }], preSorted: true });
    expect(namesInOrder(doc, ["low", "mid", "high"])).toEqual(["low", "high", "mid"]);
  });
});

describe("AlpineLeaderboard — badge colors", () => {
  it("rank 1 is gold; a per-item color overrides; a cleared color falls back (never empty)", async () => {
    const def = srcs(await render({ items: [{ name: "a", value: 9 }, { name: "b", value: 5 }] })).filter(isBadge);
    expect(def.map(colorOf)).toContain(GOLD); // top badge gold

    const over = srcs(await render({ items: [{ name: "a", value: 9, color: "#123456" }, { name: "b", value: 5, color: "" }] })).filter(isBadge);
    expect(over.map(colorOf)).toContain("#123456");
    expect(over.map(colorOf).some((c) => !c || c === "")).toBe(false);
  });
});

describe("AlpineLeaderboard — row tint", () => {
  it("podiumTint on → row washes present; off → none", async () => {
    const on = await render({ items: [{ name: "a", value: 9 }, { name: "b", value: 5 }], podiumTint: true });
    expect(srcs(on).filter(isWash).length).toBeGreaterThan(0);
    const off = await render({ items: [{ name: "a", value: 9 }, { name: "b", value: 5 }], podiumTint: false });
    expect(srcs(off).filter(isWash).length).toBe(0);
  });
});

describe("AlpineLeaderboard — value display", () => {
  const texts = (doc: MosaicDocument) => srcs(doc).filter(isText).map(textOf);
  const exprTexts = (doc: MosaicDocument) =>
    srcs(doc).filter((s) => isText(s) && (s as { renderMode?: { kind?: string } }).renderMode?.kind === "video");

  it("bare value is grouped; valueLabel overrides; prefix/suffix wrap the derived value", async () => {
    expect(texts(await render({ items: [{ name: "a", value: 284000 }], anim: { reduceMotion: true } }))).toContain("284,000");
    expect(texts(await render({ items: [{ name: "a", value: 284000, valueLabel: "2.84k" }], anim: { reduceMotion: true } }))).toContain("2.84k");
    expect(texts(await render({ items: [{ name: "a", value: 50 }], valuePrefix: "$", valueSuffix: " pts", anim: { reduceMotion: true } }))).toContain("$50 pts");
  });

  it("count-up animated → value is an expr (video); reduceMotion → literal", async () => {
    expect(exprTexts(await render({ ...D })).length).toBeGreaterThan(0);
    expect(exprTexts(await render({ ...D, anim: { reduceMotion: true } })).length).toBe(0);
  });

  it("showValue:false drops the value labels", async () => {
    const withVal = texts(await render({ items: [{ name: "Ava", value: 9 }], anim: { reduceMotion: true } }));
    const noVal = texts(await render({ items: [{ name: "Ava", value: 9 }], showValue: false, anim: { reduceMotion: true } }));
    expect(withVal).toContain("9");
    expect(noVal).not.toContain("9");
  });
});

describe("AlpineLeaderboard — edge cases", () => {
  it("1 item and 8 items render valid", async () => {
    expectFramesMatchSources(await render({ items: [{ name: "solo", value: 7 }] }));
    expectFramesMatchSources(await render({ items: Array.from({ length: 8 }, (_, i) => ({ name: `g${i}`, value: i * 10 })) }));
  });

  it("dark preset renders valid", async () => {
    expectFramesMatchSources(await render({ ...D, preset: "dark" }));
  });

  it("rejects empty items with an error mosaic, not a throw", async () => {
    const doc = await render({ items: [] });
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  });
});

describe("AlpineLeaderboard — two-mode reveal + theming (F4 U-A9)", () => {
  const mk = (durationMs = 2000): MosaicEngineContext => ({ mode: "render", target: { width: 1280, height: 800, fps: 30, durationMs }, output: { width: 1280, height: 800, fps: 30, durationMs }, media: {} } as unknown as MosaicEngineContext);
  const rr = async (p: Record<string, unknown>) => (await AlpineLeaderboard.render({ ...(AlpineLeaderboard.defaultProps as object), ...p } as never, mk())) as MosaicDocument;
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
    expect(JSON.stringify(await render({}))).not.toContain("#101820");
    expect(JSON.stringify((await AlpineLeaderboard.render(AlpineLeaderboard.defaultProps as never, themed)) as MosaicDocument)).toContain("#101820");
  });
});

describe("AlpineLeaderboard — equal-band rows + layout contract (gate 7)", () => {
  const STILL = { renderMode: "premium", introFrac: 0.7, countUp: true, easing: "easeOut", reduceMotion: true } as const;
  const ctxAt = (w: number, h: number): MosaicEngineContext =>
    ({
      mode: "render" as const,
      target: { width: w, height: h, fps: 30, durationMs: 2000 },
      output: { width: w, height: h, fps: 30, durationMs: 2000, workspaceDir: "/tmp/alpine-leaderboard" },
      media: {},
    }) as unknown as MosaicEngineContext;

  it("contract (rows equal-size, 2% + 1px) passes at hostile canvases", async () => {
    for (const [w, h] of [[1280, 708], [1001, 733], [720, 1280], [640, 360], [1920, 480], [733, 977], [541, 743]] as Array<[number, number]>) {
      const doc = (await AlpineLeaderboard.render({ ...D, anim: STILL, debugLayout: true } as never, ctxAt(w, h))) as MosaicDocument;
      expect((doc as { editor?: { layoutContract?: { ok?: boolean } } }).editor?.layoutContract?.ok).toBe(true);
    }
  });

  it("every row wash carries the contract tag", async () => {
    const doc = (await AlpineLeaderboard.render({ ...D, anim: STILL } as never, ctxAt(1280, 708))) as MosaicDocument;
    const tags = ((doc.sources ?? []) as MosaicSource[]).filter((s) => (s as { editor?: { label?: string } }).editor?.label === "row");
    expect(tags.length).toBe(5);
  });

  it("debugLayout off (default) leaves the doc unstamped — zero-cost path", async () => {
    const doc = (await AlpineLeaderboard.render({ ...D, anim: STILL } as never, ctxAt(1280, 708))) as MosaicDocument;
    expect((doc as { editor?: { layoutContract?: unknown } }).editor?.layoutContract).toBeUndefined();
  });
});

describe("AlpineLeaderboard — first-open cover", () => {
  const ctxAt2 = (w: number, h: number): MosaicEngineContext =>
    ({
      mode: "render" as const,
      target: { width: w, height: h, fps: 30, durationMs: 2000 },
      output: { width: w, height: h, fps: 30, durationMs: 2000, workspaceDir: "/tmp/alpine-leaderboard" },
      media: {},
    }) as unknown as MosaicEngineContext;

  it("declares a branded cover: pane + inlined default render, self-contained", async () => {
    expect(typeof AlpineLeaderboard.renderCover).toBe("function");
    const doc = (await AlpineLeaderboard.renderCover!({} as never, ctxAt2(1280, 708))) as MosaicDocument;
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    const s = JSON.stringify(doc.sources);
    expect(s).toContain("Leaderboard");
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
    const a = (await AlpineLeaderboard.renderCover!({} as never, ctxAt2(1280, 708))) as MosaicDocument;
    const b = (await AlpineLeaderboard.renderCover!({} as never, ctxAt2(1280, 708))) as MosaicDocument;
    expect(a.m0).toBe(b.m0);
  });
});

describe("AlpineLeaderboard — prop bindings (Make inline edit)", () => {
  const schema = AlpineLeaderboard.propsSchema;
  const STILL = { reduceMotion: true };
  const bindingsOf = async (props: Record<string, unknown>) => {
    const doc = await render(props);
    return { doc, ...resolvePropBindings(doc, W, H, { propsSchema: schema }) };
  };
  type ByProp = ReturnType<typeof resolvePropBindings>["byProp"];
  const labelAt = (doc: MosaicDocument, i: number) => ((doc.sources ?? [])[i] as { editor?: { label?: string } }).editor?.label;
  const leafAt = (byProp: ByProp, path: Array<string | number>) =>
    (byProp.items ?? []).find((b) => JSON.stringify(b.path) === JSON.stringify(path));
  /** The ORIGINAL items index of every bound name rect, in source (draw) order. */
  const nameIndicesInDrawOrder = (byProp: ByProp) => (byProp.items ?? []).filter((b) => b.path![1] === "name").map((b) => b.path![0]);

  it("title → exactly one root rect: the card header (alpineCard binds its primary layer); items[] leaves are the only other bindings", async () => {
    const r = await bindingsOf({ ...D, title: "Title", subtitle: "Subtitle" });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["items", "subtitle", "title"]);
    expect(r.byProp.title).toHaveLength(1);
    const b = r.byProp.title[0];
    expect("index" in b).toBe(false);
    expect(b.childPath).toEqual([]);
    expect(labelAt(r.doc, b.sourceIndex)).toBe("card-header");
  });

  it("subtitle-only header binds subtitle; no header leaves only the items[] leaves", async () => {
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

  it("items[i].{name,value} → leaf bindings on the name + value rects (kind string / number, root doc)", async () => {
    const r = await bindingsOf({ ...D, anim: STILL });
    expect(r.rejected).toEqual([]);
    expect(r.byProp.items).toHaveLength(10); // 5 items × (name, value)
    expect(r.byProp.items.every((b) => b.childPath.length === 0 && b.index === undefined)).toBe(true);
    const leaves = r.byProp.items.map((b) => ({ path: b.path, kind: b.kind, label: labelAt(r.doc, b.sourceIndex) }));
    for (let i = 0; i < 5; i++) {
      expect(leaves).toContainEqual({ path: [i, "name"], kind: "string", label: "row-name" });
      expect(leaves).toContainEqual({ path: [i, "value"], kind: "number", label: "row-value" });
    }
    // the bound rects really show that item's leaf (the value formatted)
    expect(textOf(srcs(r.doc)[leafAt(r.byProp, [0, "name"])!.sourceIndex])).toBe("Ava Chen");
    expect(textOf(srcs(r.doc)[leafAt(r.byProp, [0, "value"])!.sourceIndex])).toBe("2,840");
    expect(textOf(srcs(r.doc)[leafAt(r.byProp, [4, "value"])!.sourceIndex])).toBe("1,640");
  });

  it("UNSORTED input: the board auto-sorts by value, but every path keeps the ORIGINAL items index (never the draw order)", async () => {
    const items = [{ name: "low", value: 10 }, { name: "high", value: 90 }, { name: "mid", value: 50 }];
    const r = await bindingsOf({ items, anim: STILL });
    expect(r.rejected).toEqual([]);
    // drawn top→bottom: high, mid, low — the bindings walk the same sources but
    // carry the prop positions 1, 2, 0.
    expect(namesInOrder(r.doc, ["low", "mid", "high"])).toEqual(["high", "mid", "low"]);
    expect(nameIndicesInDrawOrder(r.byProp)).toEqual([1, 2, 0]);
    expect(r.byProp.items.filter((b) => b.path![1] === "value").map((b) => b.path![0])).toEqual([1, 2, 0]);
    expect(textOf(srcs(r.doc)[leafAt(r.byProp, [0, "name"])!.sourceIndex])).toBe("low");
    expect(textOf(srcs(r.doc)[leafAt(r.byProp, [1, "name"])!.sourceIndex])).toBe("high");
    expect(textOf(srcs(r.doc)[leafAt(r.byProp, [1, "value"])!.sourceIndex])).toBe("90");
    expect(textOf(srcs(r.doc)[leafAt(r.byProp, [2, "value"])!.sourceIndex])).toBe("50");
    // preSorted keeps the caller's order → prop index == draw order
    const pre = await bindingsOf({ items, preSorted: true, anim: STILL });
    expect(pre.rejected).toEqual([]);
    expect(nameIndicesInDrawOrder(pre.byProp)).toEqual([0, 1, 2]);
  });

  it("filtered (non-finite value) + truncated (MAX_ROWS) items keep their ORIGINAL indices", async () => {
    const filtered = await bindingsOf({ items: [{ name: "a", value: 3 }, { name: "bad", value: Number.NaN }, { name: "c", value: 1 }], anim: STILL });
    expect(filtered.rejected).toEqual([]);
    expect(nameIndicesInDrawOrder(filtered.byProp)).toEqual([0, 2]);
    expect(leafAt(filtered.byProp, [1, "name"])).toBeUndefined();
    // values by index: 0,7,2,9,4,11,6,1,8,3,10,5 → top 8 desc = i5 i10 i3 i8 i1 i6 i11 i4
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `p${i}`, value: (i * 7) % 12 }));
    const r = await bindingsOf({ items: many, anim: STILL });
    expect(r.rejected).toEqual([]);
    expect(r.byProp.items).toHaveLength(16);
    expect(nameIndicesInDrawOrder(r.byProp)).toEqual([5, 10, 3, 8, 1, 6, 11, 4]);
    expect(textOf(srcs(r.doc)[leafAt(r.byProp, [10, "name"])!.sourceIndex])).toBe("p10");
    expect(textOf(srcs(r.doc)[leafAt(r.byProp, [10, "value"])!.sourceIndex])).toBe("10");
    expect(leafAt(r.byProp, [0, "name"])).toBeUndefined(); // value 0 fell past the cut
  });

  it("valueLabel shows in the value rect but the binding stays on the raw `value` leaf; showValue:false leaves only names", async () => {
    const r = await bindingsOf({ items: [{ name: "a", value: 284000, valueLabel: "2.84k" }, { name: "b", value: 5 }], anim: STILL });
    expect(r.rejected).toEqual([]);
    const v0 = leafAt(r.byProp, [0, "value"])!;
    expect(v0.kind).toBe("number");
    expect(labelAt(r.doc, v0.sourceIndex)).toBe("row-value");
    expect(textOf(srcs(r.doc)[v0.sourceIndex])).toBe("2.84k");
    expect(r.byProp.items.some((b) => b.path![1] === "valueLabel")).toBe(false);
    const noVal = await bindingsOf({ items: [{ name: "a", value: 9 }, { name: "b", value: 5 }], showValue: false, anim: STILL });
    expect(noVal.rejected).toEqual([]);
    expect(noVal.byProp.items.map((b) => b.path)).toEqual([[0, "name"], [1, "name"]]);
  });

  it("derived rank numbers, rank badges, row washes and per-item colors are never bound", async () => {
    const r = await bindingsOf({ ...D, anim: STILL });
    const bound = new Set(r.byProp.items.map((b) => b.sourceIndex));
    let guarded = 0;
    srcs(r.doc).forEach((s, i) => {
      const lbl = (s as { editor?: { label?: string } }).editor?.label;
      if (lbl === "rank" || lbl === "row" || isBadge(s) || isWash(s)) {
        guarded++;
        expect(bound.has(i)).toBe(false);
      }
    });
    expect(guarded).toBeGreaterThanOrEqual(15); // 5 rank numbers + 5 badges + 5 washes
    expect(r.byProp.items.some((b) => b.path![1] === "color")).toBe(false);
  });

  it("bindings ride the animated sources in both reveal modes (premium count-up expr / light gate)", async () => {
    for (const anim of [{ reduceMotion: false }, { renderMode: "light" }]) {
      const r = await bindingsOf({ ...D, anim });
      expect(r.rejected).toEqual([]);
      expect(Object.keys(r.byProp).sort()).toEqual(["items", "subtitle", "title"]);
      expect(r.byProp.items).toHaveLength(10);
      expect(nameIndicesInDrawOrder(r.byProp)).toEqual([0, 1, 2, 3, 4]);
    }
  });
});
