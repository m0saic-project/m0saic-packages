import type { LuminanceBucket } from "@m0saic/types";
import {
  WATERMARK_SLOT_MS,
  buildAdaptiveLayerSpecs,
  type AdaptiveKnobs,
  type WatermarkLumaEntry,
} from "./adaptive";

const KNOBS: AdaptiveKnobs = {
  variant: "auto",
  windowing: "always",
  opacity: 0.85,
  fadeMs: 400,
  crossfadeMs: 400,
  lumaThreshold: 128,
  minGapMs: 3000,
  artworkPrimary: { image: "/tmp/logo-dark.png", textColor: "#ffffff" },
  artworkOnLight: { image: "/tmp/logo.png", textColor: "#111111" },
};

function buckets(...lumas: number[]): LuminanceBucket[] {
  return lumas.map((avgLuma, i) => ({ startMs: i * 500, endMs: (i + 1) * 500, avgLuma }));
}

function entry(b: LuminanceBucket[], overallAvgLuma = 128): WatermarkLumaEntry {
  return { buckets: b, overallAvgLuma, durationMs: b.length * 500 };
}

describe("buildAdaptiveLayerSpecs — video", () => {
  test("always + auto with buckets → two crossfading layers", () => {
    const specs = buildAdaptiveLayerSpecs({
      isVideo: true,
      videoDurMs: 8000,
      entry: entry(buckets(200, 200, 40, 40)),
      knobs: KNOBS,
    });
    expect(specs.map((s) => s.key)).toEqual(["light", "dark"]);
    expect(specs[0]!.artwork).toEqual(KNOBS.artworkOnLight);
    expect(specs[1]!.artwork).toEqual(KNOBS.artworkPrimary);
    // both carry time-varying alpha with the opacity folded in
    for (const s of specs) {
      expect(s.alphaExpr).toContain("0.8500");
      expect(s.opacity).toBeUndefined();
    }
  });

  test("always + single → one primary layer with entrance fade", () => {
    const specs = buildAdaptiveLayerSpecs({
      isVideo: true,
      videoDurMs: 8000,
      entry: entry(buckets(200)),
      knobs: { ...KNOBS, variant: "single" },
    });
    expect(specs).toHaveLength(1);
    expect(specs[0]!.key).toBe("wm");
    expect(specs[0]!.artwork).toEqual(KNOBS.artworkPrimary);
    expect(specs[0]!.alphaExpr).toBeDefined();
  });

  test("auto degrades to single (primary artwork) with no luma data", () => {
    const specs = buildAdaptiveLayerSpecs({
      isVideo: true,
      videoDurMs: 8000,
      knobs: KNOBS,
    });
    expect(specs).toHaveLength(1);
    expect(specs[0]!.artwork).toEqual(KNOBS.artworkPrimary);
  });

  test("windows mode plans slot-aligned appearances with per-variant layers", () => {
    // 60s clip → multi-window mode; bright buckets early, dark late.
    const b: LuminanceBucket[] = [
      ...Array.from({ length: 60 }, (_, i) => ({
        startMs: i * 500,
        endMs: (i + 1) * 500,
        avgLuma: 220,
      })),
      ...Array.from({ length: 60 }, (_, i) => ({
        startMs: 30000 + i * 500,
        endMs: 30000 + (i + 1) * 500,
        avgLuma: 30,
      })),
    ];
    const specs = buildAdaptiveLayerSpecs({
      isVideo: true,
      videoDurMs: 60000,
      entry: entry(b),
      knobs: { ...KNOBS, windowing: "windows" },
    });
    expect(specs.length).toBeGreaterThanOrEqual(1);
    expect(specs.length).toBeLessThanOrEqual(2);
    for (const s of specs) {
      // windowed trapezoid ramps, peak = opacity
      expect(s.alphaExpr).toMatch(/^0\.850\*clip\(/);
      expect(s.alphaExpr).toContain("min(clip((t-");
    }
  });

  test("windows + single → one layer whose windows span all appearances", () => {
    const specs = buildAdaptiveLayerSpecs({
      isVideo: true,
      videoDurMs: 60000,
      entry: entry(buckets(200, 40)),
      knobs: { ...KNOBS, variant: "single", windowing: "windows" },
    });
    expect(specs).toHaveLength(1);
    expect(specs[0]!.key).toBe("wm");
    expect(specs[0]!.artwork).toEqual(KNOBS.artworkPrimary);
  });

  test("deterministic", () => {
    const args = {
      isVideo: true,
      videoDurMs: 45000,
      entry: entry(buckets(200, 40, 200, 40)),
      knobs: { ...KNOBS, windowing: "windows" as const },
    };
    expect(buildAdaptiveLayerSpecs(args)).toEqual(buildAdaptiveLayerSpecs(args));
  });
});

describe("buildAdaptiveLayerSpecs — image", () => {
  test("bright region → on-light artwork, constant opacity", () => {
    const specs = buildAdaptiveLayerSpecs({
      isVideo: false,
      entry: entry([], 200),
      knobs: KNOBS,
    });
    expect(specs).toEqual([{ key: "wm", artwork: KNOBS.artworkOnLight, opacity: 0.85 }]);
  });

  test("dark region → primary artwork", () => {
    const specs = buildAdaptiveLayerSpecs({
      isVideo: false,
      entry: entry([], 40),
      knobs: KNOBS,
    });
    expect(specs[0]!.artwork).toEqual(KNOBS.artworkPrimary);
  });

  test("no probe → primary artwork (no evidence-free flip)", () => {
    const specs = buildAdaptiveLayerSpecs({ isVideo: false, knobs: KNOBS });
    expect(specs[0]!.artwork).toEqual(KNOBS.artworkPrimary);
    expect(specs[0]!.opacity).toBe(0.85);
  });
});

describe("constants", () => {
  test("slot width is a stable taste constant", () => {
    expect(WATERMARK_SLOT_MS).toBe(4000);
  });
});
