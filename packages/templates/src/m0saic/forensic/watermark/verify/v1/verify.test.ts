import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it, beforeEach, afterAll } from "@jest/globals";
import { validateM0String } from "@m0saic/dsl";
import { asAssetId, asTemplateId } from "@m0saic/types";
import type { MosaicDocument, MosaicEngineContext } from "@m0saic/types";

import { ForensicWatermarkVerifyV1, parseContentRect } from "./verify";

const COLS = 16;
const ROWS = 9;
const CELLS = COLS * ROWS;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "wm-verify-tpl-"));

/** The engine's `ctx.analysis.cellLuminance` pass, faked: one frame of
 *  deterministic pseudo-content. */
const cellLuminance = jest.fn();

function makeCtx(
  over: Partial<{ width: number; height: number; analysis: boolean }> = {},
): MosaicEngineContext {
  return {
    target: { width: over.width ?? 1600, height: over.height ?? 1000, durationMs: 5000 },
    output: { width: over.width ?? 1600, height: over.height ?? 1000, fps: 30 },
    media: {},
    assets: {},
    mode: "render",
    ...(over.analysis === false ? {} : { analysis: { cellLuminance } }),
  } as unknown as MosaicEngineContext;
}

function writeSidecar(name: string): string {
  const p = path.join(TMP, name);
  fs.writeFileSync(
    p,
    JSON.stringify({
      version: "watermark/v1",
      algorithm: "spatio-temporal-ab-bch",
      payload: { mode: "id32", bits: 32, valueHex: "deadbeef" },
      ecc: { type: "BCH", n: 127, k: 36, t: 15, generatorHex: "1ad8d3" },
      key: { type: "mulberry32", seedHex: "1234abcd" },
      grid: { cols: COLS, rows: ROWS, cellWidth: 8, cellHeight: 8 },
      slots: { count: 1, framesPerSlot: 30, startMs: 0, repetition: 1 },
      embed: { alphaBase: 0.012, alphaMin: 0.004, alphaMax: 0.025, luminanceAdaptive: false },
      hostReference: { type: "cell-luminance-grid", luminanceGrid: [] },
      render: { fps: 30, width: 16, height: 16, durationMs: 1000 },
    }),
    "utf8",
  );
  return p;
}

