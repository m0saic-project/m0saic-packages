import { describe, expect, it, beforeEach } from "@jest/globals";

import { ProbeHostError, probeHostLuminance } from "./probeHost";

/** The engine's `ctx.analysis.cellLuminance` pass, faked. */
const sampler = jest.fn();

const BASE = {
  videoPath: "/host.mp4",
  cols: 2,
  rows: 2,
  canvasW: 1920,
  canvasH: 1080,
  fps: 30,
  durationMs: 1000,
};

beforeEach(() => {
  sampler.mockReset();
  sampler.mockResolvedValue({ luminanceGrid: [0, 0, 0, 0], frameCount: 1 });
});

describe("probeHostLuminance", () => {
  it("asks the engine pass for the render pipeline's cover-fit + last-frame hold, rate + duration pinned", async () => {
    await probeHostLuminance(sampler, BASE);
    expect(sampler).toHaveBeenCalledTimes(1);
    expect(sampler.mock.calls[0]).toEqual([
      "/host.mp4",
      {
        cols: 2,
        rows: 2,
        coverTo: { width: 1920, height: 1080 },
        holdLastFrame: true,
        fps: 30,
        durationMs: 1000,
      },
    ]);
  });

  it("holds the final frame for the FULL render duration", async () => {
    // Regression: the pipeline freezes the last frame when the render
    // outlasts its source. Without the hold the probe stops at the source's
    // end, so hostReference describes only the moving part while the
    // delivered video is mostly a frozen frame — the reference and the
    // output then disagree by far more than the watermark's ~1.6 luma
    // levels, and decode fails silently for any render longer than its
    // source. Measured on a 5.73s clip rendered to 10s: 40 bit errors
    // against a 15-bit BCH budget with the hold absent, 0 with it.
    await probeHostLuminance(sampler, { ...BASE, durationMs: 10_000 });
    const opts = sampler.mock.calls[0]![1];
    expect(opts.holdLastFrame).toBe(true);
    expect(opts.durationMs).toBe(10_000);
  });

  it("returns the averaged grid from the engine pass", async () => {
    sampler.mockResolvedValue({ luminanceGrid: [50, 60, 70, 80], frameCount: 2 });
    const res = await probeHostLuminance(sampler, BASE);
    expect(res.frameCount).toBe(2);
    expect(res.luminanceGrid).toEqual([50, 60, 70, 80]);
  });

  it("re-homes sampler failures onto ProbeHostError", async () => {
    // forensic-watermark.ts branches on `instanceof ProbeHostError` to render
    // an error card instead of throwing — the class identity is load-bearing.
    sampler.mockRejectedValue(new Error("ffmpeg probe failed (exit 1): no such file"));
    let caught: unknown;
    try {
      await probeHostLuminance(sampler, BASE);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProbeHostError);
    expect((caught as ProbeHostError).code).toBe("SAMPLING_FAILED");
    expect((caught as Error).message).toMatch(/ffmpeg probe failed/);
  });

  it("reports ANALYSIS_UNAVAILABLE when the host attached no sampling pass", async () => {
    let caught: unknown;
    try {
      await probeHostLuminance(undefined, BASE);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProbeHostError);
    expect((caught as ProbeHostError).code).toBe("ANALYSIS_UNAVAILABLE");
    expect((caught as Error).message).toMatch(/m0saic setup/);
  });
});
