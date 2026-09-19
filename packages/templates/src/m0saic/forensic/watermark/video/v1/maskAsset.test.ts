import * as fs from "node:fs";
import { describe, expect, it } from "@jest/globals";
import sharp from "sharp";
import { buildMaskPng, makeFingerprint } from "./maskAsset";

describe("makeFingerprint", () => {
  it("is deterministic", () => {
    const a = makeFingerprint([1, "foo", 64, 36]);
    const b = makeFingerprint([1, "foo", 64, 36]);
    expect(a).toBe(b);
  });

  it("returns a 16-hex-char string", () => {
    const f = makeFingerprint(["abc"]);
    expect(f).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when inputs change", () => {
    expect(makeFingerprint([1, 2, 3])).not.toBe(makeFingerprint([1, 2, 4]));
  });
});

describe("buildMaskPng — cache + I/O", () => {
  // Small fixture: 4×3 grid upscaled to 16×12 canvas
  const cells = Array.from({ length: 12 }, (_, i) => ({
    polarity: (i % 2 === 0 ? 1 : -1) as 1 | -1,
    alpha: 0.5,
  }));

  it("writes a PNG and returns fresh=true on first call", async () => {
    const fp = makeFingerprint([Date.now(), Math.random()]); // unique
    const res = await buildMaskPng({
      cells,
      cols: 4,
      rows: 3,
      canvasW: 16,
      canvasH: 12,
      fingerprint: fp,
    });
    expect(fs.existsSync(res.pngPath)).toBe(true);
    expect(res.fresh).toBe(true);
    fs.unlinkSync(res.pngPath);
  });

  it("returns fresh=false on cache hit", async () => {
    const fp = makeFingerprint(["cache-hit-test", "stable"]);
    const a = await buildMaskPng({
      cells,
      cols: 4,
      rows: 3,
      canvasW: 16,
      canvasH: 12,
      fingerprint: fp,
    });
    expect(a.fresh).toBe(true);
    const b = await buildMaskPng({
      cells,
      cols: 4,
      rows: 3,
      canvasW: 16,
      canvasH: 12,
      fingerprint: fp,
    });
    expect(b.fresh).toBe(false);
    expect(b.pngPath).toBe(a.pngPath);
    fs.unlinkSync(a.pngPath);
  });

  it("rejects cell-count mismatches", async () => {
    await expect(
      buildMaskPng({
        cells,
        cols: 4,
        rows: 4, // 16 cells expected, only 12 provided
        canvasW: 16,
        canvasH: 16,
        fingerprint: "mismatch-test-abc",
      }),
    ).rejects.toThrow();
  });
});

describe("buildMaskPng — the grid STRETCHES onto the canvas (gate-34 portrait catch)", () => {
  it("keeps every column when the canvas aspect differs from cols:rows", async () => {
    // 4 columns × 2 rows, alternating polarity per COLUMN, onto a PORTRAIT
    // 8×16 canvas. Sharp's default `fit: "cover"` would center-crop the
    // 2:1 grid to 1:2 — keeping one column, stretched — so the rendered
    // mark carried ~none of the codeword and the decoder found noise.
    const cells = Array.from({ length: 8 }, (_, i) => ({
      polarity: (i % 4 % 2 === 0 ? 1 : -1) as 1 | -1,
      alpha: 1,
    }));
    const fp = makeFingerprint(["aspect-stretch", Date.now(), Math.random()]);
    const res = await buildMaskPng({ cells, cols: 4, rows: 2, canvasW: 8, canvasH: 16, fingerprint: fp });
    const { data, info } = await sharp(res.pngPath).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([8, 16, 4]);
    // Row 0 of the PNG: 8 px = 4 cells × 2 px → white, black, white, black.
    const px = (x: number, y: number) => data[(y * info.width + x) * 4];
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((x) => px(x, 0))).toEqual([255, 255, 0, 0, 255, 255, 0, 0]);
    // Bottom row too (rows stretch 2 → 16).
    expect([0, 2, 4, 6].map((x) => px(x, 15))).toEqual([255, 0, 255, 0]);
    fs.unlinkSync(res.pngPath);
  });
});
