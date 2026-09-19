/**
 * ============================================================================
 * @m0saic/charts/donut/v2 — Bitmap Donut (the "complexity in the grid" probe)
 * ============================================================================
 *
 * SAME picture as v1, OPPOSITE cost structure. A deliberate experiment to test
 * a thesis surfaced by the benchmark heavy tier:
 *
 *   v1 puts complexity in the ENCODER — a trivial m0 (one cell) with ~31
 *   full-canvas color tiles, each MASKED by an annular-sector SVG path and
 *   composited every frame. A circle that reads as one item is 31 masked
 *   sources alive for the whole clip.
 *
 *   v2 puts complexity in the m0 STRING / SOURCE COUNT — an N×N grid of tiny
 *   UNMASKED `color=` tiles (a bitmap ring). Each ring cell is a plain lavfi
 *   color revealed on a clockwise alpha schedule (the sweep). No SVG masks, no
 *   per-source path geometry — just many trivial inputs the engine chunks.
 *
 * COMPOSITION (two layers, the v1 idiom):
 *   1. base   — the ring, a nested mosaic CHILD whose m0 is the N×N grid. The
 *               grid does ONE job: rasterize the circle.
 *   2. overlay — the center value (+ optional caption), placed with the same
 *               traditional text DSL v1 uses (centered drawtext, count-up). The
 *               grid never carries text; the overlay layer does.
 *
 * RESOLUTION: grid() emits nested per-row / per-col splits (each at most N-way),
 * NOT one giant >200-way split, so the literal-split rounding cap does not
 * apply — the engine chunks thousands of color tiles fine. N trades smoothness
 * for render time (cost grows ~linearly with N² cells): N≈14 is fast+blocky,
 * N≈72 reads as a clean ring. Default 72.
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
import { grid } from "@m0saic/dsl-stdlib";
import { MAX_SEGMENTS } from "../v1/geometry";

// ---------------------------------------------------------------------------
// Props (v1's ring + center-text knobs; the ring is a bitmap grid instead of
// masked sectors — the only structural difference)
// ---------------------------------------------------------------------------

type DonutSegment = {
  label: string;
  value: number;
  color?: MosaicColor;
};

type DonutV2Anim = {
  /** Count the hole value up from 0 on intro. Default true. */
  countUp?: boolean;
  /** Fraction of the OUTPUT duration the clockwise reveal fills. Default 0.7. */
  introFrac?: number;
  /** Absolute intro duration (ms). Overrides introFrac when set. */
  introMs?: number;
  /** Reveal + count-up easing. Default "easeOut". */
  easing?: EaseName;
  /** Disable motion — render the static final ring. Default false. */
  reduceMotion?: boolean;
};

type DonutV2Props = {
  segments: DonutSegment[];
  /** Pre-formatted hole value (e.g. "247"). Absent → the segments' sum. */
  centerValue?: string;
  /** Small muted caption under the value. Absent → value only. */
  centerLabel?: string;
  /** Annulus thickness as a fraction of the outer radius. Default 0.4. */
  ringThicknessFrac?: number;
  /** Bitmap resolution — the ring is rasterized on an N×N grid. Default 72. */
  resolution?: number;
  /** Card surface color (also the hole + gaps). Default v1's card. */
  backgroundColor?: MosaicColor;
  anim?: DonutV2Anim;
};

