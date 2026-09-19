/**
 * Tolerant parsing + strict normalization for `Array<MosaicTimeRangeMs>`
 * props — the `picker: "time-ranges"` wire contract in `@m0saic/types`.
 *
 * Split on purpose:
 *
 * - **`parseTimeRangesValue`** is the BOUNDARY reader. `type: "json"` props
 *   are engine-permissive, and the value may arrive as a real array (editor),
 *   a JSON string (agent surfaces / hand-authored `--props`), with numeric
 *   strings for the ms fields, or with extra keys a future editor added.
 *   Parsing coerces what it safely can, ignores unknown keys, and returns a
 *   typed error instead of throwing.
 * - **`normalizeTimeRanges`** is the SEMANTIC judge. Given the probed source
 *   duration it clamps each range into `[0, sourceDurationMs]` and issues a
 *   per-range verdict — consumers degrade one bad range (an error step slot)
 *   without killing the batch. Input order is preserved, never sorted: order
 *   is user intent, and step names/output files are positional.
 *
 * Pure module — no node imports, safe for the web bundle re-export.
 */

import type { MosaicTimeRangeMs } from "@m0saic/types";

export type ParseTimeRangesResult =
  | { ok: true; ranges: MosaicTimeRangeMs[] }
  | { ok: false; error: string };

/** Coerce a number-ish value (number, or numeric string) to integer ms. */
function coerceMs(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Read a raw `ranges` prop value into `MosaicTimeRangeMs[]`.
 *
 * Tolerates: a JSON-string-encoded array, numeric-string ms fields, unknown
 * extra keys (dropped), and non-string labels (dropped). Rejects (with a
 * typed error naming the first offending entry): non-array payloads,
 * unparsable JSON, and entries without coercible `startMs`/`endMs`.
 *
 * Range SEMANTICS (bounds, inversion) are deliberately not judged here —
 * that's {@link normalizeTimeRanges}' job, against the probed duration.
 */
export function parseTimeRangesValue(value: unknown): ParseTimeRangesResult {
  if (value == null) {
    return { ok: false, error: "Ranges are required — provide at least one { startMs, endMs } entry." };
  }

  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch (err) {
      return {
        ok: false,
        error: `Ranges JSON did not parse: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  if (!Array.isArray(raw)) {
    return { ok: false, error: `Ranges must be an array of { startMs, endMs } entries (got ${typeof raw}).` };
  }

  const ranges: MosaicTimeRangeMs[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return { ok: false, error: `Range #${i + 1} must be an object with startMs and endMs.` };
    }
    const rec = entry as Record<string, unknown>;
    const startMs = coerceMs(rec.startMs);
    const endMs = coerceMs(rec.endMs);
    if (startMs == null) {
      return { ok: false, error: `Range #${i + 1} is missing a numeric startMs.` };
    }
    if (endMs == null) {
      return { ok: false, error: `Range #${i + 1} is missing a numeric endMs.` };
    }
    const label = typeof rec.label === "string" && rec.label.trim() !== "" ? rec.label : undefined;
    ranges.push(label !== undefined ? { startMs, endMs, label } : { startMs, endMs });
  }
  return { ok: true, ranges };
}

export type NormalizedTimeRangeVerdict =
  | { ok: true; startMs: number; endMs: number; label?: string }
  | { ok: false; reason: string; range: MosaicTimeRangeMs };

/**
 * Judge parsed ranges against the probed source duration.
 *
 * Per range, in order (order preserved — verdict `i` is range `i`):
 * - inverted / zero-width (`endMs <= startMs`) → invalid;
 * - clamped into `[0, sourceDurationMs]`; a range that collapses to zero
 *   width after clamping (entirely outside the source) → invalid;
 * - otherwise valid with the clamped bounds and the original label.
 *
 * Overlapping and duplicate ranges are ALLOWED — overlapping cut variants
 * are a legitimate use; consumers own any merge policy.
 */
export function normalizeTimeRanges(
  ranges: MosaicTimeRangeMs[],
  sourceDurationMs: number,
): NormalizedTimeRangeVerdict[] {
  return ranges.map((range) => {
    if (range.endMs <= range.startMs) {
      return {
        ok: false as const,
        reason: `endMs (${range.endMs}) must be greater than startMs (${range.startMs})`,
        range,
      };
    }
    const startMs = Math.min(Math.max(0, range.startMs), sourceDurationMs);
    const endMs = Math.min(Math.max(0, range.endMs), sourceDurationMs);
    if (endMs - startMs <= 0) {
      return {
        ok: false as const,
        reason: `range [${range.startMs}, ${range.endMs}] lies outside the source duration (${sourceDurationMs}ms)`,
        range,
      };
    }
    return range.label !== undefined
      ? { ok: true as const, startMs, endMs, label: range.label }
      : { ok: true as const, startMs, endMs };
  });
}
