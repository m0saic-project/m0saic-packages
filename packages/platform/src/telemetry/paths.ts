import * as path from "path";
import { getM0saicRoot } from "../paths/m0saicRoot";

/**
 * On-disk layout for telemetry, under the shared m0saic data root
 * (`~/m0saic` or `$M0SAIC_ROOT` — the same user-visible, no-dot root
 * as `license.json` and `momo/bridge.json`, so the CLI and the
 * desktop app resolve identical paths):
 *
 *   <root>/telemetry/settings.json          mode + consent + installId
 *   <root>/telemetry/renders/YYYY-MM.jsonl  append-only render records
 *   <root>/telemetry/usage/YYYY-MM.jsonl    append-only feature-usage events
 *   <root>/telemetry/outbox/                pending upstream payloads
 *   <root>/telemetry/sent/                  archive of sent payloads
 *
 * All helpers compute lazily per call (matching `getM0saicRoot`) so
 * tests and hosts can flip `M0SAIC_ROOT` at any time.
 */
export function getTelemetryRoot(): string {
  return path.join(getM0saicRoot(), "telemetry");
}

/** The one shared settings/consent file. */
export function getTelemetrySettingsPath(): string {
  return path.join(getTelemetryRoot(), "settings.json");
}

/** Directory of monthly render-record JSONL files. */
export function getTelemetryRendersDir(): string {
  return path.join(getTelemetryRoot(), "renders");
}

/** Pending upstream payloads (one JSON file each). */
export function getTelemetryOutboxDir(): string {
  return path.join(getTelemetryRoot(), "outbox");
}

/** Successfully-sent payloads — the transparency ledger. */
export function getTelemetrySentDir(): string {
  return path.join(getTelemetryRoot(), "sent");
}

/** Directory of monthly feature-usage JSONL files (counted into rollups). */
export function getTelemetryUsageDir(): string {
  return path.join(getTelemetryRoot(), "usage");
}
