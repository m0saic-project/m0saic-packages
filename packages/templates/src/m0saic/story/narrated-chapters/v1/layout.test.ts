import { isValidM0String, parseM0StringToRenderFrames } from "@m0saic/dsl";

import {
  ASPECT_TABLE,
  buildCardM0,
  buildImageStackM0,
  buildPanelBodyM0,
  CARD_BANDS,
  classifyAspect,
} from "./layout";

describe("classifyAspect", () => {
  it("uses the plan's thresholds: ≥1.2 landscape, ≤0.85 portrait, else square", () => {
    expect(classifyAspect(1920, 1080)).toBe("landscape");
    expect(classifyAspect(1080, 1920)).toBe("portrait");
    expect(classifyAspect(1080, 1080)).toBe("square");
    expect(classifyAspect(1024, 1024)).toBe("square");
    expect(classifyAspect(1296, 1080)).toBe("landscape"); // ar 1.2 exactly
    expect(classifyAspect(918, 1080)).toBe("portrait"); // ar 0.85 exactly
  });

  it("every class has a complete table row", () => {
    for (const cls of ["landscape", "portrait", "square"] as const) {
      const spec = ASPECT_TABLE[cls];
      expect(spec.cameraAmpScale).toBeGreaterThan(0);
      expect(spec.coverFocusY).toBeGreaterThanOrEqual(0);
      expect(spec.coverFocusY).toBeLessThanOrEqual(1);
      expect(spec.headingScale).toBeGreaterThan(0);
      expect(spec.cardSafeW).toBeGreaterThan(0.5);
    }
    expect(ASPECT_TABLE.portrait.cameraAmpScale).toBeLessThan(ASPECT_TABLE.landscape.cameraAmpScale);
    expect(ASPECT_TABLE.portrait.coverFocusY).toBeLessThan(0.5); // heads sit high
  });
});

describe("card m0", () => {
  it.each(["title", "section-card", "outro"] as const)(
    "%s bands validate and yield one frame per band, at both aspects",
    (kind) => {
      const bands = CARD_BANDS[kind];
      const m0 = String(buildCardM0(bands));
      expect(isValidM0String(m0)).toBe(true);
      expect(parseM0StringToRenderFrames(m0, 1920, 1080)).toHaveLength(bands.length);
      expect(parseM0StringToRenderFrames(m0, 1080, 1920)).toHaveLength(bands.length);
    },
  );

  it("band weights are positive integers (weightedSplit contract)", () => {
    for (const bands of Object.values(CARD_BANDS)) {
      for (const band of bands) {
        expect(Number.isInteger(band.weight)).toBe(true);
        expect(band.weight).toBeGreaterThan(0);
      }
    }
  });
});

describe("body m0", () => {
  it("nests the image stack — never chains", () => {
    expect(String(buildImageStackM0(1))).toBe("F");
    expect(String(buildImageStackM0(2))).toBe("F{F}");
    expect(String(buildImageStackM0(3))).toBe("F{F{F}}");
  });

  it("frame count equals image count at both aspects", () => {
    for (const count of [1, 2, 3, 5]) {
      const m0 = String(buildImageStackM0(count));
      expect(isValidM0String(m0)).toBe(true);
      expect(parseM0StringToRenderFrames(m0, 1920, 1080)).toHaveLength(count);
      expect(parseM0StringToRenderFrames(m0, 1080, 1920)).toHaveLength(count);
    }
  });

  it("rejects a non-positive count", () => {
    expect(() => buildImageStackM0(0)).toThrow();
    expect(() => buildImageStackM0(1.5)).toThrow();
  });

  it("panel fallback is a two-frame overlay", () => {
    const m0 = String(buildPanelBodyM0());
    expect(isValidM0String(m0)).toBe(true);
    expect(parseM0StringToRenderFrames(m0, 1920, 1080)).toHaveLength(2);
  });
});
