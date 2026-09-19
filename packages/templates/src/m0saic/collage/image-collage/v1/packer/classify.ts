/**
 * Aspect classification — per-image crop costs against a candidate lattice.
 *
 * Cover-fit keeps `min(a, A)/max(a, A)` of an image's area when an image of
 * aspect `a` fills a cell of visible aspect `A`; the crop cost is the lost
 * fraction. The budget is SOFT (founder decision): every fitting span stays
 * on the menu with its cost — the planner prefers within-budget options and
 * reports overage, it never letterboxes and never leaves holes.
 */

import type { ImageSpanOptions, SpanClass, SpanDim } from "./types";

/** Canonical menu order (deterministic tie-breaking keys off this). */
export const SPAN_CLASSES: readonly SpanClass[] = [
  "1x1", "2x1", "3x1", "4x1", "1x2", "2x2", "3x2", "1x3",
];

export const SPAN_MENU: Record<SpanClass, SpanDim> = {
  "1x1": { c: 1, r: 1 },
  "2x1": { c: 2, r: 1 },
  "3x1": { c: 3, r: 1 },
  "4x1": { c: 4, r: 1 },
  "1x2": { c: 1, r: 2 },
  "2x2": { c: 2, r: 2 },
  "3x2": { c: 3, r: 2 },
  "1x3": { c: 1, r: 3 },
};

export const spanArea = (s: SpanClass): number => SPAN_MENU[s].c * SPAN_MENU[s].r;

/** Menu spans that fit a C×R lattice, canonical order. */
export function fittingSpans(cols: number, rows: number): SpanClass[] {
  return SPAN_CLASSES.filter((s) => SPAN_MENU[s].c <= cols && SPAN_MENU[s].r <= rows);
}

/** Area fraction cover-fit crops when aspect `a` fills a cell of aspect `A`. */
export function cropCost(imageAspect: number, cellAspect: number): number {
  if (!(imageAspect > 0) || !(cellAspect > 0)) return 1;
  return 1 - Math.min(imageAspect, cellAspect) / Math.max(imageAspect, cellAspect);
}

/** Visible aspect of a span on a lattice with the given unit + gutters. */
export function spanVisibleAspect(
  span: SpanClass,
  unitW: number,
  unitH: number,
  gutterXPx: number,
  gutterYPx: number,
): number {
  const { c, r } = SPAN_MENU[span];
  return (c * unitW + (c - 1) * gutterXPx) / (r * unitH + (r - 1) * gutterYPx);
}

/**
 * Per-image span menu against a candidate's visible aspects, cost-ascending.
 * Ties break by smaller area then canonical menu order — an image never gets
 * a bigger cell than an equally-good smaller one for free.
 */
export function classifySpans(
  aspects: number[],
  visibleAspect: Partial<Record<SpanClass, number>>,
  cropBudget: number,
): ImageSpanOptions[] {
  const spans = SPAN_CLASSES.filter((s) => visibleAspect[s] != null);
  return aspects.map((aspect, imageIndex) => {
    if (!Number.isFinite(aspect) || aspect <= 0)
      throw new Error(`classifySpans: aspects[${imageIndex}] must be a positive finite number, got ${aspect}`);
    const options = spans
      .map((span) => ({ span, cost: cropCost(aspect, visibleAspect[span]!) }))
      .sort(
        (a, b) =>
          a.cost - b.cost ||
          spanArea(a.span) - spanArea(b.span) ||
          SPAN_CLASSES.indexOf(a.span) - SPAN_CLASSES.indexOf(b.span),
      );
    return {
      imageIndex,
      aspect,
      options,
      withinBudget: options.filter((o) => o.cost <= cropBudget).length,
    };
  });
}
