/**
 * @m0saic/media/qr/animate/v1
 *
 * Deterministic two-phase animation for the m0saic brand QR.
 *
 * **Phase 1 — modules** (always): every visible module tile fades + settles
 * into place on a diagonal TL→BR stagger.
 *
 * **Phase 2 — M region** (when `qrLabels` includes a label whose text
 * matches {@link QrAnimateProps.centreLabel}): the labeled cell hosts a
 * nested sub-doc rendering the canonical m0saic M (from the
 * `brand/m-33` dictionary entry, masked per its rank tiles). The M
 * smoothstep-fades in after modules complete, then breathes gently as a
 * passive idle while the QR is held.
 *
 * When labels are absent or no label matches `centreLabel`, the template
 * degrades to Phase-1-only behavior: every visible cell renders as a
 * module tile.
 */

import { asTemplateId } from "@m0saic/types";
import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicSource,
  MosaicSourceMask,
  MosaicTemplate,
} from "@m0saic/types";
import { toM0String, queryFrames, weightedSplit, placeRects, addOverlayLayer } from "@m0saic/dsl-stdlib";
import {
  definePropsSchema,
  makeColorTile,
  makeErrorMosaic,
  makeQrEyeChildDoc,
  registerTemplate,
} from "@m0saic/template-utils";
import { registry as dictionaryRegistry, getSourceOrderStableKeys } from "@m0saic/dictionary";
import {
  buildMTileAlphaExpr,
  buildModuleAlphaExpr,
  buildModuleGleamFactor,
  buildPseudoRanks,
  buildTileOffsetExpr,
  type RankInputTile,
} from "./expressions";

const BRAND_ORANGE: MosaicColor = "#f97316";
const BG_LIGHT: MosaicColor = "#ffffff";
const BG_DARK: MosaicColor = "#000000";
const DEFAULT_TILE_COLOR: MosaicColor = BRAND_ORANGE; // modules
const DEFAULT_M_COLOR: MosaicColor = BRAND_ORANGE; // centre M (always orange)
const DEFAULT_VARIANT: "light" | "dark" = "light";
const DEFAULT_SPAWN_DUR_MS = 1000;
const DEFAULT_TILE_FADE_MS = 220;
const DEFAULT_TILE_OFFSET_PX = 1;
const DEFAULT_CENTRE_LABEL = "safe-area";
const DEFAULT_M_DELAY_MS = 200;
const DEFAULT_M_IN_DUR_MS = 700;
const DEFAULT_M_TILE_FADE_MS = 220;
const DEFAULT_IDLE_DUR_MS = 4000;
const DEFAULT_FADE_OUT_DUR_MS = 700;
// Loading-UI shape (matches brand/logo/v3 loading_ui_v2 defaults).
const M_LOADING_BASE_MIN = 0.55;
const M_LOADING_BASE_MAX = 0.85;
const M_LOADING_BASE_PULSE_SEC = 1.6;
const M_LOADING_SHIMMER_SEC = 1.2;
const M_LOADING_SHIMMER_WIDTH = 0.22;
const M_LOADING_SHIMMER_AMP = 0.75;

/** Brand M dictionary entry id (rect-with-masks variant). */
const M_DICT_ID = "brand/m-33";
const M_REF = "m_logo";

/**
 * Rounded finder-eye ("Instagram") treatment defaults. Each of the three
 * 7×7 finder patterns is covered by a single concentric rounded eye —
 * outer rounded square, inner light ring, rounded centre dot — instead of
 * the raw grid of per-cell dots. `0.35` outer / `1.0` (circular) centre dot
 * matches the Instagram-style reference.
 */
const DEFAULT_EYE_OUTER_RADIUS = 0.35;
const DEFAULT_EYE_DOT_RADIUS = 1.0;

/**
 * Finder geometry of the brand QR (`brand/qr`): a version-6 code — 41×41
 * matrix — with a 4-module quiet zone (49×49 grid total). Finder patterns
 * sit at the three corners. Overridable for other QRs routed through this
 * template.
 */
const DEFAULT_MATRIX_SIZE = 41;
const DEFAULT_QUIET_ZONE = 4;

/** Every finder pattern spans 7×7 modules (ISO 18004). */
const FINDER_SPAN = 7;

/** Rank driving the eyes' fade-in — early, so the finders read immediately. */
const EYE_FADE_RANK = 0.15;

/** Inner-doc key for the QR child when the URL strip wraps the QR. */
const QR_INNER_REF = "qr_inner";

/**
 * Default human-readable label rendered below the QR when the asset
 * is consumed in landscape-taller-than-square mode (i.e. the build
 * script renders at canvasWidth × (canvasWidth + stripHeight)). Lets
 * viewers reach m0saic.io even when they can't scan the QR (e.g.
 * watching a video on the same device they'd scan from). Pass the
 * empty string to disable the strip.
 */
const DEFAULT_URL_LABEL = "https://m0saic.io";

/**
 * Text fill colors for the URL label. Picked to invert the variant's
 * background — dark text on the light variant's white plate, white
 * text on the dark variant's black plate.
 */
const URL_TEXT_COLOR_LIGHT_VARIANT: MosaicColor = "#111111";
const URL_TEXT_COLOR_DARK_VARIANT: MosaicColor = "#f5f5f5";

