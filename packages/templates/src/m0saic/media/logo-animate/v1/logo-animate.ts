/**
 * @m0saic/media/logo-animate/v1
 *
 * Drop in a company-logo SVG → get an animated logo video back.
 *
 * The SVG is decomposed into REAL m0 geometry at render time
 * (`parseSvg → extractGeometry → inferGrid → rectsToM0`): one concrete
 * cell per logo shape, per-shape silhouettes as inline masks bounded to
 * their cells, per-tile ranks driving the animation. No overlay fakery,
 * no baked pixels — the logo's geometry lives in the m0 string, so the
 * DSL view, structure preview and Render Hero all see it.
 *
 * Sources: inline `svg` string (pure), or `svgPath` file (capability
 * tier, `fs.read`). With neither, a baked placeholder mark (the m0saic
 * M) renders so defaults are standalone-renderable.
 *
 * Scope (v1): rectilinear logos at moderate shape counts convert
 * faithfully; non-rectilinear shapes still convert and carry best-effort
 * silhouette masks. Single ink (per-shape SVG color preservation is a
 * later phase). Logos fill the canvas — render at the logo's own aspect
 * for an undistorted mark (see `outputHints`).
 */

import { asTemplateId } from "@m0saic/types";
import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicOverlayExpr,
  MosaicSource,
  MosaicSourceMask,
  MosaicTemplate,
} from "@m0saic/types";
import {
  binaryGridToM0,
  generateStableKeyRankSet,
  queryFrames,
  rankFramesFromM0,
  toM0String,
  weightedSplit,
  type PackingMode,
} from "@m0saic/dsl-stdlib";
import {
  definePropsSchema,
  makeColorTile,
  makeErrorMosaic,
  registerTemplate,
  resolveDocFrames,
} from "@m0saic/template-utils";
import {
  buildBreathingAlphaExpr,
  buildLoopEnableExpr,
  buildModuleAlphaExpr,
  buildProgressFillEnableExpr,
  buildPseudoRanks,
  buildShimmerEnableExpr,
  buildTileOffsetExpr,
  type RankInputTile,
} from "./expressions";
import { buildContainLayout } from "./layout";
import {
  buildLogoGrid,
  buildMasksByStableKey,
  loadSvgText,
  rasterizeSvgToBinaryGrid,
  type LogoGrid,
} from "./svg-source";
import { DEFAULT_LOGO_SVG } from "./default-logo";
import { renderLogoAnimateTutorial } from "./tutorial";
import {
  buildBrandedCover,
  brandedCoverHeroBox,
  onboardingFrame,
  onboardingOverlay,
  onboardingSolid,
} from "../../../_shared/onboarding-cover";

export type LogoAnimationMode =
  | "assemble"
  | "logo_loop"
  | "progress_fill"
  | "breathing"
  | "shimmer";

export type LogoRankSetMode = "scatter" | "diag" | "cascade" | "radial";


/** Bitmap-mode fidelity tiers (raster grid side length grows per tier). */
export type LogoBitmapPrecision = "draft" | "balanced" | "crisp" | "fine" | "ultra";

/** Hand-tuned ink/background duos (dark is retuned, not derived). */
const PRESETS: Record<"light" | "dark", { ink: MosaicColor; bg: MosaicColor }> = {
  light: { ink: "#f97316", bg: "#ffffff" },
  dark: { ink: "#fb923c", bg: "#0b0b0f" },
};

const DEFAULT_PRESET: "light" | "dark" = "light";
const DEFAULT_FIT: "contain" | "fill" = "contain";
const DEFAULT_ANIMATION: LogoAnimationMode = "assemble";
// "diag" per founder ruling (gate 21): the corner sweep reads as intentional
// assembly at first sight; scatter stays a knob.
const DEFAULT_RANK_SET: LogoRankSetMode = "diag";
const DEFAULT_DRIFT_PERCENT = 0;
const DEFAULT_PACKING: PackingMode = "multi";

/**
 * Bitmap-mode raster grid side length per precision tier. Cell count is the
 * square of these — `ultra` (512² = 262k cells) is maximum fidelity and a very
 * long render (the live editor preview auto-disables past its frame budget),
 * but it completes.
 */
