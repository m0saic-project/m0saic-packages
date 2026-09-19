// Sanity tests for the operation descriptors. Mirrors the invariants the
// generator descriptors live by (unique ids, well-formed params) plus the
// operation-specific contract bits (kind values, required flags).

import { generators } from "../index";
import { descriptors as operationDescriptors } from "./descriptors";

describe("operation descriptors", () => {
  it("exposes the four operations in display order", () => {
    expect(operationDescriptors.map((d) => d.id)).toEqual([
      "compact",
      "split",
      "edit",
      "draw",
    ]);
  });

  it("never collides with a generator id (shared pick-stage enum)", () => {
    const generatorIds = new Set(generators.descriptors.map((d) => d.id));
    for (const op of operationDescriptors) {
      expect(generatorIds.has(op.id)).toBe(false);
    }
  });

  it("only uses non-generator kinds", () => {
    for (const op of operationDescriptors) {
      expect(["transform", "rect-op"]).toContain(op.kind);
    }
  });

  it("params are well-formed (unique keys, enum options, defaults in range)", () => {
    for (const op of operationDescriptors) {
      const keys = op.params.map((p) => p.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const p of op.params) {
        if (p.type === "enum") {
          expect(p.options && p.options.length > 0).toBe(true);
          expect(p.options!.map((o) => o.value)).toContain(p.default);
        }
        if (typeof p.default === "number") {
          if (p.min !== undefined) expect(p.default).toBeGreaterThanOrEqual(p.min);
          if (p.max !== undefined) expect(p.default).toBeLessThanOrEqual(p.max);
        }
        if (p.visibleWhen) {
          for (const dep of Object.keys(p.visibleWhen)) {
            expect(keys).toContain(dep);
          }
        }
      }
    }
  });

  it("document-context-dependent ops are flagged; compact is not", () => {
    const byId = Object.fromEntries(operationDescriptors.map((d) => [d.id, d]));
    expect(byId.compact.needsDocumentContext).toBeUndefined();
    expect(byId.split.needsDocumentContext).toBe(true);
    expect(byId.edit.needsDocumentContext).toBe(true);
    expect(byId.draw.needsDocumentContext).toBe(true);
  });

  it("edit requires a target; no other op param is required", () => {
    for (const op of operationDescriptors) {
      for (const p of op.params) {
        if (op.id === "edit" && p.key === "target") {
          expect(p.required).toBe(true);
        } else {
          expect(p.required).toBeUndefined();
        }
      }
    }
  });
});