beforeEach(() => {
  cellLuminance.mockReset();
  cellLuminance.mockResolvedValue({
    luminanceGrid: Array.from({ length: CELLS }, (_, i) => (i * 37) % 256),
    frameCount: 1,
  });
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("ForensicWatermarkVerifyV1 — declaration", () => {
  it("registers under the family id", () => {
    expect(ForensicWatermarkVerifyV1.id).toBe(
      asTemplateId("@m0saic/forensic/watermark/verify/v1"),
    );
  });

  it("declares only the capabilities it actually uses", () => {
    // Read-only: it reads a sidecar and pulls one engine sampling pass.
    // Unlike the embed template it writes nothing, so no fs.write/temp.
    expect(ForensicWatermarkVerifyV1.capabilities).toEqual({
      tier: "capability",
      caps: { fs: { read: true }, exec: { spawn: true } },
    });
  });

  it("hints a still PNG — a verdict has no time dimension", () => {
    expect(ForensicWatermarkVerifyV1.outputHints?.format).toEqual({
      kind: "image",
      container: "png",
    });
  });

  it("declares the watermarkCheck sidecar as required", () => {
    expect(ForensicWatermarkVerifyV1.sidecarsSchema?.watermarkCheck?.required).toBe(true);
  });

  it("supplies renderLite so selecting it never samples a video", () => {
    expect(typeof ForensicWatermarkVerifyV1.renderLite).toBe("function");
  });
});

describe("ForensicWatermarkVerifyV1 — render", () => {
  it("renders an instructional card and no sidecar when videoPath is absent", async () => {
    const doc = (await ForensicWatermarkVerifyV1.render({}, makeCtx())) as MosaicDocument;
    expect(validateM0String(doc.m0 as unknown as string).ok).toBe(true);
    expect(doc.sidecars).toBeUndefined();
    expect(cellLuminance).not.toHaveBeenCalled();
  });

  it("emits the watermarkCheck sidecar on an error verdict", async () => {
    // No sidecar file on disk → the check cannot run, but the render must
    // still produce a card AND a machine-readable verdict.
    const doc = (await ForensicWatermarkVerifyV1.render(
      { videoPath: path.join(TMP, "ghost.mp4") },
      makeCtx(),
    )) as MosaicDocument;
    const check = (doc.sidecars as { watermarkCheck?: { verdict?: string; error?: { code?: string } } })
      ?.watermarkCheck;
    expect(check?.verdict).toBe("error");
    expect(check?.error?.code).toBe("SIDECAR_NOT_FOUND");
  });

  it("emits a valid document + sidecar when the sidecar resolves", async () => {
    const sc = writeSidecar("ok.watermark.json");
    const doc = (await ForensicWatermarkVerifyV1.render(
      { videoPath: "/v.mp4", sidecarPath: sc },
      makeCtx(),
    )) as MosaicDocument;

    expect(validateM0String(doc.m0 as unknown as string).ok).toBe(true);
    expect(doc.assets?.[asAssetId("verify_input")]).toEqual({
      kind: "file",
      path: "/v.mp4",
      mediaType: "video",
    });
    const check = (doc.sidecars as { watermarkCheck?: { expectedHex?: string } })?.watermarkCheck;
    expect(check?.expectedHex).toBe("deadbeef");
    expect(doc.backgroundColor).toBeTruthy();
  });

  it("samples the delivered file AS-IS through ctx.analysis.cellLuminance", async () => {
    const sc = writeSidecar("engine.watermark.json");
    await ForensicWatermarkVerifyV1.render({ videoPath: "/v.mp4", sidecarPath: sc }, makeCtx());
    // No cover-fit, no hold, no rate/duration pin — the embed side authored
    // its reference over the same cell-grid tail, so the grids subtract.
    expect(cellLuminance).toHaveBeenCalledTimes(1);
    expect(cellLuminance.mock.calls[0]).toEqual(["/v.mp4", { cols: COLS, rows: ROWS }]);
  });

  it("contentRect crops the sampling to the marked content (padded platform copies)", async () => {
    const sc = writeSidecar("crop.watermark.json");
    await ForensicWatermarkVerifyV1.render(
      { videoPath: "/reel.mp4", sidecarPath: sc, contentRect: "0,420,1080,608" },
      makeCtx(),
    );
    expect(cellLuminance.mock.calls[0]).toEqual([
      "/reel.mp4",
      { cols: COLS, rows: ROWS, crop: { x: 0, y: 420, width: 1080, height: 608 } },
    ]);
  });

  it("parseContentRect: blank → whole frame, malformed → null", () => {
    expect(parseContentRect(undefined)).toBeUndefined();
    expect(parseContentRect("  ")).toBeUndefined();
    expect(parseContentRect("0,420,1080,608")).toEqual({ x: 0, y: 420, width: 1080, height: 608 });
    expect(parseContentRect("0 420 1080 608")).toEqual({ x: 0, y: 420, width: 1080, height: 608 });
    expect(parseContentRect("1,2,3")).toBeNull();
    expect(parseContentRect("a,b,c,d")).toBeNull();
    expect(parseContentRect("0,0,1,1")).toBeNull();
  });

  it("reports ANALYSIS_UNAVAILABLE on the card when the host attached no analysis", async () => {
    // A packaged desktop without a toolchain, or internal tooling: the
    // template never guesses at an `ffmpeg` on PATH — it says what's missing.
    const sc = writeSidecar("no-analysis.watermark.json");
    const doc = (await ForensicWatermarkVerifyV1.render(
      { videoPath: "/v.mp4", sidecarPath: sc },
      makeCtx({ analysis: false }),
    )) as MosaicDocument;
    const check = (doc.sidecars as { watermarkCheck?: { verdict?: string; error?: { code?: string } } })
      ?.watermarkCheck;
    expect(check?.verdict).toBe("error");
    expect(check?.error?.code).toBe("ANALYSIS_UNAVAILABLE");
    expect(cellLuminance).not.toHaveBeenCalled();
  });
});

describe("ForensicWatermarkVerifyV1 — renderLite", () => {
  it("never spawns and never emits a verdict sidecar", () => {
    const doc = ForensicWatermarkVerifyV1.renderLite!(
      { videoPath: "/v.mp4" },
      makeCtx(),
    ) as MosaicDocument;
    // A design-mode preview must not look like it checked anything.
    expect(cellLuminance).not.toHaveBeenCalled();
    expect(doc.sidecars).toBeUndefined();
    expect(validateM0String(doc.m0 as unknown as string).ok).toBe(true);
  });

  it("shows the not-checked band", () => {
    const doc = ForensicWatermarkVerifyV1.renderLite!({}, makeCtx()) as MosaicDocument;
    expect(JSON.stringify(doc.sources)).toContain("NOT CHECKED");
  });

  it("still references the video for its poster frame when one is set", () => {
    const doc = ForensicWatermarkVerifyV1.renderLite!(
      { videoPath: "/v.mp4" },
      makeCtx(),
    ) as MosaicDocument;
    expect(doc.assets?.[asAssetId("verify_input")]).toBeDefined();
  });

  it("omits the media asset entirely with no video", () => {
    const doc = ForensicWatermarkVerifyV1.renderLite!({}, makeCtx()) as MosaicDocument;
    expect(Object.keys(doc.assets ?? {})).toHaveLength(0);
  });
});
