/**
 * Packer types — the image-collage layout solver's data model.
 *
 * The solver works entirely in UNIT space: a C×R lattice where every image
 * occupies a span of whole units. Pixels only enter through the candidate's
 * visible-geometry numbers (used for crop costs); the emitter (Phase 3) turns
 * unit rects into a ratio m0 + retargeted insets.
 */

/** The span menu. Wide (3x1/4x1) and tall (1x3) spans are the soft-budget escape for extreme aspects. */
export type SpanClass = "1x1" | "2x1" | "3x1" | "4x1" | "1x2" | "2x2" | "3x2" | "1x3";

export type SpanDim = { c: number; r: number };

/** One lattice hypothesis the search evaluates. */
export type LatticeCandidate = {
  cols: number;
  rows: number;
  /** The unit-aspect target that produced this candidate (reporting). */
  unitAspectTarget: number;
  /** Visible unit size in px (post-gutter/margin; fractional). */
  unitW: number;
  unitH: number;
  /** Visible aspect A(c,r) per menu span THAT FITS this lattice. */
  visibleAspect: Partial<Record<SpanClass, number>>;
  /** Context the visible numbers were derived from. */
  canvasW: number;
  canvasH: number;
  gutterXPx: number;
  gutterYPx: number;
  marginPx: number;
  /** Cheap pre-score used to cap the candidate list (lower = better). */
  preScore: number;
};

/** One image's menu, sorted by crop cost ascending. */
export type ImageSpanOption = { span: SpanClass; cost: number };
export type ImageSpanOptions = {
  imageIndex: number;
  aspect: number;
  /** Every fitting menu span with its cover-crop cost, cost-ascending. */
  options: ImageSpanOption[];
  /** How many options meet the (soft) crop budget. 0 = bestEffort image. */
  withinBudget: number;
};

/** The area plan: exactly one span per image, Σ areas === cols·rows. */
export type SpanAssignment = { imageIndex: number; span: SpanClass; cost: number };
export type SpanPlan = {
  assignments: SpanAssignment[];
  totalArea: number;
};

/** A placed span in unit coordinates. `imageIndex === -1` is a FILLER — the
 * never-expected last-resort escape; tests assert zero. */
export type PlacedSpan = {
  imageIndex: number;
  span: SpanClass;
  c0: number;
  r0: number;
  cs: number;
  rs: number;
};

export type RepairEvent = {
  kind: "swap" | "downgrade" | "respend" | "group-rebalance" | "group-collapse" | "filler";
  imageIndex: number;
  detail: string;
};

export type SolveMetrics = {
  /** Mean realized cover-crop cost across images. */
  meanCrop: number;
  maxCrop: number;
  /** Images whose realized crop exceeds the budget (soft-budget overage). */
  overBudgetCount: number;
  /** Σ max(0, crop − budget). */
  overBudgetTotal: number;
  fillerCount: number;
  /** Span-class variety: distinct classes used ÷ fitting menu size. */
  sizeDiversity: number;
  /** Fraction of interior row boundaries crossed by a span (the seed crosses ALL). */
  stagger: number;
  /** Lattice axes (0–2) whose unit count is above 12 and not 5-smooth — the emitted
   *  m0's basis IS the lattice, and a rough basis composes with nothing
   *  (latticeSmooth convention). */
  latticeRough: number;
};

export type SolveResult = {
  candidate: LatticeCandidate;
  placed: PlacedSpan[];
  /** Realized per-image assignment (imageIndex-ordered; cost = realized crop). */
  assignments: SpanAssignment[];
  metrics: SolveMetrics;
  repairs: RepairEvent[];
  score: number;
};