export type QrAnimateProps = {
  /**
   * The m0 string describing the QR layout. Required.
   * Plain m0 or the m0 field of an m0c file.
   */
  qrM0?: string;

  /**
   * Optional m0c labels map (`stableKey → { text, color? }`) used to
   * locate the centre safe-area cell. When provided AND a label's `text`
   * matches {@link centreLabel}, that cell hosts the M sub-doc. When
   * absent, the template renders modules only.
   *
   * Typical call site: `qrLabels: registry.byId["brand/qr"].labels`.
   */
  qrLabels?: Record<string, { text: string; color?: string }>;

  /** Time (ms) from rank-0 tile starting its fade to rank-1 tile starting its fade. */
  spawnDurMs?: number;

  /** Per-tile fade-in duration (ms). Each tile takes this long to go 0→1. */
  tileFadeMs?: number;

  /**
   * Idle duration (ms) — how long the M holds in its loading-UI breathing
   * phase after entrance, before the global fade-out starts. Modules sit
   * at full alpha during this window.
   */
  idleDurMs?: number;

  /**
   * Global fade-out duration (ms). Every visible tile (modules + M)
   * smoothstep-fades to 0 over this window. Lets the rendered asset be
   * dropped into a stamp pipeline that resizes / time-warps it without
   * having to author the entrance / exit separately.
   */
  fadeOutDurMs?: number;

  /**
   * Pixel offset (down + right) each tile starts from, decays to 0 by
   * the time the tile finishes fading in. 1–2 px reads as "luxury watch";
   * >3 starts to feel ad-like.
   */
  tileOffsetPx?: number;

  /**
   * Brand variant selecting the canvas background:
   * - `"light"` → white background (the default; contrast against dark scenes when stamped).
   * - `"dark"`  → black background (contrast against light scenes).
   *
   * Modules and the centre M stay brand orange in both variants. Override
   * via {@link bgColor} when you need a custom plate.
   */
  variant?: "light" | "dark";

  /**
   * Solid background colour. Overrides {@link variant}'s default.
   * Use `"none"` for a transparent base (caller composites their own plate).
   */
  bgColor?: MosaicColor;

  /** Solid colour for module tiles (brand orange by default). */
  tileColor?: MosaicColor;

  /** Solid colour for the centre M region (brand orange by default). */
  mColor?: MosaicColor;

  /**
   * Gap (ms) between the last module finishing its fade and the M
   * starting its entrance. Small (~200ms) so the QR doesn't feel laggy.
   */
  mDelayMs?: number;

  /** M entrance window (ms) — all 33 rects converge by `mDelayMs + mInDurMs`. */
  mInDurMs?: number;

  /**
   * Per-rect smoothstep duration during the M's staggered entrance (ms).
   * Together with `mInDurMs` and the rank set, controls how "assembled"
   * the rect arrival feels.
   */
  mTileFadeMs?: number;

  /**
   * Label text identifying the centre safe-area cell in `qrLabels`.
   * Defaults to `"safe-area"`. No-op when `qrLabels` is absent.
   */
  centreLabel?: string;

  /**
   * Optional per-cell gleam over the QR MODULE cells — a travelling shine
   * (same shimmer shape as the M, but ranked over the modules). Off by
   * default. Stacks under the M's own gleam. Used by the qr-stamp seed bake.
   */
  gleam?: boolean;

  /**
   * Human-readable URL label rendered in a strip beneath the QR.
   * Lets viewers reach m0saic.io even when they can't scan the QR
   * (e.g. watching a video on the same device they'd scan from).
   *
   * Activated when the rendering context's canvas is taller than
   * wide: `ctx.output.height > ctx.output.width`. The QR fills the
   * top `canvasWidth × canvasWidth` square; the URL strip fills the
   * remaining `canvasWidth × (canvasHeight - canvasWidth)` band at
   * the bottom. Stays inert at square canvases (existing
   * 1222×1222 builds keep their behavior unchanged).
   *
   * Defaults to `"https://m0saic.io"`. Pass the empty string to
   * suppress the strip even on tall canvases.
   *
   * Text fades on the same envelope as the QR modules (spawn-in
   * over the modules' spawn window, hold through the idle, fade
   * out on the global exit).
   */
  urlLabel?: string;

  /**
   * Optional per-module corner radius (0..1). Default `0` = square tiles
   * (the canonical look). Set `1.0` for circular dots — each finder cell
   * also becomes a circle, giving a "dot matrix" QR look. Doesn't affect
   * the centre M sub-doc or the URL strip text.
   *
   * Backwards-compatible: omitting this prop keeps the existing square
   * tiles, so committed brand-asset mp4s rebuild byte-identical until
   * the build script opts in.
   */
  moduleBorderRadius?: number;

  /**
   * Render the three finder patterns as single "Instagram-style" rounded
   * eyes — an outer rounded square, an inner light ring, and a rounded
   * centre dot — instead of the raw grid of per-cell dots. The underlying
   * per-cell finder modules are suppressed so their circles don't poke
   * past the rounded ring.
   *
   * Pass `true` for the defaults ({@link DEFAULT_EYE_OUTER_RADIUS} outer /
   * circular centre dot), or an object to tune the corner radii (0..1).
   *
   * Requires the QR's finder geometry — see {@link matrixSize} /
   * {@link quietZone} (defaulted to the brand QR's version-6 layout).
   * Backwards-compatible: omitting this prop leaves the QR m0 untouched, so
   * committed builds without eyes rebuild byte-identical.
   */
  eyes?:
    | boolean
    | {
        /** Outer rounded-square corner radius (0..1). Default 0.35. */
        outerBorderRadius?: number;
        /** Inner light-ring corner radius (0..1). Default matches outer. */
        innerLightBorderRadius?: number;
        /** Centre dot corner radius (0..1). Default 1.0 (circle). */
        innerDotBorderRadius?: number;
      };

  /**
   * QR matrix side length in modules (no quiet zone). Used only when
   * {@link eyes} is set, to locate the finder patterns. Default 41 (the
   * brand QR's version 6).
   */
  matrixSize?: number;

  /**
   * Quiet-zone modules per side. Used only when {@link eyes} is set, to
   * locate the finder patterns. Default 4 (the brand QR).
   */
  quietZone?: number;
};

