# Changelog

## 1.0.0 — 2026-09-19

### `@m0saic/momo-types` — initial publish: the agent layer over m0saic, in one place

`@m0saic/momo-types` becomes a published package: the intentionally
LIGHTWEIGHT, mostly shape-only vocabulary for everything agent-related over
m0saic — the things every consumer (file formats, the desktop app, third-party
agent tooling, momo's own runtime) needs to share when dealing with agents:

- **Agent annotation layer** (new `src/agent.ts`, canonicalized from
  `@m0saic/momo`): `M0AgentMeta`, `M0AgentResponse` (incl. the new `src`
  render-provenance pointer + `images` b64 screenshot attachments),
  `M0AgentComment`, `M0AgentMetaInput`, plus pure helpers `mintAgentId`,
  `collapseAgentProse`, `normalizeM0AgentMeta/Response/Comment`.
- **Work-session vocabulary** (existing): `CandidateContext` +
  `normalizeCandidateContext`, `SessionCategory` / `SessionIntent`,
  `CandidateEvaluation` / `CandidateGrade` / `gradeFromScore` (scoring
  concerns), `SessionRef` / `CandidateRef`, `PartyId`, `RegionAnnotation`,
  session summaries.

The heavier `@m0saic/momo` (model runtime, loop, prompt building) remains
private/unpublished and re-exports these types for back-compat. The
structural-mirror copies that lived in `@m0saic/dsl-file-formats` are
retired in the same cycle (it re-exports from here).

**Compatibility.**

- New publish; no consumers to break. `@m0saic/dsl-file-formats` (published)
  takes this as a dependency — the two must ship together.
