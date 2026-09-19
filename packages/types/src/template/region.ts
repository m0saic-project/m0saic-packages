/**
 * Canonical canvas-space region for draw-on-canvas template props.
 *
 * The vocabulary for "an area of the canvas the user marked": integer
 * document pixels in the canvas the region was authored against — not
 * screen pixels, not fractions. Regions are drawn on the Make preview
 * (which works in logical document px) or hand-authored in `--props`.
 *
 * Wire convention for region props (the `picker: "regions"` control in
 * `MosaicPropControl`): one `type: "json"` prop whose value is a
 * `MosaicRegionsValue` —
 *
 * - `regions` is ALWAYS an array (a single-region template declares
 *   `control.regions.max: 1` and reads `regions[0]`);
 * - each entry carries an optional `kind` discriminator; a missing `kind`
 *   means `"rect"`. The union grows (polygon, ellipse, …) without a wire
 *   migration — consumers skip entries whose `kind` they don't know;
 * - `canvas` records the canvas the coordinates were authored against.
 *   Absent means "px in the consuming template's own render canvas"
 *   (the hand-authoring convenience). Consumers rescale proportionally
 *   when their target canvas differs;
 * - order is user intent and is preserved; overlaps allowed; empty array
 *   = "no selection";
 * - no id field — identity across editor sessions is a UI concern, kept
 *   off the wire so serialization stays stable and diffs stay clean.
 *
 * Deliberately JSON-serializable (no functions, no branded types) so the
 * same shape round-trips through props JSON, `--props` CLI payloads, and
 * saved documents unchanged. Consumers tolerate unknown extra keys on
 * entries, so per-region additions stay non-breaking.
 */
export type MosaicRegionRect = {
  /** Shape discriminator; absent means "rect". */
  kind?: "rect";
  /** Left edge, integer px in the authored canvas (>= 0). */
  x: number;
  /** Top edge, integer px in the authored canvas (>= 0). */
  y: number;
  /** Width, integer px; strictly positive. */
  w: number;
  /** Height, integer px; strictly positive. */
  h: number;
  /**
   * Optional mask carved INSIDE the rect ("rect first, mask second"):
   * an SVG path `d` in RECT-LOCAL px (the rect is the path's design
   * space — origin at the rect's top-left, so the mask survives rect
   * move/resize untouched). Absent = the full rect. Consumers map it
   * onto `inline-mask` with `bounds = {0,0,w,h}` of the AUTHORED rect.
   */
  maskPath?: string;
  /**
   * Optional stroked polylines added to the rect's mask (the paint
   * BRUSH representation): rect-local `d` at `width` = brush diameter.
   * May appear with or without `maskPath`.
   */
  maskStrokes?: Array<{ d: string; width: number }>;
};

/**
 * A canvas region. Today only rects exist; the union grows shape kinds
 * (polygon, ellipse, freehand) without changing the wire envelope.
 */
export type MosaicRegion = MosaicRegionRect;

/**
 * DRAW TOOLS a `picker: "regions"` control can offer, declared by the
 * template via `control.regions.shapes`. `"rect"` is the primary tool
 * (every region IS a rect); the rest are complementary MASK tools that
 * carve inside the selected rect rather than adding new region kinds:
 * `"ellipse"` / `"polygon"` / `"lasso"` fill a rect-local `maskPath`,
 * `"brush"` paints rect-local `maskStrokes` (round-capped polylines).
 */
export type MosaicRegionShapeKind = "rect" | "ellipse" | "polygon" | "lasso" | "brush";

/** The full wire value of a `picker: "regions"` prop. */
export type MosaicRegionsValue = {
  /**
   * Canvas the region coordinates were authored against. Absent means
   * the coordinates are px in the consuming template's own render canvas.
   */
  canvas?: { w: number; h: number };
  /** The authored regions, in user order. */
  regions: MosaicRegion[];
};

/**
 * Strict shape guard for one wire entry: finite non-negative x/y, finite
 * strictly-positive w/h, `kind` absent or `"rect"`. Extra keys are
 * tolerated (the wire contract lets entries grow non-breaking fields).
 * Tolerant parsing/clamping of whole values lives in
 * `@m0saic/template-utils`, not here — this guard answers only "is this
 * shaped like a valid rect region?".
 */
export function isMosaicRegionRect(value: unknown): value is MosaicRegionRect {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  if (v.kind !== undefined && v.kind !== "rect") {
    return false;
  }
  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  if (!finite(v.x) || v.x < 0 || !finite(v.y) || v.y < 0) {
    return false;
  }
  if (!finite(v.w) || v.w <= 0 || !finite(v.h) || v.h <= 0) {
    return false;
  }
  if (v.maskPath !== undefined && typeof v.maskPath !== "string") {
    return false;
  }
  if (v.maskStrokes !== undefined) {
    if (!Array.isArray(v.maskStrokes)) return false;
    for (const s of v.maskStrokes) {
      if (typeof s !== "object" || s === null) return false;
      const rec = s as Record<string, unknown>;
      if (typeof rec.d !== "string" || rec.d.trim() === "") return false;
      if (!finite(rec.width) || rec.width <= 0) return false;
    }
  }
  return true;
}
