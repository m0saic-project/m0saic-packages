/**
 * @m0saic/media/qr/rounded/v1
 *
 * Tasteful "rounded modules" QR — Instagram-style. Each dark data module
 * renders as a circle (or rounded square); each of the three finder
 * patterns ("eyes") renders as a single rounded-square outer ring with a
 * rounded inner dot, instead of the 49 individual cells they're made of.
 * Optional centre safe-area cutout for a logo.
 *
 * Composition (uses the new stdlib channels API):
 *   - `qrToRenderable({ channels: { eyes: true }, safeArea? })` returns:
 *       • base data sources (one per dark module, finder cells suppressed)
 *       • 3 single-frame eye overlays (qr-eye-tl/tr/bl)
 *       • optional safeArea splice frame (qr-safe-area) when cutout enabled
 *   - We walk the frames and:
 *       • round each data module via `RoundingOptions { borderRadius: 1.0,
 *         cornerStyle: "rounded" }` → circles. Tunable via props if the
 *         caller prefers rounded squares.
 *       • replace each eye frame with a `mosaic` ref to a single shared
 *         `makeQrEyeChildDoc` child — the canonical 3-layer concentric
 *         eye treatment with configurable corner radii.
 *       • replace the safeArea frame (if carving) with a `mosaic` ref to
 *         the user's centre media (image or video).
 *
 * ECC is locked to `"H"` (~30% recoverable) so the centre cutout never
 * scratches the encoded bits beyond the QR's tolerance — same convention
 * as the deleted `qr-carve/v1` once did.
 */

import { asTemplateId } from "@m0saic/types";
import type {
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicSource,
} from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { queryFrames, toM0String } from "@m0saic/dsl-stdlib";
import {
  defineMosaicTemplate,
  definePropsSchema,
  determineMediaType,
  makeColorTile,
  makeErrorMosaic,
  makeQrEyeChildDoc,
  qrToRenderable,
  registerTemplate,
  solidBackground,
} from "@m0saic/template-utils";

const BRAND_ORANGE: MosaicColor = "#f97316";
const BG_LIGHT: MosaicColor = "#ffffff";
const BG_DARK: MosaicColor = "#000000";

const DEFAULTS = {
  text: "https://www.m0saic.io",
  mode: "light" as "light" | "dark" | "transparent",
  moduleColor: BRAND_ORANGE,
  moduleStyle: "circle" as "circle" | "roundedSquare",
  // moduleBorderRadius defaults derive from moduleStyle (1.0 for circle, 0.3 for rounded square)
  eyeOuterBorderRadius: 0.3,
  eyeInnerDotBorderRadius: 0.5,
  safeAreaWidth: 272,
  safeAreaHeight: 272,
  paddingPct: 8,
} as const;

/**
 * Minimum QR version forced when the centre cutout is enabled and the
 * caller didn't specify a version. The 15-cell safe area removes ~25 cells
 * of dark-module area inside a smaller QR; without a bigger matrix the
 * cutout exceeds even ECC level H's ~30% recovery threshold and the code
 * fails to scan. V6 keeps the canvas square + scannable for typical URLs.
 *
 * For longer URLs that auto-pick a higher version anyway, this floor is
 * a no-op (we use `max(forced, auto)`).
 */
const CUTOUT_MIN_VERSION = 6;

const EYE_CHILD_KEY = "qr-eye";
const CENTER_CHILD_KEY = "center";

export type QrRoundedProps = {
  /** Text to encode (URL, plain string, or structured payload). */
  text?: string;
  /** Background mode. `transparent` omits the canvas background. */
  mode?: "light" | "dark" | "transparent";
  /** Fill colour for data modules and eye dark layers. Default brand orange. */
  moduleColor?: string;
  /** Override mode-derived background colour. */
  backgroundColor?: string;
  /** Data module shape. `circle` uses borderRadius 1.0; `roundedSquare` uses 0.3 by default. */
  moduleStyle?: "circle" | "roundedSquare";
  /** Override module corner radius (0..1). Default depends on `moduleStyle`. */
  moduleBorderRadius?: number;
  /** Outer eye corner radius (0..1). Default 0.3. */
  eyeOuterBorderRadius?: number;
  /** Inner eye dot corner radius (0..1). Default 0.5. Set 1.0 for a circular dot. */
  eyeInnerDotBorderRadius?: number;
  /**
   * Optional centre asset (image or video) that fills a carved safe area.
   * When set, ECC is forced to H and a centred logo cutout is emitted.
   */
  centerAssetPath?: string;
  /** Safe-area width in canvas pixels. Default 272. */
  safeAreaWidth?: number;
  /** Safe-area height in canvas pixels. Default 272. */
  safeAreaHeight?: number;
  /** Padding between modules and the inner safe-area rect, % of max dim. Default 8. */
  paddingPct?: number;
  /**
   * Force a specific QR version (1–40). Higher versions = more modules =
   * more redundancy headroom for the centre cutout. Default: auto-pick the
   * smallest version that fits the encoded data — EXCEPT when `centerAssetPath`
   * is set, in which case we force at least V6 so the cutout stays within
   * ECC H's recovery threshold. Bump higher if the rendered QR fails to
   * scan in print (smaller phones / older cameras need more headroom).
   */
  version?: number;
};

