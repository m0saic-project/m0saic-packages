import { asTemplateId } from "@m0saic/types";
/*
Timeline (logo_loop):
0%        inEnd        outStart        100%
|----------|-------------|---------------|
 reveal-in     fully on        reveal-out

Loading shimmer (loading_shimmer):
- a moving band sweeps across the filled tiles in a deterministic order
- loops forever, does NOT imply completion
*/

import type {
  MosaicColor,
  MosaicEngineContext,
  MosaicDocument,
  MosaicSource,
  MosaicSourceMask,
  MosaicTemplate,
} from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  definePropsSchema,
  makeColorTile,
  registerTemplate,
  makeErrorMosaic,
} from "@m0saic/template-utils";
import { registry as dictionaryRegistry, getSourceOrderStableKeys } from "@m0saic/dictionary";


const HERO_ORANGE = "#f97316";

type LogoProps = {
  color?: MosaicColor;
  size?: "m-33" | "m-33_bitmap";

  /**
   * logo_loop: existing radial reveal in/out loop
   * progress_fill: deterministic 0..1 fill (requires progress or time-based progressSec)
   * loading_shimmer: deterministic sweeping shimmer band (best for unknown load times)
   */
  animation?: "logo_loop" | "progress_fill" | "loading_shimmer" | "loading_ui_v2";

  // logo_loop controls
  loopSec?: number;
  inEnd?: number;
  outStart?: number;
  feather?: number;
  startDelay?: number;
  endDelay?: number;
  easing?: "linear" | "smoothstep";

  // progress_fill controls
  /** Progress 0..1 for progress_fill; when set, controls fill directly (no time-based animation). */
  progress?: number;
  /** Duration in seconds for auto progress animation when progress is undefined. Used only for progress_fill. */
  progressSec?: number;
  /** When true and progress is auto-animated, use one-shot (no loop). */
  oneShot?: boolean;

  // loading_shimmer controls
  /** Duration (sec) for one shimmer sweep. Used only for loading_shimmer. */
  shimmerSec?: number;
  /** Band width in normalized units across the filled tiles (0..1). Used only for loading_shimmer. */
  shimmerWidth?: number;
};

