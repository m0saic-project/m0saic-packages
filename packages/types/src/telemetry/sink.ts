import type { MosaicTelemetryCategory } from "./category";
import {
  projectRenderEvent,
  type MosaicTelemetryEvent,
  type RenderEvent,
  type RenderEventSink,
} from "./event";
import {
  LEVEL_RANK,
  type MosaicTelemetryLevel,
  type MosaicTelemetryTier,
} from "./level";

/**
 * Sink for {@link MosaicTelemetryEvent}. Single method, sync, no return.
 *
 * Composition is via combinators ({@link filterSink}, {@link fanoutSink})
 * rather than configuration on the interface itself.
 */
export type MosaicTelemetrySink = {
  emit(event: MosaicTelemetryEvent): void;
};

/**
 * Default sink that drops every event. Used as the absent-context
 * fallback so emit sites never need `?.emit()` juggling.
 */
export const NOOP_TELEMETRY_SINK: MosaicTelemetrySink = {
  emit: () => {
    /* drop */
  },
};

/** Predicate over a single event. Used by {@link filterSink}. */
export type MosaicTelemetryPredicate = (event: MosaicTelemetryEvent) => boolean;

/**
 * Wrap `inner` so only events for which `predicate(event)` returns
 * `true` are forwarded. Predicates compose by `&&`-ing — chain
 * `filterSink` calls or compose predicates before wrapping.
 */
export const filterSink = (
  inner: MosaicTelemetrySink,
  predicate: MosaicTelemetryPredicate,
): MosaicTelemetrySink => ({
  emit: (event) => {
    if (predicate(event)) inner.emit(event);
  },
});

/**
 * Fan out every event to all `inners`. Order is preserved; each inner
 * sees the same event reference. Errors in one inner do NOT prevent
 * the rest from receiving the event — each `emit` is invoked in its
 * own try/catch so a misbehaving subscriber can't starve the others.
 */
export const fanoutSink = (
  ...inners: MosaicTelemetrySink[]
): MosaicTelemetrySink => ({
  emit: (event) => {
    for (const inner of inners) {
      try {
        inner.emit(event);
      } catch {
        /* a sink's failure mustn't affect siblings — swallow */
      }
    }
  },
});

/**
 * Cross-tier severity threshold.
 *
 * Admits events whose `level` is at or above `min` in
 * {@link LEVEL_RANK}, regardless of tier. Useful for the "errors
 * only, anywhere in the stack" persona; for tier-aware filtering
 * use {@link byTierLevel}.
 */
export const byLevel =
  (min: MosaicTelemetryLevel): MosaicTelemetryPredicate =>
  (event) =>
    LEVEL_RANK[event.level] >= LEVEL_RANK[min];

/**
 * Admit only events from the given tier(s).
 *
 * Pass a single tier or a `ReadonlySet`. Use this when you want
 * everything from a tier and don't care about severity — the
 * canonical case is "give me every `ffmpeg-boundary` event so I can
 * capture replay anchors".
 */
export const byTier =
  (
    allowed: MosaicTelemetryTier | ReadonlySet<MosaicTelemetryTier>,
  ): MosaicTelemetryPredicate => {
  const set =
    typeof allowed === "string"
      ? new Set<MosaicTelemetryTier>([allowed])
      : allowed;
  return (event) => set.has(event.tier);
};

/**
 * Per-tier severity threshold map.
 *
 * The canonical filter for the persona model. Each key is a tier;
 * the value is either:
 *  - a {@link MosaicTelemetryLevel} threshold — admit events at or
 *    above that severity for this tier;
 *  - `true` — admit every event from this tier regardless of level;
 *  - `false` or `undefined` — drop all events from this tier.
 *
 * Tiers omitted from the map are dropped entirely.
 *
 * Examples:
 *
 *   // template-dev: everything everywhere
 *   byTierLevel({
 *     m0saic: true,
 *     "ffmpeg-boundary": true,
 *     ffmpeg: true,
 *   });
 *
 *   // app-viewer: engine narration + replay anchors, no raw ffmpeg
 *   byTierLevel({
 *     m0saic: "info",
 *     "ffmpeg-boundary": true,
 *     // ffmpeg omitted → dropped
 *   });
 *
 *   // batch-operator: engine summary + ffmpeg errors only
 *   byTierLevel({
 *     m0saic: "info",
 *     ffmpeg: "error",
 *   });
 */
export type TierLevelMap = Partial<
  Record<MosaicTelemetryTier, MosaicTelemetryLevel | boolean>
>;

export const byTierLevel =
  (map: TierLevelMap): MosaicTelemetryPredicate =>
  (event) => {
    const rule = map[event.tier];
    if (rule === undefined || rule === false) return false;
    if (rule === true) return true;
    return LEVEL_RANK[event.level] >= LEVEL_RANK[rule];
  };

/**
 * Predicate: admit events whose `category` is in `allowed`.
 * Pass a `ReadonlySet` so membership checks are O(1) and so the
 * caller can share the set across multiple sinks.
 *
 * Category is orthogonal to tier: it names the subsystem that
 * emitted the event (`engine.runtime`, `platform.jobs`), tier names
 * the audience layer. Compose `byCategory` + `byTier(Level)` to
 * express "engine.runtime events at the ffmpeg-boundary tier".
 */
export const byCategory =
  (
    allowed: ReadonlySet<MosaicTelemetryCategory>,
  ): MosaicTelemetryPredicate =>
  (event) =>
    allowed.has(event.category);

/**
 * Bridge: feed an existing {@link RenderEventSink} from the broader
 * telemetry stream. Non-projectable events are silently dropped.
 *
 * Use case: keep the existing app-side `useRenderHeroEvents` hook /
 * Electron IPC pipe unchanged when wiring a telemetry sink into the
 * engine.
 */
export const renderEventSinkToTelemetrySink = (
  rs: RenderEventSink,
): MosaicTelemetrySink => ({
  emit: (event) => {
    const projected: RenderEvent | undefined = projectRenderEvent(event);
    if (projected) rs(projected);
  },
});

/**
 * Convenience accessor for the canonical "either the context-provided
 * sink, or a no-op". Phase 2 emit sites call
 * `getTelemetry(ctx).emit(...)` directly without optional-chaining.
 */
export const getTelemetry = (
  ctx: { telemetry?: MosaicTelemetrySink } | undefined,
): MosaicTelemetrySink => ctx?.telemetry ?? NOOP_TELEMETRY_SINK;