const propsSchema = definePropsSchema<QrRoundedProps>({
  text: {
    type: "string",
    required: false,
    description: "Text to encode (URL, plain string, or structured payload). Defaults to https://www.m0saic.io.",
    meta: { control: { placeholder: "https://www.m0saic.io" } },
  },
  mode: {
    type: "string",
    required: false,
    description: "Background mode.",
    meta: { constraints: { oneOf: ["light", "dark", "transparent"] } },
  },
  moduleColor: {
    type: "string",
    required: false,
    description: "Fill colour for data modules and eye dark layers (#rrggbb).",
    meta: { constraints: { isColor: true }, control: { colorPicker: true } },
  },
  backgroundColor: {
    meta: { constraints: { isColor: true }, control: { placeholder: "none (transparent)", colorPicker: true } },
    type: "string",
    required: false,
    description: "Override mode-derived background colour (#rrggbb).",
  },
  moduleStyle: {
    type: "string",
    required: false,
    description: "Data module shape.",
    meta: { constraints: { oneOf: ["circle", "roundedSquare"] } },
  },
  moduleBorderRadius: {
    type: "number",
    required: false,
    description: "Override module corner radius (0..1).",
    meta: { control: { placeholder: "by module style" }, constraints: { min: 0, max: 1 } },
  },
  eyeOuterBorderRadius: {
    type: "number",
    required: false,
    description: "Outer eye corner radius (0..1).",
    meta: { constraints: { min: 0, max: 1 } },
  },
  eyeInnerDotBorderRadius: {
    type: "number",
    required: false,
    description: "Inner eye dot corner radius (0..1). Set 1.0 for a circular dot.",
    meta: { constraints: { min: 0, max: 1 } },
  },
  centerAssetPath: {
    type: "media",
    required: false,
    description: "Optional image or video to place in the centre safe area.",
    meta: { control: { picker: "file", accept: ["image", "video"] } },
  },
  safeAreaWidth: {
    type: "number",
    required: false,
    description: "Safe-area width in pixels (only used when centerAssetPath is set).",
    meta: { constraints: { min: 32, max: 4096 } },
  },
  safeAreaHeight: {
    type: "number",
    required: false,
    description: "Safe-area height in pixels (only used when centerAssetPath is set).",
    meta: { constraints: { min: 32, max: 4096 } },
  },
  paddingPct: {
    type: "number",
    required: false,
    description: "Padding between modules and centre frame, as % of max dim.",
    meta: { constraints: { min: 0, max: 49 } },
  },
  version: {
    type: "number",
    required: false,
    description:
      "Force QR version (1-40). Defaults to auto; centre cutout forces ≥6 for scannability. Bump higher if a printed code fails to scan.",
    meta: { control: { placeholder: "auto (smallest that fits)" }, constraints: { min: 1, max: 40 } },
  },
});

function backgroundFor(
  mode: "light" | "dark" | "transparent",
  override: string | undefined,
): MosaicColor | undefined {
  if (override) return override as MosaicColor;
  if (mode === "transparent") return undefined;
  return mode === "dark" ? BG_DARK : BG_LIGHT;
}

function defaultModuleBorderRadius(style: "circle" | "roundedSquare"): number {
  return style === "circle" ? 1.0 : 0.3;
}

