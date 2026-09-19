import type { MosaicTelemetryEvent } from "../telemetry/event";
import type { MosaicAnalyticsEvent } from "./event";
import type { MosaicAnalyticsConsent } from "./consent";
import type { MosaicAnalyticsScrambler } from "./redaction";

/**
 * The single boundary between rich local telemetry and what gets
 * uploaded. Takes a telemetry event + the install's consent state
 * and returns either an analytics event (safe to upload) or `null`
 * (this telemetry event has no analytics equivalent, or the user
 * opted out, or the relevant channel is disabled).
 *
 * # Design properties
 *
 *  - **Pure function.** Given the same inputs, returns the same
 *    output. No I/O, no clock reads, no state. The redactor is
 *    repeatedly invocable for a "preview what we'd send" UI without
 *    side effects.
 *  - **Single boundary.** Every telemetry-to-analytics conversion
 *    goes through this one function. A privacy audit reads one
 *    function signature and one implementation.
 *  - **Type-level firewall.** The output type forbids carrying
 *    template ids, file paths, free-form messages, ffmpeg argv,
 *    or stderr lines (see {@link MosaicAnalyticsEvent}). Even a
 *    buggy redactor cannot produce an analytics event that
 *    contains those values — they have no slot to go in.
 *  - **Consent-aware.** Returns `null` when
 *    `consent.mode === "opted-out"` (the only top-level hard stop;
 *    see {@link isAnalyticsEmissionEnabled}), when the relevant
 *    channel is off in `consent.channels`, or when the event has
 *    no analytics equivalent. The caller never has to wrap the
 *    redactor in its own consent check.
 *
 *    `"undecided"` and `"opted-in"` both permit emission — m0saic
 *    defaults to opt-out, not opt-in. See
 *    {@link MosaicAnalyticsConsentMode} for the rationale.
 *
 * # Direct-emit events
 *
 * Some analytics events (`install_completed`, `update_completed`)
 * do not derive from a telemetry event — they're emitted at
 * lifecycle boundaries the engine doesn't observe. Those bypass
 * this redactor and are constructed in-place by the lifecycle
 * code, then passed straight to the appropriate sink. The
 * type-level firewall (the analytics event union) still applies
 * — they just don't go through a `MosaicTelemetryEvent` first.
 */
export type MosaicAnalyticsRedactor = (
  event: MosaicTelemetryEvent,
  consent: MosaicAnalyticsConsent,
  /**
   * Scrambler instance for this install. Provided by the caller
   * (typically pre-seeded with `consent.installId`) so the
   * redactor can apply deterministic scrambling without owning
   * the salt itself.
   */
  scrambler: MosaicAnalyticsScrambler,
) => MosaicAnalyticsEvent | null;
