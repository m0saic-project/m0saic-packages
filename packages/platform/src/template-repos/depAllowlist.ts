/**
 * Dependency allowlist for the official community-templates repo — the ONE
 * list of external packages community template code may import.
 *
 * Two consumers must not drift from each other:
 *  - the community repo's CI gate (`tools/check-deps.mjs` reads the repo's
 *    committed `dep-allowlist.json`; a lockstep test in the community
 *    package asserts that file equals this constant), and
 *  - the desktop app's dev-only module-resolution patch, which re-resolves
 *    exactly these non-`@m0saic/` packages from the host's node_modules for
 *    externally-loaded repos.
 *
 * The list is also PHYSICALLY bounded: in a packaged build, external repos
 * resolve dependencies only through the app's shipped node_modules — so
 * every entry here must be a dependency of `apps/mosaic`.
 *
 * POLICY (founder ruling 2026-09-16): community templates may import only
 * what the hosts already ship — the `@m0saic/*` substrate below plus the
 * listed node builtins. A native or third-party runtime dependency is a
 * founder decision, never a per-PR addition: `sharp` and `@twemoji/svg`
 * left this list together with the defunct `@m0saic-dev/community-m` pack
 * (its only user), which also let the desktop asar drop `@img/sharp`.
 */
export const TEMPLATE_REPO_DEP_ALLOWLIST = {
  /** npm packages template code may import (subpaths of them included). */
  packages: [
    "@m0saic/types",
    "@m0saic/template-utils",
    "@m0saic/dsl-stdlib",
    "@m0saic/platform",
    "@m0saic/dsl",
  ],
  /** node builtins allowed without a per-file exception entry. */
  builtins: ["node:path", "path"],
} as const;
