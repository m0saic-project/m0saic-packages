/**
 * Tolerant parsing + end-inference for `Array<MosaicTimedCue>` props — the
 * `picker: "cue-track"` wire contract in `@m0saic/types`.
 *
 * Split on purpose (the `timeRanges.ts` pattern):
 *
 * - **`parseCueTrackValue`** is the BOUNDARY reader. `type: "json"` props are
 *   engine-permissive, and the value may arrive as a real array (editor), a
 *   JSON string (agent surfaces / hand-authored `--props`), with numeric
 *   strings for the ms fields, or with extra keys a future editor added.
 *   Parsing coerces what it safely can, ignores unknown keys, and returns a
 *   typed error instead of throwing.
 * - **`resolveCueWindows`** is the SEMANTIC judge. Given the output duration
 *   it infers each cue's concrete `[startMs, endMs)` window (the wire keeps
 *   ends sparse) and issues a per-cue verdict — consumers decide policy per
 *   verdict (guidance render for `untimed`, skip for `outside`, warn for
 *   `inverted`). Input order is preserved, never sorted: order is the entity
 *   order (index = identity on this wire).
 *
 * Pure module — no node imports, safe for the web bundle re-export.
 */

import type { MosaicTimedCue, MosaicTimedWord } from "@m0saic/types";

export type ParseCueTrackResult =
  | { ok: true; cues: MosaicTimedCue[] }
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
 * Read a raw cue-track prop value into `MosaicTimedCue[]`.
 *
 * Tolerates: an absent value (→ `[]`, the valid "no cues yet" base state —
 * callers decide whether empty is renderable), a JSON-string-encoded array,
 * numeric-string ms fields, unknown extra keys (dropped), and an `endMs`
 * without a `startMs` (dropped — an end on an untimed cue is meaningless).
 * Rejects (with a typed error naming the first offending entry): non-array
 * payloads, unparsable JSON, entries that aren't objects, and entries with
 * missing/blank `text` or non-numeric ms fields.
 *
 * Timing SEMANTICS (bounds, ordering, end inference) are deliberately not
 * judged here — that's {@link resolveCueWindows}' job, against the output
 * duration.
 */
export function parseCueTrackValue(value: unknown): ParseCueTrackResult {
  if (value == null) {
    return { ok: true, cues: [] };
  }

  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch (err) {
      return {
        ok: false,
        error: `Cues JSON did not parse: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  if (!Array.isArray(raw)) {
    return { ok: false, error: `Cues must be an array of { text, startMs?, endMs? } entries (got ${typeof raw}).` };
  }

  const cues: MosaicTimedCue[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return { ok: false, error: `Cue #${i + 1} must be an object with text (and optional startMs/endMs).` };
    }
    const rec = entry as Record<string, unknown>;
    if (typeof rec.text !== "string" || rec.text.trim() === "") {
      return { ok: false, error: `Cue #${i + 1} is missing text.` };
    }
    let startMs: number | undefined;
    if (rec.startMs !== undefined) {
      const coerced = coerceMs(rec.startMs);
      if (coerced == null) {
        return { ok: false, error: `Cue #${i + 1} has a non-numeric startMs.` };
      }
      startMs = coerced;
    }
    let endMs: number | undefined;
    if (rec.endMs !== undefined && startMs !== undefined) {
      const coerced = coerceMs(rec.endMs);
      if (coerced == null) {
        return { ok: false, error: `Cue #${i + 1} has a non-numeric endMs.` };
      }
      endMs = coerced;
    }
    const cue: MosaicTimedCue = { text: rec.text };
    if (startMs !== undefined) cue.startMs = startMs;
    if (endMs !== undefined) cue.endMs = endMs;
    // Word-level deepening (karaoke): carried through tolerantly. Words on
    // an UNTIMED line are dropped (meaningless — same family as
    // end-without-start); an untyped/non-array value is a hard error.
    if (rec.words !== undefined && startMs !== undefined) {
      if (!Array.isArray(rec.words)) {
        return { ok: false, error: `Cue #${i + 1} words must be an array of { startMs?, endMs? }.` };
      }
      const words: MosaicTimedWord[] = [];
      for (let w = 0; w < rec.words.length; w++) {
        const entry = rec.words[w];
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
          return { ok: false, error: `Cue #${i + 1} word #${w + 1} must be an object.` };
        }
        const wr = entry as Record<string, unknown>;
        let ws: number | undefined;
        if (wr.startMs !== undefined) {
          const coerced = coerceMs(wr.startMs);
          if (coerced == null) {
            return { ok: false, error: `Cue #${i + 1} word #${w + 1} has a non-numeric startMs.` };
          }
          ws = coerced;
        }
        let we: number | undefined;
        if (wr.endMs !== undefined && ws !== undefined) {
          const coerced = coerceMs(wr.endMs);
          if (coerced == null) {
            return { ok: false, error: `Cue #${i + 1} word #${w + 1} has a non-numeric endMs.` };
          }
          we = coerced;
        }
        const word: MosaicTimedWord = {};
        if (ws !== undefined) word.startMs = ws;
        if (we !== undefined) word.endMs = we;
        words.push(word);
      }
      if (words.length > 0) cue.words = words;
    }
    cues.push(cue);
  }
  return { ok: true, cues };
}

