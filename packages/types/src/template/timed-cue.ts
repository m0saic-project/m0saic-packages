/**
 * Canonical output-relative timed text cue for cue-track template props.
 *
 * The vocabulary for "an ordered text entity with an (optionally unresolved)
 * time": a line of text plus integer milliseconds measured on the OUTPUT
 * timeline — not the source media. Source-relative media selection is
 * `MosaicTimeRangeMs`'s job; the two are deliberately distinct nouns. (For
 * the canonical consumer — a lyric video whose duration follows the song —
 * the output timeline and the song timeline coincide.)
 *
 * Wire convention for cue-track props (the `picker: "cue-track"` control in
 * `MosaicPropControl`): one `type: "json"` prop whose value is an ordered
 * `Array<MosaicTimedCue>` —
 *
 * - order IS the entity order (lyric order, chapter order, …) and is user
 *   intent; consumers never sort. Index is identity — re-timing one cue must
 *   not renumber or rewrite its neighbors;
 * - `startMs` absent = the cue is UNTIMED — the unresolved state the timing
 *   editor exists to fix. Consumers treat untimed cues as "needs attention",
 *   never as t=0;
 * - `endMs` absent = the cue runs until the next TIMED cue's `startMs`
 *   (untimed neighbors are skipped over); the last cue runs to the output
 *   end. An explicit `endMs` may overlap the next cue (a held line).
 *   `endMs` is only meaningful alongside `startMs`;
 * - empty array = valid base state ("no cues yet"), not an error;
 * - no id field — identity across editor sessions is a UI concern, kept off
 *   the wire so serialization stays stable and diffs stay clean.
 *
 * Deliberately JSON-serializable (no functions, no branded types) so the same
 * shape round-trips through props JSON, `--props` CLI payloads, and saved
 * documents unchanged. Consumers tolerate unknown extra keys on entries, so
 * per-cue additions (e.g. a future word-level `words` array) stay
 * non-breaking.
 */
export type MosaicTimedCue = {
  /** The cue's text (a lyric line, chapter title, …). Required, non-blank. */
  text: string;
  /**
   * Cue start, integer ms on the OUTPUT timeline (>= 0). Absent = untimed —
   * the unresolved state awaiting the timing editor (or hand-authoring).
   */
  startMs?: number;
  /**
   * Optional explicit cue end, integer ms; strictly greater than `startMs`.
   * Absent = inferred at consume time (next timed cue's start; output end
   * for the last cue). Only meaningful when `startMs` is present.
   */
  endMs?: number;
  /**
   * Optional word-level deepening (karaoke): one span per WHITESPACE TOKEN
   * of `text`, aligned by index — the words carry no text of their own, so
   * the line stays the single source of truth. Same sparse-time laws as the
   * cue itself: `startMs` absent = that word is untimed; `endMs` absent =
   * the word runs to the next timed word's start (the cue's end for the
   * last). All times are OUTPUT-timeline ms, expected inside the cue's own
   * window. A length mismatch after a text edit reads as "words untimed
   * again" — validation, never destruction. Only meaningful alongside the
   * cue's `startMs`.
   */
  words?: MosaicTimedWord[];
};

/** One word-level span (see {@link MosaicTimedCue.words}). */
export type MosaicTimedWord = {
  startMs?: number;
  endMs?: number;
};

/**
 * Strict shape guard for one wire entry: non-blank string `text`; `startMs`
 * absent or a finite non-negative number; `endMs` absent or a finite number
 * strictly greater than a PRESENT `startMs` (an end without a start is
 * malformed). Extra keys are tolerated (the wire contract lets entries grow
 * non-breaking fields). Tolerant parsing/end-inference of whole arrays lives
 * in `@m0saic/template-utils`, not here — this guard answers only "is this
 * shaped like a valid timed cue?".
 */
export function isMosaicTimedCue(value: unknown): value is MosaicTimedCue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  if (typeof v.text !== "string" || v.text.trim() === "") {
    return false;
  }
  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  if (v.startMs !== undefined && (!finite(v.startMs) || v.startMs < 0)) {
    return false;
  }
  if (v.endMs !== undefined) {
    if (v.startMs === undefined) {
      return false;
    }
    if (!finite(v.endMs) || v.endMs <= (v.startMs as number)) {
      return false;
    }
  }
  if (v.words !== undefined) {
    // Words ride only a TIMED cue and must be an array of span objects
    // (sparse times allowed; per-word end needs its own start).
    if (v.startMs === undefined || !Array.isArray(v.words)) {
      return false;
    }
    for (const w of v.words) {
      if (typeof w !== "object" || w === null || Array.isArray(w)) {
        return false;
      }
      const s = (w as Record<string, unknown>).startMs;
      const e = (w as Record<string, unknown>).endMs;
      if (s !== undefined && (!finite(s) || s < 0)) {
        return false;
      }
      if (e !== undefined && (s === undefined || !finite(e) || e <= (s as number))) {
        return false;
      }
    }
  }
  return true;
}
