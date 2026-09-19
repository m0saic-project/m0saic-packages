import type { SessionCategory, SessionIntent } from "./category";

/**
 * A session is a chronological directory of candidates exploring one problem
 * — the "game" in the chess analogy. A candidate is one `.m0` (or `.m0c`)
 * file inside that directory — the "position / move".
 */

/** Lightweight pointer to a session, embedded on a candidate for portability. */
export type SessionRef = {
  /** Session directory slug, e.g. `"2026-06-09-sandbox-smoke"`. */
  slug: string;
  /** Human-readable title (optional, often derivable from the slug). */
  title?: string;
  /** UTC ISO 8601 of when the session started (usually the dated prefix). */
  startedAt?: string;
};

/** Lightweight pointer to a candidate's position within its session. */
export type CandidateRef = {
  /** Zero-padded candidate number, e.g. `"001"`. */
  number: string;
  /** Total candidates known at write time (for "001 of 007" displays). */
  ofTotal?: number;
};

/**
 * Session-level metadata. Embedded on each candidate via
 * `CandidateContext.session`; also returned by `summarizeSession()` as the
 * top-level descriptor for a `SessionSummary`.
 */
export type SessionMeta = SessionRef & {
  /** What kind of layout problem the session is exploring. */
  category?: SessionCategory;
  /** What the session as a whole is trying to accomplish. */
  intent?: SessionIntent;
  /** Optional one-line elevator pitch for the session. */
  summary?: string;
};
