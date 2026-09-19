import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/alpine/donut/v2 — Alpine Donut Chart (RATIO rebuild)
 * ============================================================================
 *
 * Same picture as v1 — a proportional ring (annular-sector masks) + center
 * value/label + side legend — but rebuilt as a RATIO layout instead of absolute
 * full-canvas `placeRects`.
 *
 * v1 packed each sector's tight bbox (+ the % labels + center text) via
 * `placeRects` on the full canvas, so precision tracked the canvas (audit:
 * ABSOLUTE, slope 1.04). The KEY realization: the sweep is NOT per-frame path
 * carving — each segment is ONE static annular-sector mask whose reveal rides on
 * the OVERLAY (alpha fade / enable-gate). So this is the line-chart case: put
 * every ring mark into ONE ratio "ring cell" with geometry in ring-local coords
 * — a mask's path is relative to its own cell, so all the sectors + labels +
 * center text register around the shared center, while the cell is a ratio split
 * → bounded precision. The legend is a sibling ratio cell (unchanged from v1).
 * Composes at any canvas (audit: RATIO).
 * ============================================================================
 */

import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
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

import {
  segmentsToAngles,
  annularSectorPath,
  sectorCentroid,
  MAX_SEGMENTS,
  type BBox,
} from "../../../charts/donut/v3/geometry";
import { sweepInverseEase } from "../../../charts/donut/v3/anim";

import {
  alpineCard,
  paint,
  EMPTY,
  rowSplit,
  colSplit,
  overlay,
  insetNode,
  textCell,
  resolveColor,
  type Node,
  type Band,
} from "../../_shared/alpine-card";
import { resolveAlpineTheme, ALPINE_PALETTE, type AlpinePreset, type AlpineTheme } from "../../_shared/alpine-theme";
import { revealGate, revealFade, ALPINE_ANIM_FIELDS, fBool, fStr, fEnum } from "../../_shared/alpine-anim";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type DonutSegment = { label: string; value: number; color?: MosaicColor };
type LegendPosition = "right" | "none";
type SegLabels = "none" | "percent";
/** Reveal cost/quality dial. "premium" (default): staggered clockwise alpha
 *  fade (a geq). "light": staggered clockwise enable-gate pop — no geq. */
type RenderMode = "premium" | "light";

type DonutAnim = {
  renderMode: RenderMode;
  reduceMotion: boolean;
  introFrac: number;
  countUp: boolean;
  easing: EaseName;
};

type AlpineDonutV2Props = {
  segments: DonutSegment[];
  title?: string;
  subtitle?: string;
  centerValue?: string;
  centerLabel?: string;
  legend?: LegendPosition;
  segmentLabels?: SegLabels;
  preset?: AlpinePreset;
  ringThicknessFrac?: number;
  anim?: DonutAnim;
  /** Opt-in producer theming. The preset is the fallback; a producer's published
   *  tokens override it. Explicit color props still win. */
  theme?: ThemeSourceConfig;
};

const DEFAULT_PRESET: AlpinePreset = "light";
const DEFAULT_RENDER_MODE: RenderMode = "premium";
const DEFAULT_THICKNESS = 0.42;
const DEFAULT_SEG_LABELS: SegLabels = "percent";
const DEFAULT_LEGEND: LegendPosition = "right";
const DEFAULT_ANIM: DonutAnim = { renderMode: DEFAULT_RENDER_MODE, introFrac: 0.7, countUp: true, easing: "easeOut", reduceMotion: false };

const RADIUS_SCALE = 0.9;
const GAP_DEG = 2;
const VALUE_FONT_FRAC = 0.26;
const CAPTION_FONT_FRAC = 0.1;
const SEG_LABEL_FONT_FRAC = 0.42;
const SEG_LABEL_MIN_SWEEP_DEG = 16;

