/**
 * ============================================================================
 * @m0saic/charts/donut/v4 — Canonical Donut Chart (RATIO, self-framed quantize)
 * ============================================================================
 *
 * SAME picture as v3, but the `premium` smooth-sliver sweep is now RATIO instead
 * of absolute. v3 packed each sliver's tight bbox via `placeRects` on the full
 * canvas — the right raster cost (tight intermediates) and under the ~25-mask
 * overlay cliff (layer-packing), but its precision tracked the canvas because
 * the sliver edges (radius·cos θ) are coprime pixels (audit: ABSOLUTE, slope
 * 1.04).
 *
 * v4 keeps the exact same sweep + tight rasters + layer-packing, and adds ONE
 * move — the "self-framed coarse-quantize":
 *   1. Build the ring in its OWN square frame `S×S`, where `S` is snapped to a
 *      multiple of a canvas-proportional coarse pitch `P = round(min(W,H)/K)`.
 *   2. Snap each sliver/label/text bbox OUTWARD to `P`. Because the sector masks
 *      are authored relative to their own cell origin, snapping the bbox leaves
 *      the arc PIXEL-PERFECT — only the invisible bbox moves.
 *   3. `placeRects` on the `S×S` frame. Since `S` is `P`-divisible, EVERY band —
 *      including the trailing margins — is a multiple of `P`, so the split basis
 *      GCD-collapses to `S/P = K` (constant across every canvas, even coprime
 *      dims). Bounded precision → RATIO.
 *   4. Letterbox the `S×S` frame into `W×H` with basis-capped ratio splits.
 *
 * (The whole-canvas version of this fails — when `P` doesn't divide `W`/`H` the
 * trailing margin breaks the gcd; a self-contained `P`-divisible frame is what
 * makes it hold on any canvas.) `renderMode:"light"` is unchanged (already the
 * composable per-segment ratio path).
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
  withLayoutContract,
  resolveDocFrames,
  textEmUnits,
  fitEmUnits,
  tag,
  bindProp,
  bindPropPath,
  type EaseName,
  type ThemeSourceConfig,
  latticeWeights,
  divisors,
  isSmooth,
  ceilToSmooth,
} from "@m0saic/template-utils";
import { placeRects, weightedSplit } from "@m0saic/dsl-stdlib";
import {
  annularSectorBBox,
  annularSectorPath,
  sectorCentroid,
  segmentsToAngles,
  MAX_SEGMENTS,
  type BBox,
} from "../v3/geometry";
import { subdivideForSweep, sweepInverseEase } from "../v3/anim";
import {
  buildBrandedCover,
  brandedCoverHeroBox,
  inlineHeroDoc,
  onboardingFrame,
} from "../../../_shared/onboarding-cover";

// ---------------------------------------------------------------------------
// Props (identical surface to v3)
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
  debugLayout?: boolean;
  /** Opt into a theme source (producer slug + namespace). Unset → the local
   *  palette/colors (byte-identical). */
  theme?: ThemeSourceConfig;
};

const fBool = (label: string, description = ""): any => ({ type: "boolean", required: false, description, meta: { ui: { label } } });
const fStr = (label: string, description = "", placeholder?: string): any => ({ type: "string", required: false, description, meta: { ui: { label }, ...(placeholder ? { control: { placeholder } } : {}) } });

