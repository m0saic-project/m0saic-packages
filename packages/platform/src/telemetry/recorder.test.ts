import type {
  MosaicRenderRecord,
  MosaicRenderReportLike,
  MosaicTelemetrySettingsFile,
  RenderEvent,
} from "@m0saic/types";
import {
  asInstallId,
  asTemplateId,
  defaultTelemetrySettings,
  emitTemplateLog,
} from "@m0saic/types";
import { createRenderRecorder } from "./recorder";

const INSTALL = asInstallId("550e8400-e29b-41d4-a716-446655440000");
const NOW = "2026-07-10T00:00:00.000Z";

const settings = (mode: MosaicTelemetrySettingsFile["mode"]): MosaicTelemetrySettingsFile => ({
  ...defaultTelemetrySettings(INSTALL, NOW),
  mode,
});

const report = (over: Partial<MosaicRenderReportLike> = {}): MosaicRenderReportLike => ({
  mode: "render",
  ok: true,
  exitCode: 0,
  run: {
    startedAtIso: "2026-07-10T00:00:00.000Z",
    finishedAtIso: "2026-07-10T00:00:01.000Z",
    elapsedMs: 1000,
  },
  errors: [],
  warnings: [],
  ...over,
});

const make = (
  mode: MosaicTelemetrySettingsFile["mode"],
  env: NodeJS.ProcessEnv = {},
) => {
  const appended: MosaicRenderRecord[] = [];
  const rec = createRenderRecorder({
    surface: "cli",
    command: "make",
    runId: "run-1",
    settings: settings(mode),
    env,
    append: (r) => appended.push(r),
    recordId: "fixed-id",
  });
  return { rec, appended };
};

describe("mode gating", () => {
  it("ghost is fully inert: no sink collection, no append", () => {
    const { rec, appended } = make("ghost");
    expect(rec.enabled).toBe(false);
    emitTemplateLog(
      { telemetry: rec.sink },
      { templateId: asTemplateId("@m0saic/x/y/v1"), message: "hi" },
    );
    expect(rec.recordRender(report())).toBeNull();
    expect(appended).toHaveLength(0);
  });

  it("an env ghost overrides standard settings", () => {
    const { rec, appended } = make("standard", { M0SAIC_TELEMETRY: "ghost" });
    expect(rec.enabled).toBe(false);
    expect(rec.effectiveMode).toEqual({
      mode: "ghost",
      source: "env",
      dntDegraded: false,
    });
    rec.recordRender(report());
    expect(appended).toHaveLength(0);
  });

  it("DO_NOT_TRACK does NOT disable local recording", () => {
    const { rec, appended } = make("standard", { DO_NOT_TRACK: "1" });
    expect(rec.enabled).toBe(true);
    expect(rec.effectiveMode.mode).toBe("local");
    expect(rec.effectiveMode.dntDegraded).toBe(true);
    rec.recordRender(report());
    expect(appended).toHaveLength(1);
  });

  it("local mode records locally", () => {
    const { rec, appended } = make("local");
    expect(rec.enabled).toBe(true);
    rec.recordRender(report());
    expect(appended).toHaveLength(1);
  });
});

describe("template backchannel collection", () => {
  it("collects template_log via the real emitTemplateLog producer", () => {
    const { rec, appended } = make("standard");
    emitTemplateLog(
      { telemetry: rec.sink },
      {
        templateId: asTemplateId("@m0saic/media/subtitle-burn/v1"),
        message: "Selected subtitle track",
        data: { event: "track_selected", trackIndex: 2 },
      },
    );
    emitTemplateLog(
      { telemetry: rec.sink },
      {
        templateId: asTemplateId("@m0saic/media/subtitle-burn/v1"),
        message: "no data payload",
        level: "warn",
      },
    );
    rec.recordRender(report());
    const logs = appended[0].templateLogs;
    expect(logs).toHaveLength(2);
    expect(logs?.[0]).toEqual({
      templateId: "@m0saic/media/subtitle-burn/v1",
      level: "info",
      message: "Selected subtitle track",
      event: "track_selected",
      dataBytes: expect.any(Number),
    });
    expect(logs?.[1]).toEqual({
      templateId: "@m0saic/media/subtitle-burn/v1",
      level: "warn",
      message: "no data payload",
    });
  });

  it("caps collected template logs at 50", () => {
    const { rec, appended } = make("standard");
    for (let i = 0; i < 60; i++) {
      emitTemplateLog(
        { telemetry: rec.sink },
        { templateId: asTemplateId("@m0saic/x/y/v1"), message: `m${i}` },
      );
    }
    rec.recordRender(report());
    expect(appended[0].templateLogs).toHaveLength(50);
  });

  it("survives a circular data payload (dataBytes omitted)", () => {
    const { rec, appended } = make("standard");
    const circular: Record<string, unknown> = { event: "circ" };
    circular.self = circular;
    emitTemplateLog(
      { telemetry: rec.sink },
      { templateId: asTemplateId("@m0saic/x/y/v1"), message: "c", data: circular },
    );
    rec.recordRender(report());
    expect(appended[0].templateLogs?.[0]).toEqual({
      templateId: "@m0saic/x/y/v1",
      level: "info",
      message: "c",
      event: "circ",
    });
  });
});