const propsSchema = definePropsSchema<LogoProps>({
  color: {
    type: "string",
    required: false,
    description: "Foreground color of the logo tiles",
    meta: {
      constraints: { isColor: true },
      ui: { label: "Logo Color" },
      control: { colorPicker: true, placeholder: HERO_ORANGE },
    },
  },
  size: {
    type: "string",
    required: false,
    description:
      "Brand entry to render. m-33 (33 rect frames with rank set, fast). " +
      "m-33_bitmap (272x272 bitmap, 36770 frames — substantially slower).",
    meta: {
      constraints: { oneOf: ["m-33", "m-33_bitmap"] },
      ui: { label: "Size" },
    },
  },

  animation: {
    type: "string",
    required: false,
    description:
      "Animation mode: logo_loop (reveal in/out), progress_fill (0→100%), loading_shimmer (looping shimmer while loading), loading_ui_v2 (the default loading treatment)",
    meta: {
      // `loading_ui_v2` IS the default and the render handles it — it was
      // missing from the closed set, so the panel showed "—" for the state
      // the template ships in (caught by the defaultsValidate convention).
      constraints: { oneOf: ["logo_loop", "progress_fill", "loading_shimmer", "loading_ui_v2"] },
      ui: { label: "Animation", order: 5 },
    },
  },

  // logo_loop
  loopSec: {
    type: "number",
    required: false,
    description: "Total duration of the animation loop (in seconds)",
    meta: {
      constraints: { min: 0.1, max: 60 },
      ui: { label: "Loop (sec)", order: 10 },
    },
  },
  inEnd: {
    type: "number",
    required: false,
    description: "Fraction of the loop used for the reveal-in phase",
    meta: {
      constraints: { min: 0.0001, max: 1 },
      ui: { label: "Reveal-in end", order: 20 },
    },
  },
  outStart: {
    type: "number",
    required: false,
    description: "Fraction of the loop where reveal-out begins",
    meta: {
      constraints: { min: 0, max: 0.9999 },
      ui: { label: "Reveal-out start", order: 30 },
    },
  },
  feather: {
    type: "number",
    required: false,
    description:
      "Feather amount in normalized units (0..1) to soften thresholds (fill / shimmer / reveal)",
    meta: {
      constraints: { min: 0, max: 0.2 },
      ui: { label: "Feather", order: 35 },
    },
  },
  startDelay: {
    type: "number",
    required: false,
    description: "Fraction of the loop to hold on black BEFORE reveal starts.",
    meta: {
      constraints: { min: 0, max: 0.9 },
      ui: { label: "Start pause", order: 25 },
    },
  },
  endDelay: {
    type: "number",
    required: false,
    description:
      "Fraction of the loop to hold on black AFTER reveal-out finishes.",
    meta: {
      constraints: { min: 0, max: 0.9 },
      ui: { label: "End pause", order: 27 },
    },
  },
  easing: {
    type: "string",
    required: false,
    description:
      "Easing applied to the active progress. smoothstep = calm ease-in-out.",
    meta: {
      constraints: { oneOf: ["linear", "smoothstep"] },
      ui: { label: "Easing", order: 45 },
    },
  },

  // progress_fill
  progress: {
    type: "number",
    required: false,
    description:
      "Progress 0..1 for progress_fill; when set, fills tiles directly (no time animation).",
    meta: {
      control: { placeholder: "auto (animated)" },
      constraints: { min: 0, max: 1 },
      ui: { label: "Progress", order: 50 },
    },
  },
  progressSec: {
    type: "number",
    required: false,
    description:
      "Duration (sec) for auto progress animation when progress is not set. Used only for progress_fill.",
    meta: {
      constraints: { min: 0.1, max: 60 },
      ui: { label: "Progress duration (sec)", order: 52 },
    },
  },
  oneShot: {
    type: "boolean",
    required: false,
    description: "When true and progress is auto-animated, play once (no loop).",
    meta: {
      ui: { label: "One-shot", order: 54 },
    },
  },

  // loading_shimmer
  shimmerSec: {
    type: "number",
    required: false,
    description:
      "Duration (sec) for one shimmer sweep. Used only for loading_shimmer.",
    meta: {
      constraints: { min: 0.1, max: 60 },
      ui: { label: "Shimmer duration (sec)", order: 60 },
    },
  },
  shimmerWidth: {
    type: "number",
    required: false,
    description:
      "Width of the shimmer band in normalized units across the filled tiles (0..1). Used only for loading_shimmer.",
    meta: {
      constraints: { min: 0.01, max: 1 },
      ui: { label: "Shimmer width", order: 62 },
    },
  },
});

const DICT_ID_M33 = "brand/m-33";
const DICT_ID_BITMAP = "brand/m-33_bitmap";
// Default rank set name for m-33's rect-based animation reveal order.
const DICT_ID_M33_RANKS = "diag";
// m-33_bitmap is a 272x272 bitmap with 36770 frames. Hard-coded here
// because bitmapRowMajorToCoords needs the side length explicitly.
const BITMAP_GRID = 272;

type CoordsResult =
  | { ok: true; coords: Array<{ x: number; y: number }>; filledCount: number }
  | { ok: false; error: string };

