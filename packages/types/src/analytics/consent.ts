import type { InstallId } from "../identifiers/identifiers";
import type { MosaicAnalyticsRedactionConfig } from "./redaction";

/**
 * High-level consent mode. Drives whether analytics emits anything
 * at all.
 *
 * # Default-emit model
 *
 * m0saic defaults to **opt-out**, not opt-in. A freshly-installed
 * client emits per the sensible defaults in
 * {@link DEFAULT_ANALYTICS_CONSENT} — rollup + lifecycle channels
 * on, error reports off, deterministic scrambling, most-private
 * redaction treatments. The telemetry page exists and is fully
 * discoverable; it's just not advertised.
 *
 * Only `"opted-out"` is a hard stop. `"undecided"` and `"opted-in"`
 * both emit per the per-channel toggles in
 * {@link MosaicAnalyticsChannelConsent}.
 *
 * - `"undecided"` — install hasn't actively engaged with the
 *   telemetry page. Emits per the defaults above. Distinct from
 *   `"opted-in"` so the operator can track informed-consent rates
 *   ("what % of installs have actively reviewed telemetry settings")
 *   without conflating them with active opt-ins.
 * - `"opted-in"` — user has visited the telemetry page and
 *   affirmatively kept analytics on (possibly with customized
 *   `channels` / `redactions`). Functionally equivalent to
 *   `"undecided"` for emission, but represents an explicit choice.
 * - `"opted-out"` — analytics is fully off. The redactor returns
 *   `null` for every event regardless of channel state; no upload
 *   sink ever sees a payload.
 *
 * Use {@link isAnalyticsEmissionEnabled} to test whether emission
 * is permitted in code — don't compare `mode` directly.
 */
export type MosaicAnalyticsConsentMode =
  | "undecided"
  | "opted-in"
  | "opted-out";

/**
 * Per-channel opt-in state. Each channel can be independently
 * toggled when overall consent is `"opted-in"`.
 *
 * - `rollup` — the default-on aggregate channel. Daily counters
 *   + dimensional histograms. The recommended baseline.
 * - `errorReports` — the per-event error channel. Opt-in by
 *   default. Useful for the operator catching ffmpeg regressions
 *   across the fleet; off-by-default keeps the privacy story
 *   "you can use m0saic for years without ever sending us a
 *   single error".
 * - `lifecycle` — per-event `install_completed` / `update_completed`
 *   notifications. Low frequency, helps the operator see install
 *   counts and update adoption.
 */
export type MosaicAnalyticsChannelConsent = {
  rollup: boolean;
  errorReports: boolean;
  lifecycle: boolean;
};

/**
 * Scrambling mode for identifiers in analytics payloads.
 *
 * - `"off"` — no scrambling. Implies the user is sending the raw
 *   value where the redaction config allows it. Generally only
 *   makes sense for power-users debugging their own dashboards.
 * - `"deterministic"` — values are scrambled through a stable hash
 *   keyed by the install (typically `installId` itself). The same
 *   real template id always scrambles to the same scrambled id, so
 *   the operator can see "how many distinct templates" without
 *   seeing which. Reversible only with the install's local key,
 *   which the operator never receives.
 * - `"random"` — every scramble call produces a fresh random
 *   value. Maximum unlinkability at the cost of "how many distinct
 *   templates" information being unrecoverable.
 *
 * `"deterministic"` is the recommended default — it preserves the
 * dimensional structure of the data (distinct-template counts,
 * per-template-class histograms) without revealing identities.
 */
export type MosaicAnalyticsScramblingMode =
  | "off"
  | "deterministic"
  | "random";

/**
 * The full consent state for an install. Persisted in local config;
 * the consent UI is a renderer for this struct. The redactor reads
 * it to decide whether a given telemetry event becomes an analytics
 * event, and which fields of that event carry which redaction
 * treatment.
 *
 * # Lifecycle
 *
 *  1. Install starts → `mode === "undecided"` → emits per defaults
 *     (rollup + lifecycle on, errorReports off, deterministic
 *     scrambling, most-private redactions)
 *  2. User visits the telemetry page → on save, `mode` flips to
 *     `"opted-in"` or `"opted-out"` and `decidedAt` is stamped
 *  3. User adjusts knobs on the telemetry page → fields update;
 *     subsequent emits respect the new state
 *  4. User opts out at any point → `mode = "opted-out"` → emits
 *     immediately stop; pending queues are cleared
 *
 * # Forward compatibility (accounts)
 *
 * Currently install-only — `installId` is the sole identifier
 * carried on analytics events. When accounts ship, an optional
 * `accountId` field is added to this struct; the redactor decides
 * per-event whether to attach it. Adding the field is a
 * non-breaking change.
 */
export type MosaicAnalyticsConsent = {
  mode: MosaicAnalyticsConsentMode;
  /** Stable anonymous identifier for this install. */
  installId: InstallId;
  /** Per-channel toggles. Ignored when `mode === "opted-out"`. */
  channels: MosaicAnalyticsChannelConsent;
  /** Per-field redaction treatments. See {@link MosaicAnalyticsRedactionConfig}. */
  redactions: MosaicAnalyticsRedactionConfig;
  /** Identifier scrambling mode. See {@link MosaicAnalyticsScramblingMode}. */
  scrambling: MosaicAnalyticsScramblingMode;
  /**
   * When the user last made a consent decision. ISO 8601 UTC.
   * Used to prompt re-consent after a major schema change or
   * after a long idle period.
   */
  decidedAt?: string;
};

/**
 * Sensible default for a freshly-installed m0saic. Emits per the
 * defaults below — rollup + lifecycle on, error reports off,
 * deterministic scrambling, most-private redaction treatments. The
 * install is in `"undecided"` mode (hasn't actively engaged with
 * the telemetry page) but is emitting; only an explicit opt-out
 * blocks emission.
 */
export const DEFAULT_ANALYTICS_CONSENT = (
  installId: InstallId,
): MosaicAnalyticsConsent => ({
  mode: "undecided",
  installId,
  channels: {
    rollup: true,
    errorReports: false,
    lifecycle: true,
  },
  redactions: {
    templateIds: "scramble",
    filePaths: "drop",
    errorMessages: "drop",
    ffmpegArgs: "drop",
    stderrLines: "drop",
  },
  scrambling: "deterministic",
});

/**
 * Whether emission is permitted for an install. The rule is simple
 * by design: only an explicit opt-out blocks emission. `"undecided"`
 * and `"opted-in"` both pass.
 *
 * Use this everywhere instead of comparing `consent.mode` directly
 * so the rule lives in one place — flipping the default model later
 * (if it ever does) is then a one-line change.
 *
 * Per-channel toggles in `consent.channels` are evaluated separately
 * at the redactor; this helper only answers the top-level question.
 */
export const isAnalyticsEmissionEnabled = (
  consent: MosaicAnalyticsConsent,
): boolean => consent.mode !== "opted-out";
