import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete, getComplexityMetricsFast } from "@m0saic/dsl";
import { AlpineDonutV2 } from "./donut";

const W = 1280;
const H = 800;

function makeCtx(width = W, height = H, durationMs = 2000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width, height, fps: 30, durationMs },
    output: { width, height, fps: 30, durationMs, workspaceDir: "/tmp/alpine-donut-v2" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const render = async (props: Record<string, unknown>, w = W, h = H) =>
  (await AlpineDonutV2.render(props as never, makeCtx(w, h))) as MosaicDocument;

const D = AlpineDonutV2.defaultProps as Record<string, unknown>;
const seg = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `S${i + 1}`, value: n - i }));

function expectFramesMatchSources(doc: MosaicDocument, w = W, h = H): void {
  expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  const parsed = parseM0StringComplete(doc.m0 as unknown as string, w, h);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe((doc.sources ?? []).length);
  expect((doc as { children?: unknown }).children).toBeUndefined();
}

const srcs = (doc: MosaicDocument) => (doc.sources ?? []) as MosaicSource[];
const maskOf = (s: MosaicSource) => (s as { mask?: { kind?: string } }).mask;
const overlayOf = (s: MosaicSource) => (s as { overlay?: { alpha?: string } }).overlay;
const isText = (s: MosaicSource) => (s as { type?: string }).type === "text";
const isSector = (s: MosaicSource) => maskOf(s)?.kind === "inline-mask";

describe("AlpineDonutV2 — metadata", () => {
  it("is the registered v2 primitive, deprecated in favor of v3", () => {
    expect(AlpineDonutV2.id).toBe("@m0saic/alpine/donut/v2");
    expect(AlpineDonutV2.version).toBe(2);
    expect(AlpineDonutV2.primitive).toBe(true);
    const dep = (AlpineDonutV2 as { deprecated?: { replacement?: string } }).deprecated;
    expect(dep).toBeDefined();
    expect(dep?.replacement).toBe("@m0saic/alpine/donut/v3");
    expect(AlpineDonutV2.tags).toEqual(expect.arrayContaining(["alpine", "donut", "data-viz"]));
  });
});

describe("AlpineDonutV2 — RATIO precision (the v2 win)", () => {
  const precAt = async (w: number, h: number) => {
    const d = await render({ ...D, anim: { ...(D.anim as object), reduceMotion: true } }, w, h);
    const m = getComplexityMetricsFast(d.m0 as unknown as string);
    return { x: m.precision.maxSplitX, y: m.precision.maxSplitY };
  };
  it("the ring no longer pins the canvas: precision stays bounded across a sweep", async () => {
    const BOUND = 160;
    for (const [w, h] of [[1280, 800], [2560, 1600], [5120, 3200]] as const) {
      const p = await precAt(w, h);
      expect(p.x).toBeLessThanOrEqual(BOUND);
      expect(p.y).toBeLessThanOrEqual(BOUND);
    }
  });
});

describe("AlpineDonutV2 — render shape", () => {
  it("renders a valid m0 document; frames match sources (no children)", async () => {
    const doc = await render({ ...D });
    expectFramesMatchSources(doc);
    expect(doc.backgroundColor).toBeDefined();
  });

  it("paints one inline-mask sector per positive segment, plus center + legend text", async () => {
    const doc = await render({ ...D, segments: seg(4) });
    expect(srcs(doc).filter(isSector).length).toBe(4);
    expect(srcs(doc).filter(isText).length).toBeGreaterThanOrEqual(4);
  });

  it("drops zero / negative segments before placing sectors", async () => {
    const doc = await render({ ...D, segments: [{ label: "a", value: 10 }, { label: "zero", value: 0 }, { label: "neg", value: -5 }, { label: "b", value: 20 }] });
    expect(srcs(doc).filter(isSector).length).toBe(2);
  });

  it("animated → every sector carries an intro fade overlay; reduceMotion → none do", async () => {
    const animated = await render({ ...D });
    expect(srcs(animated).filter(isSector).every((s) => overlayOf(s)?.alpha != null)).toBe(true);
    const still = await render({ ...D, anim: { introFrac: 0.7, countUp: true, easing: "easeOut", reduceMotion: true } });
    expect(srcs(still).filter(isSector).some((s) => overlayOf(s)?.alpha != null)).toBe(false);
    expectFramesMatchSources(still);
  });

  it("is deterministic — identical inputs yield byte-identical m0", async () => {
    expect((await render({ ...D })).m0).toBe((await render({ ...D })).m0);
  });
});

