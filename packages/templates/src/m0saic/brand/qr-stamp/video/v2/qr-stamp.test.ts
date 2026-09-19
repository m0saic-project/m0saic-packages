import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import type {
  LuminanceBucket,
  MosaicDocument,
  MosaicEngineContext,
  MosaicMediaSource,
  MosaicRenderableFile,
} from "@m0saic/types";
import { makeM0saicTempPrefix } from "@m0saic/platform/paths";
import { QrStampVideoV2 } from "./qr-stamp";

const TEMPLATE_ID = "@m0saic/brand/qr-stamp/video/v2";
const QR_NAT = 7020;

function makeCtx(
  overrides?: Partial<MosaicEngineContext["target"]> & {
    workspaceDir?: string;
  },
): MosaicEngineContext {
  const ws =
    overrides?.workspaceDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), makeM0saicTempPrefix("qr-stamp-v2-test")));
  return {
    mode: "render" as const,
    target: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 5000,
      ...overrides,
    },
    output: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 5000,
      workspaceDir: ws,
      ...overrides,
    },
    media: {},
  };
}

function asDocument(file: MosaicRenderableFile): MosaicDocument {
  expect(file.kind).toBe("mosaic_document");
  return file as MosaicDocument;
}

function mediaSources(doc: MosaicDocument): MosaicMediaSource[] {
  return (doc.sources ?? []).filter(
    (s): s is MosaicMediaSource => s.type === "media",
  );
}

