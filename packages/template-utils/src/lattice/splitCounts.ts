import { toCanonicalM0String } from "@m0saic/dsl";

/** Every split count in an m0 string, per axis, in source order (with repeats). */
export type SplitCounts = {
  /** Counts of `N(…)` column splits. */
  cols: number[];
  /** Counts of `N[…]` row splits. */
  rows: number[];
};

/**
 * Collect every split count of an m0 string — the same O(n) scan as the DSL's
 * `computePrecisionFromCanonicalString`, keeping ALL counts instead of the max.
 *
 * Sound because a canonical NUMBER token may only be followed by `(` or `[`
 * (dsl-rules, grammar invariant 2), and the canonical form has no run-length
 * folding: every digit run followed by a classifier IS a split count. The input
 * is canonicalised first (`F` → `1`, `>` → `0`, whitespace stripped) but NOT
 * validated — feed it strings the parser accepts, or validate upstream.
 */
export function splitCounts(m0: string): SplitCounts {
  const s = toCanonicalM0String(m0);
  const cols: number[] = [];
  const rows: number[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s.charCodeAt(i);
    // A count starts with 1–9; a bare `0` is a passthrough token, never a count.
    if (ch >= 0x31 && ch <= 0x39) {
      let j = i + 1;
      while (j < s.length) {
        const d = s.charCodeAt(j);
        if (d < 0x30 || d > 0x39) break;
        j++;
      }
      const next = s.charAt(j);
      if (next === "(") cols.push(Number(s.slice(i, j)));
      else if (next === "[") rows.push(Number(s.slice(i, j)));
      i = j;
    } else {
      i++;
    }
  }
  return { cols, rows };
}
