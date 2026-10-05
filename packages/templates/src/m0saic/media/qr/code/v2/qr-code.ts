/**
 * @m0saic/media/qr/code/v2 — "QR Code"
 *
 * THE standalone QR template — the 2026-07-21/22 merge of the four QR cards
 * that shared one engine with scattered knobs:
 *
 *   - `media/qr/basic/v1` ("Brand QR", deprecated): plain square modules via
 *     `qrToRenderable` — now the `moduleStyle: "square"` path, byte-identical.
 *   - `media/qr/rounded/v1` ("Brand QR — Rounded", deprecated): circle /
 *     rounded-square modules with the 3-layer concentric eye treatment
 *     (`eyes` channel + `makeQrEyeChildDoc` splice) and an optional carved
 *     centre asset — now the styled path, byte-identical at its defaults.
 *   - `media/qr/carve/v1` ("Brand QR — Carve", DELETED 2026-07-22): centre
 *     media + pixelate spawn — now the `center` group + `animation` group
 *     (the centre path additionally gains the eye treatment carve never
 *     had). Deleted rather than archived: no parity anchor and no unique
 *     consumer survived the fold.
 *   - `media/qr/animate/v2` ("Brand QR — Spawn", deprecated): spawn → hold →
 *     fade-out envelope + the caller-SVG hatch — now the `animation` group
 *     (fade-out opt-in via fadeOutDurMs) + `advanced.svg`; the text path is
 *     expression-identical.
 *
 * Dispatch: `moduleStyle: "square"` with no centre asset and no radius
 * overrides takes basic's plain path (eyes render as ordinary matrix
 * modules — the classic look). Any styling or a centre asset takes the
 * channels path (square style there = radius 0 on modules and eyes). The
 * spawn animation threads through BOTH paths (per-module rank alpha +
 * settle offset from the shared animate/v1 expression engine; eyes fade in
 * first as units; the centre stays visible from t=0), and `advanced.svg`
 * bypasses QR generation entirely.
 *
 * Fully in-house on every QR path: no sharp, no PNG raster — every module
 * is a lavfi tile in the document's m0.
 */

import { asAssetId, asTemplateId } from "@m0saic/types";
import type {
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicSource,
} from "@m0saic/types";
import { queryFrames, svgToM0, toM0String } from "@m0saic/dsl-stdlib";
import { buildBrandMCenterDoc } from "../../_shared/brandMCenter";
import {
  defineMosaicTemplate,
  definePropsSchema,
  determineMediaType,
  makeColorTile,
  makeErrorMosaic,
  qrToRenderable,
  registerTemplate,
  solidBackground,
  type PropBindingEntry,
} from "@m0saic/template-utils";
import { withAddHandles } from "../../../../_shared/canvas-handles";
// Spawn-animation expression builders — the same animate/v1 engine the
// deprecated Carve and Spawn templates rode (and the attribution bake uses).
import {
  buildModuleAlphaExpr,
  buildModuleGleamFactor,
  buildPseudoRanks,
  buildTileOffsetExpr,
  type RankInputTile,
} from "../../animate/v1/expressions";

const BRAND_ORANGE: MosaicColor = "#f97316";
const BG_LIGHT: MosaicColor = "#ffffff";
const BG_DARK: MosaicColor = "#000000";

/** Min version forced when the centre cutout is enabled (ECC H headroom). */
const CUTOUT_MIN_VERSION = 6;
const CENTER_CHILD_KEY = "center";


/**
 * Resolve the centre config. `show: false` → no centre at all (the UI's
 * off switch). Otherwise: an assetPath → the caller's media; unset/empty →
 * the in-house m0saic M (the branded default look — pure dictionary
 * geometry, no file anywhere, so it works on web too).
 */
type CenterResolution =
  | { kind: "none" }
  | { kind: "brandM" }
  | { kind: "asset"; path: string };

function resolveCenter(center: QrCodeCenterConfig): CenterResolution {
  if (center.show === false) return { kind: "none" };
  const trimmed = center.assetPath?.trim();
  if (!trimmed) return { kind: "brandM" };
  return { kind: "asset", path: trimmed };
}

