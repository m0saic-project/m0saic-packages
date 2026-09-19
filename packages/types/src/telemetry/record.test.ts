import type { FfmpegFailureKind } from "./event";
import type { MosaicRenderRecord, MosaicRenderReportLike } from "./record";
import {
  FFMPEG_FAILURE_KIND_TO_ERROR_CLASS,
  TELEMETRY_RENDER_RECORD_SCHEMA_VERSION,
  deriveErrorClass,
  deriveRenderOutcome,
} from "./record";

describe("deriveRenderOutcome", () => {
  const base = { ok: false, cancelled: false, errorCodes: [], ffmpegFailed: false };

  it("cancelled wins over everything", () => {
    expect(
      deriveRenderOutcome({
        ...base,
        cancelled: true,
        ok: true,
        ffmpegFailed: true,
      }),
    ).toBe("cancelled");
  });

  it("ok when the render succeeded", () => {
    expect(deriveRenderOutcome({ ...base, ok: true })).toBe("ok");
  });

  it("ffmpeg failure via the event-stream flag", () => {
    expect(deriveRenderOutcome({ ...base, ffmpegFailed: true })).toBe(
      "error_ffmpeg",
    );
  });

  it("ffmpeg failure via FFMPEG* error codes", () => {
    expect(
      deriveRenderOutcome({ ...base, errorCodes: ["FFMPEG_EXIT"] }),
    ).toBe("error_ffmpeg");
  });

  it("validation flag maps to error_validation", () => {
    expect(
      deriveRenderOutcome({
        ...base,
        errorCodes: ["SPLIT_EXCEEDS_AXIS"],
        hasValidationErrors: true,
      }),
    ).toBe("error_validation");
  });

  it("NO_COMMANDS maps to error_plan_build", () => {
    expect(deriveRenderOutcome({ ...base, errorCodes: ["NO_COMMANDS"] })).toBe(
      "error_plan_build",
    );
  });

  it("TEMPLATE* codes map to error_template", () => {
    expect(
      deriveRenderOutcome({ ...base, errorCodes: ["TEMPLATE_RENDER_THREW"] }),
    ).toBe("error_template");
  });

  it("everything else (incl. crashes) is error_other", () => {
    expect(
      deriveRenderOutcome({ ...base, errorCodes: ["UNHANDLED_EXCEPTION"] }),
    ).toBe("error_other");
    expect(deriveRenderOutcome(base)).toBe("error_other");
  });

  it("ffmpeg outranks plan-build when both are present", () => {
    expect(
      deriveRenderOutcome({
        ...base,
        ffmpegFailed: true,
        errorCodes: ["NO_COMMANDS"],
      }),
    ).toBe("error_ffmpeg");
  });
});

describe("FFMPEG_FAILURE_KIND_TO_ERROR_CLASS", () => {
  it("covers every FfmpegFailureKind", () => {
    const kinds: FfmpegFailureKind[] = [
      "thread-exhaustion",
      "link-queue-buffer-overflow",
      "out-of-memory",
      "no-space",
      "killed",
      "ffmpeg-crash",
      "missing-input",
      "missing-codec",
      "filter-graph-invalid",
      "stalled",
      "unknown",
    ];
    for (const k of kinds) {
      expect(FFMPEG_FAILURE_KIND_TO_ERROR_CLASS[k]).toBeDefined();
    }
    expect(Object.keys(FFMPEG_FAILURE_KIND_TO_ERROR_CLASS).sort()).toEqual(
      [...kinds].sort(),
    );
  });

  it("maps the specific kinds to their specific classes", () => {
    expect(FFMPEG_FAILURE_KIND_TO_ERROR_CLASS["missing-codec"]).toBe(
      "ffmpeg_unknown_encoder",
    );
    expect(FFMPEG_FAILURE_KIND_TO_ERROR_CLASS["missing-input"]).toBe(
      "asset_missing",
    );
    expect(FFMPEG_FAILURE_KIND_TO_ERROR_CLASS["no-space"]).toBe(
      "workspace_io_failed",
    );
    expect(FFMPEG_FAILURE_KIND_TO_ERROR_CLASS["out-of-memory"]).toBe(
      "ffmpeg_exit_nonzero",
    );
  });
});

describe("deriveErrorClass", () => {
  it("returns undefined when there is nothing to classify", () => {
    expect(deriveErrorClass({ errorCodes: [] })).toBeUndefined();
  });

  it("the ffmpeg classifier verdict wins when present", () => {
    expect(
      deriveErrorClass({
        errorCodes: ["NO_COMMANDS"],
        ffmpegFailureKind: "missing-codec",
      }),
    ).toBe("ffmpeg_unknown_encoder");
  });

  it("FFMPEG_NOT_FOUND maps to ffmpeg_not_found", () => {
    expect(deriveErrorClass({ errorCodes: ["FFMPEG_NOT_FOUND"] })).toBe(
      "ffmpeg_not_found",
    );
  });

  it("other FFMPEG* codes map to ffmpeg_exit_nonzero", () => {
    expect(deriveErrorClass({ errorCodes: ["FFMPEG_EXIT"] })).toBe(
      "ffmpeg_exit_nonzero",
    );
  });

  it("validation flag maps to plan_validation_failed", () => {
    expect(
      deriveErrorClass({
        errorCodes: ["SPLIT_EXCEEDS_AXIS"],
        hasValidationErrors: true,
      }),
    ).toBe("plan_validation_failed");
  });

  it("NO_COMMANDS maps to plan_build_failed", () => {
    expect(deriveErrorClass({ errorCodes: ["NO_COMMANDS"] })).toBe(
      "plan_build_failed",
    );
  });

  it("TEMPLATE* codes map to template_threw", () => {
    expect(deriveErrorClass({ errorCodes: ["TEMPLATE_RENDER_THREW"] })).toBe(
      "template_threw",
    );
  });

  it("crashes and unknowns map to other", () => {
    expect(deriveErrorClass({ errorCodes: ["UNHANDLED_EXCEPTION"] })).toBe(
      "other",
    );
    expect(deriveErrorClass({ errorCodes: ["SOMETHING_ELSE"] })).toBe("other");
  });
});

describe("shape contracts", () => {
  it("a report-shaped literal is assignable to MosaicRenderReportLike", () => {
    // Structural stand-in for RenderReportV2 (the real compile-time
    // assertion against core's type lives in the CLI, which may import
    // core; @m0saic/types may not).
    const reportish: MosaicRenderReportLike = {
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
      template: { id: "@m0saic/media/subtitle-burn/v1" },
      layout: { rootSourceCount: 12, rootFlattenedSourceCount: 14 },
      versions: {
        cli: { version: "0.1.0" },
        ffmpeg: { runtime: { version: "8.0" } },
      },
      errors: [{ code: "X", message: "y" }],
      warnings: [{ code: "W", message: "z" }],
    };
    expect(reportish.ok).toBe(true);
  });

  it("a minimal render record typechecks at schemaVersion 1", () => {
    const record: MosaicRenderRecord = {
      schemaVersion: TELEMETRY_RENDER_RECORD_SCHEMA_VERSION,
      recordId: "550e8400-e29b-41d4-a716-446655440000",
      surface: "cli",
      startedAt: "2026-07-10T00:00:00.000Z",
      finishedAt: "2026-07-10T00:00:01.000Z",
      elapsedMs: 1000,
      ok: true,
      exitCode: 0,
      outcome: "ok",
      errors: [],
      warningsCount: 0,
    };
    expect(record.outcome).toBe("ok");
  });
});
