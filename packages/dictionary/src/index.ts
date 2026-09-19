/**
 * @m0saic/dictionary
 *
 *   entries    — fixed canonical layouts loaded from .m0 files
 *   generators — parameterized layout producers that emit live DSL
 *   operations — descriptors for the non-generator editor affordances
 *                (compact / split / edit / draw) exposed to agents
 *
 * ## Stability contract
 *
 * Entry IDs (e.g., "splits/2-col", "brand/m0saic-m-256") are permanent
 * public contract. They are used in app code, stored in user data, and
 * referenced by templates.
 *
 * - **Adding** entries: allowed in any version (minor or patch).
 * - **Removing** entries: requires a major version bump.
 * - **Renaming** entry IDs: treated as remove + add — requires major version.
 * - **Changing** an entry's M0 string: requires a major version bump
 *   (geometry and source count may change).
 * - **Changing** metadata (title, description, tags): allowed in minor/patch.
 *
 * Generator IDs and parameter schemas follow the same rules.
 *
 * ## Import strategy
 *
 * Always import from `@m0saic/dictionary`:
 *
 *   import { entries, generators, resolveM0saic } from "@m0saic/dictionary";
 *
 * - **Node / CLI**: resolves to this file. Reads .m0 files from disk via fs.
 * - **Browser bundles**: resolves to `browser.ts` via the `"browser"` field
 *   in package.json. DSL strings are inlined for light entries; heavy brand
 *   entries use `resolveM0saic(entry)` to fetch from the server.
 *
 * Both environments export the same types and API shape.
 */

import * as _entries from "./entries";
import * as _generators from "./generators";
import * as _operations from "./operations";
import { registry } from "./registry";

export const entries = _entries;
export const generators = _generators;
export const operations = _operations;

export { registry, DictionaryRegistry } from "./registry";

// Operation descriptor types — top-level so consumers can type against
// them without reaching through the `operations` namespace value.
export type { OperationDescriptor, OperationKind } from "./operations";

// Auto-register the official dictionary (Node entry point)
registry.register({
  name: "@m0saic/dictionary",
  all: _entries.all,
  byId: _entries.byId,
  getRankSet: _entries.getRankSet,
  getMaskSet: _entries.getMaskSet,
  assetsBasePath: "/dictionary",
});

export {
  resolveM0saic,
  setDictionaryAssetsBase,
  dictionaryAssetsBase,
} from "./resolve";

export {
  getSourceOrderStableKeys,
  getSourceOrderStableKeysForM0,
} from "./sourceOrder";

// ── Scoring ──
// Moved to @m0saic/momo/scoring (it is AI evaluation of a layout; momo owns
// AI-related shape). Import from there directly — the dictionary no longer
// re-exports it, which also breaks the dictionary↔momo build cycle.
