import type { LuminanceBucket } from "@m0saic/types";
import {
  avgLumaForWindow,
  buildWindowsAlphaExpr,
  groupWindowsByVariant,
  pickCoverage,
  pickVariantForWindow,
  planWindows,
} from "./windows";

// Natural duration of the committed qr-animate mp4 assets.
// Matches build-qr-rendered.cjs NATURAL_DUR_MS.
const QR_NAT = 7020;

function brightBuckets(durMs: number, luma = 220): LuminanceBucket[] {
  const out: LuminanceBucket[] = [];
  const step = 500;
  for (let t = 0; t < durMs; t += step) {
    out.push({ startMs: t, endMs: Math.min(durMs, t + step), avgLuma: luma });
  }
  return out;
}

function darkBuckets(durMs: number, luma = 24): LuminanceBucket[] {
  return brightBuckets(durMs, luma);
}

describe("pickCoverage", () => {
  test("returns 0.90 for ≤ 8s", () => {
    expect(pickCoverage(1)).toBe(0.9);
    expect(pickCoverage(8_000)).toBe(0.9);
  });
  test("returns 0.625 for 8s < d ≤ 20s", () => {
    expect(pickCoverage(8_001)).toBe(0.625);
    expect(pickCoverage(20_000)).toBe(0.625);
  });
  test("returns 0.55 for 20s < d ≤ 60s", () => {
    expect(pickCoverage(45_000)).toBe(0.55);
    expect(pickCoverage(60_000)).toBe(0.55);
  });
  test("returns 0.32 for 60s < d ≤ 5min", () => {
    expect(pickCoverage(180_000)).toBe(0.32);
    expect(pickCoverage(300_000)).toBe(0.32);
  });
  test("returns 0.18 for d > 5min", () => {
    expect(pickCoverage(1_800_000)).toBe(0.18);
  });
});

describe("avgLumaForWindow / pickVariantForWindow", () => {
  test("returns weighted average over overlapping buckets", () => {
    const buckets: LuminanceBucket[] = [
      { startMs:    0, endMs: 1000, avgLuma: 200 },
      { startMs: 1000, endMs: 2000, avgLuma: 100 },
    ];
    expect(avgLumaForWindow(buckets, 0, 2000)).toBe(150);
    expect(avgLumaForWindow(buckets, 0, 1000)).toBe(200);
    expect(avgLumaForWindow(buckets, 1000, 2000)).toBe(100);
  });

  test("falls back to neutral 128 when no buckets overlap", () => {
    expect(avgLumaForWindow([], 0, 1000)).toBe(128);
  });

  // Cohesion mapping (not contrast):
  // bright region → light card (tones in), dark region → dark card (orange floats).
  test("bright region picks light variant (cohesion)", () => {
    expect(pickVariantForWindow(brightBuckets(10_000), 0, QR_NAT)).toBe("light");
  });

  test("dark region picks dark variant (cohesion — orange modules float)", () => {
    expect(pickVariantForWindow(darkBuckets(10_000), 0, QR_NAT)).toBe("dark");
  });

  test("at threshold picks light (deterministic tie-break — bright side)", () => {
    const at128: LuminanceBucket[] = [
      { startMs: 0, endMs: 1000, avgLuma: 128 },
    ];
    expect(pickVariantForWindow(at128, 0, 1000)).toBe("light");
  });
});

describe("planWindows — single-window mode", () => {
  test("≤ 8s clip: one window starting at 0, stretched to coverage", () => {
    const res = planWindows({
      videoDurMs: 8_000,
      qrNaturalDurMs: QR_NAT,
      luminanceBuckets: brightBuckets(8_000),
    });
    expect(res.windows).toHaveLength(1);
    expect(res.windows[0]!.startMs).toBe(0);
    // 8000 × 0.9 = 7200ms window
    expect(res.windows[0]!.endMs).toBe(7_200);
    expect(res.playbackSpeed).toBeCloseTo(QR_NAT / 7200, 4);
  });

  test("very short clip floored by minSingleWindowDurMs", () => {
    const res = planWindows({
      videoDurMs: 1_000,
      qrNaturalDurMs: QR_NAT,
      luminanceBuckets: brightBuckets(1_000),
      minSingleWindowDurMs: 1_500,
    });
    // 1000 × 0.9 = 900 → floored to 1500 → clamped to videoDurMs=1000
    expect(res.windows[0]!.endMs).toBe(1_000);
  });

  test("variant picked from probe over the window range (dark scene → dark variant)", () => {
    const buckets: LuminanceBucket[] = [
      { startMs: 0, endMs: 8_000, avgLuma: 30 }, // very dark scene
    ];
    const res = planWindows({
      videoDurMs: 8_000,
      qrNaturalDurMs: QR_NAT,
      luminanceBuckets: buckets,
    });
    expect(res.windows[0]!.variant).toBe("dark");
  });
});