// The default centre M lives in `../../_shared/brandMCenter` (shared with the
// user QR stamp since 2026-09-16, so both carve the same M).

export type QrCodeModuleStyle = "square" | "roundedSquare" | "circle";

/** Module/eye styling group (the rounded-heritage knobs). */
export type QrCodeStyleConfig = {
  /** Override module corner radius (0..1). Default derives from moduleStyle. */
  moduleBorderRadius?: number;
  /** Outer eye corner radius (0..1). Default 0.3 (square style: 0). */
  eyeOuterBorderRadius?: number;
  /** Inner eye dot corner radius (0..1). Default 0.5 (square style: 0). */
  eyeInnerDotBorderRadius?: number;
};

/** Deliverable format — the reserved prop-bag knob (screencap/trickplay
 * precedent): "png" renders the static QR image; "mp4" renders the spawn
 * animation (modules pixelate in). Make's Output Type follows this prop. */
export type QrCodeOutputFormat = "png" | "mp4";

/** Spawn-animation envelope (Carve/Spawn heritage — the animate/v1 engine).
 * Active when `outputFormat: "mp4"`. */
export type QrCodeAnimationConfig = {
  /** Stagger: time from first to last tile starting its fade-in (ms). */
  spawnDurMs?: number;
  /** Per-tile fade-in duration (ms). */
  tileFadeMs?: number;
  /** Hold at full alpha after spawn completes (ms). Ignored when fadeOutDurMs is 0. */
  holdDurMs?: number;
  /**
   * Global fade-out duration (ms). 0 (default) = no fade-out: the code
   * spawns in and HOLDS to the end of the render (a deliverable that stays
   * scannable). Non-zero = the full Spawn envelope (spawn → hold → fade out).
   */
  fadeOutDurMs?: number;
  /** Per-tile pixel offset (down/right) that decays during fade-in. */
  tileOffsetPx?: number;
  /**
   * Travelling per-cell shine over the data modules during the hold —
   * animate/v1's module gleam (a shimmer band sweeps rank space; cells dip
   * to a high alpha floor so the code stays scannable). Eyes and the
   * centre are untouched. Off by default.
   */
  gleam?: boolean;
};

/** Advanced escape hatches. */
export type QrCodeAdvancedConfig = {
  /**
   * Caller-supplied SVG string — bypasses QR generation entirely (testing,
   * non-QR vector content, pre-generated QRs). Mutually exclusive with the
   * module/center styling; the animation group still applies.
   */
  svg?: string;
  /** Drift tolerance for SVG grid inference (% of min canvas dim). */
  driftPercent?: number;
};

/** Carved centre-asset group. */
export type QrCodeCenterConfig = {
  /**
   * Whether to carve a centre at all. Default true. False → a plain QR
   * (no cutout, no version floor) — THE off switch; there is no magic
   * assetPath value.
   */
  show?: boolean;
  /**
   * Image or video that fills the centre safe area. Unset/empty → the
   * in-house m0saic M (the branded default — dictionary geometry, no
   * file).
   */
  assetPath?: string;
  /** Safe-area width in canvas pixels. Default 272. */
  width?: number;
  /** Safe-area height in canvas pixels. Default 272. */
  height?: number;
  /** Padding between modules and the centre frame, % of max dim. Default 8. */
  paddingPct?: number;
};

export type QrCodeV2Props = {
  /** Text to encode (URL, plain string, or structured payload). */
  text?: string;
  /** "png" = static image (default); "mp4" = spawn animation. */
  outputFormat?: QrCodeOutputFormat;
  /** Background mode. `transparent` omits the canvas background (alpha PNG). */
  mode?: "light" | "dark" | "transparent";
  /** Override the mode-derived background colour (#rrggbb). */
  backgroundColor?: string;
  /** Fill colour for data modules and eye dark layers. Default brand orange. */
  moduleColor?: string;
  /** Module shape. Default "square" — the classic brand QR. */
  moduleStyle?: QrCodeModuleStyle;
  /** Module/eye radii fine-tuning (collapsible group). */
  style?: QrCodeStyleConfig;
  /** Carved centre asset (collapsible group). */
  center?: QrCodeCenterConfig;
  /** Spawn animation (collapsible group). */
  animation?: QrCodeAnimationConfig;
  /** Escape hatches: caller SVG input (collapsible group). */
  advanced?: QrCodeAdvancedConfig;
  /**
   * Force QR version (1–40). Default auto; a centre cutout forces ≥6 so the
   * code stays scannable after the centre modules are removed. Bump higher
   * if a printed code fails to scan.
   */
  version?: number;
};