const BITMAP_PRECISION_RES: Record<LogoBitmapPrecision, number> = {
  draft: 32,
  balanced: 64,
  crisp: 128,
  fine: 256,
  ultra: 512,
};
const DEFAULT_BITMAP_PRECISION: LogoBitmapPrecision = "balanced";
const DEFAULT_SPAWN_DUR_MS = 1000;
const DEFAULT_TILE_FADE_MS = 220;
const DEFAULT_HOLD_DUR_MS = 600;
const DEFAULT_FADE_OUT_DUR_MS = 700;
const DEFAULT_TILE_OFFSET_PX = 1;
const DEFAULT_LOOP_SEC = 3.2;
const DEFAULT_PROGRESS_SEC = 2.0;
const DEFAULT_SHIMMER_SEC = 1.2;
const DEFAULT_SHIMMER_WIDTH = 0.18;
const DEFAULT_FEATHER = 0.02;

// logo_loop shape constants (the brand/logo/v3 defaults; loopSec is the
// exposed knob, the envelope stays fixed for v1).
const LOOP_IN_END = 0.25;
const LOOP_OUT_START = 0.75;
const LOOP_START_DELAY = 0.1;
const LOOP_END_DELAY = 0.2;

// breathing envelope constants (the brand/logo/v3 loading-UI values).
const BREATHING_BASE_MIN = 0.18;
const BREATHING_BASE_MAX = 0.32;
const BREATHING_PULSE_SEC = 1.6;
const BREATHING_SHIMMER_AMP = 0.75;

export type LogoAnimateV1Props = {
  /**
   * Path to the logo SVG file on disk (file picker). Read at render
   * time via the template's `fs.read` capability. Provide this OR
   * {@link svg}, not both. With neither, a placeholder mark renders.
   */
  svgPath?: string;

  /**
   * Inline SVG string (pure path — no filesystem). Only `<path>` and
   * `<rect>` elements are parsed; run Inkscape "Object to Path" +
   * ungroup on anything fancier.
   */
  svg?: string;


  /** Drift tolerance for grid inference (% of min canvas dim). Default 0. */
  driftPercent?: number;

  /** Layer-packing strategy. Default "multi". */
  packing?: PackingMode;

  /**
   * Bitmap mode — rasterize the SVG to a pixel grid and animate the pixels.
   * Opt-in: a full grid of cells is a heavy render. Use for non-rectilinear
   * marks that collapse to a single cell in the default (vector) path.
   */
  bitmap?: boolean;

  /**
   * Bitmap-mode fidelity (raster resolution tier). Higher = far more frames /
   * slower renders; `ultra` (512²) is maximum fidelity — it renders but is too
   * heavy for the live editor preview. Default "balanced" (64²).
   */
  bitmapPrecision?: LogoBitmapPrecision;

  /** Animation mode. Default "assemble". */
  animation?: LogoAnimationMode;

  /**
   * Tile ordering driving the animation: "scatter" (hash-shuffled),
   * "diag" (top-left sweep), "cascade" (row cascade), "radial"
   * (center-out). Default "scatter".
   */
  rankSet?: LogoRankSetMode;

  /** assemble: stagger between first and last tile fade-in start, ms. */
  spawnDurMs?: number;

  /** assemble: per-tile fade-in duration, ms. */
  tileFadeMs?: number;

  /** assemble: hold at full alpha before the fade-out, ms. */
  holdDurMs?: number;

  /** assemble: global fade-out duration, ms. */
  fadeOutDurMs?: number;

  /** assemble: pixel offset each tile settles from. */
  tileOffsetPx?: number;

  /** logo_loop: seamless loop period, seconds. */
  loopSec?: number;

  /** progress_fill: freeze at a static fill level (0..1) — good for stills. */
  progress?: number;

  /** progress_fill: fill ramp duration, seconds. */
  progressSec?: number;

  /** progress_fill: fill once and hold instead of repeating. */
  oneShot?: boolean;

  /** shimmer + breathing: band sweep period, seconds. */
  shimmerSec?: number;

  /** shimmer + breathing: band width as a fraction of rank space (0..1). */
  shimmerWidth?: number;

  /** Rank-space tolerance softening mode boundaries. */
  feather?: number;

  /**
   * Aspect handling. "contain" (default) letterboxes the logo at its
   * own aspect inside any canvas — the logo nests as a size-declared
   * child mosaic in a `placeRect`-carved fit rect. "fill" stretches the
   * logo geometry across the whole canvas (correct when the canvas
   * already matches the logo's aspect).
   */
  fit?: "contain" | "fill";

  /** Hand-tuned ink/background duo. Default "light". */
  preset?: "light" | "dark";

  /** Ink override — the single fill color for every logo shape (MVP). */
  color?: MosaicColor;

  /** Canvas background override. */
  backgroundColor?: MosaicColor;
};

