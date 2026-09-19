import { asTemplateId, asTraceId, asSpanId } from "../identifiers/identifiers";
import type { MosaicTelemetryEvent } from "./event";
import type { MosaicTelemetrySink } from "./sink";
import { emitTemplateLog } from "./emit";

function makeCapturingSink(): {
  sink: MosaicTelemetrySink;
  events: MosaicTelemetryEvent[];
} {
  const events: MosaicTelemetryEvent[] = [];
  return {
    events,
    sink: { emit: (e) => events.push(e) },
  };
}

const TID = asTemplateId("@m0saic/test/dummy/v1");

describe("emitTemplateLog", () => {
  it("constructs a well-formed template_log envelope with defaults", () => {
    const { sink, events } = makeCapturingSink();
    emitTemplateLog({ telemetry: sink }, {
      templateId: TID,
      message: "hello",
    });

    expect(events.length).toBe(1);
    const e = events[0];
    expect(e.tier).toBe("template");
    expect(e.level).toBe("info");
    expect(e.category).toBe("engine.template");
    expect(e.kind).toBe("template_log");
    // Sentinel correlation values until ctx wires real ones.
    expect(String(e.traceId)).toBe("unwired");
    expect(String(e.spanId)).toBe("unwired");
    expect(typeof e.timestamp).toBe("number");
    if (e.kind === "template_log") {
      expect(e.payload).toEqual({
        templateId: TID,
        message: "hello",
        data: undefined,
      });
    }
  });

  it("forwards data, level, and explicit correlation ids", () => {
    const { sink, events } = makeCapturingSink();
    emitTemplateLog({ telemetry: sink }, {
      templateId: TID,
      message: "track selected",
      level: "warn",
      data: { event: "track_selected", rule: "language-match", trackIndex: 3 },
      traceId: asTraceId("trace-xyz"),
      spanId: asSpanId("span-1"),
      parentSpanId: asSpanId("span-0"),
    });

    expect(events.length).toBe(1);
    const e = events[0];
    expect(e.level).toBe("warn");
    expect(String(e.traceId)).toBe("trace-xyz");
    expect(String(e.spanId)).toBe("span-1");
    expect(String(e.parentSpanId)).toBe("span-0");
    if (e.kind === "template_log") {
      expect(e.payload.data).toEqual({
        event: "track_selected",
        rule: "language-match",
        trackIndex: 3,
      });
    }
  });

  it("is safe when ctx is undefined (uses no-op sink)", () => {
    expect(() =>
      emitTemplateLog(undefined, { templateId: TID, message: "x" }),
    ).not.toThrow();
  });

  it("is safe when ctx.telemetry is undefined", () => {
    expect(() =>
      emitTemplateLog({}, { templateId: TID, message: "x" }),
    ).not.toThrow();
  });

  it("stamps a fresh timestamp on each emit", async () => {
    const { sink, events } = makeCapturingSink();
    emitTemplateLog({ telemetry: sink }, { templateId: TID, message: "first" });
    await new Promise((r) => setTimeout(r, 5));
    emitTemplateLog({ telemetry: sink }, { templateId: TID, message: "second" });
    expect(events.length).toBe(2);
    expect(events[1].timestamp).toBeGreaterThanOrEqual(events[0].timestamp);
  });
});
