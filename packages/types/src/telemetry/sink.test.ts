import {
  asSpanId,
  asTemplateId,
  asTraceId,
} from "../identifiers/identifiers";
import type { MosaicTelemetryEvent, RenderEvent } from "./event";
import {
  NOOP_TELEMETRY_SINK,
  byCategory,
  byLevel,
  byTier,
  byTierLevel,
  fanoutSink,
  filterSink,
  getTelemetry,
  renderEventSinkToTelemetrySink,
  type MosaicTelemetrySink,
} from "./sink";
import {
  appViewerPredicate,
  batchOperatorPredicate,
  masochistPredicate,
  ossQuietPredicate,
  templateDevPredicate,
  withPersona,
} from "./personas";
import type { MosaicTelemetryCategory } from "./category";

const TRACE = asTraceId("550e8400-e29b-41d4-a716-446655440000");
const SPAN = asSpanId("00000000-0000-4000-8000-000000000001");
const TS = 1_700_000_000_000;

const m0saicEvent = (
  level: "info" | "warn" | "error" = "info",
  kind: "runtime_command_progress" | "template_start" = "runtime_command_progress",
  category: MosaicTelemetryCategory = "engine.runtime",
): MosaicTelemetryEvent => {
  const base = {
    traceId: TRACE,
    spanId: SPAN,
    timestamp: TS,
    tier: "m0saic" as const,
    level,
    category,
  };
  if (kind === "template_start") {
    return {
      ...base,
      kind: "template_start",
      templateId: asTemplateId("@m0saic/test/v1"),
    };
  }
  return {
    ...base,
    kind: "runtime_command_progress",
    payload: { index: 0, total: 1, cmdFrac: 0.5, overallFrac: 0.5 },
  };
};

const boundaryEvent = (): MosaicTelemetryEvent => ({
  traceId: TRACE,
  spanId: SPAN,
  timestamp: TS,
  tier: "ffmpeg-boundary",
  level: "info",
  category: "engine.runtime",
  kind: "ffmpeg_invocation",
  payload: { index: 0, total: 1, node: "root", executable: "ffmpeg", args: [] },
});

const ffmpegEvent = (
  level: "trace" | "info" | "warn" | "error" = "info",
): MosaicTelemetryEvent => ({
  traceId: TRACE,
  spanId: SPAN,
  timestamp: TS,
  tier: "ffmpeg",
  level,
  category: "engine.runtime",
  kind: "ffmpeg_stderr",
  payload: { index: 0, total: 1, node: "root", lines: ["line"] },
});

const templateEvent = (
  level: "trace" | "info" | "warn" | "error" = "info",
): MosaicTelemetryEvent => ({
  traceId: TRACE,
  spanId: SPAN,
  timestamp: TS,
  tier: "template",
  level,
  category: "engine.template",
  kind: "template_log",
  payload: {
    templateId: asTemplateId("@m0saic/test/v1"),
    message: "template event",
  },
});

describe("NOOP_TELEMETRY_SINK", () => {
  it("accepts any event without throwing", () => {
    expect(() => NOOP_TELEMETRY_SINK.emit(m0saicEvent())).not.toThrow();
    expect(() => NOOP_TELEMETRY_SINK.emit(boundaryEvent())).not.toThrow();
    expect(() => NOOP_TELEMETRY_SINK.emit(ffmpegEvent("trace"))).not.toThrow();
  });
});

describe("filterSink + fanoutSink", () => {
  it("filterSink forwards only admitted events", () => {
    const received: MosaicTelemetryEvent[] = [];
    const filtered = filterSink(
      { emit: (e) => received.push(e) },
      (e) => e.kind === "ffmpeg_invocation",
    );
    filtered.emit(m0saicEvent());
    filtered.emit(boundaryEvent());
    expect(received).toHaveLength(1);
    expect(received[0].kind).toBe("ffmpeg_invocation");
  });

  it("fanoutSink delivers to every inner", () => {
    const a: MosaicTelemetryEvent[] = [];
    const b: MosaicTelemetryEvent[] = [];
    const fan = fanoutSink(
      { emit: (e) => a.push(e) },
      { emit: (e) => b.push(e) },
    );
    fan.emit(m0saicEvent());
    fan.emit(boundaryEvent());
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
  });

  it("fanoutSink isolates a throwing subscriber", () => {
    const ok: MosaicTelemetryEvent[] = [];
    const fan = fanoutSink(
      { emit: () => { throw new Error("boom"); } },
      { emit: (e) => ok.push(e) },
    );
    expect(() => fan.emit(m0saicEvent())).not.toThrow();
    expect(ok).toHaveLength(1);
  });
});

