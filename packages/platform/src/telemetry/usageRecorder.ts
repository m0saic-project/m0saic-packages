import type { MosaicTelemetrySurface, MosaicTemplateKind, MosaicUsageRecord } from "@m0saic/types";
import {
  FIRST_PARTY_TEMPLATE_ID_RE,
  MAX_TEMPLATE_ID_CHARS,
  TELEMETRY_USAGE_RECORD_SCHEMA_VERSION,
  isFeatureKeyShaped,
} from "@m0saic/types";
import { getEffectiveTelemetryMode } from "./settingsStore";
import { appendUsageRecord } from "./usageStore";

/**
 * Feature-usage recording for hosts (desktop main, CLI). Same contract
 * as the render recorder: never throws, fully inert in ghost mode
 * (mode resolved BEFORE any telemetry fs). This package is public and
 * knows only the SHAPE of a feature key (`isFeatureKeyShaped`); the
 * closed enum lives with the hosts (`@m0saic/types-internal`) and is
 * enforced at their boundary and on the server, which rejects unknown
 * keys. Layout shares are an ordinary `share.layout.copy` count: no
 * layout string, canvas size or shape is recorded or sent.
 */

export type RecordFeatureUsageOpts = {
  surface: MosaicTelemetrySurface;
  /** A member of the host's closed enum; anything not key-shaped is dropped here. */
  feature: string;
  /** Kept only when `templateKind === "builtin"` and the id is first-party shaped. */
  templateId?: string;
  templateKind?: MosaicTemplateKind;
  env?: NodeJS.ProcessEnv;
  nowMs?: number;
  /** Injectable append target for tests. */
  append?: (record: MosaicUsageRecord) => void;
};

/**
 * Count one feature use. Returns the written record, or null when the
 * key is not key-shaped or the effective mode is ghost. Local-only and standard
 * modes both record (the rollup decides what leaves).
 */
export function recordFeatureUsage(opts: RecordFeatureUsageOpts): MosaicUsageRecord | null {
  try {
    if (!isFeatureKeyShaped(opts.feature)) return null;
    if (getEffectiveTelemetryMode(opts.env).mode === "ghost") return null;
    const keepId =
      opts.templateKind === "builtin" &&
      opts.templateId !== undefined &&
      opts.templateId.length <= MAX_TEMPLATE_ID_CHARS &&
      FIRST_PARTY_TEMPLATE_ID_RE.test(opts.templateId);
    const record: MosaicUsageRecord = {
      schemaVersion: TELEMETRY_USAGE_RECORD_SCHEMA_VERSION,
      atMs: opts.nowMs ?? Date.now(),
      surface: opts.surface,
      feature: opts.feature,
      ...(opts.templateKind !== undefined ? { templateKind: opts.templateKind } : {}),
      ...(keepId ? { templateId: opts.templateId } : {}),
    };
    (opts.append ?? appendUsageRecord)(record);
    return record;
  } catch {
    return null;
  }
}
