/**
 * Structural shapes for the usage metrics that ride the rollup
 * (`metrics.features` / `metrics.templatesUsed`). This module knows the
 * SHAPE of a feature key, never the product's feature list — the closed
 * key enum is owned by the hosts (in this monorepo,
 * `@m0saic/types-internal`) and enforced at their boundary and again on
 * the server, which rejects unknown keys.
 */

/**
 * Shape rule every feature key must satisfy: dotted, lower-case,
 * `[a-z0-9_]` segments, 2–4 segments, ≤ {@link MAX_FEATURE_KEY_CHARS}.
 * By construction a key of this shape cannot carry a path, a URL, a
 * template id or free text.
 */
export const FEATURE_KEY_SHAPE_RE = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){1,3}$/;
export const MAX_FEATURE_KEY_CHARS = 40;
export const isFeatureKeyShaped = (v: unknown): v is string =>
  typeof v === "string" && v.length <= MAX_FEATURE_KEY_CHARS && FEATURE_KEY_SHAPE_RE.test(v);

/** Sparse counters — only nonzero keys, each a member of the host's closed enum. */
export type MosaicFeatureCounts = Readonly<Record<string, number>>;

/** Host-stamped template provenance — the safe discriminator (never the id prefix). */
export type MosaicTemplateKind = "builtin" | "community" | "external";

/**
 * First-party catalog ids by SHAPE. The client sends an id only when its
 * provenance is `builtin`; the server validates the shape so a new
 * first-party template can never 422 a whole rollup.
 */
export const FIRST_PARTY_TEMPLATE_ID_RE = /^@m0saic\/[a-z0-9-]+(?:\/[a-z0-9-]+){0,3}\/v\d{1,3}$/;
export const MAX_TEMPLATES_USED = 64;
export const MAX_TEMPLATE_ID_CHARS = 80;
