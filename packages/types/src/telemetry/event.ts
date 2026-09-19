import type { StableKey } from "@m0saic/dsl";
import type {
  OutputKey,
  SpanId,
  TemplateId,
  TraceId,
} from "../identifiers/identifiers";
import type { MosaicTelemetryCategory } from "./category";
import type {
  FfmpegBoundaryTelemetryLevel,
  FfmpegTelemetryLevel,
  M0saicTelemetryLevel,
  MosaicTelemetryTier,
  TemplateTelemetryLevel,
} from "./level";

/**
 * Correlation metadata stamped on every {@link MosaicTelemetryEvent}.
 *
 * `traceId` correlates everything within a single logical render
 * (template phase → plan phase → runtime phase → outer batch). The
 * trace is the unit of "one render". `spanId` names this specific
 * event; `parentSpanId` walks up the hierarchy.
 *
 * `timestamp` is `Date.now()` (epoch ms).
 *
 * `tier` partitions the event into the m0saic / ffmpeg-boundary /
 * ffmpeg audience layer. Each tier has its own valid `level` union
 * (see {@link MosaicTelemetryTier} doc). The event union below
 * intersects each variant with the appropriate tier envelope, so
 * narrowing on `kind` also narrows `tier` and `level` in one step.
 */
type CorrelationFields = {
  traceId: TraceId;
  spanId: SpanId;
  parentSpanId?: SpanId;
  timestamp: number;
  category: MosaicTelemetryCategory;
};

type M0saicEnvelope = CorrelationFields & {
  tier: "m0saic";
  level: M0saicTelemetryLevel;
};

type TemplateEnvelope = CorrelationFields & {
  tier: "template";
  level: TemplateTelemetryLevel;
};

type FfmpegBoundaryEnvelope = CorrelationFields & {
  tier: "ffmpeg-boundary";
  level: FfmpegBoundaryTelemetryLevel;
};

type FfmpegEnvelope = CorrelationFields & {
  tier: "ffmpeg";
  level: FfmpegTelemetryLevel;
};

/**
 * Discriminated envelope union — `tier` is the outer discriminator.
 *
 * Exported for callers that need to write generic event-envelope
 * helpers (NDJSON serializers, IPC bridges) without naming every
 * `kind`. The full event union {@link MosaicTelemetryEvent} below
 * intersects this with the per-kind payload shapes.
 */
export type MosaicTelemetryEventBase =
  | M0saicEnvelope
  | TemplateEnvelope
  | FfmpegBoundaryEnvelope
  | FfmpegEnvelope;

// ─────────────────────────────────────────────────────────────────────
// Runtime payload aliases (m0saic-tier engine progress)
//
// These are the engine's *own* view of the render: how many commands,
// where the cursor is, what the weighted overall fraction is. NOT the
// raw ffmpeg output — that lives in the `ffmpeg_*` kinds below.
// ─────────────────────────────────────────────────────────────────────

export type RuntimeRenderStartPayload = {
  totalCommands: number;
  finalOutput: string;
  estimatedMs: number;
  /** Per-command weights, index-aligned with command order. */
  weights?: number[];
  /**
   * Version of the cost model that produced `estimatedMs` / `weights`
   * (v2 = the calibrated renderCostModel; absent = v1 heuristic).
   * Telemetry backtests segment prediction accuracy on this.
   */
  costModelVersion?: number;
  /**
   * Per-machine speed correction the host applied to `estimatedMs`
   * (rolling median of actual/predicted from telemetry history).
   * Absent when 1 (no correction).
   */
  machineFactor?: number;
  /**
   * Reference-machine unit sums at factor 1 (cost-model v3): setup =
   * spawn/graph-init/per-input costs paid once per command; slope =
   * per-frame costs. Persisted into render records so the two-factor
   * machine calibration (setupFactor/slopeFactor) can regress against
   * them — a single scalar cannot model hardware whose per-command
   * overhead and per-frame throughput diverge (15W laptops: ~7× vs ~1.2×).
   */
  predictedSetupUnits?: number;
  predictedSlopeUnits?: number;
  /** Per-command frameKeys, index-aligned with command order. */
  commandFrameKeys?: (StableKey[] | undefined)[];
  /**
   * Optional stage marker. Hosts emit multiple `render_start` events
   * when a render is composed of more than one ffmpeg pass — e.g.
   * `"render"` (the user's template) followed by `"stamp"` (the
   * free-tier QR watermark wrap). The UI uses this to keep the
   * progress strip continuous and to show stage-specific affordances
   * (e.g. "Stamping QR — upgrade to skip"). Absent on single-stage
   * renders.
   */
  stage?: string;
  /**
   * Optional m0 string describing the stage's geometry. When a
   * follow-up stage (e.g. the QR stamp pass) has different geometry
   * than the user's template, the UI swaps the layout canvas to
   * reflect it — the user SEES the watermark cell being added.
   * Absent on single-stage renders.
   */
  stageM0?: string;
  /**
   * Canvas dimensions the stage's `stageM0` is authored against, in px. The
   * stamp pass runs on the ALREADY-RENDERED output, whose aspect can differ
   * from the user's Make-page dims (e.g. a portrait pipeline output stamped
   * with a corner QR). The UI must parse `stageM0` at THESE dims, not the
   * Make dims, or the preview geometry is wrong. Absent on single-stage renders.
   */
  stageWidth?: number;
  stageHeight?: number;
};

