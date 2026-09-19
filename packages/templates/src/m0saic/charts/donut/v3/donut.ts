/**
 * ============================================================================
 * @m0saic/charts/donut/v3 — Canonical Donut Chart (tight-bbox masks)
 * ============================================================================
 *
 * SAME picture as v1, RIGHT cost structure. v1 painted each slice (and each
 * animation sliver) as a FULL-CANVAS color tile masked by an annular-sector
 * path — ~31 full-frame intermediates, each rasterizing a 360×360 mask just to
 * keep a thin sliver. That's the line-grid antipattern: complexity hidden in
 * full-frame masks, huge intermediates, slow renders.
 *
 * v3 places every slice/sliver as a TIGHT rect (its annular-sector bbox) via
 * `placeRects`, with the mask path authored in CELL-LOCAL coords and `bounds`
 * set to the cell — so a thin sliver paints into a thin intermediate, and the
 * geometry lives in the m0 string (real rects), not in full-frame masks. The
 * center value, caption, and per-segment labels are likewise placed in tight
 * text cells. Only genuinely full-ring shapes (a single 100% segment) occupy
 * the whole canvas — because they actually fill it.
 *
 * Animation, theme, and defaults match v1 (sandbox session
 * 2026-06-12-donut-distribution; the human's candidate-004 set the geometry).
 * ============================================================================
 */

import { asTemplateId } from "@m0saic/types";
import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicSource,
  MosaicTemplate,
  MosaicTextSource,
  MosaicThemeTokens,
} from "@m0saic/types";
import {
  animateNumbersInText,
  buildOverlayStack,
  definePropsSchema,
  fadeInExpr,
  makeColorTile,
  registerTemplate,
  resolveThemeTokens,
  type EaseName,
  type ThemeSourceConfig,
} from "@m0saic/template-utils";
import { placeRects } from "@m0saic/dsl-stdlib";
import {
  annularSectorBBox,
  annularSectorPath,
  sectorCentroid,
  segmentsToAngles,
  MAX_SEGMENTS,
  type BBox,
} from "./geometry";
import { subdivideForSweep, sweepInverseEase } from "./anim";

// ---------------------------------------------------------------------------
// Props (identical surface to v1)
// ---------------------------------------------------------------------------

type DonutSegment = { label: string; value: number; color?: MosaicColor };

type DonutAnim = {
  mode?: "sweep" | "fade";
  countUp?: boolean;
  introFrac?: number;
  introMs?: number;
  easing?: EaseName;
  reduceMotion?: boolean;
};

type DonutRenderMode = "premium" | "light";

type DonutProps = {
  segments: DonutSegment[];
  centerValue?: string;
  centerLabel?: string;
  ringThicknessFrac?: number;
  segmentLabels?: "none" | "percent";
  backgroundColor?: MosaicColor;
  anim?: DonutAnim;
  renderMode?: DonutRenderMode;
  /** Opt into a theme source (producer slug + namespace). Unset → the local
   *  palette/colors (byte-identical). See the internal theming notes. */
  theme?: ThemeSourceConfig;
};

const fBool = (label: string, description = ""): any => ({ type: "boolean", required: false, description, meta: { ui: { label } } });
const fStr = (label: string, description = "", placeholder?: string): any => ({ type: "string", required: false, description, meta: { ui: { label }, ...(placeholder ? { control: { placeholder } } : {}) } });

