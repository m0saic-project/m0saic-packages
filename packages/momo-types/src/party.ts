/**
 * Party identifier. Discriminated by colon-prefix, matching the existing
 * `M0AgentResponse.from` / `M0AgentComment.from` convention.
 *
 * Tooling routes on the prefix:
 *   - `human` / `human:<name>` — human reviewer / named human
 *   - `agent:<id>`              — AI agent identified by model or role
 *
 * The bare `"human"` form is the conventional default when no name is known.
 *
 * Note: this is a TypeScript template-literal type, enforced at compile time
 * only. The runtime `from` field on the existing `M0AgentResponse` /
 * `M0AgentComment` types stays `string` for backwards-compat with files
 * authored before this contract existed; new code should produce values
 * conforming to `PartyId`.
 */
export type PartyId =
  | "human"
  | `human:${string}`
  | `agent:${string}`;
