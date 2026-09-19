import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type {
  ResolvedScenario,
  ScenarioExecutor,
  ScenarioMeasurement,
} from "./benchmarkRun";

/** Fixed render envelope — the fairness invariant for every workload. */
const BENCH_WIDTH = 1920;
const BENCH_HEIGHT = 1080;

type PartialReport = {
  ok?: boolean;
  run?: { elapsedMs?: number };
  output?: {
    width?: number;
    height?: number;
    fps?: number;
    durationMs?: number;
    format?: { codec?: string };
  };
  versions?: unknown;
};

function readReport(p: string): PartialReport | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as PartialReport;
  } catch {
    return null;
  }
}

/**
 * Resolve the `m0saic` CLI to spawn. Prefers an explicit `M0SAIC_CLI` override,
 * else re-invokes the same CLI script currently running this template (so a run
 * launched via a linked/bundled CLI re-uses it), else falls back to `m0saic` on
 * PATH.
 */
function resolveCli(): { file: string; prefix: string[] } {
  const override = process.env.M0SAIC_CLI;
  if (override && override.trim()) return { file: override.trim(), prefix: [] };
  const entry = process.argv[1];
  if (entry && /m0saic|cli|index\.js$/i.test(entry)) {
    return { file: process.execPath, prefix: [entry] };
  }
  return { file: "m0saic", prefix: [] };
}

/**
 * Build the real scenario executor: renders each frozen `.mosaic` via a
 * `m0saic make … --report` subprocess and reads the resulting `.output.json`
 * sidecar for the measured render time. The CLI's own `run.elapsedMs` is used
 * (it times the render, excluding our spawn overhead).
 */
export function makeRealExecutor(opts: {
  scenariosDir: string;
  outDir: string;
  onProgress?: (msg: string) => void;
}): ScenarioExecutor {
  const cli = resolveCli();
  fs.mkdirSync(opts.outDir, { recursive: true });

  return async (s: ResolvedScenario): Promise<ScenarioMeasurement> => {
    const input = path.join(opts.scenariosDir, s.file);
    const outFile = path.join(opts.outDir, `${s.id}.mp4`);
    const args = [
      ...cli.prefix,
      "make",
      input,
      "--width",
      String(BENCH_WIDTH),
      "--height",
      String(BENCH_HEIGHT),
      "--report",
      "-o",
      outFile,
      "--quiet",
    ];
    if (s.codec) args.push("--video-codec", s.codec);
    if (s.durationMs) args.push("--durationMs", String(s.durationMs));

    opts.onProgress?.(`▶ ${s.id}${s.codec ? ` [${s.codec}]` : ""}${s.durationMs ? ` (${Math.round(s.durationMs / 1000)}s)` : ""}`);
    const res = spawnSync(cli.file, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const report = readReport(outFile.replace(/\.mp4$/, ".output.json"));
    const out = report?.output;
    const measurement: ScenarioMeasurement = {
      ok: res.status === 0 && !!report && report.ok !== false,
      elapsedMs: report?.run?.elapsedMs ?? null,
      width: out?.width ?? null,
      height: out?.height ?? null,
      fps: out?.fps ?? null,
      durationMs: out?.durationMs ?? null,
      codec: out?.format?.codec ?? s.codec ?? null,
    };
    if (measurement.ok) {
      measurement.versions = report?.versions as
        | Record<string, unknown>
        | undefined;
    } else {
      const stderr = (res.stderr || "").trim().split(/\r?\n/).slice(-2).join(" ");
      measurement.error = stderr || `exit ${res.status ?? "unknown"}`;
    }
    return measurement;
  };
}