/** Treat cleared/blank color pickers as unset (empty string is not nullish). */
function pickColor(value: MosaicColor | undefined, fallback: MosaicColor): MosaicColor {
  if (typeof value === "string" && value.trim() === "") return fallback;
  return value ?? fallback;
}

const propsSchema = definePropsSchema<LogoAnimateV1Props>({
  svgPath: {
    type: "media",
    required: false,
    description:
      "Your logo as an SVG file. Only <path>/<rect> shapes are parsed — flatten with Inkscape's Object to Path first if needed.",
    meta: {
      control: { picker: "file", accept: ["image"] },
      ui: { label: "Logo SVG", order: 1, primary: true },
    },
  },
  svg: {
    type: "string",
    required: false,
    description:
      "Inline SVG content. Bypasses the file picker — useful for CLI/programmatic callers. Leave both empty to see the placeholder mark.",
    meta: { control: { placeholder: "built-in M" }, ui: { label: "SVG string", order: 2 } },
  },
  driftPercent: {
    type: "number",
    required: false,
    description: "Drift tolerance for grid inference (% of min canvas dim).",
    meta: {
      constraints: { min: 0, max: 5 },
      ui: { label: "Drift %" },
    },
  },
  packing: {
    type: "string",
    required: false,
    description: 'Layer-packing strategy: "one" or "multi".',
    meta: {
      constraints: { oneOf: ["one", "multi"] },
      ui: { label: "Packing", hidden: true },
    },
  },
  bitmap: {
    type: "boolean",
    required: false,
    description:
      "Rasterize the SVG to a pixel grid and animate pixel-by-pixel. Opt-in — a high-resolution grid is a heavy render. Use when a logo converts to a single shape and won't otherwise animate.",
    meta: { ui: { label: "Bitmap mode", order: 3 } },
  },
  bitmapPrecision: {
    type: "string",
    required: false,
    description:
      "Bitmap-mode fidelity (raster resolution). Higher = crisper but far more frames / slower renders. ultra (512²) is maximum fidelity — it renders but is too heavy to preview live.",
    meta: {
      constraints: { oneOf: ["draft", "balanced", "crisp", "fine", "ultra"] },
      control: {
        options: [
          { value: "draft", label: "Draft (32²) — fast" },
          { value: "balanced", label: "Balanced (64²)" },
          { value: "crisp", label: "Crisp (128²)" },
          { value: "fine", label: "Fine (256²) — heavy" },
          { value: "ultra", label: "Ultra (512²) — very long, no live preview" },
        ],
      },
      ui: { label: "Bitmap precision" },
    },
  },
  animation: {
    type: "string",
    required: false,
    description:
      "assemble: tiles spawn in, hold, fade out · logo_loop: seamless reveal loop · progress_fill: fills like a loading bar · breathing: pulsing glow with a travelling shine · shimmer: travelling highlight band.",
    meta: {
      constraints: {
        oneOf: ["assemble", "logo_loop", "progress_fill", "breathing", "shimmer"],
      },
      ui: { label: "Animation", order: 1 },
    },
  },
  rankSet: {
    type: "string",
    required: false,
    description:
      "Tile ordering: scatter (pixelate-in), diag (corner sweep), cascade, radial (center-out).",
    meta: {
      constraints: { oneOf: ["scatter", "diag", "cascade", "radial"] },
      ui: { label: "Order", order: 2 },
    },
  },
  spawnDurMs: {
    type: "number",
    required: false,
    description: "Stagger from first to last tile starting its fade-in.",
    meta: {
      constraints: { min: 100, max: 60_000 },
      ui: {
        label: "Spawn (ms)",
        visibleWhen: { prop: "animation", equals: "assemble" },
      },
    },
  },
  tileFadeMs: {
    type: "number",
    required: false,
    description: "Per-tile fade-in duration.",
    meta: {
      constraints: { min: 0, max: 10_000 },
      ui: {
        label: "Fade (ms)",
        visibleWhen: { prop: "animation", equals: "assemble" },
      },
    },
  },
  holdDurMs: {
    type: "number",
    required: false,
    description: "Hold duration at full alpha before fade-out begins.",
    meta: {
      constraints: { min: 0, max: 60_000 },
      ui: {
        label: "Hold (ms)",
        visibleWhen: { prop: "animation", equals: "assemble" },
      },
    },
  },
  fadeOutDurMs: {
    type: "number",
    required: false,
    description: "Global fade-out duration.",
    meta: {
      constraints: { min: 0, max: 10_000 },
      ui: {
        label: "Fade out (ms)",
        visibleWhen: { prop: "animation", equals: "assemble" },
      },
    },
  },
  tileOffsetPx: {
    type: "number",
    required: false,
    description: "Pixel offset (down/right) each tile settles from.",
    meta: {
      constraints: { min: 0, max: 100 },
      ui: {
        label: "Settle (px)",
        visibleWhen: { prop: "animation", equals: "assemble" },
      },
    },
  },
  loopSec: {
    type: "number",
    required: false,
    description: "Seamless loop period.",
    meta: {
      constraints: { min: 0.5, max: 120 },
      ui: {
        label: "Loop (s)",
        visibleWhen: { prop: "animation", equals: "logo_loop" },
      },
    },
  },
  progress: {
    type: "number",
    required: false,
    description: "Static fill level (0..1). Leave empty to animate the fill.",
    meta: {
      control: { placeholder: "auto (animated)" },
      constraints: { min: 0, max: 1 },
      ui: {
        label: "Progress",
        visibleWhen: { prop: "animation", equals: "progress_fill" },
      },
    },
  },
  progressSec: {
    type: "number",
    required: false,
    description: "Fill ramp duration.",
    meta: {
      constraints: { min: 0.2, max: 120 },
      ui: {
        label: "Fill (s)",
        visibleWhen: { prop: "animation", equals: "progress_fill" },
      },
    },
  },
  oneShot: {
    type: "boolean",
    required: false,
    description: "Fill once and hold instead of repeating.",
    meta: {
      ui: {
        label: "One-shot",
        visibleWhen: { prop: "animation", equals: "progress_fill" },
      },
    },
  },
  shimmerSec: {
    type: "number",
    required: false,
    description: "Band sweep period (shimmer + breathing modes).",
    meta: {
      constraints: { min: 0.2, max: 120 },
      ui: { label: "Shimmer (s)" },
    },
  },
  shimmerWidth: {
    type: "number",
    required: false,
    description: "Band width as a fraction of rank space (shimmer + breathing).",
    meta: {
      constraints: { min: 0.02, max: 1 },
      ui: { label: "Band width" },
    },
  },
  feather: {
    type: "number",
    required: false,
    description: "Rank-space tolerance softening mode boundaries.",
    meta: {
      constraints: { min: 0, max: 0.5 },
      ui: { label: "Feather", hidden: true },
    },
  },
  fit: {
    type: "string",
    required: false,
    description:
      '"contain" letterboxes the logo at its own aspect; "fill" stretches it across the canvas.',
    meta: {
      constraints: { oneOf: ["contain", "fill"] },
      ui: { label: "Fit", order: 4 },
    },
  },
  preset: {
    type: "string",
    required: false,
    description: "Hand-tuned ink/background duo.",
    meta: {
      constraints: { oneOf: ["light", "dark"] },
      ui: { label: "Preset", order: 1 },
    },
  },
  color: {
    type: "string",
    required: false,
    description: "Ink override — every logo shape fills with this color.",
    meta: {
      constraints: { isColor: true },
      control: { placeholder: "preset ink", colorPicker: true },
      ui: { label: "Ink", order: 2 },
    },
  },
  backgroundColor: {
    type: "string",
    required: false,
    description: "Canvas background override.",
    meta: {
      constraints: { isColor: true },
      control: { placeholder: "preset background", colorPicker: true },
      ui: { label: "Background", order: 3 },
    },
  },
});

