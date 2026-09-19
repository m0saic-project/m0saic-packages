import type {
  MosaicHostConnectionRegistration,
  MosaicHostConnectionId,
} from "@m0saic/types";
import { processRegistry } from "../processRegistry";

/**
 * In-process registry of host-connection registrations.
 *
 * 3P template packs call {@link registerHostConnection} at module
 * evaluation time (side-effect import); the host imports the pack and
 * reads from this registry to render its settings UI and probe
 * connections.
 *
 * Mirrors the `templateRegistry` pattern in the same package: same
 * surface (`register*` + `get*` + `list*`), same idempotency contract
 * (re-registering an id replaces the previous entry — last write wins,
 * with a warning).
 */

// Process-global so the desktop app's template hot reload (which drops this
// package from require.cache) swaps CODE without losing registrations. See
// `../processRegistry`.
const registry = processRegistry<string, MosaicHostConnectionRegistration>(
  "hostConnections",
);

/**
 * Register a host connection. Idempotent — re-registering an id
 * replaces the existing entry and emits a console warning so dev-time
 * double-imports don't go silently.
 *
 * The schema's `publisher` must match the publisher half of `id`
 * (everything before `@`). Mismatches throw at registration time
 * because they break the host's "group connections under owning pack"
 * UI invariant.
 */
export function registerHostConnection(
  registration: MosaicHostConnectionRegistration,
): void {
  const id = registration.schema.id;
  const idStr = id as unknown as string;

  // Validate id shape + publisher consistency. Surface mistakes loudly
  // at registration time — getting to render with a malformed id is a
  // worse failure than a hard throw here.
  const at = idStr.indexOf("@");
  if (at <= 0 || at === idStr.length - 1) {
    throw new Error(
      `registerHostConnection: schema.id ${JSON.stringify(idStr)} ` +
        `must be '<publisher>@<profile>' (e.g. 'github-dev@default').`,
    );
  }
  const publisherFromId = idStr.slice(0, at);
  if (registration.schema.publisher !== publisherFromId) {
    throw new Error(
      `registerHostConnection: schema.publisher ${JSON.stringify(
        registration.schema.publisher,
      )} must match the publisher half of id ${JSON.stringify(idStr)} (${JSON.stringify(publisherFromId)}).`,
    );
  }

  if (registry.has(idStr)) {
    // Warn but allow replacement — dev-time double imports / HMR are
    // common and shouldn't crash.
    // eslint-disable-next-line no-console
    console.warn(
      `[hostConnectionRegistry] Re-registering ${JSON.stringify(idStr)} — ` +
        `previous registration replaced.`,
    );
  }
  registry.set(idStr, registration);
}

/** Look up a registration by id. Returns `undefined` when unregistered. */
export function getHostConnection(
  id: MosaicHostConnectionId | string,
): MosaicHostConnectionRegistration | undefined {
  return registry.get(id as string);
}

/**
 * Throwing variant for code paths that have already validated
 * presence (settings UI loop, probe button handler).
 */
export function requireHostConnection(
  id: MosaicHostConnectionId | string,
): MosaicHostConnectionRegistration {
  const r = getHostConnection(id);
  if (!r) {
    throw new Error(
      `Host connection ${JSON.stringify(String(id))} is not registered. ` +
        `Make sure the owning template pack is imported (side-effect registration).`,
    );
  }
  return r;
}

/** List every registered id, sorted alphabetically. Stable across runs. */
export function listRegisteredHostConnectionIds(): string[] {
  return Array.from(registry.keys()).sort();
}

/** List every registration. Order matches {@link listRegisteredHostConnectionIds}. */
export function listRegisteredHostConnections(): MosaicHostConnectionRegistration[] {
  return listRegisteredHostConnectionIds().map(
    (id) => registry.get(id) as MosaicHostConnectionRegistration,
  );
}

/**
 * Test-only — clear the registry between unit tests. Not exported
 * from the package barrel; consumers find it via the direct file
 * path when they need it.
 */
export function __clearHostConnectionRegistryForTests(): void {
  registry.clear();
}