function buildLoadingUiAlphaExpr(
  rank: number,
  opts: {
    // base “always visible” glow
    baseMin: number;     // e.g. 0.18
    baseMax: number;     // e.g. 0.32
    basePulseSec: number;// e.g. 1.6

    // sweeping highlight
    shimmerSec: number;  // e.g. 1.2
    shimmerWidth: number;// e.g. 0.20 (normalized)
    shimmerAmp: number;  // e.g. 0.75
    feather: number;     // e.g. 0.02
    fps: number;
  }
): string {
  const { baseMin, baseMax, basePulseSec, shimmerSec, shimmerWidth, shimmerAmp, feather, fps } = opts;

  const startGate = `gte(t,1/${fps})`;

  // base breathing: base = baseMin + (baseMax-baseMin)*0.5*(1-cos(2*pi*t/basePulseSec))
  const base =
    `(${baseMin})+(${baseMax}-${baseMin})*0.5*(1-cos(2*PI*t/${basePulseSec}))`;

  // moving center p in [0..1)
  const p = `mod(t,${shimmerSec})/${shimmerSec}`;
  const halfW = `(${shimmerWidth}/2)`;

  // wrap distance
  const d0 = `abs(${rank}-(${p}))`;
  const d1 = `abs(${rank}-((${p})-1))`;
  const d2 = `abs(${rank}-((${p})+1))`;
  const d = `min(min(${d0},${d1}),${d2})`;

  // band strength u in [0..1]: u = clamp(1 - d/halfW, 0, 1)
  const u = `max(min(1-(${d})/(${halfW}),1),0)`;

  // smoothstep(u) = u*u*(3-2*u)
  const band = `(${u})*(${u})*(3-2*(${u}))`;

  // highlight
  const hi = `(${shimmerAmp})*${band}`;

  // alpha = clamp(base + hi, 0, 1)
  const a = `max(min((${base})+(${hi})+${feather},1),0)`;

  return `${startGate}*(${a})`;
}


/**
 * Parse row-major .m0 bitmap string into (x,y) coords for filled cells.
 * Row-major: idx = y * gridSize + x → x = idx % gridSize, y = floor(idx / gridSize).
 */
function bitmapRowMajorToCoords(bitmap: string, gridSize: number): CoordsResult {
  const expected = gridSize * gridSize;
  const cleaned = bitmap.replace(/[^F1-]/g, "");
  if (cleaned.length !== expected) {
    return {
      ok: false,
      error: `Expected ${expected} bitmap chars (F/1/-) after stripping DSL punctuation; got ${cleaned.length}`,
    };
  }
  const coords: Array<{ x: number; y: number }> = [];
  for (let idx = 0; idx < cleaned.length; idx++) {
    const c = cleaned[idx];
    if (c === "F" || c === "1") {
      const x = idx % gridSize;
      const y = Math.floor(idx / gridSize);
      coords.push({ x, y });
    }
  }
  return { ok: true, coords, filledCount: coords.length };
}

/**
 * Build a loopable per-tile enable expression for ffmpeg overlay.enable.
 * Reveal-in by rank, hold, then reveal-out by reverse rank.
 */
function buildEnableExpr(
  rank: number,
  opts: {
    loopSec: number;
    inEnd: number;
    outStart: number;
    feather: number;
    fps: number;
    startDelay: number;
    endDelay: number;
    easing: "linear" | "smoothstep";
  }
): string {
  const { loopSec, inEnd, outStart, feather, fps, startDelay, endDelay } = opts;
  const p = `mod(t,${loopSec})/${loopSec}`;
  const pFrame = `(1/${fps})/${loopSec}`;
  const startGate = `gte(${p},${pFrame})`;

  const activeStart = `${startDelay}`;
  const activeEnd = `(1-${endDelay})`;
  const activeDur = `(${activeEnd}-${activeStart})`;
  const activeGate = `gte(${p},${activeStart})*lt(${p},${activeEnd})`;

  const pA = `(((${p})-${activeStart})/${activeDur})`;
  const pE =
    opts.easing === "smoothstep"
      ? `(${pA})*(${pA})*(3-2*(${pA}))`
      : `${pA}`;

  const outDur = `(1-${outStart})`;
  const inProg = `min((${pE})/${inEnd},1)`;
  const outProg = `min(max(((${pE})-${outStart})/${outDur},0),1)`;

  return `${startGate}*${activeGate}*gte((${inProg})+${feather},${rank})*gte((1-(${outProg}))+${feather},${rank})`;
}

/**
 * Deterministic raw score for ordering filled tiles (used to derive percentile ranks).
 * Diagonal bottom-left → top-right:
 *   raw = 0.75*xN + 0.25*(1 - yN)
 */
function progressFillRawScore(x: number, y: number, GRID: number): number {
  if (GRID <= 1) return 0;
  const g = GRID - 1;
  const xN = x / g;
  const yN = y / g;
  return 0.75 * xN + 0.25 * (1 - yN);
}

