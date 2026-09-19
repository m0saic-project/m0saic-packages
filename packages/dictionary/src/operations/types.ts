/**
 * Shared types for layout-operation descriptors.
 *
 * An OPERATION is anything a user can do to a layout from the editor UI —
 * the superset that contains the dictionary generators. Where a generator
 * PRODUCES a fresh m0 string from params alone, the other operation kinds
 * act on the CURRENT document and are applied by the editor's own
 * handlers (which carry metadata migration — rekeying labels, masks,
 * fills, ranks):
 *
 *   - "generator" — params → fresh m0 (grid, magazine, qr-code, …).
 *     Computed and validated agent/caller-side; the editor applies the
 *     finished string.
 *   - "transform" — params + current m0 → new m0 (compact, split). The
 *     editor computes the result via its existing handler so rekey pairs
 *     and metadata migration stay in one place.
 *   - "rect-op"   — params describe a rectangle mutation on the current
 *     document (edit a frame by label, draw a new frame). Reduces to the
 *     null-out + placeRect + relabel primitive editor-side.
 *
 * Descriptors reuse {@link GeneratorParamDescriptor} verbatim — the same
 * shape that already drives the dictionary panel's param editor — so any
 * UI (or agent grammar) that can render generator params can render
 * operation params with zero new control logic.
 */

import type { GeneratorDescriptor } from "../generators/types";

/** Discriminates how an operation's result is computed and applied. */
export type OperationKind = "generator" | "transform" | "rect-op";

/**
 * Descriptor for one layout operation. Structurally a
 * {@link GeneratorDescriptor} plus the operation `kind`, so every
 * consumer of generator descriptors (param editors, prompt builders,
 * grammar schemas) accepts an OperationDescriptor unchanged.
 */
export type OperationDescriptor = GeneratorDescriptor & {
  kind: OperationKind;
  /**
   * When `true`, filling this operation's params meaningfully requires
   * the current document (frame labels + geometry, canvas size) — e.g.
   * `edit` targets a frame by label, `split` may name a target frame.
   * Agents should include a document-context section in the param-filling
   * prompt; UIs already have the document on screen.
   */
  needsDocumentContext?: boolean;
};
