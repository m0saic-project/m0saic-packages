/**
 * The user-facing telemetry mode — the single 3-way switch shown on the
 * Telemetry page and settable via `m0saic telemetry set-mode`.
 *
 * The mode collapses two orthogonal axes into one control:
 *
 *  - **local recording** — whether renders append a
 *    `MosaicRenderRecord` to the on-disk history
 *    (`<root>/telemetry/renders/`).
 *  - **upstream emission** — whether aggregated analytics may leave
 *    the machine at all (further gated by
 *    `MosaicAnalyticsConsent.channels`, `DO_NOT_TRACK`, and an
 *    endpoint actually being configured).
 *
 * | mode       | local recording | upstream |
 * |------------|-----------------|----------|
 * | `standard` | on              | allowed  |
 * | `local`    | on              | never    |
 * | `ghost`    | off — inert     | never    |
 *
 * `ghost` is the "leave no trace" mode: the recorder is fully inert
 * and no telemetry files are touched. Product render artifacts
 * (`.output.json`, perf sidecars) are NOT telemetry and keep writing.
 *
 * UI labels: "Standard" / "Local-only" / "Ghost". The canonical value
 * for Local-only is `"local"`; `normalizeTelemetryModeInput` accepts
 * the `"local-only"` spelling from CLI/user input.
 */
export type MosaicTelemetryMode = "standard" | "local" | "ghost";

/** All modes, in display order. */
export const MOSAIC_TELEMETRY_MODES: readonly MosaicTelemetryMode[] = [
  "standard",
  "local",
  "ghost",
];

/**
 * Fresh installs default to `standard` — local history on, aggregated
 * PII-free upstream allowed (dormant until an endpoint exists), with a
 * one-time notice pointing at the Telemetry page. Mirrors the
 * opt-out-not-opt-in posture of `DEFAULT_ANALYTICS_CONSENT`.
 */
export const DEFAULT_TELEMETRY_MODE: MosaicTelemetryMode = "standard";

/** Runtime guard: is `v` a valid canonical mode value? */
export const isMosaicTelemetryMode = (v: unknown): v is MosaicTelemetryMode =>
  typeof v === "string" &&
  (MOSAIC_TELEMETRY_MODES as readonly string[]).includes(v);

/**
 * Normalize free-form user/env input to a canonical mode.
 *
 * Accepts the canonical values plus the `"local-only"` alias (the UI
 * label spelling), case-insensitively. Returns `undefined` for
 * anything else — callers decide whether that's an error (CLI
 * `set-mode`) or silently ignored (a bogus env var falls through to
 * the file mode).
 */
export const normalizeTelemetryModeInput = (
  raw: string,
): MosaicTelemetryMode | undefined => {
  const v = raw.trim().toLowerCase();
  if (v === "local-only") return "local";
  return isMosaicTelemetryMode(v) ? v : undefined;
};

/** Where the effective mode came from, for status displays. */
export type TelemetryModeSource = "env" | "file" | "default";

/**
 * The resolved, in-effect mode for this process — after the
 * `M0SAIC_TELEMETRY` env override and `DO_NOT_TRACK` degradation are
 * applied. This is what recorders and senders consult; the persisted
 * file mode is what the settings UI edits.
 */
export type EffectiveTelemetryMode = {
  /** The mode actually in effect (post-override, post-DNT). */
  mode: MosaicTelemetryMode;
  /** Which layer supplied the pre-DNT mode. */
  source: TelemetryModeSource;
  /**
   * True when a `DO_NOT_TRACK` env var degraded `standard` to
   * `local` for this process. The persisted file is untouched; the
   * UI shows a banner instead of moving the switch.
   */
  dntDegraded: boolean;
};

/**
 * Is a `DO_NOT_TRACK`-style env value "set"? Follows the consumer
 * convention (https://consoledonottrack.com): `"1"` or `"true"`
 * (case-insensitive) enable it; empty / `"0"` / anything else do not.
 */
const isDoNotTrackSet = (v: string | undefined): boolean => {
  if (v === undefined) return false;
  const t = v.trim().toLowerCase();
  return t === "1" || t === "true";
};

/**
 * Resolve the effective mode for this process.
 *
 * Precedence: `envMode` (`M0SAIC_TELEMETRY`, when it parses to a
 * valid mode) > `fileMode` (settings.json) > {@link DEFAULT_TELEMETRY_MODE}.
 * An unparseable env value is ignored, not an error.
 *
 * `DO_NOT_TRACK` then degrades an effective `standard` to `local`
 * (upstream off, local history unaffected) without touching the
 * file — `local` and `ghost` are already at-or-below that privacy
 * level and pass through unchanged.
 */
export const resolveEffectiveTelemetryMode = (input: {
  fileMode?: MosaicTelemetryMode;
  envMode?: string;
  doNotTrack?: string;
}): EffectiveTelemetryMode => {
  let mode: MosaicTelemetryMode;
  let source: TelemetryModeSource;

  const fromEnv =
    input.envMode !== undefined
      ? normalizeTelemetryModeInput(input.envMode)
      : undefined;
  if (fromEnv !== undefined) {
    mode = fromEnv;
    source = "env";
  } else if (input.fileMode !== undefined && isMosaicTelemetryMode(input.fileMode)) {
    mode = input.fileMode;
    source = "file";
  } else {
    mode = DEFAULT_TELEMETRY_MODE;
    source = "default";
  }

  const dntDegraded = mode === "standard" && isDoNotTrackSet(input.doNotTrack);
  if (dntDegraded) mode = "local";

  return { mode, source, dntDegraded };
};

/**
 * Does this mode record render history to disk? `standard` and
 * `local` do; `ghost` is fully inert.
 */
export const isLocalRecordingEnabled = (mode: MosaicTelemetryMode): boolean =>
  mode !== "ghost";

/**
 * May anything leave the machine under this mode? Only `standard`.
 * Note this is necessary, not sufficient — consent channels,
 * `MosaicAnalyticsConsent.mode`, and an actual configured endpoint
 * all still gate real emission.
 */
export const isUpstreamAllowed = (mode: MosaicTelemetryMode): boolean =>
  mode === "standard";
