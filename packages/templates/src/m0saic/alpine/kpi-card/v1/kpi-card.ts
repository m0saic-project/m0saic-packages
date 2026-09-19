import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/alpine/kpi-card/v1 — Alpine KPI / Stat Card (friendly mobile-marketing)
 * ============================================================================
 *
 * A single hero KPI inside the Alpine white card: a muted metric label, a
 * dominant count-up value, a soft DELTA PILL (triangle arrow + signed change,
 * green-up / red-down on a tinted rounded badge), a muted sublabel, and an
 * optional bottom SPARKLINE (soft area + line — reuses the pure path math from
 * charts/line-chart/v1/geometry). STANDALONE Alpine brand flavor.
 *
 * Animation: the value counts up (animateNumbersInText), the pill + sublabel
 * cascade-fade, the sparkline fades up. Low, flat tile count (no per-point
 * tiles; the sparkline is 2 masks) so it never stresses the render executor.
 * `anim.reduceMotion` collapses to the static final card.
 *
 * The delta arrow follows the pack rule: a COLOR tile masked by an SVG triangle
 * (crisp, undistorted), never a drawtext ▲/▼ glyph (tofu).
 * ============================================================================
 */

import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicLavfiSource,
  MosaicSource,
  MosaicTextSource,
  MosaicTemplate,
} from "@m0saic/types";
import {
  definePropsSchema,
  registerTemplate,
  makeColorTile,
  makeErrorMosaic,
  animateNumbersInText,
  fadeInExpr,
  type EaseName,
  type ThemeSourceConfig,
} from "@m0saic/template-utils";
import { placeRects } from "@m0saic/dsl-stdlib";

import type { Pt } from "../../../charts/_shared/line";
import {
  curvePolyline,
  polylineStrokePath,
  polylineStrokeBBox,
  areaPolygonPath,
  areaBBox,
  local,
  type BBox,
} from "../../../charts/line-chart/v1/geometry";

import {
  alpineCard,
  paint,
  EMPTY,
  rowSplit,
  colSplit,
  overlay,
  textCell,
  resolveColor,
  type Node,
  type Band,
} from "../../_shared/alpine-card";
import { resolveAlpineTheme, type AlpinePreset } from "../../_shared/alpine-theme";
import { revealGate, ALPINE_ANIM_FIELDS, fBool, fStr, fEnum } from "../../_shared/alpine-anim";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Direction = "up" | "down" | "flat";
/** Reveal cost/quality dial. "premium" (default): soft alpha fades of the pill /
 *  sublabel / sparkline (a per-pixel geq each). "light": the same reveal via free
 *  enable-gate pops (constant-alpha tints kept) — no geq, composable. */
type RenderMode = "premium" | "light";
type AnimConfig = { renderMode: RenderMode; reduceMotion: boolean; introFrac: number; countUp: boolean; easing: EaseName };

type AlpineKpiCardProps = {
  // ── Primary props (flat) ──
  label: string;
  value: string;
  delta?: string;
  sublabel?: string;
  title?: string;
  subtitle?: string;
  direction?: Direction;
  preset?: AlpinePreset;
  valueColor?: MosaicColor;
  /** Optional trend series → a soft sparkline along the card bottom. Omit/empty to hide. */
  sparkline?: number[];
  // ── Grouped props ──
  anim?: AnimConfig;
  /** Opt-in producer theming. The preset is the fallback; a producer's published
   *  tokens override it. Explicit color props still win. */
  theme?: ThemeSourceConfig;
};

const DEFAULT_PRESET: AlpinePreset = "light";
const DEFAULT_RENDER_MODE: RenderMode = "premium";
const DEFAULT_DIRECTION: Direction = "up";
const DEFAULT_ANIM: AnimConfig = { renderMode: DEFAULT_RENDER_MODE, introFrac: 0.7, countUp: true, easing: "easeOut", reduceMotion: false };

const SNAP_PX = 4;
const EDGE_PAD = 1.5;

// Generic illustrative trend that MATCHES the delta direction, used when the
// caller doesn't supply explicit `sparkline` data — so a "down" card never shows
// an up-trend. Deterministic (no randomness). Explicit data always wins.
const ASC_TREND = [10, 14, 12, 18, 16, 23, 21, 28, 26, 34];
function defaultSpark(dir: Direction): number[] {
  if (dir === "down") return ASC_TREND.slice().reverse();
  if (dir === "flat") return [20, 22, 19, 21, 20, 22, 19, 21, 20, 21];
  return ASC_TREND.slice();
}