const RING_FRAC_WITH_LEGEND = 0.56;

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function cellText(text: string, fontSize: number, color: MosaicColor): MosaicTextSource {
  return { type: "text", visual: { backgroundColor: "black@0" }, layers: [{ content: { kind: "literal", text: text || " " }, style: { fontSize, fontColor: color }, placement: { hAlign: "center", vAlign: "middle" } as any }] };
}
function cellExprText(expr: string, fontSize: number, color: MosaicColor): MosaicTextSource {
  return { type: "text", renderMode: { kind: "video" }, visual: { backgroundColor: "black@0" }, layers: [{ content: { kind: "expr", expr, eval: "frame" }, style: { fontSize, fontColor: color }, placement: { hAlign: "center", vAlign: "middle" } as any }] };
}
function textBBox(cxp: number, cyp: number, text: string, font: number): BBox {
  const w = Math.max(font, text.length * font * 0.85 + font);
  const h = font * 1.6;
  return { minX: cxp - w / 2, minY: cyp - h / 2, maxX: cxp + w / 2, maxY: cyp + h / 2 };
}
function labelColorFor(hex: MosaicColor, light: MosaicColor, dark: MosaicColor): MosaicColor {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex));
  if (!m) return light;
  const v = parseInt(m[1], 16);
  const lum = (0.2126 * ((v >> 16) & 0xff) + 0.7152 * ((v >> 8) & 0xff) + 0.0722 * (v & 0xff)) / 255;
  return lum > 0.6 ? dark : light;
}
const clampI = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

// ---------------------------------------------------------------------------
// Ring as a RATIO cell: every mark fills the `cw×ch` ring cell in ring-local
// coords, so the sectors + labels + center text register around the shared
// center. (Same single-coordinate-system idea v1 got from full-canvas placeRects,
// now scoped to a ratio cell → bounded precision.)
// ---------------------------------------------------------------------------

function buildRingNode(opts: {
  cw: number; ch: number;
  values: number[]; colors: MosaicColor[];
  thicknessFrac: number; segLabels: SegLabels;
  centerValue: string; centerLabel?: string;
  theme: AlpineTheme;
  introSec: number; ease: EaseName; countUp: boolean; reduceMotion: boolean; renderMode: RenderMode;
}): Node {
  const { cw, ch, values, colors, theme } = opts;
  const light = opts.renderMode === "light";
  const revealText = <T extends MosaicSource>(src: T, startSec: number, durSec: number): T =>
    opts.reduceMotion ? src : light ? revealGate(src, startSec) : revealFade(src, startSec, durSec);

  const cx = cw / 2, cy = ch / 2;
  const rOuter = (Math.min(cw, ch) / 2) * RADIUS_SCALE;
  const rInner = rOuter * (1 - Math.max(0.05, Math.min(0.9, opts.thicknessFrac)));
  const holeDia = rInner * 2;
  const bounds = { x: 0, y: 0, width: cw, height: ch } as const;

  // Place a node at a ring-local bbox by insetting it inside the ring cell.
  const placeAt = (node: Node, bb: BBox): Node => {
    const l = clampI(bb.minX, 0, cw - 2);
    const t = clampI(bb.minY, 0, ch - 2);
    const r = clampI(cw - bb.maxX, 0, cw - l - 1);
    const b = clampI(ch - bb.maxY, 0, ch - t - 1);
    return insetNode(node, t, r, b, l, cw, ch);
  };

  const angles = segmentsToAngles(values, { gapDeg: values.length > 1 ? GAP_DEG : 0 });
  const segColor = (i: number): MosaicColor => colors[i % colors.length];

  // ── Sectors (BACK): one static annular-sector mask per segment; the sweep is
  //    the staggered OVERLAY (alpha fade / enable-gate), not a per-frame path. ──
  const sectorLayers: Node[] = [];
  const fadeDur = Math.max(0.1, opts.introSec * 0.32);
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i];
    let rev: Record<string, unknown> | undefined;
    if (!opts.reduceMotion) {
      const startAtSec = Math.max(0, (opts.introSec - fadeDur) * sweepInverseEase(opts.ease, a.startDeg / 360));
      rev = light ? { startAtSec, enable: `gte(t,${startAtSec.toFixed(3)})` } : { startAtSec, alpha: fadeInExpr(startAtSec, fadeDur) };
    }
    const tile = makeColorTile(segColor(i), {
      mask: { kind: "inline-mask", localPath: annularSectorPath({ cx, cy, rOuter, rInner, startDeg: a.startDeg, endDeg: a.endDeg }), bounds } as any,
      ...(rev ? { overlay: rev } : {}),
    }) as MosaicSource;
    sectorLayers.push(paint(tile));
  }

  // ── Per-segment % labels (FRONT), each at its sector centroid. ──
  const labelLayers: Node[] = [];
  if (opts.segLabels === "percent") {
    const ringPx = rOuter - rInner;
    const segFont = Math.max(9, Math.round(ringPx * SEG_LABEL_FONT_FRAC));
    for (let i = 0; i < angles.length; i++) {
      const a = angles[i];
      if (a.endDeg - a.startDeg < SEG_LABEL_MIN_SWEEP_DEG) continue;
      const { x, y } = sectorCentroid({ cx, cy, rOuter, rInner, startDeg: a.startDeg, endDeg: a.endDeg });
      const pct = `${Math.round(a.frac * 100)}%`;
      const color = labelColorFor(segColor(i), theme.card, theme.title);
      labelLayers.push(placeAt(paint(revealText(cellText(pct, segFont, color), opts.introSec * 0.6, Math.max(0.1, opts.introSec * 0.3))), textBBox(x, y, pct, segFont)));
    }
  }

  // ── Center value + caption (FRONT). ──
  const valueText = opts.centerValue;
  const hasCaption = !!(opts.centerLabel && opts.centerLabel.trim());
  const valueFont = Math.max(10, Math.round(Math.min(holeDia * VALUE_FONT_FRAC, (holeDia * 0.72) / Math.max(1, valueText.length * 0.62))));
  const captionFont = Math.max(9, Math.round(holeDia * CAPTION_FONT_FRAC));
  const valueCy = hasCaption ? cy - rInner * 0.12 : cy;
  const animateValue = opts.countUp && !opts.reduceMotion && /\d/.test(valueText);
  const centerLayers: Node[] = [];
  centerLayers.push(placeAt(
    paint(animateValue
      ? cellExprText(animateNumbersInText(valueText, { durationSec: opts.introSec, ease: opts.ease }), valueFont, theme.title)
      : cellText(valueText, valueFont, theme.title)),
    textBBox(cx, valueCy, valueText, valueFont),
  ));
  if (hasCaption) {
    centerLayers.push(placeAt(paint(revealText(cellText(opts.centerLabel!, captionFont, theme.subtitle), opts.introSec * 0.7, Math.max(0.1, opts.introSec * 0.3))), textBBox(cx, cy + rInner * 0.44, opts.centerLabel!, captionFont)));
  }

  return overlay([...sectorLayers, ...labelLayers, ...centerLayers]);
}

