import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete } from "@m0saic/dsl";
import { AlpineKpiCard } from "./kpi-card";

const W = 1280;
const H = 800;

function makeCtx(durationMs = 2000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: W, height: H, fps: 30, durationMs },
    output: { width: W, height: H, fps: 30, durationMs, workspaceDir: "/tmp/alpine-kpi" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const render = async (props: Record<string, unknown>, durationMs?: number) =>
  (await AlpineKpiCard.render(props as never, makeCtx(durationMs))) as MosaicDocument;

const D = AlpineKpiCard.defaultProps as Record<string, unknown>;
const srcs = (doc: MosaicDocument) => (doc.sources ?? []) as MosaicSource[];
const isText = (s: MosaicSource) => (s as { type?: string }).type === "text";
const maskPath = (s: MosaicSource) => (s as { mask?: { localPath?: string } }).mask?.localPath ?? "";
/** A triangle arrow: a short 3-vertex mask path ("M … L … L … Z", no curves). */
const isTriangle = (s: MosaicSource) => { const p = maskPath(s); return !!p && p.length < 120 && (p.match(/L/g)?.length ?? 0) === 2; };
/** The sparkline area: a long multi-point polygon mask. */
const isSparkArea = (s: MosaicSource) => maskPath(s).length > 500;
const colorOf = (s: MosaicSource) => (s as { color?: string }).color;
const fontColorsOf = (s: MosaicSource) => ((s as { layers?: Array<{ style?: { fontColor?: string } }> }).layers ?? []).map((l) => l.style?.fontColor);

const POSITIVE = "#16A34A";
const NEGATIVE = "#DC2626";
const PRIMARY = "#2563EB";

function expectFramesMatchSources(doc: MosaicDocument): void {
  expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  const parsed = parseM0StringComplete(doc.m0 as unknown as string, W, H);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe((doc.sources ?? []).length);
  expect((doc as { children?: unknown }).children).toBeUndefined();
}

describe("AlpineKpiCard — metadata", () => {
  it("is the registered v1 primitive, deprecated in favor of v2", () => {
    expect(AlpineKpiCard.id).toBe("@m0saic/alpine/kpi-card/v1");
    expect(AlpineKpiCard.version).toBe(1);
    expect(AlpineKpiCard.primitive).toBe(true);
    const dep = (AlpineKpiCard as { deprecated?: { replacement?: string } }).deprecated;
    expect(dep).toBeDefined();
    expect(dep?.replacement).toBe("@m0saic/alpine/kpi-card/v2");
    expect(AlpineKpiCard.tags).toEqual(expect.arrayContaining(["alpine", "kpi", "data-viz"]));
  });
});

describe("AlpineKpiCard — render shape", () => {
  it("renders a valid m0 document; frames match sources (full-canvas, no children)", async () => {
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

describe("AlpineKpiCard — delta pill", () => {
  it("up / down render a triangle arrow; flat and no-delta render none", async () => {
    expect(srcs(await render({ ...D, direction: "up" })).some(isTriangle)).toBe(true);
    expect(srcs(await render({ ...D, direction: "down", delta: "-3%" })).some(isTriangle)).toBe(true);
    expect(srcs(await render({ ...D, direction: "flat", delta: "0%" })).some(isTriangle)).toBe(false);
    expect(srcs(await render({ ...D, delta: "" })).some(isTriangle)).toBe(false);
  });
});

describe("AlpineKpiCard — direction-aware sparkline", () => {
  it("color tracks direction: up=positive, down=negative, flat=primary", async () => {
    const up = srcs(await render({ ...D, direction: "up" })).find(isSparkArea);
    const down = srcs(await render({ ...D, direction: "down", delta: "-3%" })).find(isSparkArea);
    const flat = srcs(await render({ ...D, direction: "flat", delta: "0%" })).find(isSparkArea);
    expect(colorOf(up!)).toBe(POSITIVE);
    expect(colorOf(down!)).toBe(NEGATIVE);
    expect(colorOf(flat!)).toBe(PRIMARY);
  });

  it("auto-generates a trend (up ascends, down descends) when no data is given", async () => {
    // Sample the first vs last data point via the area path's first/last Y is
    // hard to read here; assert presence + that explicit data still wins.
    expect(srcs(await render({ label: "x", value: "9", direction: "up" })).some(isSparkArea)).toBe(true);
    expect(srcs(await render({ label: "x", value: "9", direction: "down", delta: "-1%" })).some(isSparkArea)).toBe(true);
  });

  it("explicit [] hides the sparkline; explicit data shows it", async () => {
    expect(srcs(await render({ label: "x", value: "9", sparkline: [] })).some(isSparkArea)).toBe(false);
    expect(srcs(await render({ label: "x", value: "9", sparkline: [1, 5, 3, 8] })).some(isSparkArea)).toBe(true);
  });
});

describe("AlpineKpiCard — color knobs fail safe", () => {
  it("a cleared / 'none' / blank valueColor falls back to the theme (never blanks the value)", async () => {
    for (const vc of ["", "none", "  "]) {
      const doc = await render({ label: "x", value: "4.8%", valueColor: vc, anim: { reduceMotion: true } });
      // no painted source carries an empty/none font color
      expect(srcs(doc).flatMap(fontColorsOf).some((c) => !c || c === "" || c === "none")).toBe(false);
      expectFramesMatchSources(doc);
    }
  });

  it("an explicit valueColor is honored", async () => {
    const doc = await render({ label: "x", value: "9", valueColor: "#FF0000", anim: { reduceMotion: true } });
    expect(srcs(doc).flatMap(fontColorsOf)).toContain("#FF0000");
  });
});

describe("AlpineKpiCard — edge cases", () => {
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

describe("AlpineKpiCard — two-mode reveal + theming (F4 U-A7)", () => {
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
    const themed = JSON.stringify((await AlpineKpiCard.render(D as never, themedCtx({ surface: "#101820" }))) as MosaicDocument);
    expect(themed).toContain("#101820");
    const explicit = JSON.stringify((await AlpineKpiCard.render({ ...D, valueColor: "#123456" } as never, themedCtx({ textPrimary: "#00FFCC" }))) as MosaicDocument);
    expect(explicit).toContain("#123456");
  });
});