const propsSchema = definePropsSchema<QrAnimateProps>({
  qrM0: {
    type: "m0c",
    required: true,
    description:
      "m0 (or m0c) string describing the QR layout. The 'm0c' prop type " +
      "lets the editor surface a Layout picker that supports per-cell labels — " +
      "step 2 reads a centre safe-area label to drive the M region phase.",
  },
  spawnDurMs: {
    type: "number",
    required: false,
    description: "Stagger duration: time from first tile to last tile starting their fade-in.",
    meta: {
      constraints: { min: 100, max: 60_000 },
      ui: { label: "Spawn (ms)" },
    },
  },
  tileFadeMs: {
    type: "number",
    required: false,
    description: "Per-tile fade-in duration.",
    meta: {
      constraints: { min: 0, max: 10_000 },
      ui: { label: "Fade (ms)" },
    },
  },
  tileOffsetPx: {
    type: "number",
    required: false,
    description: "Pixel offset (down/right) each tile starts from.",
    meta: {
      constraints: { min: 0, max: 100 },
      ui: { label: "Settle (px)" },
    },
  },
  variant: {
    type: "string",
    required: false,
    description: "Brand variant: 'light' (white bg) or 'dark' (black bg). Modules stay brand orange.",
    meta: {
      constraints: { oneOf: ["light", "dark"] },
      ui: { label: "Variant" },
    },
  },
  bgColor: {
    type: "string",
    required: false,
    description: "Background colour override. Defaults from variant.",
    meta: {
      constraints: { isColor: true },
      ui: { label: "Background" },
      control: { colorPicker: true, placeholder: BG_LIGHT },
    },
  },
  tileColor: {
    type: "string",
    required: false,
    description: "Module fill colour.",
    meta: {
      constraints: { isColor: true },
      ui: { label: "Tile color" },
      control: { colorPicker: true, placeholder: DEFAULT_TILE_COLOR },
    },
  },
  qrLabels: {
    type: "json",
    required: false,
    description: "m0c labels map (stableKey → { text, color? }). Optional; required for the M phase.",
    meta: { ui: { label: "Labels" } },
  },
  mColor: {
    type: "string",
    required: false,
    description: "M region fill colour.",
    meta: {
      constraints: { isColor: true },
      ui: { label: "M color" },
      control: { colorPicker: true, placeholder: DEFAULT_M_COLOR },
    },
  },
  mDelayMs: {
    type: "number",
    required: false,
    description: "Pause between modules done and M entrance starting.",
    meta: {
      constraints: { min: 0, max: 60_000 },
      ui: { label: "M delay (ms)" },
    },
  },
  mInDurMs: {
    type: "number",
    required: false,
    description: "M entrance window (all 33 rects converge by this).",
    meta: {
      constraints: { min: 0, max: 10_000 },
      ui: { label: "M in (ms)" },
    },
  },
  mTileFadeMs: {
    type: "number",
    required: false,
    description: "Per-rect smoothstep duration during M entrance.",
    meta: {
      constraints: { min: 0, max: 10_000 },
      ui: { label: "M rect fade (ms)" },
    },
  },
  idleDurMs: {
    type: "number",
    required: false,
    description: "Idle hold duration after M entrance, before fade-out.",
    meta: {
      constraints: { min: 0, max: 60_000 },
      ui: { label: "Idle (ms)" },
    },
  },
  fadeOutDurMs: {
    type: "number",
    required: false,
    description: "Global fade-out duration (every tile drops to 0 by render end).",
    meta: {
      constraints: { min: 0, max: 10_000 },
      ui: { label: "Fade out (ms)" },
    },
  },
  centreLabel: {
    type: "string",
    required: false,
    description: "Label text identifying the centre safe-area cell in qrLabels.",
    meta: { ui: { label: "Centre label" } },
  },
  gleam: {
    type: "boolean",
    required: false,
    description: "Add a travelling per-cell shine over the QR modules (stacks under the M gleam).",
    meta: { ui: { label: "Module gleam" } },
  },
  moduleBorderRadius: {
    type: "number",
    required: false,
    description:
      "Per-module corner radius (0..1). 0 = square (default). 1.0 = circular dots — gives the QR a dot-matrix look. Doesn't touch the centre M or URL strip.",
    meta: { constraints: { min: 0, max: 1 }, ui: { label: "Module border radius" } },
  },
  eyes: {
    type: "json",
    required: false,
    description:
      "Render the 3 finder patterns as single rounded 'Instagram' eyes (true, or an object with outerBorderRadius / innerLightBorderRadius / innerDotBorderRadius). Underlying finder cells are suppressed.",
    meta: { ui: { label: "Rounded eyes" } },
  },
  matrixSize: {
    type: "number",
    required: false,
    description: "QR matrix side length in modules (no quiet zone). Only used with `eyes`. Default 41 (brand QR / version 6).",
    meta: { constraints: { min: 21, max: 177 }, ui: { label: "Matrix size" } },
  },
  quietZone: {
    type: "number",
    required: false,
    description: "Quiet-zone modules per side. Only used with `eyes`. Default 4.",
    meta: { constraints: { min: 0, max: 16 }, ui: { label: "Quiet zone" } },
  },
  urlLabel: {
    type: "string",
    required: false,
    description:
      "Human-readable URL rendered in a strip below the QR (active when canvas is taller than wide). Empty string disables.",
    meta: { ui: { label: "URL label" } },
  },
});