describe("AlpineDonutV2 — two-mode reveal", () => {
  const enableOf = (s: MosaicSource) => (s as { overlay?: { enable?: string } }).overlay?.enable;
  const alphaOf = (s: MosaicSource) => (s as { overlay?: { alpha?: string } }).overlay?.alpha;
  const timeAlpha = (s: MosaicSource) => { const a = alphaOf(s); return a != null && /\bt\b/.test(String(a)); };

  it("premium (default): clockwise ALPHA-fade sweep (the geq) — no enable gates", async () => {
    const all = srcs(await render({ ...D }));
    expect(all.some(timeAlpha)).toBe(true);
    expect(all.some((s) => enableOf(s) != null)).toBe(false);
  });

  it("light: clockwise ENABLE-gate sweep — geq-free, gates present on every sector", async () => {
    const lightAnim = { ...(D.anim as object), renderMode: "light" };
    const all = srcs(await render({ ...D, anim: lightAnim }));
    expect(all.some(timeAlpha)).toBe(false);
    expect(all.filter((s) => enableOf(s) != null).length).toBeGreaterThan(0);
    expect(all.filter(isSector).every((s) => enableOf(s) != null)).toBe(true);
  });

  it("light reveal keeps the render valid", async () => {
    const lightAnim = { ...(D.anim as object), renderMode: "light" };
    expectFramesMatchSources(await render({ ...D, anim: lightAnim }));
  });
});

describe("AlpineDonutV2 — theming", () => {
  const themedCtx = (tokens: Record<string, unknown>): MosaicEngineContext =>
    ({ mode: "render", target: { width: W, height: H, fps: 30, durationMs: 2000 }, output: { width: W, height: H, fps: 30, durationMs: 2000 }, media: {}, upstreamData: { theme: tokens } } as unknown as MosaicEngineContext);

  it("a producer theme recolors the card + center text; unthemed default does not carry those tokens", async () => {
    const plain = JSON.stringify(await render({ ...D }));
    expect(plain).not.toContain("#101820");
    const themed = JSON.stringify((await AlpineDonutV2.render(D as never, themedCtx({ surface: "#101820", textPrimary: "#00FFCC" }))) as MosaicDocument);
    expect(themed).toContain("#101820");
    expect(themed).toContain("#00FFCC");
  });

  it("an explicit segment color still wins over a producer theme", async () => {
    const themed = JSON.stringify((await AlpineDonutV2.render({ ...D, segments: [{ label: "A", value: 1, color: "#123456" }, { label: "B", value: 1 }] } as never, themedCtx({ surface: "#101820" }))) as MosaicDocument);
    expect(themed).toContain("#123456");
  });
});

describe("AlpineDonutV2 — edge cases", () => {
  it("a single segment is a full ring (one clean sector)", async () => {
    const doc = await render({ ...D, segments: [{ label: "Only", value: 1 }] });
    expectFramesMatchSources(doc);
    expect(srcs(doc).filter(isSector).length).toBe(1);
  });

  it("renders valid m0 at the segment cap (12)", async () => {
    const doc = await render({ ...D, segments: seg(12) });
    expectFramesMatchSources(doc);
    expect(srcs(doc).filter(isSector).length).toBe(12);
    expect(srcs(doc).filter(isSector).every((s) => overlayOf(s)?.alpha != null)).toBe(true);
  });

  it("packs valid at square + portrait aspects", async () => {
    expectFramesMatchSources(await render({ ...D }, 1080, 1080), 1080, 1080);
    expectFramesMatchSources(await render({ ...D }, 800, 1280), 800, 1280);
  });

  it("legend: 'none' drops the side legend but keeps the ring + center value", async () => {
    const withLegend = await render({ ...D, legend: "right", segments: seg(3) });
    const noLegend = await render({ ...D, legend: "none", segments: seg(3) });
    expectFramesMatchSources(noLegend);
    expect(srcs(noLegend).filter(isSector).length).toBe(3);
    expect(srcs(noLegend).length).toBeLessThan(srcs(withLegend).length);
  });

  it("rejects empty segments with an error mosaic, not a throw", async () => {
    const doc = await render({ ...D, segments: [] });
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  });
});
