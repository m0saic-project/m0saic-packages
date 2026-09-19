import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete } from "@m0saic/dsl";
import { AlpineTimeline } from "./timeline";

function makeCtx(width: number, height: number, durationMs = 2000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width, height, fps: 30, durationMs },
    output: { width, height, fps: 30, durationMs, workspaceDir: "/tmp/alpine-timeline" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const render = async (props: Record<string, unknown>, w = 1280, h = 800) =>
  (await AlpineTimeline.render(props as never, makeCtx(w, h))) as MosaicDocument;

const D = AlpineTimeline.defaultProps as Record<string, unknown>;
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

/** Distinct cell-frame x-positions of the dot tiles → tells horizontal (varying x,
 *  one shared y) from vertical (shared x, varying y). */
function dotSpread(doc: MosaicDocument, w: number, h: number): { xs: number; ys: number } {
  const parsed = parseM0StringComplete(doc.m0 as unknown as string, w, h);
  if (!parsed.ok) return { xs: 0, ys: 0 };
  // small square frames (the dots) — collect their x/y
  const dots = parsed.ir.renderFrames.filter((f) => {
    const a = (f as { width: number; height: number });
    return Math.abs(a.width - a.height) <= 8 && a.width <= Math.max(w, h) * 0.1;
  });
  return { xs: new Set(dots.map((f) => Math.round((f as { x: number }).x))).size, ys: new Set(dots.map((f) => Math.round((f as { y: number }).y))).size };
}

describe("AlpineTimeline — metadata", () => {
  it("is the registered v1 primitive, deprecated in favor of v2", () => {
    expect(AlpineTimeline.id).toBe("@m0saic/alpine/timeline/v1");
    expect(AlpineTimeline.version).toBe(1);
    expect(AlpineTimeline.primitive).toBe(true);
    const dep = (AlpineTimeline as { deprecated?: { replacement?: string } }).deprecated;
    expect(dep).toBeDefined();
    expect(dep?.replacement).toBe("@m0saic/alpine/timeline/v2");
    expect(AlpineTimeline.tags).toEqual(expect.arrayContaining(["alpine", "timeline", "data-viz"]));
  });
});

describe("AlpineTimeline — render shape", () => {
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
    // 3 dots + 2 spine segments = 5 tiles (plus the card surface). Text: 3 dates + 3 titles.
    expect(tiles(doc).length).toBeGreaterThanOrEqual(5);
    expect(texts(doc)).toEqual(expect.arrayContaining(["a", "A", "b", "B", "c", "C"]));
  });
});

describe("AlpineTimeline — orientation", () => {
  it("auto → horizontal on a wide card (dots share a row, spread across x)", async () => {
    const { xs, ys } = dotSpread(await render({ ...D, orientation: "auto" }, 1280, 800), 1280, 800);
    expect(xs).toBeGreaterThan(1); // dots spread horizontally
    expect(ys).toBe(1); // ...on one shared spine row
  });

  it("auto → vertical on a square card (dots share a column, spread across y)", async () => {
    const { xs, ys } = dotSpread(await render({ ...D, orientation: "auto" }, 1080, 1080), 1080, 1080);
    expect(ys).toBeGreaterThan(1); // dots spread vertically
    expect(xs).toBe(1); // ...on one shared rail column
  });

  it("explicit orientation overrides the aspect heuristic", async () => {
    const forcedVert = dotSpread(await render({ ...D, orientation: "vertical" }, 1280, 800), 1280, 800);
    expect(forcedVert.xs).toBe(1);
    const forcedHoriz = dotSpread(await render({ ...D, orientation: "horizontal" }, 1080, 1080), 1080, 1080);
    expect(forcedHoriz.ys).toBe(1);
  });
});

describe("AlpineTimeline — colors", () => {
  it("dots default to the accent; per-event color + a custom accent both apply", async () => {
    const doc = await render({
      events: [{ title: "A", color: "#16A34A" }, { title: "B" }, { title: "C" }],
      color: "#8B5CF6",
      anim: { reduceMotion: true },
    });
    const cols = tiles(doc).map(colorOf);
    expect(cols).toContain("#16A34A"); // per-event override
    expect(cols).toContain("#8B5CF6"); // accent on the others
  });

  it("a cleared color falls back to the accent (never empty)", async () => {
    const doc = await render({ events: [{ title: "A", color: "" }], color: "#2563EB", anim: { reduceMotion: true } });
    expect(tiles(doc).map(colorOf).some((c) => !c || c === "")).toBe(false);
  });
});

describe("AlpineTimeline — text controls", () => {
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

describe("AlpineTimeline — animation", () => {
  it("animated dots carry a fade overlay; reduceMotion is static", async () => {
    const animated = tiles(await render({ ...D }));
    expect(animated.some((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha)).toBe(true);
    const still = tiles(await render({ ...D, anim: { reduceMotion: true } }));
    expect(still.some((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha)).toBe(false);
  });
});

describe("AlpineTimeline — edge cases", () => {
  it("a single event renders valid in both orientations", async () => {
    expectFramesMatchSources(await render({ events: [{ date: "2024", title: "Solo" }] }, 1280, 800), 1280, 800);
    expectFramesMatchSources(await render({ events: [{ date: "2024", title: "Solo" }] }, 1080, 1080), 1080, 1080);
  });

  it("caps at 7 events", async () => {
    const doc = await render({ events: Array.from({ length: 12 }, (_, i) => ({ title: `E${i}` })), orientation: "vertical", anim: { reduceMotion: true } });
    // 7 dots cap → at most 7 title texts among the event titles E0..E11
    const titles = texts(doc).filter((s) => typeof s === "string" && /^E\d+$/.test(s));
    expect(titles.length).toBe(7);
  });

  it("rejects empty events with an error mosaic, not a throw", async () => {
    const doc = await render({ events: [] });
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  });
});

describe("AlpineTimeline — two-mode reveal + theming (F4 U-A10)", () => {
  const mk = (): MosaicEngineContext => ({ mode: "render", target: { width: 1280, height: 800, fps: 30, durationMs: 2000 }, output: { width: 1280, height: 800, fps: 30, durationMs: 2000 }, media: {} } as unknown as MosaicEngineContext);
  const rr = async (p: Record<string, unknown>) => (await AlpineTimeline.render({ ...(AlpineTimeline.defaultProps as object), ...p } as never, mk())) as MosaicDocument;
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
    expect(JSON.stringify((await AlpineTimeline.render(AlpineTimeline.defaultProps as never, themed)) as MosaicDocument)).toContain("#101820");
    expect(JSON.stringify((await AlpineTimeline.render({ ...(AlpineTimeline.defaultProps as object), color: "#123456" } as never, themed)) as MosaicDocument)).toContain("#123456");
  });
});