const DEFAULTS = {
  text: "https://www.m0saic.io",
  mode: "light" as "light" | "dark" | "transparent",
  moduleColor: BRAND_ORANGE,
  moduleStyle: "circle" as QrCodeModuleStyle,
  eyeOuterBorderRadius: 0.3,
  eyeInnerDotBorderRadius: 0.5,
  centerWidth: 272,
  centerHeight: 272,
  centerPaddingPct: 8,
};

function defaultModuleBorderRadius(style: QrCodeModuleStyle): number {
  if (style === "circle") return 1.0;
  if (style === "roundedSquare") return 0.3;
  return 0;
}

const propsSchema = definePropsSchema<QrCodeV2Props>({
  text: {
    type: "string",
    required: false,
    meta: { control: { flavor: "url" } },
  },
  // Reserved prop-bag convention (trickplay/screencap precedent): a prop
  // named `outputFormat` holding a container name drives the Make page's
  // Output Type + container + default output extension.
  outputFormat: {
    type: "string",
    required: false,
    meta: { constraints: { oneOf: ["png", "mp4"] } },
  },
  mode: {
    type: "string",
    required: false,
    meta: { constraints: { oneOf: ["light", "dark", "transparent"] } },
  },
  moduleStyle: {
    type: "string",
    required: false,
    meta: { constraints: { oneOf: ["square", "roundedSquare", "circle"] } },
  },
  moduleColor: {
    type: "string",
    required: false,
    meta: { constraints: { isColor: true }, control: { colorPicker: true, defaultColor: "#f97316" } },
  },
  backgroundColor: {
    type: "string",
    required: false,
    meta: { constraints: { isColor: true }, control: { colorPicker: true } },
  },
  style: {
    type: "group" as never,
    required: false,
    fields: {
      moduleBorderRadius: {
        type: "number", required: false,
        meta: { constraints: { min: 0, max: 1 } },
      },
      eyeOuterBorderRadius: {
        type: "number", required: false,
        meta: { constraints: { min: 0, max: 1 } },
      },
      eyeInnerDotBorderRadius: {
        type: "number", required: false,
        meta: { constraints: { min: 0, max: 1 } },
      },
    },
  } as never,
  center: {
    type: "group" as never,
    required: false,
    fields: {
      show: {
        type: "boolean", required: false,
      },
      assetPath: {
        type: "media", required: false,
        meta: { control: { picker: "file", accept: ["image", "video"] } },
      },
      width: {
        type: "number", required: false,
        meta: { constraints: { min: 32, max: 4096 } },
      },
      height: {
        type: "number", required: false,
        meta: { constraints: { min: 32, max: 4096 } },
      },
      paddingPct: {
        type: "number", required: false,
        meta: { constraints: { min: 0, max: 49 } },
      },
    },
  } as never,
  animation: {
    type: "group" as never,
    required: false,
    fields: {
      spawnDurMs: {
        type: "number", required: false,
        meta: { constraints: { min: 100, max: 60000 } },
      },
      tileFadeMs: {
        type: "number", required: false,
        meta: { constraints: { min: 0, max: 10000 } },
      },
      holdDurMs: {
        type: "number", required: false,
        meta: { constraints: { min: 0, max: 60000 } },
      },
      fadeOutDurMs: {
        type: "number", required: false,
        meta: { constraints: { min: 0, max: 10000 } },
      },
      tileOffsetPx: {
        type: "number", required: false,
        meta: { constraints: { min: 0, max: 100 } },
      },
      gleam: {
        type: "boolean", required: false,
      },
    },
  } as never,
  advanced: {
    type: "group" as never,
    required: false,
    fields: {
      svg: {
        type: "string", required: false,
      },
      driftPercent: {
        type: "number", required: false,
        meta: { constraints: { min: 0, max: 5 } },
      },
    },
  } as never,
  version: {
    type: "number",
    required: false,
    meta: { constraints: { min: 1, max: 40 } },
  },
});

