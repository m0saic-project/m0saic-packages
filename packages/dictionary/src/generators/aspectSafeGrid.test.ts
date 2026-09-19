import {
  isValidM0String,
  parseM0StringToRenderFrames,
} from "@m0saic/dsl";
import { aspectSafeGrid } from "./aspectSafeGrid";

describe("aspectSafeGrid generator", () => {
  test("default params produce a valid pair of DSL strings", () => {
    const r = aspectSafeGrid({
      landscapeW: 1920,
      landscapeH: 1080,
      portraitW: 1080,
      portraitH: 1920,
      minCols: 2,
      maxCols: 6,
      minRows: 2,
      maxRows: 6,
    });
    expect(isValidM0String(r.m0)).toBe(true);
    expect(r.primaryLabel).toBe("Landscape");
    expect(r.alternates).toHaveLength(1);
    expect(isValidM0String(r.alternates![0].m0)).toBe(true);
    expect(r.alternates![0].label).toBe("Portrait");
    expect(r.sourceCount).toBeGreaterThanOrEqual(4);
  });

  test("primary m0 is clean at landscape canvas; alternate is clean at portrait canvas", () => {
    const r = aspectSafeGrid({
      landscapeW: 1920,
      landscapeH: 1080,
      portraitW: 1080,
      portraitH: 1920,
      minCols: 2,
      maxCols: 4,
      minRows: 2,
      maxRows: 4,
    });

    // Landscape DSL clean at landscape dims.
    {
      const frames = parseM0StringToRenderFrames(
        r.m0,
        r.idealCanvas!.width,
        r.idealCanvas!.height,
      );
      expect(new Set(frames.map((f) => f.width)).size).toBe(1);
      expect(new Set(frames.map((f) => f.height)).size).toBe(1);
    }

    // Portrait DSL clean at portrait dims.
    {
      const frames = parseM0StringToRenderFrames(
        r.alternates![0].m0,
        r.alternates![0].idealCanvas!.width,
        r.alternates![0].idealCanvas!.height,
      );
      expect(new Set(frames.map((f) => f.width)).size).toBe(1);
      expect(new Set(frames.map((f) => f.height)).size).toBe(1);
    }
  });

  test("with gutter, both DSLs stay clean at their respective canvases", () => {
    const r = aspectSafeGrid({
      landscapeW: 1920,
      landscapeH: 1080,
      portraitW: 1080,
      portraitH: 1920,
      minCols: 2,
      maxCols: 4,
      minRows: 2,
      maxRows: 4,
      gutter: 0.08,
    });
    expect(isValidM0String(r.m0)).toBe(true);
    expect(isValidM0String(r.alternates![0].m0)).toBe(true);

    {
      const frames = parseM0StringToRenderFrames(r.m0, 1920, 1080);
      expect(new Set(frames.map((f) => f.width)).size).toBe(1);
      expect(new Set(frames.map((f) => f.height)).size).toBe(1);
    }
    {
      const frames = parseM0StringToRenderFrames(r.alternates![0].m0, 1080, 1920);
      expect(new Set(frames.map((f) => f.width)).size).toBe(1);
      expect(new Set(frames.map((f) => f.height)).size).toBe(1);
    }
  });
});
