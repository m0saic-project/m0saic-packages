/**
 * ============================================================================
 * @m0saic/charts/bar-graph — Entry Point
 * ============================================================================
 *
 * RESPONSIBILITY:
 *   Single import entry for the entire bar-graph template family.
 *
 *   Importing this file triggers side-effect registration of ALL templates
 *   (public + internal) via their registerTemplate() calls.
 *
 * WHAT THIS FILE DOES:
 *   1) Imports all internal templates (for side-effect registration)
 *   2) Re-exports the public ChartsBarGraph template
 *   3) Re-exports shared public types for external consumers
 *
 * GUIDELINES:
 *   - Every new internal template MUST be imported here.
 *   - Only the public template (ChartsBarGraph) is exported by name.
 *   - Internal templates are registered but not re-exported — they are
 *     accessed only via renderNestedTemplate by template ID.
 * ============================================================================
 */

// Internal templates — imported for side-effect registration only.
import "./internal/chart-frame";
import "./internal/plot-area";
import "./internal/bars-stack";
import "./internal/bar-cell";
import "./internal/bar-fill";
import "./internal/labels";

// Public template
export { ChartsBarGraph } from "./bar-graph";

// Shared public types (for consumers who need to type-check props externally)
export type { BarGraphProps, Orientation } from "./types";