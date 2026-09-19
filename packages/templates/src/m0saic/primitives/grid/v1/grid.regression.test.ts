/**
 * Regression — the presence contract catches grid/v1's silent nested drop.
 *
 * `@m0saic/primitives/grid/v1` is DEPRECATED and kept as a learning artifact: its
 * single-axis path bakes each line's ABSOLUTE pixel position into a per-pixel
 * `placeRects` split (m0 like `1080[0,…]`). Standalone it renders exactly, but
 * nested and re-parsed at a smaller canvas the per-pixel basis re-divides below
 * 1px and the grid is SILENTLY DROPPED (`SPLIT_EXCEEDS_AXIS` at flatten) — the
 * bug that motivated grid/v2 and, eventually, the whole precision-in-nesting
 * body of work.
 *
 * This test proves that a parent which merely TAGS the gridlines and asserts
 * `{ label: "gridline" }` would have caught the drop at the exact canvas it
 * broke — turning a years-later eyeball discovery into an immediate loud failure
 * with the reason. It uses the REAL deprecated template, so it doubles as a
 * living guardrail on the layout contract's presence-through-nesting path.
 */
import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { checkLayout } from "@m0saic/template-utils";
import { PrimitiveGrid } from "./grid";

const ctxFor = (w: number, h: number): MosaicEngineContext =>
  ({ mode: "render", target: { width: w, height: h, fps: 30, durationMs: 2000 }, output: { width: w, height: h, fps: 30, durationMs: 2000, workspaceDir: "/tmp/grid-reg" }, media: {} } as unknown as MosaicEngineContext);

/** Render the real grid/v1 at `bake`², tag its gridline sources, and nest it as a
 *  child so a parent can assert the gridlines are present after flatten. */
async function nestedGrid(bake: number): Promise<MosaicDocument> {
  const gridDoc = (await PrimitiveGrid.render({ ...(PrimitiveGrid.defaultProps as object) } as never, ctxFor(bake, bake))) as MosaicDocument;
  (gridDoc.sources ?? []).forEach((s: MosaicSource) => {
    (s as { editor?: { label?: string } }).editor = { label: "gridline" };
  });
  return {
    kind: "mosaic_document", version: 1, assets: {} as never, m0: "1" as never,
    sources: [{ type: "mosaic", ref: "grid", editor: { label: "grid-slot" } } as unknown as MosaicSource],
    children: { grid: gridDoc },
  } as unknown as MosaicDocument;
}

describe("primitives/grid/v1 — nested-drop regression (presence contract)", () => {
  it("is the deprecated learning artifact (absolute per-pixel basis)", () => {
    expect((PrimitiveGrid as { deprecated?: unknown }).deprecated).toBeTruthy();
    const doc = { m0: "" };
    // sanity: its baked m0 is a per-pixel split like `1080[…]`.
    return PrimitiveGrid.render({ ...(PrimitiveGrid.defaultProps as object) } as never, ctxFor(1080, 1080)).then((g) => {
      doc.m0 = String((g as MosaicDocument).m0);
      expect(doc.m0).toMatch(/^\d{3,}\[/); // three+ digit basis = per-pixel (absolute)
    });
  });

  it("PRESENT where the baked basis survives (nested at ≥ its canvas)", async () => {
    const parent = await nestedGrid(1080);
    const res = checkLayout(parent, { canvasW: 1080, canvasH: 1080, constraints: [{ label: "gridline" }] });
    expect(res.ok).toBe(true);
    expect(res.resolved["gridline"].length).toBeGreaterThan(0);
  });

  it("DROPS at a smaller canvas — and the presence contract catches it LOUD", async () => {
    const parent = await nestedGrid(1080);
    // 720² < the 1080 per-pixel basis → SPLIT_EXCEEDS_AXIS on flatten → the grid
    // silently vanishes. The presence assertion turns that into a violation.
    const res = checkLayout(parent, { canvasW: 720, canvasH: 720, constraints: [{ label: "gridline" }] });
    expect(res.ok).toBe(false);
    expect(res.violations[0].rule).toBe("missing-label");
    expect(res.violations[0].label).toBe("gridline");
    expect(res.violations[0].detail).toMatch(/collapsed|flatten failed|SPLIT_EXCEEDS_AXIS/);
  });
});
