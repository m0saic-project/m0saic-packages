import type { ScoreBreakdown } from "./scoring";
import type { PartyId } from "./party";

/**
 * Categorical grade for a candidate, taken **verbatim** from chess.com's
 * Game Review classification so the analogy carries (not paraphrased).
 *
 * ## Rank order (strongest → weakest)
 *
 * Chess vocabulary inverts what "best" feels like in plain English —
 * `best` means "the engine's top pick" (the most common positive grade);
 * `brilliant` and `great` rank ABOVE it because they require insight or
 * critical-moment recognition beyond the engine's baseline pick.
 *
 * | Rank | Grade        | Glyph | Meaning                                                       |
 * |------|--------------|-------|---------------------------------------------------------------|
 * | 1    | `brilliant`  | `!!`  | Exceptional — often a sacrifice + winning follow-up.          |
 * | 2    | `great`      | `!`   | Strong move at a critical moment.                             |
 * | 3    | `best`       | `★`   | The engine's top pick. Top of the automated grader's ladder.  |
 * | 4    | `excellent`  | `✓`   | Strong but not the very top.                                  |
 * | 5    | `good`       | `✓`   | Solid; meets the bar but unremarkable.                        |
 * | —    | `book`       | `📖`  | Known canon (opening theory equivalent). Outside the curve.   |
 * | 6    | `inaccuracy` | `?!`  | Slight slip.                                                  |
 * | —    | `miss`       | `✕`   | Failed to take a winning move. Human-only judgment.           |
 * | 7    | `mistake`    | `?`   | Clear error.                                                  |
 * | 8    | `blunder`    | `??`  | Catastrophic — game-losing in chess, infeasible-layout here.  |
 * | —    | `unevaluated`|       | No grade assigned yet (default).                              |
 *
 * ## Which grades come from where
 *
 * - **Automated** (`gradeFromScore` from a `ScoreBreakdown`): can issue
 *   `best`, `excellent`, `good`, `inaccuracy`, `mistake`, `blunder`. It
 *   **does not** issue `brilliant` or `great` — those require insight an
 *   automated metric can't see (this matches chess.com practice: the
 *   engine doesn't say "brilliant"; the annotator does).
 * - **Human-only**: `brilliant`, `great`, `book`, `miss`. The human can
 *   always upgrade or overwrite an automated grade.
 */
export type CandidateGrade =
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "book"
  | "inaccuracy"
  | "mistake"
  | "miss"
  | "blunder"
  | "unevaluated";

/**
 * The grade assignment for one candidate, plus optional supporting context.
 *
 * **Engine eval + annotator's mark coexist** (per the chess analogy): the
 * human `grade` is canonical; `breakdown` is the automated `scoreLayout`
 * signal kept as supporting telemetry. When they disagree, the human wins
 * but the disagreement itself is interesting — those are exactly the
 * moments worth pausing on in a post-mortem.
 */
export type CandidateEvaluation = {
  /** Canonical categorical grade — the "selected answer". */
  grade: CandidateGrade;
  /** Optional short note explaining the grade. */
  rationale?: string;
  /**
   * Where the grade came from:
   *   - `"human"` — a person assigned it (canonical default)
   *   - `"automated"` — derived from `breakdown` via {@link gradeFromScore}
   *   - `"hybrid"` — human looked at the automated breakdown, then assigned
   */
  source?: "human" | "automated" | "hybrid";
  /** Party that issued the grade. Defaults to `"human"` when absent. */
  from?: PartyId;
  /** UTC ISO 8601 timestamp of when the grade was saved. */
  at?: string;
  /**
   * Optional automated score from `scoreLayout`. Kept on the evaluation so
   * a post-mortem can show the engine eval alongside the human grade and
   * surface disagreement. Free to be absent — many evaluations are pure
   * human judgment.
   */
  breakdown?: ScoreBreakdown;
};

/**
 * Lineage between candidates. Lets the corpus track *why* a new file
 * exists: it refined an earlier candidate, branched from one to try
 * something different, rejected one outright, etc.
 *
 * `target` is the candidate number (zero-padded string, matching
 * `CandidateRef.number`) being related to — typically a previous candidate
 * in the same session, but free-form so cross-session references work.
 */
export type CandidateRelation = {
  kind:
    | "refines"
    | "branches-from"
    | "rejects"
    | "reverts-to"
    | "merges";
  /** Candidate number this relates to (e.g. `"003"`). */
  target: string;
};

/**
 * Map a `ScoreBreakdown.total` to the chess.com grade vocabulary.
 *
 * ## Threshold table (score → grade)
 *
 * | `total`           | Grade        |
 * |-------------------|--------------|
 * | `NaN` / infeasible | `blunder`   |
 * | `[0.85, 1.00]`    | `best`       |  ← top of the automated ladder
 * | `[0.70, 0.85)`    | `excellent`  |
 * | `[0.50, 0.70)`    | `good`       |
 * | `[0.30, 0.50)`    | `inaccuracy` |
 * | `[0.00, 0.30)`    | `mistake`    |
 *
 * Thresholds chosen so the automated grade lines up with the editor's
 * complexity-badge tiers (see `packages/momo/src/scoring/scoreLayout.ts`
 * `THRESHOLDS`) — green badge ≈ `best`, yellow ≈ `inaccuracy`, red ≈
 * `blunder`.
 *
 * ## Why `brilliant` / `great` aren't in the output set
 *
 * Per the rank-order table on {@link CandidateGrade}, `brilliant` and
 * `great` sit **above** `best` — they require insight (sacrifice,
 * critical-moment recognition) the automated scorer can't detect. Chess
 * engines don't say "brilliant!"; annotators do. So this function caps
 * at `best` and leaves headroom for the human to upgrade their grade
 * when they see something beyond the metrics. Same reasoning for
 * `book` (known canon) and `miss` (failed-to-take-winning-line) —
 * human-only signals.
 *
 * Infeasible breakdowns (`total === NaN`, `feasible === false`)
 * collapse to `blunder` since they can't be ranked.
 */
export function gradeFromScore(breakdown: ScoreBreakdown): CandidateGrade {
  if (!breakdown.feasible || Number.isNaN(breakdown.total)) return "blunder";
  const t = breakdown.total;
  if (t >= 0.85) return "best";       // engine's top pick — automated ceiling
  if (t >= 0.70) return "excellent";  // strong but not top
  if (t >= 0.50) return "good";       // meets the bar
  if (t >= 0.30) return "inaccuracy"; // slight slip
  return "mistake";                    // clear error
}