// ---------------------------------------------------------------------------
// Legend (Node) — colored dot + label + percent (ratio splits; unchanged from v1)
// ---------------------------------------------------------------------------

function legendNode(opts: { labels: string[]; percents: string[]; colors: MosaicColor[]; theme: AlpineTheme; font: number; cellH: number }): Node {
  const { labels, percents, colors, theme, font, cellH } = opts;
  const N = labels.length;
  const rowH = Math.max(font, Math.round(font * 1.7));
  const rowGap = Math.round(font * 0.5);
  const stackH = N * rowH + (N - 1) * rowGap;
  const margin = Math.max(0, Math.round((cellH - stackH) / 2));

  const bands: Band[] = [];
  if (margin > 0) bands.push({ weight: margin, node: EMPTY });
  for (let i = 0; i < N; i++) {
    const dot = rowSplit([
      { weight: 1, node: EMPTY },
      { weight: 2, node: paint(makeColorTile(colors[i % colors.length], { effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.4 } } })) },
      { weight: 1, node: EMPTY },
    ]);
    const row = colSplit([
      { weight: 1, node: EMPTY },
      { weight: 2, node: dot },
      { weight: 1, node: EMPTY },
      { weight: 11, node: paint(textCell(labels[i] ?? "", font, theme.label, "left", "middle")) },
      { weight: 5, node: paint(textCell(percents[i] ?? "", font, theme.subtitle, "right", "middle", { right: 0.1 })) },
    ]);
    bands.push({ weight: rowH, node: row });
    if (i < N - 1) bands.push({ weight: rowGap, node: EMPTY });
  }
  if (margin > 0) bands.push({ weight: margin, node: EMPTY });
  return rowSplit(bands);
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const propsSchema = definePropsSchema<AlpineDonutV2Props>({
  segments: { type: "array" as any, required: true, description: "Ring segments (clockwise from 12 o'clock). Raw weights — normalized internally.", meta: { control: { flavor: "objectRows", columns: [{ label: "Label", key: "label", kind: "text", placeholder: "Segment" }, { label: "Value", key: "value", kind: "number" }, { label: "Color", key: "color", kind: "color" }], palette: ALPINE_PALETTE as unknown as string[] }, ui: { label: "Segments", order: 1 } } },
  title: { type: "string", required: false, description: "Card title.", meta: { control: { placeholder: "e.g., DONUT CHART" }, ui: { label: "Title", order: 2 } } },
  subtitle: { type: "string", required: false, description: "Card subtitle.", meta: { control: { placeholder: "e.g., Revenue Mix" }, ui: { label: "Subtitle", order: 3 } } },
  centerValue: { type: "string", required: false, description: "Pre-formatted hole value (e.g. \"$12,480\"). Omit to derive the sum.", meta: { control: { placeholder: "e.g. $12,480" }, ui: { label: "Center value", order: 4 } } },
  centerLabel: { type: "string", required: false, description: "Small caption under the center value (e.g. \"Total\").", meta: { control: { placeholder: "e.g. Total" }, ui: { label: "Center label", order: 5 } } },
  legend: { type: "string", required: false, description: "Side legend: right or none.", meta: { constraints: { oneOf: ["right", "none"] }, ui: { label: "Legend", order: 6 } } },
  segmentLabels: { type: "string", required: false, description: "Per-segment labels: none or percent.", meta: { constraints: { oneOf: ["none", "percent"] }, ui: { label: "Segment Labels", order: 7 } } },
  preset: { type: "string", required: false, description: "Alpine theme variant.", meta: { constraints: { oneOf: ["light", "dark"] }, ui: { label: "Preset", order: 8 } } },
  ringThicknessFrac: { type: "number", required: false, description: "Ring thickness as a fraction of the outer radius.", meta: { constraints: { min: 0.05, max: 0.9 }, control: { flavor: "slider", step: 0.02 }, ui: { label: "Ring thickness", order: 9 } } },

  anim: {
    type: "group" as any, required: false, description: "Reveal mode + clockwise sweep intro.",
    meta: { ui: { label: "Animation", order: 10, collapsedByDefault: true } },
    fields: {
      renderMode: fEnum("Render mode", ["premium", "light"], "\"premium\" (default): clockwise alpha-fade sweep — the softest look, but a per-pixel geq paid on every frame of a nesting parent's whole timeline. \"light\": clockwise enable-gate pop — no geq, composable, cheap when nested."),
      reduceMotion: ALPINE_ANIM_FIELDS.reduceMotion,
      introFrac: ALPINE_ANIM_FIELDS.introFrac,
      countUp: fBool("Count up", "Count the center value up during the intro."),
      easing: ALPINE_ANIM_FIELDS.easing,
    },
  } as any,
  theme: {
    type: "group" as any, required: false, description: "Opt into a theme source. Uses the alpine preset by default; set a producer slug + namespace to pull shared design tokens. Explicit segment colors still win.",
    meta: { ui: { label: "Theme", order: 11, collapsedByDefault: true } },
    fields: { slug: fStr("Producer slug", "Producer template to seed tokens from (e.g. \"@m0saic/theming/v1\").", "preset palette (no producer)"), preset: fStr("Preset", "Producer preset/variant (light | dark | high-contrast; producer-defined).", "producer default"), namespace: fStr("Namespace", "Upstream alias to read tokens from. Default \"theme\".", "theme"), forceFetch: fBool("Force fetch", "Re-seed via the slug even if the namespace is populated.") },
  } as any,
});

