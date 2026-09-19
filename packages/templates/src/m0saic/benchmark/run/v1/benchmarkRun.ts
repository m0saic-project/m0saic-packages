import type {
  BenchmarkScenarioResult,
  BenchmarkSession,
  BenchmarkSet,
  BenchmarkSetDefinition,
  BenchmarkSystemInfo,
} from "@m0saic/types";
import { BENCHMARK_SESSION_SCHEMA_VERSION } from "@m0saic/types";
import {
  BENCHMARK_BATTERY,
  BENCHMARK_SET_VERSIONS,
} from "../../battery/manifest";

/**
 * Pure orchestration for a benchmark run. Side effects (spawning renders, the
 * clock, the filesystem) are injected so this module is deterministic and
 * unit-testable; the template (`runner.ts`) wires the real implementations.
 */

/** A scenario resolved for execution. `file` is the bare battery filename. */
export type ResolvedScenario = {
  id: string;
  set: BenchmarkSet;
  label: string;
  file: string;
  codec?: string;
  templateIds?: string[];
  /** Render-duration override (ms) for `make --durationMs`. */
  durationMs?: number;
};

/** What an executor reports back after rendering one scenario. */
export type ScenarioMeasurement = {
  ok: boolean;
  /** Render wall-clock from the scenario's `--report` sidecar (`run.elapsedMs`). */
  elapsedMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  durationMs: number | null;
  codec: string | null;
  /** Toolchain/package versions snapshot from the report (`report.versions`). */
  versions?: Record<string, unknown>;
  error?: string;
};

export type ScenarioExecutor = (s: ResolvedScenario) => Promise<ScenarioMeasurement>;

const ALL_SETS: readonly BenchmarkSet[] = [
  "sources",
  "real",
  "geometry",
  "duration",
  "encoders",
  "sloth",
];

/** The sets that actually have shipped workloads (a declared content version). */
export const AVAILABLE_SETS: BenchmarkSet[] = ALL_SETS.filter(
  (s) => BENCHMARK_SET_VERSIONS[s] != null,
);

function framesOf(durationMs: number | null, fps: number | null): number | null {
  if (durationMs == null || fps == null) return null;
  return Math.round((durationMs / 1000) * fps);
}

function outFpsOf(frames: number | null, elapsedMs: number | null): number | null {
  if (frames == null || !elapsedMs) return null;
  return Math.round((frames / (elapsedMs / 1000)) * 10) / 10;
}

/**
 * Resolve the workloads to run for the selected sets. Frozen workloads come
 * straight from the manifest; the `encoders` set is additionally expanded with
 * the host's detected hardware encoders (those are machine-dependent and so are
 * NOT part of any frozen set version).
 */
export function selectScenarios(
  tests: BenchmarkSet[],
  hwEncoders: string[],
): ResolvedScenario[] {
  const wanted = new Set(tests);
  const resolved: ResolvedScenario[] = BENCHMARK_BATTERY.filter((s) =>
    wanted.has(s.set),
  ).map((s) => ({
    id: s.id,
    set: s.set,
    label: s.label,
    file: s.file,
    ...(s.codec ? { codec: s.codec } : {}),
    ...(s.templateIds ? { templateIds: s.templateIds } : {}),
    ...(s.durationMs ? { durationMs: s.durationMs } : {}),
  }));

  if (wanted.has("encoders") && hwEncoders.length > 0) {
    const base = BENCHMARK_BATTERY.find((s) => s.set === "encoders");
    if (base) {
      for (const enc of hwEncoders) {
        resolved.push({
          id: `encoders-${enc}`,
          set: "encoders",
          label: `${enc} (hw)`,
          file: base.file,
          codec: enc,
        });
      }
    }
  }
  return resolved;
}

/** Run each scenario through the executor (sequentially — they compete for the CPU). */
export async function runScenarios(
  scenarios: ResolvedScenario[],
  exec: ScenarioExecutor,
): Promise<{ results: BenchmarkScenarioResult[]; versions?: Record<string, unknown> }> {
  const results: BenchmarkScenarioResult[] = [];
  let versions: Record<string, unknown> | undefined;

  for (const s of scenarios) {
    let m: ScenarioMeasurement;
    try {
      m = await exec(s);
    } catch (err) {
      m = {
        ok: false,
        elapsedMs: null,
        width: null,
        height: null,
        fps: null,
        durationMs: null,
        codec: s.codec ?? null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    if (!versions && m.versions) versions = m.versions;

    const frames = framesOf(m.durationMs, m.fps);
    results.push({
      id: s.id,
      set: s.set,
      label: s.label,
      ...(s.templateIds ? { templateIds: s.templateIds } : {}),
      ok: m.ok,
      elapsedMs: m.elapsedMs,
      outFps: outFpsOf(frames, m.elapsedMs),
      frames,
      width: m.width,
      height: m.height,
      durationMs: m.durationMs,
      fps: m.fps,
      codec: m.codec,
      ...(m.error ? { error: m.error } : {}),
    });
  }
  return { results, versions };
}

/** Per-set content-version records for the sets that actually ran. */
function buildSetDefs(selectedSets: BenchmarkSet[]): BenchmarkSetDefinition[] {
  const defs: BenchmarkSetDefinition[] = [];
  for (const set of selectedSets) {
    const version = BENCHMARK_SET_VERSIONS[set];
    if (version == null) continue; // set has no shipped workloads
    const scenarioIds = BENCHMARK_BATTERY.filter((s) => s.set === set).map(
      (s) => s.id,
    );
    if (scenarioIds.length === 0) continue;
    defs.push({ set, version, scenarioIds });
  }
  return defs;
}

/** Aggregate frames-per-second across all successful scenarios (the "score"). */
function aggregateFps(results: BenchmarkScenarioResult[]): number {
  let frames = 0;
  let ms = 0;
  for (const r of results) {
    if (r.ok && r.frames != null && r.elapsedMs) {
      frames += r.frames;
      ms += r.elapsedMs;
    }
  }
  return ms > 0 ? Math.round((frames / (ms / 1000)) * 10) / 10 : 0;
}

/** Assemble the final, shareable session object from measured results. */
export function assembleSession(input: {
  label: string;
  systemInfo: BenchmarkSystemInfo;
  results: BenchmarkScenarioResult[];
  selectedSets: BenchmarkSet[];
  startedAtIso: string;
  finishedAtIso: string;
  elapsedMs: number;
  versions?: Record<string, unknown>;
}): BenchmarkSession {
  const totalElapsedMs = input.results.reduce(
    (sum, r) => sum + (r.ok && r.elapsedMs ? r.elapsedMs : 0),
    0,
  );
  return {
    schemaVersion: BENCHMARK_SESSION_SCHEMA_VERSION,
    label: input.label,
    startedAtIso: input.startedAtIso,
    finishedAtIso: input.finishedAtIso,
    elapsedMs: input.elapsedMs,
    system: input.systemInfo,
    ...(input.versions ? { versions: input.versions } : {}),
    sets: buildSetDefs(input.selectedSets),
    scenarios: input.results,
    summary: {
      totalElapsedMs,
      scoreVersion: 1,
      score: aggregateFps(input.results),
    },
  };
}