describe("byLevel — cross-tier severity threshold", () => {
  it("admits events at or above the threshold from any tier", () => {
    const warnPlus = byLevel("warn");
    expect(warnPlus(m0saicEvent("info"))).toBe(false);
    expect(warnPlus(m0saicEvent("warn"))).toBe(true);
    expect(warnPlus(m0saicEvent("error"))).toBe(true);
    expect(warnPlus(ffmpegEvent("trace"))).toBe(false);
    expect(warnPlus(ffmpegEvent("info"))).toBe(false);
    expect(warnPlus(ffmpegEvent("warn"))).toBe(true);
    expect(warnPlus(boundaryEvent())).toBe(false); // boundary level is "info"
  });
});

describe("byTier — admit by tier set", () => {
  it("accepts a single tier id", () => {
    const onlyBoundary = byTier("ffmpeg-boundary");
    expect(onlyBoundary(m0saicEvent())).toBe(false);
    expect(onlyBoundary(templateEvent())).toBe(false);
    expect(onlyBoundary(boundaryEvent())).toBe(true);
    expect(onlyBoundary(ffmpegEvent())).toBe(false);
  });

  it("accepts a Set of tiers", () => {
    const m0saicOrTemplate = byTier(
      new Set(["m0saic", "template"] as const),
    );
    expect(m0saicOrTemplate(m0saicEvent())).toBe(true);
    expect(m0saicOrTemplate(templateEvent())).toBe(true);
    expect(m0saicOrTemplate(boundaryEvent())).toBe(false);
    expect(m0saicOrTemplate(ffmpegEvent())).toBe(false);
  });

  it("template tier is filterable independently of m0saic", () => {
    const onlyTemplate = byTier("template");
    expect(onlyTemplate(m0saicEvent())).toBe(false);
    expect(onlyTemplate(templateEvent("trace"))).toBe(true);
  });
});

describe("byTierLevel — per-tier threshold map", () => {
  it("drops tiers omitted from the map", () => {
    const m0saicOnly = byTierLevel({ m0saic: "info" });
    expect(m0saicOnly(m0saicEvent("info"))).toBe(true);
    expect(m0saicOnly(boundaryEvent())).toBe(false);
    expect(m0saicOnly(ffmpegEvent("error"))).toBe(false);
  });

  it("treats `true` as 'admit every level' for that tier", () => {
    const everythingFfmpeg = byTierLevel({ ffmpeg: true });
    expect(everythingFfmpeg(ffmpegEvent("trace"))).toBe(true);
    expect(everythingFfmpeg(ffmpegEvent("error"))).toBe(true);
    expect(everythingFfmpeg(m0saicEvent())).toBe(false);
  });

  it("treats `false` as 'drop this tier entirely'", () => {
    const noFfmpeg = byTierLevel({
      m0saic: "info",
      "ffmpeg-boundary": true,
      ffmpeg: false,
    });
    expect(noFfmpeg(m0saicEvent())).toBe(true);
    expect(noFfmpeg(boundaryEvent())).toBe(true);
    expect(noFfmpeg(ffmpegEvent("error"))).toBe(false);
  });

  it("applies per-tier severity thresholds independently", () => {
    // The canonical batch-operator shape: m0saic narrative + ffmpeg errors only
    const compound = byTierLevel({ m0saic: "info", ffmpeg: "error" });
    expect(compound(m0saicEvent("info"))).toBe(true);
    expect(compound(m0saicEvent("warn"))).toBe(true);
    expect(compound(ffmpegEvent("warn"))).toBe(false);
    expect(compound(ffmpegEvent("error"))).toBe(true);
    expect(compound(boundaryEvent())).toBe(false); // boundary omitted → dropped
  });
});

describe("byCategory", () => {
  it("admits events whose category is in the set", () => {
    const onlyRuntime = byCategory(
      new Set<MosaicTelemetryCategory>(["engine.runtime"]),
    );
    expect(onlyRuntime(m0saicEvent())).toBe(true);
    expect(
      onlyRuntime(m0saicEvent("info", "template_start", "engine.template")),
    ).toBe(false);
  });
});

describe("renderEventSinkToTelemetrySink", () => {
  it("forwards projectable kinds (runtime_* + ffmpeg_stderr) as legacy RenderEvent", () => {
    const received: RenderEvent[] = [];
    const adapter = renderEventSinkToTelemetrySink((e) => received.push(e));
    adapter.emit(m0saicEvent());
    adapter.emit(ffmpegEvent());
    expect(received).toHaveLength(2);
    expect(received[0].type).toBe("command_progress");
    expect(received[1].type).toBe("command_stderr");
  });

  it("drops non-projectable kinds (ffmpeg_invocation, ffmpeg_workspace_file, template_*, plan_*, batch_*, set_*)", () => {
    const received: RenderEvent[] = [];
    const adapter = renderEventSinkToTelemetrySink((e) => received.push(e));
    adapter.emit(boundaryEvent());
    adapter.emit(m0saicEvent("info", "template_start", "engine.template"));
    expect(received).toHaveLength(0);
  });
});

