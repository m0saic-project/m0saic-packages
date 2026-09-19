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
} from "@m0saic/types";

import { makeM0saicTempPrefix } from "@m0saic/platform/paths";
import { parseM0StringToRenderFrames } from "@m0saic/dsl";
import {
  ScreencapGridAspectSafe,
  enumerateAspectSafePairs,
  targetShapeDistance,
} from "./screencap-grid-aspect-safe";

function makeCtx(
  overrides?: Partial<MosaicEngineContext["target"]>,
): MosaicEngineContext {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), makeM0saicTempPrefix("aspect-safe-test")));
  return {
    mode: "render" as const,
    target: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 5000,
      ...overrides,
    },
    output: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 5000,
      workspaceDir: ws,
      ...overrides,
    },
    media: {},
  };
}

function isPipeline(f: MosaicRenderableFile): f is MosaicDocumentPipeline {
  return f.kind === "mosaic_pipeline";
}

function isDocument(f: MosaicRenderableFile): f is MosaicDocument {
  return f.kind === "mosaic_document";
}

function stepDoc(step: MosaicDocumentPipeline["steps"][number]): MosaicDocument {
  const doc = step.file;
  if (!doc || doc.kind !== "mosaic_document") throw new Error("expected step document");
  return doc;
}

const VIDEO_META: MosaicMediaMetadata = {
  kind: "video",
  width: 1920,
  height: 1080,
  hasVideo: true,
  hasAudio: false,
  durationMs: 60000,
  fps: 24,
  originalFileName: "sample.mp4",
};

describe("ScreencapGridAspectSafe — template metadata", () => {
  it("registers the single collapsed template with the expected id", () => {
    expect(ScreencapGridAspectSafe.id).toBe(
      "@m0saic/media/screencap_grid_aspect_safe/v1",
    );
  });

  it("declares outputHints.format image/png (the frozen 0.2.0 declaration; the outputFormat knob still bakes the per-step container)", () => {
    expect(ScreencapGridAspectSafe.outputHints?.format).toEqual({ kind: "image", container: "png" });
  });

  it("defaults to png output with the shared knob surface", () => {
    expect(ScreencapGridAspectSafe.defaultProps).toMatchObject({
      outputFormat: "png",
      cellShape: "landscape",
      gridChoice: 0,
      infoPane: { show: true, align: "left" },
      timestamps: { show: true, corner: "br" },
      tiles: { gapPx: 2, fit: "cover" },
    });
  });
});

describe("ScreencapGridAspectSafe — outputFormat knob (per-step format)", () => {
  it("default (png) bakes an image/png format on every step document", async () => {
    const file = await ScreencapGridAspectSafe.render(
      { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: false } },
      makeCtx(),
    );
    if (!isPipeline(file)) throw new Error("expected pipeline");
    for (const step of file.steps) {
      expect(stepDoc(step).format).toEqual({ kind: "image", container: "png" });
    }
  });

  it('outputFormat:"mp4" bakes a video/mp4 format on every step document', async () => {
    const file = await ScreencapGridAspectSafe.render(
      { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: false }, outputFormat: "mp4" },
      makeCtx(),
    );
    if (!isPipeline(file)) throw new Error("expected pipeline");
    for (const step of file.steps) {
      expect(stepDoc(step).format).toEqual({ kind: "video", container: "mp4" });
    }
  });
});

describe("ScreencapGridAspectSafe — info pane placement (top-anchored cover crop)", () => {
  it("both modes ref the pane with fit:cover focusY:0 in every orientation step", async () => {
    for (const outputFormat of ["png", "mp4"] as const) {
      const file = await ScreencapGridAspectSafe.render(
        { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: true }, outputFormat },
        makeCtx(),
      );
      if (!isPipeline(file)) throw new Error("expected pipeline");
      expect(file.steps.length).toBe(2); // landscape + portrait
      for (const step of file.steps) {
        const doc = stepDoc(step);
        const pane = doc.sources.find((s) => s.type === "mosaic") as
          | { ref?: string; placement?: { fit?: string; focusY?: number } }
          | undefined;
        expect(pane?.ref).toBe("info-pane");
        // The pane child rasterizes at the full step canvas height with its
        // text in the top strip. The default contain fit would scale the
        // whole full-height frame into the ~paneHeightPx cell (≈2px text);
        // the top-anchored cover crop shows the top strip at full size.
        // (The placement may ALSO carry a placeInsetPieces recovery inset
        // when the pane band is off-lattice — assert fields, not the shape.)
        expect(pane?.placement?.fit).toBe("cover");
        expect(pane?.placement?.focusY).toBe(0);
      }
    }
  });
});