describe("render-event stream collection", () => {
  const commandEnd = (over: Partial<Extract<RenderEvent, { type: "command_end" }>> = {}): RenderEvent => ({
    type: "command_end",
    index: 0,
    total: 3,
    exitCode: 0,
    elapsedMs: 100,
    ...over,
  });

  it("accumulates command stats and the failure kind", () => {
    const { rec, appended } = make("standard");
    rec.onRenderEvent({ type: "command_start", index: 0, total: 3, cmd: { node: "n0" } });
    rec.onRenderEvent(commandEnd({ index: 0, elapsedMs: 100 }));
    rec.onRenderEvent(commandEnd({ index: 1, elapsedMs: 400 }));
    rec.onRenderEvent(
      commandEnd({
        index: 2,
        exitCode: 234,
        elapsedMs: 50,
        failure: {
          kind: "missing-codec",
          summary: "Unknown encoder",
          hints: [],
        },
      }),
    );
    rec.recordRender(report({ ok: false, exitCode: 1, errors: [{ code: "FFMPEG_EXIT", message: "x" }] }));
    const r = appended[0];
    expect(r.commands).toEqual({
      total: 3,
      completed: 2,
      failed: 1,
      totalCommandMs: 550,
      maxCommandMs: 400,
    });
    expect(r.ffmpegFailureKind).toBe("missing-codec");
    expect(r.outcome).toBe("error_ffmpeg");
    expect(r.errorClass).toBe("ffmpeg_unknown_encoder");
  });

  it("captures cancellation", () => {
    const { rec, appended } = make("standard");
    rec.onRenderEvent({ type: "render_cancelled", index: 1, total: 3, elapsedMs: 500 });
    rec.recordRender(report({ ok: false, exitCode: 1 }));
    expect(appended[0].outcome).toBe("cancelled");
  });

  it("omits command stats when no command events were seen", () => {
    const { rec, appended } = make("standard");
    rec.recordRender(report());
    expect(appended[0].commands).toBeUndefined();
  });
});

describe("recordRender contract", () => {
  it("is single-shot: the second call returns null and appends nothing", () => {
    const { rec, appended } = make("standard");
    expect(rec.recordRender(report())).not.toBeNull();
    expect(rec.recordRender(report())).toBeNull();
    expect(appended).toHaveLength(1);
  });

  it("returns null for validate-only reports without appending", () => {
    const { rec, appended } = make("standard");
    expect(rec.recordRender(report({ mode: "validate" }))).toBeNull();
    expect(appended).toHaveLength(0);
  });

  it("never throws when the append target throws", () => {
    const rec = createRenderRecorder({
      surface: "cli",
      settings: settings("standard"),
      env: {},
      append: () => {
        throw new Error("disk full");
      },
    });
    expect(rec.recordRender(report())).toBeNull();
  });

  it("threads extras through (renderableKind + validation flag)", () => {
    const { rec, appended } = make("standard");
    rec.recordRender(
      report({ ok: false, exitCode: 1, errors: [{ code: "SPLIT_EXCEEDS_AXIS", message: "x" }] }),
      { renderableKind: "mosaic_document", hasValidationErrors: true },
    );
    expect(appended[0].renderableKind).toBe("mosaic_document");
    expect(appended[0].outcome).toBe("error_validation");
    expect(appended[0].errorClass).toBe("plan_validation_failed");
  });
});

describe("predicted-vs-actual capture (estimate-v2)", () => {
  const renderStart = (over: Record<string, unknown> = {}): RenderEvent =>
    ({
      type: "render_start",
      totalCommands: 3,
      finalOutput: "out.mp4",
      estimatedMs: 4200,
      costModelVersion: 2,
      ...over,
    }) as RenderEvent;

  it("captures predictedMs + costModelVersion from the first render_start", () => {
    const { rec, appended } = make("local");
    rec.onRenderEvent(renderStart());
    rec.recordRender(report());
    expect(appended[0].predictedMs).toBe(4200);
    expect(appended[0].costModelVersion).toBe(2);
    expect(appended[0]).not.toHaveProperty("stampWrapped");
  });

  it("a second render_start (the QR stamp wrap stage) sets stampWrapped and keeps the main prediction", () => {
    const { rec, appended } = make("local");
    rec.onRenderEvent(renderStart());
    rec.onRenderEvent(renderStart({ estimatedMs: 900, stage: "stamp" }));
    rec.recordRender(report());
    expect(appended[0].predictedMs).toBe(4200);
    expect(appended[0].stampWrapped).toBe(true);
  });

  it("no render_start → fields absent (older hosts / partial streams)", () => {
    const { rec, appended } = make("local");
    rec.recordRender(report());
    expect(appended[0]).not.toHaveProperty("predictedMs");
    expect(appended[0]).not.toHaveProperty("costModelVersion");
    expect(appended[0]).not.toHaveProperty("stampWrapped");
  });
});
