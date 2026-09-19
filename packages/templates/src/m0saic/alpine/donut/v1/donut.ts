import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/alpine/donut/v1 — Alpine Donut Chart (friendly mobile-marketing)
 * ============================================================================
 *
 * The Alpine pack's donut: a proportional ring (tight cell-local annular-sector
 * masks, like charts/donut/v3) inside the Alpine white card chrome, with a
 * center value/label and a side LEGEND (colored dot + label + %). STANDALONE
 * brand flavor — it reuses the pure donut GEOMETRY math from charts/donut/v3
 * (annular sectors are shared math, not a composed template) but owns its own
 * chrome, palette, and legend.
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
import { placeRects } from "@m0saic/dsl-stdlib";

import {
  segmentsToAngles,
  annularSectorBBox,
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
 *  fade — the softest look, but a per-pixel geq paid on every frame of a nesting
 *  parent's whole timeline. "light": staggered clockwise enable-gate pop — no geq,
 *  composable, cheap when nested. */
type RenderMode = "premium" | "light";

type DonutAnim = {
  /** Reveal cost/quality dial (see RenderMode). */
  renderMode: RenderMode;
  /** Skip motion; render the final static ring. */
  reduceMotion: boolean;
  /** Fraction of the clip the sweep + count-up occupy (0..1). */
  introFrac: number;
  countUp: boolean;
  easing: EaseName;
};

type AlpineDonutProps = {
  // ── Primary props (flat — always visible up top) ──
  segments: DonutSegment[];
  title?: string;
  subtitle?: string;
  centerValue?: string;
  centerLabel?: string;
  legend?: LegendPosition;
  segmentLabels?: SegLabels;
  preset?: AlpinePreset;
  ringThicknessFrac?: number;
  // ── Grouped props (collapsible sections) ──
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

// Ring geometry / packing constants (mirrors charts/donut/v3).
const RADIUS_SCALE = 0.9;
const GAP_DEG = 2;
const VALUE_FONT_FRAC = 0.26;
const CAPTION_FONT_FRAC = 0.1;
const SEG_LABEL_FONT_FRAC = 0.42;
const SEG_LABEL_MIN_SWEEP_DEG = 16;
const EDGE_PAD = 1.5;
const SNAP_PX = 4;

// Fraction of the card content width the ring occupies (legend takes the rest).
const RING_FRAC_WITH_LEGEND = 0.56;

// ---------------------------------------------------------------------------
// Tight-cell placement + text helpers (replicated from charts/donut/v3)
// ---------------------------------------------------------------------------

type Rect = { x: number; y: number; w: number; h: number; claimant: string; importance?: number };
type Piece = { rect: Rect; source: MosaicSource };

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

function placePiece(W: number, H: number, bbox: BBox, makeSource: (cellW: number, cellH: number, ox: number, oy: number) => MosaicSource): Piece {
  const snapDown = (v: number) => Math.floor((v - EDGE_PAD) / SNAP_PX) * SNAP_PX;
  const snapUp = (v: number) => Math.ceil((v + EDGE_PAD) / SNAP_PX) * SNAP_PX;
  const x = clampInt(snapDown(bbox.minX), 0, W - 1);
  const y = clampInt(snapDown(bbox.minY), 0, H - 1);
  const x2 = clampInt(snapUp(bbox.maxX), x + SNAP_PX, W);
  const y2 = clampInt(snapUp(bbox.maxY), y + SNAP_PX, H);
  return { rect: { x, y, w: x2 - x, h: y2 - y, claimant: "F" }, source: makeSource(x2 - x, y2 - y, x, y) };
}

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

// ---------------------------------------------------------------------------
// Ring (placeRects of tight annular-sector cells) → { m0, sources }
// ---------------------------------------------------------------------------

function buildRing(opts: {
  W: number; H: number;                         // full canvas (cells snap to ITS grid → GCD-aligned, no seams)
  rx: number; ry: number; rw: number; rh: number; // the ring region within the canvas
  values: number[]; colors: MosaicColor[];
  thicknessFrac: number; segLabels: SegLabels;
  centerValue: string; centerLabel?: string;
  theme: AlpineTheme;
  introSec: number; ease: EaseName; countUp: boolean; reduceMotion: boolean; renderMode: RenderMode; fps: number; durationMs: number;
}): Node {
  const { W, H, rx, ry, rw, rh, values, colors, theme } = opts;
  const light = opts.renderMode === "light";
  // Mode-aware text reveal: premium = soft alpha fade (a geq); light = geq-free
  // enable-gate pop; reduceMotion = static. Premium is byte-identical to the old
  // local `fadeIn` (same `fadeInExpr` overlay).
  const revealText = <T extends MosaicSource>(src: T, startSec: number, durSec: number): T =>
    opts.reduceMotion ? src : light ? revealGate(src, startSec) : revealFade(src, startSec, durSec);
  const cx = rx + rw / 2, cy = ry + rh / 2;
  const rOuter = (Math.min(rw, rh) / 2) * RADIUS_SCALE;
  const rInner = rOuter * (1 - Math.max(0.05, Math.min(0.9, opts.thicknessFrac)));
  const holeDia = rInner * 2;

  // One segment = a full ring (no gap to carve into nothing); 2+ segments get
  // the GAP_DEG separators between them.
  const angles = segmentsToAngles(values, { gapDeg: values.length > 1 ? GAP_DEG : 0 });
  const segColor = (i: number): MosaicColor => colors[i % colors.length];

  const sectorPieces: Piece[] = [];
  const labelPieces: Piece[] = [];
  const textPieces: Piece[] = [];

  const sectorPiece = (segIndex: number, startDeg: number, endDeg: number, overlay?: { startAtSec: number; alpha?: string; enable?: string }): Piece => {
    const p = placePiece(W, H, annularSectorBBox({ cx, cy, rOuter, rInner, startDeg, endDeg }), (cw, ch, ox, oy) =>
      makeColorTile(segColor(segIndex), {
        mask: { kind: "inline-mask", localPath: annularSectorPath({ cx: cx - ox, cy: cy - oy, rOuter, rInner, startDeg, endDeg }), bounds: { x: 0, y: 0, width: cw, height: ch } } as any,
        ...(overlay ? { overlay } : {}),
      }),
    );
    // Ring sectors are the BACK layer; % labels + center value/caption float above
    // (importance 1). Explicit importance on every piece → deterministic layering,
    // no reliance on the packer's incidental stacking.
    p.rect.importance = 0;
    return p;
  };

  // Staggered FULL-SECTOR reveal (clockwise from 12 o'clock): one solid tile per
  // segment, each fading in at a time proportional to its start angle, so the
  // ring still "fills in" clockwise but every segment is a clean GCD-aligned arc.
  // (The prior per-sliver sweep subdivided each segment into many tight cells
  // that snapped to the 4px grid independently → staircased edges for many/thin
  // segments.) reduceMotion → all sectors solid from frame 0.
  if (opts.reduceMotion) {
    for (let i = 0; i < angles.length; i++) sectorPieces.push(sectorPiece(i, angles[i].startDeg, angles[i].endDeg));
  } else {
    const fadeDur = Math.max(0.1, opts.introSec * 0.32);
    for (let i = 0; i < angles.length; i++) {
      const a = angles[i];
      const startAtSec = Math.max(0, (opts.introSec - fadeDur) * sweepInverseEase(opts.ease, a.startDeg / 360));
      // premium = clockwise alpha fade (geq); light = clockwise enable-gate pop (no
      // geq). The staggered `startAtSec` keeps the clockwise fill order in both.
      const rev = light
        ? { startAtSec, enable: `gte(t,${startAtSec.toFixed(3)})` }
        : { startAtSec, alpha: fadeInExpr(startAtSec, fadeDur) };
      sectorPieces.push(sectorPiece(i, a.startDeg, a.endDeg, rev));
    }
  }

  // Per-segment percent labels.
  if (opts.segLabels === "percent") {
    const ringPx = rOuter - rInner;
    const segFont = Math.max(9, Math.round(ringPx * SEG_LABEL_FONT_FRAC));
    for (let i = 0; i < angles.length; i++) {
      const a = angles[i];
      if (a.endDeg - a.startDeg < SEG_LABEL_MIN_SWEEP_DEG) continue;
      const { x, y } = sectorCentroid({ cx, cy, rOuter, rInner, startDeg: a.startDeg, endDeg: a.endDeg });
      const pct = `${Math.round(a.frac * 100)}%`;
      const color = labelColorFor(segColor(i), theme.card, theme.title);
      const piece = placePiece(W, H, textBBox(x, y, pct, segFont), () => revealText(cellText(pct, segFont, color), opts.introSec * 0.6, Math.max(0.1, opts.introSec * 0.3)));
      piece.rect.importance = 1;
      labelPieces.push(piece);
    }
  }

  // Center value + caption.
  const valueText = opts.centerValue;
  const hasCaption = !!(opts.centerLabel && opts.centerLabel.trim());
  // Fit the value to the hole WIDTH (length-aware) so long values like "$12,480"
  // don't spill onto the ring; cap by VALUE_FONT_FRAC so short values don't balloon.
  const valueFont = Math.max(10, Math.round(Math.min(holeDia * VALUE_FONT_FRAC, (holeDia * 0.72) / Math.max(1, valueText.length * 0.62))));
  const captionFont = Math.max(9, Math.round(holeDia * CAPTION_FONT_FRAC));
  const valueCy = hasCaption ? cy - rInner * 0.12 : cy;
  const animateValue = opts.countUp && !opts.reduceMotion && /\d/.test(valueText);
  const valPiece = placePiece(W, H, textBBox(cx, valueCy, valueText, valueFont), () =>
    animateValue
      ? cellExprText(animateNumbersInText(valueText, { durationSec: opts.introSec, ease: opts.ease }), valueFont, theme.title)
      : cellText(valueText, valueFont, theme.title),
  );
  valPiece.rect.importance = 1;
  textPieces.push(valPiece);
  if (hasCaption) {
    const capPiece = placePiece(W, H, textBBox(cx, cy + rInner * 0.44, opts.centerLabel!, captionFont), () => revealText(cellText(opts.centerLabel!, captionFont, theme.subtitle), opts.introSec * 0.7, Math.max(0.1, opts.introSec * 0.3)));
    capPiece.rect.importance = 1; // text above the ring (was missing → could layer under a sector)
    textPieces.push(capPiece);
  }

  const pieces = [...sectorPieces, ...labelPieces, ...textPieces];
  const placed = placeRects({ rootW: W, rootH: H, rects: pieces.map((p) => p.rect) as any });
  const sources: MosaicSource[] = [];
  for (const layer of (placed as { layers: Array<{ rectIndices: number[] }> }).layers) {
    const ordered = [...layer.rectIndices].sort((a, b) => pieces[a].rect.y - pieces[b].rect.y || pieces[a].rect.x - pieces[b].rect.x);
    for (const idx of ordered) sources.push(pieces[idx].source);
  }
  return { m0: String((placed as { m0: string }).m0), sources };
}

// ---------------------------------------------------------------------------
// Legend (Node) — colored dot + label + percent, stacked, vertically centered
// ---------------------------------------------------------------------------

function legendNode(opts: { labels: string[]; percents: string[]; colors: MosaicColor[]; theme: AlpineTheme; font: number; cellH: number }): Node {
  const { labels, percents, colors, theme, font, cellH } = opts;
  const N = labels.length;
  // Pixel-tight rows: each ~1.7× the font, gaps ~0.5× — a compact cluster,
  // centered by computed margins (vs the old weighted fill that stretched the
  // rows across the whole cell).
  const rowH = Math.max(font, Math.round(font * 1.7));
  const rowGap = Math.round(font * 0.5);
  const stackH = N * rowH + (N - 1) * rowGap;
  const margin = Math.max(0, Math.round((cellH - stackH) / 2));

  const bands: Band[] = [];
  if (margin > 0) bands.push({ weight: margin, node: EMPTY });
  for (let i = 0; i < N; i++) {
    // dot: a rounded square ~half the row height, vertically centered.
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

const propsSchema = definePropsSchema<AlpineDonutProps>({
  // ── Primary props — flat, always visible up top (declaration order = display order). ──
  segments: { type: "array" as any, required: true, description: "Ring segments (clockwise from 12 o'clock). Raw weights — normalized internally.", meta: { control: { flavor: "objectRows", columns: [{ label: "Label", key: "label", kind: "text", placeholder: "Segment" }, { label: "Value", key: "value", kind: "number" }, { label: "Color", key: "color", kind: "color" }], palette: ALPINE_PALETTE as unknown as string[] }, ui: { label: "Segments", order: 1 } } },
  title: { type: "string", required: false, description: "Card title.", meta: { control: { placeholder: "e.g., DONUT CHART" }, ui: { label: "Title", order: 2 } } },
  subtitle: { type: "string", required: false, description: "Card subtitle.", meta: { control: { placeholder: "e.g., Revenue Mix" }, ui: { label: "Subtitle", order: 3 } } },
  centerValue: { type: "string", required: false, description: "Pre-formatted hole value (e.g. \"$12,480\"). Omit to derive the sum.", meta: { control: { placeholder: "e.g. $12,480" }, ui: { label: "Center value", order: 4 } } },
  centerLabel: { type: "string", required: false, description: "Small caption under the center value (e.g. \"Total\").", meta: { control: { placeholder: "e.g. Total" }, ui: { label: "Center label", order: 5 } } },
  legend: { type: "string", required: false, description: "Side legend: right or none.", meta: { constraints: { oneOf: ["right", "none"] }, ui: { label: "Legend", order: 6 } } },
  segmentLabels: { type: "string", required: false, description: "Per-segment labels: none or percent.", meta: { constraints: { oneOf: ["none", "percent"] }, ui: { label: "Segment Labels", order: 7 } } },
  preset: { type: "string", required: false, description: "Alpine theme variant.", meta: { constraints: { oneOf: ["light", "dark"] }, ui: { label: "Preset", order: 8 } } },
  ringThicknessFrac: { type: "number", required: false, description: "Ring thickness as a fraction of the outer radius.", meta: { constraints: { min: 0.05, max: 0.9 }, control: { flavor: "slider", step: 0.02 }, ui: { label: "Ring thickness", order: 9 } } },

  // ── Everything else grouped into collapsible sections. ──
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

export const AlpineDonut: MosaicTemplate<AlpineDonutProps> = {
  id: asTemplateId("@m0saic/alpine/donut/v1"),
  label: "Alpine Donut Chart",
  version: 1,
  description: "Alpine donut chart — friendly mobile-marketing card: proportional ring, center value + label, side legend, sweep + count-up animation.",
  capabilities: { tier: "core" },
  primitive: true,
  deprecated: {
    reason:
      "Absolute-placement antipattern: each sector's tight bbox (+ the % labels + center text) is packed full-canvas via placeRects, so precision tracks the canvas (audit: ABSOLUTE, slope 1.04) and it pins its parent when nested. The sweep is already static per-segment masks (reveal on the overlay, not per-frame path carving), so v2 scopes the same single-coordinate-system idea to ONE ratio 'ring cell' — the sectors + labels + center text are masks/text filling that cell in ring-local coords, registering around the shared center while the cell is a ratio split → bounded precision. Composes at any canvas.",
    replacement: asTemplateId("@m0saic/alpine/donut/v2"),
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

  async render(props: AlpineDonutProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));

    const segments = (props.segments ?? []).slice(0, MAX_SEGMENTS).filter((s) => s && Number.isFinite(s.value) && s.value > 0);
    if (segments.length === 0) {
      return makeErrorMosaic("segments[] must have at least one positive value", { title: `${this.id}`, width: W, height: H });
    }

    // Theming: the shared alpine theme (light default via the preset). A producer
    // overrides card/text/palette tokens through `props.theme`; explicit segment
    // colors still win. Unthemed → byte-identical to the sync `alpineTheme`.
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

    // Card chrome → content rect. The ring is placed DIRECTLY on the full canvas
    // (its tight-cell masks snap to the canvas grid → GCD-aligned, no seams) and
    // OVERLAID on the card; the legend lives in the content's right cell. (The
    // prior child-doc ring got scaled into the left cell, which broke the mask
    // alignment and showed seams — donut/v3's GCD trick only holds full-canvas.)
    const card = alpineCard({ theme, W, H, title: props.title, subtitle: props.subtitle });
    const cr = card.contentRect;

    const showLegend = legend === "right" && segments.length > 0;
    const ringW = showLegend ? Math.max(16, Math.round(cr.w * RING_FRAC_WITH_LEGEND)) : cr.w;
    const legendW = cr.w - ringW;

    const ring = buildRing({
      W, H, rx: cr.x, ry: cr.y, rw: ringW, rh: cr.h, values, colors,
      thicknessFrac: props.ringThicknessFrac ?? DEFAULT_THICKNESS,
      segLabels: props.segmentLabels ?? DEFAULT_SEG_LABELS,
      centerValue: props.centerValue ?? String(Math.round(total)),
      centerLabel: props.centerLabel,
      theme, introSec, ease: anim.easing, countUp: anim.countUp, reduceMotion: anim.reduceMotion, renderMode,
      fps: ctx.target.fps, durationMs: ctx.target.durationMs,
    });

    // Card content holds an EMPTY left cell (the ring overlays it) + the legend.
    const legendFont = Math.max(11, Math.round(H * 0.024));
    const content: Node = showLegend
      ? colSplit([
          { weight: ringW, node: EMPTY },
          { weight: legendW, node: legendNode({ labels: segments.map((s) => s.label), percents, colors, theme, font: legendFont, cellH: cr.h }) },
        ])
      : EMPTY;

    const root = card.compose(content, ring);

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

registerTemplate(AlpineDonut);
