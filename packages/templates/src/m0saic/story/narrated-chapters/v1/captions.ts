/**
 * Caption cue engine.
 *
 * Cue precedence per section: explicit `cues` (inlined by story-studio from
 * .srt or emitted directly by a timestamp-capable TTS provider) → synthesized
 * sentence cues from `narrationText`. All times are narration-relative,
 * which equals step-local time because cards CUT into narration (the body
 * step's t=0 is the narration's first sample).
 *
 * Synthesis (the brief's algorithm): sentence split with an abbreviation
 * suppression set → sub-split long sentences at clause boundaries →
 * Hamilton distribution over the NARRATION SPAN (captions track speech, not
 * the padded body) with w[j] = max(12, len) → merge any cue below minCueMs
 * into its shorter neighbour and re-run → trim cueGapMs off each end.
 *
 * Rendering stays drawtext (`buildSvgTextSource` drops per-layer enable —
 * an svg caption source would show every cue at once, forever) and is
 * assembled in scenes/body.ts; this module is pure cue math + SRT text.
 */

import type { StoryCue, StorySection } from "./props";

/** Hard cap per section — drawtext's expression budget is finite. */
export const MAX_CUES_PER_SECTION = 96;

export type CaptionsConfig = {
  enabled: boolean;
  minCueMs: number;
  cueGapMs: number;
  plate: "always" | "never";
};

export const DEFAULT_CAPTIONS: CaptionsConfig = {
  enabled: true,
  minCueMs: 900,
  cueGapMs: 80,
  plate: "always",
};

/** Abbreviations whose trailing "." must not end a sentence. */
const ABBREV = new Set([
  "mr.", "mrs.", "ms.", "dr.", "prof.", "st.", "jr.", "sr.",
  "vs.", "etc.", "e.g.", "i.e.", "no.", "inc.", "ltd.", "co.",
  "a.m.", "p.m.", "u.s.", "u.k.",
]);

/** Sentences longer than this get sub-split at clause boundaries. */
const LONG_SENTENCE_CHARS = 110;

export function resolveSectionCues(
  section: StorySection,
  narrationMs: number | undefined,
  config: CaptionsConfig,
): StoryCue[] {
  if (!config.enabled || narrationMs === undefined || narrationMs <= 0) return [];

  // Precedence: timed data first (cues, incl. srt-inlined), then the
  // explicit per-section caption override (one cue over the whole span),
  // then synthesis from narrationText.
  if (Array.isArray(section.cues) && section.cues.length > 0) {
    return clampCues(section.cues, narrationMs);
  }
  const captionOverride = section.overrides?.caption;
  if (typeof captionOverride === "string" && captionOverride.trim().length > 0) {
    return [{ startMs: 0, endMs: narrationMs, text: captionOverride.trim() }];
  }
  if (typeof section.narrationText === "string" && section.narrationText.trim().length > 0) {
    return synthesizeCues(section.narrationText, narrationMs, config);
  }
  return [];
}

/** Provided cues: keep order, clamp into the narration span, cap the count. */
export function clampCues(cues: StoryCue[], narrationMs: number): StoryCue[] {
  const out: StoryCue[] = [];
  for (const cue of cues) {
    const startMs = Math.max(0, Math.round(cue.startMs));
    const endMs = Math.min(narrationMs, Math.round(cue.endMs));
    if (endMs <= startMs) continue;
    const text = cue.text.trim();
    if (text.length === 0) continue;
    out.push({ startMs, endMs, text });
    if (out.length >= MAX_CUES_PER_SECTION) break;
  }
  return out;
}

