/**
 * Benchmark session schema — the cross-machine shareable contract.
 *
 * A benchmark *run* produces a session folder whose `benchmark.json` conforms
 * to `BenchmarkSession`. The runner (side-effecting orchestrator) writes it;
 * the packager template (deterministic presentation) reads it to render the
 * standard shareable results video. Because the file is what people post and
 * compare online, it carries an explicit `schemaVersion`.
 *
 * The video shows only high-level numbers; this sidecar holds the rich detail
 * (audience: engineers).
 */

export const BENCHMARK_SESSION_SCHEMA_VERSION = 1 as const;

/**
 * Which set(s) of standardized scenarios a run exercised. Props-selectable on
 * the runner so a user can pick how much to run.
 *
 * - `sources`   — one scenario per source kind (lavfi / text / nested / ref /
 *                 media file / image sequence / audio).
 * - `real`      — a representative spread of existing shipped templates, so the
 *                 benchmark mirrors real-world usage, not just synthetic primitives.
 * - `geometry`  — deep split trees / many cells (the chunked-stitch path).
 * - `duration`  — one long high-cell render (longest wall-clock).
 * - `encoders`  — the same canonical job across software + available hw encoders.
 * - `sloth`     — known complexity blowups (e.g. the donut's masked-sweep, ~70min
 *                 at 30s). Carved out of `real` so one pathological workload
 *                 doesn't dominate the run time or flatten every other bar on the
 *                 results chart. Opt-in, separate tier.
 * - `lifetime`  — the source-lifetime / enable-window-gating workload: a short
 *                 windowed fade inside a long parent, where pre-sprint engines
 *                 pay per-pixel alpha cost on every frame. Measures the
 *                 enable-gating mechanisms' win (heavy tier, opt-in).
 */
export type BenchmarkSet =
  | "sources"
  | "real"
  | "geometry"
  | "duration"
  | "encoders"
  | "sloth"
  | "lifetime";

/**
 * Host machine specs captured at run time. Populated by
 * `collectSystemInfo()` in `@m0saic/platform/system`. Values that cannot be
 * determined degrade to `null` / empty rather than throwing.
 */
export type BenchmarkSystemInfo = {
  cpu: {
    /** CPU model string, e.g. "Apple M1 Max" or "AMD Ryzen 9 7950X". */
    model: string;
    /** Logical core count (`os.cpus().length`). */
    cores: number;
    /** Reported clock in MHz, or `null` when the platform reports 0/unknown. */
    speedMhz: number | null;
  };
  ram: {
    totalBytes: number;
    /** Total RAM rounded to one decimal GB, for display. */
    totalGb: number;
  };
  os: {
    /** `process.platform` value, e.g. "darwin" | "win32" | "linux". */
    platform: string;
    /** `process.arch` value, e.g. "arm64" | "x64". */
    arch: string;
    /** `os.release()` kernel/build string. */
    release: string;
  };
  ffmpeg: {
    found: boolean;
    /** First line of `ffmpeg -version`, or "not found". */
    version: string;
    /** Names of hardware encoders present in this ffmpeg build. */
    hwEncoders: string[];
  };
};

/**
 * One scenario's measured result. `ok: false` rows carry an `error` and null
 * metrics so a single failing scenario never sinks the whole run.
 */
export type BenchmarkScenarioResult = {
  /** Stable scenario id, also the per-scenario output basename. */
  id: string;
  set: BenchmarkSet;
  /**
   * Provenance for `real`-set scenarios: the shipped template id(s) the frozen
   * `.mosaic` workload was *captured from / composed of*. A real workload often
   * nests or stitches several templates, so this is a list, e.g.
   * ["@m0saic/media/screencap_grid/v1", "@m0saic/brand/logo/v3"]. The benchmark
   * renders the frozen file(s), NOT the live templates — this records where the
   * workload came from, not an invocation target. Omitted/empty for synthetic
   * scenarios that aren't derived from any template.
   */
  templateIds?: string[];
  /** Human label shown on the results video. */
  label: string;
  ok: boolean;
  /** Wall-clock of the scenario render (from its `--report` sidecar). */
  elapsedMs: number | null;
  /** Achieved encode rate (frames / elapsedSec), the headline speed number. */
  outFps: number | null;
  frames: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** Target fps the scenario was rendered at. */
  fps: number | null;
  /** Video codec used for the scenario render. */
  codec: string | null;
  error?: string;
};

/**
 * Records which standardized set ran and *which version of its content*.
 *
 * Two independent version axes:
 * - `BenchmarkSession.schemaVersion` versions the JSON *shape* (these fields).
 * - `BenchmarkSetDefinition.version` versions a set's *content* — the specific
 *   frozen `.mosaic` workloads in it (the lavfi/text/... mix, or the captured
 *   snapshots for `real`). The battery is frozen so numbers stay comparable, but
 *   it will evolve. Bump a set's `version` whenever its `.mosaic` files change
 *   (add / remove / swap / recapture) so an older battery is never silently
 *   compared against a newer one.
 *
 * Example: today `real@1` might be a frozen screencap-grid v1 snapshot plus a
 * couple of others; a later `real@2` swaps the mix. Both are valid; consumers
 * compare within a single `(set, version)` pair.
 */
export type BenchmarkSetDefinition = {
  set: BenchmarkSet;
  /** Content version of this set's scenario list (independent of schemaVersion). */
  version: number;
  /** The scenario ids that make up this set at the recorded version. */
  scenarioIds: string[];
};

export type BenchmarkSummary = {
  /** Sum of per-scenario wall-clock. */
  totalElapsedMs: number;
  /** Version of the scoring formula, so scores stay comparable over time. */
  scoreVersion: number;
  /** Simple normalized score (higher = faster). 0 until scoring lands. */
  score: number;
};

export type BenchmarkSession = {
  schemaVersion: typeof BENCHMARK_SESSION_SCHEMA_VERSION;
  /** Free-text run label, e.g. "idle" vs "loaded" (cheeky names welcome). */
  label: string;
  startedAtIso: string;
  finishedAtIso: string;
  elapsedMs: number;
  system: BenchmarkSystemInfo;
  /** Toolchain / package versions snapshot (reuses the CLI `AllVersions` shape). */
  versions?: Record<string, unknown>;
  /**
   * Which sets ran and the content-version of each. Lets a consumer tell a
   * `real@1` battery apart from a later `real@2` even though the JSON shape
   * (`schemaVersion`) is unchanged. See {@link BenchmarkSetDefinition}.
   */
  sets: BenchmarkSetDefinition[];
  scenarios: BenchmarkScenarioResult[];
  summary: BenchmarkSummary;
};
