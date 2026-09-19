/**
 * `@m0saic/momo/types` — the AI-human work-session protocol.
 *
 * Lightweight, types-mostly (one tiny `gradeFromScore` helper in
 * `candidate.ts`). Available as a subpath export so other packages can
 * take a dep on the vocabulary without pulling the model runtime tree.
 *
 * Vocabulary contract: read `./README.md` for the canonical noun set,
 * banned synonyms, and the orthogonality of `LayoutIntent` vs.
 * `SessionCategory`.
 */

export type { PartyId } from "./party";

export type { RegionAnnotation } from "./region";

export type {
  KnownCategory,
  SessionCategory,
  SessionIntent,
} from "./category";

export type {
  SessionRef,
  CandidateRef,
  SessionMeta,
} from "./session";

export {
  gradeFromScore,
} from "./candidate";
export type {
  CandidateGrade,
  CandidateEvaluation,
  CandidateRelation,
} from "./candidate";

export type {
  SessionPhase,
  PartySummary,
  PhaseSummary,
  SessionSummary,
} from "./session-summary";

export { normalizeCandidateContext } from "./context";
export type { CandidateContext } from "./context";

// The agent annotation layer. The on-disk shapes + transport helpers are
// owned by @m0saic/dsl-file-formats and re-exported here; the typed
// M0AgentMeta / CandidateContext refinement and the full-struct
// normalizers are this package's. @m0saic/momo re-exports for back-compat.
export {
  mintAgentId,
  collapseAgentProse,
  normalizeAgentProse,
  normalizeM0AgentMeta,
  normalizeM0AgentResponse,
  normalizeM0AgentComment,
} from "./agent";
export type {
  M0AgentMeta,
  M0AgentMetaInput,
  M0AgentResponse,
  M0AgentComment,
} from "./agent";
