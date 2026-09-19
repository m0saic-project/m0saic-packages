import { asSpanId, asTraceId, type SpanId, type TemplateId, type TraceId } from "../identifiers/identifiers";
import { type MosaicTelemetrySink, getTelemetry } from "./sink";
import type { TemplateTelemetryLevel } from "./level";
import type { TemplateLogPayload } from "./event";

/**
 * Placeholder correlation ids used when the caller doesn't supply
 * a trace/span. Phase 2 engine wiring will thread real ids into
 * `MosaicEngineContext`; until then, every template-emitted event
 * carries this sentinel so log consumers can see "this came from
 * an emit site that pre-dates correlation threading".
 */
const UNWIRED_TRACE_ID: TraceId = asTraceId("unwired");
const UNWIRED_SPAN_ID: SpanId = asSpanId("unwired");

export type EmitTemplateLogOpts = {
  /** Template id (same value as MosaicTemplate.id) — used for downstream attribution. */
  templateId: TemplateId;
  /** Short human-readable narrative. Large structured data belongs in `data`. */
  message: string;
  /** Severity tier. Defaults to "info". */
  level?: TemplateTelemetryLevel;
  /**
   * Optional structured payload. JSON-serializable values only.
   * By convention, include a `data.event: "<name>"` discriminator so
   * downstream consumers can filter by event type without us extending
   * the closed `kind` union in `@m0saic/types`.
   */
  data?: Record<string, unknown>;
  /** Trace id. Defaults to the "unwired" sentinel — replace with real value once ctx wires it. */
  traceId?: TraceId;
  /** Span id. Defaults to the "unwired" sentinel. */
  spanId?: SpanId;
  /** Parent span id (when this emit is inside a wider span). */
  parentSpanId?: SpanId;
};

/**
 * Canonical emit-site helper for template observability.
 *
 * Templates should call this rather than constructing
 * `MosaicTelemetryEvent` envelopes inline — keeps the call site small
 * and centralizes the correlation-field defaults until Phase 2 engine
 * wiring threads real `traceId`/`spanId` into `MosaicEngineContext`.
 *
 * Safe to call when `ctx?.telemetry` is undefined (delegates to
 * `getTelemetry`, which returns a no-op sink).
 *
 * @example
 * emitTemplateLog(ctx, {
 *   templateId: SUBTITLE_BURN_TEMPLATE_ID,
 *   message: "Selected subtitle track",
 *   data: {
 *     event: "track_selected",
 *     rule: "language-match",
 *     trackIndex: 5,
 *     language: "fra",
 *   },
 * });
 */
export function emitTemplateLog(
  ctx: { telemetry?: MosaicTelemetrySink } | undefined,
  opts: EmitTemplateLogOpts,
): void {
  const sink = getTelemetry(ctx);
  const payload: TemplateLogPayload = {
    templateId: opts.templateId,
    message: opts.message,
    data: opts.data,
  };
  sink.emit({
    tier: "template",
    level: opts.level ?? "info",
    category: "engine.template",
    kind: "template_log",
    traceId: opts.traceId ?? UNWIRED_TRACE_ID,
    spanId: opts.spanId ?? UNWIRED_SPAN_ID,
    parentSpanId: opts.parentSpanId,
    timestamp: Date.now(),
    payload,
  });
}
