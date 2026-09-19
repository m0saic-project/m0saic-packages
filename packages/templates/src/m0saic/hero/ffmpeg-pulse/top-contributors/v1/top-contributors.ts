import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/hero/ffmpeg-pulse/top-contributors/v1 — Weekly Pulse · Top Contributors (Beat 3)
 * ============================================================================
 *
 * The SAME chrome as the KPI Overview / Activity Trend beats (BEAT chip floating
 * top-left, FFmpeg logo IN LINE with the title, subtitle, footer, baked scatter,
 * bg-first-then-content timing) wrapping the ranked contributor panel (nested
 * @m0saic/alpine/contributor-table/v1, header suppressed since the chrome supplies
 * the title) on the left + a rail of aggregate stat tiles (nested
 * @m0saic/alpine/stat-card) on the right.
 *
 * Driven by `pulse.contributors` (rows → table, rail → stat tiles). Aspect-adaptive:
 * desktop = table-left + 2×2 rail; square = table-top + 2×2 rail; mobile = the
 * table reflows to its portrait stacked-card layout (tall panel) + a compact rail
 * below. Deterministic; reduceMotion → static.
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
import { type WeeklyPulse, MOCK_FFMPEG_PULSE, kpiDelta, kpiValue, periodLabel, resolvePulse, WEEKLY_PULSE_UPSTREAM_SCHEMA } from "../../_shared/pulse-data";
import { KPI_GLYPHS } from "../../_shared/pulse-glyphs";

type AnimConfig = { introFrac: number; reduceMotion: boolean };
type TopContributorsProps = { pulse: WeeklyPulse; eyebrow?: string; headline?: string; subtitle?: string; preset?: PulsePreset; renderMode?: "premium" | "light"; anim?: AnimConfig; animate?: boolean; debugLayout?: boolean };

const DEFAULT_PRESET: PulsePreset = "dark";
const DEFAULT_ANIM: AnimConfig = { introFrac: 0.7, reduceMotion: false };
const NEG: MosaicColor = "#f85149";

// Header geometry IDENTICAL to the other beats (cross-beat consistency). `table` =
// the contributor panel; `rail` = the aggregate-stat grid. The table panel is sized
// LANDSCAPE on desktop/square (multi-column table) and PORTRAIT on mobile (so the
// table reflows to its stacked-card layout).
type Grid = { x0: number; y0: number; cols: number; cw: number; ch: number; gx: number; gy: number };
type VariantGeom = { nativeW: number; nativeH: number; margin: number; beat: Rect; logo: Rect; title: Rect; subtitle: Rect; footer: Rect; table: Rect; rail: Grid };
const GEOM: Record<Variant, VariantGeom> = {
  // Desktop: table-left + a 2×2 rail-right (square-ish cards → bigger KPI text than a
  // 1×N strip, where the stat-card font is height-bound).
  desktop: { nativeW: 1920, nativeH: 1080, margin: 140,
    beat: { x: 140, y: 66, w: 128, h: 42 }, logo: { x: 140, y: 138, w: 116, h: 116 }, title: { x: 276, y: 150, w: 980, h: 92 }, subtitle: { x: 142, y: 282, w: 760, h: 34 },
    footer: { x: 140, y: 1006, w: 560, h: 50 }, table: { x: 140, y: 384, w: 980, h: 600 }, rail: { x0: 1160, y0: 384, cols: 2, cw: 290, ch: 288, gx: 20, gy: 24 } },
  // Square: table-top + a 2×2 rail below; the table is trimmed so the rail cards are
  // taller (bigger KPI text).
  square: { nativeW: 1080, nativeH: 1080, margin: 170,
    beat: { x: 170, y: 40, w: 120, h: 38 }, logo: { x: 170, y: 104, w: 92, h: 92 }, title: { x: 282, y: 118, w: 628, h: 66 }, subtitle: { x: 172, y: 202, w: 720, h: 30 },
    footer: { x: 170, y: 1026, w: 420, h: 34 }, table: { x: 170, y: 252, w: 740, h: 366 },
    rail: { x0: 170, y0: 638, cols: 2, cw: 360, ch: 184, gx: 20, gy: 16 } },
  // Mobile: the table panel stays PORTRAIT (taller than wide) so it reflows to the
  // stacked-card layout; the aggregate rail is a 4×1 row of TALL cards (bigger text
  // than a 2×2 of wide-short cards).
  mobile: { nativeW: 1080, nativeH: 1920, margin: 80,
    beat: { x: 80, y: 110, w: 150, h: 46 }, logo: { x: 80, y: 196, w: 130, h: 130 }, title: { x: 230, y: 224, w: 760, h: 80 }, subtitle: { x: 82, y: 332, w: 760, h: 38 },
    footer: { x: 80, y: 1800, w: 640, h: 56 }, table: { x: 80, y: 430, w: 920, h: 1062 },
    rail: { x0: 80, y0: 1516, cols: 4, cw: 218, ch: 270, gx: 16, gy: 0 } },
};

