import * as fs from "fs";
import * as path from "path";
import { unpackedAsarPath } from "@m0saic/template-utils/dist/m0saic/assetPath";
import type {
  BenchmarkSet,
  MosaicDocument,
  MosaicEngineContext,
} from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import {
  defineMosaicTemplate,
  definePropsSchema,
  registerTemplate,
} from "@m0saic/template-utils";
import { collectSystemInfo } from "@m0saic/platform/system";
import { BATTERY_SCENARIOS_SUBDIR, BENCHMARK_STANDARD_SETS } from "../../battery/manifest";
import {
  assembleSession,
  AVAILABLE_SETS,
  runScenarios,
  selectScenarios,
} from "./benchmarkRun";
import { makeRealExecutor } from "./renderScenario";
import { buildConfirmationDoc } from "./confirmation";

export type BenchmarkRunProps = {
  /** Which sets to run. Default: every set with shipped workloads. */
  tests?: BenchmarkSet[];
  /** Run label — distinguishes conditions, e.g. "idle" vs "loaded". */
  label?: string;
  /** Where to write the session folder. Default: current working directory. */
  outputDir?: string;
};

const propsSchema = definePropsSchema<BenchmarkRunProps>({
  tests: {
    type: "string[]",
    required: false,
    description: "Which benchmark sets to run. Default: all available.",
    meta: {
      control: {
        multiple: true,
        options: [
          { value: "sources", label: "Sources", description: "One workload per source kind (lavfi, text, nested, ref, video, audio)" },
          { value: "geometry", label: "Geometry", description: "144-cell grid — chunked-stitch path" },
          { value: "duration", label: "Duration", description: "60s render — longest wall-clock" },
          { value: "encoders", label: "Encoders", description: "Same job across software + detected hardware encoders" },
          { value: "real", label: "Real (heavy)", description: "Captured real templates (charts, video grid) at short/medium/long — minutes-long, the truest real-world cost signal" },
          { value: "sloth", label: "Sloth (blowups)", description: "Known complexity blowups (the donut's masked-sweep, ~70min at 30s) — run deliberately on their own; they'd dominate a normal run and flatten the chart" },
        ],
      },
      ui: { label: "Tests", order: 1 },
    },
  },
  label: {
    type: "string",
    required: false,
    description:
      "Run condition — names the session folder and labels the shareable result, so machines compare like-for-like.",
    meta: {
      control: {
        options: [
          { value: "idle", label: "Idle", description: "Nothing else running — the clean baseline" },
          { value: "loaded", label: "Loaded", description: "Browser + apps open, like a working machine" },
          { value: "gaming", label: "Gaming", description: "A game running alongside the render" },
          { value: "dedicated", label: "Dedicated render", description: "A render-only rig with nothing else competing" },
        ],
      },
      ui: { label: "Label", order: 2 },
    },
  },
  outputDir: {
    type: "string",
    required: false,
    description: "Folder to write the benchmark session into. Default: current directory.",
    meta: {
      control: { placeholder: "current working directory", picker: "folder" },
      ui: { label: "Output dir", order: 3 },
    },
  },
});

// Default to the STANDARD tier — a quick run. The `real` (heavy) tier is
// minutes-long, so it's opt-in via the Tests selection.
const DEFAULTS: BenchmarkRunProps = { tests: BENCHMARK_STANDARD_SETS, label: "idle" };

function slug(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "run";
}

/** Resolve the requested sets, defaulting to the standard tier; drop unknowns. */
function resolveTests(props: BenchmarkRunProps): BenchmarkSet[] {
  const raw = props.tests ?? BENCHMARK_STANDARD_SETS;
  return raw.filter((t) => (AVAILABLE_SETS as string[]).includes(t as string));
}

/**
 * The lightweight stand-in shown on preview / design hot paths (and as a guard
 * if render() is ever invoked in design mode). It describes what pressing Make
 * will do — it performs NO side effects (no subprocess, no fs writes).
 */
function buildLiteDoc(
  props: BenchmarkRunProps,
  ctx: MosaicEngineContext,
): MosaicDocument {
  const tests = resolveTests(props);
  if (tests.length === 0) {
    return buildConfirmationDoc({
      titleLine: "m0saic benchmark",
      subLine:
        "Select test sets (sources, geometry, duration, encoders), then press Make to run",
      ctx,
    });
  }
  const count = selectScenarios(tests, []).length;
  return buildConfirmationDoc({
    titleLine: "m0saic benchmark — press Make to run",
    subLine: `${tests.join(", ")} · ${count}+ workloads · writes ./benchmark-${slug(
      (props.label ?? "run").trim() || "run",
    )}/benchmark.json`,
    ctx,
  });
}

