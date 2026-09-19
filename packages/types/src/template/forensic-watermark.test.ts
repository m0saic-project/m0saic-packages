import { describe, expect, it } from "@jest/globals";

import type {
  ForensicWatermarkPayloadMode,
  ForensicWatermarkSidecar,
  ForensicWatermarkSidecars,
} from "./forensic-watermark";
import type { MosaicTemplateSidecars } from "./template";

describe("ForensicWatermarkSidecar — type-only", () => {
  // These tests are compile-time gates. They run as no-ops at runtime;
  // the value they assert is that the type checker accepts the shapes.

  it("type-checks a fully-populated id32 sidecar", () => {
    const sample: ForensicWatermarkSidecar = {
      version: "watermark/v1",
      algorithm: "spatio-temporal-ab-bch",
      payload: { mode: "id32", bits: 32, valueHex: "deadbeef" },
      ecc: { type: "BCH", n: 127, k: 36, t: 15, generatorHex: "1ad8d3" },
      key: { type: "mulberry32", seedHex: "1234abcd" },
      grid: { cols: 64, rows: 36, cellWidth: 30, cellHeight: 30 },
      slots: { count: 127, framesPerSlot: 6, startMs: 0, repetition: 1 },
      embed: {
        alphaBase: 0.012,
        alphaMin: 0.004,
        alphaMax: 0.025,
        luminanceAdaptive: true,
      },
      hostReference: {
        type: "cell-luminance-grid",
        luminanceGrid: [[128, 130, 132]],
      },
      render: { fps: 30, width: 1920, height: 1080, durationMs: 5000 },
    };
    expect(sample.payload.bits).toBe(32);
  });

  it("type-checks a uuid128 sidecar", () => {
    const sample: ForensicWatermarkSidecar = {
      version: "watermark/v1",
      algorithm: "spatio-temporal-ab-bch",
      payload: {
        mode: "uuid128",
        bits: 128,
        valueHex: "0123456789abcdef0123456789abcdef",
      },
      ecc: { type: "BCH", n: 255, k: 131, t: 18, generatorHex: "abcdef" },
      key: { type: "mulberry32", seedHex: "00000001" },
      grid: { cols: 64, rows: 36, cellWidth: 30, cellHeight: 30 },
      slots: { count: 255, framesPerSlot: 6, startMs: 0, repetition: 1 },
      embed: {
        alphaBase: 0.012,
        alphaMin: 0.004,
        alphaMax: 0.025,
        luminanceAdaptive: false,
      },
      hostReference: { type: "cell-luminance-grid", luminanceGrid: [] },
      render: { fps: 30, width: 1920, height: 1080, durationMs: 10000 },
    };
    const mode: ForensicWatermarkPayloadMode = sample.payload.mode;
    expect(mode).toBe("uuid128");
  });

  it("ForensicWatermarkSidecars conforms to MosaicTemplateSidecars", () => {
    // If this assignment compiles, the interface extends the base correctly.
    const empty: ForensicWatermarkSidecars = {
      watermark: {
        version: "watermark/v1",
        algorithm: "spatio-temporal-ab-bch",
        payload: { mode: "id32", bits: 32, valueHex: "deadbeef" },
        ecc: { type: "BCH", n: 127, k: 36, t: 15, generatorHex: "1ad8d3" },
        key: { type: "mulberry32", seedHex: "1234abcd" },
        grid: { cols: 64, rows: 36, cellWidth: 30, cellHeight: 30 },
        slots: { count: 127, framesPerSlot: 6, startMs: 0, repetition: 1 },
        embed: {
          alphaBase: 0.012,
          alphaMin: 0.004,
          alphaMax: 0.025,
          luminanceAdaptive: true,
        },
        hostReference: { type: "cell-luminance-grid", luminanceGrid: [] },
        render: { fps: 30, width: 1920, height: 1080, durationMs: 5000 },
      },
    };
    const widened: MosaicTemplateSidecars = empty;
    expect(widened["watermark"]).toBeDefined();
  });
});