describe("ScreencapGridAspectSafe — tile fit", () => {
  jest.setTimeout(30_000);

  const mediaFitsInStep = (step: MosaicDocumentPipeline["steps"][number]): string[] =>
    stepDoc(step)
      .sources.filter((s) => s.type === "media")
      .map((s) => (s as { placement?: { fit?: string } }).placement?.fit as string);

  it("defaults to cover on every tile in every orientation step", async () => {
    const file = await ScreencapGridAspectSafe.render(
      { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: false }, timestamps: { show: false }, outputFormat: "mp4" },
      makeCtx(),
    );
    if (!isPipeline(file)) throw new Error("expected pipeline");
    for (const step of file.steps) {
      const fits = mediaFitsInStep(step);
      expect(fits.length).toBeGreaterThan(0);
      expect(fits.every((f) => f === "cover")).toBe(true);
    }
  });

  it("tileFit:contain emits contain on every tile in both modes", async () => {
    for (const outputFormat of ["png", "mp4"] as const) {
      const file = await ScreencapGridAspectSafe.render(
        { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: false }, timestamps: { show: false }, tiles: { fit: "contain" }, outputFormat },
        makeCtx(),
      );
      if (!isPipeline(file)) throw new Error("expected pipeline");
      for (const step of file.steps) {
        const fits = mediaFitsInStep(step);
        expect(fits.length).toBeGreaterThan(0);
        expect(fits.every((f) => f === "contain")).toBe(true);
      }
    }
  });

  it("leaves the info-pane ref at cover regardless of tileFit", async () => {
    const file = await ScreencapGridAspectSafe.render(
      { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: true }, timestamps: { show: false }, tiles: { fit: "contain" }, outputFormat: "mp4" },
      makeCtx(),
    );
    if (!isPipeline(file)) throw new Error("expected pipeline");
    for (const step of file.steps) {
      const pane = stepDoc(step).sources.find((s) => s.type === "mosaic") as
        | { placement?: { fit?: string } }
        | undefined;
      expect(pane?.placement?.fit).toBe("cover");
    }
  });
});

describe("enumerateAspectSafePairs", () => {
  // Standard desktop + mobile canvases, default cell-count window.
  const cfg = {
    countMin: 4,
    countMax: 16,
    landscapeW: 1920,
    landscapeH: 1080,
    portraitW: 1080,
    portraitH: 1920,
  };

  it("returns at least one candidate for default canvases", () => {
    const pairs = enumerateAspectSafePairs(cfg);
    expect(pairs.length).toBeGreaterThan(0);
  });

  it("sorts candidates by cellAspectLogDelta ascending (best AR match first)", () => {
    const pairs = enumerateAspectSafePairs(cfg);
    for (let i = 1; i < pairs.length; i++) {
      const a = pairs[i - 1].cellAspectLogDelta;
      const b = pairs[i].cellAspectLogDelta;
      // Allow equality (ties get broken by cellCount, but both come
      // back in the same order — the assertion is `a <= b`, not strict).
      expect(a).toBeLessThanOrEqual(b + 1e-9);
    }
  });

  it("each candidate carries matching cellCount across orientations", () => {
    const pairs = enumerateAspectSafePairs(cfg);
    for (const p of pairs) {
      const lCount = p.landscape.rows * p.landscape.cols;
      const pCount = p.portrait.rows * p.portrait.cols;
      expect(lCount).toBe(pCount);
      expect(p.cellCount).toBe(lCount);
    }
  });
});

