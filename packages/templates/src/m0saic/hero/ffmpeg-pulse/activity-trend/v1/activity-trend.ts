import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/hero/ffmpeg-pulse/activity-trend/v1 — Weekly Pulse · Activity Trend (Beat 2)
 * ============================================================================
 *
 * Commits-over-time beat: the SAME chrome as the KPI Overview beat (BEAT chip
 * floating top-left, FFmpeg logo IN LINE with the title, subtitle, footer, baked
 * scatter, bg-first-then-content timing) — kept identical so the beats read as one
 * set — wrapping a "COMMITS OVER TIME" line chart (nested @m0saic/alpine/line-chart)
 * on the left and a rail of derived stat tiles (Total Commits / Peak Day / Daily Avg
 * / Active Days, nested @m0saic/alpine/stat-card) on the right.
 *
 * Driven by `pulse.activity` (Mon→Sun day commits + peak); the rail figures are
 * derived (sum / peak / avg / active-days). Aspect-adaptive (rail right on desktop,
 * a 2×2 under the chart on square/mobile). Deterministic; reduceMotion → static.
 * ============================================================================
 */

import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicRenderableFile,
  MosaicSource,
  MosaicTemplate,
} from "@m0saic/types";
import {
  definePropsSchema,
  registerTemplate,
  renderNestedTemplate,
  makeErrorMosaic,
  withLayoutContract,
  type LayoutConstraint,
  } from "@m0saic/template-utils";
import { overlay, paint, type Node } from "../../../../alpine/_shared/alpine-card";
import { classify, withFade, insetSafe, backdrop, unionRect, pulseTiming, buildHeader, buildFooter, scatterNode, chromeAssets, labelNode, PULSE_CHROME_CONSTRAINTS, PULSE_CONTENT_CONSTRAINTS, type Rect, type Variant, insetSlot } from "../../_shared/pulse-chrome";
import { pulseTheme, type PulsePreset, type PulseTheme } from "../../_shared/pulse-theme";
import { type WeeklyPulse, MOCK_FFMPEG_PULSE, kpiDelta, periodLabel, monthDay, resolvePulse, WEEKLY_PULSE_UPSTREAM_SCHEMA } from "../../_shared/pulse-data";
import { KPI_GLYPHS } from "../../_shared/pulse-glyphs";

type AnimConfig = { introFrac: number; reduceMotion: boolean };
type ActivityTrendProps = { pulse: WeeklyPulse; eyebrow?: string; headline?: string; subtitle?: string; preset?: PulsePreset; renderMode?: "premium" | "light"; anim?: AnimConfig; animate?: boolean; debugLayout?: boolean };

const DEFAULT_PRESET: PulsePreset = "dark";
const DEFAULT_ANIM: AnimConfig = { introFrac: 0.7, reduceMotion: false };

// Header geometry is IDENTICAL to the KPI Overview beat (cross-beat consistency);
// each beat adds its own content region. `chart` = line-chart panel; `rail` = the
// derived-stat grid (1×4 column desktop, 2×2 square/mobile).
type Grid = { x0: number; y0: number; cols: number; cw: number; ch: number; gx: number; gy: number };
type VariantGeom = { nativeW: number; nativeH: number; margin: number; beat: Rect; logo: Rect; title: Rect; subtitle: Rect; footer: Rect; chart: Rect; rail: Grid };
const GEOM: Record<Variant, VariantGeom> = {
  desktop: { nativeW: 1920, nativeH: 1080, margin: 140,
    beat: { x: 140, y: 66, w: 128, h: 42 }, logo: { x: 140, y: 138, w: 116, h: 116 }, title: { x: 276, y: 150, w: 680, h: 92 }, subtitle: { x: 142, y: 282, w: 680, h: 34 },
    footer: { x: 140, y: 1006, w: 560, h: 50 }, chart: { x: 140, y: 384, w: 960, h: 600 }, rail: { x0: 1140, y0: 384, cols: 2, cw: 300, ch: 288, gx: 20, gy: 24 } },
  // Square: all three sections (header / chart / KPI rail) share ONE width — a
  // centered ~740px column (margin 170) — with the rail widened so its 2×2 cards
  // stay square-ish. The chart is a compact strip; header + chart + rail align.
  square: { nativeW: 1080, nativeH: 1080, margin: 170,
    beat: { x: 170, y: 40, w: 120, h: 38 }, logo: { x: 170, y: 104, w: 92, h: 92 }, title: { x: 282, y: 110, w: 600, h: 78 }, subtitle: { x: 172, y: 202, w: 720, h: 30 },
    footer: { x: 170, y: 1026, w: 420, h: 34 }, chart: { x: 170, y: 252, w: 740, h: 210 },
    rail: { x0: 170, y0: 482, cols: 2, cw: 360, ch: 258, gx: 20, gy: 16 } },
  mobile: { nativeW: 1080, nativeH: 1920, margin: 80,
    beat: { x: 80, y: 110, w: 150, h: 46 }, logo: { x: 80, y: 196, w: 130, h: 130 }, title: { x: 230, y: 212, w: 700, h: 100 }, subtitle: { x: 82, y: 332, w: 760, h: 38 },
    footer: { x: 80, y: 1800, w: 640, h: 56 }, chart: { x: 80, y: 430, w: 920, h: 560 }, rail: { x0: 80, y0: 1024, cols: 2, cw: 448, ch: 338, gx: 24, gy: 24 } },
};

