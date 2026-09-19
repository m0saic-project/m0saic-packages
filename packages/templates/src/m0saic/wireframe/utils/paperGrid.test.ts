import { isValidM0String } from "@m0saic/dsl";
import type { MosaicLavfiSource } from "@m0saic/types";
import {
  appendTopOverlay,
  makePaperGridSource,
  paperGridPath,
  PAPER_GRID_ALPHA,
} from "./paperGrid";

describe("paperGridPath", () => {
  it("draws interior rules only — count follows the pitch, edges are not rules", () => {
    // 1920×1080 @ 67px pitch: floor(1919/67)=28 verticals, floor(1079/67)=16 horizontals
    const p = paperGridPath(1920, 1080, 67, 2);
    const verticals = (p.match(/M\d+ 0 h/g) ?? []).length;
    const horizontals = (p.match(/M0 \d+ h/g) ?? []).length;
    expect(verticals).toBe(28);
    expect(horizontals).toBe(16);
    expect(p).not.toContain("M0 0 h");
  });

  it("clamps a degenerate pitch to the 8px floor instead of exploding", () => {
    const p = paperGridPath(200, 100, 1, 1);
    const verticals = (p.match(/M\d+ 0 h/g) ?? []).length;
    expect(verticals).toBe(24); // 200/8 - 1
  });

  it("is deterministic", () => {
    expect(paperGridPath(640, 480, 30, 1)).toBe(paperGridPath(640, 480, 30, 1));
  });
});

describe("appendTopOverlay", () => {
  it.each([
    ["1", "1{1}"],
    ["F", "F{1}"],
    ["2(1,1)", "2(1,1){1}"],
    ["3[1,0,1]", "3[1,0,1]{1}"],
    ["2(1{2[-,1]},1)", "2(1{2[-,1]},1){1}"],
  ])("plain root %s → %s", (input, expected) => {
    expect(appendTopOverlay(input)).toBe(expected);
  });

  it("nests into an existing root overlay instead of chaining (OVERLAY_CHAIN)", () => {
    expect(appendTopOverlay("2(1,1){2[-,1]}")).toBe("2(1,1){2[-,1]{1}}");
    expect(appendTopOverlay("1{4(4[1,-,-,-],-,-,-)}")).toBe("1{4(4[1,-,-,-],-,-,-){1}}");
    expect(appendTopOverlay("1{2(1,1){3[1,1,1]}}")).toBe("1{2(1,1){3[1,1,1]{1}}}");
  });

  it("always yields valid m0 for valid input (the chain case included)", () => {
    for (const m0 of [
      "1",
      "2(1,1)",
      "2(1,1){2[-,1]}",
      "3(0{2[-,1]},0{2[1,-]},1)",
      "1{2(1,1){3[1,1,1]}}",
      "4[1,0,0,3(2[1,1],1,2[1,1])]",
    ]) {
      expect(isValidM0String(appendTopOverlay(m0))).toBe(true);
    }
  });
});

describe("makePaperGridSource", () => {
  it("is one masked ink tile blended at the requested alpha", () => {
    const s = makePaperGridSource({ width: 1920, height: 1080, ink: "#000000", alpha: 0.2 }) as MosaicLavfiSource;
    expect(s.type).toBe("lavfi");
    expect(s.mask?.kind).toBe("inline-mask");
    const mask = s.mask as { bounds: { width: number; height: number }; localPath: string };
    expect(mask.bounds.width).toBe(1920);
    expect(mask.bounds.height).toBe(1080);
    expect(mask.localPath.length).toBeGreaterThan(0);
    expect(s.overlay?.alpha).toBe("0.2");
  });

  it("defaults to the preset alpha and a 1/16 pitch of the short side", () => {
    const s = makePaperGridSource({ width: 1920, height: 1080, ink: "#000000" }) as MosaicLavfiSource;
    expect(s.overlay?.alpha).toBe(String(PAPER_GRID_ALPHA));
    const horizontals = ((s.mask as { localPath: string }).localPath.match(/M0 \d+ h/g) ?? []).length;
    expect(horizontals).toBe(15); // 1080 / 68 → 15 interior rows
  });
});