describe("enumerateAspectSafePairs — targetCellAspect (shape-first ranking)", () => {
  const base = {
    countMin: 4,
    countMax: 32,
    landscapeW: 1920,
    landscapeH: 1080,
    portraitW: 1080,
    portraitH: 1920,
  };

  it("a landscape target (16:9) yields wide cells in BOTH orientations", () => {
    const pairs = enumerateAspectSafePairs({ ...base, targetCellAspect: 16 / 9 });
    expect(pairs.length).toBeGreaterThan(0);
    const top = pairs[0];
    expect(top.landscape.cellAspectRatio).toBeGreaterThan(1);
    expect(top.portrait.cellAspectRatio).toBeGreaterThan(1);
  });

  it("a portrait target (9:16) yields tall cells in BOTH orientations — many cols on desktop, many rows on mobile", () => {
    const pairs = enumerateAspectSafePairs({ ...base, targetCellAspect: 9 / 16 });
    expect(pairs.length).toBeGreaterThan(0);
    const top = pairs[0];
    expect(top.landscape.cellAspectRatio).toBeLessThan(1);
    expect(top.portrait.cellAspectRatio).toBeLessThan(1);
    // The width-rich canvas realizes tall cells by splitting into more
    // columns than rows. The portrait canvas's OWN aspect already equals
    // the 9:16 target, so an equal rows==cols split realizes it exactly —
    // hence >= (never more cols than rows, but equal is optimal here).
    expect(top.landscape.cols).toBeGreaterThan(top.landscape.rows);
    expect(top.portrait.rows).toBeGreaterThanOrEqual(top.portrait.cols);
  });

  it("the top-ranked pair minimizes the summed log-distance to the target", () => {
    for (const target of [16 / 9, 1, 9 / 16]) {
      const pairs = enumerateAspectSafePairs({ ...base, targetCellAspect: target });
      expect(pairs.length).toBeGreaterThan(0);
      const best = Math.min(...pairs.map((p) => targetShapeDistance(p, target)));
      expect(targetShapeDistance(pairs[0], target)).toBeCloseTo(best, 9);
    }
  });

  it("targets steer the ranking apart: 16:9 and 9:16 pick different top shapes", () => {
    const wide = enumerateAspectSafePairs({ ...base, targetCellAspect: 16 / 9 })[0];
    const tall = enumerateAspectSafePairs({ ...base, targetCellAspect: 9 / 16 })[0];
    expect(wide.landscape.cellAspectRatio).toBeGreaterThan(tall.landscape.cellAspectRatio);
    expect(wide.portrait.cellAspectRatio).toBeGreaterThan(tall.portrait.cellAspectRatio);
  });

  it("unset target keeps the legacy cross-match-first ranking", () => {
    const pairs = enumerateAspectSafePairs(base);
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i - 1].cellAspectLogDelta).toBeLessThanOrEqual(
        pairs[i].cellAspectLogDelta + 1e-9,
      );
    }
  });
});

describe("ScreencapGridAspectSafe — geometry contract (pixel-exactness proof)", () => {
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

  const contractStamp = (doc: MosaicDocument): MosaicGeometryContractStamp | undefined =>
    (doc.editor as { geometryContract?: MosaicGeometryContractStamp } | undefined)?.geometryContract;

  it("every tile's computed rect survives to the pixels in BOTH orientations", async () => {
    const ctx = makeCtx();
    ctx.media["/tmp/clip.mp4" as keyof typeof ctx.media] = VIDEO_META;
    const file = await ScreencapGridAspectSafe.render(
      { sourceIds: ["/tmp/clip.mp4"], tiles: { gapPx: 2 }, debugGeometry: true },
      ctx,
    );
    if (!isPipeline(file)) throw new Error("expected pipeline");
    expect(file.steps.length).toBe(2);
    for (const step of file.steps) {
      const doc = stepDoc(step);
      const stamp = contractStamp(doc);
      expect(stamp).toBeDefined();
      expect(stamp!.ok).toBe(true);
      expect(stamp!.violations).toEqual([]);
      // The check ran at the step's OWN orientation canvas, not ctx.target.
      expect(stamp!.canvas).toEqual({
        w: doc.size!.width,
        h: doc.size!.height,
      });
      // The doc survived — not a GEOMETRY_CONTRACT error mosaic. Debug mode
      // returns the wireframe VISUALISATION on a PASS, so media sources are
      // deliberately absent; non-debug tests own the tile-count coverage.
      expect(isErrorMosaic(doc)).toBe(false);
    }
  });
});

