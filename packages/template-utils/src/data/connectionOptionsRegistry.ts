import type { MosaicSecretResolver } from "@m0saic/types";
import { processRegistry } from "../processRegistry";

/**
 * Registry of "options fetchers" — runtime resolvers for closed-set
 * props whose valid values aren't known at publish time.
 *
 * The flow:
 *   1. A template prop declares `meta.control.optionsFromConnection =
 *      { kind, connectionFromProp }` to say "my options come from a
 *      connection-bound fetch."
 *   2. The publisher's template pack side-effect-registers a fetcher
 *      for that `kind` here (mirroring {@link registerHostConnection}).
 *   3. The host (Mosaic Electron app) exposes `connections:fetchOptions`
 *      IPC. When the editor mounts the prop input, it calls the IPC
 *      with `{ kind, connectionId }`. The IPC resolves the connection
 *      values + secrets, looks up the fetcher here, and calls it.
 *   4. The fetcher returns a list of `{ value, label, description? }`.
 *      The editor renders a closed-set picker (segmented pill /
 *      dropdown / multi-select) against that list.
 *
 * Why this lives in `@m0saic/template-utils`:
 *   - The host doesn't know how to call GraphQL or Notion's API;
 *     publishers do. Keeping the fetcher implementation in the
 *     publisher package keeps the host generic.
 *   - The host already imports publisher packs for side-effect
 *     template registration; the same import populates this registry.
 *
 * Why one global namespace by `kind`:
 *   - `kind` strings are author-chosen and conventionally prefixed
 *     (e.g. `"saved-filters"`, `"notion-databases"`). They live in the
 *     same namespace as connection ids' publisher half — collisions
 *     across publishers are an authoring mistake we surface via the
 *     re-register warning.
 */

export type ConnectionOptionsFetcherArgs = {
  /**
   * Non-secret field values from the resolved connection (e.g.
   * `{ devUrl: "http://localhost:9999" }`). Same shape the engine
   * sees in `ctx.connections.get(id)`.
   */
  connectionValues: Record<string, unknown>;
  /**
   * Secrets resolver scoped to the same connection. Fetchers use
   * `secrets.get(mintConnectionSecretRef(id, "apiKey"))` etc.
   * Undefined when the host has no secrets backend wired (anonymous
   * mode); fetchers should degrade gracefully.
   */
  secrets?: MosaicSecretResolver;
  /**
   * The connection id this fetch resolves against. Templates rarely
   * need this directly — `connectionValues` and `secrets` cover most
   * cases — but it's passed through for fetchers that need it to mint
   * secret refs explicitly.
   */
  connectionId: string;
  /** Optional cancellation. */
  signal?: AbortSignal;
};

export type ConnectionOptionsResult = ReadonlyArray<{
  value: string;
  label?: string;
  description?: string;
  /**
   * Optional group/section label. Rich editors (e.g. the `cardList`
   * `connectionMultiSelect` picker modal) section the option list by this
   * — for a saved-query source it carries the mode (e.g. a category).
   * Options without a group fall into an "Other" section.
   */
  group?: string;
  /** Optional thumbnail/preview URL. Reserved for future picker previews. */
  image?: string;
}>;

export type ConnectionOptionsFetcher = (
  args: ConnectionOptionsFetcherArgs,
) => Promise<ConnectionOptionsResult>;

// Process-global — survives the desktop app's template hot reload. See
// `../processRegistry`.
const registry = processRegistry<string, ConnectionOptionsFetcher>(
  "connectionOptionsFetchers",
);

/**
 * Register a fetcher for a closed-set prop's dynamic options.
 *
 * `kind` is author-chosen; convention is hyphenated lowercase
 * (`"saved-filters"`, `"notion-databases"`). Re-registering the same
 * kind replaces the existing fetcher with a console warning — dev-time
 * double imports / HMR shouldn't crash.
 */
