import type { M0String } from "@m0saic/dsl";
import { toM0String } from "@m0saic/dsl-stdlib";

/**
 * Finalize a raw m0saic DSL string into a canonical, validated `M0String`.
 *
 * This is the ONLY blessed path for template-utils to produce M0String.
 * - canonicalizes (whitespace removal, F→1, >→0)
 * - rewrites overlay chains into nested form
 * - validates grammar + invariants
 * - throws with context on failure
 */
export function finalizeM0saic(raw: string, context: string): M0String {
  return toM0String(raw, context);
}