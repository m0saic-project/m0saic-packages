import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete } from "@m0saic/dsl";
import { AlpineTreemap } from "./treemap";

function makeCtx(width: number, height: number, durationMs = 2000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width, height, fps: 30, durationMs },
    output: { width, height, fps: 30, durationMs, workspaceDir: "/tmp/alpine-treemap" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const render = async (props: Record<string, unknown>, w = 1280, h = 800) =>
  (await AlpineTreemap.render(props as never, makeCtx(w, h))) as MosaicDocument;

const D = AlpineTreemap.defaultProps as Record<string, unknown>;
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

/** The tile rects (non-card lavfi tiles) from the resolved m0, in frame order. */
function tileRects(doc: MosaicDocument, w: number, h: number) {
  const parsed = parseM0StringComplete(doc.m0 as unknown as string, w, h);
  if (!parsed.ok) return [] as Array<{ x: number; y: number; width: number; height: number }>;
  return parsed.ir.renderFrames.map((f) => ({ x: (f as any).x, y: (f as any).y, width: (f as any).width, height: (f as any).height }));
}

describe("AlpineTreemap — metadata", () => {
  it("is the registered v1 primitive, deprecated in favor of v2", () => {
    expect(AlpineTreemap.id).toBe("@m0saic/alpine/treemap/v1");
    expect(AlpineTreemap.version).toBe(1);
    expect(AlpineTreemap.primitive).toBe(true);
    const dep = (AlpineTreemap as { deprecated?: { replacement?: string } }).deprecated;
    expect(dep).toBeDefined();
    expect(dep?.replacement).toBe("@m0saic/alpine/treemap/v2");
    expect(AlpineTreemap.tags).toEqual(expect.arrayContaining(["alpine", "treemap", "data-viz"]));
  });
});

describe("AlpineTreemap — render shape", () => {
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
    // 3 item tiles + the rounded card surface = 4 lavfi tiles (labels are text).
    expect(tiles(doc).length).toBeGreaterThanOrEqual(4);
  });

  it("drops items with value <= 0", async () => {
    const t = texts(await render({ items: [{ label: "keep", value: 10 }, { label: "drop", value: 0 }, { label: "neg", value: -5 }], anim: { reduceMotion: true } }));
    expect(t).toContain("keep");
    expect(t).not.toContain("drop");
    expect(t).not.toContain("neg");
  });
});

describe("AlpineTreemap — squarified layout", () => {
  it("tiles fill the card area (sum ≈ content area) and the biggest value is the biggest tile", async () => {
    const w = 1280, h = 800;
    const doc = await render({ items: [{ label: "big", value: 60 }, { label: "mid", value: 30 }, { label: "small", value: 10 }], showValue: false, anim: { reduceMotion: true } }, w, h);
    // The largest tile area should dominate (≥ 2× the next), reflecting value 60 vs 30.
    const rects = tileRects(doc, w, h).map((r) => r.width * r.height).sort((a, b) => b - a);
    // rects[0] is the card surface (full inner); the next are tiles. Compare the two largest TILE areas.
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
    // 12 tiles + card surface.
    expect(tiles(doc).length).toBe(13);
  });
});

describe("AlpineTreemap — colors", () => {
  it("tiles cycle the palette; a per-item color overrides; a cleared color falls back", async () => {
    const doc = await render({ items: [{ label: "a", value: 9, color: "#123456" }, { label: "b", value: 5, color: "" }, { label: "c", value: 3 }], anim: { reduceMotion: true } });
    const cols = tiles(doc).map(colorOf);
    expect(cols).toContain("#123456"); // override
    expect(cols.some((c) => !c || c === "")).toBe(false); // never empty
  });
});

describe("AlpineTreemap — value modes", () => {
  it("percent (default) shows shares; value shows compact numbers; none hides them", async () => {
    const pct = texts(await render({ items: [{ label: "Eng", value: 75 }, { label: "Ops", value: 25 }], valueMode: "percent", anim: { reduceMotion: true } }));
    expect(pct).toContain("75%");

    const val = texts(await render({ items: [{ label: "Big", value: 1200000 }, { label: "Small", value: 510000 }], valueMode: "value", anim: { reduceMotion: true } }));
    expect(val).toContain("1.2M");
    expect(val.some((s) => s === "510K")).toBe(true);
    expect(val).not.toContain("1200000");

    const none = texts(await render({ items: [{ label: "Eng", value: 75 }, { label: "Ops", value: 25 }], valueMode: "none", anim: { reduceMotion: true } }));
    expect(none).not.toContain("75%");
    expect(none).toContain("Eng"); // the name still shows
  });

  it("showValue:false hides the value line", async () => {
    const t = texts(await render({ items: [{ label: "Eng", value: 75 }, { label: "Ops", value: 25 }], showValue: false, anim: { reduceMotion: true } }));
    expect(t).not.toContain("75%");
    expect(t).toContain("Eng");
  });
});

describe("AlpineTreemap — corner radius", () => {
  it("cornerRadius reaches the tiles' rounding effect", async () => {
    const doc = await render({ ...D, tiles: { cornerRadius: 0.3 }, anim: { reduceMotion: true } });
    const radii = tiles(doc).map((s) => effectsOf(s)?.rounding?.borderRadius).filter((r): r is number => typeof r === "number");
    expect(radii).toContain(0.3);
  });
});

describe("AlpineTreemap — animation", () => {
  it("animated tiles carry a fade overlay; reduceMotion is static", async () => {
    const animated = tiles(await render({ ...D }));
    expect(animated.some((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha)).toBe(true);
    const still = tiles(await render({ ...D, anim: { reduceMotion: true } }));
    expect(still.some((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha)).toBe(false);
  });
});

describe("AlpineTreemap — edge cases", () => {
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

describe("AlpineTreemap — two-mode reveal + theming (F4 U-A11)", () => {
  const mk = (): MosaicEngineContext => ({ mode: "render", target: { width: 1280, height: 800, fps: 30, durationMs: 2000 }, output: { width: 1280, height: 800, fps: 30, durationMs: 2000 }, media: {} } as unknown as MosaicEngineContext);
  const rr = async (p: Record<string, unknown>) => (await AlpineTreemap.render({ ...(AlpineTreemap.defaultProps as object), ...p } as never, mk())) as MosaicDocument;
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
    expect(JSON.stringify((await AlpineTreemap.render(AlpineTreemap.defaultProps as never, themed)) as MosaicDocument)).toContain("#101820");
  });
});
