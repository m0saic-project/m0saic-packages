import type { MosaicColor, MosaicDocument, MosaicEngineContext } from "@m0saic/types";
import { ChartsLineChart } from "./line-chart";
import { buildLineChartModel, type SeriesInput } from "../../_shared/line";
import { resolveAxis, DEFAULT_PADDING, PRESET_TOKENS } from "./defaults";
import { resolveBackground } from "./axis";
import { buildSweepSlivers, vertexFractions, ribbonQuadPath, markerPath, areaPolygonPath, buildDashMarks, curvePolyline } from "./geometry";
import { buildChromeSpec } from "./chrome-spec";
import { buildLineSeriesSources } from "./line-series";
import { computeFrame, BASIS_COL, BASIS_ROW } from "./frame";
import { Chrome } from "./chrome";
import { sliverTiming, buildCurtainColumns } from "./anim";
import type { ResolvedSeriesStyle } from "./types";
import { isValidM0String } from "@m0saic/dsl";
import { resolvePropBindings } from "@m0saic/template-utils";
// Register the grid primitive so chrome's nested render resolves it.
import "../../../primitives/grid/v2/grid";

function makeCtx(width = 1280, height = 720): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width, height, fps: 30, durationMs: 2000 },
    output: { width, height, fps: 30, durationMs: 2000, workspaceDir: "/tmp/line-chart" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const SHOWCASE = [1200, 1900, 2600, 4100, 6300, 9800];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];

function model(values: number[][] = [SHOWCASE], labels = MONTHS) {
  const input: SeriesInput = {
    labels,
    series: values.map((v, i) => ({ name: `S${i}`, values: v, color: "#2563eb" })),
  };
  return buildLineChartModel(input, {
    width: 1280, height: 720,
    padding: { left: DEFAULT_PADDING.left, right: DEFAULT_PADDING.right, top: DEFAULT_PADDING.top, bottom: DEFAULT_PADDING.bottom },
    beginAtZero: true, maxTicks: 11,
  });
}

const style = (over: Partial<ResolvedSeriesStyle> = {}): ResolvedSeriesStyle => ({
  color: "#2563eb", strokeWidth: 2, lineStyle: "solid", curve: "linear",
  lineCap: "round", lineJoin: "round",
  area: { show: false, opacity: 0.15 },
  showPoints: true, pointRadius: 3, pointColor: "#2563eb", pointShape: "circle",
  pointBorder: { width: 0 },
  ...over,
});

describe("Line Chart — domain math (Chart.js-faithful)", () => {
  it("derives nice ticks 0..10000 step 1000 for the showcase data", () => {
    const m = model();
    expect(m.scale.min).toBe(0);
    expect(m.scale.max).toBe(10000);
    expect(m.scale.ticks).toHaveLength(11);
  });
  it("places the plot rect at the approved frame insets (72 / 16 / 120 / 48)", () => {
    const { plot } = model().layout;
    expect(plot.left).toBe(72);
    expect(plot.right).toBe(1280 - 16);
    expect(plot.top).toBe(120);
    expect(plot.bottom).toBe(720 - 48);
  });
  it("first/last category centers touch the plot edges (offset:false)", () => {
    const m = model();
    expect(m.xs[0]).toBeCloseTo(72, 5);
    expect(m.xs[m.xs.length - 1]).toBeCloseTo(1264, 5);
  });
});