describe("ScreencapGridAspectSafe — render dispatch", () => {
  jest.setTimeout(30_000);

  it("missing inputs returns a fail-fast error mosaic", async () => {
    const file = await ScreencapGridAspectSafe.render(
      { infoPane: { show: false } },
      makeCtx(),
    );
    expect(isDocument(file)).toBe(true);
  });

  it("single input returns a pipeline with 2 steps (landscape + portrait)", async () => {
    const file = await ScreencapGridAspectSafe.render(
      { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: false }, outputFormat: "mp4" },
      makeCtx(),
    );
    expect(isPipeline(file)).toBe(true);
    if (!isPipeline(file)) return;
    expect(file.emit).toBe("multi");
    expect(file.steps.length).toBe(2);
    expect(file.steps[0].name).toMatch(/__landscape$/);
    expect(file.steps[1].name).toMatch(/__portrait$/);
  });

  it("each step.file carries its own canvas size", async () => {
    const file = await ScreencapGridAspectSafe.render(
      {
        sourceIds: ["/tmp/clip.mp4"],
        infoPane: { show: false },
        canvas: { landscapeW: 1920, landscapeH: 1080, portraitW: 1080, portraitH: 1920 },
      },
      makeCtx(),
    );
    if (!isPipeline(file)) throw new Error("expected pipeline");
    expect(stepDoc(file.steps[0]).size).toEqual({ width: 1920, height: 1080 });
    expect(stepDoc(file.steps[1]).size).toEqual({ width: 1080, height: 1920 });
  });

  it("multi-input doubles the step count (2N steps for N inputs)", async () => {
    const file = await ScreencapGridAspectSafe.render(
      {
        sourceIds: ["/tmp/a.mp4", "/tmp/b.mp4", "/tmp/c.mp4"],
        infoPane: { show: false },
        outputFormat: "mp4",
      },
      makeCtx(),
    );
    if (!isPipeline(file)) throw new Error("expected pipeline");
    expect(file.steps.length).toBe(6);
    // Names interleave per-file landscape + portrait
    const names = file.steps.map((s) => s.name ?? "");
    expect(names).toEqual([
      "a__landscape",
      "a__portrait",
      "b__landscape",
      "b__portrait",
      "c__landscape",
      "c__portrait",
    ]);
  });

  it("dedupes step names when two inputs share a basename", async () => {
    const file = await ScreencapGridAspectSafe.render(
      {
        sourceIds: ["/folderA/clip.mp4", "/folderB/clip.mp4"],
        infoPane: { show: false },
      },
      makeCtx(),
    );
    if (!isPipeline(file)) throw new Error("expected pipeline");
    const names = file.steps.map((s) => s.name ?? "");
    expect(new Set(names).size).toBe(names.length); // all unique
  });

  const DEFAULT_SWEEP = {
    countMin: 4,
    countMax: 32,
    landscapeW: 1920,
    landscapeH: 1080,
    portraitW: 1080,
    portraitH: 1920,
  };
  const mediaCount = (step: MosaicDocumentPipeline["steps"][number]): number =>
    stepDoc(step).sources.filter((s) => s.type === "media").length;
  // Recover the rendered grid's column count from the step's m0: with pane
  // + timestamps off, every frame is a tile cell, and tiles in the same
  // column share the same quantized x — so distinct x-starts == cols.
  // (Counts alone can't discriminate steering: the 16:9 and 9:16 top picks
  // both land at the same cell count on the default canvases.)
  const gridCols = (step: MosaicDocumentPipeline["steps"][number]): number => {
    const doc = stepDoc(step);
    const frames = parseM0StringToRenderFrames(doc.m0, doc.size!.width, doc.size!.height);
    return new Set(frames.map((f) => f.x)).size;
  };

  it("DEFAULT render steers to landscape (16:9) cells — the cellShape default", async () => {
    const expected = enumerateAspectSafePairs({
      ...DEFAULT_SWEEP,
      targetCellAspect: 16 / 9,
    })[0];
    const file = await ScreencapGridAspectSafe.render(
      { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: false }, timestamps: { show: false } },
      makeCtx(),
    );
    if (!isPipeline(file)) throw new Error("expected pipeline");
    expect(mediaCount(file.steps[0])).toBe(expected.cellCount);
    expect(mediaCount(file.steps[1])).toBe(expected.cellCount);
    expect(gridCols(file.steps[0])).toBe(expected.landscape.cols);
    expect(gridCols(file.steps[1])).toBe(expected.portrait.cols);
  });

  it('cellShape "portrait" plumbs through render — step grids match the 9:16 top pick', async () => {
    const expected = enumerateAspectSafePairs({
      ...DEFAULT_SWEEP,
      targetCellAspect: 9 / 16,
    })[0];
    const file = await ScreencapGridAspectSafe.render(
      { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: false }, timestamps: { show: false }, cellShape: "portrait" },
      makeCtx(),
    );
    if (!isPipeline(file)) throw new Error("expected pipeline");
    expect(mediaCount(file.steps[0])).toBe(expected.cellCount);
    expect(gridCols(file.steps[0])).toBe(expected.landscape.cols);
    expect(gridCols(file.steps[1])).toBe(expected.portrait.cols);
  });

  it("the numeric escape hatch OVERRIDES cellShape", async () => {
    const portraitPick = enumerateAspectSafePairs({
      ...DEFAULT_SWEEP,
      targetCellAspect: 9 / 16,
    })[0];
    const landscapePick = enumerateAspectSafePairs({
      ...DEFAULT_SWEEP,
      targetCellAspect: 16 / 9,
    })[0];
    // The two picks must differ structurally for this test to discriminate.
    expect(portraitPick.landscape.cols).not.toBe(landscapePick.landscape.cols);
    // cellShape says landscape; the exact ratio says portrait — ratio wins.
    const file = await ScreencapGridAspectSafe.render(
      {
        sourceIds: ["/tmp/clip.mp4"],
        infoPane: { show: false },
        timestamps: { show: false },
        cellShape: "landscape",
        search: { cellAspect: 9 / 16 },
      },
      makeCtx(),
    );
    if (!isPipeline(file)) throw new Error("expected pipeline");
    expect(gridCols(file.steps[0])).toBe(portraitPick.landscape.cols);
    expect(gridCols(file.steps[1])).toBe(portraitPick.portrait.cols);
  });

  it("gridChoice index is clamped to the candidate list bounds", async () => {
    // gridChoice 9999 should not crash — falls back to the last
    // available candidate.
    const file = await ScreencapGridAspectSafe.render(
      {
        sourceIds: ["/tmp/clip.mp4"],
        infoPane: { show: false },
        gridChoice: 9999,
      },
      makeCtx(),
    );
    expect(isPipeline(file)).toBe(true);
  });

  it("animated step durations come from ctx.target.durationMs; static are nominal 40ms", async () => {
    const ctx = makeCtx({ durationMs: 1234 });
    const animated = await ScreencapGridAspectSafe.render(
      { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: false }, outputFormat: "mp4" },
      ctx,
    );
    if (!isPipeline(animated)) throw new Error("expected pipeline");
    for (const step of animated.steps) expect(step.durationMs).toBe(1234);

    const still = await ScreencapGridAspectSafe.render(
      { sourceIds: ["/tmp/clip.mp4"], infoPane: { show: false } },
      ctx,
    );
    if (!isPipeline(still)) throw new Error("expected pipeline");
    for (const step of still.steps) expect(step.durationMs).toBe(40);
  });

  it("LEGACY flat props (pre-collapse saved docs) still resolve", async () => {
    // Docs saved against the old _png/_mp4 twins carry flat names — the
    // resolver bridges them (grouped values win when both are present).
    const legacy = {
      sourceIds: ["/tmp/clip.mp4"],
      withInfoPane: false,
      withTileTimestamp: false,
      targetCellAspect: 9 / 16,
      landscapeW: 1920,
      landscapeH: 1080,
      portraitW: 1080,
      portraitH: 1920,
    } as unknown as Parameters<typeof ScreencapGridAspectSafe.render>[0];
    const expected = enumerateAspectSafePairs({
      ...DEFAULT_SWEEP,
      targetCellAspect: 9 / 16,
    })[0];
    const file = await ScreencapGridAspectSafe.render(legacy, makeCtx());
    if (!isPipeline(file)) throw new Error("expected pipeline");
    // Flat toggles honored (no pane) AND the flat exact-aspect steered the pair.
    expect(stepDoc(file.steps[0]).sources.filter((s) => s.type === "mosaic").length).toBe(0);
    expect(gridCols(file.steps[0])).toBe(expected.landscape.cols);
  });

  it("impossible cell-count range returns an error mosaic", async () => {
    const file = await ScreencapGridAspectSafe.render(
      {
        sourceIds: ["/tmp/clip.mp4"],
        infoPane: { show: false },
        search: { minCells: 9999, maxCells: 9999 },
      },
      makeCtx(),
    );
    expect(isDocument(file)).toBe(true);
  });
});