export type CueWindowVerdict =
  | { ok: true; startMs: number; endMs: number; text: string; words?: MosaicTimedWord[] }
  | { ok: false; reason: "untimed" | "outside" | "inverted"; cue: MosaicTimedCue };

/**
 * Judge parsed cues against the output duration, inferring sparse ends.
 *
 * Per cue, in order (order preserved — verdict `i` is cue `i`):
 * - `startMs` absent → `"untimed"` (the unresolved state; the author hasn't
 *   timed it yet — consumers surface it, never render it at t=0);
 * - `startMs` at/past `durationMs` → `"outside"` (a legal cue beyond a
 *   pinned shorter render — consumers skip it, subtitle-burn style);
 * - end = explicit `endMs` ?? next TIMED cue's `startMs` ?? `durationMs`;
 *   untimed neighbors are transparent to the inference. If that end lands
 *   at/before the start → `"inverted"` (an ordering violation — the next
 *   timed cue starts at/before this one, or a malformed explicit end —
 *   surfaced rather than silently hidden);
 * - otherwise valid with bounds clamped into `[0, durationMs]`.
 *
 * Overlaps from an EXPLICIT `endMs` are ALLOWED (a held line) — inference
 * never compares an explicit end against the next cue.
 */
export function resolveCueWindows(
  cues: MosaicTimedCue[],
  opts: { durationMs: number },
): CueWindowVerdict[] {
  const { durationMs } = opts;

  // Next timed cue's startMs at/after each index's successor (untimed-transparent).
  const nextTimedStart: Array<number | undefined> = new Array(cues.length);
  let carry: number | undefined;
  for (let i = cues.length - 1; i >= 0; i--) {
    nextTimedStart[i] = carry;
    if (cues[i].startMs !== undefined) {
      carry = cues[i].startMs;
    }
  }

  return cues.map((cue, i) => {
    if (cue.startMs === undefined) {
      return { ok: false as const, reason: "untimed" as const, cue };
    }
    const startRaw = Math.max(0, cue.startMs);
    if (startRaw >= durationMs) {
      return { ok: false as const, reason: "outside" as const, cue };
    }
    const endRaw = cue.endMs ?? nextTimedStart[i] ?? durationMs;
    if (endRaw <= startRaw) {
      return { ok: false as const, reason: "inverted" as const, cue };
    }
    return {
      ok: true as const,
      startMs: startRaw,
      endMs: Math.min(endRaw, durationMs),
      text: cue.text,
      ...(cue.words !== undefined ? { words: cue.words } : {}),
    };
  });
}

export type WordSpan = { text: string; startMs: number; endMs: number };

export type WordSpansResult =
  | { ok: true; words: WordSpan[] }
  | { ok: false; reason: "no-words" | "mismatch" | "untimed" | "inverted" };

/**
 * Judge a cue's word deepening against its RESOLVED line window.
 *
 * Tokens come from whitespace-splitting the line's text (the line is the
 * single source of truth — words carry no text). Laws, mirroring the line
 * level one step down:
 * - no/empty `words` → `"no-words"` (lines-only rendering);
 * - token/word count mismatch (a text edit outran the timing) →
 *   `"mismatch"` — validation, never destruction;
 * - any word missing `startMs` → `"untimed"` (all words must be timed for
 *   karaoke rendering; partially-timed lines fall back to line rendering);
 * - ends inferred: explicit ?? next word's start ?? the line window's end,
 *   all clamped into the window. An inferred end at/before its start →
 *   `"inverted"`.
 */
export function resolveWordSpans(
  cue: { text: string; words?: MosaicTimedWord[] },
  window: { startMs: number; endMs: number },
): WordSpansResult {
  const tokens = cue.text.trim().split(/\s+/).filter((t) => t !== "");
  const words = cue.words;
  if (!words || words.length === 0) return { ok: false, reason: "no-words" };
  if (tokens.length !== words.length) return { ok: false, reason: "mismatch" };
  if (words.some((w) => typeof w.startMs !== "number")) {
    return { ok: false, reason: "untimed" };
  }
  const clamp = (ms: number) => Math.min(Math.max(ms, window.startMs), window.endMs);
  const out: WordSpan[] = [];
  for (let i = 0; i < words.length; i++) {
    const startMs = clamp(words[i].startMs as number);
    const endRaw = words[i].endMs ?? (words[i + 1]?.startMs as number | undefined) ?? window.endMs;
    const endMs = clamp(endRaw);
    if (endMs <= startMs) return { ok: false, reason: "inverted" };
    out.push({ text: tokens[i], startMs, endMs });
  }
  return { ok: true, words: out };
}