const propsSchema = definePropsSchema<DonutV2Props>({
  segments: {
    type: "array" as never,
    required: true,
    description: "Ring segments in clockwise order from 12 o'clock. Raw weights — normalized internally.",
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
  resolution: {
    type: "number",
    required: false,
    description: "Bitmap grid resolution N (the ring is rasterized on N×N cells). Higher = smoother but render cost grows ~N². 14 is fast+blocky; 72 reads as a clean ring.",
    meta: { constraints: { min: 6, max: 160 }, control: { flavor: "slider", step: 2 }, ui: { label: "Resolution (N×N)", order: 8 } },
  },
  backgroundColor: {
    type: "string",
    required: false,
    description: "Card surface color (fills the hole and the corners behind the ring).",
    meta: { constraints: { isColor: true }, control: { colorPicker: true }, ui: { label: "Card Color", order: 10 } },
  },
  anim: {
    type: "group" as never,
    required: false,
    description: "Clockwise reveal + count-up: intro length, easing, reduceMotion.",
    meta: { ui: { label: "Animation", collapsedByDefault: true } },
    fields: {
      countUp: { type: "boolean", required: false, description: "Count the hole value up on intro.", meta: { ui: { label: "Count up" } } },
      introFrac: { type: "number", required: false, description: "Fraction of the output duration the reveal fills (the rest holds).", meta: { constraints: { min: 0.1, max: 1 }, control: { flavor: "slider", step: 0.05 }, ui: { label: "Intro length (× duration)" } } },
      introMs: { type: "number", required: false, description: "Absolute intro duration (ms). Overrides Intro length when set.", meta: { control: { placeholder: "from Intro fraction" }, constraints: { min: 0, max: 20000 }, ui: { label: "Intro (ms, override)" } } },
      easing: { type: "string", required: false, description: "Reveal + count-up easing.", meta: { constraints: { oneOf: ["easeOut", "smoothstep", "easeInOut", "linear"] }, ui: { label: "Easing" } } },
      reduceMotion: { type: "boolean", required: false, description: "Disable motion — render the static final ring.", meta: { ui: { label: "Reduce motion" } } },
    },
  },
});

// ---------------------------------------------------------------------------
// Theme (mirror v1 so v1↔v2 read as the same chart)
// ---------------------------------------------------------------------------

const CARD_BG: MosaicColor = "#161b22";
const VALUE_COLOR: MosaicColor = "#e6edf3";
const CAPTION_COLOR: MosaicColor = "#8b949e";
const PALETTE: MosaicColor[] = [
  "#588168", "#95c6a7", "#3fb950", "#2f6f44", "#bfdcc8", "#1f4f30",
];

const DEFAULT_THICKNESS_FRAC = 0.4;
const DEFAULT_RESOLUTION = 72;
const MIN_RESOLUTION = 6;
const MAX_RESOLUTION = 160;
/** Outer ring radius as a fraction of the half-canvas (leaves a card margin). */
const OUTER_R01 = 0.46;
/** Value font as a fraction of the HOLE diameter (v1's tuned value). */
const VALUE_FONT_FRAC = 0.3;
/** Caption font as a fraction of the hole diameter (v1's tuned value). */
const CAPTION_FONT_FRAC = 0.11;

// ---------------------------------------------------------------------------
// Center-text helpers (the v1 idiom: centered drawtext pinned by expression)
// ---------------------------------------------------------------------------

function centeredText(text: string, fontSize: number, color: MosaicColor, cyPx?: number): MosaicTextSource {
  return {
    type: "text",
    visual: { backgroundColor: "black@0" },
    layers: [
      {
        content: { kind: "literal", text: text || " " },
        style: { fontSize, fontColor: color },
        placement:
          cyPx == null
            ? ({ hAlign: "center", vAlign: "middle" } as never)
            : ({ xExpr: "(w-text_w)/2", yExpr: `${Math.round(cyPx)}-text_h/2` } as never),
      },
    ],
  };
}

function centeredExprText(expr: string, fontSize: number, color: MosaicColor, cyPx?: number): MosaicTextSource {
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
            ? ({ hAlign: "center", vAlign: "middle" } as never)
            : ({ xExpr: "(w-text_w)/2", yExpr: `${Math.round(cyPx)}-text_h/2` } as never),
      },
    ],
  };
}