export const QrRounded = defineMosaicTemplate<QrRoundedProps>({
  id: asTemplateId("@m0saic/media/qr/rounded/v1"),
  label: "Brand QR — Rounded (v1, deprecated)",
  version: 1,
  // BITMAP drafting mode (handbook §3c): the split counts ARE the QR module grid —
  // never live-composed, so the latticeSmooth convention does not apply.
  lattice: { mode: "bitmap" },
  description:
    "Tasteful rounded-modules QR. Circular data dots, single-unit rounded-square eyes, optional centre logo cutout.",
  deprecated: {
    reason:
      "Merged into QR Code (media/qr/code/v1) — same channels engine; the unified card carries the module/eye radii as a Style group and the centre cutout as a Center Asset group, and is byte-identical at this template's defaults. Kept as the styled-path reference.",
    replacement: asTemplateId("@m0saic/media/qr/code/v1"),
    since: "2026-07-21",
  },
  capabilities: {
    tier: "capability",
    caps: { fs: { read: true, write: true, temp: true } },
  },
  tags: ["brand", "qr", "rounded"],

  outputHints: {
    width: 1080,
    height: 1080,
    fps: 30,
    durationMs: 2000,
    note: "Square QR with rounded modules + single-unit rounded eyes.",
    format: {
      kind: "image",
      container: "png",
      pixelFormat: "rgba",
    },
  },

  propsSchema,
  defaultProps: DEFAULTS,

  async render(
    props: QrRoundedProps,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    const text = props.text ?? DEFAULTS.text;
    const mode = props.mode ?? DEFAULTS.mode;
    // MosaicColor is a branded string type; user-supplied props arrive as
    // bare strings, so cast at the boundary. Bad colour strings get caught
    // by the engine at render time.
    const moduleColor = (props.moduleColor ?? DEFAULTS.moduleColor) as MosaicColor;
    const moduleStyle = props.moduleStyle ?? DEFAULTS.moduleStyle;
    const moduleBorderRadius =
      props.moduleBorderRadius ?? defaultModuleBorderRadius(moduleStyle);
    const eyeOuterBorderRadius =
      props.eyeOuterBorderRadius ?? DEFAULTS.eyeOuterBorderRadius;
    const eyeInnerDotBorderRadius =
      props.eyeInnerDotBorderRadius ?? DEFAULTS.eyeInnerDotBorderRadius;

    const hasCutout = !!props.centerAssetPath;
    const safeAreaWidth = props.safeAreaWidth ?? DEFAULTS.safeAreaWidth;
    const safeAreaHeight = props.safeAreaHeight ?? DEFAULTS.safeAreaHeight;
    const paddingPct = props.paddingPct ?? DEFAULTS.paddingPct;

    const bg = backgroundFor(mode, props.backgroundColor);

    // Resolve QR version. Caller-supplied wins. Otherwise: cutout enabled
    // forces ≥V6 floor so the rendered code scans even after the centre
    // modules are removed; no cutout means auto-pick the smallest fit.
    const resolvedVersion =
      props.version && props.version > 0
        ? props.version
        : hasCutout
          ? CUTOUT_MIN_VERSION
          : undefined;

    // ── 1) Generate the QR with eye treatment baked inline ──────
    //
    // The `eyes: { ... }` option enables the eyes channel AND splices the
    // 3-layer concentric eye child doc into each finder anchor's overlay
    // body. The returned `sources` already contains rounded color tiles
    // for the eye visual at the right indices; we only need to override
    // the data-cell tiles below to apply module-level rounding.
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
      return makeErrorMosaic(
        `QrRounded: ${err instanceof Error ? err.message : String(err)}`,
        {
          title: "Brand QR — Rounded",
          width: ctx.target.width,
          height: ctx.target.height,
        },
      );
    }

    if (qr.sources.length === 0) {
      return makeErrorMosaic(
        "QrRounded: composed QR has no renderable frames.",
        {
          title: "Brand QR — Rounded",
          width: ctx.target.width,
          height: ctx.target.height,
        },
      );
    }

    // ── 2) Override sources ──────────────────────────────────────
    //
    // Document order from qrToRenderable's eye-splice mode:
    //   [0..dataEnd)            data-cell color tiles (no rounding yet)
    //   [dataEnd..dataEnd+9)    3 eye-child-doc sources per finder (rounded)
    //   [dataEnd+9..]           optional safe-area splice point (last)
    //
    // We replace the data-cell tiles with rounded versions and (when the
    // cutout is enabled) the safe-area splice tile with a mosaic ref to
    // the centre child doc holding the user's media.
    const eyeBlockCount = (qr.channelByRole.eyes?.frames.length ?? 0) * 3;
    const safeAreaCount = hasCutout && qr.safeAreaStableKey ? 1 : 0;
    const dataCellEnd = qr.sources.length - eyeBlockCount - safeAreaCount;

    const sources: MosaicSource[] = qr.sources.map((src, i) => {
      if (i < dataCellEnd) {
        // Data module: rounded color tile.
        return makeColorTile(moduleColor, {
          effects: {
            rounding: {
              borderRadius: moduleBorderRadius,
              cornerStyle: "rounded",
            },
          },
        });
      }
      if (i >= qr.sources.length - safeAreaCount) {
        // Safe-area splice: dispatch to the centre child doc.
        return {
          type: "mosaic",
          ref: CENTER_CHILD_KEY,
          placement: { fit: "contain" },
        } satisfies MosaicSource;
      }
      // Eye block: keep qrToRenderable's pre-styled rounded source.
      return src;
    });

    // ── 3) Children — only safeArea centre doc now (eyes are inline). ───
    const children: Record<string, MosaicDocument> = {};
    if (hasCutout) {
      const centerAssetId = asAssetId("qr_rounded_center");
      const centerMediaType = determineMediaType(props.centerAssetPath!, ctx);
      children[CENTER_CHILD_KEY] = {
        kind: "mosaic_document",
        version: 1,
        m0: toM0String("F", "QrRounded-center"),
        assets: {
          [centerAssetId]: {
            kind: "file",
            path: props.centerAssetPath!,
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
    }

    // ── 6) Outer doc ─────────────────────────────────────────────
    return {
      kind: "mosaic_document",
      version: 1,
      m0: toM0String(String(qr.m0), "QrRounded"),
      sources,
      assets: {} as MosaicAssetManifest,
      children,
      size: { width: qr.canvasW, height: qr.canvasH },
      // `solidBackground` keeps the bg opaque on the rgba PNG output (see
      // its docs for the engine bgFill branch that defaults alpha-output
      // bgs to fully transparent).
      ...(bg !== undefined ? { backgroundColor: solidBackground(bg) } : {}),
    };
  },
});

registerTemplate(QrRounded);
export default QrRounded;
