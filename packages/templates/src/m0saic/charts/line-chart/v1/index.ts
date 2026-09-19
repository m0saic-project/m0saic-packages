/**
 * ============================================================================
 * @m0saic/charts/line-chart — Entry Point
 * ============================================================================
 *
 * Single import entry for the line-chart template family. Importing this file
 * triggers side-effect registration of ALL templates (public + internal).
 *
 *   - Every internal template MUST be imported here (for registration).
 *   - Only the public template (ChartsLineChart) is exported by name.
 *   - Internals are reached via renderNestedTemplate by template ID.
 * ============================================================================
 */

// Internal templates — imported for side-effect registration only.
import "./chrome";

// Public template
export { ChartsLineChart } from "./line-chart";

// Shared public types (for consumers type-checking props externally)
export type { LineChartProps, LineChartPreset } from "./types";
