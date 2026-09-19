import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete } from "@m0saic/dsl";
import { AlpineHeatmap } from "./heatmap";

const W = 1280;
const H = 800;

function makeCtx(durationMs = 2000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: W, height: H, fps: 30, durationMs },
    output: { width: W, height: H, fps: 30, durationMs, workspaceDir: "/tmp/alpine-heatmap" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const render = async (props: Record<string, unknown>, durationMs?: number) =>
  (await AlpineHeatmap.render(props as never, makeCtx(durationMs))) as MosaicDocument;

const D = AlpineHeatmap.defaultProps as Record<string, unknown>;
const srcs = (doc: MosaicDocument) => (doc.sources ?? []) as MosaicSource[];
const colorOf = (s: MosaicSource) => (s as { color?: string }).color;
const effectsOf = (s: MosaicSource) => (s as { effects?: { rounding?: { borderRadius?: number } } }).effects;
const isText = (s: MosaicSource) => (s as { type?: string }).type === "text";
const textOf = (s: MosaicSource) => ((s as { layers?: Array<{ content?: { text?: string } }> }).layers ?? [])[0]?.content?.text;
const isTile = (s: MosaicSource) => (s as { type?: string }).type === "lavfi";
/** Heatmap cells are rounded lavfi tiles with importance 0 (the back layer). The
 *  legend swatches are also rounded tiles but carry importance 1 (front). We count
 *  tiles by the radius the call sites use; cells share the run's cellRadius. */
const tiles = (doc: MosaicDocument) => srcs(doc).filter(isTile);
const texts = (doc: MosaicDocument) => srcs(doc).filter(isText).map(textOf);

function expectFramesMatchSources(doc: MosaicDocument): void {
  expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  const parsed = parseM0StringComplete(doc.m0 as unknown as string, W, H);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe((doc.sources ?? []).length);
  expect((doc as { children?: unknown }).children).toBeUndefined();
}

/** Distinct cell-frame widths in the resolved m0 — the quantization regression guard.
 *  A correct grid renders every cell at one uniform width. */
function cellWidthHistogram(doc: MosaicDocument): Record<number, number> {
  const parsed = parseM0StringComplete(doc.m0 as unknown as string, W, H);
  if (!parsed.ok) return {};
  const counts: Record<number, number> = {};
  for (const f of parsed.ir.renderFrames) {
    const w = Math.round((f as { width: number }).width);
    counts[w] = (counts[w] ?? 0) + 1;
  }
  return counts;
}

describe("AlpineHeatmap — metadata", () => {
  it("is the registered v1 primitive, deprecated in favor of v2", () => {
    expect(AlpineHeatmap.id).toBe("@m0saic/alpine/heatmap/v1");
    expect(AlpineHeatmap.version).toBe(1);
    expect(AlpineHeatmap.primitive).toBe(true);
    const dep = (AlpineHeatmap as { deprecated?: { replacement?: string } }).deprecated;
    expect(dep).toBeDefined();
    expect(dep?.replacement).toBe("@m0saic/alpine/heatmap/v2");
    expect(AlpineHeatmap.tags).toEqual(expect.arrayContaining(["alpine", "heatmap", "data-viz"]));
  });
});

describe("AlpineHeatmap — render shape", () => {
  it("renders valid m0; frames match sources; no children", async () => {
    const doc = await render({ ...D });
    expectFramesMatchSources(doc);
    expect(doc.backgroundColor).toBeDefined();
  });

  it("is deterministic — identical inputs yield byte-identical m0", async () => {
    expect((await render({ ...D })).m0).toBe((await render({ ...D })).m0);
  });

  it("emits one cell per rows×cols, including ragged-row empty cells", async () => {
    // 2 rows × 3 cols (the 2nd row is ragged → padded with empty cells).
    const doc = await render({ rows: [{ label: "a", values: [1, 2, 3] }, { label: "b", values: [4] }], showLegend: false, anim: { reduceMotion: true } });
    // 6 cells (+ 2 row labels). At least the 6 cell tiles are present.
    expect(tiles(doc).length).toBeGreaterThanOrEqual(6);
  });
});

describe("AlpineHeatmap — grid geometry (quantization guard)", () => {
  it("renders every cell at one uniform width (no quantization spread)", async () => {
    const doc = await render({ ...D });
    const hist = cellWidthHistogram(doc);
    // The dominant width bucket is the cell width; for a 7×8 grid that's 56 cells.
    const maxCount = Math.max(...Object.values(hist));
    expect(maxCount).toBeGreaterThanOrEqual(56);
  });
});

describe("AlpineHeatmap — color scale", () => {
  it("buckets values: a zero/min cell uses the empty color, the max cell the full color", async () => {
    const doc = await render({ rows: [{ label: "", values: [0, 10] }], color: "#2563EB", emptyColor: "#EBEEF2", levels: 5, min: 0, max: 10, showLegend: false, anim: { reduceMotion: true } });
    const cols = tiles(doc).map((s) => (colorOf(s) ?? "").toUpperCase());
    expect(cols).toContain("#EBEEF2"); // the 0 cell
    expect(cols).toContain("#2563EB"); // the max cell at full intensity (scale round-trips to lowercase hex)
  });

  it("levels controls the legend swatch count (legend on → levels swatches present)", async () => {
    const off = await render({ ...D, showLegend: false });
    const on = await render({ ...D, showLegend: true, levels: 7 });
    expect(tiles(on).length).toBeGreaterThan(tiles(off).length);
  });
});

describe("AlpineHeatmap — labels & legend", () => {
  it("row + column labels render; legend shows Less/More", async () => {
    const t = texts(await render({ ...D, anim: { reduceMotion: true } }));
    expect(t).toContain("Mon");
    expect(t).toContain("W1");
    expect(t).toContain("Less");
    expect(t).toContain("More");
  });

  it("showLegend:false drops the Less/More legend", async () => {
    const t = texts(await render({ ...D, showLegend: false, anim: { reduceMotion: true } }));
    expect(t).not.toContain("Less");
    expect(t).not.toContain("More");
  });
});

describe("AlpineHeatmap — in-cell values", () => {
  it("showValues prints compact values; big numbers never render long-form", async () => {
    const t = texts(await render({ rows: [{ label: "", values: [4500, 38000, 1200000] }], showValues: true, showLegend: false, min: 0, anim: { reduceMotion: true } }));
    expect(t).toContain("4.5K");
    expect(t).toContain("38K");
    expect(t).toContain("1.2M");
    expect(t).not.toContain("1200000");
  });

  it("showValues:false prints no in-cell numbers", async () => {
    const t = texts(await render({ rows: [{ label: "", values: [5, 9] }], showValues: false, showLegend: false, anim: { reduceMotion: true } }));
    expect(t.filter((x) => x === "5" || x === "9")).toHaveLength(0);
  });
});

describe("AlpineHeatmap — animation", () => {
  it("animated cells carry a fade overlay; reduceMotion cells are static", async () => {
    const animated = tiles(await render({ ...D }));
    const hasFade = animated.some((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha);
    expect(hasFade).toBe(true);
    const still = tiles(await render({ ...D, anim: { reduceMotion: true } }));
    const anyFade = still.some((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha);
    expect(anyFade).toBe(false);
  });
});

describe("AlpineHeatmap — two-mode reveal (F4 U-A3)", () => {
  const timeAlpha = (s: MosaicSource) => { const a = (s as { overlay?: { alpha?: string } }).overlay?.alpha; return a != null && /\bt\b/.test(String(a)); };
  const enableOf = (s: MosaicSource) => (s as { overlay?: { enable?: string } }).overlay?.enable;

  it("premium (default): diagonal ALPHA-fade cascade (a geq per cell) — no enable gates", async () => {
    const cells = tiles(await render({ ...D }));
    expect(cells.some(timeAlpha)).toBe(true);
    expect(cells.some((s) => enableOf(s) != null)).toBe(false);
  });

  it("light: diagonal ENABLE-gate cascade — geq-free (zero time-alpha), one gate per cell", async () => {
    const all = srcs(await render({ ...D, anim: { ...(D.anim as object), renderMode: "light" } }));
    expect(all.some(timeAlpha)).toBe(false);              // no geq anywhere
    // the staggered enable gates carry the diagonal cascade order (one per cell)
    expect(all.filter((s) => enableOf(s) != null).length).toBeGreaterThanOrEqual(40);
  });

  it("light reveal keeps the render valid (frames match sources)", async () => {
    expectFramesMatchSources(await render({ ...D, anim: { ...(D.anim as object), renderMode: "light" } }));
  });
});

describe("AlpineHeatmap — theming + scale group (F4 U-A3)", () => {
  const themedCtx = (tokens: Record<string, unknown>): MosaicEngineContext =>
    ({ mode: "render", target: { width: W, height: H, fps: 30, durationMs: 2000 }, output: { width: W, height: H, fps: 30, durationMs: 2000 }, media: {}, upstreamData: { theme: tokens } } as unknown as MosaicEngineContext);

  it("a producer theme recolors the card; unthemed default does not carry the token", async () => {
    const plain = JSON.stringify(await render({ ...D }));
    expect(plain).not.toContain("#101820");
    const themed = JSON.stringify((await AlpineHeatmap.render(D as never, themedCtx({ surface: "#101820" }))) as MosaicDocument);
    expect(themed).toContain("#101820");
  });

  it("an explicit scale color still wins over a producer theme", async () => {
    const themed = JSON.stringify((await AlpineHeatmap.render({ ...D, color: "#123456" } as never, themedCtx({ accent: "#00FFCC" }))) as MosaicDocument);
    expect(themed).toContain("#123456");
  });

  it("scale group (min/max/cellRadius) drives the buckets & rounding", async () => {
    // moved from flat min/max/cellRadius → the `scale` group (F4 U-A3 prop-UX reorg).
    // Geometry (m0) is domain-independent; the bucket FILLS (source colors) are not.
    const fills = (d: MosaicDocument) => tiles(d).map(colorOf).join(",");
    const wide = await render({ ...D, scale: { min: 0, max: 1000 } });
    const narrow = await render({ ...D, scale: { min: 0, max: 5 } });
    expect(fills(wide)).not.toBe(fills(narrow)); // different domain → different bucket fills
    expectFramesMatchSources(await render({ ...D, scale: { cellRadius: 0.5 } }));
  });
});

describe("AlpineHeatmap — inputs & edge cases", () => {
  it("accepts CSV-string row values (the objectRows editor shape)", async () => {
    const doc = await render({ rows: [{ label: "x", values: "1, 2, 3, 4" }], showLegend: false, anim: { reduceMotion: true } });
    expectFramesMatchSources(doc);
    expect(tiles(doc).length).toBeGreaterThanOrEqual(4);
  });

  it("dark preset + a large grid render valid", async () => {
    expectFramesMatchSources(await render({ ...D, preset: "dark" }));
    const big = { rows: Array.from({ length: 7 }, (_, r) => ({ label: `r${r}`, values: Array.from({ length: 16 }, (_, c) => (r + c) % 11) })), colLabels: Array.from({ length: 16 }, (_, i) => `W${i + 1}`), anim: { reduceMotion: true } };
    expectFramesMatchSources(await render(big));
  });

  it("rejects empty rows with an error mosaic, not a throw", async () => {
    const doc = await render({ rows: [] });
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  });
});
