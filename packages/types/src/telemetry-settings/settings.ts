import type { InstallId } from "../identifiers/identifiers";
import { isInstallId } from "../identifiers/identifiers";
import type { MosaicAnalyticsConsent } from "../analytics/consent";
import { DEFAULT_ANALYTICS_CONSENT } from "../analytics/consent";
import type { MosaicRenderOutcome } from "../analytics/event";
import type { EffectiveTelemetryMode, MosaicTelemetryMode } from "./mode";
import type { MosaicUpstreamEndpointSource } from "./upstream";
import { DEFAULT_TELEMETRY_MODE, isMosaicTelemetryMode } from "./mode";

/** Bumped when the settings file shape changes incompatibly. */
export const TELEMETRY_SETTINGS_SCHEMA_VERSION = 1;

/**
 * The ONE shared telemetry settings file —
 * `<m0saic-root>/telemetry/settings.json` — read and written by both
 * the CLI and the desktop app (same rendezvous technique as
 * `momo/bridge.json` / `license.json`).
 *
 * Holds the user's 3-way {@link MosaicTelemetryMode} plus the full
 * {@link MosaicAnalyticsConsent} (which carries the minted
 * `installId`, per-channel toggles, and redaction treatments) and
 * small lifecycle bookkeeping.
 *
 * Coherence contract (enforced by the platform settings store, not
 * by this type): setting the mode keeps `consent.mode` in step —
 * `standard` → `"opted-in"`, `local`/`ghost` → `"opted-out"` — and
 * stamps `consent.decidedAt`. A pristine default file is the one
 * exception: mode `standard` with consent `"undecided"`, so
 * informed-consent rates stay trackable.
 */
export type MosaicTelemetrySettingsFile = {
  schemaVersion: typeof TELEMETRY_SETTINGS_SCHEMA_VERSION;
  /** The persisted user choice. Env overrides never write here. */
  mode: MosaicTelemetryMode;
  /** Full analytics consent, including the install's `installId`. */
  consent: MosaicAnalyticsConsent;
  /**
   * Last m0saic version this install ran (full semver). Drives the
   * `update_completed` lifecycle event on major.minor change.
   */
  lastSeenVersion?: string;
  /**
   * When the one-time telemetry notice was shown (ISO 8601 UTC).
   * Shared between CLI and app — whichever surface shows it first
   * suppresses the other.
   */
  firstRunNoticeAt?: string;
  /** When this file was first minted (ISO 8601 UTC). */
  createdAt: string;
  /** Upstream-pipeline bookkeeping (absent until the first enqueue). */
  upstream?: {
    /**
     * UTC day (`YYYY-MM-DD`) through which daily rollups have been
     * enqueued. The next rollup window starts the day after.
     */
    lastRollupDayUtc?: string;
    /**
     * Epoch ms of the last flush worker the CLI spawned because of a
     * command counter (not a render). The CLI throttles those to once an
     * hour; the enqueue itself still happens on every command.
     */
    lastUsageFlushAtMs?: number;
    /**
     * Optional configured ingest endpoint. Resolution order:
     * `M0SAIC_TELEMETRY_ENDPOINT` env (`off` = force dormant) → this
     * field → the host-registered default (published builds only) →
     * none = DORMANT (outbox accumulates, nothing sends).
     */
    endpoint?: string;
  };
};

/**
 * The default file minted on first touch: mode `standard`, consent
 * per {@link DEFAULT_ANALYTICS_CONSENT} (undecided; rollup +
 * lifecycle on, error reports off, most-private redactions).
 */
export const defaultTelemetrySettings = (
  installId: InstallId,
  nowIso: string,
): MosaicTelemetrySettingsFile => ({
  schemaVersion: TELEMETRY_SETTINGS_SCHEMA_VERSION,
  mode: DEFAULT_TELEMETRY_MODE,
  consent: DEFAULT_ANALYTICS_CONSENT(installId),
  createdAt: nowIso,
});

const CONSENT_MODES = ["undecided", "opted-in", "opted-out"] as const;

/**
 * Structural guard for a parsed settings file. Used by the platform
 * store to detect corrupt / foreign JSON before trusting it (a
 * failing file is renamed to `.bak` and re-minted). Checks the
 * load-bearing fields only — unknown extra fields are tolerated for
 * forward compatibility.
 */
export const isMosaicTelemetrySettingsFile = (
  v: unknown,
): v is MosaicTelemetrySettingsFile => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.schemaVersion !== TELEMETRY_SETTINGS_SCHEMA_VERSION) return false;
  if (!isMosaicTelemetryMode(o.mode)) return false;
  if (typeof o.createdAt !== "string") return false;
  const consent = o.consent as Record<string, unknown> | undefined;
  if (typeof consent !== "object" || consent === null) return false;
  if (!isInstallId(consent.installId)) return false;
  if (!(CONSENT_MODES as readonly unknown[]).includes(consent.mode)) {
    return false;
  }
  if (typeof consent.channels !== "object" || consent.channels === null) {
    return false;
  }
  return true;
};

/**
 * Status payload shared by `m0saic telemetry status` and the
 * `mosaic:telemetry:getStatus` IPC — everything a settings surface
 * needs to render the current state without further reads.
 */
export type MosaicTelemetryStatus = {
  /** Resolved in-effect mode (post env override, post DNT). */
  effective: EffectiveTelemetryMode;
  /** The persisted file mode (what the settings switch edits). */
  fileMode: MosaicTelemetryMode;
  /** The install's anonymous id (shown so the user knows what "us seeing you" means). */
  installId: string;
  /** Whether the one-time first-run notice has already been shown (either surface). */
  firstRunNoticeShown: boolean;
  /** Local history totals. */
  counts: {
    total: number;
    byOutcome: Partial<Record<MosaicRenderOutcome, number>>;
    /** Local feature-usage events on disk (present once the usage store ships). */
    usageEvents?: number;
  };
  /** Local telemetry disk footprint. */
  disk: { bytes: number; files: number };
  /** Where everything lives, for the "open folder" affordance. */
  paths: { root: string; settingsFile: string; rendersDir: string };
  /** Upstream queue depths (present once the upstream pipeline ships). */
  outbox?: { pending: number; sentArchived: number };
  /** Upstream endpoint state (present once the upstream pipeline ships). */
  endpoint?: { configured: boolean; source?: MosaicUpstreamEndpointSource };
};
