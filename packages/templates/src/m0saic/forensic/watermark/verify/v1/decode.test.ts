import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it, beforeEach, afterAll } from "@jest/globals";

import {
  SidecarError,
  discoverSidecarPath,
  readSidecar,
  runCheck,
} from "./decode";

/** The engine's `ctx.analysis.cellLuminance` pass, faked. */
const sampler = jest.fn();

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "wm-verify-"));
const written: string[] = [];

function writeTmp(name: string, contents: string): string {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, contents, "utf8");
  written.push(p);
  return p;
}

// The grid must hold at least one cell per codeword bit — BCH(127) needs
// ≥127 cells, so 16×9 = 144 is the smallest tidy fixture that decodes.
const COLS = 16;
const ROWS = 9;
const CELLS = COLS * ROWS;

/** A structurally valid embed sidecar for a 16×9 grid. */
function validSidecar(over: Record<string, unknown> = {}) {
  return {
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
    ...over,
  };
}

beforeEach(() => {
  sampler.mockReset();
  // One frame of deterministic pseudo-content — enough to exercise the
  // correlator without pretending to be a real watermarked clip.
  sampler.mockResolvedValue({
    luminanceGrid: Array.from({ length: CELLS }, (_, i) => (i * 37) % 256),
    frameCount: 1,
  });
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

// These four cases moved here from the CLI's `decodeWatermark.test.ts`
// when `m0saic decode-watermark` was retired — the validation they
// cover is now the template's responsibility.
describe("readSidecar — validation (re-homed from the CLI suite)", () => {
  it("rejects a missing sidecar", () => {
    let caught: unknown;
    try {
      readSidecar(path.join(TMP, "nope.json"));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SidecarError);
    expect((caught as SidecarError).code).toBe("SIDECAR_NOT_FOUND");
  });

  it("rejects malformed JSON", () => {
    const p = writeTmp("bad.json", "{ not json");
    expect(() => readSidecar(p)).toThrow(SidecarError);
    try {
      readSidecar(p);
    } catch (err) {
      expect((err as SidecarError).code).toBe("SIDECAR_INVALID_JSON");
    }
  });

  it("rejects an unsupported sidecar version", () => {
    const p = writeTmp("v2.json", JSON.stringify(validSidecar({ version: "watermark/v2" })));
    try {
      readSidecar(p);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as SidecarError).code).toBe("SIDECAR_VERSION_UNSUPPORTED");
    }
  });

  it("rejects an unsupported algorithm", () => {
    const p = writeTmp("alg.json", JSON.stringify(validSidecar({ algorithm: "dct-coeff" })));
    try {
      readSidecar(p);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as SidecarError).code).toBe("SIDECAR_ALGORITHM_UNSUPPORTED");
    }
  });

  it("accepts a well-formed watermark/v1 sidecar", () => {
    const p = writeTmp("ok.json", JSON.stringify(validSidecar()));
    expect(readSidecar(p).payload.valueHex).toBe("deadbeef");
  });
});

describe("discoverSidecarPath", () => {
  it("swaps the extension for .watermark.json beside the video", () => {
    expect(discoverSidecarPath(path.join("/renders", "out.mp4"))).toBe(
      path.join("/renders", "out.watermark.json"),
    );
  });

  it("handles a basename with dots", () => {
    expect(discoverSidecarPath(path.join("/r", "clip.final.v2.mov"))).toBe(
      path.join("/r", "clip.final.v2.watermark.json"),
    );
  });
});

