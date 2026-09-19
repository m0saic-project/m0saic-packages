import {
  BENCHMARK_SESSION_SCHEMA_VERSION,
  type BenchmarkSession,
} from "./session";

describe("benchmark session schema", () => {
  it("pins the schema version at 1", () => {
    expect(BENCHMARK_SESSION_SCHEMA_VERSION).toBe(1);
  });

  it("accepts a well-formed session (compile + shape check)", () => {
    const session: BenchmarkSession = {
      schemaVersion: BENCHMARK_SESSION_SCHEMA_VERSION,
      label: "idle",
      startedAtIso: "2026-06-15T00:00:00.000Z",
      finishedAtIso: "2026-06-15T00:05:00.000Z",
      elapsedMs: 300000,
      system: {
        cpu: { model: "Apple M1 Max", cores: 10, speedMhz: null },
        ram: { totalBytes: 68719476736, totalGb: 64 },
        os: { platform: "darwin", arch: "arm64", release: "23.6.0" },
        ffmpeg: { found: true, version: "ffmpeg 7.0", hwEncoders: ["h264_videotoolbox"] },
      },
      sets: [
        { set: "sources", version: 1, scenarioIds: ["sources-lavfi", "sources-media"] },
        { set: "real", version: 1, scenarioIds: ["real-screencap-grid-v1"] },
      ],
      scenarios: [
        {
          id: "sources-lavfi",
          set: "sources",
          label: "Lavfi generators",
          ok: true,
          elapsedMs: 3200,
          outFps: 281.25,
          frames: 900,
          width: 1920,
          height: 1080,
          durationMs: 30000,
          fps: 30,
          codec: "libopenh264",
        },
        {
          id: "sources-media",
          set: "sources",
          label: "Media file",
          ok: false,
          elapsedMs: null,
          outFps: null,
          frames: null,
          width: null,
          height: null,
          durationMs: null,
          fps: null,
          codec: null,
          error: "asset missing",
        },
        {
          id: "real-screencap-grid-v1",
          set: "real",
          // A composite real workload captured from more than one template.
          templateIds: [
            "@m0saic/media/screencap_grid/v1",
            "@m0saic/brand/logo/v3",
          ],
          label: "Screencap grid + logo",
          ok: true,
          elapsedMs: 45000,
          outFps: 20,
          frames: 900,
          width: 1920,
          height: 1080,
          durationMs: 30000,
          fps: 30,
          codec: "libopenh264",
        },
      ],
      summary: { totalElapsedMs: 48200, scoreVersion: 1, score: 0 },
    };

    expect(session.scenarios).toHaveLength(3);
    expect(session.scenarios[0].set).toBe("sources");
    expect(session.scenarios[1].ok).toBe(false);
    expect(session.scenarios[2].templateIds).toEqual([
      "@m0saic/media/screencap_grid/v1",
      "@m0saic/brand/logo/v3",
    ]);
  });

  it("tracks per-set content versions independently of schema version", () => {
    const realV2: BenchmarkSession["sets"][number] = {
      set: "real",
      version: 2,
      scenarioIds: ["real-bar-graph-v1", "real-logo-v3"],
    };
    // Same JSON shape (schemaVersion 1), newer set content (real@2).
    expect(BENCHMARK_SESSION_SCHEMA_VERSION).toBe(1);
    expect(realV2.version).toBe(2);
    expect(realV2.scenarioIds).toContain("real-logo-v3");
  });
});
