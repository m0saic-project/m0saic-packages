import type { CandidateGrade } from "./candidate";
import type { SessionMeta } from "./session";

/**
 * Tripartite phase split of a session — the mosaic analog of chess's
 * opening / middlegame / endgame. By default the candidate sequence
 * partitions into thirds; the `phase` field on `CandidateContext` can
 * override per-candidate when a session's arc doesn't match thirds.
 */
export type SessionPhase = "scaffolding" | "refining" | "finalizing";

/** Per-party stats across a session. */
export type PartySummary = {
  /** Overall accuracy 0..100 (chess.com convention). */
  accuracy: number;
  /**
   * Count of candidates this party authored at each grade. Every grade key
   * is always present (zero when unused) so consumers can render a stable
   * table without optional-chaining at every cell.
   */
  gradeCounts: Record<CandidateGrade, number>;
  /**
   * Elo-style strength estimate for THIS session (separate from any global
   * skill rating). Roughly: high accuracy + few blunders → higher rating.
   * The summarizer's calibration is documented next to its implementation.
   */
  rating: number;
};

/** Per-phase summary. */
export type PhaseSummary = {
  /** Aggregate grade for the phase, derived from constituent candidates. */
  grade: CandidateGrade;
  /** How many candidates fell into this phase. */
  candidateCount: number;
};

/**
 * The Game Review summary panel — same shape chess.com shows after a
 * game. Rendered by the post-mortem template's review-board step.
 *
 * Derived from a `LoadedSession` (Pillar C) via `summarizeSession()`.
 * That function lives next to `loadSession` in `template-utils` because
 * it consumes the `LoadedSession` shape; the type lives here so other
 * consumers (the desktop File Details panel, future analytics) can
 * read summaries without taking a template-utils dep.
 */
export type SessionSummary = {
  /** Top-level descriptor — session slug, optional title, category, intent. */
  session: SessionMeta;
  /**
   * Per-party stats. Keys are party identifiers conforming to `PartyId`
   * (`"human"`, `"human:quentin"`, `"agent:claude"`, …). Typed as plain
   * string-keyed so the record stays open — `PartyId` is a template-
   * literal type that can't index a Record directly.
   */
  parties: Record<string /* PartyId */, PartySummary>;
  /** Per-phase grade chips for the review board. */
  phases: Record<SessionPhase, PhaseSummary>;
  /**
   * Optional one-line coach takeaway shown in the speech bubble on the
   * review-board step. Derived by the summarizer; the human can override
   * via `M0AgentMeta.note` on the final candidate.
   */
  coachTakeaway?: string;
};
