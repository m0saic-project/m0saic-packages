/**
 * ============================================================================
 * @m0saic/charts/bar-graph — Axis Config Resolver
 * ============================================================================
 *
 * RESPONSIBILITY:
 *   Resolve an Orientation ("vertical" | "horizontal") into a complete
 *   AxisConfig struct that every internal template consumes.
 *
 * WHY THIS EXISTS:
 *   Orientation is a single user-facing knob, but it affects MANY downstream
 *   decisions: which axis the fill grows along, where labels dock, which
 *   direction grid lines run, where the baseline sits, how the DSL layout
 *   string is built. Rather than each internal template branching on
 *   orientation independently (error-prone, duplicated), we resolve once
 *   and pass the AxisConfig through.
 *
 * PRODUCTION BEHAVIOR:
 *   resolveAxisConfig("vertical") → {
 *     fillAxis: "y",        // bars grow upward
 *     layoutAxis: "x",      // bars laid out left-to-right
 *     labelDock: "bottom",   // category labels below the plot
 *     valueDock: "top",      // value labels above bars
 *     gridDirection: "horizontal",  // gridlines are horizontal
 *     baselineEdge: "bottom",       // zero-line at bottom
 *   }
 *
 *   resolveAxisConfig("horizontal") → {
 *     fillAxis: "x",        // bars grow rightward
 *     layoutAxis: "y",      // bars laid out top-to-bottom
 *     labelDock: "left",     // category labels to the left
 *     valueDock: "right",    // value labels to the right
 *     gridDirection: "vertical",    // gridlines are vertical
 *     baselineEdge: "left",         // zero-line at left
 *   }
 *
 * GUIDELINES:
 *   - This is a PURE function — no side effects, no template registration.
 *   - If new axis-dependent properties are added (e.g., scroll direction),
 *     extend AxisConfig in types.ts and handle both cases here.
 *   - Never branch on orientation anywhere else; always use AxisConfig.
 * ============================================================================
 */

import type { AxisConfig, Orientation } from "./types";

/**
 * Resolve orientation into a full AxisConfig struct.
 *
 * @param orientation - "vertical" or "horizontal"
 * @returns Complete AxisConfig consumed by all internal templates.
 */
export function resolveAxisConfig(orientation: Orientation): AxisConfig {
  if (orientation === "horizontal") {
    return {
      fillAxis: "x",
      layoutAxis: "y",
      labelDock: "left",
      valueDock: "right",
      gridDirection: "vertical",
      baselineEdge: "left",
    };
  }

  // Default: vertical
  return {
    fillAxis: "y",
    layoutAxis: "x",
    labelDock: "bottom",
    valueDock: "top",
    gridDirection: "horizontal",
    baselineEdge: "bottom",
  };
}
