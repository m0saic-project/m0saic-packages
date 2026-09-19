import {
  byTierLevel,
  filterSink,
  type MosaicTelemetryPredicate,
  type MosaicTelemetrySink,
  type TierLevelMap,
} from "./sink";

/**
 * Persona recipes — documented, NOT a runtime type.
 *
 * Each persona returns a {@link TierLevelMap} that {@link byTierLevel}
 * compiles into a predicate. Personas exist to give CLI flags / app
 * config a small surface (`--telemetry-persona template-dev`) without
 * baking the recipes into the type system. Adding a new persona is
 * one new map here; no type churn.
 *
 * # Recipe semantics
 *
 *  - **`m0saic`** — engine plumbing narration (info / warn / error).
 *    Low volume. Most personas keep this on at `info`.
 *  - **`template`** — template-emitted events (trace / info / warn /
 *    error). Volume is template-author-controlled and can be high
 *    when templates trace internal logic. Most personas keep this
 *    at `info` so the chatter doesn't drown engine narration.
 *  - **`ffmpeg-boundary`** — replay anchors (full ffmpeg argv,
 *    sidecar `.ffgraph` contents). Moderate volume. Off by default
 *    unless the persona explicitly cares about reproducibility.
 *  - **`ffmpeg`** — raw stderr from ffmpeg children. High volume.
 *    Off except for `template-dev` (full debug) and as `error`-only
 *    elsewhere.
 */

/**
 * Template author — engine narration + full template internals +
 * full replay anchors + ffmpeg warnings/errors only.
 *
 * A template author cares about the *contract* with ffmpeg: what
 * args went in (ffmpeg-boundary) and whether anything went wrong
 * coming back out (ffmpeg warn/error). They generally don't care
 * about ffmpeg's running commentary (info, trace) — that's a "how
 * does ffmpeg render this" concern, not a "is my template doing
 * the right thing" concern. For that level of detail, use
 * {@link masochistTierMap}.
 */
export const templateDevTierMap: TierLevelMap = {
  m0saic: true,
  template: true,
  "ffmpeg-boundary": true,
  ffmpeg: "warn",
};

export const templateDevPredicate = (): MosaicTelemetryPredicate =>
  byTierLevel(templateDevTierMap);

/**
 * Masochist — every tier, every level, including ffmpeg trace and
 * info. The "I want to see literally everything" preset.
 *
 * # Practical note: this is a disk-target persona, not a terminal one
 *
 * A masochist-tier capture produces enough volume that a live
 * terminal can't render it usefully — the stream becomes a wall of
 * scrolling text faster than a human can read. The intended target
 * is a JSON / NDJSON file: spin up a {@link fanoutSink} where one
 * inner is the on-disk dump and the other is your usual terminal
 * sink wrapped with a saner persona (`template-dev` etc.) so the
 * live view stays legible while the full transcript lands on disk
 * for post-render analysis.
 *
 * Right call when reproducing a bug that depends on specific ffmpeg
 * internal state, or building an offline analysis pipeline that
 * post-processes traces.
 */
export const masochistTierMap: TierLevelMap = {
  m0saic: true,
  template: true,
  "ffmpeg-boundary": true,
  ffmpeg: true,
};

export const masochistPredicate = (): MosaicTelemetryPredicate =>
  byTierLevel(masochistTierMap);

/**
 * App user watching a render — engine narration + replay anchors +
 * template info events. Drops template trace (too noisy for a
 * watching-a-render UI) and raw ffmpeg stderr. Includes
 * `ffmpeg-boundary` so a "save log" button can capture enough to
 * reproduce the render offline.
 */
export const appViewerTierMap: TierLevelMap = {
  m0saic: "info",
  template: "info",
  "ffmpeg-boundary": true,
  // ffmpeg tier dropped — UI doesn't need stderr in real time
};

export const appViewerPredicate = (): MosaicTelemetryPredicate =>
  byTierLevel(appViewerTierMap);

/**
 * Batch operator — engine summary + template warnings + ffmpeg
 * errors only. Drops replay anchors (batch rendering doesn't
 * reproduce single failures by hand) and template info chatter
 * (too noisy at scale — surface only template warnings/errors).
 */
export const batchOperatorTierMap: TierLevelMap = {
  m0saic: "info",
  template: "warn",
  ffmpeg: "error",
};

export const batchOperatorPredicate = (): MosaicTelemetryPredicate =>
  byTierLevel(batchOperatorTierMap);

/**
 * OSS quiet — errors only, every tier. The "I just want to know if
 * something broke" preset for CI / cron / one-off renders.
 */
export const ossQuietTierMap: TierLevelMap = {
  m0saic: "error",
  template: "error",
  // ffmpeg-boundary has no error level; drop the tier entirely for "quiet"
  ffmpeg: "error",
};

export const ossQuietPredicate = (): MosaicTelemetryPredicate =>
  byTierLevel(ossQuietTierMap);

/**
 * Apply a persona predicate to `sink`. Equivalent to
 * `filterSink(sink, persona())`.
 */
export const applyPersonaPredicate = (
  sink: MosaicTelemetrySink,
  predicate: MosaicTelemetryPredicate,
): MosaicTelemetrySink => filterSink(sink, predicate);

/**
 * Persona id → predicate factory. The closed map keeps persona ids
 * exhaustive at the type level so future CLI flags get static checking.
 */
export type MosaicTelemetryPersonaId =
  | "template-dev"
  | "masochist"
  | "app-viewer"
  | "batch-operator"
  | "oss-quiet";

export const personaTierMap: Record<MosaicTelemetryPersonaId, TierLevelMap> = {
  "template-dev": templateDevTierMap,
  masochist: masochistTierMap,
  "app-viewer": appViewerTierMap,
  "batch-operator": batchOperatorTierMap,
  "oss-quiet": ossQuietTierMap,
};

export const personaPredicate: Record<
  MosaicTelemetryPersonaId,
  () => MosaicTelemetryPredicate
> = {
  "template-dev": templateDevPredicate,
  masochist: masochistPredicate,
  "app-viewer": appViewerPredicate,
  "batch-operator": batchOperatorPredicate,
  "oss-quiet": ossQuietPredicate,
};

/**
 * Resolve a persona id directly into a `filterSink`-wrapped sink.
 */
export const withPersona = (
  sink: MosaicTelemetrySink,
  persona: MosaicTelemetryPersonaId,
): MosaicTelemetrySink => filterSink(sink, personaPredicate[persona]());