describe("gate-25: animated steps strip audio; pane text fits (the v2 family fixes)", () => {
  const REEL = "/tmp/aspect-clip.mp4";
  const wire = (meta: MosaicMediaMetadata = VIDEO_META): MosaicEngineContext => {
    const ctx = makeCtx();
    ctx.media[REEL as keyof typeof ctx.media] = meta;
    return ctx;
  };

  it("animated orientation docs carry doc-level audio.enabled:false (-an)", async () => {
    const file = await ScreencapGridAspectSafe.render(
      { sourceIds: [REEL], outputFormat: "mp4" },
      wire(),
    );
    if (!isPipeline(file)) throw new Error("expected pipeline");
    expect(file.steps).toHaveLength(2);
    for (const step of file.steps) {
      const doc = stepDoc(step) as MosaicDocument & { audio?: { mode?: string } };
      expect(doc.audio).toEqual({ mode: "off" });
    }
  });

  it("static sheets do NOT set doc-level audio", async () => {
    const file = await ScreencapGridAspectSafe.render(
      { sourceIds: [REEL] },
      wire(),
    );
    if (!isPipeline(file)) throw new Error("expected pipeline");
    for (const step of file.steps) {
      expect((stepDoc(step) as { audio?: unknown }).audio).toBeUndefined();
    }
  });

  it("pane title basename-ifies a path fallback and ellipsizes per orientation", async () => {
    const longPath = "/deep/dir/" + "segment-".repeat(30) + "final.mp4";
    const ctx = makeCtx();
    const { originalFileName: _drop, ...thin } = VIDEO_META as MosaicMediaMetadata & {
      originalFileName?: string;
    };
    ctx.media[longPath as keyof typeof ctx.media] = thin as MosaicMediaMetadata;
    const file = await ScreencapGridAspectSafe.render({ sourceIds: [longPath] }, ctx);
    if (!isPipeline(file)) throw new Error("expected pipeline");
    for (const step of file.steps) {
      const doc = stepDoc(step);
      const pane = doc.children?.["info-pane"] as MosaicDocument;
      const text = pane.sources?.[0] as { layers?: { content?: { text?: string } }[] };
      const title = text.layers?.[0]?.content?.text ?? "";
      expect(title).not.toContain("/");
      expect(title).toContain("…");
      expect(title.endsWith("final.mp4")).toBe(true);
    }
  });
});