export type RuntimeCommandStartPayload = {
  index: number;
  total: number;
  /**
   * Minimal command identity — node + description only. The FULL
   * args list + workspace sidecars are emitted separately as
   * {@link FfmpegInvocationPayload} (tier=ffmpeg-boundary) so callers
   * can subscribe to the replay-anchor stream without the m0saic
   * progress chatter.
   */
  cmd: {
    node: string;
    description?: string;
    kind?: string;
    outputPath?: string;
  };
  /** Relative cost of this command in the plan (used for weighted progress). */
  weight?: number;
  /** Expected output duration in ms (when known). */
  targetMs?: number;
  /** Mirrored from `ProcessCommand.frameKeys`. */
  frameKeys?: StableKey[];
  /** Mirrored from `ProcessCommand.cursorFrameKeys`. */
  cursorFrameKeys?: StableKey[];
};

export type RuntimeCommandProgressPayload = {
  index: number;
  total: number;
  /** 0..1 fraction within the current command (from ffmpeg out_time_ms / targetMs). */
  cmdFrac: number;
  /** 0..1 weighted overall progress across the whole plan. Monotonic. */
  overallFrac: number;
  /** ffmpeg out_time_ms (microseconds output produced so far). */
  outTimeMs?: number;
  /** Expected output duration in ms (mirrored from command_start for convenience). */
  targetMs?: number;
  /** ffmpeg speed= multiplier. */
  speed?: number;
  /** ffmpeg frame= count. */
  frame?: number;
  /** ffmpeg fps= encoder rate. */
  fps?: number;
  /** ffmpeg q= quantizer. */
  q?: number;
  /** ffmpeg total_size= output bytes so far. */
  totalSizeBytes?: number;
  /** Estimated remaining ms for the whole plan. */
  etaMs?: number;
};

/**
 * Kind of an ffmpeg failure, as classified by `classifyFfmpegFailure`
 * (`@m0saic/types/telemetry/ffmpegFailure`). The classification rides the
 * `command_end` event (see {@link RuntimeCommandEndPayload.failure}) so every
 * consumer — electron report sidecar, the render-hero hook, the CLI, the jobs
 * runner — shares ONE verdict instead of each re-deriving (or never deriving)
 * it. Kept here in `@m0saic/types` because it's a cross-process contract AND
 * the classifier logic itself lives here (browser-safe, no core dependency);
 * core re-exports it via a thin shim (`runtime/ffmpegFailure.ts`).
 */
export type FfmpegFailureKind =
  | "thread-exhaustion"
  | "link-queue-buffer-overflow"
  | "out-of-memory"
  | "no-space"
  | "killed"
  | "ffmpeg-crash"
  | "missing-input"
  | "missing-codec"
  | "filter-graph-invalid"
  | "stalled"
  | "unknown";

export type FfmpegFailureClassification = {
  kind: FfmpegFailureKind;
  /** One-line human-readable summary suitable for an error banner. */
  summary: string;
  /** Concrete next steps for the operator, ordered by likely usefulness. */
  hints: string[];
  /** Why this kind was picked — useful for telemetry / debugging the rules. */
  matchedSignal?: string;
};

export type RuntimeCommandEndPayload = {
  index: number;
  total: number;
  exitCode: number;
  elapsedMs: number;
  /**
   * Full buffered stderr from the just-completed command, when the
   * runtime captured it. The streaming line-by-line view lives in
   * {@link FfmpegStderrPayload} (tier=ffmpeg).
   */
  stderr?: string;
  /**
   * Failure classification, attached by `runPlan` when a command exits
   * non-zero (and wasn't cancelled). Computed ONCE in core with the fuse
   * signal derived from the FINAL rewritten argv, so consumers don't
   * re-classify (or miss it). Absent on success and on hosts/replays that
   * predate this field — consumers fall back to their local classifier.
   */
  failure?: FfmpegFailureClassification;
  /**
   * True when the runner's progress-stall watchdog killed the command
   * (no `-progress` block and no stderr for the stall window). The exit
   * code is non-zero and `stderr` ends with the `[m0saic] FFMPEG_STALLED:`
   * marker line; `failure.kind` is `"stalled"`. Hosts surface it as the
   * `FFMPEG_STALLED` report error.
   */
  stalled?: boolean;
  cmd?: {
    node: string;
    description?: string;
  };
};

