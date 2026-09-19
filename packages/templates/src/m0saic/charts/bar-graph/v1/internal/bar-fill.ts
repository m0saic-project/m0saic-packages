import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/charts/bar-graph/internal/bar-fill/v1
 * ============================================================================
 *
 * RESPONSIBILITY:
 *   THE ONLY place in the entire bar-graph template family that owns FFmpeg
 *   expressions and animation math for the bar fill.
 *
 *   This is the leaf renderable that produces the colored rectangle whose
 *   visible size is driven by an FFmpeg expression evaluating the fill
 *   fraction over time.
 *
 *   Owns:
 *     - FFmpeg crop / overlay expressions for animated fill
 *     - Easing application via anim.ts helpers
 *     - Stagger timing via anim.ts helpers
 *     - Axis-config-driven fill direction (grow up vs grow right)
 *     - Corner radius on the leading edge of the fill (production)
 *     - Static (reduceMotion) fallback: constant fraction, no animation math
 *
 * COMPOSITION:
 *   BarFill is a LEAF template — it has no children.
 *
 *   In production it returns a MosaicDocument with a single visual source
 *   (typically either):
 *     A) a solid-color `text` source using visual.backgroundColor, OR
 *     B) a lavfi `color=` source (if you standardize on lavfi primitives)
 *
 *   The “fill” effect is achieved by:
 *     - creating a full-size colored source
 *     - cropping it on the fill axis using an FFmpeg expression that goes
 *       from 0 → target fraction over time
 *     - anchoring the crop to the baseline edge (bottom for vertical,
 *       left for horizontal)
 *
 * WHAT NOT TO DO:
 *   - Do NOT handle layout — BarsStack + BarCell own positioning.
 *   - Do NOT handle labels — BarCell overlays those.
 *   - Do NOT handle track — BarCell renders the track behind this fill.
 *   - Do NOT duplicate easing math — call anim.ts helpers.
 *   - Do NOT branch on orientation directly — use axisConfig.fillAxis.
 *
 * ORIENTATION HANDLING:
 *   AxisConfig.fillAxis determines the animated dimension:
 *     - fillAxis="y": crop height expression, anchored at bottom
 *     - fillAxis="x": crop width expression, anchored at left
 *
 * PRODUCTION BEHAVIOR:
 *   render(props, ctx) → MosaicDocument:
 *     1) Compute timing: computeBarTiming(index, anim)
 *     2) Build expression: fillFractionExpr(fraction, timing, anim)
 *     3) Create solid-color base source (full-size)
 *     4) Apply crop expression on fillAxis:
 *          - if y: crop height = ih * expr, then anchor at bottom
 *          - if x: crop width  = iw * expr, anchored at left (default)
 *     5) Apply cornerRadius to the leading edge of the fill (production)
 *     6) Return single-source document
 *
 * FFMPEG EXPRESSION CONTRACT:
 *   The expression must:
 *     - Evaluate to a value between 0 and fraction (clamped)
 *     - Use `t` as the time variable (seconds since stream start)
 *     - Be parenthesized and semicolon-free
 *     - Degrade gracefully: if reduceMotion, be a constant
 * ============================================================================
 */

import type { M0String } from "@m0saic/dsl";
import type { MosaicDocument, MosaicEngineContext, MosaicLavfiSource, MosaicTemplate } from "@m0saic/types";
import { definePropsSchema, registerTemplate, makeErrorMosaic, u01 } from "@m0saic/template-utils";
import type { BarFillProps } from "../types";
import { DEFAULT_ANIM } from "../defaults";
import { computeBarTiming, easingExpr } from "../anim";

export const BAR_FILL_TEMPLATE_ID = asTemplateId("@m0saic/charts/bar-graph/internal/bar-fill/v1");

/**
 * Props schema note:
 *   Your props schema system may not deeply validate nested objects like
 *   axisConfig/anim today. That’s fine for scaffold — these fields are still
 *   “real” props for internal calls, and production can improve schema support
 *   later if desired.
 */
