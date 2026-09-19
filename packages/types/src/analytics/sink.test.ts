import { asInstallId } from "../identifiers/identifiers";
import type {
  MosaicAnalyticsEvent,
  MosaicAnalyticsImmediateEvent,
  MosaicAnalyticsRollupEvent,
} from "./event";
import {
  NOOP_ANALYTICS_IMMEDIATE_SINK,
  NOOP_ANALYTICS_ROLLUP_SINK,
  NOOP_ANALYTICS_SINKS,
  isMosaicAnalyticsImmediateEvent,
  isMosaicAnalyticsRollupEvent,
  routeAnalyticsEvent,
  type MosaicAnalyticsSinks,
} from "./sink";

const INSTALL = asInstallId("550e8400-e29b-41d4-a716-446655440000");

const baseEnvelope = () => ({
  installId: INSTALL,
  timestamp: 1_700_000_000_000,
  schemaVersion: 1 as const,
});

const baseHost = () => ({
  os: "linux" as const,
  arch: "x64",
  mosaicVersion: "0.1",
});

const rollupEvent = (): MosaicAnalyticsRollupEvent => ({
  ...baseEnvelope(),
  kind: "rollup",
  windowStart: 0,
  windowEnd: 86_400_000,
  host: baseHost(),
  metrics: {
    rendersStarted: 1,
    rendersByOutcome: {
      ok: 1,
      cancelled: 0,
      error_plan_build: 0,
      error_validation: 0,
      error_ffmpeg: 0,
      error_template: 0,
      error_other: 0,
    },
    rendersByKind: { mosaic_document: 1, mosaic_pipeline: 0 },
    ffmpegInvocations: 1,
    renderDurationMsBuckets: [1, 0, 0, 0, 0, 0, 0],
    distinctTemplatesUsed: 1,
  },
});

const immediateEvent = (): MosaicAnalyticsImmediateEvent => ({
  ...baseEnvelope(),
  kind: "install_completed",
  host: baseHost(),
});

describe("NOOP analytics sinks", () => {
  it("rollup noop accepts any rollup event without throwing", () => {
    expect(() => NOOP_ANALYTICS_ROLLUP_SINK.emit(rollupEvent())).not.toThrow();
  });

  it("immediate noop accepts any immediate event without throwing", () => {
    expect(() => NOOP_ANALYTICS_IMMEDIATE_SINK.emit(immediateEvent())).not.toThrow();
  });

  it("the bundled NOOP_ANALYTICS_SINKS holds both noop sinks", () => {
    expect(NOOP_ANALYTICS_SINKS.rollup).toBe(NOOP_ANALYTICS_ROLLUP_SINK);
    expect(NOOP_ANALYTICS_SINKS.immediate).toBe(NOOP_ANALYTICS_IMMEDIATE_SINK);
  });
});

describe("type guards", () => {
  it("isMosaicAnalyticsRollupEvent narrows correctly", () => {
    expect(isMosaicAnalyticsRollupEvent(rollupEvent())).toBe(true);
    expect(isMosaicAnalyticsRollupEvent(immediateEvent())).toBe(false);
  });

  it("isMosaicAnalyticsImmediateEvent narrows correctly", () => {
    expect(isMosaicAnalyticsImmediateEvent(immediateEvent())).toBe(true);
    expect(isMosaicAnalyticsImmediateEvent(rollupEvent())).toBe(false);
  });
});

describe("routeAnalyticsEvent", () => {
  it("routes rollup events to the rollup sink only", () => {
    const rollupCalls: MosaicAnalyticsRollupEvent[] = [];
    const immediateCalls: MosaicAnalyticsImmediateEvent[] = [];
    const sinks: MosaicAnalyticsSinks = {
      rollup: { emit: (e) => rollupCalls.push(e) },
      immediate: { emit: (e) => immediateCalls.push(e) },
    };
    routeAnalyticsEvent(sinks, rollupEvent());
    expect(rollupCalls).toHaveLength(1);
    expect(immediateCalls).toHaveLength(0);
  });

  it("routes immediate events to the immediate sink only", () => {
    const rollupCalls: MosaicAnalyticsRollupEvent[] = [];
    const immediateCalls: MosaicAnalyticsImmediateEvent[] = [];
    const sinks: MosaicAnalyticsSinks = {
      rollup: { emit: (e) => rollupCalls.push(e) },
      immediate: { emit: (e) => immediateCalls.push(e) },
    };
    routeAnalyticsEvent(sinks, immediateEvent());
    expect(rollupCalls).toHaveLength(0);
    expect(immediateCalls).toHaveLength(1);
  });

  it("can mix rollup + immediate events into one stream and route correctly", () => {
    const rollupCalls: MosaicAnalyticsRollupEvent[] = [];
    const immediateCalls: MosaicAnalyticsImmediateEvent[] = [];
    const sinks: MosaicAnalyticsSinks = {
      rollup: { emit: (e) => rollupCalls.push(e) },
      immediate: { emit: (e) => immediateCalls.push(e) },
    };
    const stream: MosaicAnalyticsEvent[] = [
      rollupEvent(),
      immediateEvent(),
      rollupEvent(),
    ];
    for (const e of stream) routeAnalyticsEvent(sinks, e);
    expect(rollupCalls).toHaveLength(2);
    expect(immediateCalls).toHaveLength(1);
  });
});