const propsSchema = definePropsSchema<DonutProps>({
  segments: {
    type: "array" as any,
    required: true,
    description:
      "Ring segments in clockwise order from 12 o'clock. Raw weights — normalized internally.",
    meta: {
      control: {
        flavor: "objectRows",
        columns: [
          { label: "Label", key: "label", kind: "text", placeholder: "Segment" },
          { label: "Value", key: "value", kind: "number" },
          { label: "Color", key: "color", kind: "color" },
        ],
        // Mirrors PALETTE (declared below) so new-row swatches match the
        // engine's color-omitted fallback ramp.
        palette: ["#f97316", "#fdba74", "#fb923c", "#c2410c", "#fed7aa", "#57534e"],
      },
      ui: { label: "Segments", order: 1 },
    },
  },
  centerValue: {
    type: "string",
    required: false,
    description: "Pre-formatted hole value (e.g. \"247\"). Omit to derive the segments' sum.",
    meta: { control: { placeholder: "e.g. 247" }, ui: { label: "Center value", order: 2 } },
  },
  centerLabel: {
    type: "string",
    required: false,
    description: "Small muted caption under the value (e.g. \"Total Commits\").",
    meta: { control: { placeholder: "e.g. Total Commits" }, ui: { label: "Center label", order: 3 } },
  },
  ringThicknessFrac: {
    type: "number",
    required: false,
    description: "Annulus thickness as a fraction of the outer radius (0.05–0.9).",
    meta: { constraints: { min: 0.05, max: 0.9 }, control: { flavor: "slider", step: 0.01 }, ui: { label: "Ring thickness", order: 9 } },
  },
  segmentLabels: {
    type: "string",
    required: false,
    description: "Per-segment labels on the slices. \"percent\" shows each segment's derived share; thin slices are skipped.",
    meta: { constraints: { oneOf: ["none", "percent"] }, ui: { label: "Segment labels", order: 4 } },
  },
  backgroundColor: {
    type: "string",
    required: false,
    description: "Card surface color. Pass \"none\" to render transparent when composed under a card-chrome primitive.",
    meta: { constraints: { isColor: true }, control: { placeholder: "theme surface", colorPicker: true }, ui: { label: "Card Color", order: 10 } },
  },
  renderMode: {
    type: "string",
    required: false,
    description:
      'Render strategy. "premium" (default): smooth clockwise sliver sweep via absolute placeRects — premium, heavier, head/standalone use. "light": per-segment overlay-stack revealed by enable-gated pops — composable (nests safely), cheaper, W3-safe.',
    meta: { constraints: { oneOf: ["premium", "light"] }, ui: { label: "Render mode", order: 11 } },
  },
  theme: {
    type: "group" as any,
    required: false,
    description: "Opt into a theme source. Uses the local palette by default; set a producer slug + namespace to pull shared design tokens (self-seeds when nothing is upstream).",
    meta: { ui: { label: "Theme", order: 15, collapsedByDefault: true } },
    fields: {
      slug: fStr("Producer slug", "Producer template to seed tokens from when the namespace isn't already on ctx (e.g. \"@m0saic/theming/v1\").", "preset palette (no producer)"),
      preset: fStr("Preset", "Producer preset/variant to request (e.g. light | dark | high-contrast for @m0saic/theming/v1; producer-defined).", "producer default"),
      namespace: fStr("Namespace", "Upstream alias to read tokens from. Default \"theme\".", "theme"),
      forceFetch: fBool("Force fetch", "Re-seed via the slug even if the namespace is already populated."),
    },
  } as any,
  anim: {
    type: "group" as any,
    required: false,
    description: "Intro animation: clockwise sweep (or per-segment fade), count-up total, easing, duration, reduceMotion.",
    meta: { ui: { label: "Animation", collapsedByDefault: true } },
    fields: {
      mode: { type: "string", required: false, description: "Quantized clockwise sweep, or staggered per-segment fade.", meta: { constraints: { oneOf: ["sweep", "fade"] }, ui: { label: "Mode" } } },
      countUp: { type: "boolean", required: false, description: "Count the hole value up on intro.", meta: { ui: { label: "Count up" } } },
      introFrac: { type: "number", required: false, description: "Fraction of the output duration the intro fills (the rest holds).", meta: { constraints: { min: 0.1, max: 1 }, control: { flavor: "slider", step: 0.05 }, ui: { label: "Intro length (× duration)" } } },
      introMs: { type: "number", required: false, description: "Absolute intro duration (ms). Overrides Intro length when set.", meta: { control: { placeholder: "from Intro fraction" }, constraints: { min: 0, max: 20000 }, ui: { label: "Intro (ms, override)" } } },
      easing: { type: "string", required: false, description: "Sweep + count-up easing.", meta: { constraints: { oneOf: ["easeOut", "smoothstep", "easeInOut", "linear"] }, ui: { label: "Easing" } } },
      reduceMotion: { type: "boolean", required: false, description: "Disable all motion — render the static final ring.", meta: { ui: { label: "Reduce motion" } } },
    },
  },
});