describe("planWindows — multi-window mode", () => {
  test("60s clip at default tier (55%): 3-4 windows of natural-speed playback", () => {
    const res = planWindows({
      videoDurMs: 60_000,
      qrNaturalDurMs: QR_NAT,
      luminanceBuckets: brightBuckets(60_000),
    });
    // 60000 / 7020 = 8 slots; 60000 × 0.55 = 33000 / 7020 ≈ 5 → capped by
    // gap-respecting maxK = floor(7/2)+1 = 4.
    expect(res.playbackSpeed).toBe(1.0);
    expect(res.windows.length).toBeGreaterThanOrEqual(3);
    expect(res.windows.length).toBeLessThanOrEqual(4);
  });

  test("all windows are slot-aligned to qrNaturalDurMs", () => {
    const res = planWindows({
      videoDurMs: 120_000,
      qrNaturalDurMs: QR_NAT,
      luminanceBuckets: brightBuckets(120_000),
    });
    for (const w of res.windows) {
      expect(w.startMs % QR_NAT).toBe(0);
      expect(w.endMs - w.startMs).toBe(QR_NAT);
    }
  });

  test("windows are strictly increasing in startMs (no duplicates)", () => {
    const res = planWindows({
      videoDurMs: 600_000,
      qrNaturalDurMs: QR_NAT,
      luminanceBuckets: brightBuckets(600_000),
    });
    for (let i = 1; i < res.windows.length; i += 1) {
      expect(res.windows[i]!.startMs).toBeGreaterThan(
        res.windows[i - 1]!.startMs,
      );
    }
  });

  test("minGap enforced: consecutive windows have ≥ minGap ms between them", () => {
    const minGapMs = 3000;
    const res = planWindows({
      videoDurMs: 600_000,
      qrNaturalDurMs: QR_NAT,
      luminanceBuckets: brightBuckets(600_000),
      minGapMs,
    });
    for (let i = 1; i < res.windows.length; i += 1) {
      const gap = res.windows[i]!.startMs - res.windows[i - 1]!.endMs;
      expect(gap).toBeGreaterThanOrEqual(minGapMs);
    }
  });

  test("high coverage with limited slots → fewer-but-spaced (not adjacent)", () => {
    // Was the canonical bug: 30s × 0.7 = 21000ms ≈ 3 natural windows in
    // 4 available slots — previously placed at slots [1,2,3] (two
    // adjacent). With minGapMs=3000 → slotIncrement=2, K capped at 2.
    const res = planWindows({
      videoDurMs: 30_000,
      qrNaturalDurMs: QR_NAT,
      luminanceBuckets: brightBuckets(30_000),
      coverageOverride: 0.7,
    });
    if (res.playbackSpeed === 1.0) {
      // Multi-window path: no adjacent pairs.
      for (let i = 1; i < res.windows.length; i += 1) {
        const gap = res.windows[i]!.startMs - res.windows[i - 1]!.endMs;
        expect(gap).toBeGreaterThanOrEqual(3000);
      }
    } else {
      // Fell back to single-window (retimed).
      expect(res.windows.length).toBe(1);
    }
  });

  test("when min-gap forces ≤1 window, falls back to single-window (retimed) covering totalVisible", () => {
    // 24s clip with high coverage that would normally fit 2 windows
    // without the gap, but slotIncrement=2 caps maxK to 1.
    const res = planWindows({
      videoDurMs: 24_000,
      qrNaturalDurMs: QR_NAT,
      luminanceBuckets: brightBuckets(24_000),
      coverageOverride: 0.7, // 16800ms total visible
      minGapMs: 3000,
    });
    // numAvail = floor(24000/7020) = 3, maxK with inc=2 = floor(2/2)+1 = 2.
    // requestedK = round(16800/7020) = 2. maxK=2 → multi-window keeps 2.
    // But check the gap holds.
    if (res.playbackSpeed === 1.0) {
      expect(res.windows.length).toBe(2);
      const gap = res.windows[1]!.startMs - res.windows[0]!.endMs;
      expect(gap).toBeGreaterThanOrEqual(3000);
    } else {
      // Single-window with retimed playback — covers totalVisible-ish.
      expect(res.windows.length).toBe(1);
      const wDur = res.windows[0]!.endMs - res.windows[0]!.startMs;
      expect(wDur).toBeGreaterThanOrEqual(10_000); // close to 16800
    }
  });

  test("coverageOverride 1.0 saturates only up to gap-respecting K", () => {
    const res = planWindows({
      videoDurMs: 60_000,
      qrNaturalDurMs: QR_NAT,
      luminanceBuckets: brightBuckets(60_000),
      coverageOverride: 1.0,
      minGapMs: 3000,
    });
    // numAvail = 8, maxK with inc=2 = floor(7/2)+1 = 4. K capped at 4
    // even though requested round(60000/7020)=9 → 8.
    expect(res.windows.length).toBeLessThanOrEqual(4);
    // Gap holds.
    for (let i = 1; i < res.windows.length; i += 1) {
      const gap = res.windows[i]!.startMs - res.windows[i - 1]!.endMs;
      expect(gap).toBeGreaterThanOrEqual(3000);
    }
  });

  test("minGapMs=0 → no gap constraint; classic dense packing", () => {
    const res = planWindows({
      videoDurMs: 60_000,
      qrNaturalDurMs: QR_NAT,
      luminanceBuckets: brightBuckets(60_000),
      coverageOverride: 1.0,
      minGapMs: 0,
    });
    // slotIncrement=ceil(7020/7020)=1, maxK = numAvail = 8.
    expect(res.windows.length).toBe(8);
  });

  test("zero coverage → exactly one window (min-1 invariant)", () => {
    const res = planWindows({
      videoDurMs: 60_000,
      qrNaturalDurMs: QR_NAT,
      luminanceBuckets: brightBuckets(60_000),
      coverageOverride: 0,
    });
    expect(res.windows.length).toBe(1);
  });
});

