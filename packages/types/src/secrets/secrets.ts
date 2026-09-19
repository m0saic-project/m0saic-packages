/**
 * Resolver for capability-tier templates that need access to secrets
 * (API keys, OAuth tokens, etc.) without embedding the literal secret
 * in the `.mosaic` document.
 *
 * # The contract
 *
 * Templates author docs with `SecretRef` strings — opaque, portable
 * pointers like `"env:GITHUB_TOKEN"` or `"keychain:github@prod"`. At
 * render time, the engine threads a {@link MosaicSecretResolver} onto
 * `ctx.secrets`; the template calls `ctx.secrets.get(ref)` to fetch
 * the actual cleartext value just-in-time.
 *
 * # Why this exists
 *
 * Without this channel, capability templates have two bad options for
 * receiving secrets: (a) embed in props (leaks into shareable docs +
 * shoulder-surfing during demos), or (b) read from `process.env`
 * directly (couples templates to Node host, makes Electron-shell
 * renders awkward). `ctx.secrets` is the third path: docs carry refs,
 * the host owns the cleartext.
 *
 * # Implementations live in `@m0saic/platform`
 *
 * - `envSecretResolver` — reads `process.env[NAME]` for `env:NAME` refs.
 *   The day-one tactical option; right for CLI / headless use.
 * - `keychainSecretResolver` — wraps Electron's `safeStorage` plus a
 *   file-mapped index for `keychain:<id>` refs. Right for the desktop
 *   app where secrets persist across launches and survive disk-image
 *   theft.
 *
 * Both impls satisfy this interface. Hosts pick which to construct;
 * templates remain ignorant of the implementation.
 *
 * # Capability tier — not a runtime gate (today)
 *
 * `MosaicTemplateCapabilityCaps.net.fetch` declares intent but is not
 * enforced at runtime. `ctx.secrets` is the first context channel
 * that genuinely distinguishes core from capability tier: core-tier
 * templates have no reason to ever call `ctx.secrets.get(...)`, so
 * presence of that call is itself a signal of capability use.
 */

/**
 * Opaque pointer into a secret store. Format is impl-defined; common
 * conventions:
 *
 * - `"env:GITHUB_TOKEN"` — environment variable lookup.
 * - `"keychain:github@prod"` — Electron `safeStorage`-backed entry by id.
 *
 * Templates should treat `SecretRef` as a black box. Generating refs
 * is the host's job (via a credentials panel or `M0SAIC_*` env var);
 * templates only ever read them out of props.
 */
export type SecretRef = string;

/**
 * Async resolver from {@link SecretRef} → cleartext secret.
 *
 * Threaded onto `MosaicEngineContext.secrets` by the host. Implementations
 * live in `@m0saic/platform/secrets/*`.
 *
 * Contract:
 * - `get(ref)` rejects on missing / malformed ref. Templates should
 *   surface the error rather than swallowing it — a render that can't
 *   reach its data source is a render failure.
 * - `has(ref)` is the non-throwing query for "is this secret
 *   resolvable right now?" Useful in pre-flight validation UIs that
 *   want to flag missing secrets before the render starts spending
 *   compute.
 * - Resolver impls SHOULD NOT cache. If `process.env` changes between
 *   two `get` calls, the second call sees the new value. Caching is
 *   the host's concern; the resolver is the lookup primitive.
 */
export interface MosaicSecretResolver {
  /**
   * Fetch the cleartext for `ref`. Rejects when the ref's referenced
   * secret is missing, malformed, or unsupported by this impl.
   */
  get(ref: SecretRef): Promise<string>;

  /**
   * Non-throwing existence check. Returns `true` when `get(ref)` would
   * succeed, `false` otherwise. Implementations MAY short-circuit
   * (skip decryption, skip network calls) but MUST mirror what
   * `get` would do for the same ref.
   */
  has(ref: SecretRef): Promise<boolean>;
}