// ---------------------------------------------------------------------------
// Template
// (chrome helpers — text1/pill/capFont/withFade/insetSafe/backdrop/header/footer/
//  scatter/timing — now live in ../../_shared/pulse-chrome)
// ---------------------------------------------------------------------------

const propsSchema = definePropsSchema<ActivityTrendProps>({
  pulse: { type: "group" as any, required: false, description: "Weekly Pulse data sheet (activity drives the chart + rail).", meta: { ui: { label: "Pulse data", order: 1, consumer: "agent" } } },
  eyebrow: { type: "string", required: false, description: "Beat chip label.", meta: { control: { placeholder: "BEAT 2" }, ui: { label: "Eyebrow", order: 1 } } },
  headline: { type: "string", required: false, description: "Beat title.", meta: { control: { placeholder: "ACTIVITY TREND" }, ui: { label: "Headline", order: 2 } } },
  subtitle: { type: "string", required: false, description: "One-line beat subtitle.", meta: { ui: { label: "Subtitle", order: 3 } } },
  preset: { type: "string", required: false, description: "Pulse theme variant.", meta: { constraints: { oneOf: ["dark"] }, ui: { label: "Preset", order: 10 } } },
  renderMode: { type: "string", required: false, description: "Render weight for this beat's nested charts/cards. \"premium\" (default): alpha-fade reveals — the softer look; the engine's enable-gating makes the per-pixel geq nearly free. \"light\": geq-free enable-gate pops — cheapest, most composable when nested many-deep. Set by the runner.", meta: { constraints: { oneOf: ["light", "premium"] }, ui: { label: "Render mode", order: 11 } } },
  anim: { type: "group" as any, required: false, description: "Intro: introFrac, reduceMotion.", meta: { ui: { label: "Animation", collapsedByDefault: true, consumer: "agent" } } },
  animate: { type: "boolean", required: false, description: "Animate the chart draw-on + content fade.", meta: { ui: { label: "Animate", consumer: "human", order: 1 }, control: { syncsTo: [{ prop: "anim.reduceMotion", map: { kind: "boolInvert" } }] } } },
  debugLayout: { type: "boolean", required: false, description: "Dev-only layout contract: assert the shared chrome (header cluster in the top band, footer in the bottom band) + this beat's chart/rail panels hold their canvas-fraction zones at any resolution/aspect; on violation render a LAYOUT_CONTRACT error mosaic + stamp editor.layoutContract. Default false; production never sets it. Swept by audit:layout-envelope.", meta: { ui: { label: "Debug layout", order: 20, collapsedByDefault: true } } },
});

