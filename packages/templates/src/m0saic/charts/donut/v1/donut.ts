/**
 * ============================================================================
 * @m0saic/charts/donut/v1 — Canonical Donut Chart (data-viz primitive)
 * ============================================================================
 *
 * A proportional ring with a dominant total in the hole — the "Commit
 * Distribution" tile of the GitHub repo-tracker hero. Renders the ring as
 * ONE cell: each segment is a color source (makeColorTile — ffmpeg composes)
 * masked by an annular-sector SVG path (SVG draws), all stacked as overlay
 * layers in a single frame. No grid cells per segment, no split-rounding
 * exposure.
 *
 * GEOMETRY (sandbox session 2026-06-12-donut-distribution; the human's
 * hand-corrected candidate-004 set the defaults):
 *
 *   - ring centered in the canvas; outer diameter ≈ 0.92 × min(W, H)
 *     (the "Donut Chart Area" region the human drew)
 *   - hole carries the value — the human's 100×100 "Number Area" on a
 *     ~178px circle ⇒ ringThicknessFrac default 0.36
 *   - segments run CLOCKWISE from 12 o'clock in input order (the 75%
 *     majority sweeps right/down; the 25% minority lands upper-left,
 *     matching the reference crop)
 *   - flush segments (no angular gap), per the reference
 *
 * No title/legend surface: "Commit Distribution / Weekday vs Weekend" is
 * panel chrome (a separate primitive); the reference shows no legend rows.
 * A legend prop can land later — the surface stays lean until asked for.
 *
 * ANIMATION (first-class, per the hero plan):
 *   - "sweep" (default): quantized clockwise wipe — the ring subdivides
 *     into thin angular slivers (anim.ts), each revealed on an
 *     inverse-eased schedule so the ring closes exactly as the eased
 *     count-up in the hole lands on its number. Overlapping fades keep
 *     the leading edge continuous; slivers within a segment overlap by
 *     a hair so anti-aliased seams can't show through.
 *   - "fade": one whole sector per segment, staggered fade — the cheap
 *     variant (~3 sources instead of ~30).
 *   - reduceMotion: static final frame.
 * Expressions stay confined to leaf sources (the bar-graph BarFill model);
 * all timing math lives in anim.ts / template-utils.
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
} from "@m0saic/types";
import {
  animateNumbersInText,
  buildOverlayStack,
  definePropsSchema,
  fadeInExpr,
  makeColorTile,
  registerTemplate,
  type EaseName,
} from "@m0saic/template-utils";
import { annularSectorPath, sectorCentroid, segmentsToAngles, MAX_SEGMENTS } from "./geometry";
import { subdivideForSweep, sweepInverseEase } from "./anim";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type DonutSegment = {
  /** Series name (e.g. "Weekday Commits"). Carried for tooling/legend-later. */
  label: string;
  /** Raw weight — normalized internally. Non-negative. */
  value: number;
  /** Slice color. Defaults to the theme palette by index. */
  color?: MosaicColor;
};

type DonutAnim = {
  /** Intro mode: quantized clockwise "sweep" (default) or per-segment "fade". */
  mode?: "sweep" | "fade";
  /** Count the hole value up from 0 on intro. Default true. */
  countUp?: boolean;
  /** Fraction of the OUTPUT duration the intro fills. Default 0.7. */
  introFrac?: number;
  /** Absolute intro duration (ms). Overrides introFrac when set. */
  introMs?: number;
  /** Easing — the sweep schedule runs through its inverse. Default "easeOut". */
  easing?: EaseName;
  /** Disable all motion — render the final static ring. Default false. */
  reduceMotion?: boolean;
};

type DonutProps = {
  segments: DonutSegment[];
  /** Pre-formatted hole value (e.g. "247"). Absent → the segments' sum. */
  centerValue?: string;
  /** Small muted caption under the value. Absent → value only (reference). */
  centerLabel?: string;
  /** Annulus thickness as a fraction of the outer radius. Default 0.36. */
  ringThicknessFrac?: number;
  /**
   * Per-segment labels rendered ON the slices (mid-angle, mid-radius).
   * "percent" = the derived share ("19%"), auto black/white text by
   * slice luminance; slices too thin to fit a label are skipped.
   * Default "none" (the reference tile carries no slice labels).
   */
  segmentLabels?: "none" | "percent";
  /** Card surface color. Pass "none" when composed under card chrome. */
  backgroundColor?: MosaicColor;
  anim?: DonutAnim;
};