// Body band proportions (label / value / delta / sparkline), as weights.
const LABEL_W = 13;
const VALUE_W = 34;
const DELTA_W = 14;
const SPARK_W = 30;
const GAP_W = 3;

// ---------------------------------------------------------------------------
// Text + shape helpers
// ---------------------------------------------------------------------------

/** Left-aligned fitted text (image render). */
function leftText(text: string, fontSize: number, color: MosaicColor): MosaicTextSource {
  return {
    type: "text",
    visual: { backgroundColor: "black@0" },
    layers: [{ content: { kind: "literal", text: text || " " }, style: { fontSize, fontColor: color }, placement: { fit: "contain", hAlign: "left", vAlign: "middle" } as any }],
  };
}

/** Left-aligned per-frame expr text (video render) — drives the count-up. */
function leftExprText(expr: string, fontSize: number, color: MosaicColor): MosaicTextSource {
  return {
    type: "text",
    renderMode: { kind: "video" },
    visual: { backgroundColor: "black@0" },
    layers: [{ content: { kind: "expr", expr, eval: "frame" }, style: { fontSize, fontColor: color }, placement: { hAlign: "left", vAlign: "middle" } as any }],
  };
}

/** Centered fitted text (for the pill's delta label). */
function centerText(text: string, fontSize: number, color: MosaicColor): MosaicTextSource {
  return {
    type: "text",
    visual: { backgroundColor: "black@0" },
    layers: [{ content: { kind: "literal", text: text || " " }, style: { fontSize, fontColor: color }, placement: { fit: "contain", hAlign: "center", vAlign: "middle" } as any }],
  };
}

function fadeIn<T extends MosaicSource>(src: T, startSec: number, durSec: number, on: boolean): T {
  if (!on) return src;
  const prev = (src as { overlay?: Record<string, unknown> }).overlay ?? {};
  return { ...src, overlay: { ...prev, alpha: fadeInExpr(startSec, durSec) } } as T;
}

/** Triangle arrow (up/down) as a COLOR tile masked by an SVG triangle — crisp,
 *  undistorted (the pack rule; a drawtext ▲/▼ would tofu). */
function triangleSource(dir: "up" | "down", color: MosaicColor, cellW: number, cellH: number): MosaicLavfiSource {
  const S = Math.min(cellW, cellH) * 0.7;
  const cx = cellW / 2, cy = cellH / 2;
  const half = S / 2, ht = S * 0.866;
  const top = cy - ht / 2, bot = cy + ht / 2;
  const n = (x: number) => Math.round(x * 10) / 10;
  const localPath =
    dir === "up"
      ? `M ${n(cx)} ${n(top)} L ${n(cx + half)} ${n(bot)} L ${n(cx - half)} ${n(bot)} Z`
      : `M ${n(cx - half)} ${n(top)} L ${n(cx + half)} ${n(top)} L ${n(cx)} ${n(bot)} Z`;
  return makeColorTile(color, { mask: { kind: "inline-mask", localPath, bounds: { x: 0, y: 0, width: cellW, height: cellH } } as any });
}

// ---------------------------------------------------------------------------
// Sparkline — soft area + line placed full-canvas (tight inline-mask cells)
// ---------------------------------------------------------------------------

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

type Rect = { x: number; y: number; w: number; h: number; claimant: string; importance?: number };
type Piece = { rect: Rect; source: MosaicSource };

function placePiece(W: number, H: number, bbox: BBox, importance: number, make: (cw: number, ch: number, ox: number, oy: number) => MosaicSource): Piece {
  const sd = (v: number) => Math.floor((v - EDGE_PAD) / SNAP_PX) * SNAP_PX;
  const su = (v: number) => Math.ceil((v + EDGE_PAD) / SNAP_PX) * SNAP_PX;
  const x = clampInt(sd(bbox.minX), 0, W - 1), y = clampInt(sd(bbox.minY), 0, H - 1);
  const x2 = clampInt(su(bbox.maxX), x + SNAP_PX, W), y2 = clampInt(su(bbox.maxY), y + SNAP_PX, H);
  return { rect: { x, y, w: x2 - x, h: y2 - y, claimant: "F", importance }, source: make(x2 - x, y2 - y, x, y) };
}