export const AlpineDonutV2: MosaicTemplate<AlpineDonutV2Props> = {
  id: asTemplateId("@m0saic/alpine/donut/v2"),
  label: "Alpine Donut Chart",
  version: 2,
  description: "Alpine donut chart — friendly mobile-marketing card: proportional ring, center value + label, side legend, sweep + count-up animation. v2 rebuilds the ring as a ratio cell (sectors are masks filling the cell in ring-local coords) so it composes at any canvas without the absolute-placement precision blowup.",
  capabilities: { tier: "core" },
  primitive: true,
  deprecated: {
    reason:
      "Superseded by v3, which keeps this exact ratio ring but upgrades premium from a per-segment fade to the FULL clockwise radial SWEEP (self-framed coarse-quantize — smooth draw-on that still composes at any canvas). v2's per-segment mask-in-a-cell path lives on as v3's 'light' mode.",
    replacement: asTemplateId("@m0saic/alpine/donut/v3"),
    since: "2026-07-09",
  },
  tags: ["alpine", "donut", "distribution", "data-viz"],
  outputHints: { width: 1280, height: 800, fps: 30, durationMs: 2000 },
  propsSchema,

  defaultProps: {
    theme: { forceFetch: false },
    segments: [
      { label: "Enterprise", value: 42, color: ALPINE_PALETTE[0] },
      { label: "Pro", value: 33, color: ALPINE_PALETTE[1] },
      { label: "Free", value: 25, color: ALPINE_PALETTE[2] },
    ],
    title: "DONUT CHART",
    subtitle: "Revenue Mix",
    centerValue: "$12,480",
    centerLabel: "Total",
    preset: DEFAULT_PRESET,
    ringThicknessFrac: DEFAULT_THICKNESS,
    segmentLabels: DEFAULT_SEG_LABELS,
    legend: DEFAULT_LEGEND,
    anim: DEFAULT_ANIM,
  },

  async render(props: AlpineDonutV2Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));

    const segments = (props.segments ?? []).slice(0, MAX_SEGMENTS).filter((s) => s && Number.isFinite(s.value) && s.value > 0);
    if (segments.length === 0) {
      return makeErrorMosaic("segments[] must have at least one positive value", { title: `${this.id}`, width: W, height: H });
    }

    const theme = await resolveAlpineTheme(props.preset ?? DEFAULT_PRESET, ctx, props.theme);
    const anim: DonutAnim = { ...DEFAULT_ANIM, ...(props.anim ?? {}) };
    const renderMode: RenderMode = anim.renderMode ?? DEFAULT_RENDER_MODE;
    const legend: LegendPosition = props.legend ?? DEFAULT_LEGEND;
    const values = segments.map((s) => s.value);
    const total = values.reduce((a, b) => a + b, 0);
    const colors: MosaicColor[] = segments.map((s, i) => resolveColor(s.color, ALPINE_PALETTE[i % ALPINE_PALETTE.length]));
    const percents = values.map((v) => `${Math.round((v / total) * 100)}%`);

    const clipSec = Math.max(0.1, (ctx.target.durationMs ?? 2000) / 1000);
    const introSec = Math.max(0.1, Math.min(1, anim.introFrac) * clipSec);

    const card = alpineCard({ theme, W, H, title: props.title, subtitle: props.subtitle });
    const cr = card.contentRect;

    const showLegend = legend === "right" && segments.length > 0;
    const ringW = showLegend ? Math.max(16, Math.round(cr.w * RING_FRAC_WITH_LEGEND)) : cr.w;
    const legendW = cr.w - ringW;

    const ringNode = buildRingNode({
      cw: ringW, ch: cr.h, values, colors,
      thicknessFrac: props.ringThicknessFrac ?? DEFAULT_THICKNESS,
      segLabels: props.segmentLabels ?? DEFAULT_SEG_LABELS,
      centerValue: props.centerValue ?? String(Math.round(total)),
      centerLabel: props.centerLabel,
      theme, introSec, ease: anim.easing, countUp: anim.countUp, reduceMotion: anim.reduceMotion, renderMode,
    });

    const legendFont = Math.max(11, Math.round(H * 0.024));
    const content: Node = showLegend
      ? colSplit([
          { weight: ringW, node: ringNode },
          { weight: legendW, node: legendNode({ labels: segments.map((s) => s.label), percents, colors, theme, font: legendFont, cellH: cr.h }) },
        ])
      : ringNode;

    const root = card.compose(content);

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

registerTemplate(AlpineDonutV2);