export const QrAnimate: MosaicTemplate<QrAnimateProps> = {
  id: asTemplateId("@m0saic/media/qr/animate/v1"),
  label: "QR — Animated Tile Spawn",
  version: 1,
  // BITMAP drafting mode (handbook §3c): the split counts ARE the QR module grid —
  // never live-composed, so the latticeSmooth convention does not apply.
  lattice: { mode: "bitmap" },
  description:
    "Deterministic per-tile spawn-in animation for a pre-baked QR m0 string. " +
    "Engine-internal: feeds `tools/build-qr-rendered.cjs` which produces the " +
    "committed mp4 loops consumed by `qr-stamp/video/v2`. User-facing " +
    "callers should pick `Brand QR — Spawn` (`qr-animate/v2`) instead, which " +
    "accepts a URL directly.",
  capabilities: { tier: "core" },
  // Engine-internal: this template takes a pre-baked qrM0 string and animates it.
  // The user-facing entry point is qr-animate/v2 which generates the QR live
  // from a URL and then routes through this same animation envelope.
  internal: true,
  tags: ["brand", "qr", "animated", "internal"],
  outputHints: {
    fps: 30,
    // Total envelope: modules pixelate → gap → M assembles → idle hold → fade out.
    durationMs:
      DEFAULT_SPAWN_DUR_MS +
      DEFAULT_TILE_FADE_MS +
      DEFAULT_M_DELAY_MS +
      DEFAULT_M_IN_DUR_MS +
      DEFAULT_IDLE_DUR_MS +
      DEFAULT_FADE_OUT_DUR_MS,
    width: 1222,
    height: 1222,
    note: "Square QR; pixelate-in → M assembles → idle breathe → fade out.",
  },
  propsSchema,
  defaultProps: {
    quietZone: 4,
    matrixSize: 41,
    moduleBorderRadius: 0,
    variant: DEFAULT_VARIANT,
    spawnDurMs: DEFAULT_SPAWN_DUR_MS,
    tileFadeMs: DEFAULT_TILE_FADE_MS,
    idleDurMs: DEFAULT_IDLE_DUR_MS,
    fadeOutDurMs: DEFAULT_FADE_OUT_DUR_MS,
    tileOffsetPx: DEFAULT_TILE_OFFSET_PX,
    tileColor: DEFAULT_TILE_COLOR,
    mColor: DEFAULT_M_COLOR,
    mDelayMs: DEFAULT_M_DELAY_MS,
    mInDurMs: DEFAULT_M_IN_DUR_MS,
    mTileFadeMs: DEFAULT_M_TILE_FADE_MS,
    centreLabel: DEFAULT_CENTRE_LABEL,
    gleam: false,
    urlLabel: DEFAULT_URL_LABEL,
  },

  async render(props: QrAnimateProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const qrM0 = props.qrM0;
    const qrLabels = props.qrLabels;
    const gleam = props.gleam ?? this.defaultProps!.gleam ?? false;
    const variant = props.variant ?? this.defaultProps!.variant!;
    const bgColor = props.bgColor ?? (variant === "dark" ? BG_DARK : BG_LIGHT);
    const spawnDurMs = props.spawnDurMs ?? this.defaultProps!.spawnDurMs!;
    const tileFadeMs = props.tileFadeMs ?? this.defaultProps!.tileFadeMs!;
    const tileOffsetPx = props.tileOffsetPx ?? this.defaultProps!.tileOffsetPx!;
    const tileColor = props.tileColor ?? this.defaultProps!.tileColor!;
    const mColor = props.mColor ?? this.defaultProps!.mColor!;
    const mDelayMs = props.mDelayMs ?? this.defaultProps!.mDelayMs!;
    const mInDurMs = props.mInDurMs ?? this.defaultProps!.mInDurMs!;
    const mTileFadeMs = props.mTileFadeMs ?? this.defaultProps!.mTileFadeMs!;
    const idleDurMs = props.idleDurMs ?? this.defaultProps!.idleDurMs!;
    const fadeOutDurMs = props.fadeOutDurMs ?? this.defaultProps!.fadeOutDurMs!;
    const centreLabel = props.centreLabel ?? this.defaultProps!.centreLabel!;
    const urlLabel = (props.urlLabel ?? this.defaultProps!.urlLabel ?? "").trim();
    const moduleBorderRadius = props.moduleBorderRadius ?? this.defaultProps!.moduleBorderRadius ?? 0;

    // Rounded finder-eye treatment. `eyes` may be `true` (defaults) or an
    // object of per-layer radii. Unset → the QR m0 is left untouched below.
    const eyesProp = props.eyes ?? this.defaultProps!.eyes;
    const eyesEnabled =
      eyesProp === true || (typeof eyesProp === "object" && eyesProp !== null);
    const eyeStyle =
      typeof eyesProp === "object" && eyesProp !== null ? eyesProp : {};
    const eyeOuterR = eyeStyle.outerBorderRadius ?? DEFAULT_EYE_OUTER_RADIUS;
    // Inner light ring matches the outer radius by default for visual
    // continuity (mirrors makeQrEyeChildDoc's own default).
    const eyeInnerLightR = eyeStyle.innerLightBorderRadius ?? eyeOuterR;
    const eyeDotR = eyeStyle.innerDotBorderRadius ?? DEFAULT_EYE_DOT_RADIUS;
    const matrixSize = props.matrixSize ?? DEFAULT_MATRIX_SIZE;
    const quietZone = props.quietZone ?? DEFAULT_QUIET_ZONE;

    // URL-strip layout. The strip activates only when the caller renders
    // at a taller-than-wide canvas — the build script controls this via
    // `-w 1222 -h 1342`. Square canvases keep the existing behavior
    // (no strip, QR fills the canvas) so external e2e fixtures don't
    // break. The strip's height is whatever the caller reserved above
    // the QR's square footprint.
    const stripHeightPx = Math.max(0, ctx.output.height - ctx.output.width);
    const useUrlStrip = urlLabel.length > 0 && stripHeightPx > 0;
    const qrCanvasW = ctx.output.width;
    const qrCanvasH = useUrlStrip ? ctx.output.width : ctx.output.height;

    const errs: string[] = [];
    if (!qrM0 || qrM0.trim().length === 0) {
      errs.push("qrM0 is required (non-empty m0 string)");
    }
    if (!(spawnDurMs >= 100 && spawnDurMs <= 60_000)) {
      errs.push(`spawnDurMs must be in [100, 60000] (got ${spawnDurMs})`);
    }
    if (!(tileFadeMs >= 0 && tileFadeMs <= 10_000)) {
      errs.push(`tileFadeMs must be in [0, 10000] (got ${tileFadeMs})`);
    }
    if (!(tileOffsetPx >= 0 && tileOffsetPx <= 100)) {
      errs.push(`tileOffsetPx must be in [0, 100] (got ${tileOffsetPx})`);
    }
    if (!(idleDurMs >= 0 && idleDurMs <= 60_000)) {
      errs.push(`idleDurMs must be in [0, 60000] (got ${idleDurMs})`);
    }
    if (!(fadeOutDurMs >= 0 && fadeOutDurMs <= 10_000)) {
      errs.push(`fadeOutDurMs must be in [0, 10000] (got ${fadeOutDurMs})`);
    }

    if (errs.length) {
      return makeErrorMosaic(errs.join(" | "), {
        title: `${this.id} props`,
        width: ctx.output.width,
        height: ctx.output.height,
      });
    }

    // Optionally overlay the three rounded finder eyes onto the QR. Each
    // 7×7 finder pattern is covered by an opaque concentric rounded eye
    // (outer rounded square → inner light ring → rounded centre dot) placed
    // via `placeRects` over the same 49-cell grid as the base, so it aligns
    // to the finder cells. The underlying per-cell finder modules are
    // suppressed (rendered transparent) in the source loop below so their
    // circles don't poke past the rounded ring. When `eyes` is unset the m0
    // is untouched and non-eyes builds rebuild byte-identical.
    let m0 = qrM0!;
    let finderRegionsPx: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
    let eyeCellPx = 0;
    if (eyesEnabled) {
      const N = matrixSize + 2 * quietZone;
      const finderCells = [
        { x: quietZone, y: quietZone }, // top-left
        { x: N - quietZone - FINDER_SPAN, y: quietZone }, // top-right
        { x: quietZone, y: N - quietZone - FINDER_SPAN }, // bottom-left
      ];
      const eyeChildM0 = String(
        makeQrEyeChildDoc({
          darkColor: tileColor,
          backgroundColor: bgColor,
          outerBorderRadius: eyeOuterR,
          innerLightBorderRadius: eyeInnerLightR,
          innerDotBorderRadius: eyeDotR,
        }).m0,
      );
      // Full-canvas eyes layer: `placeRects` isolates each finder 7×7 rect
      // on the shared N-cell grid (guaranteed alignment with the base
      // finder cells) and fills the rest with nulls.
      const eyesGrid = String(
        placeRects({
          rootW: N,
          rootH: N,
          rects: finderCells.map((c) => ({
            x: c.x,
            y: c.y,
            w: FINDER_SPAN,
            h: FINDER_SPAN,
            claimant: eyeChildM0,
          })),
        }).m0,
      );
      // Stack it onto the QR. The brand QR already carries a root overlay
      // (the safe-area carve), and m0 forbids sibling-overlay chains
      // (`base{a}{b}`) — so `addOverlayLayer` nests the eyes as the deepest
      // root-level overlay (`base{sa}` → `base{sa{eyes}}`), the canonical
      // `{{}}` chaining. Existing stableKeys (incl. the safe-area cell the M
      // phase targets) are preserved; the eyes become new leaves.
      m0 = String(addOverlayLayer(m0, eyesGrid));
      eyeCellPx = qrCanvasW / N;
      finderRegionsPx = finderCells.map((c) => ({
        x0: c.x * eyeCellPx,
        y0: c.y * eyeCellPx,
        x1: (c.x + FINDER_SPAN) * eyeCellPx,
        y1: (c.y + FINDER_SPAN) * eyeCellPx,
      }));
    }

    // Whether a parsed frame's centre falls inside any finder region.
    const frameInFinder = (f: { x: number; y: number; width: number; height: number }): boolean => {
      if (!eyesEnabled) return false;
      const cx = f.x + f.width / 2;
      const cy = f.y + f.height / 2;
      return finderRegionsPx.some(
        (r) => cx >= r.x0 && cx < r.x1 && cy >= r.y0 && cy < r.y1,
      );
    };

    // `queryFrames(m0).logical()` returns rendered (visible) leaves in
    // logical / DFS order — passthrough / null tiles in the centre safe
    // area are already filtered out. `meta.stableKey` is the lookup key
    // used to match against `qrLabels` keys.
    //
    // Use the QR-only canvas dims (`qrCanvasW × qrCanvasH`) here, not
    // `ctx.output.*` — when the URL strip is active the QR is rendered
    // into a square child doc whose dimensions are the canvas WIDTH on
    // both axes; the strip occupies the rest of the canvas height.
    const visibleFrames = queryFrames(m0, {
      width: qrCanvasW,
      height: qrCanvasH,
    }).logical();

    if (visibleFrames.length === 0) {
      return makeErrorMosaic("qrM0 contains no visible tiles to animate", {
        title: `${this.id} parse`,
        width: ctx.output.width,
        height: ctx.output.height,
      });
    }

    // Locate the safe-area cell via labels. The label whose `text`
    // matches `centreLabel` points at the stableKey of one frame;
    // resolve to that frame's logicalIndex (== its index in `visibleFrames`
    // since the parser sorts by logicalIndex). If no label matches or
    // qrLabels is absent, we degrade to module-only behavior — every
    // visible tile is a module.
    let safeAreaIdx = -1;
    if (qrLabels) {
      let safeAreaSk: string | null = null;
      for (const [sk, label] of Object.entries(qrLabels)) {
        if (label.text === centreLabel) {
          safeAreaSk = sk;
          break;
        }
      }
      if (safeAreaSk) {
        const found = visibleFrames.findIndex(
          (f) => (f.meta.stableKey as unknown as string) === safeAreaSk,
        );
        if (found >= 0) safeAreaIdx = found;
      }
    }

    // Pseudo-random ranks for module tiles — produces a "pixelate into
    // focus" feel rather than a diagonal sweep. Each module gets a
    // hash-shuffled rank in [0, 1] based on its logicalIndex (stable,
    // deterministic, no PRNG state). The safe-area cell is excluded so
    // it doesn't consume a rank slot.
    const moduleTiles: RankInputTile[] = [];
    for (const f of visibleFrames) {
      if (f.logicalIndex === safeAreaIdx) continue;
      // Finder-region frames (eye layers + suppressed finder cells) are
      // handled separately below — keep their indices out of the module
      // rank set so the pixelate stagger stays distributed over real data
      // modules only.
      if (frameInFinder(f)) continue;
      moduleTiles.push({ x: f.x, y: f.y, logicalIndex: f.logicalIndex });
    }
    const moduleRanks = buildPseudoRanks(moduleTiles);
    const rankByLogicalIndex = new Map<number, number>();
    moduleTiles.forEach((t, i) => rankByLogicalIndex.set(t.logicalIndex, moduleRanks[i]!));

    // ── Phase timing (one shared timeline across modules + M sub-doc) ──
    //
    //   0 ────── spawn ──── modulesEnd ── mDelay ── mStart ── mInEnd ── exitStart ── end
    //   modules pixelate in     hold full alpha     M assembles  loading idle   fade out
    //
    // Modules: spawn (0..modulesEndSec) → hold (full alpha) → exit (exitStart..end).
    // M tiles: 0 (suppressed) → entrance (mStart..mInEnd) → idle → exit (exitStart..end).
    // bg: static throughout (consumers cross-fade the asset into host content).
    const spawnDurSec = spawnDurMs / 1000;
    const tileFadeSec = tileFadeMs / 1000;
    const modulesEndSec = spawnDurSec + tileFadeSec;
    const mStartSec = modulesEndSec + mDelayMs / 1000;
    const mInEndSec = mStartSec + mInDurMs / 1000;
    const exitStartSec = mInEndSec + idleDurMs / 1000;
    const fadeOutSec = fadeOutDurMs / 1000;

    // M sub-doc — per-tile self-timed alpha (entrance + loading idle + exit).
    // Parent's overlay on the mosaic ref is just a passthrough now.
    const mDoc = safeAreaIdx >= 0
      ? buildMSubDoc({
          mColor,
          bgColor,
          mStartSec,
          mInDurSec: mInDurMs / 1000,
          mTileFadeSec: mTileFadeMs / 1000,
          exitStartSec,
          fadeOutSec,
        })
      : null;

    // Per-tile dispatch:
    //   safe-area cell → nested mosaic ref into the masked M sub-doc.
    //                    No overlay needed — the inner self-times.
    //   modules       → solid-colour tile with combined spawn+hold+exit
    //                    alpha + per-tile pixelate offset.
    const sources: MosaicSource[] = visibleFrames.map((tile, i) => {
      if (i === safeAreaIdx && mDoc) {
        return {
          type: "mosaic",
          ref: M_REF,
        };
      }
      // Finder region: paint the concentric rounded eye layers and suppress
      // the underlying per-cell finder modules. The three overlaid eye
      // frames per finder are distinguished by size (outer 7-cell → inner
      // light 5-cell → centre dot 3-cell); anything smaller is a base
      // finder cell to hide.
      if (eyesEnabled && frameInFinder(tile)) {
        const eyeAlpha = buildModuleAlphaExpr(EYE_FADE_RANK, {
          spawnDurSec,
          tileFadeSec,
          exitStartSec,
          fadeOutSec,
        });
        const eyeTile = (color: MosaicColor, radius: number): MosaicSource =>
          makeColorTile(color, {
            overlay: { alpha: eyeAlpha },
            effects: {
              rounding: { borderRadius: radius, cornerStyle: "rounded" },
            },
          });
        if (tile.width >= 6 * eyeCellPx) return eyeTile(tileColor, eyeOuterR); // outer dark square
        if (tile.width >= 4 * eyeCellPx) return eyeTile(bgColor, eyeInnerLightR); // inner light ring
        if (tile.width >= 2 * eyeCellPx) return eyeTile(tileColor, eyeDotR); // centre dot
        // Underlying finder module cell → fully transparent (occupies its
        // 1:1 source slot but paints nothing, so no circle bleeds past the ring).
        return makeColorTile(tileColor, { overlay: { alpha: "0" } });
      }
      const rank = rankByLogicalIndex.get(i)!;
      const baseAlpha = buildModuleAlphaExpr(rank, {
        spawnDurSec,
        tileFadeSec,
        exitStartSec,
        fadeOutSec,
      });
      // Optional per-cell module gleam — a travelling shine over the QR
      // modules. Multiplies the spawn/hold/exit alpha, so it only shows during
      // the hold. Stacks under the M's own (more prominent) loading shimmer;
      // the M cell above is a nested ref and is untouched here.
      const alpha = gleam
        ? `(${baseAlpha})*(${buildModuleGleamFactor(rank)})`
        : baseAlpha;
      const offsetExpr = buildTileOffsetExpr(rank, {
        spawnDurSec,
        tileFadeSec,
        offsetPx: tileOffsetPx,
      });
      return makeColorTile(tileColor, {
        overlay: { alpha, xExpr: offsetExpr, yExpr: offsetExpr },
        ...(moduleBorderRadius > 0
          ? {
              effects: {
                rounding: {
                  borderRadius: moduleBorderRadius,
                  cornerStyle: "rounded",
                },
              },
            }
          : {}),
      });
    });

    const qrDoc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      m0: toM0String(m0, "QrAnimate"),
      sources,
      assets: {} as MosaicDocument["assets"],
      backgroundColor: bgColor,
      ...(mDoc ? { children: { [M_REF]: mDoc } } : {}),
    };

    if (!useUrlStrip) {
      return qrDoc;
    }

    // URL-strip wrap. Build a parent doc with a weighted 2-cell row
    // split: top cell hosts the QR child via a `mosaic` ref, bottom
    // cell hosts a `text` source for the human-readable URL.
    //
    // The text fades on the QR's spawn → hold → exit envelope so the
    // strip feels like part of the same animation. The parent's
    // backgroundColor matches the QR's bgColor — both cells share a
    // continuous solid plate underneath the animated content.
    const textColor: MosaicColor =
      variant === "dark"
        ? URL_TEXT_COLOR_DARK_VARIANT
        : URL_TEXT_COLOR_LIGHT_VARIANT;
    const urlAlphaExpr = buildUrlAlphaExpr({
      modulesEndSec,
      exitStartSec,
      fadeOutSec,
    });
    // Font size proportional to the strip height. Tuned so the URL
    // glyphs fill nearly the entire strip vertically, leaving only a
    // small natural "quiet area" of padding above/below — about 15%
    // of strip height total (split top/bottom). At the build
    // script's default 120 px strip that's ~102 px font, ~9 px
    // padding each side. Bigger text reads better when the stamp is
    // downscaled to the bottom-right of a user's video.
    const fontSize = Math.max(16, Math.round(stripHeightPx * 0.85));

    const urlSource: MosaicSource = {
      type: "text",
      // Strip backdrop matches the QR card's bg color — white plate
      // under the light variant, black plate under the dark. Stays
      // solid throughout (consumers / qr-stamp apply a global alpha
      // to the whole asset for see-through-on-user-video composition;
      // we don't double-fade the bg here).
      visual: { backgroundColor: bgColor },
      layers: [
        {
          content: { kind: "literal", text: urlLabel },
          // Text fill inverts the bg so the URL is legible:
          // dark text on white plate, light text on black plate.
          style: { fontSize, fontColor: textColor } as never,
          placement: {
            hAlign: "center",
            vAlign: "middle",
            xExpr: "(w-tw)/2",
            yExpr: "(h-th)/2",
          } as never,
          // Only the text fades on the QR's spawn/exit envelope.
          // The strip's plate stays solid throughout — it reads as
          // an extension of the QR's card on the user's video.
          overlay: { alpha: urlAlphaExpr },
        },
      ],
    };

    return {
      kind: "mosaic_document",
      version: 1,
      // Weighted 2-cell row split: QR cell (`qrCanvasH` weight) on
      // top, URL strip (`stripHeightPx` weight) on bottom. Precision
      // 100 gives a tidy `100[…]` m0 with the right proportions.
      m0: weightedSplit([qrCanvasH, stripHeightPx], "row", {
        precision: 100,
        mode: "literal",
      }),
      sources: [
        { type: "mosaic", ref: QR_INNER_REF },
        urlSource,
      ],
      assets: {} as MosaicDocument["assets"],
      backgroundColor: bgColor,
      children: { [QR_INNER_REF]: qrDoc },
    };
  },
};

