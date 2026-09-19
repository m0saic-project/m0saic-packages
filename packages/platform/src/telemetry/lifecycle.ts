import type { MosaicAnalyticsImmediateEvent } from "@m0saic/types";
import { isAnalyticsEmissionEnabled, isUpstreamAllowed } from "@m0saic/types";
import { buildHostFingerprint } from "./hostFingerprint";
import { enqueueOutbox } from "./outbox";
import { versionMajorMinor } from "./renderRecord";
import {
  getEffectiveTelemetryMode,
  loadTelemetrySettings,
  saveTelemetrySettings,
} from "./settingsStore";

/**
 * Lifecycle channel (direct-emit — bypasses the redactor by design):
 *
 *  - `install_completed` — once, the first maintenance pass on a fresh
 *    settings file (`lastSeenVersion` unset).
 *  - `update_completed` — when the host's major.minor moves past the
 *    recorded `lastSeenVersion`.
 *
 * Sync + disk-only (enqueue; the sender transmits). Gated on
 * effective-standard + the lifecycle channel; `lastSeenVersion` is
 * ALWAYS advanced (even when gated) so a later opt-in doesn't
 * retro-fire stale update events.
 */
export function checkAndEnqueueLifecycle(opts: {
  currentVersion: string;
  nowMs?: number;
  env?: NodeJS.ProcessEnv;
}): { enqueued: "install_completed" | "update_completed" | null } {
  const nowMs = opts.nowMs ?? Date.now();
  // Ghost promises ZERO telemetry fs — resolve the mode BEFORE any
  // settings load (an env-forced ghost must not even mint the file).
  // Version bookkeeping simply doesn't happen in ghost; when the user
  // later switches to standard, install_completed fires then — the
  // first moment telemetry is actually active.
  const effective = getEffectiveTelemetryMode(opts.env);
  if (effective.mode === "ghost") return { enqueued: null };
  const settings = loadTelemetrySettings();
  const fresh = settings.lastSeenVersion === undefined;
  const fromMm = versionMajorMinor(settings.lastSeenVersion);
  const toMm = versionMajorMinor(opts.currentVersion);
  const moved = !fresh && fromMm !== undefined && toMm !== undefined && fromMm !== toMm;

  if (settings.lastSeenVersion !== opts.currentVersion) {
    saveTelemetrySettings({ ...settings, lastSeenVersion: opts.currentVersion });
  }
  if (!fresh && !moved) return { enqueued: null };

  if (!isUpstreamAllowed(effective.mode)) return { enqueued: null };
  if (
    !isAnalyticsEmissionEnabled(settings.consent) ||
    !settings.consent.channels.lifecycle
  ) {
    return { enqueued: null };
  }

  const host = buildHostFingerprint({ mosaicVersion: opts.currentVersion });
  const base = {
    installId: settings.consent.installId,
    timestamp: nowMs,
    schemaVersion: 1 as const,
    host,
  };
  const event: MosaicAnalyticsImmediateEvent = fresh
    ? { kind: "install_completed", ...base }
    : {
        kind: "update_completed",
        ...base,
        fromVersion: fromMm ?? "0.0",
        toVersion: toMm ?? "0.0",
      };
  enqueueOutbox(event, { channel: "immediate", nowMs });
  return { enqueued: event.kind };
}