const propsSchema = definePropsSchema<BarFillProps>({
  // axisConfig is required for fill axis + baseline anchoring decisions.
  axisConfig: {
    // If your schema system doesn’t support "group", keep as "any"/"object"
    // in production or add a dedicated axisConfig schema.
    type: "group" as any,
    required: true,
    description: "Resolved axis configuration (fillAxis/layoutAxis/docks).",
  },

  fraction: {
    type: "number",
    required: true,
    description: "Target fill fraction (0..1) from domain normalization.",
    meta: { constraints: { min: 0, max: 1 } },
  },

  color: {
    type: "string",
    required: true,
    description: "Fill color.",
    meta: { constraints: { isColor: true }, control: { colorPicker: true } },
  },

  index: {
    type: "number",
    required: true,
    description: "Bar index (0-based) used for stagger timing.",
    meta: { constraints: { min: 0 } },
  },

  anim: {
    type: "group" as any,
    required: true,
    description: "Animation config (intro timing, easing, reduceMotion).",
  },

  cornerRadius: {
    type: "number",
    required: true,
    description: "Geometric radius fraction (0..1) for the leading edge of the fill.",
    meta: { constraints: { min: 0, max: 1 } },
  },
});

export const BarFill: MosaicTemplate<BarFillProps> = {
  id: BAR_FILL_TEMPLATE_ID,
  label: "Bar Graph — Bar Fill (internal)",
  version: 1,
  internal: true,
  // Building block of the DEPRECATED @m0saic/charts/bar-graph/v1 composition —
  // superseded with it (v2 is a flat single document and needs none of these).
  deprecated: {
    reason: "Internal piece of the deprecated 5-deep bar-graph/v1 nested composition; bar-graph/v2 renders the same chart as one flat document.",
    replacement: asTemplateId("@m0saic/charts/bar-graph/v2"),
    since: "2026-09-16",
  },
  description: "Internal leaf: sole owner of FFmpeg expressions for animated bar fill.",
  capabilities: { tier: "core" },
  tags: ["data-viz", "bar-graph", "internal", "bar-fill", "animated"],
  propsSchema,

  /**
   * Default props are only for local testing/debug. In real composition,
   * BarCell will pass these.
   */
  defaultProps: {
    axisConfig: {
      fillAxis: "y",
      layoutAxis: "x",
      labelDock: "bottom",
      valueDock: "top",
      gridDirection: "horizontal",
      baselineEdge: "bottom",
    },
    fraction: 0.5,
    color: "#f97316",
    index: 0,
    anim: DEFAULT_ANIM,
    cornerRadius: 0.15,
  },

  async render(props: BarFillProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const timing = computeBarTiming(props.index, props.anim);
    const dur = props.anim.intro.durationSec;
    const reduceMotion = props.anim.reduceMotion;

    // u01(dur) uses `lt` (local time since overlay.startAtSec) by default.
    // Stagger is achieved via startAtSec from computeBarTiming, not by
    // offsetting u01. The ramp clamps to 1 and holds — no enable window,
    // so the bar never disappears after the intro animation completes.
    //
    // When reduceMotion is true, eased collapses to "1": the bar snaps to
    // its final fraction immediately, alpha is full, and startAtSec is 0.
    // We still emit the overlay (vs. skipping it) so the crop expression
    // sees the final fraction — otherwise the lavfi color source would
    // fill the whole tile and ignore `fraction`.
    const uExpr = u01(dur);
    const eased = reduceMotion ? "1" : easingExpr(props.anim.intro.ease, uExpr);
    const alphaExpr = reduceMotion ? "1" : eased;
    const startAtSec = reduceMotion ? 0 : timing.startAtSec;

    // Axis-aware crop. Overlay expr context provides w/h (overlay
    // dimensions in the parent tile), not iw/ih or W/H.
    //
    // Vertical (fillAxis="y"): bar top edge travels from y=h (off-screen
    // below) toward y=h - h*fraction (final position). Visible band = the
    // bottom h*fraction of the tile.
    //
    // Horizontal (fillAxis="x"): bar left edge travels from x=-w
    // (off-screen left) toward x=w*fraction - w (final position). Visible
    // band = the left w*fraction of the tile.
    let xExpr = "0";
    let yExpr = "0";
    if (props.axisConfig.fillAxis === "y") {
      yExpr = `h-(h*${props.fraction})*(${eased})`;
    } else {
      xExpr = `(w*${props.fraction})*(${eased})-w`;
    }

    const fill: MosaicLavfiSource = {
      type: "lavfi",
      fitMode: "tile",
      lavfi: `color=${props.color}`,
      overlay: {
        startAtSec,
        alpha: alphaExpr,
        xExpr,
        yExpr,
      },
    };

    // Base transparent, overlay our moving bar
    const transparent: MosaicLavfiSource = {
      type: "lavfi",
      fitMode: "tile",
      lavfi: "color=black@0",
    };

    return {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: "1{1}",
      sources: [transparent, fill],
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
    } as any;
  },
};

registerTemplate(BarFill);