describe("runCheck — never throws", () => {
  it("returns an error verdict when the sidecar is missing", async () => {
    const report = await runCheck({ videoPath: path.join(TMP, "ghost.mp4"), sampler });
    expect(report.verdict).toBe("error");
    expect(report.error?.code).toBe("SIDECAR_NOT_FOUND");
    // It names the path it looked for, so the card can say why.
    expect(report.sidecarPath).toBe(path.join(TMP, "ghost.watermark.json"));
    expect(sampler).not.toHaveBeenCalled();
  });

  it("returns an error verdict when the engine sampling pass fails", async () => {
    const sc = writeTmp("sample-fail.json", JSON.stringify(validSidecar()));
    sampler.mockRejectedValue(new Error("ffmpeg sampling failed (exit 1): No such file or directory"));
    const report = await runCheck({ videoPath: "/nope.mp4", sidecarPath: sc, sampler });
    expect(report.verdict).toBe("error");
    expect(report.error?.code).toBe("SAMPLING_FAILED");
    expect(report.error?.message).toContain("No such file");
  });

  it("returns ANALYSIS_UNAVAILABLE when the host attached no sampling pass", async () => {
    // No toolchain → no `ctx.analysis`. The check must say so on the card
    // rather than guess at a binary on PATH.
    const sc = writeTmp("no-analysis.json", JSON.stringify(validSidecar()));
    const report = await runCheck({ videoPath: "/v.mp4", sidecarPath: sc, sampler: undefined });
    expect(report.verdict).toBe("error");
    expect(report.error?.code).toBe("ANALYSIS_UNAVAILABLE");
    expect(report.error?.message).toMatch(/m0saic setup/);
  });

  it("reports an error verdict when hostReference has the wrong cell count", async () => {
    const sc = writeTmp(
      "bad-host.json",
      JSON.stringify(
        validSidecar({
          hostReference: { type: "cell-luminance-grid", luminanceGrid: [[1, 2, 3]] },
        }),
      ),
    );
    const report = await runCheck({ videoPath: "/v.mp4", sidecarPath: sc, sampler });
    expect(report.verdict).toBe("error");
    expect(report.error?.code).toBe("SIDECAR_HOST_REFERENCE_MALFORMED");
  });

  it("carries grid + ecc context through on a decoded result", async () => {
    const sc = writeTmp("ctx.json", JSON.stringify(validSidecar()));
    const report = await runCheck({ videoPath: "/v.mp4", sidecarPath: sc, sampler });
    expect(report.grid).toEqual({ cols: COLS, rows: ROWS });
    expect(report.ecc).toEqual({ n: 127, k: 36, t: 15 });
    expect(report.framesSampled).toBe(1);
    expect(report.videoPath).toBe("/v.mp4");
    // Noise in, no clean codeword out — the honest outcome for 4 random cells.
    expect(["fail", "mismatch", "pass"]).toContain(report.verdict);
  });

  it("the UN-MARKED original fails on presence, never 'mismatch 00000000'", async () => {
    // Host reference == the sampled grid → zero residual → all scores 0 →
    // the all-zero codeword is syndrome-clean and BCH "recovers" payload 0.
    const host = Array.from({ length: CELLS }, (_, i) => (i * 37) % 256);
    const sc = writeTmp(
      "original.json",
      JSON.stringify(validSidecar({ hostReference: { type: "cell-luminance-grid", luminanceGrid: [host] } })),
    );
    sampler.mockResolvedValue({ luminanceGrid: host.slice(), frameCount: 1 });
    const report = await runCheck({ videoPath: "/original.mp4", sidecarPath: sc, sampler });
    expect(report.verdict).toBe("fail");
    expect(report.ok).toBe(false);
    expect(report.recoveredHex).toBeUndefined();
    expect(report.meanAbsScore).toBe(0);
  });

  it("defaults expectedHex to the sidecar's payload", async () => {
    const sc = writeTmp("expected.json", JSON.stringify(validSidecar()));
    const report = await runCheck({ videoPath: "/v.mp4", sidecarPath: sc, sampler });
    expect(report.expectedHex).toBe("deadbeef");
  });

  it("lets an explicit expectedHex override the sidecar's claim", async () => {
    const sc = writeTmp("override.json", JSON.stringify(validSidecar()));
    const report = await runCheck({
      videoPath: "/v.mp4",
      sidecarPath: sc,
      expectedHex: "0BADCAFE",
      sampler,
    });
    // Normalized to lowercase so the comparison against a recovered hex holds.
    expect(report.expectedHex).toBe("0badcafe");
  });

  it("samples the delivered file as-is: grid only, no cover-fit, no rate/duration pin", async () => {
    // The embed side authored its reference over the same cell-grid tail;
    // any extra option here would shift the cells and break subtraction.
    const sc = writeTmp("argv.json", JSON.stringify(validSidecar()));
    await runCheck({ videoPath: "/v.mp4", sidecarPath: sc, sampler });
    expect(sampler).toHaveBeenCalledTimes(1);
    expect(sampler.mock.calls[0]).toEqual(["/v.mp4", { cols: COLS, rows: ROWS }]);
  });
});