/**
 * Convert raw ordering scores into percentile ranks [0..1] across ONLY filled tiles.
 * This makes progress=0.5 mean ~50% of filled tiles, regardless of where the shape sits in the grid.
 */
function buildPercentileRanks(
  coords: Array<{ x: number; y: number }>,
  GRID: number
): number[] {
  const scored = coords.map((c, idx) => ({
    idx,
    raw: progressFillRawScore(c.x, c.y, GRID),
  }));
  scored.sort((a, b) => a.raw - b.raw);

  const n = scored.length;
  const ranks = new Array<number>(n);
  for (let order = 0; order < n; order++) {
    const pct = n <= 1 ? 0 : order / (n - 1);
    ranks[scored[order].idx] = pct;
  }
  return ranks;
}

/**
 * Build enable expression for progress_fill: p controls fill; enable when (p + feather) >= rank.
 * rank MUST be a percentile rank in [0..1] across filled tiles.
 */
function buildProgressFillEnableExpr(
  rank: number,
  opts: {
    progress?: number;
    progressSec: number;
    oneShot: boolean;
    feather: number;
    fps: number;
  }
): string {
  const { progress, progressSec, oneShot, feather, fps } = opts;

  // Frame-0 guard
  const startGate = `gte(t,1/${fps})`;

  const pExpr =
    progress !== undefined
      ? String(Math.max(0, Math.min(1, progress)))
      : oneShot
        ? `min(max(t/${progressSec},0),1)`
        : `mod(t,${progressSec})/${progressSec}`;

  return `${startGate}*gte((${pExpr})+${feather},${rank})`;
}

/**
 * Build enable expression for loading_shimmer:
 * - shimmer center moves p(t) in [0..1)
 * - enable tiles within a band around p
 * - wrap-around handled by comparing to p, p-1, p+1
 *
 * rank MUST be a percentile rank in [0..1] across filled tiles.
 */
function buildLoadingShimmerEnableExpr(
  rank: number,
  opts: {
    shimmerSec: number;
    shimmerWidth: number;
    feather: number;
    fps: number;
  }
): string {
  const { shimmerSec, shimmerWidth, feather, fps } = opts;

  const startGate = `gte(t,1/${fps})`;
  const p = `mod(t,${shimmerSec})/${shimmerSec}`;
  const halfW = `(${shimmerWidth}/2)`;

  // d = min( abs(rank - p), abs(rank - (p-1)), abs(rank - (p+1)) )
  const d0 = `abs(${rank}-(${p}))`;
  const d1 = `abs(${rank}-((${p})-1))`;
  const d2 = `abs(${rank}-((${p})+1))`;
  const d = `min(min(${d0},${d1}),${d2})`;

  return `${startGate}*lte(${d},(${halfW})+${feather})`;
}

