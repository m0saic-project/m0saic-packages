/**
 * Macro substitution for m0saic expression variables.
 *
 * Templates author expressions using high-level macros (`lt`, `W`, `H`,
 * `TW`, `TH`) that are resolved before the expression reaches ffmpeg.
 */

/** Tile pixel dimensions available for macro substitution. */
export type TileMacroDims = {
  W: number;
  H: number;
  TW?: number;
  TH?: number;
};

/**
 * Replace tile-dimension macros (`W`, `H`, and optionally `TW`, `TH`)
 * with their numeric pixel values.
 *
 * Only replaces whole-word tokens (word-boundary match) so that
 * substrings like `"SHOW"` are not affected.
 *
 * `TW`/`TH` are only replaced when the corresponding value is provided.
 */
export function substituteTileMacros(
  expr: string,
  dims: TileMacroDims,
): string {
  let out = expr
    .replace(/\bW\b/g, String(dims.W))
    .replace(/\bH\b/g, String(dims.H));

  if (dims.TW != null) {
    out = out.replace(/\bTW\b/g, String(dims.TW));
  }
  if (dims.TH != null) {
    out = out.replace(/\bTH\b/g, String(dims.TH));
  }

  return out;
}

/**
 * Replace the local-time macro `lt` with the appropriate ffmpeg expression.
 *
 * - If `startAtSec` is provided: `lt` → `(t-<startAtSec>)`
 * - Otherwise: `lt` → `t`
 *
 * **Important:** only the *variable* token `lt` is replaced. The function
 * name `lt(` (as used by ffmpeg's `lt(a,b)` comparator) is left intact.
 * The regex uses a negative lookahead for `(` to distinguish the two.
 */
export function substituteLocalTime(
  expr: string,
  startAtSec?: number,
): string {
  const ltExpr = startAtSec != null ? `(t-${startAtSec})` : `t`;
  return expr.replace(/\blt\b(?!\s*\()/g, ltExpr);
}