// ---------------------------------------------------------------------------
// Theme (matches v1)
// ---------------------------------------------------------------------------

const CARD_BG: MosaicColor = "#161b22";
const VALUE_COLOR: MosaicColor = "#f5f5f4";
const CAPTION_COLOR: MosaicColor = "#a8a29e";
// m0saic brand ramp — orange-forward (the M logo orange leads), warm neutral last
// for de-emphasized/error slices.
const PALETTE: MosaicColor[] = ["#f97316", "#fdba74", "#fb923c", "#c2410c", "#fed7aa", "#57534e"];

/**
 * Deterministic theme fallback built from donut's flat color constants (donut has
 * NO preset system). The keys donut READS carry the exact hexes → byte-identity
 * when un-themed; the rest are defensible locals it never reads. A producer
 * upstream (or props.theme.slug) overlays per-key. donut's first theme consumer.
 */
const LOCAL_THEME: MosaicThemeTokens = {
  surfaceApp: CARD_BG, //        ✓ card surface (donut is a standalone tile)
  surface: CARD_BG, //           ✓ backgroundColor default
  surfaceRaised: CARD_BG, //     ✗
  surfaceInset: CARD_BG, //      ✗
  border: "#30363d", //          ✗ defensible local
  borderStrong: "#30363d", //    ✗
  textPrimary: VALUE_COLOR, //   ✓ center value
  textSecondary: CAPTION_COLOR, //✓ caption
  textMuted: CAPTION_COLOR, //   ✗
  eyebrow: CAPTION_COLOR, //     ✗
  accent: PALETTE[0], //         ✓ brand (== dataPalette[0])
  accentSoft: PALETTE[0], //     ✗
  accentGlow: PALETTE[0], //     ✗
  positive: "#16a34a", //        ✗ defensible local
  negative: "#dc2626", //        ✗ defensible local
  grid: "#30363d", //            ✗
  gridAlpha: 1, //               ✗
  axis: "#30363d", //            ✗
  axisAlpha: 1, //               ✗
  radius: 0, //                  ✗
  dataPalette: PALETTE, //       ✓ segment ramp
};

const RADIUS_SCALE = 0.92;
const DEFAULT_THICKNESS_FRAC = 0.36;
const GAP_DEG = 0;
const VALUE_FONT_FRAC = 0.3;
const CAPTION_FONT_FRAC = 0.095;
const SEG_LABEL_FONT_FRAC = 0.42;
const SEG_LABEL_MIN_SWEEP_DEG = 14;
const SEG_LABEL_LIGHT: MosaicColor = "#f0f6f1";
const SEG_LABEL_DARK: MosaicColor = "#10141a";
/** Bbox pad (px) so anti-aliased edges never clip at the cell boundary. */
const EDGE_PAD = 1.5;
/**
 * Snap every placed cell OUTWARD to this px grid before authoring its mask.
 * Two wins: (1) adjacent cells land on shared grid lines → edges align → fewer
 * seams; (2) all band weights share a factor → placeRects GCD-collapses the m0
 * (≈SNAP_PX× shorter) — the build-time, mask-safe version of the editor's
 * "GCD reduce + drift" compaction (the mask is authored for the SNAPPED cell, so
 * bounds always match — no re-scale distortion).
 */
const SNAP_PX = 4;
/**
 * Tight per-sliver cells quantize independently, so abutting edges can leave a
 * sub-pixel hairline (v1's full-frame masks shared one coordinate space and
 * never did). Two overlaps cover every seam:
 *  - WITHIN a segment: generous same-color overlap on BOTH sides (invisible).
 *  - ACROSS a segment boundary: a tiny overlap so the later-painted segment
 *    covers the seam with ~1px of its own color (no dark-card gap; the boundary
 *    shifts a sub-pixel, imperceptible).
 */
const SLIVER_OVERLAP_DEG = 2.5;
const SLIVER_CROSS_DEG = 0.75;

// ---------------------------------------------------------------------------
// Tight-cell placement
// ---------------------------------------------------------------------------

type Rect = { x: number; y: number; w: number; h: number; claimant: string; importance?: number };
type Piece = { rect: Rect; source: MosaicSource };

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

