import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete } from "@m0saic/dsl";
import { AlpineDonut } from "./donut";

const W = 1280;
const H = 800;

function makeCtx(durationMs = 2000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: W, height: H, fps: 30, durationMs },
    output: { width: W, height: H, fps: 30, durationMs, workspaceDir: "/tmp/alpine-donut" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const render = async (props: Record<string, unknown>, durationMs?: number) =>
  (await AlpineDonut.render(props as never, makeCtx(durationMs))) as MosaicDocument;

const D = AlpineDonut.defaultProps as Record<string, unknown>;

const seg = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ label: `S${i + 1}`, value: n - i }));

/** Frames the engine paints == sources it consumes — the render-validity invariant.
 *  The donut places everything on the FULL canvas (no child docs), so the top-level
 *  source count must equal the m0's paint-frame count. */
function expectFramesMatchSources(doc: MosaicDocument): void {
  expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  const parsed = parseM0StringComplete(doc.m0 as unknown as string, W, H);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) {
    expect(parsed.ir.renderFrames.length).toBe((doc.sources ?? []).length);
  }
  expect((doc as { children?: unknown }).children).toBeUndefined();
}

const srcs = (doc: MosaicDocument) => (doc.sources ?? []) as MosaicSource[];
const maskOf = (s: MosaicSource) => (s as { mask?: { kind?: string } }).mask;
const overlayOf = (s: MosaicSource) => (s as { overlay?: { alpha?: string } }).overlay;
const isText = (s: MosaicSource) => (s as { type?: string }).type === "text";
/** A ring sector: a lavfi color tile carrying an inline-mask annular-sector path. */
const isSector = (s: MosaicSource) => maskOf(s)?.kind === "inline-mask";

describe("AlpineDonut — metadata", () => {
  it("is the registered v1 primitive, deprecated in favor of v2", () => {
    expect(AlpineDonut.id).toBe("@m0saic/alpine/donut/v1");
    expect(AlpineDonut.version).toBe(1);
    expect(AlpineDonut.primitive).toBe(true);
    const dep = (AlpineDonut as { deprecated?: { replacement?: string } }).deprecated;
    expect(dep).toBeDefined();
    expect(dep?.replacement).toBe("@m0saic/alpine/donut/v2");
    expect(AlpineDonut.tags).toEqual(expect.arrayContaining(["alpine", "donut", "data-viz"]));
  });

  it("defaults paint a concrete multi-segment ring", () => {
    expect(Array.isArray(D.segments)).toBe(true);
    expect((D.segments as unknown[]).length).toBeGreaterThanOrEqual(2);
  });
});

describe("AlpineDonut — render shape", () => {
  it("renders a valid m0 document; frames match sources (full-canvas, no children)", async () => {
    const doc = await render({ ...D });
    expectFramesMatchSources(doc);
    expect(doc.backgroundColor).toBeDefined();
  });

  it("paints one inline-mask sector per positive segment, plus center + legend text", async () => {
    const doc = await render({ ...D, segments: seg(4) });
    expect(srcs(doc).filter(isSector).length).toBe(4);
    // center value + legend labels are all text sources
    expect(srcs(doc).filter(isText).length).toBeGreaterThanOrEqual(4);
  });

  it("drops zero / negative segments before placing sectors", async () => {
    const doc = await render({
      ...D,
      segments: [
        { label: "a", value: 10 },
        { label: "zero", value: 0 },
        { label: "neg", value: -5 },
        { label: "b", value: 20 },
      ],
    });
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
    const a = await render({ ...D });
    const b = await render({ ...D });
    expect(a.m0).toBe(b.m0);
  });
});

describe("AlpineDonut — two-mode reveal (F4 U-A2)", () => {
  const enableOf = (s: MosaicSource) => (s as { overlay?: { enable?: string } }).overlay?.enable;
  const alphaOf = (s: MosaicSource) => (s as { overlay?: { alpha?: string } }).overlay?.alpha;
  const timeAlpha = (s: MosaicSource) => { const a = alphaOf(s); return a != null && /\bt\b/.test(String(a)); };

  it("premium (default): clockwise ALPHA-fade sweep (the geq) — no enable gates", async () => {
    const all = srcs(await render({ ...D }));
    expect(all.some(timeAlpha)).toBe(true);          // fade present
    expect(all.some((s) => enableOf(s) != null)).toBe(false); // no gate
  });

  it("light: clockwise ENABLE-gate sweep — geq-free (zero time-varying alpha), gates present", async () => {
    const light = { ...(D.anim as object), renderMode: "light" };
    const all = srcs(await render({ ...D, anim: light }));
    expect(all.some(timeAlpha)).toBe(false);          // no geq
    expect(all.filter((s) => enableOf(s) != null).length).toBeGreaterThan(0); // staggered gates
    // sectors still gated clockwise (one gate per sector)
    expect(all.filter(isSector).every((s) => enableOf(s) != null)).toBe(true);
  });

  it("light reveal keeps the render valid (frames match sources)", async () => {
    const light = { ...(D.anim as object), renderMode: "light" };
    expectFramesMatchSources(await render({ ...D, anim: light }));
  });
});

describe("AlpineDonut — theming (F4 U-A2)", () => {
  const themedCtx = (tokens: Record<string, unknown>): MosaicEngineContext =>
    ({ mode: "render", target: { width: W, height: H, fps: 30, durationMs: 2000 }, output: { width: W, height: H, fps: 30, durationMs: 2000 }, media: {}, upstreamData: { theme: tokens } } as unknown as MosaicEngineContext);

  it("a producer theme recolors the card + center text; unthemed default does not carry those tokens", async () => {
    const plain = JSON.stringify(await render({ ...D }));
    expect(plain).not.toContain("#101820");
    const themed = JSON.stringify((await AlpineDonut.render(D as never, themedCtx({ surface: "#101820", textPrimary: "#00FFCC" }))) as MosaicDocument);
    expect(themed).toContain("#101820"); // producer card
    expect(themed).toContain("#00FFCC"); // producer center value
  });

  it("an explicit segment color still wins over a producer theme", async () => {
    const themed = JSON.stringify((await AlpineDonut.render({ ...D, segments: [{ label: "A", value: 1, color: "#123456" }, { label: "B", value: 1 }] } as never, themedCtx({ surface: "#101820" }))) as MosaicDocument);
    expect(themed).toContain("#123456");
  });
});

describe("AlpineDonut — edge cases", () => {
  it("a single segment is a full ring (one clean sector, no gap notch)", async () => {
    const doc = await render({ ...D, segments: [{ label: "Only", value: 1 }] });
    expectFramesMatchSources(doc);
    expect(srcs(doc).filter(isSector).length).toBe(1);
  });

  it("renders valid m0 at the segment cap (12) — the staggered full-sector reveal", async () => {
    const doc = await render({ ...D, segments: seg(12) });
    expectFramesMatchSources(doc);
    expect(srcs(doc).filter(isSector).length).toBe(12);
    // every sector still animates in (each fades at a clockwise-staggered time)
    expect(srcs(doc).filter(isSector).every((s) => overlayOf(s)?.alpha != null)).toBe(true);
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
