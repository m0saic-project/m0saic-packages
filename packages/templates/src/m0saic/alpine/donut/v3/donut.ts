import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/alpine/donut/v3 — Alpine Donut Chart (RATIO, per-segment masks)
 * ============================================================================
 *
 * Same picture as v2 — a proportional ring + center value/label + side legend in
 * the Alpine card. Every mask is a FULL-CELL inline-mask — seam-free by
 * construction. (The old premium sweep bbox-snapped slivers to a coarse grid;
 * the snap corners printed white squares at the segment gaps on every frame.
 * Gate-4 fail 2026-08-20 — the crop machinery is gone; the piecewise FEEL
 * stays via budgeted full-cell slivers.)
 *
 * Reveals:
 *   - "premium" (animated): PIECEWISE clockwise draw-on — each segment
 *     subdivides into a few slivers (slivers + labels + center budgeted to the
 *     engine's 20-layer overlay comfort zone, well under the ~25-overlay mask
 *     cliff), every sliver a full-cell mask overlapped 2° backward so
 *     boundaries composite invisibly; each piece fades as the eased front
 *     reaches it, duration proportional to its arc.
 *   - "light": per-segment enable-gate pops (geq-free, composable).
 *   - reduceMotion: the static per-segment ring.
 *
 * The legend, center value, and % labels are the Alpine chrome (unchanged from
 * v2). Composes at any canvas.
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
  bindProp,
  bindPropPath,
  type EaseName,
  type ThemeSourceConfig,
  withLayoutContract,
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
  tag,
  resolveColor,
  type Node,
  type Band,
} from "../../_shared/alpine-card";
import { resolveAlpineTheme, ALPINE_PALETTE, type AlpinePreset, type AlpineTheme } from "../../_shared/alpine-theme";
import {
  buildBrandedCover,
  brandedCoverHeroBox,
  inlineHeroDoc,
  onboardingFrame,
} from "../../../_shared/onboarding-cover";
import { revealGate, revealFade, ALPINE_ANIM_FIELDS, fBool, fStr, fEnum } from "../../_shared/alpine-anim";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type DonutSegment = { label: string; value: number; color?: MosaicColor };
type LegendPosition = "right" | "none";
type SegLabels = "none" | "percent";
/** Reveal cost/quality dial. "premium" (default): piecewise clockwise
 *  draw-on (budgeted full-cell slivers). "light": per-segment pops. */
type RenderMode = "premium" | "light";

type DonutAnim = {
  renderMode: RenderMode;
  reduceMotion: boolean;
  introFrac: number;
  countUp: boolean;
  easing: EaseName;
};