/**
 * Snap a bbox OUTWARD to integer px (clamped to the canvas) and build a source
 * sized to that cell. `makeSource(cellW, cellH, ox, oy)` gets the cell px size +
 * its absolute origin (so masks/text can be authored in cell-local coords).
 */
function placePiece(
  W: number,
  H: number,
  bbox: BBox,
  makeSource: (cellW: number, cellH: number, ox: number, oy: number) => MosaicSource,
): Piece {
  const snapDown = (v: number) => Math.floor((v - EDGE_PAD) / SNAP_PX) * SNAP_PX;
  const snapUp = (v: number) => Math.ceil((v + EDGE_PAD) / SNAP_PX) * SNAP_PX;
  const x = clampInt(snapDown(bbox.minX), 0, W - 1);
  const y = clampInt(snapDown(bbox.minY), 0, H - 1);
  const x2 = clampInt(snapUp(bbox.maxX), x + SNAP_PX, W);
  const y2 = clampInt(snapUp(bbox.maxY), y + SNAP_PX, H);
  const w = x2 - x;
  const h = y2 - y;
  return { rect: { x, y, w, h, claimant: "F" }, source: makeSource(w, h, x, y) };
}

// ---------------------------------------------------------------------------
// Text helpers — centered within their cell (no full-frame xExpr positioning)
// ---------------------------------------------------------------------------

function cellText(text: string, fontSize: number, color: MosaicColor): MosaicTextSource {
  return {
    type: "text",
    visual: { backgroundColor: "black@0" },
    layers: [
      {
        content: { kind: "literal", text: text || " " },
        style: { fontSize, fontColor: color },
        placement: { hAlign: "center", vAlign: "middle" } as any,
      },
    ],
  };
}

function cellExprText(expr: string, fontSize: number, color: MosaicColor): MosaicTextSource {
  return {
    type: "text",
    renderMode: { kind: "video" },
    visual: { backgroundColor: "black@0" },
    layers: [
      {
        content: { kind: "expr", expr, eval: "frame" },
        style: { fontSize, fontColor: color },
        placement: { hAlign: "center", vAlign: "middle" } as any,
      },
    ],
  };
}

function fadeIn<T extends MosaicSource>(src: T, startSec: number, durSec: number, on: boolean): T {
  if (!on) return src;
  const prev = (src as { overlay?: Record<string, unknown> }).overlay ?? {};
  return { ...src, overlay: { ...prev, alpha: fadeInExpr(startSec, durSec) } } as T;
}

/**
 * Estimate a centered text bbox around a point. Generous on purpose: glyphs like
 * `%` run ~1em wide, and the cell clips (it doesn't scale) — a too-tight cell eats
 * the label (a 2-char "8%" has no headroom the way a wider "64%" does). Pad both
 * axes well; the cell is empty space, so over-sizing costs nothing.
 */
function textBBox(cxp: number, cyp: number, text: string, font: number): BBox {
  const w = Math.max(font, text.length * font * 0.85 + font);
  const h = font * 1.6;
  return { minX: cxp - w / 2, minY: cyp - h / 2, maxX: cxp + w / 2, maxY: cyp + h / 2 };
}