const ANIM_DEFAULTS = {
  spawnDurMs: 1000,
  tileFadeMs: 220,
  holdDurMs: 1200,
  fadeOutDurMs: 0,
  tileOffsetPx: 1,
  gleam: false,
};

type ResolvedAnimation = {
  on: boolean;
  spawnDurSec: number;
  tileFadeSec: number;
  exitStartSec: number;
  fadeOutSec: number;
  tileOffsetPx: number;
  gleam: boolean;
};

/**
 * Resolve the animation group to expression-phase seconds. With
 * `fadeOutDurMs: 0` (the default) the code spawns in and HOLDS forever —
 * the Carve deliverable semantics (`exitStart` pushed past any real render).
 * Non-zero fade-out gives the full Spawn envelope: spawn → hold → fade out.
 */
function resolveAnimation(
  cfg: QrCodeAnimationConfig | undefined,
  on: boolean,
): ResolvedAnimation {
  const spawnDurMs = cfg?.spawnDurMs ?? ANIM_DEFAULTS.spawnDurMs;
  const tileFadeMs = cfg?.tileFadeMs ?? ANIM_DEFAULTS.tileFadeMs;
  const holdDurMs = cfg?.holdDurMs ?? ANIM_DEFAULTS.holdDurMs;
  const fadeOutDurMs = cfg?.fadeOutDurMs ?? ANIM_DEFAULTS.fadeOutDurMs;
  const spawnDurSec = spawnDurMs / 1000;
  const tileFadeSec = tileFadeMs / 1000;
  const holdForever = fadeOutDurMs <= 0;
  return {
    on,
    spawnDurSec,
    tileFadeSec,
    exitStartSec: holdForever ? 1e9 : spawnDurSec + tileFadeSec + holdDurMs / 1000,
    fadeOutSec: holdForever ? 0.001 : fadeOutDurMs / 1000,
    tileOffsetPx: cfg?.tileOffsetPx ?? ANIM_DEFAULTS.tileOffsetPx,
    gleam: cfg?.gleam ?? ANIM_DEFAULTS.gleam,
  };
}

/** Per-module spawn overlay (alpha + settle offset) for rank `rank`. */
function spawnOverlay(anim: ResolvedAnimation, rank: number): Record<string, string> {
  const baseAlpha = buildModuleAlphaExpr(rank, {
    spawnDurSec: anim.spawnDurSec,
    tileFadeSec: anim.tileFadeSec,
    exitStartSec: anim.exitStartSec,
    fadeOutSec: anim.fadeOutSec,
  });
  // Gleam MULTIPLIES the envelope alpha (animate/v1 discipline), so the
  // shine only shows during the hold; data modules only — the eye layers
  // take their own rank-0 path and never gleam.
  const alpha = anim.gleam
    ? `(${baseAlpha})*(${buildModuleGleamFactor(rank)})`
    : baseAlpha;
  const offset = buildTileOffsetExpr(rank, {
    spawnDurSec: anim.spawnDurSec,
    tileFadeSec: anim.tileFadeSec,
    offsetPx: anim.tileOffsetPx,
  });
  return { alpha, xExpr: offset, yExpr: offset };
}

/** Ranks for the spawn stagger, index-aligned with the m0's logical frames. */
function ranksForM0(m0: string, w: number, h: number): number[] {
  const frames = queryFrames(m0, { width: w, height: h }).logical();
  const tiles: RankInputTile[] = frames.map((f) => ({
    x: f.x,
    y: f.y,
    logicalIndex: f.logicalIndex,
  }));
  return buildPseudoRanks(tiles);
}