/**
 * Alpha expression for the URL strip's text. Mirrors the QR's
 * spawn → hold → exit envelope so the URL appears as the modules
 * finish their pixelate-in pass, holds through the idle, and fades
 * out with the global exit. Same `t` semantics as the per-tile
 * expressions (global wall-clock seconds).
 */
function buildUrlAlphaExpr(opts: {
  modulesEndSec: number;
  exitStartSec: number;
  fadeOutSec: number;
}): string {
  const { modulesEndSec, exitStartSec, fadeOutSec } = opts;
  const m = modulesEndSec.toFixed(3);
  const e = exitStartSec.toFixed(3);
  const f = fadeOutSec.toFixed(3);
  // Three-phase envelope:
  //   t < modulesEndSec       → linear ramp 0 → 1
  //   t < exitStartSec        → hold at 1
  //   t < exitStartSec + fade → linear ramp 1 → 0
  //   otherwise               → 0
  return `if(lt(t,${m}),max(0,t/${m}),if(lt(t,${e}),1,max(0,1-(t-${e})/${f})))`;
}

/**
 * Build the M sub-doc: 33 colour tiles masked into the M's rect shapes
 * from `brand/m-33`. Each tile self-times via the loading_ui_v2 expression
 * (rank-staggered entrance → base breathing + shimmer band → exit fade).
 * The rank set is the dictionary entry's precomputed `diag` rank — same
 * one the editor uses for its loading shimmer.
 *
 * Renders correctly when the safe-area cell is ≥ m-33's feasibility
 * floor (266×266). At the QR's native canvas (1222×1222) the cell is
 * 272×272 — above the floor; the cell-count invariant holds.
 */
