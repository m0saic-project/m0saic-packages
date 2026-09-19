import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/hero/ffmpeg-pulse/kpi-overview/v1 — Weekly Pulse · KPI Overview (Beat 1)
 * ============================================================================
 *
 * The metrics-at-a-glance beat: a logo-left header cluster (FFmpeg logo + "BEAT 1"
 * chip + "KPI OVERVIEW" title + subtitle), an aspect-adaptive grid of KPI stat
 * cards (4×2 desktop, 2×4 square/mobile), and a "WEEK N · period" footer — all
 * over the signature baked scatter (shared with the title beat).
 *
 * Each KPI cell is a NESTED @m0saic/alpine/stat-card/v1 (renderNestedTemplate →
 * its own document, referenced as a `{type:"mosaic"}` source) so the parent stays
 * shallow and each card sizes its fonts off its own slot. The grid is driven by
 * `pulse.kpis` (flexible count; the mock ships 8 API-derivable metrics). Geometry
 * is the sandbox-approved candidate-002 layout, authored per aspect and scaled to
 * the render canvas. Deterministic; `anim.reduceMotion` → static.
 * ============================================================================
 */

import type {
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
import { classify, withFade, insetSafe, backdrop, unionRect, pulseTiming, buildHeader, buildFooter, scatterNode, chromeAssets, labelNode, PULSE_CHROME_CONSTRAINTS, type Rect, type Variant, insetSlot } from "../../_shared/pulse-chrome";
import { pulseTheme, type PulsePreset, type PulseTheme } from "../../_shared/pulse-theme";
import { type WeeklyPulse, type PulseKpi, MOCK_FFMPEG_PULSE, kpiValue, kpiDelta, periodLabel, resolvePulse, WEEKLY_PULSE_UPSTREAM_SCHEMA } from "../../_shared/pulse-data";
import { KPI_GLYPHS } from "../../_shared/pulse-glyphs";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type AnimConfig = { introFrac: number; reduceMotion: boolean };

type KpiOverviewProps = {
  pulse: WeeklyPulse;
  eyebrow?: string;
  headline?: string;
  subtitle?: string;
  preset?: PulsePreset;
  renderMode?: "premium" | "light";
  anim?: AnimConfig;
  animate?: boolean;
  debugLayout?: boolean;
};

const DEFAULT_PRESET: PulsePreset = "dark";
const DEFAULT_ANIM: AnimConfig = { introFrac: 0.7, reduceMotion: false };

// Geometry per variant (native size). Header reads: BEAT chip floating top-left,
// then FFmpeg logo IN LINE with the title, subtitle under. All left edges share the
// grid margin (x0) so the header / grid / footer backdrops align. Square uses a 3×3
// (squareish cards, last row centered); desktop 4×2, mobile 2×4.
type VariantGeom = { nativeW: number; nativeH: number; margin: number; beat: Rect; logo: Rect; title: Rect; subtitle: Rect; footer: Rect; grid: { x0: number; y0: number; cols: number; cw: number; ch: number; gx: number; gy: number } };
const GEOM: Record<Variant, VariantGeom> = {
  desktop: { nativeW: 1920, nativeH: 1080, margin: 140,
    beat: { x: 140, y: 66, w: 128, h: 42 }, logo: { x: 140, y: 138, w: 116, h: 116 }, title: { x: 276, y: 150, w: 640, h: 92 }, subtitle: { x: 142, y: 282, w: 640, h: 34 },
    footer: { x: 140, y: 1006, w: 560, h: 50 }, grid: { x0: 140, y0: 380, cols: 4, cw: 386, ch: 266, gx: 32, gy: 32 } },
  square: { nativeW: 1080, nativeH: 1080, margin: 56,
    beat: { x: 56, y: 50, w: 120, h: 40 }, logo: { x: 56, y: 116, w: 100, h: 100 }, title: { x: 172, y: 126, w: 700, h: 82 }, subtitle: { x: 58, y: 224, w: 760, h: 32 },
    footer: { x: 56, y: 1012, w: 460, h: 44 }, grid: { x0: 56, y0: 286, cols: 3, cw: 309, ch: 222, gx: 20, gy: 20 } },
  mobile: { nativeW: 1080, nativeH: 1920, margin: 80,
    beat: { x: 80, y: 110, w: 150, h: 46 }, logo: { x: 80, y: 196, w: 130, h: 130 }, title: { x: 230, y: 212, w: 700, h: 100 }, subtitle: { x: 82, y: 332, w: 760, h: 38 },
    footer: { x: 80, y: 1800, w: 640, h: 56 }, grid: { x0: 80, y0: 430, cols: 2, cw: 446, ch: 300, gx: 28, gy: 28 } },
};

// Chrome helpers (text1/pill/withFade/insetSafe/backdrop/unionRect/header/footer/
// scatter/timing) now live in ../../_shared/pulse-chrome.

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const propsSchema = definePropsSchema<KpiOverviewProps>({
  pulse: { type: "group" as any, required: false, description: "Weekly Pulse data sheet (period + kpis drive the grid).", meta: { ui: { label: "Pulse data", order: 1, consumer: "agent" } } },
  eyebrow: { type: "string", required: false, description: "Beat chip label.", meta: { control: { placeholder: "BEAT 1" }, ui: { label: "Eyebrow", order: 1 } } },
  headline: { type: "string", required: false, description: "Beat title.", meta: { control: { placeholder: "KPI OVERVIEW" }, ui: { label: "Headline", order: 2 } } },
  subtitle: { type: "string", required: false, description: "One-line beat subtitle.", meta: { ui: { label: "Subtitle", order: 3 } } },
  preset: { type: "string", required: false, description: "Pulse theme variant.", meta: { constraints: { oneOf: ["dark"] }, ui: { label: "Preset", order: 10 } } },
  renderMode: { type: "string", required: false, description: "Render weight for this beat's nested charts/cards. \"premium\" (default): alpha-fade reveals — the softer look; the engine's enable-gating makes the per-pixel geq nearly free. \"light\": geq-free enable-gate pops — cheapest, most composable when nested many-deep. Set by the runner.", meta: { constraints: { oneOf: ["light", "premium"] }, ui: { label: "Render mode", order: 11 } } },
  anim: { type: "group" as any, required: false, description: "Intro: introFrac (share of clip), reduceMotion.", meta: { ui: { label: "Animation", collapsedByDefault: true, consumer: "agent" } } },
  animate: { type: "boolean", required: false, description: "Animate the cards counting up + content fading in.", meta: { ui: { label: "Animate", consumer: "human", order: 1 }, control: { syncsTo: [{ prop: "anim.reduceMotion", map: { kind: "boolInvert" } }] } } },
  debugLayout: { type: "boolean", required: false, description: "Dev-only layout contract: assert the shared chrome (header cluster top-band, footer bottom-band) + the KPI grid panel hold their canvas-fraction zones at any resolution/aspect; on violation render a LAYOUT_CONTRACT error mosaic + stamp editor.layoutContract. Default false; production never sets it. Swept by audit:layout-envelope.", meta: { ui: { label: "Debug layout", order: 20, collapsedByDefault: true } } },
});

export const FfmpegPulseKpiOverview: MosaicTemplate<KpiOverviewProps> = {
  id: asTemplateId("@m0saic/hero/ffmpeg-pulse/kpi-overview/v1"),
  label: "Weekly Pulse · KPI Overview",
  version: 1,
  description: "FFmpeg Weekly Pulse — KPI Overview beat. Logo-left header cluster + an aspect-adaptive grid of KPI stat cards (4×2 desktop, 2×4 square/mobile) + WEEK/period footer, over the signature scatter. Grid driven by pulse.kpis.",
  capabilities: { tier: "core" },
  internal: true,
  tags: ["hero", "ffmpeg-pulse", "kpi-overview", "beat"],
  outputHints: { width: 1920, height: 1080, fps: 30, durationMs: 9000 },
  upstreamDataSchema: WEEKLY_PULSE_UPSTREAM_SCHEMA,
  propsSchema,

  defaultProps: {
    debugLayout: false,
    pulse: MOCK_FFMPEG_PULSE,
    eyebrow: "BEAT 1",
    headline: "KPI OVERVIEW",
    subtitle: "Key metrics at a glance for the week.",
    preset: DEFAULT_PRESET,
    renderMode: "premium",
    anim: DEFAULT_ANIM,
  },

  async render(props: KpiOverviewProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
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

    const gd = gm.grid;
    const kpis: PulseKpi[] = (pulse.kpis ?? []).slice(0, gd.cols * 4); // grid driven by kpi count
    if (!kpis.length) return makeErrorMosaic("kpi-overview: pulse has no kpis", { title: `${this.id}`, width: W, height: H });

    // KPI cells (row-major; a partial last row is centered), scaled to canvas.
    const rowsNeeded = Math.max(1, Math.ceil(kpis.length / gd.cols));
    const fullRowW = gd.cols * gd.cw + (gd.cols - 1) * gd.gx;
    const cells: Rect[] = kpis.map((_, i) => {
      const row = Math.floor(i / gd.cols);
      const inRow = row === rowsNeeded - 1 ? kpis.length - row * gd.cols : gd.cols;
      const col = i % gd.cols;
      const rowX0 = gd.x0 + (inRow < gd.cols ? Math.round((fullRowW - (inRow * gd.cw + (inRow - 1) * gd.gx)) / 2) : 0);
      return scale({ x: rowX0 + col * (gd.cw + gd.gx), y: gd.y0 + row * (gd.ch + gd.gy), w: gd.cw, h: gd.ch });
    });
    // Every card renders at the CELL its inset will produce, nudged 5-smooth
    // (insetSlot, pulse-chrome): exact fit, no inherited rough factor.
    const cellSlots = cells.map((r) => insetSlot(r, W, H));
    cells.forEach((_, i) => { cells[i] = cellSlots[i].rect; });

    // ── Nested KPI stat cards (each its own document; placed by mosaic ref) ──
    // Per-KPI glyph: an Octicon SVG path masked onto the green chip (keyed by
    // kpi.key, from pulse-glyphs); omitted keys fall back to the bare colored chip.
    const introMs = reduceMotion ? 0 : Math.max(500, Math.round(durationMs * anim.introFrac));
    const cards: MosaicRenderableFile[] = await Promise.all(
      kpis.map((k, i) =>
        renderNestedTemplate(
          "@m0saic/alpine/stat-card/v1",
          {
            label: k.label,
            value: kpiValue(k),
            delta: kpiDelta(k),
            direction: k.direction ?? "flat",
            sublabel: k.sublabel ?? "vs last week",
            accent: theme.primaryBright,
            iconPath: KPI_GLYPHS[k.key],
            // Whole-card fade is done at the beat level (below); keep only the count-up internally.
            renderMode, // runner-controlled render weight (light = geq-free; premium = alpha-fade)
            preset: "dark", // hero keeps its dark KPI look (stat-card now light by default)
            backgroundColor: theme.card,
            anim: { countUp: !reduceMotion, fade: false, introMs, reduceMotion },
          } as never,
          ctx,
          { slot: { width: cellSlots[i].slot.width, height: cellSlots[i].slot.height, durationMs } },
        ),
      ),
    );

    // Intro choreography (mirrors the title beat): the BAKED bg reveal plays first
    // (its L→R wipe is pre-rendered into the scatter video, finishing ~22%); THEN the
    // backdrops + header fade in; THEN the KPI cards cascade one-after-another (quick,
    // the next starting as the previous ends → one flow). reduceMotion → all at t=0.
    const t = pulseTiming(durationMs, reduceMotion);
    const { bgFinishT, chromeFadeDur, cardStagger, cardsStart, animOn } = t;

    const children: Record<string, MosaicRenderableFile> = {};
    const cardNodes: Node[] = cards.map((c, i) => {
      const ref = `kpi${i}`;
      children[ref] = c;
      // Staggered fade per card (whole-card alpha on the ref) → a sequential cascade.
      return insetSafe(withFade(paint({ type: "mosaic", ref } as unknown as MosaicSource), cardsStart + i * cardStagger, cardStagger, animOn), cells[i], W, H);
    });

    // ── Header cluster + footer (shared chrome; fade before the cards) ──
    const beatR = scale(gm.beat), logoR = scale(gm.logo), titleR = scale(gm.title), subR = scale(gm.subtitle), footR = scale(gm.footer);
    const footText = `WEEK ${pulse.period?.weekNumber ?? ""} · ${periodLabel(pulse.period)}`.trim();
    const header = buildHeader({ beat: beatR, logo: logoR, title: titleR, subtitle: subR }, theme, { eyebrow: props.eyebrow ?? "BEAT 1", title: props.headline ?? "KPI OVERVIEW", subtitle: props.subtitle ?? "Key metrics at a glance for the week.", bind: { eyebrow: "eyebrow", title: "headline", subtitle: "subtitle" } }, t, W, H);
    const footNode = buildFooter(footR, theme, footText, t, W, H);

    // ── Backdrop panels — all share the LEFT edge (panelX) so header / grid / footer align. ──
    const M = Math.round(gm.margin * sx);
    const pad = Math.round(Math.min(W, H) * 0.018);
    const panelX = Math.max(0, M - pad);
    const panelRight = Math.min(W, W - M + pad);
    const gridTop = Math.min(...cells.map((c) => c.y)), gridBot = Math.max(...cells.map((c) => c.y + c.h));
    const headerBg = backdrop(theme.card, { x: panelX, y: Math.max(0, header.bbox.y - pad), w: panelRight - panelX, h: header.bbox.h + 2 * pad }, W, H, bgFinishT, chromeFadeDur, animOn);
    const gridBg = labelNode(backdrop(theme.card, { x: panelX, y: gridTop - pad, w: panelRight - panelX, h: gridBot - gridTop + 2 * pad }, W, H, bgFinishT, chromeFadeDur, animOn), "grid-panel");
    const footBg = backdrop(theme.card, { x: panelX, y: footR.y - pad, w: footR.w + 2 * pad, h: footR.h + 2 * pad }, W, H, bgFinishT, chromeFadeDur, animOn);

    // Order: scatter → backdrops → chrome → KPI cards (each backdrop sits behind its content).
    const root = overlay([scatterNode(), gridBg, headerBg, footBg, ...header.nodes, footNode, ...cardNodes]);

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

    // Layout contract (dev tripwire; flatten:false → judge only this beat's own
    // top-level chrome + the KPI grid panel, not the nested stat cards).
    const constraints: LayoutConstraint[] = [...PULSE_CHROME_CONSTRAINTS, { label: "grid-panel", within: { yFrac: [0.14, 0.98] } }];
    return withLayoutContract(doc, ctx, { templateId: "@m0saic/hero/ffmpeg-pulse/kpi-overview/v1", constraints, flatten: false, debug: props.debugLayout === true });
  },
};

registerTemplate(FfmpegPulseKpiOverview);
