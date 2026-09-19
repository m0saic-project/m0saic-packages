/**
 * The template-utils graveyard — deprecated helpers live HERE, out of the
 * working folders, but stay exported from the package surface: deprecated
 * ≠ removed (archived reference templates still import them, and archives
 * stay compilable by design). Every module in this folder must have an
 * entry in `../deprecation.ts` (`HELPER_DEPRECATIONS`) and a `@deprecated`
 * JSDoc tag on its export. Purge a module only when its last archived
 * consumer is purged.
 */
export * from "./gridCellInset";
