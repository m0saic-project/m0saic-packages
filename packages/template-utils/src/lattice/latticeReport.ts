import { validateM0String } from "@m0saic/dsl";
import { splitCounts } from "./splitCounts";
import { FAMILY_GCD, ceilToSmooth, floorToSmooth, formatFactors, isSmooth, lcm, lcmAll, roughPart } from "./smooth";

/**
 * Split counts at or below this are "small-basis ratio fill" and may carry a
 * rough factor: seven weekday columns, eleven collage tiles. A 7-split is never
 * exact on any standard canvas but spreads ≤ 1 px and costs only ×7 in
 * composition — the handbook's explicit carve-out. Above it, a rough count is
 * construction (a basis rounded off the lattice), not content.
 */
export const LATTICE_SMALL_BASIS = 12;

/** One distinct split count and where it occurs. */
export type LatticeCount = {
  n: number;
  /** Occurrences as a column split `n(…)`. */
  cols: number;
  /** Occurrences as a row split `n[…]`. */
  rows: number;
  /** `n` with every 2/3/5 divided out — `1` ⇔ 5-smooth. */
  roughPart: number;
  /** Human factorisation, e.g. `11²`, `7·17`. */
  factors: string;
};

export type LatticeReport = {
  /** Every distinct split count, descending by `n`. */
  counts: LatticeCount[];
  /** LCM of the column / row split counts (`Infinity` past 1e15; `1` when none). */
  selfLattice: { x: number; y: number };
  /** Largest split count on either axis (`1` when the layout has no splits). */
  maxN: number;
  /** True when EVERY split count is 5-smooth (the strict, informational verdict). */
  smooth: boolean;
  /** Rough counts above `smallBasis` that are not allowed — the convention's violations. */
  offenders: LatticeCount[];
  /** Rough counts above `smallBasis` that `opts.allow` declared (content cardinality). */
  allowed: LatticeCount[];
  /** Rough counts at or below `smallBasis` — accepted as ratio fill. */
  smallRough: LatticeCount[];
  /** Strings that failed `validateM0String` and were not scanned (invalid m0 is someone else's finding). */
  skipped: number;
};

export type LatticeReportOptions = {
  /** Rough counts at or below this pass as content fill. Default {@link LATTICE_SMALL_BASIS}. */
  smallBasis?: number;
  /** Rough counts a template declares as content cardinality (`template.lattice.allow`). */
  allow?: readonly number[];
};

/**
 * Lattice census of a rendered layout — one or more m0 strings (a root
 * document plus every nested child, or the flattened string). Pure: no parse
 * beyond the split-count scan, no canvas needed.
 */
export function latticeReport(m0s: readonly string[], opts: LatticeReportOptions = {}): LatticeReport {
  const smallBasis = opts.smallBasis ?? LATTICE_SMALL_BASIS;
  const allow = new Set(opts.allow ?? []);
  const byN = new Map<number, { cols: number; rows: number }>();
  const colsAll: number[] = [];
  const rowsAll: number[] = [];
  let skipped = 0;
  for (const m0 of m0s) {
    if (!validateM0String(m0).ok) {
      skipped++;
      continue;
    }
    const { cols, rows } = splitCounts(m0);
    for (const n of cols) {
      const e = byN.get(n) ?? { cols: 0, rows: 0 };
      e.cols++;
      byN.set(n, e);
      colsAll.push(n);
    }
    for (const n of rows) {
      const e = byN.get(n) ?? { cols: 0, rows: 0 };
      e.rows++;
      byN.set(n, e);
      rowsAll.push(n);
    }
  }
  const counts: LatticeCount[] = [...byN.entries()]
    .map(([n, e]) => ({ n, cols: e.cols, rows: e.rows, roughPart: roughPart(n), factors: formatFactors(n) }))
    .sort((a, b) => b.n - a.n);
  const rough = counts.filter((c) => c.roughPart !== 1);
  const big = rough.filter((c) => c.n > smallBasis);
  return {
    counts,
    selfLattice: { x: lcmAll(colsAll), y: lcmAll(rowsAll) },
    maxN: counts.length ? counts[0].n : 1,
    smooth: rough.length === 0,
    offenders: big.filter((c) => !allow.has(c.n)),
    allowed: big.filter((c) => allow.has(c.n)),
    smallRough: rough.filter((c) => c.n <= smallBasis),
    skipped,
  };
}