describe("getTelemetry", () => {
  it("returns NOOP when ctx is undefined or has no telemetry", () => {
    expect(getTelemetry(undefined)).toBe(NOOP_TELEMETRY_SINK);
    expect(getTelemetry({})).toBe(NOOP_TELEMETRY_SINK);
  });

  it("returns the provided sink when present", () => {
    const sink: MosaicTelemetrySink = { emit: () => {} };
    expect(getTelemetry({ telemetry: sink })).toBe(sink);
  });
});

describe("persona predicates (tier-aware)", () => {
  it("template-dev admits m0saic + template + boundary in full, but ffmpeg only at warn+", () => {
    const p = templateDevPredicate();
    expect(p(m0saicEvent("info"))).toBe(true);
    expect(p(templateEvent("trace"))).toBe(true);
    expect(p(templateEvent("error"))).toBe(true);
    expect(p(boundaryEvent())).toBe(true);
    // ffmpeg running commentary is dropped — template authors want
    // the contract (inputs + outcomes), not the play-by-play.
    expect(p(ffmpegEvent("trace"))).toBe(false);
    expect(p(ffmpegEvent("info"))).toBe(false);
    expect(p(ffmpegEvent("warn"))).toBe(true);
    expect(p(ffmpegEvent("error"))).toBe(true);
  });

  it("masochist admits literally everything (the disk-target persona)", () => {
    const p = masochistPredicate();
    expect(p(m0saicEvent("info"))).toBe(true);
    expect(p(m0saicEvent("error"))).toBe(true);
    expect(p(templateEvent("trace"))).toBe(true);
    expect(p(templateEvent("error"))).toBe(true);
    expect(p(boundaryEvent())).toBe(true);
    expect(p(ffmpegEvent("trace"))).toBe(true);
    expect(p(ffmpegEvent("info"))).toBe(true);
    expect(p(ffmpegEvent("warn"))).toBe(true);
    expect(p(ffmpegEvent("error"))).toBe(true);
  });

  it("app-viewer admits m0saic info+ / template info+ / all ffmpeg-boundary, drops ffmpeg + template trace", () => {
    const p = appViewerPredicate();
    expect(p(m0saicEvent("info"))).toBe(true);
    expect(p(m0saicEvent("warn"))).toBe(true);
    expect(p(templateEvent("trace"))).toBe(false);
    expect(p(templateEvent("info"))).toBe(true);
    expect(p(boundaryEvent())).toBe(true);
    expect(p(ffmpegEvent("error"))).toBe(false);
    expect(p(ffmpegEvent("trace"))).toBe(false);
  });

  it("batch-operator admits m0saic info+, template warn+, ffmpeg error only; drops ffmpeg-boundary + template info", () => {
    const p = batchOperatorPredicate();
    expect(p(m0saicEvent("info"))).toBe(true);
    expect(p(templateEvent("info"))).toBe(false);
    expect(p(templateEvent("warn"))).toBe(true);
    expect(p(templateEvent("error"))).toBe(true);
    expect(p(boundaryEvent())).toBe(false);
    expect(p(ffmpegEvent("warn"))).toBe(false);
    expect(p(ffmpegEvent("error"))).toBe(true);
  });

  it("oss-quiet admits errors only across every tier, drops ffmpeg-boundary entirely", () => {
    const p = ossQuietPredicate();
    expect(p(m0saicEvent("info"))).toBe(false);
    expect(p(m0saicEvent("error"))).toBe(true);
    expect(p(templateEvent("warn"))).toBe(false);
    expect(p(templateEvent("error"))).toBe(true);
    expect(p(boundaryEvent())).toBe(false);
    expect(p(ffmpegEvent("warn"))).toBe(false);
    expect(p(ffmpegEvent("error"))).toBe(true);
  });

  it("withPersona threads a sink through a persona predicate", () => {
    const received: MosaicTelemetryEvent[] = [];
    const sink = withPersona({ emit: (e) => received.push(e) }, "oss-quiet");
    sink.emit(m0saicEvent("info"));
    sink.emit(m0saicEvent("error"));
    sink.emit(ffmpegEvent("error"));
    sink.emit(templateEvent("error"));
    expect(received).toHaveLength(3);
    expect(received.map((e) => e.tier)).toEqual(["m0saic", "ffmpeg", "template"]);
  });
});