export const TheMosaicMV2: MosaicTemplate<LogoProps> = {
  id: asTemplateId("@m0saic/brand/logo/v2"),
  label: "The M0saic M Logo",
  version: 2,
  // BITMAP drafting mode (handbook §3c): the split counts ARE the canonical M bitmap —
  // never live-composed, so the latticeSmooth convention does not apply.
  lattice: { mode: "bitmap" },
  description: "Deterministic render of the canonical m0saic M bitmap",
  capabilities: { tier: "core" },
  tags: ["brand", "logo"],
  deprecated: {
    reason:
      "Superseded by @m0saic/brand/logo/v3, a superset — v3 renders the M as rects (m-33) or bitmap plus the m0 logotype, the m0saic pattern, and the animated composite.",
    replacement: asTemplateId("@m0saic/brand/logo/v3"),
    since: "2026-07-15",
  },
  outputHints: {
    fps: 30,
    durationMs: 3200,
    width: 1080,
    height: 1080,
    note: "Square logo loop",
  },
  propsSchema,
  defaultProps: {
    color: HERO_ORANGE,
    size: "m-33",

    // animation
    animation: "loading_ui_v2",

    // logo_loop defaults
    loopSec: 3.2,
    inEnd: 0.25,
    outStart: 0.75,
    feather: 0.02,
    startDelay: 0.1,
    endDelay: 0.2,
    easing: "smoothstep",

    // progress_fill defaults
    progressSec: 2.0,
    oneShot: false,

    // loading_shimmer defaults
    shimmerSec: 1.2,
    shimmerWidth: 0.18,
  },

  render(props: LogoProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const animMode = props.animation ?? this.defaultProps!.animation!;

    const loopSec = props.loopSec ?? this.defaultProps!.loopSec!;
    const inEnd = props.inEnd ?? this.defaultProps!.inEnd!;
    const outStart = props.outStart ?? this.defaultProps!.outStart!;
    const finalColor = props.color ?? this.defaultProps!.color!;
    const feather = props.feather ?? this.defaultProps!.feather!;
    const startDelay = props.startDelay ?? this.defaultProps!.startDelay!;
    const endDelay = props.endDelay ?? this.defaultProps!.endDelay!;
    const easing = props.easing ?? this.defaultProps!.easing!;

    const progressSec = props.progressSec ?? this.defaultProps!.progressSec!;
    const oneShot = props.oneShot ?? this.defaultProps!.oneShot!;

    const shimmerSec = props.shimmerSec ?? this.defaultProps!.shimmerSec!;
    const shimmerWidth = props.shimmerWidth ?? this.defaultProps!.shimmerWidth!;

    const effectiveFps = ctx.output.fps;

    const errs: string[] = [];

    if (!(feather >= 0 && feather <= 0.2)) {
      errs.push(`feather must be in [0,0.2] (got ${feather})`);
    }

    if (animMode === "progress_fill") {
      if (props.progress !== undefined) {
        const p = props.progress;
        if (!Number.isFinite(p) || p < 0 || p > 1) {
          errs.push(`progress must be finite and in [0,1] (got ${p})`);
        }
      } else {
        if (!(progressSec > 0)) {
          errs.push(
            `progressSec must be > 0 when progress is not set (got ${progressSec})`
          );
        }
        if (progressSec < 0.1 || progressSec > 60) {
          errs.push(`progressSec must be in [0.1, 60] (got ${progressSec})`);
        }
      }
    } else if (animMode === "loading_shimmer") {
      if (!(shimmerSec > 0)) errs.push(`shimmerSec must be > 0 (got ${shimmerSec})`);
      if (shimmerSec < 0.1 || shimmerSec > 60)
        errs.push(`shimmerSec must be in [0.1, 60] (got ${shimmerSec})`);
      if (!(shimmerWidth > 0 && shimmerWidth <= 1))
        errs.push(`shimmerWidth must be in (0,1] (got ${shimmerWidth})`);
    } else {
      // logo_loop validations
      if (!(loopSec > 0)) errs.push(`loopSec must be > 0 (got ${loopSec})`);
      if (!(inEnd > 0 && inEnd <= 1))
        errs.push(`inEnd must be in (0,1] (got ${inEnd})`);
      if (!(outStart >= 0 && outStart < 1))
        errs.push(`outStart must be in [0,1) (got ${outStart})`);
      if (!(inEnd < outStart))
        errs.push(
          `Expected inEnd < outStart (got inEnd=${inEnd}, outStart=${outStart})`
        );
      if (!(startDelay >= 0 && startDelay < 1))
        errs.push(`startDelay must be in [0,1) (got ${startDelay})`);
      if (!(endDelay >= 0 && endDelay < 1))
        errs.push(`endDelay must be in [0,1) (got ${endDelay})`);
      if (!(startDelay + endDelay < 1))
        errs.push(
          `Expected startDelay + endDelay < 1 (got ${startDelay + endDelay})`
        );
      if (easing !== "linear" && easing !== "smoothstep")
        errs.push(`easing must be "linear" or "smoothstep" (got ${String(easing)})`);
      if (!(1 - endDelay - startDelay > 0))
        errs.push(
          `Active window must be > 0 (got ${1 - endDelay - startDelay})`
        );
    }

    if (errs.length) {
      return Promise.resolve(
        makeErrorMosaic(errs.join(" | "), {
          title: `${this.id} props`,
          width: ctx.output.width,
          height: ctx.output.height,
        })
      );
    }

    const isBitmap = props.size === "m-33_bitmap";
    const dictId = isBitmap ? DICT_ID_BITMAP : DICT_ID_M33;
    const entry = dictionaryRegistry.byId[dictId];
    if (!entry) {
      return Promise.resolve(
        makeErrorMosaic(`Dictionary entry "${dictId}" not found.`, {
          title: `${this.id} entry`,
          width: ctx.output.width,
          height: ctx.output.height,
        })
      );
    }
    const sourceCount = entry.sourceCount;
    const m0saic = entry.m0;
    const GRID = isBitmap ? BITMAP_GRID : 0;
    let coords: Array<{ x: number; y: number }> | null = null;


    // ranks source:
    // - m-33:        loaded "diag" rank set (33 rect frames in diagonal order)
    // - m-33_bitmap: computed from bitmap coords (radial for logo_loop,
    //                percentile for the progress/shimmer modes)
    let ranks: number[] = [];

    if (!isBitmap) {
      // `dictionaryRegistry.getRankSet` now returns a StableKey-keyed
      // MosaicRankSet (inline on the m0c). Convert to a positional
      // `number[]` via the entry's source-order stableKeys so the
      // downstream rank-by-index code keeps working unchanged.
      const rankSet = dictionaryRegistry.getRankSet(dictId, DICT_ID_M33_RANKS);
      const rankSourceKeys = getSourceOrderStableKeys(entry);
      const RANKS = rankSourceKeys.map((k) => rankSet.ranks[k] ?? 0);

      if (RANKS.length !== sourceCount) {
        return Promise.resolve(
          makeErrorMosaic(
            `${DICT_ID_M33_RANKS} ranks length (${RANKS.length}) != sourceCount (${sourceCount})`,
            {
              title: `${this.id} ranks`,
              width: ctx.output.width,
              height: ctx.output.height,
            }
          )
        );
      }

      ranks = RANKS;
    } else {
      const coordsRes = bitmapRowMajorToCoords(m0saic, GRID);
      if (coordsRes.ok === false) {
        return Promise.resolve(
          makeErrorMosaic(coordsRes.error, {
            title: `${this.id} mask`,
            width: ctx.output.width,
            height: ctx.output.height,
          })
        );
      }

      coords = coordsRes.coords;
      if (coords.length !== sourceCount) {
        return Promise.resolve(
          makeErrorMosaic(
            `Filled-count (${coords.length}) != sourceCount (${sourceCount}). (Treating 'F' and legacy '1' as filled.)`,
            {
              title: `${this.id} mask`,
              width: ctx.output.width,
              height: ctx.output.height,
            }
          )
        );
      }

      // ranks =
      //   animMode === "progress_fill" ||
      //     animMode === "loading_shimmer" ||
      //     animMode === "loading_ui_v2"
      //     ? buildPercentileRanks(coords, GRID)
      //     : (() => {
      //       // logo_loop still uses radial symmetry from coords
      //       // keep existing path below; we’ll compute rank inline there
      //       return [];
      //     })();
      ranks =
        animMode === "progress_fill" ||
          animMode === "loading_shimmer" ||
          animMode === "loading_ui_v2"
          ? buildPercentileRanks(coords, GRID)
          : [];
    }

    // sanity for the modes that require ranks
    if (
      (animMode === "progress_fill" ||
        animMode === "loading_shimmer" ||
        animMode === "loading_ui_v2") &&
      ranks.length !== sourceCount
    ) {
      throw new Error(`ranks missing for animMode="${animMode}" size="${props.size}"`);
    }


    const sources: MosaicSource[] =
      animMode === "progress_fill"
        ? Array.from({ length: sourceCount }, (_, i) => {
          const rank = ranks![i];
          const enable = buildProgressFillEnableExpr(rank, {
            progress: props.progress,
            progressSec,
            oneShot,
            feather,
            fps: effectiveFps,
          });
          return makeColorTile(finalColor, { overlay: { enable } });
        })
        : animMode === "loading_shimmer"
          ? Array.from({ length: sourceCount }, (_, i) => {
            const rank = ranks![i];
            const enable = buildLoadingShimmerEnableExpr(rank, {
              shimmerSec,
              shimmerWidth,
              feather,
              fps: effectiveFps,
            });
            return makeColorTile(finalColor, { overlay: { enable } });
          })
          : animMode === "loading_ui_v2"
            ? Array.from({ length: sourceCount }, (_, i) => {
              const rank = ranks![i];
              const alpha = buildLoadingUiAlphaExpr(rank, {
                baseMin: 0.18,
                baseMax: 0.32,
                basePulseSec: 1.6,
                shimmerSec,
                shimmerWidth,
                shimmerAmp: 0.75,
                feather,
                fps: effectiveFps,
              });
              return makeColorTile(finalColor, { overlay: { alpha } });
            })
            : (() => {
              // logo_loop
              if (!isBitmap) {
                // m-33: use precomputed diag rank set across the 33 rect frames
                return Array.from({ length: sourceCount }, (_, i) => {
                  const rank = ranks[i];
                  const enable = buildEnableExpr(rank, {
                    loopSec,
                    inEnd,
                    outStart,
                    feather,
                    fps: effectiveFps,
                    startDelay,
                    endDelay,
                    easing,
                  });
                  return makeColorTile(finalColor, { overlay: { enable } });
                });
              }

              // m-33_bitmap: radial reveal from bitmap coords
              if (!coords) {
                throw new Error("coords missing for bitmap logo_loop");
              }

              const cx = (GRID - 1) / 2;
              const cy = (GRID - 1) / 2;
              const dMax = Math.sqrt(cx * cx + cy * cy);

              const symmetricFade = true;
              const effectiveOutStart = symmetricFade ? 1 - inEnd : outStart;

              return Array.from({ length: sourceCount }, (_, i) => {
                const { x, y } = coords![i];
                const dx = x - cx;
                const dy = y - cy;
                const rank = dMax === 0 ? 0 : Math.sqrt(dx * dx + dy * dy) / dMax;

                const enable = buildEnableExpr(rank, {
                  loopSec,
                  inEnd,
                  outStart: effectiveOutStart,
                  feather,
                  fps: effectiveFps,
                  startDelay,
                  endDelay,
                  easing,
                });
                return makeColorTile(finalColor, { overlay: { enable } });
              });
            })();


    // Carve each rect tile into its exact M sub-shape (diagonals / serifs)
    // via the dictionary mask set, so the rendered video shows the true M
    // silhouette rather than blocky rectangles. Null mask entries (the M's
    // solid-rect body) resolve to "no mask" → full rect. The bitmap variant
    // is already pixel-exact and ships no mask set, so it is left unmasked.
    //
    // Inlines the silhouette data (localPath + design-space bounds) loaded
    // from the dictionary so the engine reads `source.mask` directly — no
    // extra fetch / cache lookup at render time, and the emitted document
    // is self-contained (can be saved/shared without the dictionary
    // present at consumption time).
    const maskedSources: MosaicSource[] = (() => {
      if (isBitmap) return sources;
      const entry = dictionaryRegistry.byId[dictId];
      if (!entry || !entry.masks) return sources;
      const sourceKeys = getSourceOrderStableKeys(entry);
      const masks = entry.masks;
      return sources.map((s, i) => {
        const m = masks[sourceKeys[i]];
        if (!m) return s;
        return {
          ...s,
          mask: {
            kind: "inline-mask",
            localPath: m.localPath,
            bounds: m.bounds,
          } satisfies MosaicSourceMask,
        };
      });
    })();

    const doc: MosaicDocument = {

      kind: "mosaic_document",
      version: 1,
      sources: maskedSources,
      assets: {} as any,
      m0: toM0String(m0saic, "LogoV2"),

    };

    return Promise.resolve(doc);
  },
};

registerTemplate(TheMosaicMV2);
