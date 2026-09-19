/**
 * Process-global backing store for this package's in-process registries.
 *
 * Why this exists: the desktop app hot-reloads the template stack by dropping
 * `@m0saic/template-utils` (and its dependents) out of `require.cache` and
 * re-requiring them, so a template edit lands in a RUNNING app without a
 * relaunch. A plain module-level `new Map()` is a *different* map after that
 * re-instantiation — every reference captured before the reload (the Electron
 * main process destructures `requireTemplate` at boot; external template repos
 * and 3P packs hold their own module instances) would then read an empty
 * registry, and every registered template would vanish mid-session.
 *
 * Anchoring the maps on `globalThis` under a versioned `Symbol.for` key makes
 * registry IDENTITY survive module re-instantiation: the old and new instances
 * of this module share one store. A reload swaps CODE without losing STATE.
 *
 * Bump the symbol's version suffix only if the stored value SHAPES change
 * incompatibly — two module instances with different shapes must not collide.
 */

const STORE_KEY = Symbol.for("m0saic.template-utils.registries.v1");

type RegistryStore = Map<string, Map<unknown, unknown>>;

function store(): RegistryStore {
  const g = globalThis as unknown as Record<symbol, RegistryStore | undefined>;
  let existing = g[STORE_KEY];
  if (!existing) {
    existing = new Map();
    g[STORE_KEY] = existing;
  }
  return existing;
}

/**
 * Get (creating on first call) the process-global Map registered under `name`.
 *
 * `name` is a package-local slug — it only has to be unique within this
 * package's own registries, since the whole store is namespaced by the symbol.
 */
export function processRegistry<K, V>(name: string): Map<K, V> {
  const s = store();
  let reg = s.get(name);
  if (!reg) {
    reg = new Map();
    s.set(name, reg);
  }
  return reg as Map<K, V>;
}

/**
 * Drop every process-global registry. TEST-ONLY — production code never wants
 * this (a hot reload deliberately preserves the store).
 */
export function __resetProcessRegistriesForTests(): void {
  store().clear();
}
