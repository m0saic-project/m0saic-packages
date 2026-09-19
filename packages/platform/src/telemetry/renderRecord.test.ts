import type { MosaicRenderReportLike } from "@m0saic/types";
import type { RenderRecordCollected } from "./renderRecord";
import {
  RENDER_RECORD_MAX_ERRORS,
  RENDER_RECORD_MAX_TEMPLATE_LOGS,
  RENDER_RECORD_MESSAGE_MAX_CHARS,
  buildRenderRecord,
  versionMajorMinor,
} from "./renderRecord";

const report = (over: Partial<MosaicRenderReportLike> = {}): MosaicRenderReportLike => ({
  mode: "render",
  ok: true,
  exitCode: 0,
  run: {
    id: "run-1",
    startedAtIso: "2026-07-10T00:00:00.000Z",
    finishedAtIso: "2026-07-10T00:00:12.400Z",
    elapsedMs: 12400,
  },
  paths: { output: { absolutePath: "/tmp/out.mp4" } },
  output: {
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 5000,
    format: { kind: "video", container: "mp4", codec: "h264" },
  },
  template: { id: "@m0saic/charts/stat-card/v1" },
  layout: { rootSourceCount: 12, rootFlattenedSourceCount: 14 },
  versions: {
    cli: { version: "0.1.0" },
    ffmpeg: { runtime: { version: "8.0.1" } },
  },
  errors: [],
  warnings: [],
  ...over,
});

const collected = (over: Partial<RenderRecordCollected> = {}): RenderRecordCollected => ({
  cancelled: false,
  templateLogs: [],
  ...over,
});

const build = (
  r: Partial<MosaicRenderReportLike> = {},
  c: Partial<RenderRecordCollected> = {},
) =>
  buildRenderRecord({
    surface: "cli",
    command: "make",
    report: report(r),
    collected: collected(c),
    recordId: "fixed-record-id",
  });

describe("buildRenderRecord", () => {
  it("returns null for validate-only runs", () => {
    expect(build({ mode: "validate" })).toBeNull();
  });

  it("distills a successful render", () => {
    const rec = build();
    expect(rec).toEqual({
      schemaVersion: 1,
      recordId: "fixed-record-id",
      runId: "run-1",
      surface: "cli",
      command: "make",
      startedAt: "2026-07-10T00:00:00.000Z",
      finishedAt: "2026-07-10T00:00:12.400Z",
      elapsedMs: 12400,
      ok: true,
      exitCode: 0,
      outcome: "ok",
      templateId: "@m0saic/charts/stat-card/v1",
      output: {
        width: 1920,
        height: 1080,
        fps: 30,
        durationMs: 5000,
        formatKind: "video",
        container: "mp4",
        codec: "h264",
      },
      outputPath: "/tmp/out.mp4",
      layout: { sourceCount: 12, flattenedSourceCount: 14 },
      versions: { mosaic: "0.1.0", ffmpeg: "8.0" },
      errors: [],
      warningsCount: 0,
    });
  });

  it("prefers the caller runId over the report's", () => {
    const rec = buildRenderRecord({
      surface: "app",
      report: report(),
      collected: collected(),
      runId: "host-run",
      recordId: "fixed",
    });
    expect(rec?.runId).toBe("host-run");
    expect(rec?.surface).toBe("app");
    expect(rec?.command).toBeUndefined();
  });

  it("mints a recordId when none is injected", () => {
    const rec = buildRenderRecord({
      surface: "cli",
      report: report(),
      collected: collected(),
    });
    expect(rec?.recordId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("classifies an ffmpeg failure via the collected kind", () => {
    const rec = build(
      {
        ok: false,
        exitCode: 1,
        errors: [{ code: "FFMPEG_EXIT", message: "exit 234" }],
      },
      {
        ffmpegFailureKind: "missing-codec",
        commandStats: {
          total: 3,
          completed: 2,
          failed: 1,
          totalCommandMs: 900,
          maxCommandMs: 500,
        },
      },
    );
    expect(rec?.outcome).toBe("error_ffmpeg");
    expect(rec?.errorClass).toBe("ffmpeg_unknown_encoder");
    expect(rec?.ffmpegFailureKind).toBe("missing-codec");
    expect(rec?.commands?.failed).toBe(1);
  });

  it("cancelled wins and carries no errorClass", () => {
    const rec = build({ ok: false, exitCode: 1 }, { cancelled: true });
    expect(rec?.outcome).toBe("cancelled");
    expect(rec?.errorClass).toBeUndefined();
  });

  it("validation errors classify via the host flag", () => {
    const rec = build(
      {
        ok: false,
        exitCode: 1,
        errors: [{ code: "SPLIT_EXCEEDS_AXIS", message: "infeasible" }],
      },
      { hasValidationErrors: true },
    );
    expect(rec?.outcome).toBe("error_validation");
    expect(rec?.errorClass).toBe("plan_validation_failed");
  });

  it("truncates long error messages and caps the error list", () => {
    const long = "x".repeat(2000);
    const errors = Array.from({ length: 30 }, (_, i) => ({
      code: `E${i}`,
      message: long,
    }));
    const rec = build({ ok: false, exitCode: 1, errors });
    expect(rec?.errors).toHaveLength(RENDER_RECORD_MAX_ERRORS);
    expect(rec?.errors[0].message.length).toBe(RENDER_RECORD_MESSAGE_MAX_CHARS);
  });

  it("caps template logs and truncates their messages", () => {
    const logs = Array.from({ length: 60 }, (_, i) => ({
      templateId: "@m0saic/x/y/v1",
      level: "info" as const,
      message: "m".repeat(1000),
      event: `e${i}`,
    }));
    const rec = build({}, { templateLogs: logs });
    expect(rec?.templateLogs).toHaveLength(RENDER_RECORD_MAX_TEMPLATE_LOGS);
    expect(rec?.templateLogs?.[0].message.length).toBe(
      RENDER_RECORD_MESSAGE_MAX_CHARS,
    );
  });

  it("omits optional blocks that have no data", () => {
    const rec = buildRenderRecord({
      surface: "cli",
      report: report({
        paths: undefined,
        output: undefined,
        template: undefined,
        layout: undefined,
        versions: undefined,
        run: {
          startedAtIso: "2026-07-10T00:00:00.000Z",
          finishedAtIso: "2026-07-10T00:00:01.000Z",
          elapsedMs: 1000,
        },
      }),
      collected: collected(),
      recordId: "fixed",
    });
    expect(rec?.runId).toBeUndefined();
    expect(rec?.output).toBeUndefined();
    expect(rec?.outputPath).toBeUndefined();
    expect(rec?.templateId).toBeUndefined();
    expect(rec?.layout).toBeUndefined();
    expect(rec?.versions).toBeUndefined();
    expect(rec?.templateLogs).toBeUndefined();
  });

  it("never carries stderr/details fields (exclusion rule)", () => {
    const rec = build({
      ok: false,
      exitCode: 1,
      errors: [{ code: "FFMPEG_EXIT", message: "boom" }],
    });
    expect(JSON.stringify(rec)).not.toContain("stderr");
    expect(JSON.stringify(rec)).not.toContain("details");
  });
});

describe("versionMajorMinor", () => {
  it("floors versions to major.minor", () => {
    expect(versionMajorMinor("8.0.1")).toBe("8.0");
    expect(versionMajorMinor("8.0")).toBe("8.0");
    expect(versionMajorMinor("n8.0-static")).toBe("8.0");
    expect(versionMajorMinor("N-124279-gabc")).toBeUndefined();
    expect(versionMajorMinor(undefined)).toBeUndefined();
  });
});