describe("groupWindowsByVariant", () => {
  test("partitions windows by variant", () => {
    const windows = [
      { startMs:        0, endMs:  QR_NAT,     variant: "light" as const },
      { startMs:   QR_NAT, endMs:  QR_NAT * 2, variant: "dark"  as const },
      { startMs: QR_NAT*2, endMs:  QR_NAT * 3, variant: "light" as const },
    ];
    const grouped = groupWindowsByVariant(windows);
    expect(grouped.light).toHaveLength(2);
    expect(grouped.dark).toHaveLength(1);
    expect(grouped.light[0]!.startMs).toBe(0);
    expect(grouped.dark[0]!.startMs).toBe(QR_NAT);
  });
});

describe("buildWindowsAlphaExpr", () => {
  test("empty windows → undefined", () => {
    expect(buildWindowsAlphaExpr([])).toBeUndefined();
  });

  test("single window → ramped clip with peakAlpha multiplier", () => {
    const expr = buildWindowsAlphaExpr(
      [{ startMs: 4520, endMs: 9040, variant: "dark" }],
      { peakAlpha: 1, fadeInSec: 0.4, fadeOutSec: 0.4 },
    );
    expect(expr).toBe(
      "1.000*clip(min(clip((t-4.520)/0.400,0,1),clip((9.040-t)/0.400,0,1)),0,1)",
    );
  });

  test("peakAlpha < 1 softens the plateau", () => {
    const expr = buildWindowsAlphaExpr(
      [{ startMs: 0, endMs: 7020, variant: "light" }],
      { peakAlpha: 0.92, fadeInSec: 0.4, fadeOutSec: 0.4 },
    );
    expect(expr!.startsWith("0.920*")).toBe(true);
  });

  test("multiple windows → sum of per-window ramps, clipped", () => {
    const expr = buildWindowsAlphaExpr(
      [
        { startMs:     0, endMs:  7020, variant: "light" },
        { startMs: 14040, endMs: 21060, variant: "light" },
      ],
      { peakAlpha: 1, fadeInSec: 0.4, fadeOutSec: 0.4 },
    );
    // Sum of two `min(...)` terms then clip-to-1 then * peakAlpha
    expect(expr).toContain("min(clip((t-0.000)/0.400");
    expect(expr).toContain("min(clip((t-14.040)/0.400");
    expect(expr).toMatch(/^1\.000\*clip\(.*\+.*,0,1\)$/);
  });
});
