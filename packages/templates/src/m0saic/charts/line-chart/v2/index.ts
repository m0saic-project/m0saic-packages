/**
 * ============================================================================
 * @m0saic/charts/line-chart — Entry Point
 * ============================================================================
 *
 * Single import entry for the line-chart template family. Importing this file
 * triggers side-effect registration of ALL templates (public + internal).
 *
 *   - Every internal template MUST be imported here (for registration).
 *   - Only the public template (ChartsLineChartV2) is exported by name.
 *   - Internals are reached via renderNestedTemplate by template ID.
 * ============================================================================
 */

// Internal templates — imported for side-effect registration only.
import "../v1/chrome";

// Public template
export { ChartsLineChartV2 } from "./line-chart";

// Shared public types (for consumers type-checking props externally)
export type { LineChartV2Props } from "./line-chart";