describe("Line Chart — native geometry (draw-on sweep)", () => {
  it("ribbon quad is a closed 4-point filled path", () => {
    const d = ribbonQuadPath({ x: 0, y: 0 }, { x: 10, y: 0 }, 4);
    expect(d.startsWith("M ")).toBe(true);
    expect(d.trim().endsWith("Z")).toBe(true);
    expect((d.match(/L /g) ?? []).length).toBe(3); // 4 corners = M + 3 L
  });
  it("markers: circle uses arcs, square/diamond use line segments", () => {
    expect(markerPath({ x: 5, y: 5 }, 3, "circle")).toContain("a ");
    expect(markerPath({ x: 5, y: 5 }, 3, "square")).toContain("L ");
    expect(markerPath({ x: 5, y: 5 }, 3, "diamond")).toContain("L ");
  });
  it("area polygon closes down to the baseline", () => {
    const d = areaPolygonPath([{ x: 0, y: 10 }, { x: 10, y: 5 }], 100);
    expect(d).toContain("100");
    expect(d.trim().endsWith("Z")).toBe(true);
  });
  it("subdivides the polyline into many slivers, capped, fractions ascending 0→~1", () => {
    const m = model();
    const slivers = buildSweepSlivers(m.points[0], 2, { maxSlivers: 36 });
    expect(slivers.length).toBeGreaterThan(5);
    expect(slivers.length).toBeLessThanOrEqual(36);
    expect(slivers[0].frac0).toBeCloseTo(0, 3);
    expect(slivers[slivers.length - 1].frac0).toBeLessThan(1);
    for (let i = 1; i < slivers.length; i++) expect(slivers[i].frac0).toBeGreaterThanOrEqual(slivers[i - 1].frac0);
  });
  it("lineStyle dashed → ribbon marks; dotted → dots; spaced along arc-length", () => {
    const pts = model().points[0];
    const dashed = buildDashMarks(pts, 2, "dashed", { maxMarks: 500 });
    const dotted = buildDashMarks(pts, 2, "dotted", { maxMarks: 500 });
    const capped = buildDashMarks(pts, 2, "dotted", { maxMarks: 20 });
    expect(dashed.length).toBeGreaterThan(3);
    expect(dashed.every((m) => !m.isDot)).toBe(true);
    expect(dotted.every((m) => m.isDot)).toBe(true);
    // arc-length fractions ascend 0→<1 and respect the cap
    expect(dashed[0].frac0).toBeCloseTo(0, 3);
    expect(capped.length).toBeLessThanOrEqual(20);
    for (let i = 1; i < dashed.length; i++) expect(dashed[i].frac0).toBeGreaterThan(dashed[i - 1].frac0);
    // dotted period is tighter than dashed → more dots than dashes
    expect(dotted.length).toBeGreaterThan(dashed.length);
  });

  it("curve: linear passthrough; stepped inserts corners; smooth densifies through every point", () => {
    const pts = model().points[0];
    const linear = curvePolyline(pts, "linear");
    const stepped = curvePolyline(pts, "stepped");
    const smooth = curvePolyline(pts, "smooth");
    // linear is the points unchanged
    expect(linear.poly).toBe(pts);
    // stepped adds one corner per segment; smooth samples densely
    expect(stepped.poly.length).toBe(pts.length * 2 - 1);
    expect(smooth.poly.length).toBeGreaterThan(pts.length * 8);
    // both still pass THROUGH the original endpoints
    for (const c of [stepped, smooth]) {
      expect(c.poly[0]).toEqual(pts[0]);
      const last = c.poly[c.poly.length - 1];
      expect(last.x).toBeCloseTo(pts[pts.length - 1].x, 3);
      expect(last.y).toBeCloseTo(pts[pts.length - 1].y, 3);
      // one vertex fraction per original point, ascending 0→1
      expect(c.vertexFracs).toHaveLength(pts.length);
      expect(c.vertexFracs[0]).toBeCloseTo(0, 5);
      expect(c.vertexFracs[c.vertexFracs.length - 1]).toBeCloseTo(1, 5);
    }
  });

  it("vertex fractions run 0..1 across the data points", () => {
    const f = vertexFractions(model().points[0]);
    expect(f[0]).toBe(0);
    expect(f[f.length - 1]).toBeCloseTo(1, 6);
  });
  it("sweep timing: later slivers start later, fades overlap", () => {
    const a = { intro: { durationSec: 1, delaySec: 0.1, staggerSec: 0, ease: "smoothstep" as const }, reduceMotion: false };
    const early = sliverTiming(0, 30, a);
    const late = sliverTiming(0.9, 30, a);
    expect(late.startSec).toBeGreaterThan(early.startSec);
    expect(early.fadeDur).toBeGreaterThan(0);
  });
});

