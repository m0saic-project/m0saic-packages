import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete, getComplexityMetricsFast } from "@m0saic/dsl";
import { resolvePropBindings } from "@m0saic/template-utils";
import { AlpineTimelineV2 } from "./timeline";

function makeCtx(width: number, height: number, durationMs = 2000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width, height, fps: 30, durationMs },
    output: { width, height, fps: 30, durationMs, workspaceDir: "/tmp/alpine-timeline-v2" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const render = async (props: Record<string, unknown>, w = 1280, h = 800) =>
  (await AlpineTimelineV2.render(props as never, makeCtx(w, h))) as MosaicDocument;

const D = AlpineTimelineV2.defaultProps as Record<string, unknown>;
const srcs = (doc: MosaicDocument) => (doc.sources ?? []) as MosaicSource[];
const colorOf = (s: MosaicSource) => (s as { color?: string }).color;
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

/** Distinct dot-frame center x/y positions → tells horizontal (varying x, one
 *  shared y) from vertical (shared x, varying y). Dots are identified by their
 *  contract tag (editor.label "dot") and paired to frames by index — since the
 *  placement-inset rebuild they ride FULL band cells (the square is carved by
 *  the inset, invisible to the frame parser), so the old small-square-frame
 *  heuristic finds nothing. Centers, not origins: band cells share an axis
 *  center exactly. */
function dotSpread(doc: MosaicDocument, w: number, h: number): { xs: number; ys: number } {
  const parsed = parseM0StringComplete(doc.m0 as unknown as string, w, h);
  if (!parsed.ok) return { xs: 0, ys: 0 };
  const dots: Array<{ x: number; y: number; width: number; height: number }> = [];
  (doc.sources ?? []).forEach((s, i) => {
    if ((s as { editor?: { label?: string } }).editor?.label === "dot") {
      const f = parsed.ir.renderFrames[i] as { x: number; y: number; width: number; height: number } | undefined;
      if (f) dots.push(f);
    }
  });
  return {
    xs: new Set(dots.map((f) => Math.round(f.x + f.width / 2))).size,
    ys: new Set(dots.map((f) => Math.round(f.y + f.height / 2))).size,
  };
}

describe("AlpineTimelineV2 — metadata", () => {
  it("is the registered v2 primitive (not deprecated)", () => {
    expect(AlpineTimelineV2.id).toBe("@m0saic/alpine/timeline/v2");
    expect(AlpineTimelineV2.version).toBe(2);
    expect(AlpineTimelineV2.primitive).toBe(true);
    expect((AlpineTimelineV2 as { deprecated?: unknown }).deprecated).toBeUndefined();
    expect(AlpineTimelineV2.tags).toEqual(expect.arrayContaining(["alpine", "timeline", "data-viz"]));
  });
});

describe("AlpineTimelineV2 — render shape", () => {
  it("renders valid m0; frames match sources; no children", async () => {
    const doc = await render({ ...D });
    expectFramesMatchSources(doc, 1280, 800);
    expect(doc.backgroundColor).toBeDefined();
  });

  it("is deterministic — identical inputs yield byte-identical m0", async () => {
    expect((await render({ ...D })).m0).toBe((await render({ ...D })).m0);
  });

  it("emits a dot per event + connecting spine segments + the text lines", async () => {
    const doc = await render({ events: [{ date: "a", title: "A" }, { date: "b", title: "B" }, { date: "c", title: "C" }], anim: { reduceMotion: true } });
    expect(tiles(doc).length).toBeGreaterThanOrEqual(5); // 3 dots + 2 spine segments (+ card surface)
    expect(texts(doc)).toEqual(expect.arrayContaining(["a", "A", "b", "B", "c", "C"]));
  });
});

describe("AlpineTimelineV2 — RATIO precision (the v2 win)", () => {
  const precAt = async (W: number, H: number) => {
    const d = await render({ ...D, anim: { reduceMotion: true } }, W, H);
    const m = getComplexityMetricsFast(d.m0 as unknown as string);
    return { x: m.precision.maxSplitX, y: m.precision.maxSplitY };
  };
  it("precision does NOT scale with canvas (2× resolution ⇒ same precision, not 2×)", async () => {
    const lo = await precAt(1280, 800);
    const hi = await precAt(2560, 1600);
    expect(hi.x).toBe(lo.x);
    expect(hi.y).toBe(lo.y);
    expect(lo.x).toBeLessThanOrEqual(160);
    expect(lo.y).toBeLessThanOrEqual(160);
  });
});

describe("AlpineTimelineV2 — orientation", () => {
  it("auto → horizontal on a wide card (dots share a row, spread across x)", async () => {
    const { xs, ys } = dotSpread(await render({ ...D, orientation: "auto" }, 1280, 800), 1280, 800);
    expect(xs).toBeGreaterThan(1);
    expect(ys).toBe(1);
  });

  it("auto → vertical on a square card (dots share a column, spread across y)", async () => {
    const { xs, ys } = dotSpread(await render({ ...D, orientation: "auto" }, 1080, 1080), 1080, 1080);
    expect(ys).toBeGreaterThan(1);
    expect(xs).toBe(1);
  });

  it("explicit orientation overrides the aspect heuristic", async () => {
    const forcedVert = dotSpread(await render({ ...D, orientation: "vertical" }, 1280, 800), 1280, 800);
    expect(forcedVert.xs).toBe(1);
    const forcedHoriz = dotSpread(await render({ ...D, orientation: "horizontal" }, 1080, 1080), 1080, 1080);
    expect(forcedHoriz.ys).toBe(1);
  });
});

describe("AlpineTimelineV2 — colors", () => {
  it("dots default to the accent; per-event color + a custom accent both apply", async () => {
    const doc = await render({
      events: [{ title: "A", color: "#16A34A" }, { title: "B" }, { title: "C" }],
      color: "#8B5CF6",
      anim: { reduceMotion: true },
    });
    const cols = tiles(doc).map(colorOf);
    expect(cols).toContain("#16A34A");
    expect(cols).toContain("#8B5CF6");
  });

  it("a cleared color falls back to the accent (never empty)", async () => {
    const doc = await render({ events: [{ title: "A", color: "" }], color: "#2563EB", anim: { reduceMotion: true } });
    expect(tiles(doc).map(colorOf).some((c) => !c || c === "")).toBe(false);
  });
});

describe("AlpineTimelineV2 — text controls", () => {
  it("showDescription:false drops the description lines", async () => {
    const withDesc = texts(await render({ events: [{ title: "T", description: "DESC" }], showDescription: true, anim: { reduceMotion: true } }));
    const noDesc = texts(await render({ events: [{ title: "T", description: "DESC" }], showDescription: false, anim: { reduceMotion: true } }));
    expect(withDesc).toContain("DESC");
    expect(noDesc).not.toContain("DESC");
  });

  it("truncates an absurdly long title with an ellipsis (no full string)", async () => {
    const long = "This is an absolutely absurdly long milestone title that no card could ever contain";
    const t = texts(await render({ events: [{ title: long }, { title: "B" }, { title: "C" }], orientation: "horizontal", anim: { reduceMotion: true } }));
    expect(t).not.toContain(long);
    expect(t.some((s) => typeof s === "string" && s.endsWith("…"))).toBe(true);
  });
});

describe("AlpineTimelineV2 — animation", () => {
  it("animated dots carry a fade overlay; reduceMotion is static", async () => {
    const animated = tiles(await render({ ...D }));
    expect(animated.some((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha)).toBe(true);
    const still = tiles(await render({ ...D, anim: { reduceMotion: true } }));
    expect(still.some((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha)).toBe(false);
  });
});

describe("AlpineTimelineV2 — edge cases", () => {
  it("a single event renders valid in both orientations", async () => {
    expectFramesMatchSources(await render({ events: [{ date: "2024", title: "Solo" }] }, 1280, 800), 1280, 800);
    expectFramesMatchSources(await render({ events: [{ date: "2024", title: "Solo" }] }, 1080, 1080), 1080, 1080);
  });

  it("caps at 7 events", async () => {
    const doc = await render({ events: Array.from({ length: 12 }, (_, i) => ({ title: `E${i}` })), orientation: "vertical", anim: { reduceMotion: true } });
    const titles = texts(doc).filter((s) => typeof s === "string" && /^E\d+$/.test(s));
    expect(titles.length).toBe(7);
  });

  it("rejects empty events with an error mosaic, not a throw", async () => {
    const doc = await render({ events: [] });
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  });
});

describe("AlpineTimelineV2 — two-mode reveal + theming", () => {
  const mk = (): MosaicEngineContext => ({ mode: "render", target: { width: 1280, height: 800, fps: 30, durationMs: 2000 }, output: { width: 1280, height: 800, fps: 30, durationMs: 2000 }, media: {} } as unknown as MosaicEngineContext);
  const rr = async (p: Record<string, unknown>) => (await AlpineTimelineV2.render({ ...(AlpineTimelineV2.defaultProps as object), ...p } as never, mk())) as MosaicDocument;
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
  it("a producer theme recolors the card; explicit accent color wins", async () => {
    const themed = ({ mode: "render", target: { width: 1280, height: 800, fps: 30, durationMs: 2000 }, output: {}, media: {}, upstreamData: { theme: { surface: "#101820" } } } as unknown as MosaicEngineContext);
    expect(JSON.stringify((await AlpineTimelineV2.render(AlpineTimelineV2.defaultProps as never, themed)) as MosaicDocument)).toContain("#101820");
    expect(JSON.stringify((await AlpineTimelineV2.render({ ...(AlpineTimelineV2.defaultProps as object), color: "#123456" } as never, themed)) as MosaicDocument)).toContain("#123456");
  });
});

describe("AlpineTimelineV2 — first-open cover (mosaic-branding theme)", () => {
  const coverCtx = {
    mode: "render" as const,
    target: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    output: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    media: {},
  } as unknown as MosaicEngineContext;

  it("branded pane + the template's own default render INLINED as hero", async () => {
    expect(typeof AlpineTimelineV2.renderCover).toBe("function");
    const doc = (await AlpineTimelineV2.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    const s = JSON.stringify(doc.sources);
    expect(s).toContain("Timeline");
    // Band variant: no conversation pane, just brand + title.
    expect(s).not.toContain("START HERE");
    expect(s).not.toContain('"type":"mosaic","ref":"cover');
  });

  it("cover is deterministic", async () => {
    const a = (await AlpineTimelineV2.renderCover!({} as never, coverCtx)) as MosaicDocument;
    const b = (await AlpineTimelineV2.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(a.m0).toBe(b.m0);
  });
});

describe("AlpineTimelineV2 — prop bindings (Make inline edit)", () => {
  const schema = AlpineTimelineV2.propsSchema;
  const bindingsOf = async (props: Record<string, unknown>, w = 1280, h = 800) => {
    const doc = await render(props, w, h);
    return { doc, ...resolvePropBindings(doc, w, h, { propsSchema: schema }) };
  };
  const labelAt = (doc: MosaicDocument, i: number) => ((doc.sources ?? [])[i] as { editor?: { label?: string } }).editor?.label;
  /** events[] leaf bindings as { path, kind, label } triples (label = the bound source's tag). */
  const leavesOf = (r: Awaited<ReturnType<typeof bindingsOf>>) =>
    (r.byProp.events ?? []).map((b) => ({ path: b.path, kind: b.kind, label: labelAt(r.doc, b.sourceIndex) }));
  const STILL = { anim: { reduceMotion: true } };
  const EV = D.events as Array<{ date: string; title: string; description: string }>;

  it("title → exactly one root rect: the card header (alpineCard binds its primary layer); events → leaf bindings; nothing else", async () => {
    const r = await bindingsOf({ ...D, title: "Title", subtitle: "Subtitle" });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["color", "events", "subtitle", "title"]);
    expect(r.byProp.title).toHaveLength(1);
    const b = r.byProp.title[0];
    expect("index" in b).toBe(false);
    expect(b.childPath).toEqual([]);
    expect(labelAt(r.doc, b.sourceIndex)).toBe("card-header");
  });

  it("subtitle-only header binds subtitle; no header leaves only the event leaves", async () => {
    const sub = await bindingsOf({ ...D, title: undefined, subtitle: "Subtitle" });
    expect(sub.rejected).toEqual([]);
    expect(Object.keys(sub.byProp).sort()).toEqual(["color", "events", "subtitle"]);
    expect(sub.byProp.subtitle).toHaveLength(1);
    expect(sub.byProp.subtitle[0].childPath).toEqual([]);
    expect(labelAt(sub.doc, sub.byProp.subtitle[0].sourceIndex)).toBe("card-header");
    const none = await bindingsOf({ ...D, title: undefined, subtitle: undefined });
    expect(none.rejected).toEqual([]);
    expect(Object.keys(none.byProp).sort()).toEqual(["color", "events"]);
  });

  it("events[i].{date,title,description} → one text rect each at the ORIGINAL index (horizontal AND vertical)", async () => {
    for (const [w, h] of [[1280, 800], [1080, 1080]] as const) {
      const r = await bindingsOf({ ...D, ...STILL }, w, h);
      expect(r.rejected).toEqual([]);
      expect(r.byProp.events.every((b) => b.childPath.length === 0 && b.index === undefined)).toBe(true);
      const leaves = leavesOf(r);
      for (let i = 0; i < EV.length; i++) {
        expect(leaves).toContainEqual({ path: [i, "date"], kind: "string", label: "event-date" });
        expect(leaves).toContainEqual({ path: [i, "title"], kind: "string", label: "event-title" });
        expect(leaves).toContainEqual({ path: [i, "description"], kind: "string", label: "event-desc" });
      }
      expect(leaves).toHaveLength(EV.length * 3);
      // the bound rects really show that event's leaves
      const at = (i: number, f: string) => textOf((r.doc.sources ?? [])[r.byProp.events.find((b) => b.path![0] === i && b.path![1] === f)!.sourceIndex] as MosaicSource);
      expect(at(2, "date")).toBe("Aug 2024");
      expect(at(2, "title")).toBe("Series A");
      expect(at(2, "description")).toBe("$12M raised");
    }
  });

  it("dots bind `color` (kind color, one per drawn event, both orientations); spine segments + the card surface are never bound; event text leaves ride text rects only", async () => {
    for (const [w, h] of [[1280, 800], [1080, 1080]] as const) {
      const r = await bindingsOf({ ...D, color: "#123456", ...STILL }, w, h);
      expect(r.rejected).toEqual([]);
      expect(r.byProp.events.length).toBeGreaterThan(0);
      for (const b of r.byProp.events) expect(isText(srcs(r.doc)[b.sourceIndex])).toBe(true); // no per-event colors in the defaults
      expect(r.byProp.color).toHaveLength(EV.length);
      for (const b of r.byProp.color) {
        expect(b).toMatchObject({ kind: "color", childPath: [] });
        expect("index" in b).toBe(false);
        expect(labelAt(r.doc, b.sourceIndex)).toBe("dot");
        expect(colorOf(srcs(r.doc)[b.sourceIndex])).toBe("#123456");
      }
      // the spine is theme-grid (not the accent) and the card surface is theme.card → never handles
      const bound = new Set(Object.values(r.byProp).flat().map((b) => b.sourceIndex));
      let otherTiles = 0;
      srcs(r.doc).forEach((s, i) => { if (isTile(s) && labelAt(r.doc, i) !== "dot") { otherTiles++; expect(bound.has(i)).toBe(false); } });
      expect(otherTiles).toBe(1 + (EV.length - 1)); // card surface + N-1 spine segments
    }
    // unset `color` → the dots paint the theme primary but stay handles (double-click to SET)
    const def = await bindingsOf({ ...D, ...STILL });
    expect(def.rejected).toEqual([]);
    expect(def.byProp.color).toHaveLength(EV.length);
  });

  it("a per-event color takes over its dot: that dot binds events[i].color (kind color, ORIGINAL index) INSTEAD of `color`; the rest keep `color`", async () => {
    const events = [
      { title: "E0" },
      { title: "E1", color: "#FF0000" },
      { title: "E2", color: "none" }, // "none" → resolveColor falls back to the accent → binds `color`
      { title: "E3", color: "   " }, // blank → accent too
    ];
    for (const orientation of ["horizontal", "vertical"] as const) {
      const r = await bindingsOf({ events, orientation, ...STILL });
      expect(r.rejected).toEqual([]);
      const own = r.byProp.events.filter((b) => b.path![1] === "color");
      expect(own).toHaveLength(1);
      expect(own[0]).toMatchObject({ path: [1, "color"], kind: "color", childPath: [] });
      expect(labelAt(r.doc, own[0].sourceIndex)).toBe("dot");
      expect(colorOf(srcs(r.doc)[own[0].sourceIndex])).toBe("#FF0000");
      // the other three dots bind the shared accent; the own-colored dot does NOT also bind it
      expect(r.byProp.color).toHaveLength(3);
      expect(r.byProp.color.map((b) => b.sourceIndex)).not.toContain(own[0].sourceIndex);
      for (const b of r.byProp.color) expect(labelAt(r.doc, b.sourceIndex)).toBe("dot");
      // every dot carries exactly one color handle
      const dots = srcs(r.doc).flatMap((s, i) => (labelAt(r.doc, i) === "dot" ? [i] : []));
      expect(dots).toHaveLength(4);
      const handles = new Set([...r.byProp.color, ...own].map((b) => b.sourceIndex));
      for (const i of dots) expect(handles.has(i)).toBe(true);
    }
    // ORIGINAL index survives filtering: an untitled event ahead of the colored one shifts nothing
    const shifted = await bindingsOf({ events: [{ title: "" }, { title: "E1", color: "#00FF00" }, { title: "E2" }], orientation: "vertical", ...STILL });
    expect(shifted.rejected).toEqual([]);
    const own = shifted.byProp.events.filter((b) => b.path![1] === "color");
    expect(own.map((b) => b.path)).toEqual([[1, "color"]]);
    expect(colorOf(srcs(shifted.doc)[own[0].sourceIndex])).toBe("#00FF00");
    expect(shifted.byProp.color).toHaveLength(1);
  });

  it("filtered-out (untitled) and truncated (MAX 7) events keep the survivors at their ORIGINAL indices", async () => {
    const events = [
      { date: "d0", title: "E0" },
      { date: "no title" } as unknown as { title: string }, // no title → filtered out
      { title: "   " }, // blank title → filtered out
      ...Array.from({ length: 9 }, (_, k) => ({ title: `E${k + 3}` })),
    ];
    // 12 in, 10 survive the filter, 7 are drawn: 0, 3..8 (9..11 truncated)
    const r = await bindingsOf({ events, orientation: "vertical", ...STILL });
    expect(r.rejected).toEqual([]);
    const titleIdx = r.byProp.events.filter((b) => b.path![1] === "title").map((b) => b.path![0]);
    expect(titleIdx).toEqual([0, 3, 4, 5, 6, 7, 8]);
    expect(textOf(srcs(r.doc)[r.byProp.events.find((b) => b.path![0] === 3 && b.path![1] === "title")!.sourceIndex])).toBe("E3");
    // a date / description rect exists only when the leaf is set → no binding otherwise (never adds a rect)
    expect(r.byProp.events.filter((b) => b.path![1] === "date").map((b) => b.path![0])).toEqual([0]);
    expect(r.byProp.events.some((b) => b.path![1] === "description")).toBe(false);
  });

  it("showDescription:false drops the description rects (and their bindings); date + title stay", async () => {
    const r = await bindingsOf({ ...D, showDescription: false, ...STILL });
    expect(r.rejected).toEqual([]);
    expect(r.byProp.events.some((b) => b.path![1] === "description")).toBe(false);
    expect(r.byProp.events.filter((b) => b.path![1] === "title")).toHaveLength(EV.length);
    expect(r.byProp.events.filter((b) => b.path![1] === "date")).toHaveLength(EV.length);
  });

  it("bindings ride the animated sources in both reveal modes (premium fade / light gate)", async () => {
    for (const anim of [{ reduceMotion: false }, { renderMode: "light" }]) {
      const r = await bindingsOf({ ...D, anim });
      expect(r.rejected).toEqual([]);
      expect(Object.keys(r.byProp).sort()).toEqual(["color", "events", "subtitle", "title"]);
      expect(r.byProp.events).toHaveLength(EV.length * 3);
      expect(r.byProp.color).toHaveLength(EV.length); // the dot handles ride the faded / gated tiles too
    }
  });
});