export type RuntimeRenderCancelledPayload = {
  index: number;
  total: number;
  elapsedMs: number;
};

export type RuntimeRenderEndPayload = {
  exitCode: number;
  elapsedMs: number;
  finalOutput: string;
  workspaceDir?: string;
};

// ─────────────────────────────────────────────────────────────────────
// Resolver payload aliases (`.mosaicx` → `.mosaic` phase)
//
// Emitted by `resolveMosaicx` in `@m0saic/core/runtime` as it walks
// the `template_invocation` sources of a {@link MosaicXDocument} and
// materializes each into a child renderable. Tier is `m0saic`
// (engine-internal narration of the resolve phase); per-template
// progress narration during the actual `template.render()` call is
// the template's own `template_log` business.
//
// Lifecycle on a single resolve:
//
//   resolve_start  { totalInvocations: N }
//     ├─ invocation_start  { invocationId: a, templateId, sourcePath }
//     ├─ (optional) invocation_progress  { invocationId: a, ... }
//     ├─ invocation_end    { invocationId: a, ok: true }
//     ├─ invocation_start  { invocationId: b, ... }
//     ├─ invocation_end    { invocationId: b, ok: false, error: "..." }
//     └─ ...
//   resolve_end  { ok: true, totalInvocations: N, failedInvocations: 1 }
//
// The hero correlates render events back to their source invocation
// via `invocationId` (also stamped on `editor.provenance` of the
// materialized child doc).
// ─────────────────────────────────────────────────────────────────────

export type ResolveStartPayload = {
  /**
   * Number of `template_invocation` sources discovered in deterministic
   * preorder (the order the resolver will process them). Includes nested
   * mosaicx invocations encountered through depth-capped recursion.
   */
  totalInvocations: number;
  /** Optional depth-cap echoed back for UI clarity. */
  maxDepth?: number;
};

export type ResolveInvocationStartPayload = {
  /** Resolver-stamped, stable per invocation. */
  invocationId: string;
  templateId: TemplateId;
  templateVersion?: number;
  /** Dotted path into the source `.mosaicx` (e.g. `"sources[2]"`). */
  sourcePath?: string;
  /** Position in the deterministic preorder walk (0-indexed). */
  index: number;
  total: number;
};

export type ResolveInvocationProgressPayload = {
  invocationId: string;
  /** 0..1 fraction within this invocation, when known. */
  pct?: number;
  /** Free-form short label (e.g. "fetching scenes", "concat 4/12"). */
  label?: string;
};

export type ResolveInvocationEndPayload = {
  invocationId: string;
  templateId: TemplateId;
  ok: boolean;
  /** Elapsed time spent inside `template.render()` for this invocation. */
  elapsedMs: number;
  /** When `ok=false`, the error message (also stamped on the child's `engine.renderError`). */
  error?: string;
  /**
   * Kind of renderable the template returned. Lets consumers visualize
   * downstream pipeline materialization differently from a flat doc.
   */
  resultKind?:
    | "mosaic_document"
    | "mosaic_pipeline"
    | "mosaicx_document"
    | "mosaicx_pipeline";
};

export type ResolveEndPayload = {
  ok: boolean;
  /** Same count `resolve_start` reported, for sanity-check parity. */
  totalInvocations: number;
  /** Subset of total that failed (resolver continues past errors when allowed). */
  failedInvocations: number;
  /** Wall-clock ms across the whole resolve phase. */
  elapsedMs: number;
};

// ─────────────────────────────────────────────────────────────────────
// Ffmpeg-boundary payload aliases (replay anchors)
//
// What you'd need to re-run the render without m0saic in the loop:
// the full ffmpeg argv per command, and every sidecar file written
// to the workspace.
// ─────────────────────────────────────────────────────────────────────

export type FfmpegInvocationPayload = {
  index: number;
  total: number;
  /** Node id (matches `RuntimeCommandStartPayload.cmd.node`). */
  node: string;
  /** The binary that will be spawned (typically `"ffmpeg"`). */
  executable: string;
  /**
   * Full argv as it will be passed to `spawn`. Together with `node`
   * and any companion `ffmpeg_workspace_file` events, this is the
   * canonical replay record for this command.
   */
  args: string[];
  /**
   * Working directory the child will spawn in (the temp workspace).
   * Workspace-relative paths in `args` resolve here.
   */
  cwd?: string;
  /**
   * Output the command will write to, if known.
   */
  outputPath?: string;
};