const propsSchema = definePropsSchema<DonutProps>({
  segments: {
    type: "array" as any,
    required: true,
    description: "Ring segments in clockwise order from 12 o'clock. Raw weights — normalized internally.",
    meta: {
      control: {
        flavor: "objectRows",
        columns: [
          { label: "Label", key: "label", kind: "text", placeholder: "Segment" },
          { label: "Value", key: "value", kind: "number" },
          { label: "Color", key: "color", kind: "color" },
        ],
        palette: ["#f97316", "#fdba74", "#fb923c", "#c2410c", "#fed7aa", "#57534e"],
      },
      ui: { label: "Segments", order: 1 },
    },
  },
  centerValue: { type: "string", required: false, description: "Pre-formatted hole value (e.g. \"247\"). Omit to derive the segments' sum.", meta: { control: { placeholder: "e.g. 247" }, ui: { label: "Center value", order: 2 } } },
  centerLabel: { type: "string", required: false, description: "Small muted caption under the value (e.g. \"Total Commits\").", meta: { control: { placeholder: "e.g. Total Commits" }, ui: { label: "Center label", order: 3 } } },
  ringThicknessFrac: { type: "number", required: false, description: "Annulus thickness as a fraction of the outer radius (0.05–0.9).", meta: { constraints: { min: 0.05, max: 0.9 }, control: { flavor: "slider", step: 0.01 }, ui: { label: "Ring thickness", order: 9 } } },
  segmentLabels: { type: "string", required: false, description: "Per-segment labels on the slices. \"percent\" shows each segment's derived share; thin slices are skipped.", meta: { constraints: { oneOf: ["none", "percent"] }, ui: { label: "Segment labels", order: 4 } } },
  backgroundColor: { type: "string", required: false, description: "Card surface color. Pass \"none\" to render transparent when composed under a card-chrome primitive.", meta: { constraints: { isColor: true }, control: { placeholder: "theme surface", colorPicker: true }, ui: { label: "Card Color", order: 10 } } },
  renderMode: {
    type: "string", required: false,
    description: 'Render strategy. "premium" (default): smooth clockwise sliver sweep — now RATIO via a self-framed coarse-quantize (composes at any canvas). "light": per-segment overlay-stack revealed by enable-gated pops — composable, cheaper, W3-safe.',
    meta: { constraints: { oneOf: ["premium", "light"] }, ui: { label: "Render mode", order: 11 } },
  },
  debugLayout: { type: "boolean", required: false, description: "Dev-only: draw the layout contract (center value/caption + segment labels fit their cells) instead of the chart.", meta: { ui: { label: "Debug layout", order: 12 } } },
  theme: {
    type: "group" as any, required: false,
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
    type: "group" as any, required: false,
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
// Theme (matches v3)
// ---------------------------------------------------------------------------

const CARD_BG: MosaicColor = "#161b22";
const VALUE_COLOR: MosaicColor = "#f5f5f4";
const CAPTION_COLOR: MosaicColor = "#a8a29e";
const PALETTE: MosaicColor[] = ["#f97316", "#fdba74", "#fb923c", "#c2410c", "#fed7aa", "#57534e"];

const LOCAL_THEME: MosaicThemeTokens = {
  surfaceApp: CARD_BG, surface: CARD_BG, surfaceRaised: CARD_BG, surfaceInset: CARD_BG,
  border: "#30363d", borderStrong: "#30363d", textPrimary: VALUE_COLOR, textSecondary: CAPTION_COLOR,
  textMuted: CAPTION_COLOR, eyebrow: CAPTION_COLOR, accent: PALETTE[0], accentSoft: PALETTE[0], accentGlow: PALETTE[0],
  positive: "#16a34a", negative: "#dc2626", grid: "#30363d", gridAlpha: 1, axis: "#30363d", axisAlpha: 1, radius: 0, dataPalette: PALETTE,
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
const EDGE_PAD = 1.5;
const SLIVER_OVERLAP_DEG = 2.5;
const SLIVER_CROSS_DEG = 0.75;
/** Coarse-grid divisions of the ring frame → bounded precision ~this (constant
 *  across every canvas → RATIO). Pitch `P = round(min(W,H)/K)`. The catch: `P`
 *  is ALSO the per-sliver bbox snap, so too-coarse a `P` steps the abutting
 *  slivers' outer arcs into hairline seams (K=48 → ~13px @600 → visible notches).
 *  The overlap-to-`P` coverage ratio is canvas-independent (both scale with the
 *  radius), so `K` alone sets seam-freeness: 96 keeps `P` fine (~6px @600 — like
 *  v3's 4px) → seamless, while precision stays bounded ~100 (still ratio). */
const SWEEP_DIVISIONS = 96;

// ---------------------------------------------------------------------------
// Tight-cell placement (snap pitch is a PARAMETER now — v4's coarse P)
// ---------------------------------------------------------------------------

type Rect = { x: number; y: number; w: number; h: number; claimant: string; importance?: number };
type Piece = { rect: Rect; source: MosaicSource };

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

/** Snap a bbox OUTWARD to the `snap` px grid (clamped to the frame) and build a
 *  source sized to that cell. `makeSource(cellW, cellH, ox, oy)` authors masks/text
 *  in cell-local coords, so snapping the cell never moves the drawn shape. */
function placePiece(
  frameW: number, frameH: number, snap: number, bbox: BBox,
  makeSource: (cellW: number, cellH: number, ox: number, oy: number) => MosaicSource,
): Piece {
  const snapDown = (v: number) => Math.floor((v - EDGE_PAD) / snap) * snap;
  const snapUp = (v: number) => Math.ceil((v + EDGE_PAD) / snap) * snap;
  const x = clampInt(snapDown(bbox.minX), 0, frameW - 1);
  const y = clampInt(snapDown(bbox.minY), 0, frameH - 1);
  const x2 = clampInt(snapUp(bbox.maxX), x + snap, frameW);
  const y2 = clampInt(snapUp(bbox.maxY), y + snap, frameH);
  return { rect: { x, y, w: x2 - x, h: y2 - y, claimant: "F" }, source: makeSource(x2 - x, y2 - y, x, y) };
}

/** Center an `S×S` frame's m0 in `W×H` with basis-capped ratio splits (so the
 *  letterbox itself never pins precision). The cap is applied by
 *  `latticeWeights` — Hamilton to EXACTLY 100 (2²·5², on the 5-smooth lattice),
 *  symmetric margins kept; rounding each margin on its own summed to 101. */
function letterbox(innerM0: string, S: number, W: number, H: number): string {
  const cap = (weights: number[]): number[] => latticeWeights(weights, { cap: 100 });
  const mX = Math.max(0, (W - S) / 2);
  const mY = Math.max(0, (H - S) / 2);
  let m0 = innerM0;
  if (mX >= 1) m0 = String(weightedSplit(cap([mX, S, mX]), "col", { claimants: ["-", m0, "-"] }));
  if (mY >= 1) m0 = String(weightedSplit(cap([mY, S, mY]), "row", { claimants: ["-", m0, "-"] }));
  return m0;
}

/**
 * The self-frame's pitch and side. `P` is a DIVISOR of the region side nearest
 * `side / K` (so the frame IS the region and its `S / P` divisions are a divisor
 * of the side — 5-smooth on every 5-smooth canvas: 1080 → P = 12, 90 divisions);
 * `round(side / K)` then `ceil` landed 1080 on P = 11, 99 divisions (3²·11) and
 * a frame 9 px taller than its region. On a rough side with no usable divisor
 * the divisions are rounded UP to the next 5-smooth count instead (the frame
 * then overshoots the region by < one pitch, as before).
 */
function selfFrame(regionSide: number): { P: number; S: number } {
  const ideal = regionSide / SWEEP_DIVISIONS;
  let best: { P: number; err: number } | null = null;
  for (const d of divisors(regionSide)) {
    const divisions = regionSide / d;
    if (d < 4 || divisions > 200 || !isSmooth(divisions)) continue;
    const err = Math.abs(Math.log(d / ideal));
    if (!best || err < best.err) best = { P: d, err };
  }
  if (best && best.err <= Math.log(1.5)) return { P: best.P, S: regionSide };
  const P = Math.max(4, Math.round(ideal));
  return { P, S: ceilToSmooth(Math.ceil(regionSide / P)) * P };
}

// ---------------------------------------------------------------------------
// Text helpers — centered within their cell
// ---------------------------------------------------------------------------

function cellText(text: string, fontSize: number, color: MosaicColor): MosaicTextSource {
  return { type: "text", visual: { backgroundColor: "black@0" }, layers: [{ content: { kind: "literal", text: text || " " }, style: { fontSize, fontColor: color }, placement: { hAlign: "center", vAlign: "middle" } as any }] };
}
function cellExprText(expr: string, fontSize: number, color: MosaicColor): MosaicTextSource {
  return { type: "text", renderMode: { kind: "video" }, visual: { backgroundColor: "black@0" }, layers: [{ content: { kind: "expr", expr, eval: "frame" }, style: { fontSize, fontColor: color }, placement: { hAlign: "center", vAlign: "middle" } as any }] };
}
function fadeIn<T extends MosaicSource>(src: T, startSec: number, durSec: number, on: boolean): T {
  if (!on) return src;
  const prev = (src as { overlay?: Record<string, unknown> }).overlay ?? {};
  return { ...src, overlay: { ...prev, alpha: fadeInExpr(startSec, durSec) } } as T;
}
function textBBox(cxp: number, cyp: number, text: string, font: number): BBox {
  // Script-aware (textEmUnits): flat .length under-measured Cyrillic/CJK
  // center strings ~1.5× (ASCII → identical boxes).
  const w = Math.max(font, textEmUnits(text) * font * 0.85 + font);
  const h = font * 1.6;
  return { minX: cxp - w / 2, minY: cyp - h / 2, maxX: cxp + w / 2, maxY: cyp + h / 2 };
}
/** Center value/caption font, WIDTH-CAPPED to the hole (the alpine/donut/v3
 *  cap, backported — v4 predated it: a 10-char centerValue at holeDia·0.3
 *  overflowed the ring ~2×). Script-aware. */
function holeCappedFont(base: number, min: number, text: string, holeDia: number, widthFrac: number): number {
  return Math.max(min, Math.round(Math.min(base, (holeDia * widthFrac) / (Math.max(1, textEmUnits(text)) * 0.62))));
}
/** Fit-first last resort: when the min-font floor binds, the string is still
 *  wider than the hole — ellipsize to the units that fit (never clip/spill). */
function fitToHole(text: string, font: number, holeDia: number, widthFrac: number): string {
  const maxUnits = (holeDia * widthFrac) / (0.62 * font);
  // Half-unit tolerance: font round-up vs unit floor-down otherwise shaves the
  // last char of a string the cap sized to fit EXACTLY.
  if (textEmUnits(text) <= maxUnits + 0.5) return text;
  return fitEmUnits(text, Math.max(1, Math.floor(maxUnits)));
}
function labelColorFor(hex: MosaicColor): MosaicColor {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex));
  if (!m) return SEG_LABEL_LIGHT;
  const v = parseInt(m[1], 16);
  const lum = (0.2126 * ((v >> 16) & 0xff) + 0.7152 * ((v >> 8) & 0xff) + 0.0722 * (v & 0xff)) / 255;
  return lum > 0.6 ? SEG_LABEL_DARK : SEG_LABEL_LIGHT;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export const DonutV4: MosaicTemplate<DonutProps> = {
  id: asTemplateId("@m0saic/charts/donut/v4"),
  label: "Donut Chart",
  version: 4,
  description:
    "Canonical donut chart: proportional ring + center total. v4 makes the premium sliver sweep RATIO via a self-framed coarse-quantize (a P-divisible S×S frame lets placeRects GCD-collapse on any canvas), so it composes at any size while keeping the smooth sweep + tight rasters. Building block of the repo-tracker hero.",
  capabilities: { tier: "core" },
  primitive: true,
  tags: ["data-viz", "donut", "distribution", "animated", "analysts", "marketers", "share"],
  aspectRatio: { ideal: 1.0, min: 0.6, max: 1.8, mode: "warn" },
  outputHints: { format: { kind: "video", container: "mp4" }, width: 360, height: 360, fps: 30, durationMs: 2000, note: "Square ring tile; the hero places it inside the panel's donut region" },
  propsSchema,

  defaultProps: {
    renderMode: "premium",
    debugLayout: false,
    theme: { forceFetch: false },
    segments: [
      { label: "Cache hits", value: 44, color: "#f97316" },
      { label: "Re-rendered", value: 28, color: "#fdba74" },
      { label: "Failed", value: 28, color: "#57534e" },
    ],
    centerValue: "1284",
    centerLabel: "m0saic renders",
    segmentLabels: "percent",
    ringThicknessFrac: DEFAULT_THICKNESS_FRAC,
    anim: { mode: "sweep", countUp: true, introFrac: 0.7, easing: "easeOut", reduceMotion: false },
  },

  async render(props: DonutProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = ctx.output.width;
    const H = ctx.output.height;

    if (!Array.isArray(props.segments) || props.segments.length === 0) {
      throw new Error("@m0saic/charts/donut/v4: segments must be a non-empty array");
    }
    if (props.segments.length > MAX_SEGMENTS) {
      throw new Error(`@m0saic/charts/donut/v4: at most ${MAX_SEGMENTS} segments`);
    }
    const thickness = props.ringThicknessFrac ?? DEFAULT_THICKNESS_FRAC;
    if (!Number.isFinite(thickness) || thickness < 0.05 || thickness > 0.9) {
      throw new Error(`@m0saic/charts/donut/v4: ringThicknessFrac must be in [0.05, 0.9], got ${thickness}`);
    }

    const theme = await resolveThemeTokens(LOCAL_THEME, ctx, props.theme);

    const anim = props.anim ?? {};
    const reduceMotion = anim.reduceMotion ?? false;
    const mode = anim.mode ?? "sweep";
    const ease: EaseName = anim.easing ?? "easeOut";
    const totalSec = ctx.target.durationMs / 1000;
    const introSec = anim.introMs != null ? anim.introMs / 1000 : totalSec * (anim.introFrac ?? 0.7);
    const animateRing = !reduceMotion && introSec > 0;
    const angles = segmentsToAngles(props.segments.map((s) => s.value), { gapDeg: GAP_DEG });
    const segColor = (i: number): MosaicColor => props.segments[i].color ?? theme.dataPalette[i % theme.dataPalette.length];

    // The canvas color is ALSO painted as a real base tile: the resolver child
    // path (.mosaicx template_invocation) drops the child doc's backgroundColor
    // (candidate 2026-08-24-resolver-drops-child-doc-background), so relying on
    // doc.backgroundColor alone renders BLACK through the CLI/jobs path. "none"
    // stays paint-free for card-chrome composition. Revisit when the engine
    // candidate lands.
    const bgRaw = (props.backgroundColor ?? "").trim();
    const bgColor: MosaicColor | undefined = bgRaw.toLowerCase() === "none" ? undefined : ((bgRaw || theme.surface) as MosaicColor);

    // Same emission predicate both modes: labels exist only when "percent" AND at
    // least one segment sweeps wide enough (an unmatched contract label = violation).
    const anySegLabel = (props.segmentLabels ?? "none") === "percent" && angles.some((a) => a.endDeg - a.startDeg >= SEG_LABEL_MIN_SWEEP_DEG);

    // ── LIGHT mode: composable per-segment overlay stack (unchanged from v3; already ratio) ──
    if ((props.renderMode ?? "premium") === "light") {
      const cx = W / 2, cy = H / 2;
      const rOuter = (Math.min(W, H) / 2) * RADIUS_SCALE;
      const rInner = rOuter * (1 - thickness);
      const holeDia = 2 * rInner;
      const fadeDur = animateRing ? Math.max(0.1, introSec * 0.32) : 0;
      const fadeAt = (startSec: number, durSec: number): Record<string, unknown> => (animateRing ? { alpha: fadeInExpr(startSec, durSec) } : {});
      const withOverlay = <T extends MosaicSource>(src: T, overlay?: Record<string, unknown>): T =>
        overlay && Object.keys(overlay).length ? ({ ...src, overlay: { ...(src as { overlay?: Record<string, unknown> }).overlay, ...overlay } } as T) : src;
      const centerAt = (fracX: number, fracY: number): Record<string, unknown> => ({ xExpr: `(W*${fracX.toFixed(5)})-(W/2)`, yExpr: `(H*${fracY.toFixed(5)})-(H/2)` });

      const layers: MosaicSource[] = [];
      // Make inline edit: the canvas tile's FILL is `backgroundColor` (kind
      // color via the schema's isColor → a picker). Bound on the theme
      // fallback too — the handle to ADD a color. "none" → no tile → no binding.
      if (bgColor) layers.push(bindProp(makeColorTile(bgColor) as MosaicSource, "backgroundColor"));
      for (let i = 0; i < angles.length; i++) {
        const a = angles[i];
        if (a.endDeg - a.startDeg <= 0.0001) continue;
        const path = annularSectorPath({ cx, cy, rOuter, rInner, startDeg: a.startDeg, endDeg: a.endDeg });
        // ONE masked tile per segment: its fill IS `segments[i].color` → the
        // slice binds the color leaf (bound on the palette fallback too — ADD).
        const seg = bindPropPath(makeColorTile(segColor(i), { mask: { kind: "inline-mask", localPath: path, bounds: { x: 0, y: 0, width: W, height: H } } }) as MosaicSource, "segments", [i, "color"], "color");
        const startAtSec = animateRing ? Math.max(0, (introSec - fadeDur) * sweepInverseEase(ease, a.startDeg / 360)) : 0;
        layers.push(withOverlay(seg, animateRing ? { startAtSec, ...fadeAt(startAtSec, fadeDur) } : undefined));
      }
      if ((props.segmentLabels ?? "none") === "percent") {
        const ringPx = rOuter - rInner;
        const segFont = Math.max(9, Math.round(ringPx * SEG_LABEL_FONT_FRAC));
        for (let i = 0; i < angles.length; i++) {
          const a = angles[i];
          if (a.endDeg - a.startDeg < SEG_LABEL_MIN_SWEEP_DEG) continue;
          const { x, y } = sectorCentroid({ cx, cy, rOuter, rInner, startDeg: a.startDeg, endDeg: a.endDeg });
          const pct = `${Math.round(a.frac * 100)}%`;
          const overlay = { ...centerAt(x / W, y / H), ...fadeAt(introSec * 0.6, Math.max(0.1, introSec * 0.3)) };
          // The % shows THIS segment's value → the rect edits `segments[i].value`.
          layers.push(withOverlay(bindPropPath(tag(cellText(pct, segFont, labelColorFor(segColor(i))), "seg-label"), "segments", [i, "value"], "number"), overlay));
        }
      }
      // Blank/whitespace = unset: defaults keep this field populated in Make, so
      // CLEARING it is the only reachable path to the documented derive-the-sum
      // behavior (a bare ?? kept "" and rendered an empty hole).
      const valueRawL = (props.centerValue ?? "").trim() || String(Math.round(props.segments.reduce((s, x) => s + x.value, 0)));
      const valueFontL = holeCappedFont(holeDia * VALUE_FONT_FRAC, 12, valueRawL, holeDia, 0.86);
      const valueTextL = fitToHole(valueRawL, valueFontL, holeDia, 0.86);
      const hasCaptionL = !!(props.centerLabel && props.centerLabel.trim() !== "");
      const captionRawL = (props.centerLabel ?? "").trim();
      const captionFontL = holeCappedFont(holeDia * CAPTION_FONT_FRAC, 9, captionRawL, holeDia, 0.92);
      const captionTextL = fitToHole(captionRawL, captionFontL, holeDia, 0.92);
      const valueCyL = hasCaptionL ? cy - rInner * 0.12 : cy;
      // debugLayout forces the literal (non-expr) center value: geometry is
      // identical (fonts/bboxes derive from the text either way), and with no
      // expr source the frames-to-sources zip is safe, so the contract checks
      // EVERY text group instead of gating itself off — the wireframe always
      // shows real verdicts.
      const animateValueL = (anim.countUp ?? true) && !reduceMotion && /\d/.test(valueTextL) && props.debugLayout !== true;
      // Make inline edit: the hole value binds `centerValue` (an EMPTY prop
      // shows the derived sum — the rect is the double-click handle to set
      // one); the caption binds `centerLabel` only where its rect exists.
      const valueSrc = bindProp(
        animateValueL
          ? tag(cellExprText(animateNumbersInText(valueTextL, { durationSec: introSec, ease }), valueFontL, theme.textPrimary), "center-value")
          : tag(cellText(valueTextL, valueFontL, theme.textPrimary), "center-value"),
        "centerValue",
      );
      layers.push(withOverlay(valueSrc, hasCaptionL ? centerAt(0.5, valueCyL / H) : undefined));
      if (hasCaptionL) {
        const capOverlay = { ...centerAt(0.5, (cy + rInner * 0.44) / H), ...fadeAt(introSec * 0.7, Math.max(0.1, introSec * 0.3)) };
        layers.push(withOverlay(bindProp(tag(cellText(captionTextL, captionFontL, theme.textSecondary), "center-label"), "centerLabel"), capOverlay));
      }
      const docL = {
        kind: "mosaic_document", version: 1, assets: {} as any,
        m0: String(buildOverlayStack(Math.max(1, layers.length))) as any,
        sources: layers.length ? layers : [makeColorTile("black@0")],
        backgroundColor: props.backgroundColor ?? theme.surface,
        fps: ctx.target.fps, durationMs: ctx.target.durationMs,
      } as MosaicDocument;
      // Dev tripwire. textFits gated on the expr-free doc (count-up center value
      // is expr text; expr sources shift the frames-to-sources zip — see the
      // 2026-08-22 contract-frame-zip candidate). Falsy debugLayout = zero cost.
      return Promise.resolve(
        withLayoutContract(docL, ctx, {
          templateId: "@m0saic/charts/donut/v4",
          relations: [],
          constraints: animateValueL ? [] : [
            { label: "center-value", textFits: { charWidthEm: 0.62, padPx: 0 } },
            ...(hasCaptionL ? [{ label: "center-label", textFits: { charWidthEm: 0.62, padPx: 0 } }] : []),
            ...(anySegLabel ? [{ label: "seg-label", textFits: { charWidthEm: 0.62, padPx: 0 } }] : []),
          ],
          debug: props.debugLayout === true,
        }),
      );
    }

    // ── PREMIUM mode: self-framed coarse-quantize sliver sweep (RATIO) ──
    // Build the ring in a P-divisible S×S frame, snap every bbox to P, placeRects
    // on S×S (all bands multiples of P → basis GCD-collapses to K), letterbox to W×H.
    const regionSide = Math.min(W, H);
    const { P, S } = selfFrame(regionSide);
    const cx = S / 2, cy = S / 2;
    const rOuter = (S / 2) * RADIUS_SCALE;
    const rInner = rOuter * (1 - thickness);
    const holeDia = 2 * rInner;

    // `whole` = this piece IS the segment's single slice (fade / static): its
    // fill binds `segments[i].color` for Make's inline edit. The sweep's
    // slivers (several per segment, up to 36 a ring) are not the value's one
    // visual → they stay unbound (binding rule 6: a handful of rects per value
    // is fine, an explosion is not).
    const sectorPiece = (segIndex: number, startDeg: number, endDeg: number, overlay?: { startAtSec: number; alpha: string }, whole = false): Piece =>
      placePiece(S, S, P, annularSectorBBox({ cx, cy, rOuter, rInner, startDeg, endDeg }), (cw, ch, ox, oy) => {
        const tile = makeColorTile(segColor(segIndex), {
          mask: { kind: "inline-mask", localPath: annularSectorPath({ cx: cx - ox, cy: cy - oy, rOuter, rInner, startDeg, endDeg }), bounds: { x: 0, y: 0, width: cw, height: ch } },
          ...(overlay ? { overlay } : {}),
        }) as MosaicSource;
        // Every piece of a segment — its single slice (fade / static) or each of
        // its sweep slivers — is painted with `segments[i].color`, so every one is
        // that color's handle (1:N is fine; the sliver count is budgeted ≤ 36).
        void whole;
        return bindPropPath(tile, "segments", [segIndex, "color"], "color");
      });

    const sectorPieces: Piece[] = [];
    if (animateRing && mode === "sweep") {
      const slivers = subdivideForSweep(angles);
      const fadeDur = Math.max(0.05, (introSec / Math.max(1, slivers.length)) * 2.5);
      for (const s of slivers) {
        const seg = angles[s.segIndex];
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
        sectorPieces.push(sectorPiece(i, a.startDeg, a.endDeg, { startAtSec, alpha: fadeInExpr(startAtSec, fadeDur) }, true));
      }
    } else {
      for (let i = 0; i < angles.length; i++) {
        const a = angles[i];
        if (a.endDeg - a.startDeg <= 0.0001) continue;
        sectorPieces.push(sectorPiece(i, a.startDeg, a.endDeg, undefined, true));
      }
    }

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
        const piece = placePiece(S, S, P, textBBox(x, y, pct, segFont), () => bindPropPath(tag(cellText(pct, segFont, color), "seg-label"), "segments", [i, "value"], "number"));
        if (animateRing) {
          const revealAt = mode === "sweep" ? introSec * sweepInverseEase(ease, a.endDeg / 360) : introSec * 0.5 * (a.startDeg / 360) + introSec * 0.45;
          piece.source = fadeIn(piece.source, revealAt, introSec * 0.15, true);
        }
        labelPieces.push(piece);
      }
    }

    // Blank/whitespace = unset (see light mode note).
    const valueRaw = (props.centerValue ?? "").trim() || String(Math.round(props.segments.reduce((s, x) => s + x.value, 0)));
    const valueFont = holeCappedFont(holeDia * VALUE_FONT_FRAC, 12, valueRaw, holeDia, 0.86);
    const valueText = fitToHole(valueRaw, valueFont, holeDia, 0.86);
    const captionRaw = (props.centerLabel ?? "").trim();
    const captionFont = holeCappedFont(holeDia * CAPTION_FONT_FRAC, 9, captionRaw, holeDia, 0.92);
    const captionText = fitToHole(captionRaw, captionFont, holeDia, 0.92);
    const hasCaption = !!(props.centerLabel && props.centerLabel.trim() !== "");
    const valueCy = hasCaption ? cy - rInner * 0.12 : cy;
    const captionCy = cy + rInner * 0.44;
    // Same debugLayout literal-forcing as light mode: full contract coverage.
    const animateValue = (anim.countUp ?? true) && !reduceMotion && /\d/.test(valueText) && props.debugLayout !== true;
    const textPieces: Piece[] = [];
    // Same bindings as light mode: value → `centerValue`, caption → `centerLabel`.
    textPieces.push(placePiece(S, S, P, textBBox(cx, valueCy, valueText, valueFont), () =>
      bindProp(animateValue ? tag(cellExprText(animateNumbersInText(valueText, { durationSec: introSec, ease }), valueFont, theme.textPrimary), "center-value") : tag(cellText(valueText, valueFont, theme.textPrimary), "center-value"), "centerValue")));
    if (hasCaption) {
      const cap = placePiece(S, S, P, textBBox(cx, captionCy, captionText, captionFont), () => bindProp(tag(cellText(captionText, captionFont, theme.textSecondary), "center-label"), "centerLabel"));
      cap.source = fadeIn(cap.source, introSec * 0.8, introSec * 0.2, !reduceMotion);
      textPieces.push(cap);
    }

    for (const p of labelPieces) p.rect.importance = 1;
    for (const p of textPieces) p.rect.importance = 1;
    const pieces: Piece[] = [...sectorPieces, ...labelPieces, ...textPieces];
    const placed = placeRects({ rootW: S, rootH: S, rects: pieces.map((p) => p.rect) });

    const sources: MosaicSource[] = [];
    for (const layer of placed.layers) {
      const ordered = [...layer.rectIndices].sort((a, b) => pieces[a].rect.y - pieces[b].rect.y || pieces[a].rect.x - pieces[b].rect.x);
      for (const idx of ordered) sources.push(pieces[idx].source);
    }
    // Letterbox the S×S ring frame into the W×H canvas (ratio splits), over the
    // base canvas tile (see bgColor note above).
    let rootM0 = letterbox(String(placed.m0), S, W, H);
    if (bgColor) {
      rootM0 = `F{${rootM0}}`;
      // Same binding as light mode: the canvas tile edits `backgroundColor`.
      sources.unshift(bindProp(makeColorTile(bgColor) as MosaicSource, "backgroundColor"));
    }

    const doc = {
      kind: "mosaic_document", version: 1, assets: {} as any,
      m0: rootM0 as any,
      sources,
      backgroundColor: props.backgroundColor ?? theme.surface,
      fps: ctx.target.fps, durationMs: ctx.target.durationMs,
    } as MosaicDocument;
    // Dev tripwire (premium cells are tight P-snapped rects, so textFits is
    // meaningful here). Same expr gating as light mode.
    return Promise.resolve(
      withLayoutContract(doc, ctx, {
        templateId: "@m0saic/charts/donut/v4",
        relations: [],
        constraints: animateValue ? [] : [
          { label: "center-value", textFits: { charWidthEm: 0.62, padPx: 0 } },
          ...(hasCaption ? [{ label: "center-label", textFits: { charWidthEm: 0.62, padPx: 0 } }] : []),
          ...(anySegLabel ? [{ label: "seg-label", textFits: { charWidthEm: 0.62, padPx: 0 } }] : []),
        ],
        debug: props.debugLayout === true,
      }),
    );
  },

  // Editor-only first-open cover — the mosaic-branding theme. The ring is
  // procedural mask content: the hero INLINES the static default chart flat
  // (the gate-15 seam lesson was learned ON this template).
  async renderCover(_props: DonutProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const heroBox = brandedCoverHeroBox(ctx, "band");
    const heroCtx = {
      ...ctx,
      target: { ...ctx.target, width: heroBox.width, height: heroBox.height },
      output: { ...ctx.output, width: heroBox.width, height: heroBox.height },
    } as MosaicEngineContext;
    const chart = (await DonutV4.render(
      {
        ...(DonutV4.defaultProps as DonutProps),
        anim: { ...(DonutV4.defaultProps as DonutProps).anim, reduceMotion: true },
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

registerTemplate(DonutV4);