function buildMSubDoc(opts: {
  mColor: MosaicColor;
  bgColor: MosaicColor;
  mStartSec: number;
  mInDurSec: number;
  mTileFadeSec: number;
  exitStartSec: number;
  fadeOutSec: number;
}): MosaicDocument {
  const entry = dictionaryRegistry.byId[M_DICT_ID];
  if (!entry) {
    throw new Error(
      `qr-animate: dictionary entry "${M_DICT_ID}" not found; required for the M phase.`,
    );
  }
  // Pull the precomputed diagonal ranks from the dictionary entry's
  // inline `rankSets` (StableKey-keyed). Convert to a positional `number[]`
  // via the entry's source-order keys so the downstream per-tile loop
  // stays index-driven. The lookup is `rankSet.ranks[stableKey]` per
  // source — survives structural edits of the underlying .m0c the same
  // way the masks lookup does. Fallback to a sequential 0..1 sweep when
  // the named set is missing (degraded visual: shimmer becomes
  // sequential-by-index, but renders).
  const sourceKeys = getSourceOrderStableKeys(entry);
  const rankSet = entry.rankSets?.diag;
  const ranks: number[] = rankSet
    ? sourceKeys.map((k) => rankSet.ranks[k] ?? 0)
    : Array.from({ length: entry.sourceCount }, (_, i) =>
        entry.sourceCount <= 1 ? 0 : i / (entry.sourceCount - 1),
      );

  // Inline silhouettes from the dictionary so emitted documents are
  // self-contained — engine reads `source.mask` directly with no extra
  // fetch / cache lookup, and saved documents don't depend on the
  // dictionary being present at consumption time. Source index → StableKey
  // translation reuses the `sourceKeys` computed above.
  const masks = entry.masks ?? {};
  const sources: MosaicSource[] = Array.from({ length: entry.sourceCount }, (_, i) => {
    const m = masks[sourceKeys[i]];
    const mask: MosaicSourceMask | undefined = m
      ? {
          kind: "inline-mask",
          localPath: m.localPath,
          bounds: m.bounds,
        }
      : undefined;
    const alpha = buildMTileAlphaExpr(ranks[i]!, {
      mStartSec: opts.mStartSec,
      mInDurSec: opts.mInDurSec,
      mTileFadeSec: opts.mTileFadeSec,
      baseMin: M_LOADING_BASE_MIN,
      baseMax: M_LOADING_BASE_MAX,
      basePulseSec: M_LOADING_BASE_PULSE_SEC,
      shimmerSec: M_LOADING_SHIMMER_SEC,
      shimmerWidth: M_LOADING_SHIMMER_WIDTH,
      shimmerAmp: M_LOADING_SHIMMER_AMP,
      exitStartSec: opts.exitStartSec,
      fadeOutSec: opts.fadeOutSec,
    });
    return makeColorTile(opts.mColor, { mask, overlay: { alpha } });
  });
  return {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String(entry.m0, "QrAnimate.M"),
    sources,
    assets: {} as MosaicDocument["assets"],
    backgroundColor: opts.bgColor,
  };
}


registerTemplate(QrAnimate);
export default QrAnimate;
