import type { BenchmarkSystemInfo } from "@m0saic/types";
import {
  assembleSession,
  AVAILABLE_SETS,
  runScenarios,
  selectScenarios,
  type ResolvedScenario,
  type ScenarioMeasurement,
} from "./benchmarkRun";

const SYS: BenchmarkSystemInfo = {
  cpu: { model: "Test CPU", cores: 8, speedMhz: 2400 },
  ram: { totalBytes: 17179869184, totalGb: 16 },
  os: { platform: "darwin", arch: "arm64", release: "0.0.0" },
  ffmpeg: { found: true, version: "ffmpeg test", hwEncoders: ["h264_videotoolbox"] },
};

describe("selectScenarios", () => {
  it("returns the sources workloads (no codec) for the sources set", () => {
    const sel = selectScenarios(["sources"], []);
    expect(sel.length).toBeGreaterThanOrEqual(4);
    expect(sel.every((s) => s.set === "sources")).toBe(true);
    expect(sel.every((s) => s.codec === undefined)).toBe(true);
    expect(sel.map((s) => s.id)).toContain("sources-media");
  });

  it("expands the encoders set with host hardware encoders", () => {
    const sel = selectScenarios(["encoders"], ["h264_videotoolbox"]);
    const codecs = sel.filter((s) => s.set === "encoders").map((s) => s.codec);
    expect(codecs).toContain("libopenh264"); // frozen software baseline
    expect(codecs).toContain("h264_videotoolbox"); // host hw, appended
    expect(sel.find((s) => s.id === "encoders-h264_videotoolbox")).toBeTruthy();
  });

  it("returns nothing for an empty test selection", () => {
    expect(selectScenarios([], ["h264_videotoolbox"])).toEqual([]);
  });

  it("AVAILABLE_SETS contains every set with shipped workloads", () => {
    expect(AVAILABLE_SETS).toContain("sources");
    expect(AVAILABLE_SETS).toContain("encoders");
    expect(AVAILABLE_SETS).toContain("real"); // heavy tier is now populated
    expect(AVAILABLE_SETS).toContain("sloth"); // known-blowup tier (the donut)
  });

  it("selects the donut blowup only under the sloth set, not real", () => {
    const donutId = "@m0saic/charts/donut/v1";
    expect(selectScenarios(["real"], []).some((s) => s.templateIds?.includes(donutId))).toBe(false);
    expect(selectScenarios(["sloth"], []).some((s) => s.templateIds?.includes(donutId))).toBe(true);
  });

  it("carries the duration override through for heavy real scenarios", () => {
    const real = selectScenarios(["real"], []);
    expect(real.length).toBeGreaterThanOrEqual(3);
    expect(real.every((s) => typeof s.durationMs === "number" && s.durationMs > 0)).toBe(true);
    // Same workload file measured at multiple lengths.
    const byFile = new Map<string, Set<number | undefined>>();
    for (const s of real) {
      if (!byFile.has(s.file)) byFile.set(s.file, new Set());
      byFile.get(s.file)!.add(s.durationMs);
    }
    expect([...byFile.values()].some((set) => set.size >= 2)).toBe(true);
  });
});

describe("runScenarios + assembleSession", () => {
  const scenarios: ResolvedScenario[] = [
    { id: "a", set: "sources", label: "A", file: "a.mosaic" },
    { id: "b", set: "geometry", label: "B", file: "b.mosaic" },
    { id: "bad", set: "sources", label: "Bad", file: "bad.mosaic" },
  ];

  // Deterministic fake executor: 2s render of 240 frames for a/b, failure for "bad".
  const fakeExec = async (s: ResolvedScenario): Promise<ScenarioMeasurement> => {
    if (s.id === "bad") {
      return { ok: false, elapsedMs: null, width: null, height: null, fps: null, durationMs: null, codec: null, error: "boom" };
    }
    return {
      ok: true,
      elapsedMs: 2000,
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 8000,
      codec: "libopenh264",
      versions: { cli: { name: "m0saic-cli", version: "9.9.9" } },
    };
  };

  it("computes frames + outFps and carries failures through", async () => {
    const { results, versions } = await runScenarios(scenarios, fakeExec);
    expect(results).toHaveLength(3);
    const a = results[0];
    expect(a.frames).toBe(240); // 8000ms * 30fps
    expect(a.outFps).toBe(120); // 240 frames / 2s
    const bad = results[2];
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe("boom");
    expect(bad.frames).toBeNull();
    expect(versions).toEqual({ cli: { name: "m0saic-cli", version: "9.9.9" } });
  });

  it("assembles a valid session with summary + per-set versions", async () => {
    const { results, versions } = await runScenarios(scenarios, fakeExec);
    const session = assembleSession({
      label: "idle",
      systemInfo: SYS,
      results,
      selectedSets: ["sources", "geometry"],
      startedAtIso: "2026-06-16T00:00:00.000Z",
      finishedAtIso: "2026-06-16T00:00:05.000Z",
      elapsedMs: 5000,
      versions,
    });

    expect(session.schemaVersion).toBe(1);
    expect(session.label).toBe("idle");
    expect(session.summary.totalElapsedMs).toBe(4000); // 2 ok scenarios × 2000
    expect(session.summary.score).toBe(120); // 480 frames / 4s
    expect(session.scenarios).toHaveLength(3);
    // Per-set defs cover both selected sets with their content versions + ids.
    const setNames = session.sets.map((d) => d.set).sort();
    expect(setNames).toEqual(["geometry", "sources"]);
    const sources = session.sets.find((d) => d.set === "sources");
    expect(sources?.version).toBeGreaterThanOrEqual(1);
    expect(sources?.scenarioIds).toContain("sources-lavfi");
  });
});
