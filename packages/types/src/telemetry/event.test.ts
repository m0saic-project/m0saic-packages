import {
  asOutputKey,
  asSpanId,
  asTemplateId,
  asTraceId,
} from "../identifiers/identifiers";
import { projectRenderEvent, type MosaicTelemetryEvent } from "./event";

const TRACE = asTraceId("550e8400-e29b-41d4-a716-446655440000");
const SPAN = asSpanId("00000000-0000-4000-8000-000000000001");
const TS = 1_700_000_000_000;

// Per-tier minimal-valid event factories — keep the test fixtures
// readable and let TypeScript verify each kind picks the right tier.

const m0saicBase = (level: "info" | "warn" | "error" = "info") => ({
  traceId: TRACE,
  spanId: SPAN,
  timestamp: TS,
  tier: "m0saic" as const,
  level,
  category: "engine.runtime" as const,
});

const templateBase = (level: "trace" | "info" | "warn" | "error" = "info") => ({
  traceId: TRACE,
  spanId: SPAN,
  timestamp: TS,
  tier: "template" as const,
  level,
  category: "engine.template" as const,
});

const boundaryBase = () => ({
  traceId: TRACE,
  spanId: SPAN,
  timestamp: TS,
  tier: "ffmpeg-boundary" as const,
  level: "info" as const,
  category: "engine.runtime" as const,
});

const ffmpegBase = (level: "trace" | "info" | "warn" | "error" = "info") => ({
  traceId: TRACE,
  spanId: SPAN,
  timestamp: TS,
  tier: "ffmpeg" as const,
  level,
  category: "engine.runtime" as const,
});