describe("Line Chart — real-geometry frame", () => {
  it("frame weights sum to the bounded basis and reproduce the approved insets at 1280×720", () => {
    const f = computeFrame(1280, 720, DEFAULT_PADDING);
    expect(f.rootRow[0] + f.rootRow[1] + f.rootRow[2]).toBe(BASIS_ROW);
    expect(f.bodyCol[0] + f.bodyCol[1] + f.bodyCol[2]).toBe(BASIS_COL);
    // Geometry is the source of truth; at the default size it lands exactly.
    expect(f.plot.left).toBeCloseTo(72, 5);
    expect(f.plot.right).toBeCloseTo(1264, 5);
    expect(f.plot.top).toBeCloseTo(120, 5);
    expect(f.plot.bottom).toBeCloseTo(672, 5);
  });

  it("stays under the engine ~200-cell split cap at 1080p", () => {
    const f = computeFrame(1920, 1080, DEFAULT_PADDING);
    expect(f.basisCol).toBeLessThanOrEqual(200);
    expect(f.basisRow).toBeLessThanOrEqual(200);
  });

  it("plans real regions: header bands, y ticks (max→min), x labels, gridlines", () => {
    const m = model();
    const f = computeFrame(1280, 720, DEFAULT_PADDING);
    const spec = buildChromeSpec(m, f, {
      xAxis: resolveAxis(undefined, "x", "neutral"),
      yAxis: resolveAxis(undefined, "y", "neutral"),
      series: [style()],
      title: "T", subtitle: "S",
      titleColor: "#111827", titleSize: 22, titleAlign: "center", subtitleColor: "#6b7280",
      legend: { show: true, position: "top", color: "#6b7280", fontSize: 13 },
    });
    expect(spec.header.title?.text).toBe("T");
    expect(spec.header.subtitle?.text).toBe("S");
    expect(spec.header.legend?.entries.length).toBe(1);
    // 11 ticks, ordered top→bottom (max first): "10,000" … "0".
    expect(spec.yTicks).toHaveLength(11);
    expect(spec.yTicks[0].text).toBe("10,000");
    expect(spec.yTicks[0].vAlign).toBe("top");
    expect(spec.yTicks[spec.yTicks.length - 1].text).toBe("0");
    expect(spec.yTicks[spec.yTicks.length - 1].vAlign).toBe("bottom");
    // 6 category labels, edge-hugging alignment.
    expect(spec.xLabels.map((t) => t.text)).toEqual(MONTHS);
    expect(spec.xLabels[0].hAlign).toBe("left");
    expect(spec.xLabels[5].hAlign).toBe("right");
    // y grid only by default (Chart.js look), one line per tick interval.
    expect(spec.grids).toHaveLength(1);
    expect(spec.grids[0]).toMatchObject({ direction: "horizontal", count: 10 });
  });

  it("assembles a VALID m0 string (real geometry, not a full-frame overlay stack)", async () => {
    const m = model();
    const f = computeFrame(1280, 720, DEFAULT_PADDING);
    const spec = buildChromeSpec(m, f, {
      xAxis: resolveAxis(undefined, "x", "neutral"),
      yAxis: resolveAxis(undefined, "y", "neutral"),
      series: [style()],
      title: "T", subtitle: "S",
      titleColor: "#111827", titleSize: 22, titleAlign: "center", subtitleColor: "#6b7280",
      legend: { show: true, position: "top", color: "#6b7280", fontSize: 13 },
    });
    const doc = (await Chrome.render({ spec } as never, makeCtx())) as MosaicDocument;
    expect(isValidM0String(String(doc.m0))).toBe(true);
    // It must NOT be a flat full-canvas overlay stack — real splits carry "[" or "(".
    expect(/[[(]/.test(String(doc.m0))).toBe(true);
    // One source per painted cell; emission order matches the m0 (no exception thrown).
    expect((doc.sources?.length ?? 0)).toBeGreaterThan(10);
    // Gridlines are nested as the first-party grid primitive (a child ref).
    expect(doc.children && Object.keys(doc.children).some((k) => k.startsWith("grid"))).toBe(true);
  });
});

describe("Line Chart — background resolution", () => {
  it('"none" → transparent canvas', () => {
    const r = resolveBackground({ preset: "neutral", backgroundColor: "none" });
    expect(r.mode).toBe("none");
    expect(r.canvasColor).toBeUndefined();
  });
  it("solid color → solid mode", () => {
    const r = resolveBackground({ preset: "neutral", backgroundColor: "#fef3c7" });
    expect(r.mode).toBe("solid");
    expect(r.cardColor).toBe("#fef3c7");
  });
  it("image present → image mode", () => {
    const r = resolveBackground({ preset: "neutral", backgroundImage: "data:image/png;base64,AAAA" });
    expect(r.mode).toBe("image");
  });
  it("default → preset card", () => {
    const r = resolveBackground({ preset: "dark" });
    expect(r.mode).toBe("preset");
    expect(r.cardColor).toBe(PRESET_TOKENS.dark.card);
  });
});

describe("Line Chart — props validation", () => {
  const render = async (props: Record<string, unknown>) =>
    (await ChartsLineChart.render(props as never, makeCtx())) as MosaicDocument;
  it("returns an error mosaic for empty values", async () => {
    const doc = await render({ values: [] });
    expect(JSON.stringify(doc)).toMatch(/non-empty/i);
  });
  it("returns an error mosaic for non-finite values (no NaN crash)", async () => {
    const doc = await render({ values: [1, Infinity, 3] });
    expect(JSON.stringify(doc)).toMatch(/finite/i);
  });
  it("reconciles a value/label count mismatch → renders instead of NaN x-positions", async () => {
    // 7 values, 6 labels: the 7th point would have no x-position without
    // reconciliation → NaN → placeRects throws. Sensible default pads the label.
    const doc = await render({
      values: [1200, 1900, 2600, 4100, 6300, 9800, 400],
      labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
    });
    expect(isValidM0String(String(doc.m0))).toBe(true);
    expect(String(doc.m0).startsWith("1{1{")).toBe(true); // real chart, not an error mosaic
  });
});

describe("Line Chart — data layer (static atlases + curtain reveal, R6)", () => {
  const anim = (reduceMotion: boolean) => ({
    intro: { durationSec: 1.1, delaySec: 0.1, staggerSec: 0.12, ease: "smoothstep" as const },
    reduceMotion,
  });
  // atlas = masked color tile (lavfi + mask); curtain = lavfi drawbox track.
  const isAtlas = (s: any) => s.type === "lavfi" && s.mask != null;
  const isCurtain = (s: any) => s.type === "lavfi" && typeof s.lavfi === "string" && s.lavfi.includes("drawbox");
  const hasAlpha = (s: any) => s.overlay?.alpha != null;
  const hasEnable = (s: any) => s.overlay?.enable != null;
  const opaque = { plotBg: { mode: "preset" as const, color: "#ffffff" as MosaicColor } };

  it("opaque path: data atlases carry NO overlay.alpha and emit exactly ONE lavfi curtain", () => {
    const data = buildLineSeriesSources(model(), [style()], anim(false), opaque)!;
    expect(data).not.toBeNull();
    const atlases = data.sources.filter(isAtlas);
    expect(atlases.length).toBeGreaterThan(0);
    expect(atlases.every((s) => !hasAlpha(s))).toBe(true); // R4-clean data tiles
    expect(data.sources.filter(isCurtain).length).toBe(1); // one curtain regardless of series
    expect(data.sources.some(hasAlpha)).toBe(false); //       zero animated alpha anywhere
  });

  it("overlay depth is O(series): one series ⇒ a small handful of layers, not a per-sliver cascade", () => {
    const data = buildLineSeriesSources(model(), [style()], anim(false), opaque)!;
    // line atlas + marker-fill atlas + curtain = 3 (no area, no marker border).
    expect(data.sources.length).toBeLessThanOrEqual(4);
  });

  it("atlases are FULL-CANVAS silhouettes (bounds === W×H), not tight per-piece bboxes", () => {
    const W = 1280, H = 720;
    const data = buildLineSeriesSources(model(), [style({ area: { show: true, opacity: 0.12 } })], anim(false), opaque)!;
    const atlases = data.sources.filter(isAtlas);
    expect(atlases.length).toBeGreaterThan(0);
    for (const s of atlases) {
      const b = (s as any).mask.bounds;
      expect(b.width).toBe(W);
      expect(b.height).toBe(H);
    }
  });

  it("transparent (mode:none): NO curtain; atlases group-fade via overlay.alpha (accepted cost)", () => {
    const data = buildLineSeriesSources(model(), [style()], anim(false), { plotBg: { mode: "none" as const, color: "#ffffff" as MosaicColor } })!;
    expect(data.sources.some(isCurtain)).toBe(false);
    const atlases = data.sources.filter(isAtlas);
    expect(atlases.length).toBeGreaterThan(0);
    expect(atlases.every(hasAlpha)).toBe(true);
  });

  it("reduceMotion: static atlases only — no curtain, no alpha, no enable", () => {
    const data = buildLineSeriesSources(model(), [style()], anim(true), opaque)!;
    expect(data.sources.some(isCurtain)).toBe(false);
    expect(data.sources.some(hasAlpha)).toBe(false);
    expect(data.sources.some(hasEnable)).toBe(false);
  });

  it("value labels: one text source per point, popped via overlay.enable (never animated alpha)", () => {
    const m = model();
    const vl = { valueLabels: { show: true, format: "compact" as const, decimals: 0, fontSize: 13 } };
    const withLabels = buildLineSeriesSources(m, [style()], anim(false), { ...opaque, ...vl })!;
    const texts = withLabels.sources.filter((s: any) => s.type === "text");
    expect(texts.length).toBe(m.points[0].length); // one per point
    expect(texts.every(hasEnable)).toBe(true); //     enable-gated pop
    expect(texts.some(hasAlpha)).toBe(false); //      never animated alpha
    // reduceMotion ⇒ labels static (no overlay at all).
    const reduced = buildLineSeriesSources(m, [style()], anim(true), { ...opaque, ...vl })!;
    expect(reduced.sources.filter((s: any) => s.type === "text").every((s: any) => s.overlay == null)).toBe(true);
  });

  it("curtain columns: reveal time is monotonic in x and within the box budget", () => {
    const f = computeFrame(1280, 720, DEFAULT_PADDING);
    const cols = buildCurtainColumns(f.plot, anim(false), { padPx: 6 });
    expect(cols.length).toBeGreaterThan(0);
    expect(cols.length).toBeLessThanOrEqual(120); // K clamp, under GATED_BOX_BUDGET (500)
    for (let i = 1; i < cols.length; i++) expect(cols[i].revealAtSec).toBeGreaterThanOrEqual(cols[i - 1].revealAtSec);
    expect(cols[0].revealAtSec).toBeGreaterThan(0); // hidden from t=0, opens after the intro delay
  });

  it("composed doc is valid real-geometry m0 (card → chrome → data); NO data tile carries animated alpha", async () => {
    const doc = (await ChartsLineChart.render({ values: SHOWCASE, labels: MONTHS, line: { area: { show: true, opacity: 0.12 } } } as never, makeCtx())) as MosaicDocument;
    expect(isValidM0String(String(doc.m0))).toBe(true);
    expect(String(doc.m0).startsWith("1{1{")).toBe(true);
    // Data tiles = masked atlases + the curtain; none may carry an ANIMATED
    // (time-varying) alpha — only the chrome group-fade, a mosaic-ref, is
    // allowed one. A CONSTANT alpha is fine: the area's opacity rides
    // overlay.alpha as a scalar (an @alpha color is discarded by the
    // inline-mask's coverage), which costs no per-frame expr.
    const dataTiles = (doc.sources ?? []).filter((s: any) => isAtlas(s) || isCurtain(s));
    expect(dataTiles.length).toBeGreaterThan(0);
    expect(dataTiles.every((s: any) => !/\bt\b/.test(String(s.overlay?.alpha ?? "")))).toBe(true);
    // The area atlas carries its opacity as that constant alpha.
    const withConstAlpha = dataTiles.filter((s: any) => s.overlay?.alpha != null);
    expect(withConstAlpha.length).toBe(1);
    expect(String((withConstAlpha[0] as any).overlay.alpha)).toBe("0.12");
  });

  it("DEFAULT render carries the shaded underside (founder 2026-09-16): area atlas at constant alpha 0.22 — Alpine's weight; opt-out drops it", async () => {
    const defaults = ChartsLineChart.defaultProps as any;
    expect(defaults.line.area).toEqual({ show: true, opacity: 0.22 });
    const doc = (await ChartsLineChart.render({ ...defaults } as never, makeCtx())) as MosaicDocument;
    const areaTiles = (doc.sources ?? []).filter((s: any) => isAtlas(s) && s.overlay?.alpha != null);
    expect(areaTiles.length).toBe(1);
    expect(String((areaTiles[0] as any).overlay.alpha)).toBe("0.22");
    const bare = (await ChartsLineChart.render({ ...defaults, line: { ...defaults.line, area: { show: false } } } as never, makeCtx())) as MosaicDocument;
    expect((bare.sources ?? []).filter((s: any) => isAtlas(s) && s.overlay?.alpha != null).length).toBe(0);
  });
});

describe("Line Chart — theming (resolveThemeTokens consumer)", () => {
  const PROD = {
    surfaceApp: "#101820", surface: "#182430", surfaceRaised: "#202c3a", surfaceInset: "#0a0f14",
    border: "#334455", borderStrong: "#556677",
    textPrimary: "#ffffff", textSecondary: "#c0c0c0", textMuted: "#8899aa", eyebrow: "#c0c0c0",
    accent: "#ff8800", accentSoft: "#ffaa33", accentGlow: "#ff8800",
    positive: "#00cc66", negative: "#ff3355",
    grid: "#ff00ff", gridAlpha: 1, axis: "#00ffcc", axisAlpha: 1, radius: 0.04,
    dataPalette: ["#ff8800", "#00cc66", "#cc00ff", "#ffcc00", "#00ccff", "#ff0066"],
  };
  const withUpstream = (tokens: unknown) => {
    const c = makeCtx() as any;
    c.upstreamData = { theme: tokens };
    return c as MosaicEngineContext;
  };

  it("determinism: two unthemed renders are byte-for-byte deep-equal", async () => {
    const a = await ChartsLineChart.render({ values: SHOWCASE, labels: MONTHS } as never, makeCtx());
    const b = await ChartsLineChart.render({ values: SHOWCASE, labels: MONTHS } as never, makeCtx());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("byte-identity: unthemed renders in the preset's colors (theme wiring changes nothing)", async () => {
    const doc = (await ChartsLineChart.render({ values: SHOWCASE, labels: MONTHS } as never, makeCtx())) as MosaicDocument;
    const paint = JSON.stringify(doc.sources) + JSON.stringify(doc.children ?? {});
    expect(doc.backgroundColor).toBe(PRESET_TOKENS.neutral.bg); // canvas = preset bg
    expect(paint.includes(PRESET_TOKENS.neutral.line)).toBe(true); // series 0 = preset line
    expect(paint.includes(PRESET_TOKENS.neutral.grid)).toBe(true); // gridlines = preset grid
  });

  it("producer override: ctx.upstreamData.theme flips surface / accent / grid / dataPalette", async () => {
    const doc = (await ChartsLineChart.render(
      { values: [[1, 2, 3, 4, 5, 6], [2, 3, 4, 5, 6, 7]], labels: MONTHS, seriesLabels: ["A", "B"] } as never,
      withUpstream(PROD),
    )) as MosaicDocument;
    const src = JSON.stringify(doc.sources);
    const chrome = JSON.stringify(doc.children ?? {});
    expect(doc.backgroundColor).toBe(PROD.surfaceApp); // canvas ← surfaceApp
    expect(src.includes(PROD.accent)).toBe(true); //      series 0 ← accent
    expect(src.includes(PROD.dataPalette[1])).toBe(true); // series 1 ← dataPalette[1]
    expect(chrome.includes(PROD.grid)).toBe(true); //     gridlines ← grid
  });

  it("explicit props still win over the producer theme", async () => {
    const doc = (await ChartsLineChart.render(
      { values: SHOWCASE, labels: MONTHS, line: { lineColor: "#123abc" }, appearance: { backgroundColor: "#fedcba" } } as never,
      withUpstream(PROD),
    )) as MosaicDocument;
    const src = JSON.stringify(doc.sources);
    expect(src.includes("#123abc")).toBe(true); // explicit line color beats accent
    expect(doc.backgroundColor).toBe("#fedcba"); // explicit solid bg beats surfaceApp
  });
});

describe("ChartsLineChart — first-open cover (mosaic-branding theme)", () => {
  const coverCtx = {
    mode: "render" as const,
    target: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    output: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    media: {},
  } as unknown as MosaicEngineContext;

  it("branded pane + the template's own default render INLINED as hero", async () => {
    expect(typeof ChartsLineChart.renderCover).toBe("function");
    const doc = (await ChartsLineChart.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    const s = JSON.stringify(doc.sources);
    expect(s).toContain("Line Chart");
    // Band variant: no conversation pane, just brand + title.
    expect(s).not.toContain("START HERE");
    expect(s).not.toContain('"type":"mosaic","ref":"cover');
  });

  it("cover is deterministic", async () => {
    const a = (await ChartsLineChart.renderCover!({} as never, coverCtx)) as MosaicDocument;
    const b = (await ChartsLineChart.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(a.m0).toBe(b.m0);
  });
});

describe("ChartsLineChart — prop bindings (Make inline edit)", () => {
  const schema = ChartsLineChart.propsSchema;
  type Binding = ReturnType<typeof resolvePropBindings>["byProp"][string][number];
  const bindingsOf = async (props: Record<string, unknown>, w = 1280, h = 720) => {
    const doc = (await ChartsLineChart.render(props as never, makeCtx(w, h))) as MosaicDocument;
    return { doc, ...resolvePropBindings(doc, w, h, { propsSchema: schema }) };
  };
  const childrenOf = (doc: MosaicDocument): Record<string, MosaicDocument> => (doc as { children?: Record<string, MosaicDocument> }).children ?? {};
  // The rect's `editor.label`, walking the binding's childPath to the owning doc.
  const labelOf = (doc: MosaicDocument, b: Binding): string | undefined => {
    const owner = b.childPath.reduce((d, k) => childrenOf(d)[k], doc);
    return ((owner.sources ?? [])[b.sourceIndex] as { editor?: { label?: string } }).editor?.label;
  };
  const expectAll = (doc: MosaicDocument, bs: Binding[], label: string) => {
    for (const b of bs) {
      expect(b.childPath).toEqual(["chrome"]);
      expect(labelOf(doc, b)).toBe(label);
    }
  };
  const TWO = { values: [[1, 2, 3, 4, 5, 6], [2, 3, 4, 5, 6, 7]], labels: MONTHS, seriesLabels: ["Renders", "Users"], titles: { title: "Growth", subtitle: "Monthly" } };

  it("titles.title / titles.subtitle / labels[i] / seriesLabels[i] all resolve inside the `chrome` child", async () => {
    const r = await bindingsOf(TWO);
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["labels", "seriesLabels", "titles.subtitle", "titles.title"]);
    // Header: title and subtitle are SEPARATE single-layer rects in the chrome
    // (not one two-layer source), so each binds its own prop.
    expect(r.byProp["titles.title"]).toHaveLength(1);
    expect("index" in r.byProp["titles.title"][0]).toBe(false);
    expectAll(r.doc, r.byProp["titles.title"], "chart-title");
    expect(r.byProp["titles.subtitle"]).toHaveLength(1);
    expectAll(r.doc, r.byProp["titles.subtitle"], "chart-subtitle");
    // X category labels: one rect per label, index-aligned 0..5.
    expect(r.byProp.labels.map((b) => b.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expectAll(r.doc, r.byProp.labels, "x-label");
    // Legend entries: index-aligned to the series.
    expect(r.byProp.seriesLabels.map((b) => b.index)).toEqual([0, 1]);
    expectAll(r.doc, r.byProp.seriesLabels, "legend-label");
    // Nothing else binds: no root-doc source (canvas / card / chrome-ref / data
    // atlases; value labels are hidden by default — see the `values` cases
    // below), no y tick, no swatch, no axis line.
    const chrome = childrenOf(r.doc).chrome;
    const bound = (chrome.sources ?? []).filter((s) => (s as { editor?: { binding?: unknown } }).editor?.binding);
    expect(bound).toHaveLength(1 + 1 + 6 + 2);
    expect(bound.every((s) => (s as { type?: string }).type === "text")).toBe(true);
    expect(bound.some((s) => (s as { editor?: { label?: string } }).editor?.label === "y-tick")).toBe(false);
    expect((r.doc.sources ?? []).some((s) => (s as { editor?: { binding?: unknown } }).editor?.binding)).toBe(false);
  });

  it("bottom legend: seriesLabels[i] still bind (the footer row lives in the chrome child too)", async () => {
    const r = await bindingsOf({ ...TWO, legend: { position: "bottom" } });
    expect(r.rejected).toEqual([]);
    expect(r.byProp.seriesLabels.map((b) => b.index)).toEqual([0, 1]);
    expectAll(r.doc, r.byProp.seriesLabels, "legend-label");
  });

  it("header rects exist only when given: no titles → no title bindings; subtitle-only → titles.subtitle only", async () => {
    const none = await bindingsOf({ values: SHOWCASE, labels: MONTHS });
    expect(none.rejected).toEqual([]);
    expect(none.byProp["titles.title"]).toBeUndefined();
    expect(none.byProp["titles.subtitle"]).toBeUndefined();
    const sub = await bindingsOf({ values: SHOWCASE, labels: MONTHS, titles: { subtitle: "S" } });
    expect(sub.rejected).toEqual([]);
    expect(sub.byProp["titles.title"]).toBeUndefined();
    expect(sub.byProp["titles.subtitle"]).toHaveLength(1);
    expectAll(sub.doc, sub.byProp["titles.subtitle"], "chart-subtitle");
  });

  it("derived fallbacks stay bound as ADD handles: no labels/seriesLabels → the 1..k and 'Series 1' rects bind index i", async () => {
    const r = await bindingsOf({ values: [3, 1, 2] }, 800, 600);
    expect(r.rejected).toEqual([]);
    expect(r.byProp.labels.map((b) => b.index)).toEqual([0, 1, 2]);
    expectAll(r.doc, r.byProp.labels, "x-label");
    expect(r.byProp.seriesLabels.map((b) => b.index)).toEqual([0]);
    expectAll(r.doc, r.byProp.seriesLabels, "legend-label");
  });

  it("autoskip: only SHOWN labels bind (filler cells unbound) — unique ascending indices incl. both edges", async () => {
    const MANY = Array.from({ length: 24 }, (_, i) => `Label ${i + 1}`);
    const r = await bindingsOf({ values: MANY.map((_, i) => i * 3), labels: MANY }, 640, 360);
    expect(r.rejected).toEqual([]);
    const idx = r.byProp.labels.map((b) => b.index!);
    expect(idx.length).toBeGreaterThan(1);
    expect(idx.length).toBeLessThan(MANY.length); // skip > 1 at this width
    expect(idx).toEqual([...new Set(idx)].sort((a, b) => a - b));
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(MANY.length - 1);
    expectAll(r.doc, r.byProp.labels, "x-label");
    // One binding per tagged x-label rect; blank fillers carry neither.
    const chrome = childrenOf(r.doc).chrome;
    const xTagged = (chrome.sources ?? []).filter((s) => (s as { editor?: { label?: string } }).editor?.label === "x-label");
    expect(xTagged).toHaveLength(idx.length);
  });

  // ── values (json: number[] | number[][]) → structured LEAF bindings ────────
  // The per-point value labels are drawn by line-series.ts FLAT in the ROOT doc
  // (above the curtain), one `type:"text"` per finite point, only when
  // `valueLabels.show`. Each binds its raw leaf via `bindPropPath` — `[j]` for
  // a flat series, `[i, j]` for nested — at the ORIGINAL data position.
  const VL = { valueLabels: { show: true, format: "raw" as const, decimals: 0 } };
  const pathsOf = (bs: Binding[]) =>
    bs.map((b) => b.path!).sort((a, b) => Number(a[0]) - Number(b[0]) || Number(a[1] ?? -1) - Number(b[1] ?? -1));
  const textOf = (doc: MosaicDocument, b: Binding): string | undefined =>
    ((doc.sources ?? [])[b.sourceIndex] as { layers?: Array<{ content?: { text?: string } }> }).layers?.[0]?.content?.text;

  it("values[j]: flat number[] → each value-label rect binds ONE raw leaf (kind number) in the ROOT doc", async () => {
    const vals = [3, 1, 2, 5];
    const r = await bindingsOf({ values: vals, labels: ["a", "b", "c", "d"], ...VL }, 800, 600);
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["labels", "seriesLabels", "values"]);
    expect(pathsOf(r.byProp.values)).toEqual(vals.map((_, j) => [j]));
    for (const b of r.byProp.values) {
      expect(b.kind).toBe("number");
      expect(b.childPath).toEqual([]);
      expect("index" in b).toBe(false);
      expect(labelOf(r.doc, b)).toBe("value-label");
      // The rect shows the (raw-formatted) leaf it binds.
      expect(textOf(r.doc, b)).toBe(String(vals[b.path![0] as number]));
    }
    // Only the value labels bind in the root doc — atlases / curtain / card /
    // chrome-ref stay unbound.
    const rootBound = (r.doc.sources ?? []).filter((s) => (s as { editor?: { binding?: unknown } }).editor?.binding);
    expect(rootBound).toHaveLength(vals.length);
    expect(rootBound.every((s) => (s as { type?: string }).type === "text")).toBe(true);
  });

  it("values[i][j]: nested number[][] → [seriesIdx, pointIdx] at ORIGINAL positions; a one-series NESTED set still routes [0, j]", async () => {
    const r = await bindingsOf({ ...TWO, ...VL });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["labels", "seriesLabels", "titles.subtitle", "titles.title", "values"]);
    const want: number[][] = [];
    TWO.values.forEach((s, i) => s.forEach((_, j) => want.push([i, j])));
    expect(pathsOf(r.byProp.values)).toEqual(want);
    for (const b of r.byProp.values) {
      const [i, j] = b.path as [number, number];
      expect(b.kind).toBe("number");
      expect(labelOf(r.doc, b)).toBe("value-label");
      expect(textOf(r.doc, b)).toBe(String(TWO.values[i][j]));
    }
    // `[[…]]` is NESTED even with one series: the path must address the prop
    // VALUE's shape ([0, j]), never the normalized series list ([j]).
    const one = await bindingsOf({ values: [SHOWCASE], labels: MONTHS, ...VL });
    expect(one.rejected).toEqual([]);
    expect(pathsOf(one.byProp.values)).toEqual(SHOWCASE.map((_, j) => [0, j]));
  });

  it("values: hidden labels (default) bind nothing; the data layer binds only when the PARENT opts in; a gap leaves its leaf unbound at ORIGINAL indices", async () => {
    const off = await bindingsOf({ values: SHOWCASE, labels: MONTHS });
    expect(off.rejected).toEqual([]);
    expect(off.byProp.values).toBeUndefined();
    // Opt-in: the parent names the prop (chrome idiom); a bare data layer
    // carries no binding at all.
    const reduced = { intro: { durationSec: 1.1, delaySec: 0.1, staggerSec: 0.12, ease: "smoothstep" as const }, reduceMotion: true };
    const layerOpts = { plotBg: { mode: "preset" as const, color: "#ffffff" as MosaicColor }, valueLabels: { ...VL.valueLabels, fontSize: 12 } };
    const bare = buildLineSeriesSources(model(), [style()], reduced, layerOpts)!;
    expect(bare.sources.some((s) => (s as { editor?: { binding?: unknown } }).editor?.binding)).toBe(false);
    // render() rejects non-finite values up front (error mosaic), so the gap
    // guard only matters for direct callers: a null point draws no label → its
    // leaf is unbound, and the neighbours keep their ORIGINAL indices.
    const gap = buildLineSeriesSources(model([[4, null as unknown as number, 6]], ["a", "b", "c"]), [style()], reduced, {
      ...layerOpts,
      valuesBinding: { propKey: "values", nested: false },
    })!;
    const bound = gap.sources
      .map((s) => (s as { editor?: { binding?: { propKey: string; path?: number[]; kind?: string } } }).editor?.binding)
      .filter((b): b is { propKey: string; path?: number[]; kind?: string } => !!b);
    expect(bound.map((b) => b.path!).sort((a, b) => a[0] - b[0])).toEqual([[0], [2]]);
    expect(bound.every((b) => b.propKey === "values" && b.kind === "number")).toBe(true);
  });
});
