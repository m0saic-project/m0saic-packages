import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String } from "@m0saic/dsl";
import { buildContractWireframe } from "./violationWireframe";
import { checkLayout } from "./layoutConstraint";
import { withLayoutContract } from "./withLayoutContract";

const W = 1000;
const H = 800;

const src = (label: string): MosaicSource =>
  ({ type: "lavfi", color: "#000000", editor: { label } } as unknown as MosaicSource);

/** Two side-by-side cells (`2(F,F)` = 500×800 each), both tagged "bar". */
const doc2 = (): MosaicDocument =>
  ({ kind: "mosaic_document", version: 1, assets: {} as never, m0: "2(F,F)" as never, sources: [src("bar"), src("bar")] } as MosaicDocument);

const ctxFor = (w: number, h: number): MosaicEngineContext => {
  const t = { width: w, height: h, fps: 30, durationMs: 2000 };
  return { mode: "render", target: t, output: { ...t, workspaceDir: "/tmp/violation-wire" }, media: {} } as unknown as MosaicEngineContext;
};

const colorOf = (s: MosaicSource): string | undefined => (s as { color?: string }).color;

describe("buildContractWireframe — the visual tripwire", () => {
  // `2(F,F)` cells are equal, so force a violation via a per-element rule the
  // cells genuinely break: each cell is 62.5% of the width's… height fraction:
  // 800/800 = 1.0 > maxHeightFrac 0.5 → two violations with sourceIndex set.
  const violate = () =>
    checkLayout(doc2(), { canvasW: W, canvasH: H, constraints: [{ label: "bar", maxHeightFrac: 0.5 }] });

  it("draws a valid wireframe doc with the offending boxes highlighted red", () => {
    const result = violate();
    expect(result.ok).toBe(false);
    const wire = buildContractWireframe({ templateId: "@test/wire/v1", canvasW: W, canvasH: H, doc: doc2(), violations: result.violations });
    expect(wire).not.toBeNull();
    expect(isValidM0String(wire!.m0 as unknown as string)).toBe(true);
    const colors = (wire!.sources as MosaicSource[]).map(colorOf);
    // Both frames offend → two red fills; plus bg + banner tiles, no gray frames.
    expect(colors.filter((c) => c === "#f85149@0.35")).toHaveLength(2);
    expect(wire!.size).toEqual({ width: W, height: H });
  });

  it("equal-relation offenders are recomputed from the resolved boxes (median rule)", () => {
    // Three side-by-side columns (`(` = column split), middle one double-width
    // via donation → widths 250/500/250. equal-width violates; ONLY the middle
    // box strays from the median.
    const doc: MosaicDocument = {
      kind: "mosaic_document", version: 1, assets: {} as never,
      m0: "4(1,0,1,1)" as never, // weights 1,2,1 via donation: cell2 donates into cell3
      sources: [src("bar"), src("bar"), src("bar")],
    } as MosaicDocument;
    const result = checkLayout(doc, { canvasW: W, canvasH: H, relations: [{ label: "bar", equal: "width" }] });
    expect(result.ok).toBe(false);
    const wire = buildContractWireframe({ templateId: "@test/wire/v1", canvasW: W, canvasH: H, doc, violations: result.violations });
    expect(wire).not.toBeNull();
    const reds = (wire!.sources as MosaicSource[]).filter((s) => colorOf(s) === "#f85149@0.35");
    expect(reds).toHaveLength(1); // the doubled middle row only
  });

  it("withLayoutContract now returns the wireframe (stamped) instead of the text card", () => {
    const out = withLayoutContract(doc2(), ctxFor(W, H), {
      templateId: "@test/wire/v1",
      constraints: [{ label: "bar", maxHeightFrac: 0.5 }],
      debug: true,
    });
    const stamp = (out as { editor?: { layoutContract?: { ok?: boolean } } }).editor?.layoutContract;
    expect(stamp?.ok).toBe(false);
    const colors = ((out.sources ?? []) as MosaicSource[]).map(colorOf);
    expect(colors).toContain("#f85149@0.35"); // wireframe, not makeErrorMosaic
    expect(colors).toContain("#0d1117"); // its background tile
  });

  it("painted (default) bakes insets into granular rects; cells keeps the raw lattice", () => {
    // One cell shrunk by an inset fiber: painted mode must draw the SHRUNK box
    // (bakeDocumentInsets), cells mode the full split cell — different m0s,
    // same offenders. The painted red box is what the viewer actually sees.
    const inset = (label: string): MosaicSource =>
      ({ type: "lavfi", color: "#000000", editor: { label }, placement: { inset: { y: 0.25 } } } as unknown as MosaicSource);
    const doc: MosaicDocument =
      ({ kind: "mosaic_document", version: 1, assets: {} as never, m0: "2(F,F)" as never, sources: [inset("bar"), src("bar")] } as MosaicDocument);
    const result = checkLayout(doc, { canvasW: W, canvasH: H, relations: [{ label: "bar", equal: "height" }] });
    expect(result.ok).toBe(false); // painted heights 400 vs 800

    const base = { templateId: "@test/wire/v1", canvasW: W, canvasH: H, doc, violations: result.violations } as const;
    const painted = buildContractWireframe({ ...base });
    const cells = buildContractWireframe({ ...base, boxes: "cells" });
    expect(painted).not.toBeNull();
    expect(cells).not.toBeNull();
    expect(isValidM0String(painted!.m0 as unknown as string)).toBe(true);
    expect(isValidM0String(cells!.m0 as unknown as string)).toBe(true);
    // The bake changed the drawn geometry…
    expect(String(painted!.m0)).not.toBe(String(cells!.m0));
    // …but not the verdict: the offender highlight survives in both views.
    const reds = (d: MosaicDocument) => (d.sources as MosaicSource[]).filter((s) => colorOf(s) === "#f85149@0.35").length;
    expect(reds(painted!)).toBeGreaterThan(0);
    expect(reds(cells!)).toBe(reds(painted!));
  });

  it("PASS is drawn too — rule members green, banner lists the measured rules", () => {
    // 2026-08-20 (founder): a passing contract that no-ops is indistinguishable
    // from one that never ran. debug on now ALWAYS returns the wireframe:
    // members green on pass, offenders red on fail.
    const out = withLayoutContract(doc2(), ctxFor(W, H), {
      templateId: "@test/wire/v1",
      relations: [{ label: "bar", equal: "size" }],
      debug: true,
    });
    const stamp = (out as { editor?: { layoutContract?: { ok?: boolean } } }).editor?.layoutContract;
    expect(stamp?.ok).toBe(true);
    const colors = ((out.sources ?? []) as MosaicSource[]).map(colorOf);
    expect(colors.filter((c) => c === "#2ea043@0.30")).toHaveLength(2); // both members green
    expect(colors).not.toContain("#f85149@0.35"); // nothing red
    expect(colors).toContain("#0d1117"); // it IS the wireframe, not the original doc
    // The banner carries the rule + its measured result.
    const texts = ((out.sources ?? []) as Array<{ type?: string; layers?: Array<{ content?: { text?: string } }> }>)
      .filter((s) => s.type === "text")
      .map((s) => s.layers?.[0]?.content?.text ?? "");
    expect(texts.some((t) => t.includes("LAYOUT_CONTRACT OK"))).toBe(true);
    expect(texts.some((t) => t.includes('"bar" equal size OK'))).toBe(true);
  });

  it("debug off stays a zero-cost no-op — same doc reference back", () => {
    const doc = doc2();
    const out = withLayoutContract(doc, ctxFor(W, H), {
      templateId: "@test/wire/v1",
      relations: [{ label: "bar", equal: "size" }],
    });
    expect(out).toBe(doc);
  });
});