// ── v2: canvas handles ────────────────────────────────────────────────
// The code IS its payload: every module is a handle for `text` (click the QR
// anywhere → edit what it encodes), then the ink it is drawn in. What else a
// rect offers is what THAT rect shows:
//   - a data module: its corner radius (styled path);
//   - a finder eye: the card colour its light ring paints, the two eye radii,
//     and the version (the finders are where a denser code shows first);
//   - the centre: the asset (a drop target) and the safe area it sits in;
//   - an SVG-input tile: the SVG it was traced from, and the trace tolerance.
// Timing (the spawn envelope) is declared — it shows on no rect.
const PAYLOAD_HANDLES: ReadonlyArray<PropBindingEntry> = [{ propKey: "text" }, { propKey: "moduleColor" }];
const MODULE_HANDLES: ReadonlyArray<PropBindingEntry> = [...PAYLOAD_HANDLES, { propKey: "style.moduleBorderRadius" }];
const EYE_HANDLES: ReadonlyArray<PropBindingEntry> = [
  ...PAYLOAD_HANDLES,
  { propKey: "backgroundColor" },
  { propKey: "style.eyeOuterBorderRadius" },
  { propKey: "style.eyeInnerDotBorderRadius" },
  { propKey: "version" },
];
const CENTER_HANDLES: ReadonlyArray<PropBindingEntry> = [
  { propKey: "center.assetPath" },
  { propKey: "center.width" },
  { propKey: "center.height" },
  { propKey: "center.paddingPct" },
];
const SVG_HANDLES: ReadonlyArray<PropBindingEntry> = [
  { propKey: "advanced.svg" },
  { propKey: "moduleColor" },
  { propKey: "advanced.driftPercent" },
];

const withHandles = (sources: MosaicSource[], handlesFor: (index: number) => ReadonlyArray<PropBindingEntry>): MosaicSource[] =>
  sources.map((source, index) => withAddHandles(source, handlesFor(index)));

function backgroundFor(
  mode: "light" | "dark" | "transparent",
  override: string | undefined,
): MosaicColor | undefined {
  if (override) return override as MosaicColor;
  if (mode === "transparent") return undefined;
  return mode === "dark" ? BG_DARK : BG_LIGHT;
}

