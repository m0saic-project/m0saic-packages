/**
 * Host-connection registration API for 3P template packs that need
 * host-managed connection config (URL + secret-ish credentials).
 *
 * # The pattern
 *
 * Some templates talk to external services — a 
 * future Plex / Jellyfin / Sonarr / GitHub / Linear adapter. They
 * need:
 *
 *   - A URL (host-supplied, not authored into the doc).
 *   - Maybe an API key / token (secret; never authored into the doc).
 *   - Maybe other config (per-user defaults, content-type modes).
 *
 * Templates declare *which* connection they expect by ID; the host
 * (Mosaic editor, CLI, future tools) renders a settings UI for each
 * registered connection, persists user-entered values, and threads
 * them onto {@link MosaicEngineContext.connections} (non-secret fields)
 * and {@link MosaicEngineContext.secrets} (secret fields) at render
 * time.
 *
 * # Why a registry-driven API instead of hard-coding GitHub
 *
 * Mosaic itself stays vendor-neutral. Connection schemas live with
 * the template pack that needs them. New 3P packs plug in by
 * importing the registration helper and calling
 * `registerHostConnection(...)` — no host-code changes.
 *
 * # The four moving parts
 *
 * 1. {@link MosaicHostConnectionSchema} — declarative description of
 *    the fields a connection needs.
 * 2. {@link MosaicHostConnectionProbe} — pack-side "test connection"
 *    implementation the host calls before saving values.
 * 3. {@link MosaicHostConnectionRegistration} — pairs the two and is
 *    what packs register.
 * 4. {@link MosaicConnectionResolver} — render-time lookup interface
 *    threaded onto `ctx.connections`.
 *
 * # Render-time access split
 *
 * Non-secret fields (URLs, config) are read via `ctx.connections`.
 * Secret fields are read via `ctx.secrets` using a {@link SecretRef}
 * the host mints from the connection profile + field key (see
 * {@link mintConnectionSecretRef}). The split keeps the security
 * tier visible at the call site.
 *
 * # Canonical SecretRef format
 *
 * For a `secret`-kind field with `storage: "keychain"`:
 *
 *   `keychain:<publisher>@<profile>/<fieldKey>`
 *
 * For `storage: "env"`:
 *
 *   `env:<ENV_VAR_NAME>` — the host surfaces the env-var contract to
 *   the user; templates read via `ctx.secrets.get("env:NAME")` exactly
 *   as today.
 *
 * The format is a contract between the host (which writes secrets and
 * mints refs) and the template (which reads). Use
 * {@link mintConnectionSecretRef} to construct refs consistently;
 * doing so by hand is permitted but error-prone.
 */

/**
 * Opaque pointer to a registered host connection.
 *
 * Canonical format: `<publisher>@<profile>`. Example: `github-dev@default`.
 * The publisher half matches the template-id publisher slug; the
 * profile half is the user-visible profile name (`default` for single-
 * profile setups; future multi-profile UIs may surface `home` / `work`).
 *
 * The id is what hosts persist under. Format stability matters for
 * migrations — pick wisely if you find yourself authoring a new format.
 */
export type MosaicHostConnectionId = string & {
  readonly __mosaicHostConnectionIdBrand: unique symbol;
};

/** Brand a string as a {@link MosaicHostConnectionId}. Validates publisher@profile shape. */
export function asMosaicHostConnectionId(s: string): MosaicHostConnectionId {
  // Permissive: any non-empty `<a>@<b>` shape passes. Hosts may enforce
  // tighter rules per their own UI conventions.
  if (typeof s !== "string" || !/^[^@\s]+@[^@\s]+$/.test(s)) {
    throw new Error(
      `Invalid MosaicHostConnectionId: ${JSON.stringify(s)}. ` +
        `Expected '<publisher>@<profile>' (e.g., 'github-dev@default').`,
    );
  }
  return s as MosaicHostConnectionId;
}

/**
 * One field on a {@link MosaicHostConnectionSchema}. The host renders
 * the schema's fields as a form in its settings UI.
 *
 * - `url` and `string` values are stored in cleartext (a `connections.json`
 *   blob, or equivalent).
 * - `secret` values are routed to the host's keychain (or env) backend
 *   and addressed via {@link SecretRef} at render time.
 */
export type MosaicHostConnectionField =
  | {
      kind: "url";
      key: string;
      label: string;
      required: boolean;
      placeholder?: string;
      description?: string;
    }
  | {
      kind: "string";
      key: string;
      label: string;
      required: boolean;
      placeholder?: string;
      description?: string;
    }
  | {
      kind: "secret";
      key: string;
      label: string;
      required: boolean;
      description?: string;
      /**
       * Where the host stores the secret. `keychain` for OS-backed
       * stores (Electron `safeStorage`); `env` for an environment-
       * variable contract (the host doesn't store anything; it
       * surfaces the env-name to the user).
       */
      storage: "keychain" | "env";
    };

/**
 * Declarative description of what a connection needs. Registered by
 * 3P template packs; consumed by the host's settings UI.
 */
