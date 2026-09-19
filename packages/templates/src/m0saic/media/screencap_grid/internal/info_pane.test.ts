import type { MosaicDocument, MosaicEngineContext } from "@m0saic/types";
import { InfoPane } from "./info_pane";

function makeCtx(height = 1080): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: 1920, height, fps: 30, durationMs: 40 },
    output: { width: 1920, height, fps: 30, durationMs: 40, workspaceDir: "" },
    media: {},
  };
}

type TextLayer = {
  content?: { text?: string };
  style?: { fontSize?: number };
  placement?: { yExpr?: string; padding?: { y?: number } };
};

async function renderLayers(height = 1080): Promise<TextLayer[]> {
  const doc = (await InfoPane.render(
    { title: "clip.mov", metadata: "line1\nline2\nline3", paneHeight: 110, align: "left" },
    makeCtx(height),
  )) as MosaicDocument;
  return (doc.sources[0] as { layers?: TextLayer[] }).layers ?? [];
}

describe("InfoPane — pixel-anchored layer geometry", () => {
  // This doc rasterizes at the FULL parent canvas (wrapper-stamped size),
  // not at paneHeight. Fractional y padding resolves against the raster
  // height in the engine (y = h * padding.top), so BOTH layers must be
  // pixel-anchored via yExpr or the title drifts below the metadata block
  // (the 2026-07 info-pane overlap regression).
  it("title is pixel-anchored at topPad, not fractional padding", async () => {
    const [titleLayer] = await renderLayers();
    expect(titleLayer.placement?.yExpr).toBe("6");
    expect(titleLayer.placement?.padding?.y).toBeUndefined();
  });

  it("metadata starts below the full title block (topPad + titleLineH + gap)", async () => {
    const [titleLayer, metaLayer] = await renderLayers();
    // At 1080p: titleFontSize 24 → 6 + round(24*1.3) + round(24*0.35) = 45.
    expect(metaLayer.placement?.yExpr).toBe("45");
    const titleFs = titleLayer.style?.fontSize ?? 0;
    const titleBottom = 6 + titleFs;
    expect(Number(metaLayer.placement?.yExpr)).toBeGreaterThanOrEqual(titleBottom);
  });

  it("layer y anchors are independent of the raster height", async () => {
    // Same pixel anchors whether the doc rasterizes at the pane cell or the
    // full canvas — the invariant that keeps the pane immune to how the
    // engine sizes the child render.
    const at1080 = await renderLayers(1080);
    const at2160 = await renderLayers(2160);
    expect(at1080[0].placement?.yExpr).toBe("6");
    expect(at2160[0].placement?.yExpr).toBe("6");
  });
});