export type FfmpegWorkspaceFilePayload = {
  index: number;
  total: number;
  /** Node id this sidecar belongs to. */
  node: string;
  /** Workspace-relative path the file is being written to. */
  path: string;
  /**
   * File contents — UTF-8. Sidecars are typically small filtergraph
   * scripts (`.ffgraph`), so embedding them in the event is
   * acceptable. A future variant could carry just a hash for very
   * large sidecars; not needed today.
   */
  contents: string;
};

// ─────────────────────────────────────────────────────────────────────
// Ffmpeg-tier payload alias (raw output from the child)
// ─────────────────────────────────────────────────────────────────────

export type FfmpegStderrPayload = {
  index: number;
  total: number;
  /** Node id the stderr belongs to. */
  node: string;
  /**
   * Stderr lines as they arrive (batched ~50ms in the runtime to
   * amortize IPC). Each emit carries one or more lines; the
   * per-event `level` reflects the highest severity ffmpeg-parsed
   * level among `lines` (Phase 1 emits default to `"info"` since
   * the line parser isn't wired yet — Phase 2 will classify).
   */
  lines: string[];
};

// ─────────────────────────────────────────────────────────────────────
// Template-tier payload alias (template-emitted free-form events)
//
// Templates that want richer instrumentation than the engine's
// own narration can emit at this tier. Phase 1 ships a single
// free-form `template_log` kind — message + optional data object —
// so templates don't have to declare per-template event kinds in
// `@m0saic/types`. A future phase could add typed template-specific
// event registries on top.
// ─────────────────────────────────────────────────────────────────────

export type TemplateLogPayload = {
  /**
   * Template that emitted the event. Same value as
   * `MosaicTemplate.id` — lets consumers attribute events back to
   * source code without needing parent-span lookup.
   */
  templateId: TemplateId;
  /**
   * Human-readable narrative. Keep it short; large structured
   * payloads belong in `data`.
   */
  message: string;
  /**
   * Optional structured data — template-author-defined shape. JSON-
   * serializable values only (string / number / boolean / null /
   * array / plain object). Buffers, functions, and circular
   * references will break NDJSON sinks downstream.
   */
  data?: Record<string, unknown>;
};

// ─────────────────────────────────────────────────────────────────────
// MosaicTelemetryEvent — discriminated union on `kind`.
//
// Each variant statically picks its tier via intersection with the
// appropriate envelope. `switch (e.kind)` narrows tier + level along
// with payload in one step.
// ─────────────────────────────────────────────────────────────────────

export type MosaicTelemetryEvent =
  // ─── m0saic tier: engine plumbing ────────────────────────────────
  | (M0saicEnvelope & {
      kind: "template_start";
      templateId: TemplateId;
      outputKey?: OutputKey;
    })
  | (M0saicEnvelope & {
      kind: "template_end";
      templateId: TemplateId;
      durationMs: number;
      ok: boolean;
    })
  | (M0saicEnvelope & {
      kind: "plan_phase_start";
      phase: "flatten" | "weigh" | "schedule";
    })
  | (M0saicEnvelope & {
      kind: "plan_phase_end";
      phase: "flatten" | "weigh" | "schedule";
      durationMs: number;
    })
  | (M0saicEnvelope & {
      kind: "runtime_render_start";
      payload: RuntimeRenderStartPayload;
    })
  | (M0saicEnvelope & {
      kind: "runtime_command_start";
      payload: RuntimeCommandStartPayload;
    })
  | (M0saicEnvelope & {
      kind: "runtime_command_progress";
      payload: RuntimeCommandProgressPayload;
    })
  | (M0saicEnvelope & {
      kind: "runtime_command_end";
      payload: RuntimeCommandEndPayload;
    })
  | (M0saicEnvelope & {
      kind: "runtime_render_cancelled";
      payload: RuntimeRenderCancelledPayload;
    })
  | (M0saicEnvelope & {
      kind: "runtime_render_end";
      payload: RuntimeRenderEndPayload;
    })
  | (M0saicEnvelope & {
      kind: "resolve_start";
      payload: ResolveStartPayload;
    })
  | (M0saicEnvelope & {
      kind: "resolve_invocation_start";
      payload: ResolveInvocationStartPayload;
    })
  | (M0saicEnvelope & {
      kind: "resolve_invocation_progress";
      payload: ResolveInvocationProgressPayload;
    })
  | (M0saicEnvelope & {
      kind: "resolve_invocation_end";
      payload: ResolveInvocationEndPayload;
    })
  | (M0saicEnvelope & {
      kind: "resolve_end";
      payload: ResolveEndPayload;
    })
  | (M0saicEnvelope & {
      kind: "batch_run_start";
      runId: string;
      jobId: string;
    })
  | (M0saicEnvelope & {
      kind: "batch_run_end";
      runId: string;
      jobId: string;
      exitCode: number;
      durationMs: number;
    })
  | (M0saicEnvelope & {
      kind: "set_start";
      setId: string;
    })
  | (M0saicEnvelope & {
      kind: "set_end";
      setId: string;
      durationMs: number;
      ok: boolean;
    })
  // ─── template tier: template-emitted rich events ────────────────
  | (TemplateEnvelope & {
      kind: "template_log";
      payload: TemplateLogPayload;
    })
  // ─── ffmpeg-boundary tier: replay anchors ────────────────────────
  | (FfmpegBoundaryEnvelope & {
      kind: "ffmpeg_invocation";
      payload: FfmpegInvocationPayload;
    })
  | (FfmpegBoundaryEnvelope & {
      kind: "ffmpeg_workspace_file";
      payload: FfmpegWorkspaceFilePayload;
    })
  // ─── ffmpeg tier: raw output ─────────────────────────────────────
  | (FfmpegEnvelope & {
      kind: "ffmpeg_stderr";
      payload: FfmpegStderrPayload;
    });