function labelColorFor(hex: MosaicColor): MosaicColor {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex));
  if (!m) return SEG_LABEL_LIGHT;
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? SEG_LABEL_DARK : SEG_LABEL_LIGHT;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export const DonutV3: MosaicTemplate<DonutProps> = {
  id: asTemplateId("@m0saic/charts/donut/v3"),
  label: "Donut Chart",
  version: 3,
  description:
    "Canonical donut chart: proportional ring + center total, each slice placed as a tight bbox (cell-local masks) so thin slivers don't rasterize full-frame. Building block of the repo-tracker hero.",
  capabilities: { tier: "core" },
  primitive: true,
  deprecated: {
    reason:
      "The premium sliver sweep packs each sliver's tight bbox via placeRects on the full canvas — right raster cost + under the ~25-mask cliff, but the sliver edges (radius·cos θ) are coprime pixels so precision tracks the canvas (audit: ABSOLUTE, slope 1.04). Use v4 — the SAME sweep + tight rasters, plus a 'self-framed coarse-quantize': build the ring in a P-divisible S×S frame and snap each (origin-relative) mask bbox to P, so placeRects GCD-collapses to a bounded basis on ANY canvas, then letterbox into W×H. Composes at any size. (v3's 'light' mode was already ratio; v4 keeps it.)",
    replacement: asTemplateId("@m0saic/charts/donut/v4"),
    since: "2026-07-09",
  },
  tags: ["charts", "donut", "distribution", "data-viz"],
  aspectRatio: { ideal: 1.0, min: 0.6, max: 1.8, mode: "warn" },
  outputHints: { width: 360, height: 360, fps: 30, durationMs: 2000, note: "Square ring tile; the hero places it inside the panel's donut region" },
  propsSchema,

  defaultProps: {
    renderMode: "premium",
    theme: { forceFetch: false },
    // Mock m0saic diagnostic: render-cache breakdown. Orange brand ramp + a warm
    // neutral for the small "failed" slice; percent labels on the slices.
    segments: [
      { label: "Cache hits", value: 44, color: "#f97316" },
      { label: "Re-rendered", value: 28, color: "#fdba74" },
      { label: "Failed", value: 28, color: "#57534e" },
    ],
    centerValue: "1284",
    centerLabel: "m0saic renders",
    segmentLabels: "percent",
    // Surface the renderer's code-default so the Make slider shows the value
    // that's actually rendered (omitting it left the slider at its 0.05 min).
    ringThicknessFrac: DEFAULT_THICKNESS_FRAC,
    // backgroundColor intentionally unset → resolves to theme.surface (== CARD_BG
    // un-themed, byte-identical) so a producer can re-skin the card. "none" wins.
    anim: { mode: "sweep", countUp: true, introFrac: 0.7, easing: "easeOut", reduceMotion: false },
  },

  async render(props: DonutProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = ctx.output.width;
    const H = ctx.output.height;

    // ── Fail-fast validation ──
    if (!Array.isArray(props.segments) || props.segments.length === 0) {
      throw new Error("@m0saic/charts/donut/v3: segments must be a non-empty array");
    }
    if (props.segments.length > MAX_SEGMENTS) {
      throw new Error(`@m0saic/charts/donut/v3: at most ${MAX_SEGMENTS} segments`);
    }
    const thickness = props.ringThicknessFrac ?? DEFAULT_THICKNESS_FRAC;
    if (!Number.isFinite(thickness) || thickness < 0.05 || thickness > 0.9) {
      throw new Error(`@m0saic/charts/donut/v3: ringThicknessFrac must be in [0.05, 0.9], got ${thickness}`);
    }

    // ── Theme (donut's first consumer; flat-constant LOCAL_THEME fallback) ──
    // Un-themed → the local palette/colors (byte-identical); a producer upstream
    // (or props.theme.slug) overlays per-key. Applies to BOTH renderMode paths.
    const theme = await resolveThemeTokens(LOCAL_THEME, ctx, props.theme);

    // ── Ring geometry ──
    const cx = W / 2;
    const cy = H / 2;
    const rOuter = (Math.min(W, H) / 2) * RADIUS_SCALE;
    const rInner = rOuter * (1 - thickness);
    const holeDia = 2 * rInner;

    const angles = segmentsToAngles(props.segments.map((s) => s.value), { gapDeg: GAP_DEG });

    // ── Intro timing ──
    const anim = props.anim ?? {};
    const reduceMotion = anim.reduceMotion ?? false;
    const mode = anim.mode ?? "sweep";
    const ease: EaseName = anim.easing ?? "easeOut";
    const totalSec = ctx.target.durationMs / 1000;
    const introSec = anim.introMs != null ? anim.introMs / 1000 : totalSec * (anim.introFrac ?? 0.7);
    const animateRing = !reduceMotion && introSec > 0;

    // Explicit segment color wins; else the theme's categorical ramp (== PALETTE
    // un-themed → byte-identical; a producer's dataPalette re-skins uncolored segs).
    const segColor = (i: number): MosaicColor => props.segments[i].color ?? theme.dataPalette[i % theme.dataPalette.length];

    // ── LIGHT mode: composable per-segment overlay stack (staggered fade) ──
    // Full-canvas masked tiles (one arc per segment) stacked via buildOverlayStack
    // → trivial RATIO m0 (composes/nests cleanly) + ≤MAX_SEGMENTS masked overlays
    // (under the W3 ~25 inline-mask-drop cliff), revealed by a slight staggered
    // `overlay.alpha` fade (alpine's premium look, clockwise via sweepInverseEase).
    // Positions are proportional overlay offsets (`W*frac`) so every layer is
    // resolution-independent. (The smooth sliver sweep is `renderMode:"premium"`.)
    if ((props.renderMode ?? "premium") === "light") {
      // Premium staggered reveal: a slight per-SEGMENT alpha fade (alpine/donut's
      // look — NOT a hard pop), clockwise via sweepInverseEase. ≤MAX_SEGMENTS
      // tiles → the geq is bounded (not the 37-sliver problem) and the chain stays
      // shallow (W3-safe). reduceMotion → no fade (static ring).
      const fadeDur = animateRing ? Math.max(0.1, introSec * 0.32) : 0;
      const fadeAt = (startSec: number, durSec: number): Record<string, unknown> =>
        animateRing ? { alpha: fadeInExpr(startSec, durSec) } : {};
      const withOverlay = <T extends MosaicSource>(src: T, overlay?: Record<string, unknown>): T =>
        overlay && Object.keys(overlay).length
          ? ({ ...src, overlay: { ...(src as { overlay?: Record<string, unknown> }).overlay, ...overlay } } as T)
          : src;
      // Center a full-canvas layer's content at (fracX, fracY) of the cell.
      const centerAt = (fracX: number, fracY: number): Record<string, unknown> => ({
        xExpr: `(W*${fracX.toFixed(5)})-(W/2)`,
        yExpr: `(H*${fracY.toFixed(5)})-(H/2)`,
      });

      const layers: MosaicSource[] = [];

      // Segments (bottom → top, clockwise) — each a full-canvas masked tile.
      // Full-canvas masked tile per segment (mask in canvas coords → perfect seams,
      // composable). The reveal is a slight per-segment alpha fade, staggered
      // clockwise via sweepInverseEase (alpine's premium look).
      for (let i = 0; i < angles.length; i++) {
        const a = angles[i];
        if (a.endDeg - a.startDeg <= 0.0001) continue;
        const path = annularSectorPath({ cx, cy, rOuter, rInner, startDeg: a.startDeg, endDeg: a.endDeg });
        const seg = makeColorTile(segColor(i), {
          mask: { kind: "inline-mask", localPath: path, bounds: { x: 0, y: 0, width: W, height: H } },
        });
        const startAtSec = animateRing ? Math.max(0, (introSec - fadeDur) * sweepInverseEase(ease, a.startDeg / 360)) : 0;
        layers.push(withOverlay(seg, animateRing ? { startAtSec, ...fadeAt(startAtSec, fadeDur) } : undefined));
      }

      // Per-segment % labels — centered at the sector centroid via proportional offset.
      if ((props.segmentLabels ?? "none") === "percent") {
        const ringPx = rOuter - rInner;
        const segFont = Math.max(9, Math.round(ringPx * SEG_LABEL_FONT_FRAC));
        for (let i = 0; i < angles.length; i++) {
          const a = angles[i];
          if (a.endDeg - a.startDeg < SEG_LABEL_MIN_SWEEP_DEG) continue;
          const { x, y } = sectorCentroid({ cx, cy, rOuter, rInner, startDeg: a.startDeg, endDeg: a.endDeg });
          const pct = `${Math.round(a.frac * 100)}%`;
          const overlay = { ...centerAt(x / W, y / H), ...fadeAt(introSec * 0.6, Math.max(0.1, introSec * 0.3)) };
          layers.push(withOverlay(cellText(pct, segFont, labelColorFor(segColor(i))), overlay));
        }
      }

      // Center value (+ optional caption) in the hole.
      const valueTextL = props.centerValue ?? String(Math.round(props.segments.reduce((s, x) => s + x.value, 0)));
      const valueFontL = Math.max(12, Math.round(holeDia * VALUE_FONT_FRAC));
      const hasCaptionL = !!(props.centerLabel && props.centerLabel.trim() !== "");
      const captionLenL = Math.max(1, (props.centerLabel ?? "").trim().length);
      const captionFontL = Math.max(9, Math.round(Math.min(holeDia * CAPTION_FONT_FRAC, (holeDia * 0.92) / (0.55 * captionLenL))));
      const valueCyL = hasCaptionL ? cy - rInner * 0.12 : cy;
      const animateValueL = (anim.countUp ?? true) && !reduceMotion && /\d/.test(valueTextL);
      const valueSrc = animateValueL
        ? cellExprText(animateNumbersInText(valueTextL, { durationSec: introSec, ease }), valueFontL, theme.textPrimary)
        : cellText(valueTextL, valueFontL, theme.textPrimary);
      layers.push(withOverlay(valueSrc, hasCaptionL ? centerAt(0.5, valueCyL / H) : undefined));
      if (hasCaptionL) {
        const capOverlay = { ...centerAt(0.5, (cy + rInner * 0.44) / H), ...fadeAt(introSec * 0.7, Math.max(0.1, introSec * 0.3)) };
        layers.push(withOverlay(cellText(props.centerLabel!, captionFontL, theme.textSecondary), capOverlay));
      }

      return Promise.resolve({
        kind: "mosaic_document",
        version: 1,
        assets: {} as any,
        m0: String(buildOverlayStack(Math.max(1, layers.length))) as any,
        sources: layers.length ? layers : [makeColorTile("black@0")],
        backgroundColor: props.backgroundColor ?? theme.surface,
        fps: ctx.target.fps,
        durationMs: ctx.target.durationMs,
      } as MosaicDocument);
    }

    // Place one annular sector as a tight cell with a cell-local mask.
    const sectorPiece = (
      segIndex: number,
      startDeg: number,
      endDeg: number,
      overlay?: { startAtSec: number; alpha: string },
    ): Piece =>
      placePiece(W, H, annularSectorBBox({ cx, cy, rOuter, rInner, startDeg, endDeg }), (cw, ch, ox, oy) =>
        makeColorTile(segColor(segIndex), {
          mask: {
            kind: "inline-mask",
            localPath: annularSectorPath({ cx: cx - ox, cy: cy - oy, rOuter, rInner, startDeg, endDeg }),
            bounds: { x: 0, y: 0, width: cw, height: ch },
          },
          ...(overlay ? { overlay } : {}),
        }),
      );

    // ── Sector pieces (bottom of the stack), paint order = clockwise ──
    const sectorPieces: Piece[] = [];
    if (animateRing && mode === "sweep") {
      const slivers = subdivideForSweep(angles);
      const fadeDur = Math.max(0.05, (introSec / Math.max(1, slivers.length)) * 2.5);
      for (const s of slivers) {
        const seg = angles[s.segIndex];
        // Overlap both sides: generously within the segment (same color), a hair
        // across the boundary (later segment covers the seam with its own color).
        const start = Math.max(seg.startDeg - SLIVER_CROSS_DEG, s.startDeg - SLIVER_OVERLAP_DEG);
        const end = Math.min(seg.endDeg + SLIVER_CROSS_DEG, s.endDeg + SLIVER_OVERLAP_DEG);
        const startAtSec = introSec * sweepInverseEase(ease, s.frac0);
        sectorPieces.push(sectorPiece(s.segIndex, start, end, { startAtSec, alpha: fadeInExpr(startAtSec, fadeDur) }));
      }
    } else if (animateRing && mode === "fade") {
      const fadeDur = introSec * 0.45;
      for (let i = 0; i < angles.length; i++) {
        const a = angles[i];
        if (a.endDeg - a.startDeg <= 0.0001) continue;
        const startAtSec = introSec * 0.5 * (a.startDeg / 360);
        sectorPieces.push(sectorPiece(i, a.startDeg, a.endDeg, { startAtSec, alpha: fadeInExpr(startAtSec, fadeDur) }));
      }
    } else {
      for (let i = 0; i < angles.length; i++) {
        const a = angles[i];
        if (a.endDeg - a.startDeg <= 0.0001) continue;
        sectorPieces.push(sectorPiece(i, a.startDeg, a.endDeg));
      }
    }

    // ── Per-segment labels (middle of the stack) ──
    const labelPieces: Piece[] = [];
    if ((props.segmentLabels ?? "none") === "percent") {
      const ringPx = rOuter - rInner;
      const segFont = Math.max(9, Math.round(ringPx * SEG_LABEL_FONT_FRAC));
      for (let i = 0; i < angles.length; i++) {
        const a = angles[i];
        if (a.endDeg - a.startDeg < SEG_LABEL_MIN_SWEEP_DEG) continue;
        const { x, y } = sectorCentroid({ cx, cy, rOuter, rInner, startDeg: a.startDeg, endDeg: a.endDeg });
        const pct = `${Math.round(a.frac * 100)}%`;
        const color = labelColorFor(segColor(i));
        const piece = placePiece(W, H, textBBox(x, y, pct, segFont), () => cellText(pct, segFont, color));
        if (animateRing) {
          const revealAt =
            mode === "sweep"
              ? introSec * sweepInverseEase(ease, a.endDeg / 360)
              : introSec * 0.5 * (a.startDeg / 360) + introSec * 0.45;
          piece.source = fadeIn(piece.source, revealAt, introSec * 0.15, true);
        }
        labelPieces.push(piece);
      }
    }

    // ── Center value (+ optional caption) in the hole (top of the stack) ──
    const valueText = props.centerValue ?? String(Math.round(props.segments.reduce((s, x) => s + x.value, 0)));
    const valueFont = Math.max(12, Math.round(holeDia * VALUE_FONT_FRAC));
    const captionLen = Math.max(1, (props.centerLabel ?? "").trim().length);
    const captionFont = Math.max(9, Math.round(Math.min(holeDia * CAPTION_FONT_FRAC, (holeDia * 0.92) / (0.55 * captionLen))));
    const hasCaption = !!(props.centerLabel && props.centerLabel.trim() !== "");
    const valueCy = hasCaption ? cy - rInner * 0.12 : cy;
    const captionCy = cy + rInner * 0.44;

    const animateValue = (anim.countUp ?? true) && !reduceMotion && /\d/.test(valueText);
    const textPieces: Piece[] = [];
    textPieces.push(
      placePiece(W, H, textBBox(cx, valueCy, valueText, valueFont), () =>
        animateValue
          ? cellExprText(animateNumbersInText(valueText, { durationSec: introSec, ease }), valueFont, theme.textPrimary)
          : cellText(valueText, valueFont, theme.textPrimary),
      ),
    );
    if (hasCaption) {
      const cap = placePiece(W, H, textBBox(cx, captionCy, props.centerLabel!, captionFont), () =>
        cellText(props.centerLabel!, captionFont, theme.textSecondary),
      );
      cap.source = fadeIn(cap.source, introSec * 0.8, introSec * 0.2, !reduceMotion);
      textPieces.push(cap);
    }

    // ── Place everything in one call: sectors at importance 0 (base), labels +
    // center text at importance 1 so they ALWAYS paint above every sector.
    // placeRects guarantees the more-important rects land on top — without it the
    // greedy packer could drop a %-label onto a layer below an overlapping
    // segment (the third label vanished in reduceMotion, where fewer pieces
    // shared layers). ──
    for (const p of labelPieces) p.rect.importance = 1;
    for (const p of textPieces) p.rect.importance = 1;
    const pieces: Piece[] = [...sectorPieces, ...labelPieces, ...textPieces];
    const placed = placeRects({ rootW: W, rootH: H, rects: pieces.map((p) => p.rect) });

    // Source order must match the composed m0's emission: per layer (base→top),
    // frames in (y, x) order within the layer.
    const sources: MosaicSource[] = [];
    for (const layer of placed.layers) {
      const ordered = [...layer.rectIndices].sort(
        (a, b) => pieces[a].rect.y - pieces[b].rect.y || pieces[a].rect.x - pieces[b].rect.x,
      );
      for (const idx of ordered) sources.push(pieces[idx].source);
    }

    return Promise.resolve({
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: String(placed.m0) as any,
      sources,
      backgroundColor: props.backgroundColor ?? theme.surface,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
    } as MosaicDocument);
  },
};

registerTemplate(DonutV3);
