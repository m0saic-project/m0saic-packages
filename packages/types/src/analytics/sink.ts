import type {
  MosaicAnalyticsEvent,
  MosaicAnalyticsImmediateEvent,
  MosaicAnalyticsRollupEvent,
} from "./event";

/**
 * Sink that accepts only rollup-channel analytics events.
 *
 * Typed distinct from {@link MosaicAnalyticsImmediateSink} so a
 * call site that has an immediate event can't accidentally pass it
 * to the rollup channel and vice versa. The split mirrors the
 * upload-cadence difference: rollup events queue up locally and
 * ship on a daily schedule; immediate events ship soon after emit.
 */
export type MosaicAnalyticsRollupSink = {
  emit(event: MosaicAnalyticsRollupEvent): void;
};

/**
 * Sink that accepts only immediate-channel analytics events
 * (`install_completed`, `update_completed`, `error_report`).
 *
 * Typed distinct from {@link MosaicAnalyticsRollupSink}; see that
 * type's doc for the rationale.
 */
export type MosaicAnalyticsImmediateSink = {
  emit(event: MosaicAnalyticsImmediateEvent): void;
};

/**
 * Default rollup sink that drops every event. The absent-consent
 * fallback — assigned when `consent.mode !== "opted-in"` or
 * `consent.channels.rollup === false`.
 */
export const NOOP_ANALYTICS_ROLLUP_SINK: MosaicAnalyticsRollupSink = {
  emit: () => {
    /* drop */
  },
};

/**
 * Default immediate sink that drops every event. The absent-consent
 * fallback for the per-event channel.
 */
export const NOOP_ANALYTICS_IMMEDIATE_SINK: MosaicAnalyticsImmediateSink = {
  emit: () => {
    /* drop */
  },
};

/**
 * Bundle of both analytics channels. Convenience type for code
 * that holds the analytics surface as a single value (CLI / app
 * wiring code, the redactor host, etc.).
 */
export type MosaicAnalyticsSinks = {
  rollup: MosaicAnalyticsRollupSink;
  immediate: MosaicAnalyticsImmediateSink;
};

/** No-op bundle — both channels drop. */
export const NOOP_ANALYTICS_SINKS: MosaicAnalyticsSinks = {
  rollup: NOOP_ANALYTICS_ROLLUP_SINK,
  immediate: NOOP_ANALYTICS_IMMEDIATE_SINK,
};

/**
 * Type-guard: is this analytics event a rollup-channel variant?
 *
 * Useful for `MosaicAnalyticsEvent`-typed routers that decide which
 * sink to call. The narrowing keeps the sink dispatch typed end-to-
 * end so the compiler catches a wrong sink selection.
 */
export const isMosaicAnalyticsRollupEvent = (
  event: MosaicAnalyticsEvent,
): event is MosaicAnalyticsRollupEvent => event.kind === "rollup";

/**
 * Type-guard: is this analytics event an immediate-channel variant?
 */
export const isMosaicAnalyticsImmediateEvent = (
  event: MosaicAnalyticsEvent,
): event is MosaicAnalyticsImmediateEvent => event.kind !== "rollup";

/**
 * Dispatch an analytics event to the correct channel sink based on
 * its `kind`. Eliminates the boilerplate of `if (event.kind ===
 * "rollup") sinks.rollup.emit(event); else sinks.immediate.emit(event);`
 * at every call site.
 */
export const routeAnalyticsEvent = (
  sinks: MosaicAnalyticsSinks,
  event: MosaicAnalyticsEvent,
): void => {
  if (isMosaicAnalyticsRollupEvent(event)) {
    sinks.rollup.emit(event);
  } else {
    sinks.immediate.emit(event);
  }
};
