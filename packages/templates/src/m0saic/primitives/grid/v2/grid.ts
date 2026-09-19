import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/primitives/grid/v2
 * ============================================================================
 *
 * A reusable, COMPOSABLE gridline overlay primitive.
 *
 * Renders each gridline as a thin lavfi strip positioned by a PROPORTIONAL
 * overlay offset (`H*frac` / `W*frac`), stacked over a transparent base:
 *   base (transparent) -> line1 -> line2 -> ... -> lineN
 *
 * Why v2 exists (the v1 bug):
 * - v1's single-axis path computed each line's ABSOLUTE pixel position from
 *   `ctx.target`, then re-encoded them as a `placeRects` split whose basis ≈ the
 *   axis length in px (e.g. `853[0,1,0,…]` for an 853px plot). That is the
 *   "absolute → fine ratio" anti-pattern: it renders exactly STANDALONE (853
 *   slices of 853px = 1px each) but the per-pixel basis does NOT nest — the
 *   engine folds the child split into the parent layout, re-divides the basis
 *   below 1px, cells round to 0, and the grid is SILENTLY DROPPED at certain
 *   canvases (gridlines gone at 1024², 1000², … while 1080² survives). See
 *   the internal ratio-vs-absolute-m0-drafting notes.
 *
 * How v2 fixes it (ratio positioning, decoupled thickness):
 * - Position is a PROPORTION of the cell, expressed as an overlay offset
 *   (`H*frac`) evaluated against the actual cell W/H at render time. A ratio
 *   scales to whatever cell it lands in, so the grid composes cleanly at every
 *   canvas — no per-pixel basis to re-divide, no silent drop.
 * - Thickness is DECOUPLED from positioning: each line is a fixed thin strip
 *   (`thicknessFrac` of the short side, engine-clamped to >= 1px), not a cell in
 *   an interleaved [gap,line,gap,…] split. That interleave is the OTHER trap
 *   (its basis sits ≈ the axis length and the remainder spreads wildly — up to
 *   ~67px at count=6 @ 400px); proportional strips sidestep it entirely.
 *
 * Cost trade (deliberate):
 * - v1 single-axis was 1 composition op (placeRects) but non-nestable. v2 is
 *   N+1 nested overlays (one per line) but nestable. For a primitive meant to be
 *   composed, composability wins — the whole point of the shelf is that it drops
 *   into any cell. Grids are small (typically count 3–12), so the overlay depth
 *   stays modest; these are plain colored strips (no masks), so they are not
 *   subject to the mask-drop overlay-depth ceiling.
 *
 * Counting / axis / origin semantics are unchanged from v1:
 * - `count` = number of equal intervals across the axis.
 * - `excludeEdges=true` (default) → interior lines only (i = 1..count-1);
 *   `excludeEdges=false` → include the 0 and count edges (i = 0..count).
 * - direction "horizontal" spaces lines by Y fraction; "vertical" by X fraction;
 *   "both" draws both sets.
 * - origin: horizontal uses "bottom" (chart-style, default) or "top"; vertical
 *   uses "left" (default) or "right".
 *
 * Not owned by this primitive: background fills, baselines, animation. Callers
 * layer those themselves.
 * ============================================================================
 */

import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicLavfiSource,
  MosaicSource,
  MosaicTemplate,
} from "@m0saic/types";
import {
  definePropsSchema,
  registerTemplate,
  buildOverlayStack,
  buildGridlineSources,
  transparentSlot,
} from "@m0saic/template-utils";

export type PrimitiveGridV2Direction = "horizontal" | "vertical" | "both";
export type PrimitiveGridV2Origin = "top" | "bottom" | "left" | "right";

export type PrimitiveGridV2Props = {
  show?: boolean;

  /** Number of equal intervals across the chosen axis. */
  count?: number;

  /** Which axes to draw. */
  direction?: PrimitiveGridV2Direction;

  /**
   * Fraction origin for placement.
   * - horizontal: "bottom" (chart-style) or "top" (screen-style)
   * - vertical:   "left" (screen-style) or "right"
   */
  origin?: PrimitiveGridV2Origin;

  /** Exclude the outer boundary lines. Default true. */
  excludeEdges?: boolean;

  /** Line color (FFmpeg-compatible). */
  color?: MosaicColor;

  /** Constant opacity multiplier (0..1). */
  opacity?: number;

  /** Thickness as a fraction of the short side. Engine clamps to >= 1px. */
  thicknessFrac?: number;
};

