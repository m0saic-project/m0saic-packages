/**
 * Canonical source-relative clip range for time-based media selection.
 *
 * The vocabulary for "a piece of a source video": `[startMs, endMs)` in
 * integer milliseconds measured from the start of the SOURCE media — not the
 * render timeline. Render-relative animation timing is `MosaicTimeWindow`'s
 * job; the two are deliberately distinct nouns. Consumers that cut media map
 * this to the engine's playback primitive
 * (`clipStartMs` + `clipDurationMs = endMs - startMs`).
 *
 * Wire convention for multi-range props (the `picker: "time-ranges"` control
 * in `MosaicPropControl`): one `type: "json"` prop whose value is
 * `Array<MosaicTimeRangeMs>` —
 *
 * - sorted ascending by `startMs`;
 * - `endMs > startMs` for every entry;
 * - overlaps ALLOWED (consumers decide merge policy);
 * - empty array = "no selection";
 * - no id field — identity across editor sessions is a UI concern, kept off
 *   the wire so serialization stays stable and diffs stay clean.
 *
 * Deliberately JSON-serializable (no functions, no branded types) so the same
 * shape round-trips through props JSON, `--props` CLI payloads, and saved
 * documents unchanged. Consumers tolerate unknown extra keys on entries, so
 * per-range additions (e.g. a future `speedFactor`) stay non-breaking.
 */
export type MosaicTimeRangeMs = {
  /** Range start, integer ms from the start of the source media (>= 0). */
  startMs: number;
  /** Range end, integer ms; strictly greater than `startMs`. */
  endMs: number;
  /**
   * Optional human-readable label. Consumers surface it in UIs and derive
   * output names from it (sanitized) — e.g. the `{{label}}` output-pattern
   * token for per-range deliverables.
   */
  label?: string;
};

/**
 * Strict shape guard for one wire entry: finite non-negative ms numbers,
 * `endMs > startMs`, `label` absent or a string. Extra keys are tolerated
 * (the wire contract lets entries grow non-breaking fields). Tolerant
 * parsing/clamping of whole arrays lives in `@m0saic/template-utils`, not
 * here — this guard answers only "is this shaped like a valid range?".
 */
export function isMosaicTimeRangeMs(value: unknown): value is MosaicTimeRangeMs {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  if (typeof v.startMs !== "number" || !Number.isFinite(v.startMs) || v.startMs < 0) {
    return false;
  }
  if (typeof v.endMs !== "number" || !Number.isFinite(v.endMs)) {
    return false;
  }
  if (v.endMs <= v.startMs) {
    return false;
  }
  if (v.label !== undefined && typeof v.label !== "string") {
    return false;
  }
  return true;
}