export const LogoAnimateV1: MosaicTemplate<LogoAnimateV1Props> = {
  id: asTemplateId("@m0saic/media/logo-animate/v1"),
  label: "Logo Animate",
  version: 1,
  description:
    "Drop in an SVG logo — get an animated logo video. The SVG becomes real m0 geometry (one cell per shape, silhouette masks), animated per-tile: assemble-in, seamless loop, progress fill, breathing glow, or shimmer.",
  capabilities: {
    tier: "capability",
    caps: { fs: { read: true } },
  },
  tags: ["media", "logo", "animated", "svg-to-mosaic", "brand", "designers", "marketers", "svg", "intro"],
  outputHints: {
    fps: 30,
    durationMs:
      DEFAULT_SPAWN_DUR_MS +
      DEFAULT_TILE_FADE_MS +
      DEFAULT_HOLD_DUR_MS +
      DEFAULT_FADE_OUT_DUR_MS,
    width: 1080,
    height: 1080,
    note:
      "The logo fills the canvas — render at the logo's own aspect ratio for an undistorted mark (square default suits square marks).",
    // Editor preview lands mid-hold so the assembled logo is visible
    // while the user picks a file; scrubbing back shows the spawn.
    posterTimeMs:
      DEFAULT_SPAWN_DUR_MS + DEFAULT_TILE_FADE_MS + Math.round(DEFAULT_HOLD_DUR_MS / 2),
    format: { kind: "video", container: "mp4" },
  },
  propsSchema,
  defaultProps: {
    driftPercent: DEFAULT_DRIFT_PERCENT,
    packing: DEFAULT_PACKING,
    bitmap: false,
    bitmapPrecision: DEFAULT_BITMAP_PRECISION,
    animation: DEFAULT_ANIMATION,
    rankSet: DEFAULT_RANK_SET,
    spawnDurMs: DEFAULT_SPAWN_DUR_MS,
    tileFadeMs: DEFAULT_TILE_FADE_MS,
    holdDurMs: DEFAULT_HOLD_DUR_MS,
    fadeOutDurMs: DEFAULT_FADE_OUT_DUR_MS,
    tileOffsetPx: DEFAULT_TILE_OFFSET_PX,
    loopSec: DEFAULT_LOOP_SEC,
    progressSec: DEFAULT_PROGRESS_SEC,
    oneShot: false,
    shimmerSec: DEFAULT_SHIMMER_SEC,
    shimmerWidth: DEFAULT_SHIMMER_WIDTH,
    feather: DEFAULT_FEATHER,
    fit: DEFAULT_FIT,
    preset: DEFAULT_PRESET,
  },

  async render(
    props: LogoAnimateV1Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    const d = this.defaultProps!;
    const driftPercent = props.driftPercent ?? d.driftPercent!;
    const packing = props.packing ?? d.packing!;
    const bitmap = props.bitmap ?? d.bitmap!;
    const bitmapPrecision = props.bitmapPrecision ?? d.bitmapPrecision!;
    const bitmapRes =
      BITMAP_PRECISION_RES[bitmapPrecision] ?? BITMAP_PRECISION_RES[DEFAULT_BITMAP_PRECISION];
    const animation = props.animation ?? d.animation!;
    const rankSetMode = props.rankSet ?? d.rankSet!;
    const spawnDurMs = props.spawnDurMs ?? d.spawnDurMs!;
    const tileFadeMs = props.tileFadeMs ?? d.tileFadeMs!;
    const holdDurMs = props.holdDurMs ?? d.holdDurMs!;
    const fadeOutDurMs = props.fadeOutDurMs ?? d.fadeOutDurMs!;
    const tileOffsetPx = props.tileOffsetPx ?? d.tileOffsetPx!;
    const loopSec = props.loopSec ?? d.loopSec!;
    const progressSec = props.progressSec ?? d.progressSec!;
    const oneShot = props.oneShot ?? d.oneShot!;
    const shimmerSec = props.shimmerSec ?? d.shimmerSec!;
    const shimmerWidth = props.shimmerWidth ?? d.shimmerWidth!;
    const feather = props.feather ?? d.feather!;
    const fit = props.fit ?? d.fit!;
    const preset = props.preset === "dark" ? "dark" : "light";
    const duo = PRESETS[preset];
    const ink = pickColor(props.color, duo.ink);
    const bg = pickColor(props.backgroundColor, duo.bg);

    const W = ctx.output.width;
    const H = ctx.output.height;
    const fps = ctx.output.fps;

    const fail = (message: string, code: string): MosaicDocument =>
      makeErrorMosaic(message, {
        title: "Logo Animate",
        width: W,
        height: H,
        errorCode: code,
      });

    // ── Validation ────────────────────────────────────────────────
    const errs: string[] = [];
    if (props.svgPath && props.svg) {
      errs.push("specify exactly one of `svgPath` or `svg` (not both)");
    }
    if (!(driftPercent >= 0 && driftPercent <= 5)) {
      errs.push(`driftPercent must be in [0, 5] (got ${driftPercent})`);
    }
    if (packing !== "one" && packing !== "multi") {
      errs.push(`packing must be "one" or "multi" (got "${packing}")`);
    }
    const PRECISIONS: LogoBitmapPrecision[] = ["draft", "balanced", "crisp", "fine", "ultra"];
    if (!PRECISIONS.includes(bitmapPrecision)) {
      errs.push(
        `bitmapPrecision must be one of ${PRECISIONS.join("/")} (got "${bitmapPrecision}")`,
      );
    }
    const ANIMATIONS: LogoAnimationMode[] = [
      "assemble",
      "logo_loop",
      "progress_fill",
      "breathing",
      "shimmer",
    ];
    if (!ANIMATIONS.includes(animation)) {
      errs.push(`animation must be one of ${ANIMATIONS.join("/")} (got "${animation}")`);
    }
    const RANK_SETS: LogoRankSetMode[] = ["scatter", "diag", "cascade", "radial"];
    if (!RANK_SETS.includes(rankSetMode)) {
      errs.push(`rankSet must be one of ${RANK_SETS.join("/")} (got "${rankSetMode}")`);
    }
    if (!(spawnDurMs >= 100 && spawnDurMs <= 60_000)) {
      errs.push(`spawnDurMs must be in [100, 60000] (got ${spawnDurMs})`);
    }
    if (!(tileFadeMs >= 0 && tileFadeMs <= 10_000)) {
      errs.push(`tileFadeMs must be in [0, 10000] (got ${tileFadeMs})`);
    }
    if (!(holdDurMs >= 0 && holdDurMs <= 60_000)) {
      errs.push(`holdDurMs must be in [0, 60000] (got ${holdDurMs})`);
    }
    if (!(fadeOutDurMs >= 0 && fadeOutDurMs <= 10_000)) {
      errs.push(`fadeOutDurMs must be in [0, 10000] (got ${fadeOutDurMs})`);
    }
    if (!(tileOffsetPx >= 0 && tileOffsetPx <= 100)) {
      errs.push(`tileOffsetPx must be in [0, 100] (got ${tileOffsetPx})`);
    }
    if (!(loopSec >= 0.5 && loopSec <= 120)) {
      errs.push(`loopSec must be in [0.5, 120] (got ${loopSec})`);
    }
    if (props.progress !== undefined && !(props.progress >= 0 && props.progress <= 1)) {
      errs.push(`progress must be in [0, 1] (got ${props.progress})`);
    }
    if (!(progressSec >= 0.2 && progressSec <= 120)) {
      errs.push(`progressSec must be in [0.2, 120] (got ${progressSec})`);
    }
    if (!(shimmerSec >= 0.2 && shimmerSec <= 120)) {
      errs.push(`shimmerSec must be in [0.2, 120] (got ${shimmerSec})`);
    }
    if (!(shimmerWidth >= 0.02 && shimmerWidth <= 1)) {
      errs.push(`shimmerWidth must be in [0.02, 1] (got ${shimmerWidth})`);
    }
    if (!(feather >= 0 && feather <= 0.5)) {
      errs.push(`feather must be in [0, 0.5] (got ${feather})`);
    }
    if (fit !== "contain" && fit !== "fill") {
      errs.push(`fit must be "contain" or "fill" (got "${fit}")`);
    }
    if (errs.length) {
      return fail(errs.join(" | "), "LOGO_ANIMATE_PROPS");
    }

    // ── 1) Resolve SVG text (inline / file / baked placeholder) ──
    let svgText: string;
    try {
      svgText = loadSvgText(props, DEFAULT_LOGO_SVG);
    } catch (err) {
      return fail(
        `Failed to read svgPath "${props.svgPath}": ${err instanceof Error ? err.message : String(err)}`,
        "LOGO_ANIMATE_READ",
      );
    }

    // ── 2) SVG → m0 : bitmap raster (opt-in) OR vector grid ──────
    let logoM0: string;
    let masksByKey: ReturnType<typeof buildMasksByStableKey>;
    // Intrinsic logo aspect — the source for `fit: "contain"` letterboxing.
    let intrinsic: { w: number; h: number };
    if (bitmap) {
      // Rasterize to a pixel grid and animate the pixels — solid square cells,
      // no silhouette masks. Deliberately heavy (bitmapRes² cells): opt-in.
      try {
        const grid = await rasterizeSvgToBinaryGrid(svgText, bitmapRes);
        logoM0 = String(binaryGridToM0(grid));
      } catch (err) {
        return fail(
          `Bitmap rasterization failed: ${err instanceof Error ? err.message : String(err)}`,
          "LOGO_ANIMATE_CONVERT",
        );
      }
      masksByKey = {};
      // The SVG is contain-fit into a square res×res raster, so a bitmap's
      // intrinsic aspect is always 1:1.
      intrinsic = { w: bitmapRes, h: bitmapRes };
    } else {
      // One conversion pass → shared grid (m0 + masks + ranks align).
      let logo: LogoGrid;
      try {
        logo = buildLogoGrid(svgText, { driftPercent, packing });
      } catch (err) {
        return fail(
          `SVG conversion failed: ${err instanceof Error ? err.message : String(err)}`,
          "LOGO_ANIMATE_CONVERT",
        );
      }
      logoM0 = logo.m0;
      masksByKey = buildMasksByStableKey(logo.grid, logo.m0);
      intrinsic = logo.intrinsic;
    }

    // ── 3) Visible tiles ─────────────────────────────────────────
    const frames = queryFrames(logoM0, { width: W, height: H }).logical();
    if (frames.length === 0) {
      return fail("Converted m0 contains no visible tiles to animate", "LOGO_ANIMATE_EMPTY");
    }
    // A non-rectilinear SVG collapses to a SINGLE (masked) cell — there's
    // nothing to stagger, so it can't animate. Point the user at bitmap mode
    // instead of silently rendering one static frame.
    if (!bitmap && frames.length === 1) {
      return fail(
        "This SVG converts to a single shape — there are no separate cells to stagger, so it won't animate. " +
          "Enable Bitmap mode to rasterize the logo and animate it pixel-by-pixel (higher render cost).",
        "LOGO_ANIMATE_SINGLE_FRAME",
      );
    }

    // ── 4) Per-tile ranks from geometry (no dictionary) ──────────
    let rankOf: (stableKey: string, index: number) => number;
    if (rankSetMode === "scatter") {
      const tiles: RankInputTile[] = frames.map((f) => ({
        x: f.x,
        y: f.y,
        logicalIndex: f.logicalIndex,
      }));
      const ranks = buildPseudoRanks(tiles);
      rankOf = (_key, i) => ranks[i]!;
    } else {
      const rankSet = generateStableKeyRankSet(
        rankFramesFromM0(logoM0, { canvasW: W, canvasH: H }),
        rankSetMode,
      );
      rankOf = (key) => rankSet.ranks[key] ?? 0;
    }

    // ── 5) Phase timing (assemble) ────────────────────────────────
    const spawnDurSec = spawnDurMs / 1000;
    const tileFadeSec = tileFadeMs / 1000;
    const exitStartSec = spawnDurSec + tileFadeSec + holdDurMs / 1000;
    const fadeOutSec = fadeOutDurMs / 1000;

    const overlayFor = (rank: number): MosaicOverlayExpr => {
      switch (animation) {
        case "logo_loop":
          return {
            enable: buildLoopEnableExpr(rank, {
              loopSec,
              inEnd: LOOP_IN_END,
              outStart: LOOP_OUT_START,
              feather,
              fps,
              startDelay: LOOP_START_DELAY,
              endDelay: LOOP_END_DELAY,
              easing: "smoothstep",
            }),
          };
        case "progress_fill":
          return {
            enable: buildProgressFillEnableExpr(rank, {
              progress: props.progress,
              progressSec,
              oneShot,
              feather,
              fps,
            }),
          };
        case "breathing":
          return {
            alpha: buildBreathingAlphaExpr(rank, {
              baseMin: BREATHING_BASE_MIN,
              baseMax: BREATHING_BASE_MAX,
              basePulseSec: BREATHING_PULSE_SEC,
              shimmerSec,
              shimmerWidth,
              shimmerAmp: BREATHING_SHIMMER_AMP,
              feather,
              fps,
            }),
          };
        case "shimmer":
          return {
            enable: buildShimmerEnableExpr(rank, { shimmerSec, shimmerWidth, feather, fps }),
          };
        case "assemble":
        default: {
          const alpha = buildModuleAlphaExpr(rank, {
            spawnDurSec,
            tileFadeSec,
            exitStartSec,
            fadeOutSec,
          });
          const offset = buildTileOffsetExpr(rank, {
            spawnDurSec,
            tileFadeSec,
            offsetPx: tileOffsetPx,
          });
          return offset === "0" ? { alpha } : { alpha, xExpr: offset, yExpr: offset };
        }
      }
    };

    // ── 6) One animated, silhouette-masked color tile per shape ──
    const sources: MosaicSource[] = frames.map((f, i) => {
      const key = String(f.meta.stableKey);
      const entry = masksByKey[key];
      const mask: MosaicSourceMask | undefined = entry
        ? { kind: "inline-mask", localPath: entry.localPath, bounds: entry.bounds }
        : undefined;
      return makeColorTile(ink, { overlay: overlayFor(rankOf(key, i)), mask });
    });

    // ── 7) Aspect placement ───────────────────────────────────────
    // "fill" (or an exact-fit canvas) → the logo geometry IS the doc.
    // "contain" → nest the logo as a size-declared child mosaic inside
    // one placeRect-carved fit rect; null-tile margins show the doc
    // background. Nested children animate on the parent's global `t`.
    const contain =
      fit === "contain"
        ? buildContainLayout(W, H, intrinsic.w, intrinsic.h)
        : null;

    if (!contain || contain.exactFit) {
      return {
        kind: "mosaic_document",
        version: 1,
        m0: toM0String(logoM0, "LogoAnimateV1"),
        sources,
        assets: {} as MosaicDocument["assets"],
        backgroundColor: bg,
        size: { width: W, height: H },
        fps,
        durationMs: ctx.output.durationMs,
      };
    }

    const child: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      m0: toM0String(logoM0, "LogoAnimateV1-logo"),
      sources,
      assets: {} as MosaicDocument["assets"],
      backgroundColor: bg,
      // The child MUST declare its size (the fit rect) or it renders at
      // the parent tile's default and stretches.
      size: { width: contain.rect.w, height: contain.rect.h },
      fps,
      durationMs: ctx.output.durationMs,
    };

    return {
      kind: "mosaic_document",
      version: 1,
      m0: toM0String(contain.m0, "LogoAnimateV1-contain"),
      children: { logo: child },
      sources: [{ type: "mosaic", ref: "logo" }],
      assets: {} as MosaicDocument["assets"],
      backgroundColor: bg,
      size: { width: W, height: H },
      fps,
      durationMs: ctx.output.durationMs,
    };
  },

  // Editor-only first-open cover — the mosaic-branding BAND. t=0 of the
  // default render is BLANK (assemble starts from alpha 0), so the hero is
  // the ASSEMBLED placeholder M: full-alpha static sources with silhouette
  // masks, INLINED FLAT (never a nested child — the child composite was the
  // gate-21 stretch source), centered px-exactly on its preset plate at the
  // near-full-bleed scale the founder ruled, above the brand band.
  async renderCover(
    props: LogoAnimateV1Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    const preset = props.preset === "dark" ? "dark" : "light";
    const duo = PRESETS[preset];
    const ink = pickColor(props.color, duo.ink);
    const bg = pickColor(props.backgroundColor, duo.bg);

    // The kit band split is exact px rows — the hero box IS the scene cell.
    const heroBox = brandedCoverHeroBox(ctx, "band");
    const sceneW = heroBox.width;
    const sceneH = heroBox.height;

    const logo = buildLogoGrid(DEFAULT_LOGO_SVG, { driftPercent: 0, packing: "multi" });
    const masksByKey = buildMasksByStableKey(logo.grid, logo.m0);
    // Exact intrinsic aspect (1:1 for the M), centered on a px/4 basis —
    // quantization ≤4px per side (the founder's 1:1 cover contract).
    const contain = buildContainLayout(
      Math.max(2, Math.round(sceneW * 0.97)),
      Math.max(2, Math.round(sceneH * 0.95)),
      logo.intrinsic.w,
      logo.intrinsic.h,
    );
    const logoFrames = queryFrames(logo.m0, { width: contain.rect.w, height: contain.rect.h }).logical();
    const logoSources: MosaicSource[] = logoFrames.map((f) => {
      const entry = masksByKey[String(f.meta.stableKey)];
      const mask: MosaicSourceMask | undefined = entry
        ? { kind: "inline-mask", localPath: entry.localPath, bounds: entry.bounds }
        : undefined;
      return makeColorTile(ink, { mask });
    });
    const u = (px: number) => Math.max(1, Math.round(px / 4));
    const padW = Math.max(2, (sceneW - contain.rect.w) / 2);
    const padH = Math.max(2, (sceneH - contain.rect.h) / 2);
    const sceneSplit = String(
      weightedSplit([u(padH), u(contain.rect.h), u(padH)], "row", {
        claimants: [
          "-",
          String(weightedSplit([u(padW), u(contain.rect.w), u(padW)], "col", { claimants: ["-", logo.m0, "-"] })),
          "-",
        ],
      }),
    );

    return buildBrandedCover({
      ctx,
      variant: "band",
      copy: { productName: "Logo Animate", title: "Drop in an SVG; get an animated logo video." },
      hero: (theme) =>
        onboardingFrame(
          onboardingOverlay(onboardingSolid(bg), { m0: sceneSplit, sources: logoSources }),
          theme.borderStrong,
        ),
    });
  },

  // Editor "?" tutorial: six SaaS beats with LIVE nested logo renders —
  // hero assemble, the three built-in marks, the bring-your-own-SVG
  // how-to (flatten guidance), two animations running side by side,
  // bitmap mode for curvy marks, and the knobs recap. See tutorial.ts.
  renderTutorial(_props: LogoAnimateV1Props, ctx: MosaicEngineContext) {
    return renderLogoAnimateTutorial(ctx);
  },
};

registerTemplate(LogoAnimateV1);
export default LogoAnimateV1;
