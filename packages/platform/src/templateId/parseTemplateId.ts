/**
 * Structured parse / format for {@link TemplateId} strings.
 *
 * The raw character grammar lives in `@m0saic/types`
 * ({@link NAMESPACED_ID_PATTERN}); this module is the higher-level
 * *structured* constructor the identifiers doc points at platform for.
 *
 * Two first-class shapes:
 * - Official 4-segment `@<publisher>/<pack>/<slug>/v<major>`
 *   (e.g. `@m0saic/charts/bar-graph/v2`) — every official template carries a pack.
 * - Community 3-segment `@<author>/<slug>/v<major>` (e.g. `@jane-doe/widget/v1`) —
 *   a packless author scope; parses to `pack: undefined`.
 *
 * Packless is the community convention, NOT a deprecated form — both shapes are
 * supported on purpose.
 *
 * Pure + deterministic: no I/O, no clock, no randomness.
 */

import type { RepoId, TemplateId } from "@m0saic/types";
import { asRepoId, asTemplateId } from "@m0saic/types";

/** Structured view of a parsed {@link TemplateId}. */
export type ParsedTemplateId = {
  /** First segment — the publisher / repo scope (e.g. `"@m0saic"`). */
  publisher: RepoId;
  /**
   * Pack segment (e.g. `"charts"`, `"alpine"`). The namespacing unit a slug
   * is unique within. `undefined` for packless community/author-scoped ids.
   */
  pack: string | undefined;
  /** Template slug within the pack (e.g. `"bar-graph"`). */
  slug: string;
  /** Version segment, verbatim (e.g. `"v2"`). */
  version: string;
};

/**
 * Parse a {@link TemplateId} into its `{ publisher, pack, slug, version }`
 * parts. Throws on a string with fewer than 3 slash-separated segments
 * (not enough to carry publisher + slug + version).
 */
export function parseTemplateId(id: TemplateId | string): ParsedTemplateId {
  const segments = String(id).split("/");
  if (segments.length < 3) {
    throw new Error(
      `Invalid TemplateId "${id}": expected at least publisher/slug/version (>= 3 segments).`,
    );
  }

  const publisher = segments[0];
  const version = segments[segments.length - 1];
  const middle = segments.slice(1, -1);

  // middle === [slug]                → packless community/author scope
  // middle === [pack, slug]          → canonical official 4-segment
  // middle === [pack, ...slugParts]  → nested slug under a pack (e.g. .../internal/bar-cell)
  const pack = middle.length >= 2 ? middle[0] : undefined;
  const slug = middle.length >= 2 ? middle.slice(1).join("/") : middle[0];

  return { publisher: asRepoId(publisher), pack, slug, version };
}

/**
 * Inverse of {@link parseTemplateId}. Joins the parts back into a
 * `@publisher/pack/slug/version` string (pack omitted when `undefined`).
 */
export function formatTemplateId(parts: {
  publisher: RepoId | string;
  pack?: string;
  slug: string;
  version: string;
}): TemplateId {
  const { publisher, pack, slug, version } = parts;
  const joined = [publisher, ...(pack ? [pack] : []), slug, version].join("/");
  return asTemplateId(joined);
}

/**
 * Convenience: the pack-scoped slug key (`"<pack>/<slug>"`, or bare `slug`
 * when there's no pack). This is the key a repo's slugs are unique under —
 * the npm-scope model where a pack namespaces its slugs.
 */
export function packScopedSlug(id: TemplateId | string): string {
  const { pack, slug } = parseTemplateId(id);
  return pack ? `${pack}/${slug}` : slug;
}