type AlpineDonutV3Props = {
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
  /** Dev-only layout contract: assert every legend swatch rendered the same size. */
  debugLayout?: boolean;
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
// PER-SEGMENT ring (light / static) — mask-in-a-cell, ≤MAX_SEGMENTS masks
// ---------------------------------------------------------------------------

function buildSegmentRing(opts: {
  cw: number; ch: number; values: number[]; colors: MosaicColor[];
  /** ORIGINAL index into props.segments per drawn segment (Make leaf bindings). */
  srcIndices: number[];
  thicknessFrac: number; segLabels: SegLabels; centerValue: string; centerLabel?: string;
  theme: AlpineTheme; introSec: number; ease: EaseName; countUp: boolean; reduceMotion: boolean; light: boolean;
}): Node {
  const { cw, ch, values, colors, theme, light } = opts;
  const revealText = <T extends MosaicSource>(src: T, startSec: number, durSec: number): T =>
    opts.reduceMotion ? src : light ? revealGate(src, startSec) : revealFade(src, startSec, durSec);
  const cx = cw / 2, cy = ch / 2;
  const rOuter = (Math.min(cw, ch) / 2) * RADIUS_SCALE;
  const rInner = rOuter * (1 - Math.max(0.05, Math.min(0.9, opts.thicknessFrac)));
  const holeDia = rInner * 2;
  const bounds = { x: 0, y: 0, width: cw, height: ch } as const;
  const placeAt = (node: Node, bb: BBox): Node => {
    const l = clampI(bb.minX, 0, cw - 2), t = clampI(bb.minY, 0, ch - 2);
    const r = clampI(cw - bb.maxX, 0, cw - l - 1), b = clampI(ch - bb.maxY, 0, ch - t - 1);
    return insetNode(node, t, r, b, l, cw, ch);
  };
  const angles = segmentsToAngles(values, { gapDeg: values.length > 1 ? GAP_DEG : 0 });
  const segColor = (i: number): MosaicColor => colors[i % colors.length];

  // ── The piecewise draw-on (premium, animated): each segment subdivides into
  // a few SLIVERS so it builds in pieces, not as one chunk — every sliver a
  // FULL-CELL mask (the old bbox-snapped crops printed white squares at the
  // gaps; with nothing cropped there is nothing to print). Slivers overlap 2°
  // BACKWARD within their segment: same color over same color composites
  // invisibly, so sliver boundaries never show, mid-fade or final. The total
  // is budgeted under the ~25-overlay mask cliff (labels + center included).
  // Light / reduceMotion keep one mask per segment (composable / minimal).
  const SLIVER_OVERLAP_DEG = 2;
  const piecewise = !opts.reduceMotion && !light;
  type Arc = { segIdx: number; startDeg: number; endDeg: number; fadeStartDeg: number };
  let arcs: Arc[];
  if (piecewise) {
    const N = angles.length;
    // Sliver budget: slivers + % labels (≤N) + center (2) stay inside the
    // engine's 20-layer overlay comfort budget (the mask cliff is ~25; the
    // conventions gate records anything past 20). 2026-09-14: was 24 total.
    const budget = Math.max(N, Math.min(14, 20 - N - 2));
    const total = angles.reduce((s, a) => s + (a.endDeg - a.startDeg), 0);
    const counts = angles.map((a) => 1);
    let left = budget - N;
    // largest-arc-first proportional distribution (deterministic)
    while (left > 0) {
      let best = 0, bestGap = -1;
      for (let i = 0; i < N; i++) {
        const want = ((angles[i].endDeg - angles[i].startDeg) / total) * budget;
        const gap = want - counts[i];
        if (gap > bestGap) { bestGap = gap; best = i; }
      }
      counts[best]++; left--;
    }
    arcs = [];
    for (let i = 0; i < N; i++) {
      const a = angles[i], k = counts[i], span = (a.endDeg - a.startDeg) / k;
      for (let j = 0; j < k; j++) {
        const s = a.startDeg + j * span;
        arcs.push({ segIdx: i, startDeg: j > 0 ? Math.max(a.startDeg, s - SLIVER_OVERLAP_DEG) : s, endDeg: a.startDeg + (j + 1) * span, fadeStartDeg: s });
      }
    }
  } else {
    arcs = angles.map((a, i) => ({ segIdx: i, startDeg: a.startDeg, endDeg: a.endDeg, fadeStartDeg: a.startDeg }));
  }

  const sectorLayers: Node[] = [];
  for (const arc of arcs) {
    let rev: Record<string, unknown> | undefined;
    if (!opts.reduceMotion) {
      // Clockwise build: each piece starts when the eased sweep front reaches
      // its (un-overlapped) start angle and fades over a duration proportional
      // to its own arc — the reveal advances continuously.
      const sweepFrac = Math.max(0.01, (arc.endDeg - arc.fadeStartDeg) / 360);
      const fadeDur = Math.max(0.12, opts.introSec * sweepFrac * 1.15);
      const startAtSec = Math.max(0, (opts.introSec - fadeDur) * sweepInverseEase(opts.ease, arc.fadeStartDeg / 360));
      rev = light ? { startAtSec, enable: `gte(t,${startAtSec.toFixed(3)})` } : { startAtSec, alpha: fadeInExpr(startAtSec, fadeDur) };
    }
    // Make inline edit: the slice's FILL is `segments[i].color` → every slice
    // tile binds the color leaf (Make opens a picker) at the segment's
    // ORIGINAL index. Premium slivers of one segment all carry that index — a
    // bounded handful (≤18 total by the budget above), not an explosion. Bound
    // on the palette fallback too: the tile is the handle to ADD a color.
    sectorLayers.push(paint(bindPropPath(makeColorTile(segColor(arc.segIdx), { mask: { kind: "inline-mask", localPath: annularSectorPath({ cx, cy, rOuter, rInner, startDeg: arc.startDeg, endDeg: arc.endDeg }), bounds } as any, ...(rev ? { overlay: rev } : {}) }) as MosaicSource, "segments", [opts.srcIndices[arc.segIdx], "color"], "color")));
  }
  const labelLayers: Node[] = [];
  // Labels need a ring thick enough to host them: on a hairline ring the
  // floor-font labels render as smudges straddling the arc — drop them all.
  const ringThick = rOuter - rInner;
  if (opts.segLabels === "percent" && ringThick >= 14) {
    const segFont = Math.max(9, Math.round(ringThick * SEG_LABEL_FONT_FRAC));
    for (let i = 0; i < angles.length; i++) {
      const a = angles[i];
      if (a.endDeg - a.startDeg < SEG_LABEL_MIN_SWEEP_DEG) continue;
      const { x, y } = sectorCentroid({ cx, cy, rOuter, rInner, startDeg: a.startDeg, endDeg: a.endDeg });
      const pct = `${Math.round(a.frac * 100)}%`;
      // The % is how THIS segment's value shows on the ring → the rect edits
      // `segments[i].value` (Make seeds the raw number, the ring re-renders).
      labelLayers.push(placeAt(paint(revealText(bindPropPath(tag(cellText(pct, segFont, labelColorFor(segColor(i), theme.card, theme.title)), "seg-label"), "segments", [opts.srcIndices[i], "value"], "number"), opts.introSec * 0.6, Math.max(0.1, opts.introSec * 0.3))), textBBox(x, y, pct, segFont)));
    }
  }
  const valueText = opts.centerValue;
  const hasCaption = !!(opts.centerLabel && opts.centerLabel.trim());
  const valueFont = Math.max(10, Math.round(Math.min(holeDia * VALUE_FONT_FRAC, (holeDia * 0.72) / Math.max(1, valueText.length * 0.62))));
  // Width-capped like the value: a long caption ("Total Recognized Revenue")
  // otherwise runs across the ring.
  const captionText = opts.centerLabel ?? "";
  const captionFont = Math.max(8, Math.min(Math.round(holeDia * CAPTION_FONT_FRAC), Math.floor((holeDia * 0.8) / Math.max(1, captionText.length * 0.62))));
  const valueCy = hasCaption ? cy - rInner * 0.12 : cy;
  const animateValue = opts.countUp && !opts.reduceMotion && /\d/.test(valueText);
  // Two separate center rects, each bound to its prop (Make's double-click
  // edit). The value rect is bound even when it shows the derived sum — it is
  // the handle to ADD an explicit centerValue. Slices bind `segments[i].color`
  // and % rects `segments[i].value`; the legend's label rects bind
  // `segments[i].label` (see legendNode).
  const centerLayers: Node[] = [placeAt(paint(bindProp(tag(animateValue ? cellExprText(animateNumbersInText(valueText, { durationSec: opts.introSec, ease: opts.ease }), valueFont, theme.title) : cellText(valueText, valueFont, theme.title), "center-value"), "centerValue")), textBBox(cx, valueCy, valueText, valueFont))];
  if (hasCaption) centerLayers.push(placeAt(paint(revealText(bindProp(tag(cellText(opts.centerLabel!, captionFont, theme.subtitle), "center-label"), "centerLabel"), opts.introSec * 0.7, Math.max(0.1, opts.introSec * 0.3))), textBBox(cx, cy + rInner * 0.44, opts.centerLabel!, captionFont)));
  return overlay([...sectorLayers, ...labelLayers, ...centerLayers]);
}

// ---------------------------------------------------------------------------
// Legend (ratio splits; unchanged from v2)
// ---------------------------------------------------------------------------

function legendNode(opts: { labels: string[]; percents: string[]; srcIndices: number[]; colors: MosaicColor[]; theme: AlpineTheme; font: number; cellH: number; cellW: number }): Node {
  const { labels, percents, srcIndices, colors, theme, cellH, cellW } = opts;
  const N = labels.length;
  // PIXEL-intent rows that HUG their content, left-aligned in the cell. The
  // old proportional [1,2,1,11,5] split stretched to the FULL cell width: at
  // 1920×480 the % drifted ~600px from its label; at 720×1280 the label
  // column was too narrow for its H-scaled font and collided with the %.
  // ×1.08 + 2: the realized column runs up to ~7% under the model (the
  // [ring|legend] basis rescale × the row's q4 units compound) — an
  // exact-to-ceil column left a 10-char label 8px short at 541×743. The
  // slack must scale WITH the column, not ride as a constant.
  const need = (chars: number, f: number): number => Math.ceil(Math.max(1, chars) * 0.62 * f * 1.08) + 2;
  const longestLabel = Math.max(1, ...labels.map((l) => (l ?? "").length));
  const longestPct = Math.max(1, ...percents.map((p) => (p ?? "").length));
  // % column at 0.85em/char: digits + the wide % glyph overflow the 0.62em
  // body factor (right-aligned → the value's FIRST digit clips).
  const needPct = (chars: number, f: number): number => Math.ceil(Math.max(1, chars) * 0.85 * f);
  const rowWAt = (f: number): number => Math.round(f * 1.1) + 2 * Math.round(f * 0.55) + need(longestLabel, f) + needPct(longestPct, f);
  let font = opts.font;
  if (rowWAt(font) > cellW) font = Math.max(9, Math.floor(font * (cellW / rowWAt(font))));
  const sw = Math.round(font * 1.1), g = Math.round(font * 0.55);
  const labelW = need(longestLabel, font), pctW = needPct(longestPct, font);
  const rowW = sw + g + labelW + g + pctW;
  const rowH = Math.max(font, Math.round(font * 1.7));
  const rowGap = Math.round(font * 0.5);
  const stackH = N * (rowH + rowGap);
  const margin = Math.max(0, Math.round((cellH - stackH) / 2));
  // q4 grain (px-per-weight ≥4) — raw px weights sit at 1px/unit and die on
  // ±1px ancestor drift (the SPLIT_EXCEEDS_AXIS class).
  const q = (px: number) => Math.max(1, Math.round(px / 4));
  // One EQUAL band per row, half-gap carved INSIDE by a [1, rowU, 1] split —
  // the interleaved [margin,row,gap,row,…] px stack starved the CENTER rows
  // ±2px under drift (outside-in remainder), tripping the swatch contract.
  const rowU = Math.max(2, Math.round((2 * rowH) / Math.max(1, rowGap)));
  const rows: Node[] = [];
  for (let i = 0; i < N; i++) {
    // Centered via placement inset, NOT a [1,2,1] wrap: the wrap re-quantizes
    // each row's ±1px band drift into up to 2px of swatch-height spread (25%
    // of an ~8px swatch at small canvases). One quantizer keeps spread ≤1px.
    const swatchTile = makeColorTile(colors[i % colors.length], {
      effects: { rounding: { cornerStyle: "rounded", borderRadius: 0.4 } },
      placement: { inset: { y: 0.25 } },
    }) as MosaicSource;
    // "legend-swatch" tag = the layout contract's join key (equal-size relation).
    (swatchTile as MosaicSource & { editor?: { label?: string } }).editor = { label: "legend-swatch" };
    // The swatch's FILL is `segments[i].color` → it binds the color leaf at the
    // segment's ORIGINAL index (bound on the palette fallback too — ADD handle).
    bindPropPath(swatchTile, "segments", [srcIndices[i], "color"], "color");
    const row = colSplit([
      { weight: q(sw), node: paint(swatchTile) },
      { weight: q(g), node: EMPTY },
      // Make inline edit: the label rect binds `segments[srcIndex].label` at the
      // segment's ORIGINAL prop index (segments are sliced + filtered before
      // drawing) — bound even when empty so double-click can ADD one. The %
      // is THIS segment's value on screen → `segments[srcIndex].value`; the
      // swatch binds the color leaf above.
      { weight: q(labelW), node: paint(bindPropPath(tag(textCell(labels[i] ?? "", font, theme.label, "left", "middle"), "legend-label"), "segments", [srcIndices[i], "label"], "string")) },
      { weight: q(g), node: EMPTY },
      { weight: q(pctW), node: paint(bindPropPath(tag(textCell(percents[i] ?? "", font, theme.subtitle, "right", "middle"), "legend-pct"), "segments", [srcIndices[i], "value"], "number")) },
      ...(cellW - rowW > 4 ? [{ weight: q(cellW - rowW), node: EMPTY }] : []),
    ]);
    rows.push(rowSplit([
      { weight: 1, node: EMPTY },
      { weight: rowU, node: row },
      { weight: 1, node: EMPTY },
    ]));
  }
  const stack = rowSplit(rows.map((node) => ({ weight: 1, node })));
  const bands: Band[] = [];
  if (margin > 0) bands.push({ weight: margin, node: EMPTY });
  bands.push({ weight: stackH, node: stack });
  if (margin > 0) bands.push({ weight: margin, node: EMPTY });
  return rowSplit(bands);
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const propsSchema = definePropsSchema<AlpineDonutV3Props>({
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
      renderMode: fEnum("Render mode", ["premium", "light"], "\"premium\" (default): smooth clockwise radial SWEEP (per-sliver alpha fade) — the softest look, head/standalone use. \"light\": composable per-segment enable-gate pop — no geq, cheap when nested."),
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
  debugLayout: { type: "boolean", required: false, description: "Dev-only layout contract view: renders the contract wireframe instead of the chart — legend swatches GREEN with the measured rule when all equal-size, offenders RED when not. Deterministic false default; production never sets it.", meta: { ui: { label: "Debug layout", order: 12 } } },
});

export const AlpineDonutV3: MosaicTemplate<AlpineDonutV3Props> = {
  id: asTemplateId("@m0saic/alpine/donut/v3"),
  label: "Alpine Donut Chart",
  version: 3,
  description: "Alpine donut chart — friendly mobile-marketing card: proportional ring, center value + label, side legend. v3's premium mode does the full clockwise radial SWEEP (self-framed coarse-quantize) — smooth draw-on that still composes at any canvas; light mode stays the composable per-segment path.",
  capabilities: { tier: "core" },
  primitive: true,
  tags: ["data-viz", "alpine", "donut", "distribution", "animated", "analysts", "marketers", "dashboard", "share"],
  outputHints: { format: { kind: "video", container: "mp4" }, width: 1280, height: 800, fps: 30, durationMs: 2000 },
  propsSchema,

  defaultProps: {
    debugLayout: false,
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

  async render(props: AlpineDonutV3Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));

    // Carry each drawn segment's ORIGINAL index alongside it: the legend label
    // binds `segments[i].label` (Make's double-click edit) and must address
    // the prop VALUE's position, not the sliced / filtered draw order.
    const segmentEntries = (props.segments ?? [])
      .map((s, srcIndex) => ({ s, srcIndex }))
      .slice(0, MAX_SEGMENTS)
      .filter(({ s }) => s && Number.isFinite(s.value) && s.value > 0);
    const segments = segmentEntries.map((e) => e.s);
    if (segments.length === 0) {
      return makeErrorMosaic("segments[] must have at least one positive value", { title: `${this.id}`, width: W, height: H });
    }

    const theme = await resolveAlpineTheme(props.preset ?? DEFAULT_PRESET, ctx, props.theme);
    const anim: DonutAnim = { ...DEFAULT_ANIM, ...(props.anim ?? {}) };
    const renderMode: RenderMode = anim.renderMode ?? DEFAULT_RENDER_MODE;
    const reduceMotion = anim.reduceMotion ?? false;
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

    // Empty/whitespace ALSO derives: Make's cleared text field writes "", and
    // a silently blank hole is never what clearing the knob means.
    const centerValue = (props.centerValue ?? "").trim() || String(Math.round(total));
    // Mirrors buildRing's animateValue: true → the doc contains an expr-text
    // source (count-up center value) → text-fit checks are skipped (see the
    // contract note below).
    const hasExprText = anim.countUp && !reduceMotion && /\d/.test(centerValue);
    const shared = {
      cw: ringW, ch: cr.h, values, colors, srcIndices: segmentEntries.map((e) => e.srcIndex), thicknessFrac: props.ringThicknessFrac ?? DEFAULT_THICKNESS,
      segLabels: props.segmentLabels ?? DEFAULT_SEG_LABELS, centerValue, centerLabel: props.centerLabel,
      theme, introSec, ease: anim.easing, countUp: anim.countUp,
    };
    // BOTH modes build the seam-free per-segment ring (full-cell inline-mask
    // per segment). The old premium sliver sweep bbox-snapped each sliver to a
    // coarse grid — the snap corners printed little white squares at the
    // segment gaps, at EVERY frame including the final one. Premium = clockwise
    // staggered alpha bloom on the clean masks; light = enable-gate pops.
    const ringNode: Node = buildSegmentRing({ ...shared, reduceMotion, light: renderMode === "light" });

    const legendFont = Math.max(11, Math.round(H * 0.024));
    const content: Node = showLegend
      ? colSplit([{ weight: ringW, node: ringNode }, { weight: legendW, node: legendNode({ labels: segments.map((s) => s.label), percents, srcIndices: segmentEntries.map((e) => e.srcIndex), colors, theme, font: legendFont, cellH: cr.h, cellW: legendW }) }])
      : ringNode;

    const root = card.compose(content);

    const doc = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: root.m0 as any,
      sources: root.sources,
      backgroundColor: card.backgroundColor,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
    } as MosaicDocument;

    // Dev tripwire: every legend swatch must paint the same size (the legend
    // rows are the template's only repeated labeled geometry — the ring is
    // mask-built). Falsy debugLayout returns the doc untouched at zero cost.
    return Promise.resolve(
      withLayoutContract(doc, ctx, {
        templateId: "@m0saic/alpine/donut/v3",
        relations: showLegend && segments.length >= 2
          ? [{ label: "legend-swatch", equal: "size", tolerance: 0.02, tolerancePx: 1 }]
          : [],
        // Text-fit tripwires — GATED on the doc being expr-free: with countUp
        // the center value is an expr-text source, which shifts the contract's
        // frames↔sources zip (the kpi-card measurement-channel candidate,
        // the internal contract-frame-zip-misalignment notes) and
        // textFits would judge the wrong text against the wrong box. Static
        // docs (reduceMotion / non-numeric value) get the full checks. The
        // seg-labels stay tag-only: their placeAt boxes are 0.85em+1em sized —
        // unclippable by construction, and their count is ring-geometry-gated.
        constraints: hasExprText ? [] : [
          ...card.constraints,
          ...(showLegend ? [
            { label: "legend-label", textFits: { charWidthEm: 0.62, padPx: 0 } },
            { label: "legend-pct", textFits: { charWidthEm: 0.62, padPx: 0 } },
          ] : []),
          { label: "center-value", textFits: { charWidthEm: 0.62, padPx: 0 } },
          ...(props.centerLabel && props.centerLabel.trim() ? [{ label: "center-label", textFits: { charWidthEm: 0.62, padPx: 0 } }] : []),
        ],
        debug: props.debugLayout === true,
      }),
    );
  },

  // Editor-only first-open cover — the mosaic-branding theme. The ring is
  // PROCEDURAL MASK content, so the hero INLINES the static default chart
  // flat (gate-15 keeper: nested mosaic children bleed seams at mask edges).
  async renderCover(_props: AlpineDonutV3Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const heroBox = brandedCoverHeroBox(ctx, "band");
    const heroCtx = {
      ...ctx,
      target: { ...ctx.target, width: heroBox.width, height: heroBox.height },
      output: { ...ctx.output, width: heroBox.width, height: heroBox.height },
    } as MosaicEngineContext;
    const chart = (await AlpineDonutV3.render(
      {
        ...(AlpineDonutV3.defaultProps as AlpineDonutV3Props),
        anim: { ...DEFAULT_ANIM, renderMode: "light", reduceMotion: true },
      },
      heroCtx,
    )) as MosaicDocument;

    return buildBrandedCover({
      ctx,
      // Band variant (founder ruling 08-30): basic viz needs no
      // explanation — hero full-bleed + brand band, nothing else.
      variant: "band",
      copy: {
        productName: "Donut",
        title: "A donut chart.",
      },
      hero: (theme) => onboardingFrame(inlineHeroDoc(chart), theme.borderStrong),
      heroAssets: chart.assets,
    });
  },
};

registerTemplate(AlpineDonutV3);