export const QrCodeV2 = defineMosaicTemplate<QrCodeV2Props>({
  id: asTemplateId("@m0saic/media/qr/code/v2"),
  version: 2,
  // BITMAP drafting mode (handbook §3c): the split counts ARE the QR module grid —
  // never live-composed, so the latticeSmooth convention does not apply.
  lattice: { mode: "bitmap" },
  capabilities: {
    tier: "capability",
    caps: { fs: { read: true, write: true, temp: true } },
  },

  // No `format` hint (screencap precedent): the animation knob picks
  // png (static) vs mp4 (spawn) per render, and each rendered doc declares
  // its own container.
  outputHints: {
    format: { kind: "image", container: "png" },
    width: 1080,
    height: 1080,
    fps: 30,
    durationMs: 2000,
    note:
      "Square QR rendered as in-house m0 (no PNG raster). Spawn animation renders an mp4. " +
      "Render at a SQUARE canvas — a non-square canvas stretches the code uniformly " +
      "(accepted v1 behavior, founder ruling 08-27; no contain letterboxing here). " +
      "Transparent mode: the card is truly transparent, but a centre child sits on an " +
      "opaque box until the child-carrier engine candidate lands " +
      "— use " +
      "center.show:false for fully transparent output.",
  },

  propsSchema,
  bindings: {
    unbound: {
      "animation.spawnDurMs": "timing",
      "animation.tileFadeMs": "timing",
      "animation.holdDurMs": "timing",
      "animation.fadeOutDurMs": "timing",
      "animation.tileOffsetPx": "spawn animation (Output mp4)",
      // Carried by every tile when the code is traced from an SVG instead.
      "advanced.svg": "SVG input mode",
      "advanced.driftPercent": "SVG input mode",
    },
  },
  // The branded default look: circle modules on a light card with the
  // m0saic M carved in the centre (resolved at render — see resolveCenter).
  // Swap the centre asset + the URL to make it yours.
  defaultProps: {
    advanced: { driftPercent: 0 },
    animation: { spawnDurMs: 1000, tileFadeMs: 220, holdDurMs: 1200, fadeOutDurMs: 0, tileOffsetPx: 1, gleam: false },
    moduleColor: "#EF7525",
    text: DEFAULTS.text,
    outputFormat: "png" as QrCodeOutputFormat,
    mode: DEFAULTS.mode,
    moduleStyle: DEFAULTS.moduleStyle,
    // Seeds Make's form so the Show Center toggle starts visibly ON —
    // the form renders an unset boolean as off, but the M renders by
    // default; without this seed the toggle would lie.
    center: { paddingPct: 8, height: 272, width: 272, show: true },
  },

  async render(
    props: QrCodeV2Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    const text = props.text ?? DEFAULTS.text;
    const mode = props.mode ?? DEFAULTS.mode;
    const moduleColor = (props.moduleColor ?? DEFAULTS.moduleColor) as MosaicColor;
    const moduleStyle = props.moduleStyle ?? DEFAULTS.moduleStyle;
    const style = props.style ?? {};
    const center = props.center ?? {};
    const centerResolution = resolveCenter(center);
    const hasCutout = centerResolution.kind !== "none";
    const bg = backgroundFor(mode, props.backgroundColor);
    const anim = resolveAnimation(
      props.animation,
      (props.outputFormat ?? "png") === "mp4",
    );
    // Per-doc container: spawn animation renders a video; static a PNG.
    // (Each rendered doc declares its own container so the Output pick
    // follows the knob; the template-level hint mirrors the knob DEFAULT so
    // a share link at defaults carries no format ask.)
    const docFormat = anim.on
      ? ({ kind: "video", container: "mp4" } as const)
      : mode === "transparent"
        ? // Transparent mode MUST ship alpha — without the pixelFormat the
          // resolver defaults the PNG to rgb24 and the transparency silently
          // flattens to black (gate-22 battery catch; `--alpha` shouldn't be
          // required for a mode whose entire point is transparency).
          ({ kind: "image", container: "png", pixelFormat: "rgba" } as const)
        : ({ kind: "image", container: "png" } as const);

    const errTitle = "QR Code";
    const fail = (err: unknown) =>
      makeErrorMosaic(
        `QrCode: ${err instanceof Error ? err.message : String(err)}`,
        { title: errTitle, width: ctx.target.width, height: ctx.target.height },
      );

    // ── SVG escape hatch (Spawn heritage): caller geometry, no QR gen ──
    // Styling/center don't apply (the SVG is its own geometry); mode/bg and
    // the animation group do.
    if (props.advanced?.svg) {
      let m0: string;
      try {
        m0 = String(
          svgToM0(props.advanced.svg, {
            driftPercent: props.advanced.driftPercent ?? 0,
            packing: "multi",
          }),
        );
      } catch (err) {
        return fail(err);
      }
      const frames = queryFrames(m0, {
        width: ctx.output.width,
        height: ctx.output.height,
      }).logical();
      if (frames.length === 0) {
        return makeErrorMosaic("QrCode: SVG produced no visible tiles.", {
          title: errTitle,
          width: ctx.target.width,
          height: ctx.target.height,
        });
      }
      const ranks = anim.on
        ? buildPseudoRanks(
            frames.map((f) => ({ x: f.x, y: f.y, logicalIndex: f.logicalIndex })),
          )
        : [];
      const sources: MosaicSource[] = frames.map((_f, i) =>
        anim.on
          ? makeColorTile(moduleColor, { overlay: spawnOverlay(anim, ranks[i]!) })
          : makeColorTile(moduleColor),
      );
      return {
        kind: "mosaic_document",
        version: 1,
        m0: toM0String(m0, "QrCode"),
        sources: withHandles(sources, () => SVG_HANDLES),
        assets: {} as MosaicDocument["assets"],
        format: docFormat,
        ...(bg !== undefined ? { backgroundColor: solidBackground(bg) } : {}),
      };
    }

    // ── Plain path (basic-v1 heritage, byte-identical) ────────────────
    // Square modules, no styling overrides, no cutout, no forced version:
    // the eyes are ordinary matrix modules — the classic brand QR.
    const isPlain =
      moduleStyle === "square" &&
      !hasCutout &&
      style.moduleBorderRadius === undefined &&
      style.eyeOuterBorderRadius === undefined &&
      style.eyeInnerDotBorderRadius === undefined &&
      !props.version;
    if (isPlain) {
      let renderable;
      try {
        renderable = qrToRenderable({
          text,
          moduleColor,
          errorCorrectionLevel: "H",
        });
      } catch (err) {
        return fail(err);
      }
      // Spawn animation: rebuild every module tile with its rank overlay
      // (all frames are modules on the plain path).
      let sources = renderable.sources as MosaicSource[];
      if (anim.on) {
        const ranks = ranksForM0(String(renderable.m0), renderable.canvasW, renderable.canvasH);
        sources = sources.map((_src, i) =>
          makeColorTile(moduleColor, { overlay: spawnOverlay(anim, ranks[i]!) }),
        );
      }
      return {
        kind: "mosaic_document",
        version: 1,
        m0: toM0String(String(renderable.m0), "QrCode"),
        // The plain path re-uses qrToRenderable's tiles when static — copy
        // each before hanging handles on it (never write into a helper's output).
        sources: withHandles(sources.map((source) => ({ ...(source as object) }) as MosaicSource), () => PAYLOAD_HANDLES),
        assets: {} as MosaicDocument["assets"],
        ...(anim.on ? {} : { fps: 30, durationMs: 2000 }),
        format: docFormat,
        // `solidBackground` keeps the bg opaque on the rgba PNG output (the
        // engine's bgFill otherwise defaults alpha-output bgs to transparent).
        ...(bg !== undefined ? { backgroundColor: solidBackground(bg) } : {}),
      };
    }

    // ── Styled path (rounded-v1 heritage, byte-identical at its defaults) ──
    const moduleBorderRadius =
      style.moduleBorderRadius ?? defaultModuleBorderRadius(moduleStyle);
    const eyeOuterBorderRadius =
      style.eyeOuterBorderRadius ??
      (moduleStyle === "square" ? 0 : DEFAULTS.eyeOuterBorderRadius);
    const eyeInnerDotBorderRadius =
      style.eyeInnerDotBorderRadius ??
      (moduleStyle === "square" ? 0 : DEFAULTS.eyeInnerDotBorderRadius);
    const safeAreaWidth = center.width ?? DEFAULTS.centerWidth;
    const safeAreaHeight = center.height ?? DEFAULTS.centerHeight;
    const paddingPct = center.paddingPct ?? DEFAULTS.centerPaddingPct;

    // Version: caller wins; a cutout floors at V6 for post-carve scannability.
    const resolvedVersion =
      props.version && props.version > 0
        ? props.version
        : hasCutout
          ? CUTOUT_MIN_VERSION
          : undefined;

    // The eyes channel needs a concrete background for its light layers even
    // in transparent mode.
    const eyeBackground: MosaicColor =
      bg ?? (mode === "dark" ? BG_DARK : BG_LIGHT);
    let qr;
    try {
      qr = qrToRenderable({
        text,
        moduleColor,
        errorCorrectionLevel: "H",
        backgroundColor: eyeBackground,
        eyes: {
          darkColor: moduleColor,
          outerBorderRadius: eyeOuterBorderRadius,
          innerLightBorderRadius: eyeOuterBorderRadius,
          innerDotBorderRadius: eyeInnerDotBorderRadius,
        },
        ...(resolvedVersion ? { version: resolvedVersion } : {}),
        ...(hasCutout
          ? {
              safeArea: {
                width: safeAreaWidth,
                height: safeAreaHeight,
                paddingPct,
              },
            }
          : {}),
      });
    } catch (err) {
      return fail(err);
    }
    if (qr.sources.length === 0) {
      return makeErrorMosaic("QrCode: composed QR has no renderable frames.", {
        title: errTitle,
        width: ctx.target.width,
        height: ctx.target.height,
      });
    }

    // Source order from the eye-splice mode:
    //   [0..dataEnd)          data-cell tiles (re-styled below)
    //   [dataEnd..dataEnd+9)  3 eye-child-doc sources per finder (pre-styled)
    //   [last]                optional safe-area splice
    const eyeBlockCount = (qr.channelByRole.eyes?.frames.length ?? 0) * 3;
    const safeAreaCount = hasCutout && qr.safeAreaStableKey ? 1 : 0;
    const dataCellEnd = qr.sources.length - eyeBlockCount - safeAreaCount;

    // Spawn ranks over the final m0 (index-aligned with sources). Eyes get
    // rank 0 — each finder fades in as a unit, first, so the code reads
    // immediately (the animate/v1 eye discipline); the centre stays visible
    // from t=0 (the Carve discipline).
    const ranks = anim.on ? ranksForM0(String(qr.m0), qr.canvasW, qr.canvasH) : [];
    const sources: MosaicSource[] = qr.sources.map((src, i) => {
      if (i < dataCellEnd) {
        return makeColorTile(moduleColor, {
          effects: {
            rounding: {
              borderRadius: moduleBorderRadius,
              cornerStyle: "rounded",
            },
          },
          ...(anim.on ? { overlay: spawnOverlay(anim, ranks[i]!) } : {}),
        });
      }
      if (i >= qr.sources.length - safeAreaCount) {
        return {
          type: "mosaic",
          ref: CENTER_CHILD_KEY,
          placement: { fit: "contain" },
        } satisfies MosaicSource;
      }
      // Eye block: qrToRenderable's pre-styled layers; under spawn they fade
      // in as a unit at rank 0 (alpha only — no settle offset on the eyes).
      if (anim.on) {
        const eyeAlpha = buildModuleAlphaExpr(0, {
          spawnDurSec: anim.spawnDurSec,
          tileFadeSec: anim.tileFadeSec,
          exitStartSec: anim.exitStartSec,
          fadeOutSec: anim.fadeOutSec,
        });
        return {
          ...(src as object),
          overlay: { ...((src as { overlay?: object }).overlay ?? {}), alpha: eyeAlpha },
        } as MosaicSource;
      }
      return src;
    });

    const children: Record<string, MosaicDocument> = {};
    if (centerResolution.kind === "asset") {
      const centerAssetId = asAssetId("qr_code_center");
      const centerMediaType = determineMediaType(centerResolution.path, ctx);
      children[CENTER_CHILD_KEY] = {
        kind: "mosaic_document",
        version: 1,
        m0: toM0String("F", "QrCode-center"),
        assets: {
          [centerAssetId]: {
            kind: "file",
            path: centerResolution.path,
            mediaType: centerMediaType,
          },
        },
        sources: [
          {
            type: "media",
            mediaType: centerMediaType,
            assetId: centerAssetId,
            placement: { fit: "contain" },
          },
        ],
        size: { width: safeAreaWidth, height: safeAreaHeight },
      };
    } else if (centerResolution.kind === "brandM") {
      children[CENTER_CHILD_KEY] = buildBrandMCenterDoc({
        mColor: moduleColor,
        bgColor: bg,
        width: safeAreaWidth,
        height: safeAreaHeight,
      });
    }

    return {
      kind: "mosaic_document",
      version: 1,
      m0: toM0String(String(qr.m0), "QrCode"),
      sources: withHandles(
        sources.map((source) => ({ ...(source as object) }) as MosaicSource),
        (index) =>
          index < dataCellEnd
            ? MODULE_HANDLES
            : index >= qr.sources.length - safeAreaCount
              ? CENTER_HANDLES
              : EYE_HANDLES,
      ),
      assets: {} as MosaicAssetManifest,
      children,
      size: { width: qr.canvasW, height: qr.canvasH },
      format: docFormat,
      ...(bg !== undefined ? { backgroundColor: solidBackground(bg) } : {}),
    };
  },
});

registerTemplate(QrCodeV2);
export default QrCodeV2;
