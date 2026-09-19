/**
 * FFmpeg expression escaping and quoting utilities.
 *
 * FFmpeg filter graphs have multiple escaping layers. These helpers
 * ensure expressions are escaped correctly for each context:
 *
 * - **filter expressions** (overlay `x=`, `y=`, `alpha=`): escape `\`, `'`
 *   Commas are NOT escaped — they are function argument separators in
 *   ffmpeg expressions (min, max, if, between, etc.).
 * - **enable expressions** (`:enable='...'`): escape `,` only
 *   Enable is embedded in the filter option list where commas delimit
 *   parameters, so expression commas must be escaped.
 * - **eval expressions** (`geq=lum='...'`): escape `\`, `'` only
 */

import { rebalanceAdditiveChains } from "./balance";

/**
 * Escape a string for use inside an ffmpeg filter expression
 * (overlay x=, y=, alpha=).
 *
 * Escapes backslashes first, then single-quotes.
 * Commas are left unescaped — they are valid function argument
 * separators inside ffmpeg expressions.
 *
 * @example escapeFilterExpr("min(1,max(0,t/2))") => "min(1,max(0,t/2))"
 */
export function escapeFilterExpr(expr: string): string {
  return expr
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

/**
 * Wrap an expression in single quotes for use as an ffmpeg filter value.
 *
 * @example quoteExpr("min(1,max(0,t/2))") => "'min(1,max(0,t/2))'"
 * @example quoteExpr("ih-(ih*0.75)") => "'ih-(ih*0.75)'"
 */
export function quoteExpr(expr: string): string {
  return `'${escapeFilterExpr(expr)}'`;
}

/**
 * Escape a string for use in an ffmpeg `:enable='...'` clause.
 *
 * Only commas need escaping in enable expressions — backslashes and
 * single-quotes are handled by the outer quoting layer.
 */
export function escapeEnableExpr(expr: string): string {
  return expr.replace(/,/g, "\\,");
}

/**
 * Build a complete `:enable='...'` argument string.
 *
 * Long flat `+` chains (dense enable windows) are regrouped into a balanced
 * tree first — ffmpeg's expression parser fails flat chains of ≥99 terms
 * with a phantom "Cannot allocate memory" at filtergraph init (see
 * `rebalanceAdditiveChains`). Chains at or under the threshold pass through
 * byte-identical.
 *
 * @example quoteEnableArg("between(t,0,2)") => ":enable='between(t\\,0\\,2)'"
 */
export function quoteEnableArg(expr: string): string {
  return `:enable='${escapeEnableExpr(rebalanceAdditiveChains(expr))}'`;
}

/**
 * Escape a string for use in an ffmpeg eval context (e.g. `geq=lum='...'`).
 *
 * Escapes backslashes and single-quotes only — commas are NOT escaped
 * because they serve as argument separators inside eval expressions.
 */
export function escapeEvalExpr(expr: string): string {
  return expr.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Wrap an expression in single quotes for an ffmpeg eval context.
 */
export function quoteEvalExpr(expr: string): string {
  return `'${escapeEvalExpr(expr)}'`;
}