function fadeIn<T extends MosaicSource>(src: T, startSec: number, durSec: number, on: boolean): T {
  if (!on) return src;
  const prev = (src as { overlay?: Record<string, unknown> }).overlay ?? {};
  return { ...src, overlay: { ...prev, alpha: fadeInExpr(startSec, durSec) } } as T;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export const DonutV2: MosaicTemplate<DonutV2Props> = {
  id: asTemplateId("@m0saic/charts/donut/v2"),
  label: "Donut Chart (bitmap)",
  version: 2,
  description:
    "Bitmap donut — the same ring + center total as v1, with the ring rendered as an N×N grid of tiny unmasked color tiles (complexity in source count, not in masked encoder work). A render-cost experiment paired with the benchmark heavy tier.",
  capabilities: { tier: "core" },
  // Shipped as a render-cost EXPERIMENT, not a production surface. The finding
  // (see the internal source-count-duration-cost notes): the bitmap
  // ring only beats v1 while coarse — at smooth resolution the grid-stitch cost
  // grows ≈N² and v1's annular-sector masks are both crisper and faster. Kept
  // for reference/benchmark use; not the recommended donut.
  deprecated: {
    reason:
      "Render-cost experiment. The bitmap ring wins only at low resolution; at smooth resolution the grid-stitch cost grows ≈N² and vector masks are both crisper and faster. Use v4 for production donuts (tight-bbox vector masks).",
    replacement: asTemplateId("@m0saic/charts/donut/v4"),
    since: "2026-06-18",
  },
  tags: ["charts", "donut", "distribution", "data-viz", "experiment", "bitmap"],
  aspectRatio: { ideal: 1.0, min: 0.6, max: 1.8, mode: "warn" },
  outputHints: { width: 360, height: 360, fps: 30, durationMs: 2000, note: "Square bitmap ring tile" },
  propsSchema,

  defaultProps: {
    segments: [
      { label: "Weekday Commits", value: 75 },
      { label: "Weekend Commits", value: 25 },
    ],
    centerValue: "247",
    ringThicknessFrac: DEFAULT_THICKNESS_FRAC,
    resolution: DEFAULT_RESOLUTION,
    backgroundColor: CARD_BG,
    anim: { countUp: true, introFrac: 0.7, easing: "easeOut", reduceMotion: false },
  },

  render(props: DonutV2Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = ctx.output.width;
    const H = ctx.output.height;

    // ── Fail-fast validation (mirror v1) ──
    if (!Array.isArray(props.segments) || props.segments.length === 0) {
      throw new Error("@m0saic/charts/donut/v2: segments must be a non-empty array");
    }
    if (props.segments.length > MAX_SEGMENTS) {
      throw new Error(`@m0saic/charts/donut/v2: at most ${MAX_SEGMENTS} segments`);
    }
    const thickness = props.ringThicknessFrac ?? DEFAULT_THICKNESS_FRAC;
    if (!Number.isFinite(thickness) || thickness < 0.05 || thickness > 0.9) {
      throw new Error(`@m0saic/charts/donut/v2: ringThicknessFrac must be in [0.05, 0.9], got ${thickness}`);
    }
    const N = Math.max(MIN_RESOLUTION, Math.min(MAX_RESOLUTION, Math.round(props.resolution ?? DEFAULT_RESOLUTION)));

    // ── Normalized segment fraction boundaries (clockwise from 12 o'clock) ──
    const values = props.segments.map((s) => (Number.isFinite(s.value) && s.value > 0 ? s.value : 0));
    const total = values.reduce((a, b) => a + b, 0);
    if (total <= 0) throw new Error("@m0saic/charts/donut/v2: segment values must sum to > 0");
    const cum: number[] = [];
    let acc = 0;
    for (const v of values) { acc += v; cum.push(acc / total); }
    const segColor = (i: number): MosaicColor => props.segments[i].color ?? PALETTE[i % PALETTE.length];
    /** angle-fraction [0,1) clockwise from top → segment index */
    const segOf = (af: number): number => {
      for (let k = 0; k < cum.length; k++) if (af < cum[k] - 1e-9) return k;
      return cum.length - 1;
    };

    // ── Ring geometry on the unit square ──
    const outerR = OUTER_R01;
    const innerR = OUTER_R01 * (1 - thickness);

    // ── Intro timing (ctx.target is the only time source) ──
    const anim = props.anim ?? {};
    const reduceMotion = anim.reduceMotion ?? false;
    const ease: EaseName = anim.easing ?? "easeOut";
    const totalSec = ctx.target.durationMs / 1000;
    const introSec = anim.introMs != null ? anim.introMs / 1000 : totalSec * (anim.introFrac ?? 0.7);
    const animateRing = !reduceMotion && introSec > 0;
    // Fade a cell in over a couple cells' worth of the clockwise dwell so the
    // leading edge isn't a hard pop.
    const fadeDur = Math.max(0.05, introSec * (2 / Math.max(1, N)));

    const bg = props.backgroundColor ?? CARD_BG;

    // ── LAYER 1: the ring, rasterized as an N×N grid (its own child doc) ──
    const { m0: gridM0 } = grid({ rows: N, cols: N });
    const ringSources: MosaicSource[] = new Array(N * N);
    for (let i = 0; i < N * N; i++) {
      const row = Math.floor(i / N);
      const col = i % N;
      const x = (col + 0.5) / N - 0.5; // [-0.5, 0.5]
      const y = (row + 0.5) / N - 0.5;
      const dist = Math.hypot(x, y);
      const inRing = dist >= innerR && dist <= outerR;
      if (!inRing) {
        ringSources[i] = makeColorTile(bg); // hole + corners: card fill
        continue;
      }
      // Clockwise angle fraction from 12 o'clock: atan2(x, -y) ∈ (-π, π].
      let ang = Math.atan2(x, -y);
      if (ang < 0) ang += 2 * Math.PI;
      const af = ang / (2 * Math.PI);
      const color = segColor(segOf(af));
      if (!animateRing) {
        ringSources[i] = makeColorTile(color);
        continue;
      }
      const startAtSec = introSec * af; // reveal when the sweep reaches this angle
      ringSources[i] = makeColorTile(color, { overlay: { alpha: fadeInExpr(startAtSec, fadeDur, ease) } });
    }
    const ringDoc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as never,
      m0: gridM0,
      sources: ringSources,
      backgroundColor: bg,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
    } as MosaicDocument;

    // ── LAYER 2+: center value (+ optional caption) — traditional v1 text DSL ──
    const cx = W / 2;
    const cy = H / 2;
    const holeDia = 2 * innerR * Math.min(W, H);
    const valueText = props.centerValue ?? String(Math.round(props.segments.reduce((s, x) => s + x.value, 0)));
    const valueFont = Math.max(12, Math.round(holeDia * VALUE_FONT_FRAC));
    const captionLen = Math.max(1, (props.centerLabel ?? "").trim().length);
    const captionFont = Math.max(9, Math.round(Math.min(holeDia * CAPTION_FONT_FRAC, (holeDia * 0.92) / (0.55 * captionLen))));
    const hasCaption = !!(props.centerLabel && props.centerLabel.trim() !== "");
    const valueCy = hasCaption ? cy - innerR * Math.min(W, H) * 0.12 : undefined;
    const captionCy = cy + innerR * Math.min(W, H) * 0.44;
    const animateValue = (anim.countUp ?? true) && !reduceMotion && /\d/.test(valueText);

    const textSources: MosaicSource[] = [
      animateValue
        ? centeredExprText(animateNumbersInText(valueText, { durationSec: introSec, ease }), valueFont, VALUE_COLOR, valueCy)
        : centeredText(valueText, valueFont, VALUE_COLOR, valueCy),
    ];
    if (hasCaption) {
      textSources.push(
        fadeIn(centeredText(props.centerLabel!, captionFont, CAPTION_COLOR, captionCy), introSec * 0.8, introSec * 0.2, !reduceMotion),
      );
    }

    // ── Root: overlay stack — ring child below, text on top ──
    const rootSources: MosaicSource[] = [{ type: "mosaic", ref: "ring" } as MosaicSource, ...textSources];
    const m0 = buildOverlayStack(rootSources.length);

    return Promise.resolve({
      kind: "mosaic_document",
      version: 1,
      assets: {} as never,
      m0,
      sources: rootSources,
      children: { ring: ringDoc },
      backgroundColor: bg,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
    } as MosaicDocument);
  },
};

registerTemplate(DonutV2);
