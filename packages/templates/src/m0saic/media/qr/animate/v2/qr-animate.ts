/**
 * @m0saic/media/qr/animate/v2
 *
 * Live-conversion QR animator. Takes an arbitrary URL (or a caller-supplied
 * SVG) and produces an M0 string at render time:
 *
 *   - URL path: `qrToRenderable` from `@m0saic/template-utils` (which calls
 *     the in-house `qrToM0` encoder). No SVG, no `sharp`, no PNG raster.
 *   - SVG path: `svgToM0` from `@m0saic/dsl-stdlib` (caller supplies the
 *     SVG geometry — useful for non-QR vector content or for testing
 *     against a known-good fixture).
 *
 * Modules are then animated with the same pixelate-in expressions as v1
 * Phase 1. The M-region phase from v1 is intentionally NOT carried over —
 * v2 is the "any URL, any QR" template; the brand-M overlay is the job of
 * the dictionary-driven flow (v1). The Phase 2 follow-up template carves a
 * safe area and splices a user-supplied media asset in the centre.
 */

import { asTemplateId } from "@m0saic/types";
import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicSource,
  MosaicTemplate,
} from "@m0saic/types";
import {
  queryFrames,
  svgToM0,
  toM0String,
  type PackingMode,
} from "@m0saic/dsl-stdlib";
import {
  definePropsSchema,
  makeColorTile,
  makeErrorMosaic,
  qrToRenderable,
  registerTemplate,
} from "@m0saic/template-utils";
import {
  buildModuleAlphaExpr,
  buildModuleGleamFactor,
  buildPseudoRanks,
  buildTileOffsetExpr,
  type RankInputTile,
} from "../v1/expressions";

const BRAND_ORANGE: MosaicColor = "#f97316";
const BG_LIGHT: MosaicColor = "#ffffff";
const BG_DARK: MosaicColor = "#000000";
const DEFAULT_VARIANT: "light" | "dark" = "light";
const DEFAULT_TILE_COLOR: MosaicColor = BRAND_ORANGE;
const DEFAULT_SPAWN_DUR_MS = 1000;
const DEFAULT_TILE_FADE_MS = 220;
const DEFAULT_HOLD_DUR_MS = 600;
const DEFAULT_FADE_OUT_DUR_MS = 700;
const DEFAULT_TILE_OFFSET_PX = 1;
const DEFAULT_PACKING: PackingMode = "multi";
const DEFAULT_DRIFT_PERCENT = 0;

export type QrAnimateV2Props = {
  /**
   * Text to encode as a QR (URL, plain string, or structured payload).
   * Required when {@link svg} is not provided. The template runs the
   * text through the in-house `qrToM0` encoder (via
   * `@m0saic/template-utils`'s `qrToRenderable`) at render time —
   * no SVG round-trip, no PNG raster. The resulting per-module mask is
   * then animated.
   */
  text?: string;

  /**
   * Caller-supplied SVG string. Bypasses QR generation entirely — useful
   * for testing, for non-QR vector content, or for callers that already
   * generated their own QR. Must contain `<path>` or `<rect>` elements.
   */
  svg?: string;

  /** Drift tolerance for grid inference (% of min canvas dim). Default 0. */
  driftPercent?: number;

  /** Layer-packing strategy. Default "multi". */
  packing?: PackingMode;

  /** Stagger between rank-0 and rank-1 tile fades, in ms. */
  spawnDurMs?: number;

  /** Per-tile fade-in duration in ms. */
  tileFadeMs?: number;

  /** How long every tile holds at full alpha after the spawn wave completes. */
  holdDurMs?: number;

  /** Global fade-out duration. Every tile drops to 0 by render end. */
  fadeOutDurMs?: number;

  /** Per-tile pixel offset (down + right) that decays to 0 during fade-in. */
  tileOffsetPx?: number;

  /** Brand variant selecting the canvas background. */
  variant?: "light" | "dark";

  /** Solid background colour. Overrides {@link variant}'s default. */
  bgColor?: MosaicColor;

  /** Solid colour for module tiles (brand orange by default). */
  tileColor?: MosaicColor;

  /**
   * Optional per-cell gleam over the QR modules — a travelling shine. Off by
   * default; sparing enough that scannability is only transiently affected.
   */
  gleam?: boolean;
};

