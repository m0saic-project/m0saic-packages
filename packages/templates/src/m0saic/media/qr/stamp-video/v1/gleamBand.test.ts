import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { makeM0saicTempPrefix } from "@m0saic/platform/paths";
import { buildGleamSweepXExpr, generateGleamBandPng } from "./gleamBand";

describe("buildGleamSweepXExpr", () => {
  it("emits a cosine-eased traversal from offscreen-left to offscreen-right", () => {
    const expr = buildGleamSweepXExpr(6, 0.9);
    // Range is -0.7w to +0.7w. The band's full horizontal footprint
    // at 20° tilt is ~80% of sizePx (`sin(20°) * sizePx + 2*halfWidth/cos(20°)`)
    // so the band is FULLY offscreen at the extremes — clean
    // enter from the left, clean exit to the right.
    //
    // This wide range is safe ONLY because the gleam is wrapped in a
    // nested mosaic in qr-stamp.ts. The inner framebuffer (sized to
    // the QR cell) does the clipping; ffmpeg's overlay filter alone
    // would paint the band onto surrounding canvas content. If you
    // copy this expression to a flat-composition template, tighten
    // the range to keep the band's footprint inside the destination
    // rect.
    expect(expr).toContain("(-0.7*w)");
    expect(expr).toContain("(0.7*w)");
    // Cosine ease: x = -X + X*(1 - cos(PI * t_norm)). Endpoints at
    // t_norm=0 → -X, t_norm=1 → +X, with sin-curve velocity in
    // between (slow start, fast middle, slow finish). The premium
    // feel comes from this ease — linear sweeps read as cheap.
    expect(expr).toContain("1-cos(PI*");
    // Sweep clamp present.
    expect(expr).toContain("min(1,mod(t,");
    // Period + sweep present and rounded to 3 decimals.
    expect(expr).toContain("mod(t,6.000)");
    expect(expr).toContain("/0.900");
  });

  it("falls back to safe defaults when period or sweep are non-positive", () => {
    const expr = buildGleamSweepXExpr(0, -2);
    expect(expr).toContain("mod(t,6.000)");
    expect(expr).toContain("/0.900");
  });

  it("is deterministic — same inputs → byte-identical output", () => {
    const a = buildGleamSweepXExpr(6, 0.9);
    const b = buildGleamSweepXExpr(6, 0.9);
    expect(a).toBe(b);
  });
});

describe("lazy sharp load", () => {
  it("module can be imported when sharp is unavailable", () => {
    // sharp is lazy-required inside generateGleamBandPng (getSharp()),
    // not at module top level — so the @m0saic/templates registration
    // chain (which imports this file transitively) must survive in
    // sharp-less environments (e.g. browser bundles). Pin that by
    // making require("sharp") throw and importing the module fresh.
    jest.isolateModules(() => {
      jest.doMock("sharp", () => {
        throw new Error("sharp unavailable");
      });
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("./gleamBand");
      }).not.toThrow();
      jest.dontMock("sharp");
    });
  });
});

describe("generateGleamBandPng", () => {
  jest.setTimeout(15_000);

  it("writes a PNG at the requested size into the workspace", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), makeM0saicTempPrefix("qr-stamp-gleam")));
    const { pngPath } = await generateGleamBandPng({
      sizePx: 128,
      workspaceDir: ws,
    });
    expect(pngPath.endsWith("qr-stamp-gleam.png")).toBe(true);
    const stat = fs.statSync(pngPath);
    expect(stat.size).toBeGreaterThan(0);
  });

  it("creates the workspace directory if it doesn't already exist", async () => {
    const ws = path.join(
      os.tmpdir(),
      `${makeM0saicTempPrefix("qr-stamp-gleam-missing")}${Date.now().toString(36)}`,
    );
    expect(fs.existsSync(ws)).toBe(false);
    await generateGleamBandPng({ sizePx: 64, workspaceDir: ws });
    expect(fs.existsSync(ws)).toBe(true);
  });

  it("honors a custom outputName", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), makeM0saicTempPrefix("qr-stamp-gleam-name")));
    const { pngPath } = await generateGleamBandPng({
      sizePx: 64,
      workspaceDir: ws,
      outputName: "shine.png",
    });
    expect(pngPath.endsWith("shine.png")).toBe(true);
    expect(fs.existsSync(pngPath)).toBe(true);
  });
});

