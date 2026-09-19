/**
 * ============================================================================
 * `CandidateContext` — the typed refinement of the file-format context slot
 * ============================================================================
 *
 * The file formats (`@m0saic/dsl-file-formats`) own the WIRE shape of the
 * agent context block: which slot names exist and how unknown JSON is
 * routed into `extras`. That shape is deliberately opaque (every slot is
 * `unknown`) so the language repo carries no protocol vocabulary.
 *
 * This module is where the vocabulary lands: the same slots, each narrowed
 * to its protocol type. Every field is optional; the type is purely
 * additive over what files carry today. Keep the field list in lockstep
 * with the file-format `CANDIDATE_CONTEXT_KEYS` — a new slot is added on
 * both sides in the same change.
 *
 * ## Two orthogonal axes (read `./README.md` for the full contract)
 *
 *   - `category` / `intent` — kind of EXPLORATION the session is performing.
 *   - `layoutIntent`        — STRUCTURAL kind of the candidate's geometry.
 *
 * Both can coexist on one candidate.
 *
 * ## Serialization
 *
 * Lives on the `.m0` / `.m0c` / `.m0p` agent header block under the single
 * `# m0agent:context:` header line (one JSON object). The file-format
 * parsers deserialize as `unknown` and narrow with the wire normalizer;
 * {@link normalizeCandidateContext} here is the same function re-typed to
 * this refinement.
 * ============================================================================
 */

import { normalizeCandidateContext as normalizeWireCandidateContext } from "@m0saic/dsl-file-formats";
import type { CandidateContext as WireCandidateContext } from "@m0saic/dsl-file-formats";
import type { LayoutIntent } from "./scoring";
import type { CandidateEvaluation, CandidateRelation } from "./candidate";
import type { SessionCategory, SessionIntent } from "./category";
import type { RegionAnnotation } from "./region";
import type { CandidateRef, SessionRef } from "./session";
import type { SessionPhase } from "./session-summary";

export type CandidateContext = {
  /**
   * Which session this candidate belongs to. Denormalized onto the
   * candidate so the file is self-describing — readers don't need to walk
   * the directory tree to know what session a stray `.m0` came from.
   */
  session?: SessionRef;

  /** Where in the iteration sequence this candidate sits. */
  candidate?: CandidateRef;

  /**
   * Explicit phase override. Absent → summarizer infers from position
   * (default split: candidates fall into thirds). Set on a candidate when
   * the session's arc legitimately doesn't match a uniform-thirds split
   * (e.g. a long refining phase followed by a single ship candidate).
   */
  phase?: SessionPhase;

  /**
   * What class of layout problem this session is solving — picked by the
   * human or agent. See `./category.ts`. Closed union with an `other`
   * escape hatch.
   */
  category?: SessionCategory;

  /** What the writing party is trying to accomplish on THIS candidate. */
  intent?: SessionIntent;

  /**
   * Structural kind of THIS candidate's geometry — picked by the scorer's
   * caller. Re-exported from `../scoring` for vocabulary unity. Orthogonal
   * to `category` (see `./category.ts` header comment).
   */
  layoutIntent?: LayoutIntent;

  /**
   * Richer per-region annotations than the bare `Record<string,string>`
   * on `M0AgentMeta.regions`. Keyed by stableKey, same identity scheme.
   * Free to coexist with the cheap shape — readers prefer this map when
   * present, fall back to `regions` otherwise.
   */
  regionAnnotations?: Record<string /* stableKey */, RegionAnnotation>;

  /**
   * Evaluation of THIS candidate — the chess-grade plus optional
   * automated `ScoreBreakdown`. Lives under context (rather than
   * promoted to a first-class header): nest, don't expand the header
   * surface.
   */
  evaluation?: CandidateEvaluation;

  /** Lineage to a previous candidate. */
  relation?: CandidateRelation;

  /**
   * Free-form escape hatch — anything not yet first-class. Also where the
   * normalizer parks JSON found in `context` that doesn't conform to the
   * other fields, so old files round-trip without loss.
   */
  extras?: Record<string, unknown>;
};

/**
 * Compile-time guard: the typed refinement must stay assignable to the
 * wire shape, so a typed context can always be handed to a serializer.
 */
type AssertAssignable<T extends U, U> = T;
type _CandidateContextIsWireCompatible = AssertAssignable<CandidateContext, WireCandidateContext>;

/**
 * Shallow-narrow an arbitrary value into a {@link CandidateContext}.
 *
 * Delegates to the file-format wire normalizer (recognized slots land
 * verbatim, unknown fields route into `extras`, non-objects wrap under
 * `extras.raw`, empty → `undefined`) and re-types the result to the
 * protocol refinement. The type system is the contract; slot values are
 * not deep-validated.
 */
export function normalizeCandidateContext(
  raw: unknown,
): CandidateContext | undefined {
  return normalizeWireCandidateContext(raw) as CandidateContext | undefined;
}