describe("gate-25: onboarding surfaces (cover + tutorial)", () => {
  const textOf = (doc: MosaicDocument): string =>
    (doc.sources ?? [])
      .filter((src) => (src as { type?: string }).type === "text")
      .flatMap((src) =>
        ((src as { layers?: { content?: { text?: string } }[] }).layers ?? []).map(
          (l) => l.content?.text ?? "",
        ),
      )
      .join(" ")
      .replace(/\s+/g, " ");

  it("cover renders the pair-preview hero + start tip", async () => {
    const doc = await ScreencapGridAspectSafe.renderCover!({}, makeCtx());
    if (doc.kind !== "mosaic_document") throw new Error("expected document");
    const frames = parseM0StringToRenderFrames(doc.m0, 1920, 1080);
    expect(frames.length).toBeGreaterThan(10);
    const hero = (doc.sources ?? []).find(
      (src) => src.editor?.label === "Aspect Safe registered pair preview",
    );
    expect(hero).toBeDefined();
    expect(doc.assets["aspect-safe-cover-pair" as keyof typeof doc.assets]).toBeDefined();
    const text = textOf(doc);
    expect(text).toContain("START HERE");
    expect(text).toContain("Both orientations");
  });

  it("tutorial is seven pages of real material telling the pair story", async () => {
    const pipeline = await ScreencapGridAspectSafe.renderTutorial!({}, makeCtx());
    if (pipeline.kind !== "mosaic_pipeline") throw new Error("expected pipeline");
    expect(pipeline.steps.map((s) => s.name)).toEqual([
      "idea", "sources", "shape", "choice", "search", "output", "start",
    ]);
    let sawSourceRect = 0;
    let allText = "";
    for (const step of pipeline.steps) {
      const doc = stepDoc(step);
      // Every page carries the shared sheet asset (real footage windows).
      expect(doc.assets["screencap-tutorial-sheet" as keyof typeof doc.assets]).toBeDefined();
      allText += textOf(doc);
      for (const src of doc.sources ?? []) {
        const rect = (src as { placement?: { sourceRect?: object } }).placement?.sourceRect;
        if (rect) sawSourceRect++;
      }
    }
    expect(sawSourceRect).toBeGreaterThan(40);
    const haystack = allText.toLowerCase();
    for (const concept of [
      "coordinated pair", "source(s)", "__landscape", "cell shape",
      "grid choice", "min and max cells", "png", "mp4",
    ]) {
      expect(haystack).toContain(concept);
    }
  });
});
