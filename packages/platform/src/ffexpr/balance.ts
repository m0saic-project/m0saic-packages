/**
 * Additive-chain rebalancing for ffmpeg expressions.
 *
 * ffmpeg's expression parser (`av_expr_parse` in libavutil/eval.c) guards
 * against stack overflow with a fixed recursion budget (~100), and current
 * builds (measured on N-124278 / 2026-04-30) consume one level per additive
 * term — so a flat `a+b+c+…` chain fails at ≥99 terms with
 * `AVERROR(ENOMEM)`, surfacing as "Error initializing filters / Cannot
 * allocate memory" at filtergraph init regardless of available RAM.
 *
 * Template-generated enable windows (`(gte(t,a)*lt(t,b))+…`) scale with
 * content density and cross that cliff on dense timelines (a 10×10
 * dsl-tutorial inspector emits 100 windows; long text timelines emit 600+).
 *
 * Regrouping the same terms as a balanced binary tree keeps parse depth at
 * O(log N) — measured safe past 1024 terms — and is semantics-preserving
 * (regrouping `+` is associativity-safe; enable windows are disjoint 0/1
 * terms, so even float rounding is unaffected).
 *
 * Chains of `maxFlatTerms` or fewer are returned byte-identical so small
 * expressions (and existing command goldens) never change.
 */

/**
 * Flat additive chains longer than this get regrouped into a balanced tree.
 *
 * 32 sits well under the measured ~98-term parse cliff while leaving room
 * for the wrapping the engine adds around these chains (`lum(X,Y)*((…))`,
 * opacity/alpha factors), and matches the largest chain existing templates
 * emit deliberately (`PULSE_TERM_CAP`), so no golden output changes.
 */
export const DEFAULT_MAX_FLAT_ADDITIVE_TERMS = 32;

/**
 * Rebalance every flat `+` chain in `expr` (at any paren depth) that has
 * more than `maxFlatTerms` terms into a balanced binary tree of the same
 * terms in the same order.
 *
 * Expects a raw (un-escaped) ffmpeg expression. Idempotent; returns the
 * input unchanged when no chain exceeds the threshold.
 *
 * @example rebalanceAdditiveChains("a+b+c+d", 2) => "((a+b)+(c+d))"
 */
export function rebalanceAdditiveChains(
  expr: string,
  maxFlatTerms: number = DEFAULT_MAX_FLAT_ADDITIVE_TERMS,
): string {
  if (maxFlatTerms < 2 || !expr.includes("+")) return expr;
  return rebalance(expr, maxFlatTerms);
}

function rebalance(s: string, maxFlatTerms: number): string {
  const parts = splitTopAdditive(s);
  // Unbalanced parens or a unary leading/trailing "+" produce degenerate
  // splits — leave such input untouched rather than risk a rewrite.
  if (parts === null || parts.some((p) => p.length === 0)) return s;

  const processed = parts.map((p) => rebalanceGroups(p, maxFlatTerms));
  if (processed.length <= maxFlatTerms) return processed.join("+");
  return balancedJoin(processed);
}

/** Recurse into each top-level `(…)` group of a single term. */
function rebalanceGroups(term: string, maxFlatTerms: number): string {
  if (!term.includes("(")) return term;
  let out = "";
  let i = 0;
  while (i < term.length) {
    const ch = term[i];
    if (ch === "(") {
      const close = findMatchingParen(term, i);
      if (close < 0) return term; // unbalanced — leave untouched
      out += "(" + rebalance(term.slice(i + 1, close), maxFlatTerms) + ")";
      i = close + 1;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function findMatchingParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Split on `+` at paren depth 0. Skips `+` inside scientific notation
 * (`1e+5`). Returns null when parens are unbalanced.
 */
function splitTopAdditive(s: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth < 0) return null;
    }
    if (ch === "+" && depth === 0 && !isExponentPlus(s, i)) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (depth !== 0) return null;
  parts.push(cur);
  return parts;
}

/** True when the `+` at index `i` belongs to a `1e+5`-style literal. */
function isExponentPlus(s: string, i: number): boolean {
  if (i < 2 || i + 1 >= s.length) return false;
  const e = s[i - 1];
  if (e !== "e" && e !== "E") return false;
  const before = s[i - 2];
  const after = s[i + 1];
  return /[0-9.]/.test(before) && /[0-9]/.test(after);
}

/** Pairwise-regroup terms (order preserved) into a balanced binary tree. */
function balancedJoin(terms: string[]): string {
  let nodes = terms;
  while (nodes.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < nodes.length; i += 2) {
      next.push(i + 1 < nodes.length ? `(${nodes[i]}+${nodes[i + 1]})` : nodes[i]);
    }
    nodes = next;
  }
  return nodes[0];
}