export type MosaicHostConnectionSchema = {
  /** Stable identifier — see {@link MosaicHostConnectionId}. */
  id: MosaicHostConnectionId;
  /**
   * Schema-format version. Bump when fields are added / renamed /
   * removed in incompatible ways. The host applies migrations keyed
   * off this number.
   */
  version: number;
  /** Human-readable name shown in the settings UI ("GitHub"). */
  label: string;
  /** Longer description shown under the section title. */
  description?: string;
  /**
   * Publisher slug — must match the publisher half of `id`. Hosts use
   * this to group connections under their owning pack in the UI.
   */
  publisher: string;
  /** Per-field schema. Renders top-to-bottom in the settings form. */
  fields: ReadonlyArray<MosaicHostConnectionField>;
};

/**
 * Optional knobs the host MAY pass to a probe. Probes that don't care
 * about a given knob ignore it; impls that care default each one to
 * a sensible production value.
 */
export type MosaicHostConnectionProbeOpts = {
  /**
   * Test seam — inject a `fetch` impl (typed structurally so we don't
   * pull DOM types into this package). Defaults to `globalThis.fetch`
   * when omitted. Probes that don't need network skip this entirely.
   */
  fetchImpl?: (
    input: string | URL,
    init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
  ) => Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    text(): Promise<string>;
    json(): Promise<unknown>;
  }>;

  /** Per-probe timeout in milliseconds. Probes default to 10s. */
  timeoutMs?: number;

  /**
   * Caller-owned abort signal — set by host UI when the user
   * cancels (closes the settings panel mid-probe). Probes that
   * support cancellation forward this to their `fetch` call.
   */
  signal?: AbortSignal;
};

/**
 * Pack-side "test connection" implementation. Called by the host
 * when the user hits a "Test connection" button in the settings UI.
 */
export interface MosaicHostConnectionProbe {
  /**
   * Probe the connection. `values` is the form input keyed by
   * `field.key`; for `secret` fields the value is the cleartext
   * the host has just resolved (NOT a SecretRef) — probe runs in
   * the host process and consumes the cleartext directly.
   *
   * `opts` is optional; see {@link MosaicHostConnectionProbeOpts}.
   */
  probe(
    values: Readonly<Record<string, unknown>>,
    opts?: MosaicHostConnectionProbeOpts,
  ): Promise<MosaicHostConnectionProbeResult>;
}

/**
 * Two-tick probe result: `reachable` confirms the URL is alive and
 * speaking the expected protocol; `authenticated` confirms the
 * credential (when provided) is accepted. A probe MAY return
 * `authenticated: undefined` when no credential field is set on the
 * schema, or when the credential is optional and unset.
 */
export type MosaicHostConnectionProbeResult =
  | {
      ok: true;
      reachable: true;
      authenticated?: boolean;
      version?: string;
      info?: Readonly<Record<string, unknown>>;
    }
  | {
      ok: false;
      /** Stable machine-readable code (e.g., `UNREACHABLE`, `AUTH_FAILED`). */
      code: string;
      message: string;
    };

/**
 * What a pack hands to {@link registerHostConnection} (defined in
 * `@m0saic/template-utils`). Pairs the declarative schema with its
 * runtime probe implementation.
 */
export type MosaicHostConnectionRegistration = {
  schema: MosaicHostConnectionSchema;
  probe: MosaicHostConnectionProbe;
};

/**
 * Render-time resolver threaded onto {@link MosaicEngineContext.connections}.
 *
 * Returns *non-secret* field values for a registered connection. Secret
 * fields are NOT exposed here — they go through `ctx.secrets`.
 *
 * Implementations live in the host (Electron settings store reader,
 * CLI config-file reader, test fixture).
 */
export interface MosaicConnectionResolver {
  /**
   * Look up a connection's non-secret values. Returns `undefined`
   * when the connection isn't configured (rather than throwing) so
   * templates can branch on absence.
   */
  get(
    id: MosaicHostConnectionId | string,
  ): Promise<Readonly<Record<string, unknown>> | undefined>;

  /** Non-throwing existence check. */
  has(id: MosaicHostConnectionId | string): Promise<boolean>;
}

/**
 * Mint a {@link SecretRef} for a `secret`-kind field on a registered
 * connection. The host calls this to address the keychain entry it
 * wrote when persisting connection values; templates call this with
 * the same `(connectionId, fieldKey)` pair to read back via
 * `ctx.secrets.get(...)`. Single source of truth so the host and
 * template never disagree on the format.
 *
 * For `storage: "env"` fields, prefer the existing `env:NAME` ref
 * convention directly — env-vars don't have a profile dimension to
 * encode.
 *
 * @example
 *   const ref = mintConnectionSecretRef("github-dev@default", "apiKey");
 *   // → "keychain:github-dev@default/apiKey"
 */
export function mintConnectionSecretRef(
  connectionId: MosaicHostConnectionId | string,
  fieldKey: string,
): string {
  const id = String(connectionId);
  if (id.length === 0) {
    throw new Error("mintConnectionSecretRef: connectionId is empty");
  }
  if (fieldKey.length === 0) {
    throw new Error("mintConnectionSecretRef: fieldKey is empty");
  }
  if (/[/\s]/.test(fieldKey)) {
    throw new Error(
      `mintConnectionSecretRef: fieldKey ${JSON.stringify(fieldKey)} ` +
        `must not contain '/' or whitespace.`,
    );
  }
  return `keychain:${id}/${fieldKey}`;
}