export const FfmpegPulseActivityTrend: MosaicTemplate<ActivityTrendProps> = {
  id: asTemplateId("@m0saic/hero/ffmpeg-pulse/activity-trend/v1"),
  label: "Weekly Pulse · Activity Trend",
  version: 1,
  description: "FFmpeg Weekly Pulse — Activity Trend beat (Beat 2). The KPI-Overview chrome wrapping a commits-over-time line chart + a rail of derived stat tiles (total / peak / avg / active days). Aspect-adaptive.",
  capabilities: { tier: "core" },
  internal: true,
  tags: ["hero", "ffmpeg-pulse", "activity-trend", "beat"],
  outputHints: { width: 1920, height: 1080, fps: 30, durationMs: 9000 },
  upstreamDataSchema: WEEKLY_PULSE_UPSTREAM_SCHEMA,
  propsSchema,

  defaultProps: {
    debugLayout: false,
    pulse: MOCK_FFMPEG_PULSE,
    eyebrow: "BEAT 2",
    headline: "ACTIVITY TREND",
    subtitle: "Commits over the week.",
    preset: DEFAULT_PRESET,
    renderMode: "premium",
    anim: DEFAULT_ANIM,
  },

  async render(props: ActivityTrendProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));
    const theme: PulseTheme = pulseTheme(props.preset ?? DEFAULT_PRESET);
    const pulse = resolvePulse(props.pulse, ctx);
    const anim: AnimConfig = { ...DEFAULT_ANIM, ...(props.anim ?? {}) };
    const reduceMotion = anim.reduceMotion;
    const renderMode: "premium" | "light" = props.renderMode === "light" ? "light" : "premium";
    const durationMs = ctx.target.durationMs ?? 9000;

    const variant = classify(W, H);
    const gm = GEOM[variant];
    const sx = W / gm.nativeW, sy = H / gm.nativeH;
    const scale = (r: Rect): Rect => ({ x: Math.round(r.x * sx), y: Math.round(r.y * sy), w: Math.round(r.w * sx), h: Math.round(r.h * sy) });

    const days = pulse.activity?.days ?? [];
    if (!days.length) return makeErrorMosaic("activity-trend: pulse has no activity days", { title: `${this.id}`, width: W, height: H });
    const values = days.map((d) => d.commits);
    const dayLabels = days.map((d) => d.label);
    const total = values.reduce((a, b) => a + b, 0);
    const peak = pulse.activity?.peak;
    const avg = Math.round((total / values.length) * 10) / 10;
    const active = values.filter((v) => v > 0).length;
    const commitsKpi = (pulse.kpis ?? []).find((k) => k.key === "commits");

    // Rail tiles (derived from activity).
    const railData: Array<{ label: string; value: string; delta?: string; direction?: "up" | "down" | "flat"; sublabel?: string; iconKey?: string }> = [
      { label: "Total Commits", value: String(total), delta: commitsKpi ? kpiDelta(commitsKpi) : "", direction: commitsKpi?.direction ?? "flat", sublabel: "vs last week", iconKey: "commits" },
      { label: "Peak Day", value: String(peak?.commits ?? ""), sublabel: `${peak?.dayLabel ?? ""} · ${peak ? monthDay(peak.dateISO) : ""}`.trim(), iconKey: "stars" },
      { label: "Daily Avg", value: String(avg), sublabel: "commits / day", iconKey: "commits" },
      { label: "Active Days", value: `${active}/${values.length}`, sublabel: "100% of week", iconKey: "contributors" },
    ];

    // ── Rail cells (row-major) ──
    const rg = gm.rail;
    const railCells: Rect[] = railData.map((_, i) => {
      const row = Math.floor(i / rg.cols), col = i % rg.cols;
      return scale({ x: rg.x0 + col * (rg.cw + rg.gx), y: rg.y0 + row * (rg.ch + rg.gy), w: rg.cw, h: rg.ch });
    });
    // Every nested child renders at the CELL its inset will produce (exact fit
    // for an absolutely-laid-out child at any canvas) — nudged so that cell is
    // 5-smooth and hands the child no rough factor (insetSlot, pulse-chrome).
    const railSlots = railCells.map((r) => insetSlot(r, W, H));
    railCells.forEach((_, i) => { railCells[i] = railSlots[i].rect; });
    const chartRSlot = insetSlot(scale(gm.chart), W, H);
    const chartR = chartRSlot.rect;

    // ── Nested panels: the line chart + the rail stat cards ──
    const introMs = reduceMotion ? 0 : Math.max(500, Math.round(durationMs * anim.introFrac));
    const chartChild = await renderNestedTemplate(
      "@m0saic/alpine/line-chart/v1",
      {
        values, labels: dayLabels, title: "COMMITS OVER TIME", subtitle: `${total} commits this week`,
        curve: "smooth", preset: "dark", lineColor: theme.primaryBright,
        area: { show: true, opacity: 0.18 }, points: { show: true }, grid: { show: true, count: 4 },
        anim: { introFrac: anim.introFrac, ease: "smoothstep", reduceMotion },
      } as never,
      ctx,
      { slot: { width: chartRSlot.slot.width, height: chartRSlot.slot.height, durationMs } },
    );
    const railChildren: MosaicRenderableFile[] = await Promise.all(
      railData.map((r, i) =>
        renderNestedTemplate(
          "@m0saic/alpine/stat-card/v1",
          {
            label: r.label, value: r.value, delta: r.delta ?? "", direction: r.direction ?? "flat", sublabel: r.sublabel ?? "",
            accent: theme.primaryBright, iconPath: r.iconKey ? KPI_GLYPHS[r.iconKey] : undefined,
            renderMode, // runner-controlled render weight (light = geq-free; premium = alpha-fade)
            preset: "dark", // hero keeps its dark KPI look (stat-card now light by default)
            backgroundColor: theme.card,
            anim: { countUp: !reduceMotion, fade: false, introMs, reduceMotion },
          } as never,
          ctx,
          { slot: { width: railSlots[i].slot.width, height: railSlots[i].slot.height, durationMs } },
        ),
      ),
    );

    // ── Intro timing + content cascade (shared chrome) ──
    const t = pulseTiming(durationMs, reduceMotion);
    const { bgFinishT, chromeFadeDur, cardStagger, cardsStart, animOn } = t;

    const children: Record<string, MosaicRenderableFile> = { chart: chartChild };
    const chartNode = insetSafe(withFade(paint({ type: "mosaic", ref: "chart" } as unknown as MosaicSource), bgFinishT, chromeFadeDur, animOn), chartR, W, H);
    const railNodes: Node[] = railChildren.map((c, i) => {
      const ref = `rail${i}`;
      children[ref] = c;
      return insetSafe(withFade(paint({ type: "mosaic", ref } as unknown as MosaicSource), cardsStart + i * cardStagger, cardStagger, animOn), railCells[i], W, H);
    });

    // ── Header cluster + footer (shared chrome) ──
    const beatR = scale(gm.beat), logoR = scale(gm.logo), titleR = scale(gm.title), subR = scale(gm.subtitle), footR = scale(gm.footer);
    const footText = `WEEK ${pulse.period?.weekNumber ?? ""} · ${periodLabel(pulse.period)}`.trim();
    const header = buildHeader({ beat: beatR, logo: logoR, title: titleR, subtitle: subR }, theme, { eyebrow: props.eyebrow ?? "BEAT 2", title: props.headline ?? "ACTIVITY TREND", subtitle: props.subtitle ?? "Commits over the week.", bind: { eyebrow: "eyebrow", title: "headline", subtitle: "subtitle" } }, t, W, H);
    const footNode = buildFooter(footR, theme, footText, t, W, H);

    // ── Backdrop panels (aligned left edge), fading with the header ──
    const M = Math.round(gm.margin * sx);
    const pad = Math.round(Math.min(W, H) * 0.018);
    const panelX = Math.max(0, M - pad), panelRight = Math.min(W, W - M + pad);
    const railBbox = unionRect(railCells, 0, W, H);
    // The chart panel gets a DISTINCT (slightly lighter) bg so the plot stands out
    // from the card-colored header/rail panels.
    const CHART_BG: MosaicColor = "#1b2330";
    const headerBg = backdrop(theme.card, { x: panelX, y: Math.max(0, header.bbox.y - pad), w: panelRight - panelX, h: header.bbox.h + 2 * pad }, W, H, bgFinishT, chromeFadeDur, animOn);
    const chartBg = labelNode(backdrop(CHART_BG, { x: chartR.x - pad, y: chartR.y - pad, w: chartR.w + 2 * pad, h: chartR.h + 2 * pad }, W, H, bgFinishT, chromeFadeDur, animOn), "content-panel");
    const railBg = labelNode(backdrop(theme.card, { x: railBbox.x - pad, y: railBbox.y - pad, w: railBbox.w + 2 * pad, h: railBbox.h + 2 * pad }, W, H, bgFinishT, chromeFadeDur, animOn), "rail-panel");
    const footBg = backdrop(theme.card, { x: panelX, y: footR.y - pad, w: footR.w + 2 * pad, h: footR.h + 2 * pad }, W, H, bgFinishT, chromeFadeDur, animOn);

    const root = overlay([scatterNode(), chartBg, railBg, headerBg, footBg, ...header.nodes, footNode, chartNode, ...railNodes]);

    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      assets: { ...chromeAssets(variant) } as any,
      m0: root.m0 as any,
      sources: root.sources,
      children,
      backgroundColor: theme.canvas,
      fps: ctx.target.fps,
      durationMs,
      size: { width: W, height: H },
    } as MosaicDocument;

    // Layout contract (dev tripwire; falsy debug → returns `doc` untouched at zero
    // cost). Shared chrome zones + this beat's chart/rail content panels.
    const constraints: LayoutConstraint[] = [...PULSE_CHROME_CONSTRAINTS, ...PULSE_CONTENT_CONSTRAINTS];
    // flatten:false — the constraints target this beat's OWN top-level chrome +
    // content panels (all in `root.m0`); we must NOT flatten into the nested
    // line-chart/stat-cards, whose grid primitive hits SPLIT_EXCEEDS_AXIS at small
    // canvases (a separate U-C1 quirk) and would collapse the whole check.
    return withLayoutContract(doc, ctx, { templateId: "@m0saic/hero/ffmpeg-pulse/activity-trend/v1", constraints, flatten: false, debug: props.debugLayout === true });
  },
};

registerTemplate(FfmpegPulseActivityTrend);
