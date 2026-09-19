import type { MosaicDocument, MosaicEngineContext, MosaicLavfiSource } from "@m0saic/types";
import { isValidM0String } from "@m0saic/dsl";
import { buildOverlayStack } from "@m0saic/template-utils";
import { PrimitiveGridV2, type PrimitiveGridV2Props } from "./grid";

function makeCtx(width = 1024, height = 1024): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width, height, fps: 30, durationMs: 2000 },
    output: { width, height, fps: 30, durationMs: 2000, workspaceDir: "/tmp/grid-v2" },
    media: {},
  } as unknown as MosaicEngineContext;
}

async function render(props: PrimitiveGridV2Props, width?: number, height?: number): Promise<MosaicDocument> {
  return (await PrimitiveGridV2.render(props, makeCtx(width, height))) as MosaicDocument;
}

describe("@m0saic/primitives/grid/v2", () => {
  it("emits a single transparent base when hidden or trivial", async () => {
    for (const props of [{ show: false }, { count: 1 }, { count: 0 }] as PrimitiveGridV2Props[]) {
      const doc = await render(props);
      expect(doc.sources).toHaveLength(1);
      expect(String(doc.m0)).toBe(String(buildOverlayStack(1))); // single passthrough base
    }
  });

  it("horizontal grid: base + (count-1) interior lines, proportional overlay chain", async () => {
    const doc = await render({ direction: "horizontal", count: 5, excludeEdges: true });
    // base + 4 interior lines
    expect(doc.sources).toHaveLength(5);
    expect(String(doc.m0)).toBe(String(buildOverlayStack(5)));
  });

  it("includeEdges adds the 0 and count boundary lines", async () => {
    const doc = await render({ direction: "horizontal", count: 5, excludeEdges: false });
    // base + 6 lines (i = 0..5)
    expect(doc.sources).toHaveLength(7);
  });

  it("both: base + 2*(count-1) lines", async () => {
    const doc = await render({ direction: "both", count: 5, excludeEdges: true });
    expect(doc.sources).toHaveLength(1 + 2 * 4);
  });

  it("COMPOSABILITY: m0 is a pure proportional overlay chain — NO per-pixel split basis", async () => {
    // This is the whole reason v2 exists. v1's single-axis path emitted a
    // placeRects split whose basis was the plot dimension in px (e.g.
    // `1024[0,1,0,…]`) — a canvas-scale numeric basis that the engine re-divides
    // below 1px when nested, silently dropping the grid. v2 must NEVER emit a
    // numeric basis: the m0 is only F + braces, and it is byte-identical across
    // canvases (position lives in the overlay exprs, not the split).
    const a = String((await render({ direction: "horizontal", count: 6 }, 1024, 1024)).m0);
    const b = String((await render({ direction: "horizontal", count: 6 }, 1080, 1080)).m0);
    // Pure weight-1 overlay chain (`1{1{…}}`): no `[claimant]` placeRects split,
    // and no multi-digit canvas-scale basis (v1 emitted e.g. `1024[0,1,0,…]`).
    expect(a).not.toContain("["); // no placeRects claimant split
    expect(a).not.toMatch(/\d{2,}/); // no canvas-scale numeric basis
    expect(a).toBe(b); // canvas-independent m0 — position lives in overlay exprs
    expect(isValidM0String(a)).toBe(true);
  });

  it("horizontal lines are positioned by a proportional Y offset (H*frac)", async () => {
    const doc = await render({ direction: "horizontal", count: 5 });
    const lines = doc.sources.slice(1) as MosaicLavfiSource[];
    expect(lines).not.toHaveLength(0);
    for (const l of lines) {
      expect(l.overlay?.yExpr ?? "").toContain("H*");
    }
  });

  it("vertical lines are positioned by a proportional X offset (W*frac)", async () => {
    const doc = await render({ direction: "vertical", count: 5 });
    const lines = doc.sources.slice(1) as MosaicLavfiSource[];
    expect(lines).not.toHaveLength(0);
    for (const l of lines) {
      expect(l.overlay?.xExpr ?? "").toContain("W*");
    }
  });

  it("origin flips the fraction reference (top vs bottom differ)", async () => {
    const bottom = await render({ direction: "horizontal", count: 5, origin: "bottom" });
    const top = await render({ direction: "horizontal", count: 5, origin: "top" });
    const bY = (bottom.sources[1] as MosaicLavfiSource).overlay?.yExpr;
    const tY = (top.sources[1] as MosaicLavfiSource).overlay?.yExpr;
    expect(bY).toBeDefined();
    expect(bY).not.toBe(tY);
  });

  it("is deterministic — identical inputs produce identical output", async () => {
    const props: PrimitiveGridV2Props = { direction: "both", count: 7, color: "#abcdef", opacity: 0.2 };
    const one = await render(props);
    const two = await render(props);
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });

  it("is marked a core primitive (composable shelf), not deprecated", async () => {
    expect(PrimitiveGridV2.primitive).toBe(true);
    expect(PrimitiveGridV2.capabilities?.tier).toBe("core");
    expect(PrimitiveGridV2.deprecated).toBeUndefined();
    expect(PrimitiveGridV2.version).toBe(2);
  });
});