const propsSchema = definePropsSchema<PrimitiveGridV2Props>({
  show: {
    type: "boolean",
    required: false,
    description: "Whether the grid renders. Default true.",
    meta: { ui: { label: "Show grid" } },
  },
  count: {
    type: "number",
    required: false,
    description: "Number of equal intervals across the axis. Default 5.",
    meta: { ui: { label: "Intervals" } },
  },
  direction: {
    type: "string" as any,
    required: false,
    description: 'Which axes to draw: "horizontal" | "vertical" | "both". Default "horizontal".',
    meta: { ui: { label: "Direction" } },
  },
  origin: {
    type: "string" as any,
    required: false,
    description: 'Origin for fractions: "top" | "bottom" | "left" | "right". Default depends on direction.',
    meta: { ui: { label: "Origin" } },
  },
  excludeEdges: {
    type: "boolean",
    required: false,
    description: "If true, do not render the outer boundary lines. Default true.",
    meta: { ui: { label: "Hide outer lines" } },
  },
  color: {
    type: "string",
    required: false,
    description: "Line color (FFmpeg-compatible). Default #ffffff.",
    meta: { ui: { label: "Line color" }, constraints: { isColor: true }, control: { colorPicker: true } },
  },
  opacity: {
    type: "number",
    required: false,
    description: "Line opacity multiplier (0..1). Default 0.12.",
    meta: { ui: { label: "Opacity" } },
  },
  thicknessFrac: {
    type: "number",
    required: false,
    description: "Line thickness fraction. Default 0.002.",
    meta: { ui: { label: "Thickness" } },
  },
});

export const PRIMITIVE_GRID_V2_TEMPLATE_ID = asTemplateId("@m0saic/primitives/grid/v2");

const DEFAULT_COLOR = "#ffffff";
const DEFAULT_OPACITY = 0.12;
const DEFAULT_THICKNESS_FRAC = 0.002;
const DEFAULT_COUNT = 5;

/** Empty (transparent) grid — a single passthrough base layer. */
function emptyGrid(ctx: MosaicEngineContext): MosaicDocument {
  return {
    kind: "mosaic_document",
    version: 1,
    assets: {} as any,
    m0: buildOverlayStack(1),
    sources: [transparentSlot()],
    durationMs: ctx.target.durationMs,
  };
}

export const PrimitiveGridV2: MosaicTemplate<PrimitiveGridV2Props> = {
  id: PRIMITIVE_GRID_V2_TEMPLATE_ID,
  label: "Primitive — Grid",
  version: 2,
  internal: false,
  primitive: true, // reusable layout building block composed into other templates
  description:
    "Composable gridline overlay primitive (horizontal/vertical/both) — thin fixed-px strips at proportional offsets; nests cleanly at any canvas.",
  capabilities: { tier: "core" },
  tags: ["primitive", "grid", "developers", "layout"],
  // Transparent gridlines over a passthrough slot — a still with alpha.
  outputHints: { format: { kind: "image", container: "png", pixelFormat: "rgba" } },
  propsSchema,

  defaultProps: {
    show: true,
    count: DEFAULT_COUNT,
    direction: "horizontal",
    origin: "bottom",
    excludeEdges: true,
    color: DEFAULT_COLOR,
    opacity: DEFAULT_OPACITY,
    thicknessFrac: DEFAULT_THICKNESS_FRAC,
  },

  async render(
    props: PrimitiveGridV2Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    const show = props.show !== false;
    const count = Math.max(0, Math.floor(props.count ?? DEFAULT_COUNT));

    if (!show || count <= 1) {
      return emptyGrid(ctx);
    }

    const direction: PrimitiveGridV2Direction = props.direction ?? "horizontal";
    const color = props.color ?? DEFAULT_COLOR;
    const opacity = props.opacity ?? DEFAULT_OPACITY;
    const thicknessFrac = props.thicknessFrac ?? DEFAULT_THICKNESS_FRAC;
    const excludeEdges = props.excludeEdges !== false;
    const origin = props.origin;

    // Proportional overlay strips for whichever axes are requested. Each line is
    // placed by an overlay offset that is a FRACTION of the cell (`H*frac` /
    // `W*frac`), so the whole set scales to any nested cell — no per-pixel basis,
    // no silent drop. Thickness is a fixed thin strip, decoupled from position.
    const horizOrigin: "top" | "bottom" = origin === "top" ? "top" : "bottom";
    const vertOrigin: "left" | "right" = origin === "right" ? "right" : "left";

    const lines: MosaicLavfiSource[] = [];
    if (direction === "horizontal" || direction === "both") {
      lines.push(
        ...buildGridlineSources({
          direction: "horizontal",
          count,
          excludeEdges,
          origin: horizOrigin,
          color,
          opacity,
          thicknessFrac,
        }),
      );
    }
    if (direction === "vertical" || direction === "both") {
      lines.push(
        ...buildGridlineSources({
          direction: "vertical",
          count,
          excludeEdges,
          origin: vertOrigin,
          color,
          opacity,
          thicknessFrac,
        }),
      );
    }

    if (lines.length === 0) {
      return emptyGrid(ctx);
    }

    const sources: MosaicSource[] = [transparentSlot(), ...lines];

    return {
      kind: "mosaic_document",
      version: 1,
      sources,
      assets: {} as any,
      m0: buildOverlayStack(sources.length),
      durationMs: ctx.target.durationMs,
    };
  },
};

registerTemplate(PrimitiveGridV2);