describe("MosaicTelemetryEvent discriminator", () => {
  it("narrows exhaustively on `kind`", () => {
    const samples: MosaicTelemetryEvent[] = [
      // m0saic tier
      { ...m0saicBase(), category: "engine.template", kind: "template_start", templateId: asTemplateId("@m0saic/test/v1") },
      { ...m0saicBase(), category: "engine.template", kind: "template_end", templateId: asTemplateId("@m0saic/test/v1"), durationMs: 12, ok: true },
      { ...m0saicBase(), category: "engine.plan", kind: "plan_phase_start", phase: "flatten" },
      { ...m0saicBase(), category: "engine.plan", kind: "plan_phase_end", phase: "flatten", durationMs: 3 },
      { ...m0saicBase(), kind: "runtime_render_start", payload: { totalCommands: 1, finalOutput: "out.mp4", estimatedMs: 100 } },
      { ...m0saicBase(), kind: "runtime_command_start", payload: { index: 0, total: 1, cmd: { node: "root" } } },
      { ...m0saicBase(), kind: "runtime_command_progress", payload: { index: 0, total: 1, cmdFrac: 0.5, overallFrac: 0.5 } },
      { ...m0saicBase(), kind: "runtime_command_end", payload: { index: 0, total: 1, exitCode: 0, elapsedMs: 200 } },
      { ...m0saicBase("warn"), kind: "runtime_render_cancelled", payload: { index: 0, total: 1, elapsedMs: 50 } },
      { ...m0saicBase(), kind: "runtime_render_end", payload: { exitCode: 0, elapsedMs: 250, finalOutput: "out.mp4" } },
      { ...m0saicBase(), category: "engine.resolve", kind: "resolve_start", payload: { totalInvocations: 2, maxDepth: 3 } },
      { ...m0saicBase(), category: "engine.resolve", kind: "resolve_invocation_start", payload: { invocationId: "inv-a", templateId: asTemplateId("@m0saic/test/v1"), sourcePath: "sources[0]", index: 0, total: 2 } },
      { ...m0saicBase(), category: "engine.resolve", kind: "resolve_invocation_progress", payload: { invocationId: "inv-a", pct: 0.5, label: "fetching scenes" } },
      { ...m0saicBase(), category: "engine.resolve", kind: "resolve_invocation_end", payload: { invocationId: "inv-a", templateId: asTemplateId("@m0saic/test/v1"), ok: true, elapsedMs: 42, resultKind: "mosaic_document" } },
      { ...m0saicBase(), category: "engine.resolve", kind: "resolve_end", payload: { ok: true, totalInvocations: 2, failedInvocations: 0, elapsedMs: 99 } },
      { ...m0saicBase(), category: "platform.jobs", kind: "batch_run_start", runId: "r1", jobId: "j1" },
      { ...m0saicBase(), category: "platform.jobs", kind: "batch_run_end", runId: "r1", jobId: "j1", exitCode: 0, durationMs: 1234 },
      { ...m0saicBase(), category: "platform.sets", kind: "set_start", setId: "s1" },
      { ...m0saicBase(), category: "platform.sets", kind: "set_end", setId: "s1", durationMs: 5000, ok: true },

      // template tier
      {
        ...templateBase("trace"),
        kind: "template_log",
        payload: {
          templateId: asTemplateId("@m0saic/test/v1"),
          message: "fetched 12 commits",
          data: { count: 12, repo: "example/example" },
        },
      },

      // ffmpeg-boundary tier
      {
        ...boundaryBase(),
        kind: "ffmpeg_invocation",
        payload: { index: 0, total: 1, node: "root", executable: "ffmpeg", args: ["-y", "-i", "x.mp4"] },
      },
      {
        ...boundaryBase(),
        kind: "ffmpeg_workspace_file",
        payload: { index: 0, total: 1, node: "root", path: "ffgraph/root.ffgraph", contents: "[0:v]copy[out]" },
      },

      // ffmpeg tier
      {
        ...ffmpegBase("trace"),
        kind: "ffmpeg_stderr",
        payload: { index: 0, total: 1, node: "root", lines: ["[libx264 @ 0x...] using SAR=1/1"] },
      },
    ];

    const seen = new Set<string>();
    for (const e of samples) {
      switch (e.kind) {
        case "template_start":
        case "template_end":
        case "plan_phase_start":
        case "plan_phase_end":
        case "runtime_render_start":
        case "runtime_command_start":
        case "runtime_command_progress":
        case "runtime_command_end":
        case "runtime_render_cancelled":
        case "runtime_render_end":
        case "resolve_start":
        case "resolve_invocation_start":
        case "resolve_invocation_progress":
        case "resolve_invocation_end":
        case "resolve_end":
        case "batch_run_start":
        case "batch_run_end":
        case "set_start":
        case "set_end":
        case "template_log":
        case "ffmpeg_invocation":
        case "ffmpeg_workspace_file":
        case "ffmpeg_stderr":
          seen.add(e.kind);
          break;
        default: {
          const _exhaustive: never = e;
          void _exhaustive;
        }
      }
    }
    expect(seen.size).toBe(samples.length);
  });

  it("kind narrowing also narrows tier (compile-time check)", () => {
    // The body of this test is the type system. The runtime assertion
    // just confirms the file ran.
    const e: MosaicTelemetryEvent = {
      ...boundaryBase(),
      kind: "ffmpeg_invocation",
      payload: { index: 0, total: 1, node: "root", executable: "ffmpeg", args: [] },
    };

    if (e.kind === "ffmpeg_invocation") {
      // After narrowing, tier MUST be "ffmpeg-boundary" and level MUST be "info".
      const tier: "ffmpeg-boundary" = e.tier;
      const level: "info" = e.level;
      expect(tier).toBe("ffmpeg-boundary");
      expect(level).toBe("info");
    }

    const m: MosaicTelemetryEvent = { ...m0saicBase("warn"), kind: "plan_phase_start", phase: "flatten", category: "engine.plan" };
    if (m.kind === "plan_phase_start") {
      // m0saic-tier narrowing forbids "trace"
      const lvl: "info" | "warn" | "error" = m.level;
      expect(lvl).toBe("warn");
    }

    const t: MosaicTelemetryEvent = {
      ...templateBase("trace"),
      kind: "template_log",
      payload: {
        templateId: asTemplateId("@m0saic/test/v1"),
        message: "trace event",
      },
    };
    if (t.kind === "template_log") {
      // template-tier narrowing admits "trace" — separate from m0saic.
      const tier: "template" = t.tier;
      const lvl: "trace" | "info" | "warn" | "error" = t.level;
      expect(tier).toBe("template");
      expect(lvl).toBe("trace");
    }
  });
});

