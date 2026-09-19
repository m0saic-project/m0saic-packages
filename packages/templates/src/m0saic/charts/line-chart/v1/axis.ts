/**
 * ============================================================================
 * @m0saic/charts/line-chart — Axis docks + background-mode resolution
 * ============================================================================
 *
 * Unlike bar-graph, a line chart does not flip orientation: the x axis is
 * always docked bottom, the y axis always left, gridlines run both ways. So
 * "axis config" here is a fixed struct plus the one genuinely variable layout
 * decision the chart frame needs — which of the three background modes
 * (transparent / solid / image) applies.
 *
 * PURE — no side effects, no rendering, no registration.
 * ============================================================================
 */

import type { MosaicColor } from "@m0saic/types";
import type { BackgroundMode, LineChartPreset } from "./types";
import { PRESET_TOKENS } from "./defaults";

/** Canonical line-chart docks. Fixed (no orientation branch). */
export const PLOT_DOCKS = {
  xLabelDock: "bottom",
  yLabelDock: "left",
  baselineEdge: "bottom",
  valueAxisEdge: "left",
  gridDirections: ["horizontal", "vertical"] as const,
} as const;

export type BackgroundResolution = {
  mode: BackgroundMode;
  /** Card color used for the "solid"/"preset" surface. */
  cardColor: MosaicColor;
  /** Canvas color stamped on the top document (undefined ⇒ transparent). */
  canvasColor: MosaicColor | undefined;
  /** Image ref (data-uri / path) for "image" mode. */
  backgroundImage?: string;
};

/**
 * Resolve the three-way background requirement into a concrete mode + colors.
 *
 *   backgroundColor: "none"   → transparent (composites under card chrome)
 *   backgroundImage present   → image surface
 *   backgroundColor: <color>  → solid surface
 *   otherwise                 → preset card surface
 *
 * Precedence: explicit "none" wins; then image; then solid; then preset.
 */
export function resolveBackground(opts: {
  preset: LineChartPreset;
  backgroundColor?: MosaicColor | "none";
  backgroundImage?: string;
}): BackgroundResolution {
  const tk = PRESET_TOKENS[opts.preset];

  if (opts.backgroundColor === "none") {
    return { mode: "none", cardColor: tk.card, canvasColor: undefined };
  }
  if (opts.backgroundImage) {
    return {
      mode: "image",
      cardColor: tk.card,
      canvasColor: undefined,
      backgroundImage: opts.backgroundImage,
    };
  }
  if (typeof opts.backgroundColor === "string") {
    return { mode: "solid", cardColor: opts.backgroundColor, canvasColor: opts.backgroundColor };
  }
  return { mode: "preset", cardColor: tk.card, canvasColor: tk.bg };
}
