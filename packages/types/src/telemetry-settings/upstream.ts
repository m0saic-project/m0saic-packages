import type {
  MosaicAnalyticsChannelConsent,
} from "../analytics/consent";
import type {
  MosaicAnalyticsEvent,
  MosaicAnalyticsImmediateEvent,
  MosaicAnalyticsRollupEvent,
} from "../analytics/event";

/** Bumped when the outbox wrapper shape changes incompatibly. */
export const TELEMETRY_OUTBOX_ENTRY_SCHEMA_VERSION = 1;

/**
 * Where the sender's endpoint came from:
 *  - `env` — `M0SAIC_TELEMETRY_ENDPOINT` (operator override; wins).
 *  - `settings` — `settings.upstream.endpoint`.
 *  - `default` — the host registered a built-in endpoint (published CLI /
 *    packaged desktop only; dev checkouts never register one).
 *  - `off` — `M0SAIC_TELEMETRY_ENDPOINT=off`: explicitly dormant even when a
 *    default is registered (test harnesses, CI, opt-out by env).
 */
export type MosaicUpstreamEndpointSource = "env" | "settings" | "default" | "off";

/**
 * One queued upstream payload — a file under `<root>/telemetry/outbox/`.
 * The wrapper carries retry bookkeeping; `payload` is the EXACT
 * `MosaicAnalyticsEvent` JSON the sender will POST (byte-for-byte what
 * the transparency view shows).
 */
export type MosaicOutboxEntry = {
  schemaVersion: typeof TELEMETRY_OUTBOX_ENTRY_SCHEMA_VERSION;
  /** File basename (without `.json`) — stable id for remove/move. Sent as `x-m0saic-event-id`. */
  id: string;
  /** Upload cadence family (rollup = day summary / today-so-far update; immediate = lifecycle/error). */
  channel: "rollup" | "immediate";
  kind: MosaicAnalyticsEvent["kind"];
  /** ISO 8601 UTC enqueue time. */
  createdAt: string;
  /** Send attempts so far. */
  attempts: number;
  /** Epoch ms before which the sender skips this entry (backoff). */
  nextAttemptAtMs: number;
  payload: MosaicAnalyticsEvent;
};

/**
 * A payload that left the machine, archived under `<root>/telemetry/sent/`.
 * `rejected` is set when the server refused the body itself (4xx the
 * client never retries) — it still went out, so it stays in the ledger.
 */
export type MosaicSentEntry = MosaicOutboxEntry & {
  /** ISO 8601 UTC send time. */
  sentAt: string;
  rejected?: { status: number };
};

/** Structural guard for tolerant outbox/sent file reads. */
export const isMosaicOutboxEntry = (v: unknown): v is MosaicOutboxEntry => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.schemaVersion === TELEMETRY_OUTBOX_ENTRY_SCHEMA_VERSION &&
    typeof o.id === "string" &&
    (o.channel === "rollup" || o.channel === "immediate") &&
    typeof o.kind === "string" &&
    typeof o.createdAt === "string" &&
    typeof o.attempts === "number" &&
    typeof o.nextAttemptAtMs === "number" &&
    typeof o.payload === "object" &&
    o.payload !== null
  );
};

/**
 * The exact-transparency payload — everything the Telemetry page's
 * "what leaves this machine" view and `m0saic telemetry preview`
 * render. INVARIANT: `nextRollup` / `todayRollup` / `sampleErrorReport`
 * are produced by the SAME builder functions the real sender enqueues
 * from, so the preview is exact by construction, never a hand-written
 * mock.
 */
export type MosaicUpstreamPreview = {
  /** ISO 8601 UTC. */
  generatedAt: string;
  /** Effective mode is standard (upstream permitted at all). */
  upstreamAllowed: boolean;
  channels: MosaicAnalyticsChannelConsent;
  endpoint: { configured: boolean; source?: MosaicUpstreamEndpointSource };
  /**
   * The day summary the next daily enqueue would produce — every full
   * UTC day since the last enqueued day — null when upstream/rollup is
   * off or there is nothing pending.
   */
  nextRollup: MosaicAnalyticsRollupEvent | null;
  /** Window behind `nextRollup`, for display. */
  nextRollupWindow?: {
    windowStart: number;
    windowEnd: number;
    records: number;
  };
  /**
   * Today so far: the running rollup for the current UTC day, sent after
   * each render. Each update replaces the previous one for the same day
   * upstream; tomorrow's day summary replaces them all. Null when off or
   * nothing rendered today.
   */
  todayRollup: MosaicAnalyticsRollupEvent | null;
  /**
   * What ONE error report would look like, built from the latest
   * failed render — illustrative even while the errorReports channel
   * is off (see `errorReportsEnabled`); null when nothing has failed.
   */
  sampleErrorReport: MosaicAnalyticsImmediateEvent | null;
  errorReportsEnabled: boolean;
  /** Literal pending outbox entries (what WOULD be sent). */
  queued: MosaicOutboxEntry[];
  /** Archive of payloads that actually left the machine. */
  sent: MosaicSentEntry[];
  /** The always-true exclusion list, for display beside the JSON. */
  neverSent: readonly string[];
  /** Per-field plain-English annotations for the rollup payload. */
  fieldAnnotations: Readonly<Record<string, string>>;
  /** One sentence describing the rollup cadence, for both UIs. */
  rollupCadence: string;
};

/** Result of one sender flush pass. */
export type MosaicFlushResult = {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Refused by the server for the body itself (4xx) — archived, never retried. */
  rejected: number;
  endpoint?: string;
  /** Why nothing was attempted (dormant / mode / CI / empty). */
  reason?: string;
};