export const BenchmarkRun = defineMosaicTemplate<BenchmarkRunProps>({
  id: asTemplateId("@m0saic/benchmark/run/v1"),
  label: "Benchmark — Run",
  version: 1,
  description:
    "Measures this machine's render performance: renders a frozen battery of standardized .mosaic workloads (sources, geometry, long-duration, encoder comparison), times each via its --report sidecar, captures host specs, and writes a shareable benchmark.json session folder. Pair with the benchmark report template to render the results video.",
  capabilities: {
    tier: "capability",
    caps: {
      // Spawns `m0saic make` per workload and writes the session folder.
      exec: { spawn: true },
      fs: { read: true, write: true, list: true, temp: true },
    },
  },
  tags: ["developer", "benchmark", "performance", "diagnostics", "capability", "developers", "animated"],
  outputHints: {
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 4000,
    format: { kind: "video", container: "mp4" },
  },
  propsSchema,
  defaultProps: DEFAULTS,
  async render(
    props: BenchmarkRunProps,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    // Preview / design hot path defense-in-depth: never run the battery just
    // because a host rendered us in design mode. Preview hosts should call
    // renderLite() (below), but guard here too in case render() is invoked
    // directly with mode: "design".
    if (ctx.mode === "design") return buildLiteDoc(props, ctx);

    // Omitted → all available sets; an explicit empty array → just the card
    // (used by the E2E suite to avoid running the battery in CI).
    const tests = resolveTests(props);
    const label = (props.label ?? "run").trim() || "run";
    if (tests.length === 0) return buildLiteDoc(props, ctx);

    const systemInfo = collectSystemInfo();
    const scenarios = selectScenarios(tests, systemInfo.ffmpeg.hwEncoders);

    const outputDir = props.outputDir ?? process.cwd();
    const sessionDir = path.join(outputDir, `benchmark-${slug(label)}`);
    // asar-translated: the frozen `.mosaic` scenarios are handed to a spawned
    // `m0saic make` subprocess (see renderScenario), which cannot read inside
    // app.asar. asarUnpack already mirrors them (they live under `assets/`).
    const scenariosDir = unpackedAsarPath(
      path.resolve(__dirname, "..", "..", "battery", BATTERY_SCENARIOS_SUBDIR),
    );

    const exec = makeRealExecutor({
      scenariosDir,
      outDir: path.join(sessionDir, "scenarios"),
      onProgress: (m) => process.stderr.write(`${m}\n`),
    });

    const startedAt = Date.now();
    const { results, versions } = await runScenarios(scenarios, exec);
    const finishedAt = Date.now();

    const session = assembleSession({
      label,
      systemInfo,
      results,
      selectedSets: tests,
      startedAtIso: new Date(startedAt).toISOString(),
      finishedAtIso: new Date(finishedAt).toISOString(),
      elapsedMs: finishedAt - startedAt,
      versions,
    });

    fs.mkdirSync(sessionDir, { recursive: true });
    const jsonPath = path.join(sessionDir, "benchmark.json");
    fs.writeFileSync(jsonPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");

    const okCount = results.filter((r) => r.ok).length;
    process.stderr.write(
      `✅ benchmark "${label}": ${okCount}/${results.length} ok · score ${session.summary.score} → ${jsonPath}\n`,
    );

    return buildConfirmationDoc({
      titleLine: `m0saic benchmark · ${label}`,
      subLine: `${okCount}/${results.length} scenarios · ${Math.round(
        session.summary.totalElapsedMs / 1000,
      )}s · score ${session.summary.score}`,
      ctx,
    });
  },

  // Preview / design hot path: a lightweight instructional card. NO side
  // effects — this is what the editor shows when the template is selected or
  // its props change, so the battery only ever runs on an explicit Make.
  renderLite(props: BenchmarkRunProps, ctx: MosaicEngineContext): MosaicDocument {
    return buildLiteDoc(props, ctx);
  },
});

registerTemplate(BenchmarkRun);