export function synthesizeCues(
  narrationText: string,
  narrationMs: number,
  config: CaptionsConfig,
): StoryCue[] {
  const pieces = splitSentences(narrationText)
    .flatMap((s) => (s.length > LONG_SENTENCE_CHARS ? splitClauses(s) : [s]))
    .slice(0, MAX_CUES_PER_SECTION);
  if (pieces.length === 0) return [];

  // Hamilton over the narration span — captions track speech, not padding.
  let texts = pieces;
  let durations = hamilton(narrationMs, texts.map((t) => Math.max(12, t.length)));

  // Merge any cue below minCueMs into its SHORTER neighbour and re-run.
  for (let guard = 0; guard < MAX_CUES_PER_SECTION; guard++) {
    if (texts.length <= 1) break;
    const idx = durations.findIndex((d) => d < config.minCueMs);
    if (idx === -1) break;
    const left = idx > 0 ? durations[idx - 1] : Infinity;
    const right = idx < durations.length - 1 ? durations[idx + 1] : Infinity;
    const into = left <= right ? idx - 1 : idx + 1;
    const [a, b] = into < idx ? [into, idx] : [idx, into];
    texts = [...texts.slice(0, a), `${texts[a]} ${texts[b]}`, ...texts.slice(b + 1)];
    durations = hamilton(narrationMs, texts.map((t) => Math.max(12, t.length)));
  }

  // Lay out sequentially, then trim the gap off each end — clamped per cue
  // so an oversized cueGapMs can never invert an interval and silently
  // delete a caption.
  const cues: StoryCue[] = [];
  let cursor = 0;
  for (let i = 0; i < texts.length; i++) {
    const rawStart = cursor;
    const rawEnd = cursor + durations[i];
    cursor = rawEnd;
    const gap = Math.min(config.cueGapMs, Math.floor((durations[i] - 1) / 2));
    const startMs = rawStart + (i > 0 ? gap : 0);
    const endMs = rawEnd - (i < texts.length - 1 ? gap : 0);
    if (endMs > startMs) cues.push({ startMs, endMs, text: texts[i] });
  }
  return cues;
}

/** Sentence split at .!?… + whitespace + an upper/digit/quote opener, ABBREV-protected. */
export function splitSentences(text: string): string[] {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) return [];
  const out: string[] = [];
  let start = 0;
  const re = /[.!?…]+["'”’]?(?=\s+["'“‘]?[A-Z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    const end = m.index + m[0].length;
    const candidate = normalized.slice(start, end).trim();
    const lastWord = candidate.split(" ").pop()?.toLowerCase() ?? "";
    if (ABBREV.has(lastWord)) continue; // "Dr." — not a boundary
    if (candidate.length > 0) out.push(candidate);
    start = end;
  }
  const tail = normalized.slice(start).trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

/** Sub-split an over-long sentence at clause boundaries (, ; : —). */
export function splitClauses(sentence: string): string[] {
  const parts = sentence
    .split(/(?<=[,;:—])\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length <= 1) return [sentence];
  // Greedily rejoin so fragments stay caption-sized, not comma-confetti.
  const out: string[] = [];
  let current = "";
  for (const part of parts) {
    const joined = current.length > 0 ? `${current} ${part}` : part;
    if (joined.length <= LONG_SENTENCE_CHARS) {
      current = joined;
    } else {
      if (current.length > 0) out.push(current);
      current = part;
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** Largest-remainder integer split; ties → lower index. (Shared with plan.ts.) */
export function hamilton(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (total * w) / sum);
  const base = raw.map(Math.floor);
  let remainder = total - base.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ frac: r - Math.floor(r), i }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let n = 0; n < order.length && remainder > 0; n++, remainder--) {
    base[order[n].i] += 1;
  }
  return base;
}

/** A cue placed on the global story timeline (for the .srt sidecar). */
export type AbsoluteCue = StoryCue;

export function serializeSrt(cues: AbsoluteCue[]): string {
  return cues
    .map((cue, i) => `${i + 1}\n${srtTime(cue.startMs)} --> ${srtTime(cue.endMs)}\n${cue.text}\n`)
    .join("\n");
}

function srtTime(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3_600_000);
  const m = Math.floor((clamped % 3_600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1000);
  const rem = clamped % 1000;
  const pad = (v: number, len: number) => String(v).padStart(len, "0");
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(rem, 3)}`;
}