function maskPiece(W: number, H: number, bbox: BBox, importance: number, color: MosaicColor, localPath: (ox: number, oy: number) => string, overlayObj?: Record<string, unknown>): Piece {
  return placePiece(W, H, bbox, importance, (cw, ch, ox, oy) =>
    makeColorTile(color, { mask: { kind: "inline-mask", localPath: localPath(ox, oy), bounds: { x: 0, y: 0, width: cw, height: ch } } as any, ...(overlayObj ? { overlay: overlayObj } : {}) }));
}

/** Build the sparkline as a full-canvas overlay Node over a px region. */
function sparklineNode(opts: { W: number; H: number; rx: number; ry: number; rw: number; rh: number; values: number[]; color: MosaicColor; introSec: number; animate: boolean; light: boolean }): Node {
  const { W, H, rx, ry, rw, rh, values, color } = opts;
  const v = values.filter((n) => Number.isFinite(n));
  if (v.length < 2) return EMPTY;
  const min = Math.min(...v), max = Math.max(...v), denom = max - min || 1;
  const strokeW = Math.max(2, Math.round(rh * 0.06));
  const padY = strokeW + 2;
  const xAt = (i: number) => rx + (i / (v.length - 1)) * rw;
  const yAt = (val: number) => ry + padY + (1 - (val - min) / denom) * (rh - 2 * padY);
  const pts: Pt[] = v.map((val, i) => ({ x: xAt(i), y: yAt(val) }));
  const baselineY = ry + rh;
  const { poly: raw } = curvePolyline(pts, "smooth");
  const poly = raw.map((p) => ({ x: p.x, y: Math.max(ry, Math.min(baselineY, p.y)) }));
  // premium: fade the area + line in (a geq each). light: static tints (constant
  // area alpha, opaque line) — the reveal starts at t=0 so "static" is its geq-free
  // equivalent. reduceMotion (animate=false): static too.
  const fade = opts.animate && !opts.light;
  const aAlpha = fade ? `(${fadeInExpr(0, Math.max(0.12, opts.introSec * 0.5))})*0.16` : "0.16";
  const lAlpha = fade ? fadeInExpr(0, Math.max(0.12, opts.introSec * 0.5)) : undefined;
  const pieces: Piece[] = [
    maskPiece(W, H, areaBBox(poly, baselineY), 0, color, (ox, oy) => areaPolygonPath(poly.map((p) => local(p, ox, oy)), baselineY - oy), { alpha: aAlpha }),
    maskPiece(W, H, polylineStrokeBBox(poly, strokeW), 1, color, (ox, oy) => polylineStrokePath(poly.map((p) => local(p, ox, oy)), strokeW), lAlpha ? { alpha: lAlpha } : undefined),
  ];
  const placed = placeRects({ rootW: W, rootH: H, rects: pieces.map((p) => p.rect) as any });
  const sources: MosaicSource[] = [];
  for (const layer of (placed as { layers: Array<{ rectIndices: number[] }> }).layers) {
    const ordered = [...layer.rectIndices].sort((a, b) => pieces[a].rect.y - pieces[b].rect.y || pieces[a].rect.x - pieces[b].rect.x);
    for (const idx of ordered) sources.push(pieces[idx].source);
  }
  return { m0: String((placed as { m0: string }).m0), sources };
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const propsSchema = definePropsSchema<AlpineKpiCardProps>({
  // ── Required, then flat props grouped by control type (text → enums → color → list). ──
  label: { type: "string", required: true, description: "Metric label (e.g. \"Monthly Revenue\").", meta: { control: { placeholder: "e.g. Monthly Revenue" }, ui: { label: "Label", order: 1 } } },
  value: { type: "string", required: true, description: "Headline KPI value, pre-formatted (e.g. \"$48.2K\", \"86%\").", meta: { control: { placeholder: "e.g. $48.2K" }, ui: { label: "Value", order: 2 } } },
  delta: { type: "string", required: false, description: "Signed change, pre-formatted (e.g. \"+12.5%\"). Omit for no delta pill.", meta: { control: { placeholder: "e.g. +12.5%" }, ui: { label: "Delta", order: 3 } } },
  sublabel: { type: "string", required: false, description: "Muted caption next to the delta (e.g. \"vs last month\").", meta: { control: { placeholder: "e.g. vs last month" }, ui: { label: "Sublabel", order: 4 } } },
  title: { type: "string", required: false, description: "Optional card title (context above the KPI).", meta: { control: { placeholder: "none" }, ui: { label: "Title", order: 5 } } },
  subtitle: { type: "string", required: false, description: "Optional card subtitle.", meta: { control: { placeholder: "none" }, ui: { label: "Subtitle", order: 6 } } },
  direction: { type: "string", required: false, description: "Delta direction — arrow + color (green up / red down / muted flat).", meta: { constraints: { oneOf: ["up", "down", "flat"] }, ui: { label: "Direction", order: 7 } } },
  preset: { type: "string", required: false, description: "Alpine theme variant.", meta: { constraints: { oneOf: ["light", "dark"] }, ui: { label: "Preset", order: 8 } } },
  valueColor: { type: "string", required: false, description: "Value text color. Defaults to the theme title color.", meta: { constraints: { isColor: true }, control: { placeholder: "theme title color", colorPicker: true, defaultColor: "#0F172A" }, ui: { label: "Value Color", order: 9 } } },
  sparkline: { type: "number[]", required: false, description: "Optional trend series → a soft sparkline along the card bottom.", meta: { control: { flavor: "numberList" }, ui: { label: "Sparkline", order: 10 } } },

  // ── Collapsible groups. ──
  anim: {
    type: "group" as any, required: false, description: "Reveal mode + intro (count-up + soft fades).",
    meta: { ui: { label: "Animation", order: 11, collapsedByDefault: true } },
    fields: {
      renderMode: fEnum("Render mode", ["premium", "light"], "\"premium\" (default): soft alpha fades of the pill / sublabel / sparkline — a per-pixel geq each. \"light\": the same via free enable-gate pops — no geq, composable, cheap when nested."),
      reduceMotion: ALPINE_ANIM_FIELDS.reduceMotion,
      introFrac: ALPINE_ANIM_FIELDS.introFrac,
      countUp: fBool("Count up", "Count the value up on intro."),
      easing: ALPINE_ANIM_FIELDS.easing,
    },
  } as any,
  theme: {
    type: "group" as any, required: false, description: "Opt into a theme source. Uses the alpine preset by default; set a producer slug + namespace to pull shared design tokens. Explicit color props still win.",
    meta: { ui: { label: "Theme", order: 12, collapsedByDefault: true } },
    fields: { slug: fStr("Producer slug", "Producer template to seed tokens from (e.g. \"@m0saic/theming/v1\").", "preset palette (no producer)"), preset: fStr("Preset", "Producer preset/variant (light | dark | high-contrast; producer-defined).", "producer default"), namespace: fStr("Namespace", "Upstream alias to read tokens from. Default \"theme\".", "theme"), forceFetch: fBool("Force fetch", "Re-seed via the slug even if the namespace is populated.") },
  } as any,
});

export const AlpineKpiCard: MosaicTemplate<AlpineKpiCardProps> = {
  id: asTemplateId("@m0saic/alpine/kpi-card/v1"),
  label: "Alpine KPI Card",
  version: 1,
  description: "Alpine KPI / stat card — friendly mobile-marketing card: muted label, count-up value, soft delta pill (arrow + change), sublabel, optional sparkline. Standalone Alpine brand flavor.",
  capabilities: { tier: "core" },
  primitive: true,
  deprecated: {
    reason:
      "The ratio chrome (label/value/delta) was already fine, but the sparkline is placed via placeRects on tight pixel bboxes, so its precision floor tracks the canvas (audit: ABSOLUTE, slope 1.04) — the card pins its parent near its own render canvas when nested. Use v2 — the SAME picture with the sparkline rebuilt as a RATIO band (two inline-masks that fill the band cell in band-local coords, so the connected curve stays exact but precision is bounded). Composes at any canvas.",
    replacement: asTemplateId("@m0saic/alpine/kpi-card/v2"),
    since: "2026-07-09",
  },
  tags: ["alpine", "kpi", "stat-card", "data-viz"],
  outputHints: { width: 1280, height: 800, fps: 30, durationMs: 2000 },
  propsSchema,

  defaultProps: {
    theme: { forceFetch: false },
    label: "MONTHLY REVENUE",
    value: "$48,250",
    delta: "+12.5%",
    direction: "up",
    sublabel: "vs last month",
    preset: DEFAULT_PRESET,
    // sparkline intentionally omitted → auto-generates a trend matching `direction`.
    anim: DEFAULT_ANIM,
  },

  async render(props: AlpineKpiCardProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));

    if (!props.value || !String(props.value).trim()) {
      return makeErrorMosaic("value is required", { title: `${this.id} props`, width: W, height: H });
    }

    // Theming: the shared alpine theme (light default). A producer overrides tokens
    // via props.theme; explicit color props still win. Unthemed → byte-identical.
    const theme = await resolveAlpineTheme(props.preset ?? DEFAULT_PRESET, ctx, props.theme);
    const anim: AnimConfig = { ...DEFAULT_ANIM, ...(props.anim ?? {}) };
    const light = (anim.renderMode ?? DEFAULT_RENDER_MODE) === "light";
    const direction: Direction = props.direction ?? DEFAULT_DIRECTION;
    // Treat an empty / "none" / whitespace color field as "use the default" — a
    // bare `?? theme.title` keeps `""` (not nullish), which renders the value in
    // no color (invisible). Clearing the picker must fall back, not blank the value.
    const valueColor = resolveColor(props.valueColor, theme.title);
    const deltaColor = direction === "up" ? theme.positive : direction === "down" ? theme.negative : theme.subtitle;
    const hasDelta = !!(props.delta && props.delta.trim());
    const hasArrow = hasDelta && (direction === "up" || direction === "down");
    const hasSub = !!(props.sublabel && props.sublabel.trim());
    // Explicit sparkline data always wins; an explicit empty array hides it; when
    // omitted entirely, auto-generate a generic trend that MATCHES the direction.
    const explicitSpark = props.sparkline !== undefined;
    const spark = (explicitSpark ? (props.sparkline ?? []) : defaultSpark(direction)).filter((n) => Number.isFinite(n));
    const hasSpark = spark.length >= 2;

    const clipSec = Math.max(0.1, (ctx.target.durationMs ?? 2000) / 1000);
    const introSec = Math.max(0.1, Math.min(1, anim.introFrac) * clipSec);
    const animate = !anim.reduceMotion;
    const countUp = anim.countUp && animate && /\d/.test(props.value);

    const card = alpineCard({ theme, W, H, title: props.title, subtitle: props.subtitle });
    const cr = card.contentRect;

    // Fonts off card height.
    const labelFont = Math.max(11, Math.round(H * 0.032));
    const valueFont = Math.max(28, Math.round(H * 0.15));
    const deltaFont = Math.max(12, Math.round(H * 0.034));
    const subFont = Math.max(10, Math.round(H * 0.026));

    // ── Value (count-up or static), left-aligned ──
    const valueSrc = countUp
      ? leftExprText(animateNumbersInText(props.value, { durationSec: introSec, ease: anim.easing }), valueFont, valueColor)
      : leftText(props.value, valueFont, valueColor);

    // ── Delta pill: [arrow?][delta text] on a soft tinted rounded badge ──
    // Each leaf carries its own fade so the pill + sublabel cascade in after the
    // count-up is underway (a clean top-to-bottom reveal).
    const dFadeAt = introSec * 0.5, dFadeDur = Math.max(0.1, introSec * 0.35);
    // Mode-aware reveal: premium = alpha fade (geq); light = enable-gate pop (no
    // geq); reduceMotion = static. Premium is byte-identical to the old `fadeIn`.
    const ff = <T extends MosaicSource>(s: T) => !animate ? s : light ? revealGate(s, dFadeAt) : fadeIn(s, dFadeAt, dFadeDur, true);
    let deltaRow: Node = EMPTY;
    if (hasDelta) {
      const pillH = Math.round(deltaFont * 1.9);
      const arrowW = hasArrow ? Math.round(pillH * 0.8) : 0;
      const arrowGap = hasArrow ? Math.round(deltaFont * 0.3) : 0;
      const textW = Math.round(deltaFont * 0.62 * props.delta!.length + deltaFont);
      const padX = Math.round(deltaFont * 0.6);
      const arrowCell: Band[] = hasArrow
        ? [{ weight: arrowW, node: paint(ff(triangleSource(direction as "up" | "down", deltaColor, arrowW, pillH))) }, { weight: arrowGap, node: EMPTY }]
        : [];
      const pillInner = colSplit([
        { weight: padX, node: EMPTY },
        ...arrowCell,
        { weight: textW, node: paint(ff(centerText(props.delta!, deltaFont, deltaColor))) },
        { weight: padX, node: EMPTY },
      ]);
      // Soft tinted badge: the 0.14 tint rides on overlay.alpha (makeColorTile ignores
      // `visual`). premium multiplies it into the fade (geq); light keeps the tint
      // constant + enable-gates the pop (no geq); reduceMotion = the constant tint.
      const pillOverlay: Record<string, unknown> = animate
        ? (light ? { alpha: "0.14", enable: `gte(t,${dFadeAt.toFixed(3)})` } : { alpha: `(${fadeInExpr(dFadeAt, dFadeDur)})*0.14` })
        : { alpha: "0.14" };
      const pillBg = paint(makeColorTile(deltaColor, { effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.5 } }, overlay: pillOverlay }) as MosaicSource);
      const pillW = padX * 2 + arrowW + arrowGap + textW;
      const pillBand = rowSplit([{ weight: 1, node: EMPTY }, { weight: pillH, node: overlay([pillBg, pillInner]) }, { weight: 1, node: EMPTY }]);
      const subNode: Band[] = hasSub
        ? [{ weight: Math.round(deltaFont * 0.6), node: EMPTY }, { weight: Math.round(subFont * 0.62 * props.sublabel!.length + subFont), node: paint(ff(leftText(props.sublabel!, subFont, theme.muted))) }]
        : [];
      deltaRow = colSplit([{ weight: pillW, node: pillBand }, ...subNode, { weight: 1, node: EMPTY }]);
    } else if (hasSub) {
      deltaRow = colSplit([{ weight: 1, node: paint(ff(leftText(props.sublabel!, subFont, theme.muted))) }]);
    }

    // ── Body stack: label / value / delta / (sparkline reserve) ──
    // Label: premium fades in; light + reduceMotion render it static (like the value).
    const labelSrc = leftText(props.label, labelFont, theme.subtitle);
    const bands: Band[] = [
      { weight: LABEL_W, node: paint(animate && !light ? fadeIn(labelSrc, 0, Math.max(0.1, introSec * 0.25), true) : labelSrc) },
      { weight: GAP_W, node: EMPTY },
      { weight: VALUE_W, node: paint(valueSrc) },
      { weight: GAP_W, node: EMPTY },
      { weight: DELTA_W, node: deltaRow },
    ];
    if (hasSpark) {
      bands.push({ weight: GAP_W, node: EMPTY });
      bands.push({ weight: SPARK_W, node: EMPTY }); // sparkline overlays this region
    }
    const body = rowSplit(bands);

    // ── Sparkline region (px) = the bottom SPARK band of the content rect ──
    let sparkOverlay: Node = EMPTY;
    if (hasSpark) {
      const totalW = LABEL_W + VALUE_W + DELTA_W + SPARK_W + GAP_W * 3;
      const sparkTopFrac = (LABEL_W + VALUE_W + DELTA_W + GAP_W * 3) / totalW;
      const ry = cr.y + sparkTopFrac * cr.h;
      const rh = (SPARK_W / totalW) * cr.h;
      // Sparkline color tracks the delta direction (green up / red down / muted flat)
      // so the trend visually agrees with what the card says — flat falls back to
      // the brand primary so a no-delta card still reads as a neutral trend.
      const sparkColor = direction === "up" ? theme.positive : direction === "down" ? theme.negative : theme.primary;
      sparkOverlay = sparklineNode({ W, H, rx: cr.x, ry, rw: cr.w, rh, values: spark, color: sparkColor, introSec, animate, light });
    }

    const root = card.compose(body, sparkOverlay);

    return Promise.resolve({
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: root.m0 as any,
      sources: root.sources,
      backgroundColor: card.backgroundColor,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
    } as MosaicDocument);
  },
};

registerTemplate(AlpineKpiCard);