// rail KPI key → glyph key.
const RAIL_GLYPH: Record<string, string> = { totalCommits: "commits", commits: "commits", contributors: "contributors", additions: "additions", deletions: "deletions", stars: "stars" };

const propsSchema = definePropsSchema<TopContributorsProps>({
  pulse: { type: "group" as any, required: false, description: "Weekly Pulse data sheet (contributors drives the table + rail).", meta: { ui: { label: "Pulse data", order: 1, consumer: "agent" } } },
  eyebrow: { type: "string", required: false, description: "Beat chip label.", meta: { control: { placeholder: "BEAT 3" }, ui: { label: "Eyebrow", order: 1 } } },
  headline: { type: "string", required: false, description: "Beat title.", meta: { control: { placeholder: "TOP CONTRIBUTORS" }, ui: { label: "Headline", order: 2 } } },
  subtitle: { type: "string", required: false, description: "One-line beat subtitle.", meta: { ui: { label: "Subtitle", order: 3 } } },
  preset: { type: "string", required: false, description: "Pulse theme variant.", meta: { constraints: { oneOf: ["dark"] }, ui: { label: "Preset", order: 10 } } },
  renderMode: { type: "string", required: false, description: "Render weight for this beat's nested charts/cards. \"premium\" (default): alpha-fade reveals — the softer look; the engine's enable-gating makes the per-pixel geq nearly free. \"light\": geq-free enable-gate pops — cheapest, most composable when nested many-deep. Set by the runner.", meta: { constraints: { oneOf: ["light", "premium"] }, ui: { label: "Render mode", order: 11 } } },
  anim: { type: "group" as any, required: false, description: "Intro: introFrac, reduceMotion.", meta: { ui: { label: "Animation", collapsedByDefault: true, consumer: "agent" } } },
  animate: { type: "boolean", required: false, description: "Animate the table + rail intro.", meta: { ui: { label: "Animate", consumer: "human", order: 1 }, control: { syncsTo: [{ prop: "anim.reduceMotion", map: { kind: "boolInvert" } }] } } },
  debugLayout: { type: "boolean", required: false, description: "Dev-only layout contract: assert the shared chrome (header cluster top-band, footer bottom-band) + this beat's content/rail panels hold their canvas-fraction zones at any resolution/aspect; on violation render a LAYOUT_CONTRACT error mosaic + stamp editor.layoutContract. Default false; production never sets it. Swept by audit:layout-envelope.", meta: { ui: { label: "Debug layout", order: 20, collapsedByDefault: true } } },
});