const propsSchema = definePropsSchema<QrAnimateV2Props>({
  text: {
    type: "string",
    required: false,
    description:
      "Text to encode as a QR at render time (URL, plain string, or structured payload). Required unless `svg` is provided.",
    meta: { control: { flavor: "url", placeholder: "https://www.m0saic.io" }, ui: { label: "Text" } },
  },
  svg: {
    type: "string",
    required: false,
    description:
      "Caller-supplied SVG. Bypasses QR generation. Required unless `text` is provided.",
    meta: { control: { placeholder: "from Text (QR)" }, ui: { label: "SVG string" } },
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
      // Irrelevant to the user at Make time — always rendered as the "multi"
      // default. Kept in the schema for the SVG render path; hidden from the
      // editor form so it isn't a confusing knob.
      ui: { label: "Packing", hidden: true },
    },
  },
  spawnDurMs: {
    type: "number",
    required: false,
    description:
      "Stagger duration: time from first tile to last tile starting their fade-in.",
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
  holdDurMs: {
    type: "number",
    required: false,
    description: "Hold duration at full alpha before fade-out begins.",
    meta: {
      constraints: { min: 0, max: 60_000 },
      ui: { label: "Hold (ms)" },
    },
  },
  fadeOutDurMs: {
    type: "number",
    required: false,
    description: "Global fade-out duration.",
    meta: {
      constraints: { min: 0, max: 10_000 },
      ui: { label: "Fade out (ms)" },
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
    description:
      "Brand variant: 'light' (white bg) or 'dark' (black bg). Modules stay brand orange.",
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
  gleam: {
    type: "boolean",
    required: false,
    description: "Add a travelling per-cell shine over the QR modules.",
    meta: { ui: { label: "Gleam" } },
  },
});

export const QrAnimateV2: MosaicTemplate<QrAnimateV2Props> = {
  id: asTemplateId("@m0saic/media/qr/animate/v2"),
  label: "QR Spawn (v2, deprecated)",
  version: 2,
  // BITMAP drafting mode (handbook §3c): the split counts ARE the QR module grid —
  // never live-composed, so the latticeSmooth convention does not apply.
  lattice: { mode: "bitmap" },
  description:
    "Animated QR — modules pixelate in with a staggered fade, hold, then fade out. Accepts any URL (or a caller-supplied SVG).",
  deprecated: {
    reason:
      "Merged into QR Code (media/qr/code/v1): the spawn is its Output mp4 mode (envelope under Animation; fade-out opt-in via fadeOutDurMs; text path expression-identical) and the caller-SVG hatch is advanced.svg. The unified card adds module styles, the carved centre, and static output from the same surface. Render-time gleam retired by design. Kept as the spawn reference.",
    replacement: asTemplateId("@m0saic/media/qr/code/v1"),
    since: "2026-07-22",
  },
  capabilities: { tier: "core" },
  tags: ["brand", "qr", "animated", "svg-to-mosaic"],
  outputHints: {
    fps: 30,
    durationMs:
      DEFAULT_SPAWN_DUR_MS +
      DEFAULT_TILE_FADE_MS +
      DEFAULT_HOLD_DUR_MS +
      DEFAULT_FADE_OUT_DUR_MS,
    width: 1222,
    height: 1222,
    note: "Square QR; modules spawn-in → hold → fade out.",
    // Editor preview lands mid-hold (after spawn + fade, half-way through the
    // hold) so the QR is fully visible while the user types the URL. The
    // render still starts at t=0; scrubbing back shows the spawn.
    posterTimeMs:
      DEFAULT_SPAWN_DUR_MS + DEFAULT_TILE_FADE_MS + Math.round(DEFAULT_HOLD_DUR_MS / 2),
    // Declared so the Make page's template-fetch effect snaps Output
    // Type → Video on swap (otherwise a prior image-template selection
    // would leave the Image chip stale).
    format: { kind: "video", container: "mp4" },
  },
  propsSchema,
  defaultProps: {
    variant: DEFAULT_VARIANT,
    driftPercent: DEFAULT_DRIFT_PERCENT,
    packing: DEFAULT_PACKING,
    spawnDurMs: DEFAULT_SPAWN_DUR_MS,
    tileFadeMs: DEFAULT_TILE_FADE_MS,
    holdDurMs: DEFAULT_HOLD_DUR_MS,
    fadeOutDurMs: DEFAULT_FADE_OUT_DUR_MS,
    tileOffsetPx: DEFAULT_TILE_OFFSET_PX,
    tileColor: DEFAULT_TILE_COLOR,
    gleam: false,
  },

  async render(
    props: QrAnimateV2Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    const variant = props.variant ?? this.defaultProps!.variant!;
    const bgColor = props.bgColor ?? (variant === "dark" ? BG_DARK : BG_LIGHT);
    const driftPercent =
      props.driftPercent ?? this.defaultProps!.driftPercent!;
    const packing = props.packing ?? this.defaultProps!.packing!;
    const spawnDurMs = props.spawnDurMs ?? this.defaultProps!.spawnDurMs!;
    const tileFadeMs = props.tileFadeMs ?? this.defaultProps!.tileFadeMs!;
    const holdDurMs = props.holdDurMs ?? this.defaultProps!.holdDurMs!;
    const fadeOutDurMs =
      props.fadeOutDurMs ?? this.defaultProps!.fadeOutDurMs!;
    const tileOffsetPx =
      props.tileOffsetPx ?? this.defaultProps!.tileOffsetPx!;
    const tileColor = props.tileColor ?? this.defaultProps!.tileColor!;
    const gleam = props.gleam ?? this.defaultProps!.gleam ?? false;

    // ── Validation ────────────────────────────────────────────────
    const errs: string[] = [];
    if (!props.text && !props.svg) {
      errs.push("either `text` or `svg` is required");
    }
    if (props.text && props.svg) {
      errs.push(
        "specify exactly one of `text` or `svg` (not both)",
      );
    }
    if (!(driftPercent >= 0 && driftPercent <= 5)) {
      errs.push(`driftPercent must be in [0, 5] (got ${driftPercent})`);
    }
    if (packing !== "one" && packing !== "multi") {
      errs.push(`packing must be "one" or "multi" (got "${packing}")`);
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

    if (errs.length) {
      return makeErrorMosaic(errs.join(" | "), {
        title: `${this.id} props`,
        width: ctx.output.width,
        height: ctx.output.height,
      });
    }

    // ── 1) Generate M0 directly (text via qrToRenderable, or SVG via svgToM0) ──
    //
    // Text path: qrToRenderable wraps the in-house `qrToM0` encoder. No SVG,
    // no PNG raster — the m0 is the QR module grid and we ignore its
    // sources here (Phase 2 below builds per-cell sources with animation
    // overlays attached).
    //
    // SVG path: kept for caller-supplied SVGs (testing, non-QR vector
    // content). Goes through `svgToM0`'s grid inference as before.
    let m0: string;
    try {
      if (props.svg) {
        m0 = String(svgToM0(props.svg, { driftPercent, packing }));
      } else {
        const qr = qrToRenderable({
          text: props.text!,
          moduleColor: tileColor,
          errorCorrectionLevel: "H",
        });
        m0 = String(qr.m0);
      }
    } catch (err) {
      return makeErrorMosaic(
        `QR generation failed: ${err instanceof Error ? err.message : String(err)}`,
        {
          title: `${this.id} qr-gen`,
          width: ctx.output.width,
          height: ctx.output.height,
        },
      );
    }

    // ── 3) Identify visible (animatable) tiles ────────────────────
    const visibleFrames = queryFrames(m0, {
      width: ctx.output.width,
      height: ctx.output.height,
    }).logical();

    if (visibleFrames.length === 0) {
      return makeErrorMosaic(
        "Converted m0 contains no visible tiles to animate",
        {
          title: `${this.id} parse`,
          width: ctx.output.width,
          height: ctx.output.height,
        },
      );
    }

    // Pseudo-random ranks for the pixelate-in effect. Same expression
    // module as v1; same deterministic hash-shuffle behaviour.
    const tileInputs: RankInputTile[] = visibleFrames.map((f) => ({
      x: f.x,
      y: f.y,
      logicalIndex: f.logicalIndex,
    }));
    const ranks = buildPseudoRanks(tileInputs);

    // ── 4) Phase timing ──────────────────────────────────────────
    //
    //   0 ─── spawn ──── modulesEnd ── hold ── exitStart ── fadeOut ── end
    //
    const spawnDurSec = spawnDurMs / 1000;
    const tileFadeSec = tileFadeMs / 1000;
    const modulesEndSec = spawnDurSec + tileFadeSec;
    const exitStartSec = modulesEndSec + holdDurMs / 1000;
    const fadeOutSec = fadeOutDurMs / 1000;

    // ── 5) Build per-tile color sources ──────────────────────────
    const sources: MosaicSource[] = visibleFrames.map((_tile, i) => {
      const rank = ranks[i]!;
      const baseAlpha = buildModuleAlphaExpr(rank, {
        spawnDurSec,
        tileFadeSec,
        exitStartSec,
        fadeOutSec,
      });
      // Optional travelling per-cell shine over the modules (shows during the
      // hold). Keeps a high floor alpha, so the QR stays scannable.
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
      });
    });

    return {
      kind: "mosaic_document",
      version: 1,
      m0: toM0String(m0, "QrAnimateV2"),
      sources,
      assets: {} as MosaicDocument["assets"],
      backgroundColor: bgColor,
    };
  },
};

registerTemplate(QrAnimateV2);
export default QrAnimateV2;