const propsSchema = definePropsSchema<DonutProps>({
  segments: {
    type: "array" as any,
    required: true,
    description:
      "Ring segments in clockwise order from 12 o'clock. Raw weights — normalized internally.",
    meta: { ui: { label: "Segments", order: 1 } },
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
    meta: { constraints: { isColor: true }, control: { colorPicker: true }, ui: { label: "Card Color", order: 10 } },
  },
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
// Theme (dark — GitHub-palette aligned; ring colors sampled from the
// reference crop: majority muted sage, minority light sage)
// ---------------------------------------------------------------------------

const CARD_BG: MosaicColor = "#161b22";
const VALUE_COLOR: MosaicColor = "#e6edf3";
const CAPTION_COLOR: MosaicColor = "#8b949e";
const PALETTE: MosaicColor[] = [
  "#588168", // majority — muted sage (reference ring)
  "#95c6a7", // minority — light sage (reference ring)
  "#3fb950",
  "#2f6f44",
  "#bfdcc8",
  "#1f4f30",
];

/** Ring outer diameter as a fraction of min(W, H). */
const RADIUS_SCALE = 0.92;
/** Default annulus thickness / outer radius (human-corrected candidate-004). */
const DEFAULT_THICKNESS_FRAC = 0.36;
/** Flush segments per the reference (no angular gap). */
const GAP_DEG = 0;
/** Value font as a fraction of the HOLE diameter (human-tuned, c-008). */
const VALUE_FONT_FRAC = 0.3;
/** Caption font as a fraction of the hole diameter (human-tuned, c-008:
 *  "reduce by ~20%"). */
const CAPTION_FONT_FRAC = 0.11;
/** Segment-label font as a fraction of the annulus thickness. */
const SEG_LABEL_FONT_FRAC = 0.42;
/** Slices sweeping less than this get no label — the text can't fit. */
const SEG_LABEL_MIN_SWEEP_DEG = 14;
/** Segment-label text colors, picked by slice luminance. */
const SEG_LABEL_LIGHT: MosaicColor = "#f0f6f1";
const SEG_LABEL_DARK: MosaicColor = "#10141a";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Horizontally centered text, vertically pinned to an exact pixel line
// via explicit drawtext expressions (`cyPx` = the glyph box's vertical
// CENTER). `cyPx` omitted → canvas center. Exact-expression placement —
// alignment-padding offsets proved unreliable for the value/caption
// pair (they overlapped), so the hole text uses the same xExpr/yExpr
// mechanism as the per-segment labels.
function centeredText(
  text: string,
  fontSize: number,
  color: MosaicColor,
  cyPx?: number,
): MosaicTextSource {
  return {
    type: "text",
    visual: { backgroundColor: "black@0" },
    layers: [
      {
        content: { kind: "literal", text: text || " " },
        style: { fontSize, fontColor: color },
        placement:
          cyPx == null
            ? ({ hAlign: "center", vAlign: "middle" } as any)
            : ({ xExpr: "(w-text_w)/2", yExpr: `${Math.round(cyPx)}-text_h/2` } as any),
      },
    ],
  };
}

// Animated hole value: an expr text layer evaluated per-frame on a
// video-renderMode source — the stat-card count-up idiom, centered.
// FIXED fontSize so the digits don't rescale as the number grows.
function centeredExprText(
  expr: string,
  fontSize: number,
  color: MosaicColor,
  cyPx?: number,
): MosaicTextSource {
  return {
    type: "text",
    renderMode: { kind: "video" },
    visual: { backgroundColor: "black@0" },
    layers: [
      {
        content: { kind: "expr", expr, eval: "frame" },
        style: { fontSize, fontColor: color },
        placement:
          cyPx == null
            ? ({ hAlign: "center", vAlign: "middle" } as any)
            : ({ xExpr: "(w-text_w)/2", yExpr: `${Math.round(cyPx)}-text_h/2` } as any),
      },
    ],
  };
}

// Premium content reveal: fade a source in via overlay.alpha (evaluated
// per frame at composite time, so still sources animate in a video render).
function fadeIn<T extends MosaicSource>(src: T, startSec: number, durSec: number, on: boolean): T {
  if (!on) return src;
  const prev = (src as { overlay?: Record<string, unknown> }).overlay ?? {};
  return { ...src, overlay: { ...prev, alpha: fadeInExpr(startSec, durSec) } } as T;
}

// Per-segment label pinned to an exact point via explicit drawtext
// expressions (text_w/text_h center the glyph box on the centroid) —
// no cell math, no width estimation.
function pointText(
  text: string,
  px: number,
  py: number,
  fontSize: number,
  color: MosaicColor,
): MosaicTextSource {
  return {
    type: "text",
    visual: { backgroundColor: "black@0" },
    layers: [
      {
        content: { kind: "literal", text },
        style: { fontSize, fontColor: color },
        placement: { xExpr: `${px}-text_w/2`, yExpr: `${py}-text_h/2` } as any,
      },
    ],
  };
}

/** Black-or-white label text by slice luminance (WCAG-ish quick check). */
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

export const Donut: MosaicTemplate<DonutProps> = {
  id: asTemplateId("@m0saic/charts/donut/v1"),
  label: "Donut Chart",
  version: 1,
  description:
    "Canonical donut chart: proportional ring + dominant center total. Building block of the repo-tracker hero (Commit Distribution tile).",
  capabilities: { tier: "core" },
  primitive: true, // foundational data-viz building block (composed by the repo-tracker hero)
  deprecated: {
    reason:
      "Full-canvas mask antipattern: every slice (and every sweep sliver) is a 360×360 color tile masked to a thin sector, so renders are slow and intermediates huge for what paints as a sliver. Kept as the canonical 'bad' example. Use v4 — same picture, each slice placed as a tight bbox with a cell-local mask.",
    replacement: asTemplateId("@m0saic/charts/donut/v4"),
    since: "2026-06-21",
  },
  tags: ["charts", "donut", "distribution", "data-viz"],
  aspectRatio: { ideal: 1.0, min: 0.6, max: 1.8, mode: "warn" },
  outputHints: { width: 360, height: 360, fps: 30, durationMs: 2000, note: "Square ring tile; the hero places it inside the panel's donut region" },
  propsSchema,

  defaultProps: {
    segmentLabels: "none",
    ringThicknessFrac: 0.36,
    segments: [
      { label: "Weekday Commits", value: 75 },
      { label: "Weekend Commits", value: 25 },
    ],
    centerValue: "247",
    backgroundColor: CARD_BG,
    anim: { mode: "sweep", countUp: true, introFrac: 0.7, easing: "easeOut", reduceMotion: false },
  },

  render(props: DonutProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = ctx.output.width;
    const H = ctx.output.height;

    // ── Fail-fast validation ──
    if (!Array.isArray(props.segments) || props.segments.length === 0) {
      throw new Error("@m0saic/charts/donut/v1: segments must be a non-empty array");
    }
    if (props.segments.length > MAX_SEGMENTS) {
      throw new Error(`@m0saic/charts/donut/v1: at most ${MAX_SEGMENTS} segments`);
    }
    const thickness = props.ringThicknessFrac ?? DEFAULT_THICKNESS_FRAC;
    if (!Number.isFinite(thickness) || thickness < 0.05 || thickness > 0.9) {
      throw new Error(
        `@m0saic/charts/donut/v1: ringThicknessFrac must be in [0.05, 0.9], got ${thickness}`,
      );
    }

    // ── Ring geometry (all in canvas px; mask bounds = the full canvas) ──
    const cx = W / 2;
    const cy = H / 2;
    const rOuter = (Math.min(W, H) / 2) * RADIUS_SCALE;
    const rInner = rOuter * (1 - thickness);
    const holeDia = 2 * rInner;

    const angles = segmentsToAngles(
      props.segments.map((s) => s.value),
      { gapDeg: GAP_DEG },
    );

    // ── Intro timing (the §10 time source: ctx.target) ──
    const anim = props.anim ?? {};
    const reduceMotion = anim.reduceMotion ?? false;
    const mode = anim.mode ?? "sweep";
    const ease: EaseName = anim.easing ?? "easeOut";
    const totalSec = ctx.target.durationMs / 1000;
    const introSec = anim.introMs != null ? anim.introMs / 1000 : totalSec * (anim.introFrac ?? 0.7);
    const animateRing = !reduceMotion && introSec > 0;

    const segColor = (i: number): MosaicColor =>
      props.segments[i].color ?? PALETTE[i % PALETTE.length];
    const sectorTile = (
      segIndex: number,
      startDeg: number,
      endDeg: number,
      overlay?: { startAtSec: number; alpha: string },
    ): MosaicSource =>
      makeColorTile(segColor(segIndex), {
        mask: {
          kind: "inline-mask",
          localPath: annularSectorPath({ cx, cy, rOuter, rInner, startDeg, endDeg }),
          bounds: { x: 0, y: 0, width: W, height: H },
        },
        ...(overlay ? { overlay } : {}),
      });

    // ── Sector sources. Zero-share segments contribute no source (a
    // 0°-sweep path is degenerate); proportions already account for them.
    const sectorSources: MosaicSource[] = [];
    if (animateRing && mode === "sweep") {
      // Quantized clockwise sweep: thin slivers on an inverse-eased
      // schedule, so angular progress tracks the eased count-up and the
      // ring closes exactly as the number lands. Within a segment each
      // sliver overlaps the next by a hair (later paints on top) so
      // anti-aliased seams can't show through; segment boundaries stay
      // exact so colors never bleed.
      const slivers = subdivideForSweep(angles);
      const fadeDur = Math.max(0.05, (introSec / Math.max(1, slivers.length)) * 2.5);
      for (const s of slivers) {
        const segEnd = angles[s.segIndex].endDeg;
        const end = Math.min(segEnd, s.endDeg + 0.35);
        const startAtSec = introSec * sweepInverseEase(ease, s.frac0);
        sectorSources.push(
          sectorTile(s.segIndex, s.startDeg, end, {
            startAtSec,
            alpha: fadeInExpr(startAtSec, fadeDur),
          }),
        );
      }
    } else if (animateRing && mode === "fade") {
      // Cheap variant: whole sectors, staggered fade in clockwise order.
      const fadeDur = introSec * 0.45;
      for (let i = 0; i < angles.length; i++) {
        const a = angles[i];
        if (a.endDeg - a.startDeg <= 0.0001) continue;
        const startAtSec = introSec * 0.5 * (a.startDeg / 360);
        sectorSources.push(
          sectorTile(i, a.startDeg, a.endDeg, {
            startAtSec,
            alpha: fadeInExpr(startAtSec, fadeDur),
          }),
        );
      }
    } else {
      for (let i = 0; i < angles.length; i++) {
        const a = angles[i];
        if (a.endDeg - a.startDeg <= 0.0001) continue;
        sectorSources.push(sectorTile(i, a.startDeg, a.endDeg));
      }
    }

    // ── Center value (+ optional caption) in the hole ──
    const valueText =
      props.centerValue ??
      String(Math.round(props.segments.reduce((s, x) => s + x.value, 0)));
    const valueFont = Math.max(12, Math.round(holeDia * VALUE_FONT_FRAC));
    // Caption font shrinks with text length so long captions ("Issues
    // Raised") stay inside the hole instead of grazing the ring —
    // ~0.55 em average glyph width against 92% of the hole diameter.
    const captionLen = Math.max(1, (props.centerLabel ?? "").trim().length);
    const captionFont = Math.max(
      9,
      Math.round(
        Math.min(holeDia * CAPTION_FONT_FRAC, (holeDia * 0.92) / (0.55 * captionLen)),
      ),
    );
    const hasCaption = !!(props.centerLabel && props.centerLabel.trim() !== "");
    // With a caption the pair splits around the hole center: the value
    // nudges up (less than before — "drop lower a bit", c-008), the
    // caption sits below it — exact pixel lines.
    const valueCy = hasCaption ? cy - rInner * 0.12 : undefined;
    const captionCy = cy + rInner * 0.44;

    const animateValue = (anim.countUp ?? true) && !reduceMotion && /\d/.test(valueText);
    const textSources: MosaicSource[] = [
      animateValue
        ? centeredExprText(
            animateNumbersInText(valueText, { durationSec: introSec, ease }),
            valueFont,
            VALUE_COLOR,
            valueCy,
          )
        : centeredText(valueText, valueFont, VALUE_COLOR, valueCy),
    ];
    if (hasCaption) {
      // Caption reveals late — the value lands first, then its label.
      textSources.push(
        fadeIn(
          centeredText(props.centerLabel!, captionFont, CAPTION_COLOR, captionCy),
          introSec * 0.8,
          introSec * 0.2,
          !reduceMotion,
        ),
      );
    }

    // ── Per-segment labels ON the slices (mid-angle, mid-radius) ──
    // Percent shares derived from the normalized values; thin slices
    // skip the label. In sweep mode each label fades in as its segment
    // COMPLETES (the sweep's leading edge passes its end angle).
    const segLabelSources: MosaicSource[] = [];
    if ((props.segmentLabels ?? "none") === "percent") {
      const ringPx = rOuter - rInner;
      const segFont = Math.max(9, Math.round(ringPx * SEG_LABEL_FONT_FRAC));
      for (let i = 0; i < angles.length; i++) {
        const a = angles[i];
        if (a.endDeg - a.startDeg < SEG_LABEL_MIN_SWEEP_DEG) continue;
        const { x, y } = sectorCentroid({
          cx,
          cy,
          rOuter,
          rInner,
          startDeg: a.startDeg,
          endDeg: a.endDeg,
        });
        const pct = `${Math.round(a.frac * 100)}%`;
        const label = pointText(pct, x, y, segFont, labelColorFor(segColor(i)));
        if (animateRing) {
          const revealAt =
            mode === "sweep"
              ? introSec * sweepInverseEase(ease, a.endDeg / 360)
              : introSec * 0.5 * (a.startDeg / 360) + introSec * 0.45;
          segLabelSources.push(fadeIn(label, revealAt, introSec * 0.15, true));
        } else {
          segLabelSources.push(label);
        }
      }
    }

    // ── One cell, K overlay layers (sectors below, labels + text on top) ──
    const sources: MosaicSource[] = [...sectorSources, ...segLabelSources, ...textSources];
    const m0 = buildOverlayStack(sources.length);

    return Promise.resolve({
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0,
      sources,
      backgroundColor: props.backgroundColor ?? CARD_BG,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
    } as MosaicDocument);
  },
};

registerTemplate(Donut);
