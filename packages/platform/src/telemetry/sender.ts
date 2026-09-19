import type {
  MosaicFlushResult,
  MosaicTelemetrySettingsFile,
  MosaicUpstreamEndpointSource,
} from "@m0saic/types";
import { isUpstreamAllowed } from "@m0saic/types";
import { checkAndEnqueueLifecycle } from "./lifecycle";
import { listOutbox, markSent, updateOutboxEntry } from "./outbox";
import { maybeEnqueueDailyRollup, maybeEnqueueTodayRollup } from "./rollup";
import {
  getEffectiveTelemetryMode,
  loadTelemetrySettings,
} from "./settingsStore";
import { getUpstreamDefaults } from "./upstreamDefaults";

/** Env override for the ingest endpoint (`off` = force dormant). */
export const TELEMETRY_ENDPOINT_ENV = "M0SAIC_TELEMETRY_ENDPOINT";
/** Env override for the shared ingest key. */
export const TELEMETRY_INGEST_KEY_ENV = "M0SAIC_TELEMETRY_INGEST_KEY";
/** `M0SAIC_TELEMETRY_ENDPOINT=off` → dormant even with a registered default. */
export const TELEMETRY_ENDPOINT_OFF = "off";
/** Request headers the ingest route reads. */
export const TELEMETRY_INGEST_KEY_HEADER = "x-m0saic-ingest-key";
export const TELEMETRY_EVENT_ID_HEADER = "x-m0saic-event-id";
/** CI runners mint a fresh install id per job — never count them. */
export const CI_ENV = "CI";

const BACKOFF_BASE_MS = 3_600_000; // 1h · 2^attempts
const BACKOFF_MAX_MS = 7 * 86_400_000; // 7d
const POST_TIMEOUT_MS = 5_000;
/**
 * Statuses that mean "the body itself is bad" — a redeploy cannot fix
 * them, so the entry is archived as rejected and never retried. Every
 * other failure (401 key typo, 429, 5xx, network) keeps the payload and
 * backs off; the server can be fixed and the data still arrives.
 */
const DROP_STATUSES: ReadonlySet<number> = new Set([400, 413, 415, 422]);

export function resolveUpstreamEndpoint(opts: {
  env?: NodeJS.ProcessEnv;
  settings?: MosaicTelemetrySettingsFile;
} = {}): { endpoint?: string; source?: MosaicUpstreamEndpointSource } {
  const env = opts.env ?? process.env;
  const fromEnv = env[TELEMETRY_ENDPOINT_ENV]?.trim();
  if (fromEnv !== undefined && fromEnv !== "") {
    if (fromEnv.toLowerCase() === TELEMETRY_ENDPOINT_OFF) return { source: "off" };
    return { endpoint: fromEnv, source: "env" };
  }
  const fromSettings = opts.settings?.upstream?.endpoint?.trim();
  if (fromSettings !== undefined && fromSettings !== "") {
    return { endpoint: fromSettings, source: "settings" };
  }
  const fromDefault = getUpstreamDefaults()?.endpoint?.trim();
  if (fromDefault !== undefined && fromDefault !== "") {
    return { endpoint: fromDefault, source: "default" };
  }
  return {};
}

/** Ingest key: env override → registered default → none (header omitted). */
export function resolveUpstreamIngestKey(opts: { env?: NodeJS.ProcessEnv } = {}): string | undefined {
  const env = opts.env ?? process.env;
  const fromEnv = env[TELEMETRY_INGEST_KEY_ENV]?.trim();
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  const fromDefault = getUpstreamDefaults()?.ingestKey?.trim();
  return fromDefault !== undefined && fromDefault !== "" ? fromDefault : undefined;
}

const isCi = (env: NodeJS.ProcessEnv): boolean => !!env[CI_ENV];

const none = (skipped: number, reason: string): MosaicFlushResult => ({
  attempted: 0,
  sent: 0,
  failed: 0,
  skipped,
  rejected: 0,
  reason,
});

/**
 * Send due outbox entries to the resolved endpoint.
 *
 * DORMANT unless an endpoint resolves (env → settings → registered
 * default). Refuses to send unless the EFFECTIVE mode is standard (so
 * `DO_NOT_TRACK=1` or an env-forced local/ghost blocks sending even
 * with an endpoint), and under `CI` unless the operator pointed the
 * sender somewhere explicitly via env.
 *
 * Per entry: POST the payload JSON with the event id + ingest key
 * headers; 2xx → archived to `sent/`; 400/413/415/422 → archived as
 * rejected (never retried); anything else → attempts+1 with exponential
 * backoff (1h·2^attempts, capped at 7 days). A thrown fetch (network
 * down, timeout) backs that entry off and ENDS the pass — a dead
 * endpoint costs one timeout, not one per entry. `deadlineMs` bounds
 * the whole pass (the CLI's detached worker uses it).
 */