/** Same shape as `TemplateConventionViolation` — the audit pushes these as-is. */
export type LatticeViolation = { key: string; detail: string };

export type LatticeViolationsOptions = LatticeReportOptions & {
  /** The canvas the layout was rendered at; a rough axis is reported once, first. */
  canvas?: { width: number; height: number };
  /** The canvas is a physical size the template cannot move (`lattice.canvas:
   *  "physical"`): a rough axis is not reported, but the counts it explains
   *  are still charged to it rather than to the construction. */
  physicalCanvas?: boolean;
};

function occurrences(c: LatticeCount): string {
  const parts: string[] = [];
  if (c.cols) parts.push(`col ×${c.cols}`);
  if (c.rows) parts.push(`row ×${c.rows}`);
  return parts.join(", ");
}

function neighbourHint(n: number): string {
  const lo = floorToSmooth(n);
  const hi = ceilToSmooth(n);
  const near = Math.abs(n - lo) <= Math.abs(hi - n) ? lo : hi;
  const list = lo === hi ? String(lo) : `${lo} · ${hi}`;
  if (Math.abs(n - near) === 1) {
    return (
      `Nearest 5-smooth counts: ${list} — one slot off ${near}: if the weights were rounded to a basis cap one by one, ` +
      `the total drifts to cap ± 1; cap them with weightedSplit(…, { precision: ${near} }) so the total is exact.`
    );
  }
  return `Nearest 5-smooth counts: ${list}.`;
}

/**
 * The `latticeSmooth` convention's violations for a rendered layout: one per
 * offending split count (key `N=<n>`), preceded by one for a rough canvas axis
 * (key `canvas`) when `opts.canvas` is given. Empty = on the lattice.
 *
 * A rough canvas is charged for the counts it explains: a count whose rough
 * part divides the rough part of the axis it splits was handed down by a
 * divisor-picking builder (1130 = 10·113 ⇒ a 113-slot split), so it is listed
 * under the `canvas` violation and NOT as its own — fixing the canvas fixes
 * it. Counts the canvas cannot explain are construction and get their own
 * violation.
 */
export function latticeViolations(m0s: readonly string[], opts: LatticeViolationsOptions = {}): LatticeViolation[] {
  const out: LatticeViolation[] = [];
  const report = latticeReport(m0s, opts);
  const canvas = opts.canvas;
  const roughAxis = { cols: 1, rows: 1 };
  const roughAxes: Array<[string, number]> = [];
  if (canvas) {
    for (const [axis, v, key] of [
      ["width", canvas.width, "cols"],
      ["height", canvas.height, "rows"],
    ] as Array<[string, number, "cols" | "rows"]>) {
      if (!Number.isSafeInteger(v) || v < 1 || isSmooth(v)) continue;
      roughAxis[key] = roughPart(v);
      roughAxes.push([axis, v]);
    }
  }
  // Inherited on every axis it splits ⇒ charged to the canvas.
  const inherited = (c: LatticeCount): boolean =>
    roughAxes.length > 0 &&
    (c.cols === 0 || roughAxis.cols % c.roughPart === 0) &&
    (c.rows === 0 || roughAxis.rows % c.roughPart === 0);
  if (roughAxes.length > 0 && !opts.physicalCanvas) {
    const handedDown = report.offenders.filter(inherited);
    out.push({
      key: "canvas",
      detail:
        `hinted canvas ${canvas!.width}×${canvas!.height}: ` +
        roughAxes.map(([axis, v]) => `${axis} ${v} = ${formatFactors(v)}`).join(", ") +
        ` is not 5-smooth — divisor-based builders (placeInsetPieces, placeOptimizedPieces) inherit the rough factor on that axis` +
        (handedDown.length ? ` (split counts inheriting it: ${handedDown.map((c) => `${c.n} (${occurrences(c)})`).join(", ")})` : "") +
        `; self-frame the geometry (launder rung 7) or hint a 5-smooth canvas.`,
    });
  }
  for (const c of report.offenders) {
    if (inherited(c)) continue;
    const cost = lcm(c.n, FAMILY_GCD);
    out.push({
      key: `N=${c.n}`,
      detail:
        `split count ${c.n} (${occurrences(c)}) = ${c.factors} is not 5-smooth (rough part ${c.roughPart}); ` +
        `composing it with the ${FAMILY_GCD} lattice costs LCM ${cost.toLocaleString("en-US")}. ` +
        neighbourHint(c.n),
    });
  }
  return out;
}
