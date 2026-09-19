import * as crypto from "crypto";
import * as fs from "fs";
import type {
  EffectiveTelemetryMode,
  MosaicTelemetryMode,
  MosaicTelemetrySettingsFile,
} from "@m0saic/types";
import {
  asInstallId,
  defaultTelemetrySettings,
  isMosaicTelemetrySettingsFile,
  normalizeTelemetryModeInput,
  resolveEffectiveTelemetryMode,
  DEFAULT_ANALYTICS_CONSENT,
} from "@m0saic/types";
import { ensureDir } from "../paths/m0saicRoot";
import { purgeOutbox } from "./outbox";
import { getTelemetryRoot, getTelemetrySettingsPath } from "./paths";

/** Env var that overrides the persisted mode for this process. */
export const TELEMETRY_MODE_ENV = "M0SAIC_TELEMETRY";
/** Consumer do-not-track convention (https://consoledonottrack.com). */
export const DO_NOT_TRACK_ENV = "DO_NOT_TRACK";

/**
 * Load the shared telemetry settings file, minting it (new
 * `installId`, default consent, mode `standard`) on first touch.
 *
 * Minting happens in EVERY mode including ghost — the file is
 * configuration (how to behave), not telemetry data; it must exist
 * for the mode to be knowable at all. Ghost's "zero telemetry fs"
 * promise covers records / outbox, not this config file.
 *
 * Never throws:
 *  - unreadable / unparseable / structurally-invalid file → renamed
 *    to `settings.json.bak` (best effort) and a fresh default is
 *    minted in its place;
 *  - a failing save degrades to returning the in-memory defaults
 *    (mode resolution still works; the installId won't persist).
 */
/**
 * A channel added after a settings file was written is absent from that
 * file; read it as its default so the default applies to
 * existing installs too. Read-time only — the file is rewritten on the
 * next explicit save.
 */
const withChannelDefaults = (
  settings: MosaicTelemetrySettingsFile,
): MosaicTelemetrySettingsFile => ({
  ...settings,
  consent: {
    ...settings.consent,
    channels: {
      ...DEFAULT_ANALYTICS_CONSENT(settings.consent.installId).channels,
      ...settings.consent.channels,
    },
  },
});

export function loadTelemetrySettings(): MosaicTelemetrySettingsFile {
  const file = getTelemetrySettingsPath();
  let raw: string | undefined;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    raw = undefined;
  }
  if (raw !== undefined) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isMosaicTelemetrySettingsFile(parsed)) return withChannelDefaults(parsed);
    } catch {
      /* corrupt JSON — fall through to .bak + re-mint */
    }
    try {
      fs.renameSync(file, `${file}.bak`);
    } catch {
      /* best effort */
    }
  }
  const fresh = defaultTelemetrySettings(
    asInstallId(crypto.randomUUID()),
    new Date().toISOString(),
  );
  try {
    saveTelemetrySettings(fresh);
  } catch {
    /* degraded: in-memory defaults only */
  }
  return fresh;
}

/**
 * Persist the settings file atomically (tmp + rename, per the
 * JobStore pattern). Throws on fs failure — explicit settings writes
 * (set-mode, notice marking) surface errors to their caller;
 * {@link loadTelemetrySettings} wraps its internal mint-save itself.
 */
export function saveTelemetrySettings(next: MosaicTelemetrySettingsFile): void {
  const file = getTelemetrySettingsPath();
  ensureDir(getTelemetryRoot());
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

/**
 * Set the persisted 3-way mode, keeping `consent.mode` coherent:
 * `standard` → `"opted-in"`, `local`/`ghost` → `"opted-out"` — and
 * stamping `consent.decidedAt` (this IS the user's consent decision,
 * per the `MosaicAnalyticsConsent` lifecycle).
 *
 * Switching away from `standard` also purges the upstream outbox —
 * "opts out at any point → pending queues are cleared" (consent.ts).
 * The sent/ archive is history and stays.
 */
export function setTelemetryMode(
  mode: MosaicTelemetryMode,
  nowIso: string = new Date().toISOString(),
): MosaicTelemetrySettingsFile {
  const current = loadTelemetrySettings();
  const next: MosaicTelemetrySettingsFile = {
    ...current,
    mode,
    consent: {
      ...current.consent,
      mode: mode === "standard" ? "opted-in" : "opted-out",
      decidedAt: nowIso,
    },
  };
  saveTelemetrySettings(next);
  if (mode !== "standard") {
    try {
      purgeOutbox();
    } catch {
      /* best effort */
    }
  }
  return next;
}

/**
 * Toggle upstream channels (rollup / errorReports / lifecycle) on the
 * persisted consent. Partial patch; returns the saved file.
 */
export function setTelemetryChannels(
  patch: Partial<MosaicTelemetrySettingsFile["consent"]["channels"]>,
): MosaicTelemetrySettingsFile {
  const current = loadTelemetrySettings();
  const next: MosaicTelemetrySettingsFile = {
    ...current,
    consent: {
      ...current.consent,
      channels: { ...current.consent.channels, ...patch },
    },
  };
  saveTelemetrySettings(next);
  return next;
}

/**
 * Stamp the one-time first-run notice as shown. Shared file →
 * whichever surface (CLI or app) shows it first suppresses the
 * other. Idempotent: an existing stamp is preserved.
 */
export function markFirstRunNoticeShown(
  nowIso: string = new Date().toISOString(),
): MosaicTelemetrySettingsFile {
  const current = loadTelemetrySettings();
  if (current.firstRunNoticeAt !== undefined) return current;
  const next: MosaicTelemetrySettingsFile = {
    ...current,
    firstRunNoticeAt: nowIso,
  };
  saveTelemetrySettings(next);
  return next;
}

/**
 * Resolve the in-effect mode for this process.
 *
 * When `M0SAIC_TELEMETRY` parses to a valid mode the settings file is
 * NOT read (or minted) at all — an env-forced ghost (CI, scripts)
 * leaves a pristine machine untouched. Otherwise the file supplies
 * the mode (minting on first touch). `DO_NOT_TRACK` degradation
 * applies in both paths.
 */
export function getEffectiveTelemetryMode(
  env: NodeJS.ProcessEnv = process.env,
): EffectiveTelemetryMode {
  const envMode = env[TELEMETRY_MODE_ENV];
  const doNotTrack = env[DO_NOT_TRACK_ENV];
  if (envMode !== undefined && normalizeTelemetryModeInput(envMode) !== undefined) {
    return resolveEffectiveTelemetryMode({ envMode, doNotTrack });
  }
  const settings = loadTelemetrySettings();
  return resolveEffectiveTelemetryMode({
    fileMode: settings.mode,
    envMode,
    doNotTrack,
  });
}
