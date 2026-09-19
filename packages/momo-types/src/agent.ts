/**
 * ============================================================================
 * @m0saic/momo-types/agent — the agent layer over m0saic, typed
 * ============================================================================
 *
 * The on-disk annotation shapes (`M0AgentMeta`, `M0AgentResponse`,
 * `M0AgentComment`) and the transport helpers (`mintAgentId`,
 * `collapseAgentProse`, `normalizeAgentProse`) are OWNED by
 * `@m0saic/dsl-file-formats` — they are the `.m0` / `.m0c` / `.m0p` wire
 * format. This module re-exports them so every agent-side consumer (the
 * desktop app, the `@m0saic/momo` runtime, third-party tooling) has one
 * import, and adds what the file formats deliberately do not know about:
 * the typed `CandidateContext` refinement and the full-struct normalizers
 * that use it.
 *
 * Nothing here is duplicated from the file formats: the typed
 * {@link M0AgentMeta} is DERIVED from the wire type by narrowing its
 * `context` slot, so the two can never drift.
 * ============================================================================
 */

import {
  mintAgentId,
  collapseAgentProse,
  normalizeAgentProse,
} from "@m0saic/dsl-file-formats";
import type {
  M0AgentMeta as WireM0AgentMeta,
  M0AgentResponse,
  M0AgentComment,
} from "@m0saic/dsl-file-formats";
import { normalizeCandidateContext } from "./context";
import type { CandidateContext } from "./context";

export { mintAgentId, collapseAgentProse, normalizeAgentProse };
export type { M0AgentResponse, M0AgentComment };

/**
 * Annotation block — prose for the human, JSON for the next agent. The
 * file-format shape with `context` narrowed to the typed
 * {@link CandidateContext}. Assignable to the wire type, so it can be
 * handed straight to any serializer.
 */
export type M0AgentMeta = Omit<WireM0AgentMeta, "context"> & {
  context?: CandidateContext;
};

/**
 * Loose-shape input accepted by {@link normalizeM0AgentMeta}. Identical to
 * {@link M0AgentMeta} except `context` is `unknown` — the shape that comes
 * out of a raw `JSON.parse` on a header line. The normalizer narrows it to
 * the strict {@link CandidateContext} on the way out (routing any
 * non-conforming fields into `extras` so old files round-trip without
 * loss). Any value satisfying `M0AgentMeta` also satisfies this type, so
 * existing callers continue to work.
 */
export type M0AgentMetaInput = Omit<M0AgentMeta, "context"> & {
  context?: unknown;
};

/**
 * Normalize an agent block for serialization. Drops empty prose, empty
 * region maps, and collapses the whole struct to `null` when nothing is
 * left. Region values are coerced to strings (non-string entries are
 * dropped); `context` is shallow-narrowed via
 * {@link normalizeCandidateContext} — recognized fields land in their
 * typed slots; anything else routes into `extras` so files written before
 * the schema existed keep round-tripping.
 */
export function normalizeM0AgentMeta(
  agent: M0AgentMetaInput | null | undefined,
): M0AgentMeta | null {
  if (!agent) return null;
  const out: M0AgentMeta = {};
  if (agent.id && agent.id.trim() !== "") {
    out.id = agent.id.trim();
  }
  if (agent.note && agent.note.trim() !== "") {
    out.note = normalizeAgentProse(agent.note);
  }
  if (agent.question && agent.question.trim() !== "") {
    out.question = normalizeAgentProse(agent.question);
  }
  if (agent.regions) {
    const regions: Record<string, string> = {};
    for (const [k, v] of Object.entries(agent.regions)) {
      if (typeof v === "string" && v.trim() !== "") regions[k] = v;
    }
    if (Object.keys(regions).length) out.regions = regions;
  }
  if (agent.context !== undefined) {
    const normalizedContext = normalizeCandidateContext(agent.context);
    if (normalizedContext !== undefined) out.context = normalizedContext;
  }
  if (agent.response) {
    const normalizedResponse = normalizeM0AgentResponse(agent.response);
    if (normalizedResponse) out.response = normalizedResponse;
  }
  if (agent.comments && agent.comments.length > 0) {
    const normalizedComments: M0AgentComment[] = [];
    for (const c of agent.comments) {
      const n = normalizeM0AgentComment(c);
      if (n) normalizedComments.push(n);
    }
    if (normalizedComments.length) out.comments = normalizedComments;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Normalize a response: trim the body, drop empty optional fields,
 * keep `from` / `at` / `src` when present and pass `images` (b64
 * data-URI attachments) through VERBATIM — no whitespace surgery
 * inside data-URIs. Returns `null` when the body is empty (no body =
 * no response to record).
 */
export function normalizeM0AgentResponse(
  response: M0AgentResponse | null | undefined,
): M0AgentResponse | null {
  if (!response) return null;
  const body = response.body ? normalizeAgentProse(response.body) : "";
  if (body === "") return null;
  const out: M0AgentResponse = { body };
  if (response.from && response.from.trim() !== "") out.from = response.from.trim();
  if (response.at && response.at.trim() !== "") out.at = response.at.trim();
  if (response.src && response.src.trim() !== "") out.src = response.src.trim();
  if (response.srcMosaic && response.srcMosaic.trim() !== "") out.srcMosaic = response.srcMosaic.trim();
  if (Array.isArray(response.images)) {
    const images = response.images.filter(
      (s): s is string => typeof s === "string" && s.length > 0,
    );
    if (images.length > 0) out.images = images;
  }
  return out;
}

/**
 * Normalize a comment: same contract as {@link normalizeM0AgentResponse}.
 * Empty body → null (so the orbit array doesn't grow with blank entries).
 */
export function normalizeM0AgentComment(
  comment: M0AgentComment | null | undefined,
): M0AgentComment | null {
  if (!comment) return null;
  const body = comment.body ? normalizeAgentProse(comment.body) : "";
  if (body === "") return null;
  const out: M0AgentComment = { body };
  if (comment.id && comment.id.trim() !== "") out.id = comment.id.trim();
  if (comment.from && comment.from.trim() !== "") out.from = comment.from.trim();
  if (comment.at && comment.at.trim() !== "") out.at = comment.at.trim();
  return out;
}