export const FfmpegPulseTopContributors: MosaicTemplate<TopContributorsProps> = {
  id: asTemplateId("@m0saic/hero/ffmpeg-pulse/top-contributors/v1"),
  label: "Weekly Pulse · Top Contributors",
  version: 1,
  description: "FFmpeg Weekly Pulse — Top Contributors beat (Beat 3). The shared beat chrome wrapping a ranked contributor table (commits/additions/deletions, green/red diff) + a rail of aggregate stat tiles. Aspect-adaptive (table reflows to stacked cards on mobile).",
  capabilities: { tier: "core" },
  internal: true,
  tags: ["hero", "ffmpeg-pulse", "top-contributors", "beat"],
  outputHints: { width: 1920, height: 1080, fps: 30, durationMs: 9000 },
  upstreamDataSchema: WEEKLY_PULSE_UPSTREAM_SCHEMA,
  propsSchema,

  defaultProps: {
    debugLayout: false,
    pulse: MOCK_FFMPEG_PULSE,
    eyebrow: "BEAT 3",
    headline: "TOP CONTRIBUTORS",
    subtitle: "Who shipped the most this week.",
    preset: DEFAULT_PRESET,
    renderMode: "premium",
    anim: DEFAULT_ANIM,
  },

  async render(props: TopContributorsProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
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

    const cRows = pulse.contributors?.rows ?? [];
    if (!cRows.length) return makeErrorMosaic("top-contributors: pulse has no contributors", { title: `${this.id}`, width: W, height: H });

    // Table rows: rank · name · [commits, additions, deletions].
    const tableRows = cRows.map((r) => ({ rank: r.rank, name: r.name, values: [r.commits, r.additions, r.deletions] }));

    // Rail tiles (aggregate KPIs, first 4 of pulse.contributors.rail).
    const railData = (pulse.contributors?.rail ?? []).slice(0, 4).map((k) => ({
      label: k.label, value: kpiValue(k), delta: kpiDelta(k), direction: k.direction ?? "flat", sublabel: k.sublabel ?? "vs last week", iconKey: RAIL_GLYPH[k.key] ?? "commits",
    }));

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
    const tableRSlot = insetSlot(scale(gm.table), W, H);
    const tableR = tableRSlot.rect;

    // ── Nested panels: the contributor table + the rail stat cards ──
    const introMs = reduceMotion ? 0 : Math.max(500, Math.round(durationMs * anim.introFrac));
    const tableChild = await renderNestedTemplate(
      "@m0saic/alpine/contributor-table/v1",
      {
        rows: tableRows, columns: ["Commits", "Additions", "Deletions"],
        columnColors: [undefined, theme.primaryBright, NEG], columnSigns: ["", "+", "-"],
        preset: "dark", // alpine-light by default; the hero keeps its dark look
        showHeader: false, // the beat chrome supplies the title
        backgroundColor: "black@0", // transparent — the beat draws the table backdrop (panel alignment)
        washColor: theme.card, // bands blend against the chrome card color (cohesive)
        accent: theme.primaryBright, topTint: 3,
        anim: { introFrac: anim.introFrac, countUp: !reduceMotion, easing: "easeOut", reduceMotion, renderMode }, // runner-controlled render weight (light = geq-free row cascade; premium = alpha fade)
      } as never,
      ctx,
      { slot: { width: tableRSlot.slot.width, height: tableRSlot.slot.height, durationMs } },
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

    const children: Record<string, MosaicRenderableFile> = { table: tableChild };
    const tableNode = insetSafe(withFade(paint({ type: "mosaic", ref: "table" } as unknown as MosaicSource), bgFinishT, chromeFadeDur, animOn), tableR, W, H);
    const railNodes: Node[] = railChildren.map((c, i) => {
      const ref = `rail${i}`;
      children[ref] = c;
      return insetSafe(withFade(paint({ type: "mosaic", ref } as unknown as MosaicSource), cardsStart + i * cardStagger, cardStagger, animOn), railCells[i], W, H);
    });

    // ── Header cluster + footer (shared chrome) ──
    const beatR = scale(gm.beat), logoR = scale(gm.logo), titleR = scale(gm.title), subR = scale(gm.subtitle), footR = scale(gm.footer);
    const footText = `WEEK ${pulse.period?.weekNumber ?? ""} · ${periodLabel(pulse.period)}`.trim();
    const header = buildHeader({ beat: beatR, logo: logoR, title: titleR, subtitle: subR }, theme, { eyebrow: props.eyebrow ?? "BEAT 3", title: props.headline ?? "TOP CONTRIBUTORS", subtitle: props.subtitle ?? "Who shipped the most this week.", bind: { eyebrow: "eyebrow", title: "headline", subtitle: "subtitle" } }, t, W, H);
    const footNode = buildFooter(footR, theme, footText, t, W, H);

    // ── Backdrop panels — ALL beat-drawn with the same ±pad inset so the table,
    //    rail, header + footer panels share aligned edges (the table is transparent). ──
    const M = Math.round(gm.margin * sx);
    const pad = Math.round(Math.min(W, H) * 0.018);
    const panelX = Math.max(0, M - pad), panelRight = Math.min(W, W - M + pad);
    const railBbox = unionRect(railCells, 0, W, H);
    const tableBg = labelNode(backdrop(theme.card, { x: tableR.x - pad, y: tableR.y - pad, w: tableR.w + 2 * pad, h: tableR.h + 2 * pad }, W, H, bgFinishT, chromeFadeDur, animOn), "content-panel");
    const headerBg = backdrop(theme.card, { x: panelX, y: Math.max(0, header.bbox.y - pad), w: panelRight - panelX, h: header.bbox.h + 2 * pad }, W, H, bgFinishT, chromeFadeDur, animOn);
    const railBg = labelNode(backdrop(theme.card, { x: railBbox.x - pad, y: railBbox.y - pad, w: railBbox.w + 2 * pad, h: railBbox.h + 2 * pad }, W, H, bgFinishT, chromeFadeDur, animOn), "rail-panel");
    const footBg = backdrop(theme.card, { x: panelX, y: footR.y - pad, w: footR.w + 2 * pad, h: footR.h + 2 * pad }, W, H, bgFinishT, chromeFadeDur, animOn);

    const root = overlay([scatterNode(), tableBg, railBg, headerBg, footBg, ...header.nodes, footNode, tableNode, ...railNodes]);

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
    // top-level chrome + content/rail panels, not the nested table/cards).
    const constraints: LayoutConstraint[] = [...PULSE_CHROME_CONSTRAINTS, ...PULSE_CONTENT_CONSTRAINTS];
    return withLayoutContract(doc, ctx, { templateId: "@m0saic/hero/ffmpeg-pulse/top-contributors/v1", constraints, flatten: false, debug: props.debugLayout === true });
  },
};

registerTemplate(FfmpegPulseTopContributors);
