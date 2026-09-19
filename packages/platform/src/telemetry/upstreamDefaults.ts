/**
 * Host-registered upstream defaults.
 *
 * The platform ships DORMANT by construction: it never carries an ingest
 * endpoint or key of its own. A host (the published CLI, the packaged
 * desktop app) registers the built-in endpoint + ingest key at startup —
 * and only when it is a real, shipped build. Dev checkouts, unit tests and
 * every e2e spawn never register, so nothing in the repo can transmit by
 * accident. `M0SAIC_TELEMETRY_ENDPOINT` (env) still wins over the default,
 * and `M0SAIC_TELEMETRY_ENDPOINT=off` forces dormant even when a default is
 * registered.
 */
export type MosaicUpstreamDefaults = {
  /** Absolute ingest URL, e.g. `https://m0saic.io/api/telemetry`. */
  endpoint: string;
  /** Shared ingest key sent as `x-m0saic-ingest-key` (a junk filter, not a secret). */
  ingestKey?: string;
};

let registered: MosaicUpstreamDefaults | undefined;

/** Opt this process in to a built-in endpoint. Pass `undefined` to clear. */
export function registerUpstreamDefaults(defaults: MosaicUpstreamDefaults | undefined): void {
  registered = defaults === undefined ? undefined : { ...defaults };
}

export function getUpstreamDefaults(): MosaicUpstreamDefaults | undefined {
  return registered;
}

/** Test seam — back to dormant. */
export function resetUpstreamDefaults(): void {
  registered = undefined;
}