describe("projectRenderEvent", () => {
  it("projects runtime_* kinds into legacy RenderEvent shape", () => {
    const r = projectRenderEvent({
      ...m0saicBase(),
      kind: "runtime_render_start",
      payload: { totalCommands: 2, finalOutput: "out.mp4", estimatedMs: 500 },
    });
    expect(r).toEqual({
      type: "render_start",
      totalCommands: 2,
      finalOutput: "out.mp4",
      estimatedMs: 500,
    });
  });

  it("projects ffmpeg_stderr into legacy command_stderr (drops the new `node` field)", () => {
    const r = projectRenderEvent({
      ...ffmpegBase(),
      kind: "ffmpeg_stderr",
      payload: { index: 1, total: 3, node: "root", lines: ["a", "b"] },
    });
    expect(r).toEqual({
      type: "command_stderr",
      index: 1,
      total: 3,
      lines: ["a", "b"],
    });
  });

  it("projects runtime_command_end carrying a `failure` classification verbatim", () => {
    const failure = {
      kind: "link-queue-buffer-overflow" as const,
      summary: "unbalanced sync filter queued too many frames",
      hints: ["check clip-length mismatches"],
      matchedSignal: "fused command + mid-render ENOMEM signal",
    };
    const r = projectRenderEvent({
      ...m0saicBase("error"),
      kind: "runtime_command_end",
      payload: { index: 0, total: 1, exitCode: -12, elapsedMs: 200, failure },
    });
    expect(r).toEqual({
      type: "command_end",
      index: 0,
      total: 1,
      exitCode: -12,
      elapsedMs: 200,
      failure,
    });
  });

  it("preserves runtime_command_progress payload fields verbatim", () => {
    const r = projectRenderEvent({
      ...m0saicBase(),
      kind: "runtime_command_progress",
      payload: {
        index: 3,
        total: 5,
        cmdFrac: 0.42,
        overallFrac: 0.7,
        outTimeMs: 1_234_000,
        speed: 1.85,
        frame: 124,
        fps: 30,
        q: 23,
        totalSizeBytes: 4096,
        etaMs: 8000,
        targetMs: 5000,
      },
    });
    expect(r).toEqual({
      type: "command_progress",
      index: 3,
      total: 5,
      cmdFrac: 0.42,
      overallFrac: 0.7,
      outTimeMs: 1_234_000,
      speed: 1.85,
      frame: 124,
      fps: 30,
      q: 23,
      totalSizeBytes: 4096,
      etaMs: 8000,
      targetMs: 5000,
    });
  });

  it("returns undefined for non-projectable kinds (template_*, plan_*, batch_*, set_*, ffmpeg_invocation, ffmpeg_workspace_file)", () => {
    const nonProjectable: MosaicTelemetryEvent[] = [
      { ...m0saicBase(), category: "engine.template", kind: "template_start", templateId: asTemplateId("@m0saic/test/v1"), outputKey: asOutputKey("default") },
      { ...m0saicBase(), category: "engine.plan", kind: "plan_phase_start", phase: "weigh" },
      { ...m0saicBase(), category: "platform.jobs", kind: "batch_run_start", runId: "r", jobId: "j" },
      { ...m0saicBase(), category: "platform.sets", kind: "set_start", setId: "s" },
      {
        ...templateBase(),
        kind: "template_log",
        payload: { templateId: asTemplateId("@m0saic/test/v1"), message: "hi" },
      },
      { ...boundaryBase(), kind: "ffmpeg_invocation", payload: { index: 0, total: 1, node: "root", executable: "ffmpeg", args: [] } },
      { ...boundaryBase(), kind: "ffmpeg_workspace_file", payload: { index: 0, total: 1, node: "root", path: "x.ffgraph", contents: "" } },
    ];
    for (const e of nonProjectable) {
      expect(projectRenderEvent(e)).toBeUndefined();
    }
  });
});
