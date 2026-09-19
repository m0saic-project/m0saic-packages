import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { validateM0String } from "@m0saic/dsl";
import { makeM0saicTempPrefix } from "@m0saic/platform/paths";
import {
  buildLogoGrid,
  buildMasksByStableKey,
  loadSvgText,
  SVG_SHAPE_GUIDANCE,
} from "./svg-source";
import { DEFAULT_LOGO_SVG } from "./default-logo";

const MINI_SVG = `<svg viewBox="0 0 10 10"><rect x="0" y="0" width="4" height="4"/><rect x="6" y="6" width="4" height="4"/></svg>`;

describe("loadSvgText", () => {
  it("prefers svgPath (file) when set", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), makeM0saicTempPrefix("logo-animate-src")));
    const file = path.join(dir, "logo.svg");
    fs.writeFileSync(file, MINI_SVG, "utf8");
    expect(loadSvgText({ svgPath: file }, "fallback")).toBe(MINI_SVG);
  });

  it("uses the inline svg string when no file is given", () => {
    expect(loadSvgText({ svg: MINI_SVG }, "fallback")).toBe(MINI_SVG);
  });

  it("falls back to the placeholder when neither is set", () => {
    expect(loadSvgText({}, DEFAULT_LOGO_SVG)).toBe(DEFAULT_LOGO_SVG);
  });

  it("throws on an unreadable path (caller maps to an error mosaic)", () => {
    expect(() =>
      loadSvgText({ svgPath: path.join(os.tmpdir(), "logo-animate-does-not-exist.svg") }, "x"),
    ).toThrow();
  });
});

describe("buildLogoGrid", () => {
  it("converts the placeholder M into a valid 33-rect m0 + grid", () => {
    const logo = buildLogoGrid(DEFAULT_LOGO_SVG, { driftPercent: 0, packing: "multi" });
    expect(validateM0String(logo.m0).ok).toBe(true);
    expect(logo.rectCount).toBe(33);
    expect(logo.grid.shapes.length).toBe(33);
    expect(logo.viewBox).toEqual({ x: 0, y: 0, width: 272, height: 272 });
  });

  it("throws actionable guidance on a shape-free SVG", () => {
    expect(() =>
      buildLogoGrid(`<svg viewBox="0 0 10 10"></svg>`, { driftPercent: 0, packing: "multi" }),
    ).toThrow(SVG_SHAPE_GUIDANCE);
  });

  it("is deterministic — same svg → byte-identical m0", () => {
    const a = buildLogoGrid(DEFAULT_LOGO_SVG, { driftPercent: 0, packing: "multi" });
    const b = buildLogoGrid(DEFAULT_LOGO_SVG, { driftPercent: 0, packing: "multi" });
    expect(a.m0).toBe(b.m0);
  });
});

describe("buildMasksByStableKey", () => {
  it("emits silhouette masks for the placeholder M's 8 non-rect shapes", () => {
    const logo = buildLogoGrid(DEFAULT_LOGO_SVG, { driftPercent: 0, packing: "multi" });
    const byKey = buildMasksByStableKey(logo.grid, logo.m0);
    // Only the non-rect silhouettes carry entries; pure rects need no mask.
    const masked = Object.values(byKey).filter((e) => e !== null);
    expect(masked.length).toBe(8);
    for (const e of masked) {
      expect(e!.localPath.length).toBeGreaterThan(0);
      expect(e!.bounds.width).toBeGreaterThan(0);
    }
  });

  it("degrades to {} instead of throwing when the m0 does not match the grid", () => {
    const logo = buildLogoGrid(DEFAULT_LOGO_SVG, { driftPercent: 0, packing: "multi" });
    expect(buildMasksByStableKey(logo.grid, "2(1,1)")).toEqual({});
  });
});