// ─────────────────────────────────────────────────────────────────────
// RenderEvent — legacy projection (kept for back-compat).
//
// Discriminator is `type` (vs `kind`) so existing consumers'
// `switch (e.type)` continues to narrow correctly without a sweep.
// The `command_stderr` legacy variant maps to `ffmpeg_stderr` in the
// telemetry universe.
// ─────────────────────────────────────────────────────────────────────

// Legacy command_stderr payload — identical to FfmpegStderrPayload
// minus the `node` field (the legacy shape carries only index+total+lines).
type LegacyCommandStderrPayload = {
  index: number;
  total: number;
  lines: string[];
};

// Legacy command_start payload — historically carried `executable`
// and `args` inline. The new architecture splits those into
// `ffmpeg_invocation`; the legacy projection drops them since the
// 4+ existing consumers don't read them off the runtime event.
type LegacyCommandStartPayload = Omit<RuntimeCommandStartPayload, "cmd"> & {
  cmd: RuntimeCommandStartPayload["cmd"] & {
    executable?: string;
    args?: string[];
  };
};

export type RenderEvent =
  | ({ type: "render_start" } & RuntimeRenderStartPayload)
  | ({ type: "command_start" } & LegacyCommandStartPayload)
  | ({ type: "command_progress" } & RuntimeCommandProgressPayload)
  | ({ type: "command_stderr" } & LegacyCommandStderrPayload)
  | ({ type: "command_end" } & RuntimeCommandEndPayload)
  | ({ type: "render_cancelled" } & RuntimeRenderCancelledPayload)
  | ({ type: "render_end" } & RuntimeRenderEndPayload);

export type RenderEventSink = (e: RenderEvent) => void;

// ─────────────────────────────────────────────────────────────────────
// projectRenderEvent — extract the legacy RenderEvent projection from
// a MosaicTelemetryEvent, when applicable.
//
// Returns undefined for non-runtime kinds (template_*, plan_phase_*,
// batch_*, set_*, ffmpeg_invocation, ffmpeg_workspace_file).
// Ffmpeg-tier `ffmpeg_stderr` projects to legacy `command_stderr`.
// ─────────────────────────────────────────────────────────────────────

export function projectRenderEvent(
  e: MosaicTelemetryEvent,
): RenderEvent | undefined {
  switch (e.kind) {
    case "runtime_render_start":
      return { type: "render_start", ...e.payload };
    case "runtime_command_start":
      return { type: "command_start", ...e.payload };
    case "runtime_command_progress":
      return { type: "command_progress", ...e.payload };
    case "runtime_command_end":
      return { type: "command_end", ...e.payload };
    case "runtime_render_cancelled":
      return { type: "render_cancelled", ...e.payload };
    case "runtime_render_end":
      return { type: "render_end", ...e.payload };
    case "ffmpeg_stderr":
      // Legacy `command_stderr` carried index+total+lines and not
      // `node`; drop the latter on projection.
      return {
        type: "command_stderr",
        index: e.payload.index,
        total: e.payload.total,
        lines: e.payload.lines,
      };
    default:
      return undefined;
  }
}
