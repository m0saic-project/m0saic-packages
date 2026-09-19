import * as fs from "fs";
import * as path from "path";
import { getCommunityMRoot } from "../../paths/m0saicRoot";

/**
 * Host pre-fill of a template's `communityDir` prop (the
 * `@m0saic/brand/community-m/v1` contract, plan Phase 2/4).
 *
 * The template itself never reads `~/m0saic` (it must stay deterministic at
 * defaults: `""` = the bundled seed). The HOST — the CLI's `make` and the
 * desktop Make page — knows where its lazily-fetched copy of the public
 * community-m repo lives (`getCommunityMRoot()/current`, installed by the
 * Electron transport) and points the prop at it when three things hold:
 *   1. the template's schema declares a string prop named `communityDir`
 *      with `meta.control.picker === "folder"` (the opt-in signal — any
 *      template may reuse the convention);
 *   2. the user has not set it (unset / empty string);
 *   3. `<root>/current/index.json` exists (something was actually fetched).
 * Otherwise the props come back untouched (same object) and the template
 * falls back to its seed.
 */

export const COMMUNITY_DIR_PROP = "communityDir";

/** The host's installed community-m tree, or null when nothing was fetched yet. */
export function hostCommunityDir(root: string = getCommunityMRoot()): string | null {
  const dir = path.join(root, "current");
  try {
    return fs.statSync(path.join(dir, "index.json")).isFile() ? dir : null;
  } catch {
    return null;
  }
}

/** True when `propsSchema` declares the `communityDir` folder-picker prop. */
export function schemaWantsCommunityDir(propsSchema: unknown): boolean {
  if (!propsSchema || typeof propsSchema !== "object") return false;
  const def = (propsSchema as Record<string, unknown>)[COMMUNITY_DIR_PROP];
  if (!def || typeof def !== "object") return false;
  const d = def as { type?: unknown; meta?: { control?: { picker?: unknown } } };
  return d.type === "string" && d.meta?.control?.picker === "folder";
}

/**
 * Return `props` with `communityDir` pointed at the host cache when the
 * rules above hold; the SAME object otherwise (so callers can cheaply tell
 * whether anything changed).
 */
export function prefillCommunityDir<T extends Record<string, unknown>>(
  props: T,
  propsSchema: unknown,
  opts: { root?: string } = {},
): T {
  if (!schemaWantsCommunityDir(propsSchema)) return props;
  const current = props[COMMUNITY_DIR_PROP];
  if (typeof current === "string" && current.trim() !== "") return props;
  if (current !== undefined && current !== null && typeof current !== "string") return props;
  const dir = hostCommunityDir(opts.root);
  if (!dir) return props;
  return { ...props, [COMMUNITY_DIR_PROP]: dir };
}
