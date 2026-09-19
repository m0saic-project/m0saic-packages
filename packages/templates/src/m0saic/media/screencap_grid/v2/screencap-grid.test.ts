import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicGeometryContractStamp,
  MosaicMediaMetadata,
  MosaicRenderableFile,
  MosaicSource,
} from "@m0saic/types";
import { isValidM0String } from "@m0saic/dsl";
import { makeM0saicTempPrefix } from "@m0saic/platform/paths";
import { defineMosaicTemplate } from "@m0saic/template-utils";
import { textEmUnits } from "@m0saic/template-utils";
import {
  ScreencapGridV2,
  computeGridTileRects,
  customGridTileInset,
  ellipsizeMiddleEm,
  paneLineEmBudget,
  renderScreencapGridV2,
  type ScreencapGridV2Props,
} from "./screencap-grid";
import { infoPaneMetaFontSize } from "../v1/screencap-grid";

function makeCtx(
  overrides?: Partial<MosaicEngineContext["target"]> & {
    workspaceDir?: string;
  },
): MosaicEngineContext {
  const ws =
    overrides?.workspaceDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), makeM0saicTempPrefix("screencap-grid-v2-test")));
  return {
    mode: "render" as const,
    target: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 2000,
      ...overrides,
    },
    output: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 2000,
      workspaceDir: ws,
      ...overrides,
    },
    media: {},
  };
}

function isPipeline(file: MosaicRenderableFile): file is MosaicDocumentPipeline {
  return file.kind === "mosaic_pipeline";
}

function isDocument(file: MosaicRenderableFile): file is MosaicDocument {
  return file.kind === "mosaic_document";
}

const VIDEO_META: MosaicMediaMetadata = {
  kind: "video",
  width: 1920,
  height: 1080,
  hasVideo: true,
  hasAudio: true,
  durationMs: 60000,
  fps: 24,
  originalFileName: "sample.mp4",
  format: {
    formatName: "mov,mp4,m4a,3gp,3g2,mj2",
    formatLongName: "QuickTime / MOV",
    sizeBytes: 50_000_000,
    bitRate: 6_666_666,
  },
  video: {
    codecName: "h264",
    codecLongName: "H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10",
    profile: "High",
    pixFmt: "yuv420p",
    colorSpace: "bt709",
    avgFrameRate: 24,
    streamIndex: 0,
  },
};

describe("ScreencapGridV2 template metadata", () => {
  it("has expected id and version", () => {
    expect(ScreencapGridV2.id).toBe("@m0saic/media/screencap_grid/v2");
    expect(ScreencapGridV2.version).toBe(2);
  });

  it("is not deprecated (it is the replacement)", () => {
    expect(ScreencapGridV2.deprecated).toBeUndefined();
  });

  it("has v1's defaultProps surface (drop-in)", () => {
    expect(ScreencapGridV2.defaultProps).toMatchObject({
      outputFormat: "png",
      rows: 4,
      cols: 4,
      infoPane: { show: true, align: "left" },
      timestamps: {
        show: true,
        corner: "br",
        color: "#ffffff",
        bgColor: "#000000",
      },
      tiles: { gapPx: 2, fit: "cover" },
    });
  });

  it("declares outputHints.format image/png (the frozen 0.2.0 declaration; the outputFormat knob still bakes the per-doc container)", () => {
    expect(ScreencapGridV2.outputHints?.format).toEqual({ kind: "image", container: "png" });
  });

  it("exposes the opt-in onboarding surfaces", () => {
    expect(typeof ScreencapGridV2.renderCover).toBe("function");
    expect(typeof ScreencapGridV2.renderTutorial).toBe("function");
  });

  it("renderCover is a cover page, not the fail-fast error mosaic", () => {
    // Same call the host makes on a pure-default open: no sources, empty media.
    const cover = ScreencapGridV2.renderCover!(
      { ...(ScreencapGridV2.defaultProps as ScreencapGridV2Props) },
      makeCtx(),
    );
    expect(cover).not.toBeInstanceOf(Promise);
    const doc = cover as MosaicDocument;
    expect(doc.kind).toBe("mosaic_document");
    expect(JSON.stringify(doc)).not.toContain('"renderStatus":"error"');
  });

  it("renderTutorial returns the walkthrough pipeline", () => {
    const tutorial = ScreencapGridV2.renderTutorial!(
      { ...(ScreencapGridV2.defaultProps as ScreencapGridV2Props) },
      makeCtx(),
    );
    expect((tutorial as MosaicDocumentPipeline).kind).toBe("mosaic_pipeline");
    expect((tutorial as MosaicDocumentPipeline).steps.length).toBe(8);
  });

  it("leaves render()'s fail-fast contract untouched", async () => {
    // The whole point of the opt-in surfaces: `render` still refuses to make
    // something out of nothing, for the CLI and for nested invocations.
    const out = await renderScreencapGridV2(
      { ...(ScreencapGridV2.defaultProps as ScreencapGridV2Props) },
      makeCtx(),
    );
    expect(JSON.stringify(out)).toContain('"renderStatus":"error"');
  });

  it("survives the defineMosaicTemplate wrapper with both surfaces intact", () => {
    const wrapped = defineMosaicTemplate<ScreencapGridV2Props>(ScreencapGridV2);
    expect(typeof wrapped.renderCover).toBe("function");
    expect(typeof wrapped.renderTutorial).toBe("function");
    expect(
      (wrapped.renderCover!(
        { ...(ScreencapGridV2.defaultProps as ScreencapGridV2Props) },
        makeCtx(),
      ) as MosaicDocument).kind,
    ).toBe("mosaic_document");
  });
});