export function registerConnectionOptionsFetcher(
  kind: string,
  fetcher: ConnectionOptionsFetcher,
): void {
  if (!kind) {
    throw new Error(
      "registerConnectionOptionsFetcher: kind must be a non-empty string",
    );
  }
  if (registry.has(kind)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[connectionOptionsRegistry] Re-registering ${JSON.stringify(kind)} — ` +
        `previous fetcher replaced.`,
    );
  }
  registry.set(kind, fetcher);
}

/** Look up a fetcher by kind. Returns `undefined` when unregistered. */
export function getConnectionOptionsFetcher(
  kind: string,
): ConnectionOptionsFetcher | undefined {
  return registry.get(kind);
}

/** Throwing variant. Surfaces unknown kinds clearly to the IPC layer. */
export function requireConnectionOptionsFetcher(
  kind: string,
): ConnectionOptionsFetcher {
  const f = getConnectionOptionsFetcher(kind);
  if (!f) {
    throw new Error(
      `Connection-options fetcher ${JSON.stringify(kind)} is not registered. ` +
        `Make sure the owning template pack is imported (side-effect registration).`,
    );
  }
  return f;
}

/** List every registered kind, sorted alphabetically. */
export function listRegisteredConnectionOptionsKinds(): string[] {
  return Array.from(registry.keys()).sort();
}

/** Test-only — clear between unit tests. */
export function __clearConnectionOptionsRegistryForTests(): void {
  registry.clear();
}

/* ── Lazy option images ──────────────────────────────────────────────────
 *
 * A companion registry for kinds whose option *images* are too heavy to
 * inline into the options list (e.g. GitHub org member avatars).
 * When a kind registers an images fetcher, its options fetcher returns
 * label-only rows and the editor resolves images lazily, per visible page,
 * by option value — re-fetching only what a newly visited page is missing.
 *
 * Feature-detected by the template pack: a pack calls the registration
 * function through an optional-chained lookup, so packs built against an
 * older template-utils (no images registry) simply skip lazy mode and keep
 * inlining eagerly. Ship the export name verbatim.
 */

export type ConnectionOptionImagesFetcherArgs = {
  /** Non-secret connection field values — same shape as the options fetcher. */
  connectionValues: Record<string, unknown>;
  /** Secrets resolver scoped to the same connection (see options fetcher). */
  secrets?: MosaicSecretResolver;
  /** The connection id this fetch resolves against. */
  connectionId: string;
  /** Option values to resolve — one page's worth (callers keep it ≤ ~50). */
  values: string[];
  /** Optional cancellation. */
  signal?: AbortSignal;
};

/** value → data URI. Missing keys mean "no image" (editor shows a fallback). */
export type ConnectionOptionImagesFetcher = (
  args: ConnectionOptionImagesFetcherArgs,
) => Promise<Record<string, string>>;

// Process-global — survives the desktop app's template hot reload. See
// `../processRegistry`.
const imagesRegistry = processRegistry<string, ConnectionOptionImagesFetcher>(
  "connectionOptionImagesFetchers",
);

/**
 * Register a batch image fetcher for a closed-set prop's options. Same
 * `kind` namespace + re-register-warns semantics as
 * {@link registerConnectionOptionsFetcher}.
 */
export function registerConnectionOptionImagesFetcher(
  kind: string,
  fetcher: ConnectionOptionImagesFetcher,
): void {
  if (!kind) {
    throw new Error(
      "registerConnectionOptionImagesFetcher: kind must be a non-empty string",
    );
  }
  if (imagesRegistry.has(kind)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[connectionOptionsRegistry] Re-registering images fetcher ` +
        `${JSON.stringify(kind)} — previous fetcher replaced.`,
    );
  }
  imagesRegistry.set(kind, fetcher);
}

/** Look up an images fetcher by kind. Returns `undefined` when unregistered. */
export function getConnectionOptionImagesFetcher(
  kind: string,
): ConnectionOptionImagesFetcher | undefined {
  return imagesRegistry.get(kind);
}

/** List every registered images kind, sorted alphabetically. */
export function listRegisteredConnectionOptionImagesKinds(): string[] {
  return Array.from(imagesRegistry.keys()).sort();
}

/** Test-only — clear between unit tests. */
export function __clearConnectionOptionImagesRegistryForTests(): void {
  imagesRegistry.clear();
}