describe("QrStampVideoV2", () => {
  test("template metadata", () => {
    expect(QrStampVideoV2.id).toBe(TEMPLATE_ID);
    expect(QrStampVideoV2.version).toBe(2);
    expect(QrStampVideoV2.tags).toContain("animated");
  });

  test("missing videoPath returns error mosaic (does not throw)", async () => {
    const doc = asDocument(await QrStampVideoV2.render({}, makeCtx()));
    expect(doc.sources?.length ?? 0).toBeGreaterThan(0);
  });

  test("short clip (≤ 8s, dark scene): single retimed window, dark variant (cohesion)", async () => {
    const buckets: LuminanceBucket[] = [
      { startMs: 0, endMs: 8_000, avgLuma: 30 }, // pure black → dark variant
    ];
    const doc = asDocument(
      await QrStampVideoV2.render(
        {
          videoPath: "/tmp/fake-input.mp4",
          videoDurationMs: 8_000,
          luminanceBuckets: buckets,
        },
        makeCtx({ durationMs: 8_000 }),
      ),
    );
    const sources = mediaSources(doc);
    expect(sources).toHaveLength(2);
    const qr = sources[1]!;
    expect(qr.playback?.loopMode).toBe("loop");
    expect(qr.playback?.clipDurationMs).toBe(QR_NAT);
    // 8000 × 0.9 = 7200ms window
    expect(qr.playback?.playSpeed).toBeCloseTo(QR_NAT / 7200, 3);
    expect(qr.assetId).toBe("qr_stamp_v2_dark");
    // No bare enable — gating happens in alpha now.
    expect(qr.overlay?.enable).toBeUndefined();
    expect(qr.overlay?.alpha).toContain("clip((t-0.000)/0.400,0,1)");
    expect(qr.overlay?.alpha).toContain("clip((7.200-t)/0.400,0,1)");
  });

  describe("short-clip handling (below one animation cycle)", () => {
    const buckets = (luma: number): LuminanceBucket[] => [
      { startMs: 0, endMs: 7_000, avgLuma: luma },
    ];

    test("static tier (< 2.5s): a STATIC PNG still (image source), opaque, no fade-out", async () => {
      const doc = asDocument(
        await QrStampVideoV2.render(
          { videoPath: "/tmp/x.mp4", videoDurationMs: 2_000, luminanceBuckets: buckets(30) },
          makeCtx({ durationMs: 2_000 }),
        ),
      );
      const sources = mediaSources(doc);
      expect(sources).toHaveLength(2); // base video + the static QR still
      const qr = sources[1]!;
      expect(qr.assetId).toBe("qr_stamp_v2_dark"); // dark scene → dark card
      // An image source (infinite still) — NOT a video freeze. No playback.
      expect(qr.mediaType).toBe("image");
      expect(qr.playback).toBeUndefined();
      // The asset resolves to the committed static PNG.
      const qrAsset = (doc.assets as Record<string, { path?: string }>)["qr_stamp_v2_dark"];
      expect(qrAsset?.path).toMatch(/\.static\.png$/);
      // Brief entrance, held — NEVER a windowed fade-out (`clip(...)`).
      expect(qr.overlay?.alpha).toContain("(t-0.000)/0.150");
      expect(qr.overlay?.alpha).not.toContain("clip(");
    });

    test("continuous tier (2.5s–cycle): natural-speed looped playback from t=0, no fade-out", async () => {
      const doc = asDocument(
        await QrStampVideoV2.render(
          { videoPath: "/tmp/x.mp4", videoDurationMs: 4_000, luminanceBuckets: buckets(220) },
          makeCtx({ durationMs: 4_000 }),
        ),
      );
      const sources = mediaSources(doc);
      expect(sources).toHaveLength(2);
      const qr = sources[1]!;
      expect(qr.assetId).toBe("qr_stamp_v2_light"); // bright scene → light card
      expect(qr.playback?.loopMode).toBe("loop");
      expect(qr.playback?.playSpeed).toBe(1.0);
      expect(qr.playback?.clipStartMs).toBeUndefined(); // plays the spawn from t=0
      expect(qr.overlay?.alpha).toContain("(t-0.000)/0.200");
      expect(qr.overlay?.alpha).not.toContain("clip(");
    });

    test("short-clip peak alpha follows qrAlpha", async () => {
      const doc = asDocument(
        await QrStampVideoV2.render(
          { videoPath: "/tmp/x.mp4", videoDurationMs: 2_000, qrAlpha: 0.8, luminanceBuckets: buckets(30) },
          makeCtx({ durationMs: 2_000 }),
        ),
      );
      expect(mediaSources(doc)[1]!.overlay?.alpha).toContain("0.8000");
    });
  });

  test("long clip with mixed luminance: both light and dark sources emitted", async () => {
    // 60s clip alternating bright/dark every 14s — long enough to cover
    // multiple QR_NAT-sized slots in both regions.
    const buckets: LuminanceBucket[] = [];
    for (let t = 0; t < 60_000; t += 1_000) {
      const bright = Math.floor(t / 14_000) % 2 === 0;
      buckets.push({
        startMs: t,
        endMs: t + 1_000,
        avgLuma: bright ? 220 : 30,
      });
    }
    const doc = asDocument(
      await QrStampVideoV2.render(
        {
          videoPath: "/tmp/fake-input.mp4",
          videoDurationMs: 60_000,
          luminanceBuckets: buckets,
        },
        makeCtx({ durationMs: 60_000 }),
      ),
    );
    const sources = mediaSources(doc);
    expect(sources.length).toBeGreaterThanOrEqual(2);
    const ids = sources.map((s) => s.assetId);
    expect(ids).toContain("qr_stamp_v2_base");
    // All overlays use natural-speed playback and alpha-only gating.
    for (const s of sources.slice(1)) {
      expect(s.playback?.playSpeed).toBe(1.0);
      expect(s.overlay?.enable).toBeUndefined();
      expect(s.overlay?.alpha).toMatch(/^[0-9.]+\*clip\(/);
    }
  });

  test("missing videoDurationMs falls back to ctx.target.durationMs", async () => {
    const doc = asDocument(
      await QrStampVideoV2.render(
        { videoPath: "/tmp/fake-input.mp4" },
        makeCtx({ durationMs: 12_000 }),
      ),
    );
    // 12000 × 0.625 = 7500ms < 14040 (2 × QR_NAT) → single window
    const sources = mediaSources(doc);
    expect(sources).toHaveLength(2);
    expect(sources[1]!.overlay?.alpha).toContain("(t-0.000)");
  });

  test("default qrAlpha=0.92 emits 0.920 as the peak multiplier", async () => {
    const doc = asDocument(
      await QrStampVideoV2.render(
        {
          videoPath: "/tmp/fake-input.mp4",
          videoDurationMs: 8_000,
          luminanceBuckets: [{ startMs: 0, endMs: 8_000, avgLuma: 30 }],
        },
        makeCtx({ durationMs: 8_000 }),
      ),
    );
    const alpha = mediaSources(doc)[1]!.overlay?.alpha ?? "";
    expect(alpha.startsWith("0.920*")).toBe(true);
  });

  test("qrAlpha=1 emits 1.000 peak (no opacity attenuation)", async () => {
    const doc = asDocument(
      await QrStampVideoV2.render(
        {
          videoPath: "/tmp/fake-input.mp4",
          videoDurationMs: 8_000,
          qrAlpha: 1,
          luminanceBuckets: [{ startMs: 0, endMs: 8_000, avgLuma: 30 }],
        },
        makeCtx({ durationMs: 8_000 }),
      ),
    );
    const alpha = mediaSources(doc)[1]!.overlay?.alpha ?? "";
    expect(alpha.startsWith("1.000*")).toBe(true);
  });

  test("coverageOverride forces a specific coverage fraction", async () => {
    const doc = asDocument(
      await QrStampVideoV2.render(
        {
          videoPath: "/tmp/fake-input.mp4",
          videoDurationMs: 60_000,
          coverageOverride: 0.5,
          // bright scene → light variant (cohesion)
          luminanceBuckets: [{ startMs: 0, endMs: 60_000, avgLuma: 200 }],
        },
        makeCtx({ durationMs: 60_000 }),
      ),
    );
    const sources = mediaSources(doc);
    expect(sources.length).toBe(2);
    expect(sources[1]!.assetId).toBe("qr_stamp_v2_light");
    // Multi-window alpha expression contains multiple per-window min(...) ramps.
    const alpha = sources[1]!.overlay?.alpha ?? "";
    const perWindow = alpha.match(/min\(clip\(/g) ?? [];
    expect(perWindow.length).toBeGreaterThanOrEqual(3);
  });
});