export async function flushOutbox(
  opts: {
    endpoint?: string;
    ingestKey?: string;
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    nowMs?: number;
    deadlineMs?: number;
  } = {},
): Promise<MosaicFlushResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const env = opts.env ?? process.env;
  const effective = getEffectiveTelemetryMode(opts.env);
  if (!isUpstreamAllowed(effective.mode)) {
    return none(listOutbox().length, "upstream-off");
  }
  const settings = loadTelemetrySettings();
  const resolved = resolveUpstreamEndpoint({ env: opts.env, settings });
  const endpoint = opts.endpoint ?? resolved.endpoint;
  if (endpoint === undefined) {
    return none(
      listOutbox().length,
      resolved.source === "off" ? "endpoint-off" : "dormant-no-endpoint",
    );
  }
  if (isCi(env) && opts.endpoint === undefined && resolved.source !== "env") {
    return none(listOutbox().length, "ci-exempt");
  }
  const ingestKey = opts.ingestKey ?? resolveUpstreamIngestKey({ env: opts.env });
  const doFetch = opts.fetchImpl ?? fetch;
  const startedAt = Date.now();

  let attempted = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let rejected = 0;
  let circuitOpen = false;
  for (const entry of listOutbox()) {
    if (entry.nextAttemptAtMs > nowMs || circuitOpen) {
      skipped++;
      continue;
    }
    if (opts.deadlineMs !== undefined && Date.now() - startedAt > opts.deadlineMs) {
      skipped++;
      continue;
    }
    attempted++;
    let status: number | undefined;
    let threw = false;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), POST_TIMEOUT_MS);
      try {
        const res = await doFetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [TELEMETRY_EVENT_ID_HEADER]: entry.id,
            ...(ingestKey !== undefined ? { [TELEMETRY_INGEST_KEY_HEADER]: ingestKey } : {}),
          },
          body: JSON.stringify(entry.payload),
          signal: ctrl.signal,
        });
        // Injected test fetches may omit `status`; `ok` is the contract.
        status = res.ok ? res.status || 200 : res.status;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      threw = true;
    }
    if (status !== undefined && status >= 200 && status < 300) {
      markSent(entry, nowMs);
      sent++;
    } else if (status !== undefined && DROP_STATUSES.has(status)) {
      markSent(entry, nowMs, { rejected: { status } });
      rejected++;
    } else {
      const attempts = entry.attempts + 1;
      updateOutboxEntry({
        ...entry,
        attempts,
        nextAttemptAtMs:
          nowMs + Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_MAX_MS),
      });
      failed++;
      if (threw) circuitOpen = true;
    }
  }
  return { attempted, sent, failed, skipped, rejected, endpoint };
}

/**
 * The one call hosts make: sync disk-only enqueues (lifecycle, the
 * daily day-summary, then today-so-far), then — when `flush` isn't
 * disabled — a fire-and-forget network flush that only actually
 * transmits if an endpoint resolves. Never throws; safe on every boot /
 * post-render path. Short-lived hosts (the CLI) pass `flush: false` and
 * hand transmission to a detached worker instead.
 */
export function runUpstreamMaintenance(opts: {
  currentVersion: string;
  env?: NodeJS.ProcessEnv;
  nowMs?: number;
  flush?: boolean;
}): void {
  const passthrough = {
    ...(opts.nowMs !== undefined ? { nowMs: opts.nowMs } : {}),
    ...(opts.env !== undefined ? { env: opts.env } : {}),
  };
  try {
    checkAndEnqueueLifecycle({ currentVersion: opts.currentVersion, ...passthrough });
  } catch {
    /* best effort */
  }
  const rollupOpts = { ...passthrough, currentVersion: opts.currentVersion };
  try {
    maybeEnqueueDailyRollup(rollupOpts);
  } catch {
    /* best effort */
  }
  try {
    maybeEnqueueTodayRollup(rollupOpts);
  } catch {
    /* best effort */
  }
  if (opts.flush !== false) {
    void flushOutbox({
      ...(opts.env !== undefined ? { env: opts.env } : {}),
    }).catch(() => {
      /* best effort */
    });
  }
}