describe("computeGridTileRects — exact pixel geometry", () => {
  const gapsBetween = (rects: { x: number; y: number; w: number; h: number }[], rows: number, cols: number) => {
    const xGaps: number[] = [];
    const yGaps: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c + 1 < cols; c++) {
        const a = rects[r * cols + c];
        const b = rects[r * cols + c + 1];
        xGaps.push(b.x - (a.x + a.w));
      }
    }
    for (let r = 0; r + 1 < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = rects[r * cols + c];
        const b = rects[(r + 1) * cols + c];
        yGaps.push(b.y - (a.y + a.h));
      }
    }
    return { xGaps, yGaps };
  };

  it("adjacent tiles are EXACTLY gapPx apart on the v1 failure case (970px region / 4 rows)", () => {
    // 1080 − 110 pane = 970 → v1's equal split quantized to 243/242/243/242
    // and its ideal-cell fractions floored to 0 on the 242px rows.
    const rects = computeGridTileRects({
      canvasW: 1920, canvasH: 1080, paneHeightPx: 110, rows: 4, cols: 4, tileGapPx: 2,
    });
    const { xGaps, yGaps } = gapsBetween(rects, 4, 4);
    expect(xGaps.every((g) => g === 2)).toBe(true);
    expect(yGaps.every((g) => g === 2)).toBe(true);
  });

  it("exact gaps across a sweep of canvases, grids, and gap sizes (odd gaps included)", () => {
    for (const [W, H, pane] of [
      [1920, 1080, 110],
      [1928, 2720, 133],
      [1000, 700, 0],
      [1013, 709, 57], // prime-ish dims
      [640, 360, 41],
    ] as const) {
      for (const [rows, cols] of [[4, 4], [7, 3], [1, 5], [3, 1]] as const) {
        for (const gap of [0, 1, 2, 3, 8] as const) {
          const rects = computeGridTileRects({
            canvasW: W, canvasH: H, paneHeightPx: pane, rows, cols, tileGapPx: gap,
          });
          expect(rects.length).toBe(rows * cols);
          const { xGaps, yGaps } = gapsBetween(rects, rows, cols);
          expect(xGaps.every((g) => g === gap)).toBe(true);
          expect(yGaps.every((g) => g === gap)).toBe(true);
          for (const r of rects) {
            expect(r.w).toBeGreaterThanOrEqual(1);
            expect(r.h).toBeGreaterThanOrEqual(1);
          }
        }
      }
    }
  });

  it("is full-bleed: outer edges flush with the canvas, row 0 hugs the pane", () => {
    const rects = computeGridTileRects({
      canvasW: 1920, canvasH: 1080, paneHeightPx: 110, rows: 3, cols: 3, tileGapPx: 4,
    });
    expect(rects[0].x).toBe(0);
    expect(rects[0].y).toBe(110);
    expect(rects[2].x + rects[2].w).toBe(1920);
    expect(rects[8].y + rects[8].h).toBe(1080);
  });

  it("clamps the gap so no tile collapses below 1px on tiny canvases", () => {
    const rects = computeGridTileRects({
      canvasW: 40, canvasH: 40, paneHeightPx: 0, rows: 10, cols: 10, tileGapPx: 8,
    });
    for (const r of rects) {
      expect(r.w).toBeGreaterThanOrEqual(1);
      expect(r.h).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("customGridTileInset — fixed custom-grid gap math", () => {
  const replayEngineFloor = (frac: number, dim: number) => Math.floor(frac * dim);

  it("half-pixel-centered fractions survive the engine floor (the n/cell loss case)", () => {
    // A 480px frame with gap 2: v1 emitted (1/480), and floor((1/480)·480)
    // could land at 0 under IEEE. The centered fraction always recovers 1.
    const inset = customGridTileInset({ x: 480, y: 0, width: 480, height: 480 }, 2, 1440, 480);
    expect(inset).toBeDefined();
    expect(replayEngineFloor(inset!.left as number, 480)).toBe(1);
    expect(replayEngineFloor(inset!.right as number, 480)).toBe(1);
  });

  it("shared boundaries sum to exactly gapPx, odd gaps included", () => {
    // Two 300px frames sharing a boundary: left frame carves trail, right
    // frame carves lead — together exactly the gap.
    for (const gap of [1, 2, 3, 5]) {
      const a = customGridTileInset({ x: 0, y: 0, width: 300, height: 600 }, gap, 600, 600);
      const b = customGridTileInset({ x: 300, y: 0, width: 300, height: 600 }, gap, 600, 600);
      const aRight = a ? replayEngineFloor(a.right as number, 300) : 0;
      const bLeft = b ? replayEngineFloor(b.left as number, 300) : 0;
      expect(aRight + bLeft).toBe(gap);
    }
  });

  it("is edge-aware: sides on the region boundary stay flush", () => {
    const inset = customGridTileInset({ x: 0, y: 0, width: 300, height: 300 }, 4, 600, 600);
    expect(inset).toBeDefined();
    expect(inset!.left).toBe(0);
    expect(inset!.top).toBe(0);
    expect(inset!.right).toBeGreaterThan(0);
    expect(inset!.bottom).toBeGreaterThan(0);
  });

  it("returns undefined for gap 0 and for a frame spanning the whole region", () => {
    expect(customGridTileInset({ x: 0, y: 0, width: 300, height: 300 }, 0, 600, 600)).toBeUndefined();
    expect(customGridTileInset({ x: 0, y: 0, width: 600, height: 600 }, 4, 600, 600)).toBeUndefined();
  });

  it("drops the carve on an axis where it would breach the engine's inset cap", () => {
    // A 3px-wide frame with gap 2: (1 + 0.5)/3 = 0.5 > 0.49 → x carve drops,
    // y carve (300px) survives.
    const inset = customGridTileInset({ x: 10, y: 10, width: 3, height: 300 }, 2, 600, 600);
    expect(inset).toBeDefined();
    expect(inset!.left).toBe(0);
    expect(inset!.right).toBe(0);
    expect(inset!.top).toBeGreaterThan(0);
    expect(inset!.bottom).toBeGreaterThan(0);
  });
});

describe("ScreencapGridV2 — outputFormat knob (per-doc format)", () => {
  it("default (png) bakes an image/png format on the document", async () => {
    const file = await ScreencapGridV2.render(
      { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: false } },
      makeCtx(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    expect(file.format).toEqual({ kind: "image", container: "png" });
  });

  it('outputFormat:"mp4" bakes a video/mp4 format on the document', async () => {
    const file = await ScreencapGridV2.render(
      { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: false }, outputFormat: "mp4" },
      makeCtx(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    expect(file.format).toEqual({ kind: "video", container: "mp4" });
  });

  it("multi-input steps each carry the mode's format", async () => {
    for (const outputFormat of ["png", "mp4"] as const) {
      const file = await ScreencapGridV2.render(
        { sourceIds: ["/tmp/a.mp4", "/tmp/b.mp4"], infoPane: { show: false }, outputFormat },
        makeCtx(),
      );
      if (!isPipeline(file)) throw new Error("expected pipeline");
      for (const step of file.steps) {
        expect(step.file?.format).toEqual(
          outputFormat === "mp4"
            ? { kind: "video", container: "mp4" }
            : { kind: "image", container: "png" },
        );
      }
    }
  });
});

describe("ScreencapGridV2 — document shape (generated grid)", () => {
  it("binds rows×cols media tiles plus one timestamp per tile", async () => {
    const file = await ScreencapGridV2.render(
      { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: false }, rows: 3, cols: 4 },
      makeCtx(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    expect(file.sources.filter((s) => s.type === "media").length).toBe(12);
    expect(file.sources.filter((s) => s.type === "text").length).toBe(12);
    expect(isValidM0String(String(file.m0))).toBe(true);
  });

  it("defaults timestamp chips to an opaque black background", async () => {
    const file = await ScreencapGridV2.render(
      {
        sourceIds: ["/tmp/clip.mp4"],
        infoPane: { show: false },
        rows: 1,
        cols: 1,
      },
      makeCtx(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    const stamp = file.sources.find((s) => s.type === "text") as
      | (MosaicSource & {
          layers?: Array<{ style?: { boxColor?: string; boxBorderWidth?: number } }>;
        })
      | undefined;
    expect(stamp?.layers?.[0]?.style?.boxColor).toBe("#000000");
    expect(stamp?.layers?.[0]?.style?.boxBorderWidth).toBe(6);
  });

  it("with the info pane refs the pane child with fit:cover focusY:0", async () => {
    const file = await ScreencapGridV2.render(
      { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: true }, rows: 2, cols: 2 },
      makeCtx(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    const pane = file.sources.find((s) => s.type === "mosaic") as
      | (MosaicSource & { ref?: string; placement?: { fit?: string; focusY?: number } })
      | undefined;
    expect(pane?.ref).toBe("info-pane");
    expect(pane?.placement?.fit).toBe("cover");
    expect(pane?.placement?.focusY).toBe(0);
    expect(file.children?.["info-pane"]).toBeDefined();
  });

  it("lattice-aligned grid (no pane, even split, no gap) needs no recovery insets", async () => {
    // 1920×1080, 2×2, gap 0: every tile edge lands on the divisor lattice
    // (960/540 at pitch 16/9), so no quantization recovery is needed and the
    // sources pass through untouched. (Any gap carves off-lattice edges —
    // those correctly get recovery insets.)
    const file = await ScreencapGridV2.render(
      { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: false }, timestamps: { show: false }, rows: 2, cols: 2, tiles: { gapPx: 0 } },
      makeCtx(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    const media = file.sources.filter((s) => s.type === "media") as Array<
      MosaicSource & { placement?: { inset?: unknown } }
    >;
    expect(media.length).toBe(4);
    for (const m of media) {
      expect(m.placement?.inset).toBeUndefined();
    }
  });

  it("never declares its own doc.size (always fills the user's canvas)", async () => {
    const file = await ScreencapGridV2.render(
      { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: false }, rows: 7, cols: 3 },
      makeCtx(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    expect(file.size).toBeUndefined();
  });

  it("fails fast when the canvas cannot fit the grid", async () => {
    const file = await ScreencapGridV2.render(
      { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: false }, rows: 20, cols: 20 },
      makeCtx({ width: 15, height: 15 }),
    );
    expect(isDocument(file)).toBe(true);
    if (!isDocument(file)) return;
    expect(file.sources.filter((s) => s.type === "media").length).toBe(0);
  });

  it("LEGACY flat props (pre-group / v1-era docs) still resolve", async () => {
    // A saved doc repointed from the deprecated v1 carries the flat names —
    // the resolver bridges them (grouped wins when both are present).
    const legacy = {
      sourceIds: ["/tmp/clip.mp4"],
      withInfoPane: false,
      withTileTimestamp: false,
      rows: 3,
      cols: 3,
      tileGap: 0.00417, // v1's ancient FRACTIONAL gap ≈ 2px
    } as unknown as Parameters<typeof ScreencapGridV2.render>[0];
    const file = await ScreencapGridV2.render(legacy, makeCtx());
    if (!isDocument(file)) throw new Error("expected document");
    // Flat toggles honored: no pane child, no timestamp text sources.
    expect(file.sources.filter((s) => s.type === "mosaic").length).toBe(0);
    expect(file.sources.filter((s) => s.type === "text").length).toBe(0);
    expect(file.sources.filter((s) => s.type === "media").length).toBe(9);
  });
});

/**
 * Deterministic error-mosaic predicate: `makeErrorMosaic` engine-marks its
 * source `renderStatus: "error"` (the same marker the UI uses to disable
 * Make). Proxies like "has a text source" or "has no media sources" no longer
 * work — a PASSING geometry contract in debug mode returns the wireframe
 * VISUALISATION instead of the original doc (withGeometryContract, 2026-08-20),
 * and that wireframe has text banners and no media.
 */
function isErrorMosaic(doc: { sources?: unknown[] }): boolean {
  return (doc.sources ?? []).some(
    (s) => (s as { engine?: { renderStatus?: string } }).engine?.renderStatus === "error",
  );
}

describe("ScreencapGridV2 — geometry contract (pixel-exactness proof)", () => {
  const contractStamp = (file: MosaicRenderableFile): MosaicGeometryContractStamp | undefined =>
    isDocument(file)
      ? (file.editor as { geometryContract?: MosaicGeometryContractStamp } | undefined)?.geometryContract
      : undefined;

  it("every tile's computed rect survives to the pixels — awkward canvases included", async () => {
    for (const [width, height] of [
      [1920, 1080],
      [1928, 2720], // the founder's bbb variant canvas
      [1000, 700],
      [1013, 709], // hostile-ish (prime) dims — degrades to exact, still passes
    ] as const) {
      const ctx = makeCtx({ width, height });
      ctx.media["/tmp/clip.mp4" as keyof typeof ctx.media] = VIDEO_META;
      const file = await renderScreencapGridV2(
        { sourceIds: ["/tmp/clip.mp4"], rows: 4, cols: 4, tiles: { gapPx: 2 }, debugGeometry: true },
        ctx,
      );
      const stamp = contractStamp(file);
      expect(stamp).toBeDefined();
      expect(stamp!.ok).toBe(true);
      expect(stamp!.violations).toEqual([]);
      // The doc survived — not a GEOMETRY_CONTRACT error mosaic. A PASSING
      // contract in debug mode returns the wireframe VISUALISATION rather than
      // the original doc, so its media sources are deliberately absent here;
      // the non-debug tests above own the tile-count coverage.
      if (!isDocument(file)) throw new Error("expected document");
      expect(isErrorMosaic(file)).toBe(false);
    }
  });
});

describe("ScreencapGridV2 — multi-input dispatch", () => {
  jest.setTimeout(30_000);

  it("single-entry sourceIds returns a MosaicDocument (not a pipeline)", async () => {
    const file = await ScreencapGridV2.render(
      { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: false } },
      makeCtx(),
    );
    expect(isDocument(file)).toBe(true);
  });

  it("missing inputs returns a fail-fast error mosaic (still a document)", async () => {
    const file = await ScreencapGridV2.render({ infoPane: { show: false } }, makeCtx());
    expect(isDocument(file)).toBe(true);
  });

  it("multi-input returns an emit:multi pipeline with one step per file", async () => {
    const file = await ScreencapGridV2.render(
      {
        sourceIds: ["/tmp/a.mp4", "/tmp/b.mp4", "/tmp/c.mp4"],
        infoPane: { show: false },
        outputFormat: "mp4",
      },
      makeCtx(),
    );
    expect(isPipeline(file)).toBe(true);
    if (!isPipeline(file)) return;
    expect(file.emit).toBe("multi");
    expect(file.steps.length).toBe(3);
    expect(file.steps.map((s) => s.name)).toEqual(["a", "b", "c"]);
    expect(file.steps.map((s) => s.label)).toEqual(["a", "b", "c"]);
  });

  it("animated step durations come from ctx.target.durationMs; static are nominal", async () => {
    const ctx = makeCtx({ durationMs: 1234 });
    const animated = await ScreencapGridV2.render(
      { sourceIds: ["/tmp/a.mp4", "/tmp/b.mp4"], infoPane: { show: false }, outputFormat: "mp4" },
      ctx,
    );
    if (!isPipeline(animated)) throw new Error("expected pipeline");
    for (const step of animated.steps) expect(step.durationMs).toBe(1234);

    const still = await ScreencapGridV2.render(
      { sourceIds: ["/tmp/a.mp4", "/tmp/b.mp4"], infoPane: { show: false } },
      ctx,
    );
    if (!isPipeline(still)) throw new Error("expected pipeline");
    for (const step of still.steps) expect(step.durationMs).toBe(40);
  });

  it("dedupes step names when two inputs share a basename", async () => {
    const file = await ScreencapGridV2.render(
      {
        sourceIds: ["/folderA/clip.mp4", "/folderB/clip.mp4", "/folderC/clip.mp4"],
        infoPane: { show: false },
        outputFormat: "mp4",
      },
      makeCtx(),
    );
    if (!isPipeline(file)) throw new Error("expected pipeline");
    const names = file.steps.map((s) => s.name);
    expect(names).toEqual(["clip", "clip_2", "clip_3"]);
  });
});

describe("ScreencapGridV2 — custom grid (m0 escape hatch)", () => {
  const CUSTOM =
    "2(5[3(F,F,F),3(F,F,F),>,3(2[F,F],>,F),3(F,F,F)],5[3(F,F,F),>,3(>,F,2[F,F]),3(F,F,F),3(F,F,F)])";

  it("binds one media tile per rendered cell, overriding rows/cols", async () => {
    const file = await ScreencapGridV2.render(
      { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: false }, timestamps: { show: false }, rows: 4, cols: 4, advanced: { customGrid: CUSTOM } },
      makeCtx(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    // 24 F cells in CUSTOM — NOT rows*cols (16).
    expect(file.sources.filter((s) => s.type === "media").length).toBe(24);
  });

  it("keeps the authored m0 verbatim inside the document (no laundering)", async () => {
    const file = await ScreencapGridV2.render(
      { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: false }, timestamps: { show: false }, advanced: { customGrid: "3(F,F,F)" }, tiles: { gapPx: 0 } },
      makeCtx(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    expect(String(file.m0)).toContain("3(");
  });

  it("timestamp chips carry the same gap inset as their media tile", async () => {
    const file = await ScreencapGridV2.render(
      { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: false }, timestamps: { show: true }, advanced: { customGrid: "2[F,F]" }, tiles: { gapPx: 4 } },
      makeCtx(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    const media = file.sources.filter((s) => s.type === "media") as Array<
      MosaicSource & { placement?: { inset?: unknown } }
    >;
    const texts = file.sources.filter((s) => s.type === "text") as Array<
      MosaicSource & { placement?: { inset?: unknown } }
    >;
    expect(media.length).toBe(2);
    expect(texts.length).toBe(2);
    for (let i = 0; i < media.length; i++) {
      expect(texts[i].placement?.inset).toEqual(media[i].placement?.inset);
      expect(media[i].placement?.inset).toBeDefined();
    }
  });

  it("strips '#' header lines from a pasted .m0 file", async () => {
    const withHeaders = "# m0\n# version: 1\n# size: 1920x1080\n3(F,F,F)";
    const file = await ScreencapGridV2.render(
      { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: false }, timestamps: { show: false }, advanced: { customGrid: withHeaders } },
      makeCtx(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    expect(file.sources.filter((s) => s.type === "media").length).toBe(3);
  });

  it("falls back to rows×cols when customGrid is empty", async () => {
    const file = await ScreencapGridV2.render(
      { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: false }, timestamps: { show: false }, rows: 2, cols: 3, advanced: { customGrid: "   " } },
      makeCtx(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    expect(file.sources.filter((s) => s.type === "media").length).toBe(6);
  });

  it("returns an error mosaic for an invalid customGrid m0", async () => {
    const file = await ScreencapGridV2.render(
      { sourceIds: ["/tmp/clip.mp4"], advanced: { customGrid: "2(F,F" } },
      makeCtx(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    expect(file.sources.filter((s) => s.type === "media").length).toBe(0);
  });
});

describe("gate-24: animated deliverable strips its audio track", () => {
  const wire = (): MosaicEngineContext => {
    const ctx = makeCtx();
    ctx.media["/tmp/clip.mp4" as keyof typeof ctx.media] = VIDEO_META;
    return ctx;
  };

  it("animated doc carries doc-level audio.enabled:false (-an)", async () => {
    const file = await renderScreencapGridV2(
      { sourceIds: ["/tmp/clip.mp4"], outputFormat: "mp4" },
      wire(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    expect((file as { audio?: { mode?: string } }).audio).toEqual({ mode: "off" });
  });

  it("static sheet doc does NOT set doc-level audio", async () => {
    const file = await renderScreencapGridV2(
      { sourceIds: ["/tmp/clip.mp4"] },
      wire(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    expect((file as { audio?: unknown }).audio).toBeUndefined();
  });

  it("custom-grid animated doc also strips (both return sites)", async () => {
    const file = await renderScreencapGridV2(
      {
        sourceIds: ["/tmp/clip.mp4"],
        outputFormat: "mp4",
        advanced: { customGrid: "2(F,F)" },
      },
      wire(),
    );
    if (!isDocument(file)) throw new Error("expected document");
    expect((file as { audio?: { mode?: string } }).audio).toEqual({ mode: "off" });
  });
});

describe("gate-24: info-pane text fit (title middle-ellipsis, meta end-ellipsis)", () => {
  it("short titles pass through untouched", () => {
    expect(ellipsizeMiddleEm("reel-10s.mp4", 40)).toBe("reel-10s.mp4");
  });

  it("long titles keep their tail (extension) and fit the budget", () => {
    const long = "a".repeat(200) + "-final.mp4";
    const out = ellipsizeMiddleEm(long, 60);
    expect(out).toContain("…");
    expect(out.endsWith("l.mp4")).toBe(true);
    expect(textEmUnits(out)).toBeLessThanOrEqual(60.5);
  });

  it("render ellipsizes an overflowing filename into the pane title", async () => {
    const ctx = makeCtx({ width: 640, height: 360 });
    const longPath = "/tmp/" + "very-long-segment-".repeat(20) + "cut.mp4";
    ctx.media[longPath as keyof typeof ctx.media] = {
      ...VIDEO_META,
      originalFileName: path.basename(longPath),
    };
    const file = await renderScreencapGridV2({ sourceIds: [longPath] }, ctx);
    if (!isDocument(file)) throw new Error("expected document");
    const pane = file.children?.["info-pane"] as MosaicDocument;
    const text = pane.sources?.[0] as { layers?: { content?: { text?: string } }[] };
    const title = text.layers?.[0]?.content?.text ?? "";
    expect(title).toContain("…");
    expect(title.endsWith("cut.mp4")).toBe(true);
    expect(textEmUnits(title)).toBeLessThanOrEqual(
      paneLineEmBudget(640, 16) + 0.5,
    );
  });

  it("pane title falls back to the BASENAME when originalFileName is absent (never a path)", async () => {
    const ctx = makeCtx();
    const p = "/very/deep/fixture/dir/some-clip.mp4";
    const { originalFileName: _drop, ...thinMeta } = VIDEO_META as MosaicMediaMetadata & {
      originalFileName?: string;
    };
    ctx.media[p as keyof typeof ctx.media] = thinMeta as MosaicMediaMetadata;
    const file = await renderScreencapGridV2({ sourceIds: [p] }, ctx);
    if (!isDocument(file)) throw new Error("expected document");
    const pane = file.children?.["info-pane"] as MosaicDocument;
    const text = pane.sources?.[0] as { layers?: { content?: { text?: string } }[] };
    expect(text.layers?.[0]?.content?.text).toBe("some-clip.mp4");
  });

  it("dense metadata lines end-ellipsize at narrow canvases", async () => {
    const ctx = makeCtx({ width: 480, height: 854 });
    ctx.media["/tmp/clip.mp4" as keyof typeof ctx.media] = VIDEO_META;
    const file = await renderScreencapGridV2(
      { sourceIds: ["/tmp/clip.mp4"], rows: 2, cols: 2 },
      ctx,
    );
    if (!isDocument(file)) throw new Error("expected document");
    const pane = file.children?.["info-pane"] as MosaicDocument;
    const text = pane.sources?.[0] as { layers?: { content?: { text?: string } }[] };
    const metaText = text.layers?.[1]?.content?.text ?? "";
    const budget = paneLineEmBudget(480, infoPaneMetaFontSize(854));
    for (const line of metaText.split("\n")) {
      expect(textEmUnits(line)).toBeLessThanOrEqual(budget + 0.5);
    }
  });
});
