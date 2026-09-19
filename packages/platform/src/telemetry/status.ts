import type { MosaicTelemetryStatus } from "@m0saic/types";
import { resolveEffectiveTelemetryMode } from "@m0saic/types";
import { listOutbox, listSent } from "./outbox";
import {
  getTelemetryRendersDir,
  getTelemetryRoot,
  getTelemetrySettingsPath,
} from "./paths";
import { countRenderRecords, getTelemetryDiskUsage } from "./recordStore";
import { countUsageRecords } from "./usageStore";
import { resolveUpstreamEndpoint } from "./sender";
import {
  DO_NOT_TRACK_ENV,
  TELEMETRY_MODE_ENV,
  loadTelemetrySettings,
} from "./settingsStore";

/**
 * One-call status snapshot for `m0saic telemetry` and the
 * `mosaic:telemetry:getStatus` IPC. Loads (minting on first touch)
 * the settings file, resolves the effective mode against `env`, and
 * tallies the local store.
 *
 * The upstream fields (`outbox` / `endpoint`) are added by the
 * Phase-6 pipeline; until then they are absent.
 */
export function getTelemetryStatus(
  env: NodeJS.ProcessEnv = process.env,
): MosaicTelemetryStatus {
  const settings = loadTelemetrySettings();
  const effective = resolveEffectiveTelemetryMode({
    fileMode: settings.mode,
    envMode: env[TELEMETRY_MODE_ENV],
    doNotTrack: env[DO_NOT_TRACK_ENV],
  });
  const endpoint = resolveUpstreamEndpoint({ env, settings });
  return {
    effective,
    fileMode: settings.mode,
    installId: settings.consent.installId,
    firstRunNoticeShown: settings.firstRunNoticeAt !== undefined,
    counts: { ...countRenderRecords(), usageEvents: countUsageRecords() },
    disk: getTelemetryDiskUsage(),
    paths: {
      root: getTelemetryRoot(),
      settingsFile: getTelemetrySettingsPath(),
      rendersDir: getTelemetryRendersDir(),
    },
    outbox: { pending: listOutbox().length, sentArchived: listSent().length },
    endpoint: {
      configured: endpoint.endpoint !== undefined,
      ...(endpoint.source !== undefined ? { source: endpoint.source } : {}),
    },
  };
}
