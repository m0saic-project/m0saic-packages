import type { RepoId, TemplateId } from "../identifiers";

/**
 * Template repo + manifest types.
 *
 * `template-manifest.json` is the **single entrypoint** for a template repo.
 * Hosts should be able to:
 * - list/filter templates (zero-exec)
 * - resolve preview assets (zero-exec)
 * - resolve the executable entry module (only when rendering)
 *
 * Scale goals:
 * - One file read per repo to populate the Templates view
 * - No code import required for browsing
 * - Stable, cacheable, forward-compatible
 */

/**
 * Identity + display metadata for a template repo.
 *
 * NOTE:
 * - This descriptor is embedded inside `template-manifest.json` so hosts can
 *   load a repo from a single file.
 * - Keep this small and stable; anything needed per-template belongs on the
 *   manifest entries instead.
 */
export type MosaicTemplateRepoDescriptor = {
  /**
   * Stable repo identifier used as the first segment of template IDs.
   *
   * Example: `"@m0saic-starter"`.
   *
   * Branded as {@link RepoId} — values must match
   * {@link NAMESPACED_ID_PATTERN} (degenerate single-segment case,
   * no slashes). Construct via {@link asRepoId} at JSON parse
   * boundaries.
   */
  repoId: RepoId;

  /** Human-friendly name shown in UI. */
  displayName: string;

  /**
   * Repo descriptor schema version.
   *
   * This allows evolving the `repo` object independently if needed.
   * Must be `1` for now.
   */
  schemaVersion: number;

  /** Optional description for template picker UI. */
  description?: string;

  /** Optional publisher shown as “curated by”. */
  curator?: string;

  /** Optional homepage or GitHub URL. */
  homepage?: string;

  /**
   * Optional asset directory hints (repo-relative).
   *
   * Hosts should treat these as recommendations; per-template preview paths
   * are always resolved relative to the repo root.
   */
  assets?: {
    /**
     * Repo-relative directory for template preview assets.
     *
     * Default (if omitted): "assets/templates"
     */
    templatesDir?: string;
  };
  /**
   * The repo's FRONT DOOR — the id of the template a newcomer renders first
   * (the hello-world convention, 2026-09-14). Hosts read it: the CLI's
   * `m0saic hello-world --template-repo <path>` renders it, Make's "Start
   * here" points at it, and the manifest carries it zero-exec.
   *
   * The default is the canonical brand card — one call to
   * `defineHelloWorldTemplate({ id, subline })` from `@m0saic/template-utils`
   * (the M, the wordmark, the field, plus the repo's own subline). A pack
   * that wants its own look writes its own template and names it here.
   * Optional today (the gate warns, never fails, when it is unset or names an
   * id the repo does not register — `repoFrontDoor`).
   */
  helloWorld?: TemplateId;
};

/**
 * Preview asset references for a template listing card.
 *
 * All paths are **repo-relative**, intended for zero-exec browsing UIs.
 */
export type MosaicTemplatePreview = {
  /** Repo-relative path to a static preview image (preferred). */
  image?: string;

  /** Repo-relative path to a short looping preview video (optional). */
  video?: string;

  /** Repo-relative poster image for video previews (optional). */
  poster?: string;
};

/**
 * Metadata entry for a single template inside `template-manifest.json`.
 *
 * These entries allow the UI to list/filter/badge templates without importing
 * or executing template code.
 *
 * Rule of thumb:
 * - If a field is needed for browsing (search/filter/badges), it belongs here.
 */
export type MosaicTemplateRepoManifestEntry = {
  /**
   * Template slug without repoId prefix.
   *
   * Example: `"hello-world"`.
   *
   * Must match {@link FRIENDLY_SLUG_PATTERN} — letters, digits,
   * `_`, `-`, `.`, no leading punctuation. Kept as `string` (not
   * branded) because it's an authoring field on JSON manifests
   * authored by humans; the platform helpers validate at load time.
   */
  slug: string;

  /**
   * Fully-qualified template key — `{repoId}/{pack}/{slug}/{version}`.
   *
   * Required so hosts never need to guess/derive IDs.
   *
   * Official templates carry a pack segment (`"@m0saic/charts/bar-graph/v2"`);
   * legacy / community ids may omit it (`"@m0saic-starter/hello-world/v1"`).
   *
   * Branded as {@link TemplateId} — same shape as
   * `MosaicTemplate.id`. Construct via {@link asTemplateId} at
   * JSON parse boundaries.
   */
  templateKey: TemplateId;

  /** Human-friendly title for UI display. */
  title?: string;

  /** Short description shown in listings. */
  description?: string;

  /** Search / filter tags (small, curated set). */
  tags?: string[];

  /**
   * Pack the template belongs to — the `{pack}` segment of {@link templateKey}
   * (e.g. `"charts"`, `"alpine"`). The namespacing unit a slug is unique
   * within: two packs may each ship a `bar-graph` slug.
   *
   * Optional + derivable from `templateKey`; emitted by the manifest generator
   * so browse surfaces can group/filter by pack without re-parsing ids.
   * `undefined` for legacy packless ids.
   */
  pack?: string;

  /**
   * Per-template attribution — who authored this template (display string or
   * handle). Repo-level curation lives on
   * {@link MosaicTemplateRepoDescriptor.curator}; this is the finer-grained
   * per-template credit a marketplace surfaces. Optional.
   */
  author?: string;

  /**
   * Publisher handle the template ships under — the `@<publisher>` first
   * segment of {@link templateKey} without the leading `@` (e.g.
   * `"m0saic-dev"` for `@m0saic-dev/hero/search-typing/v1`).
   *
   * Optional + derivable from `templateKey`; emitted by multi-publisher repos
   * (the community repo) so browse surfaces can group/filter by publisher
   * without re-parsing ids. Distinct from {@link author}: `publisher` is the
   * namespace the template lives in, `author` is display credit.
   */
  publisher?: string;

  /**
   * Optional preview assets (repo-relative paths).
   *
   * Hosts should prefer these values when present.
   * If omitted, hosts may fall back to a conventional asset path.
   */
  preview?: MosaicTemplatePreview;
};

/**
 * A named, releasable grouping of templates within a repo — the unit a
 * publisher ships and a browse surface lists as one card ("the Alpine data-viz
 * pack"). The `{pack}` segment of a {@link TemplateId} keys membership.
 *
 * Data-only for now (no install / fetch semantics): it describes a pack so
 * hosts can group + market it. The npm-scope analogy — a pack namespaces its
 * slugs and is the natural release boundary.
 */
export type MosaicTemplatePackDescriptor = {
  /**
   * Pack id — matches the `{pack}` segment of member template ids
   * (e.g. `"alpine"`). Unique within a single-publisher repo; in a
   * multi-publisher repo the real key is *(publisher, pack)* — two
   * publishers may each ship a `"charts"` pack, disambiguated by the
   * descriptor's {@link publisher} and the per-entry `publisher` field.
   */
  id: string;

  /** Human-friendly pack name shown in UI (e.g. `"Alpine Data Viz"`). */
  title: string;

  /** Short marketing / description blurb for the pack. */
  description?: string;

  /**
   * Optional publisher attribution for the pack as a whole (display string or
   * handle). Distinct from the repo-level
   * {@link MosaicTemplateRepoDescriptor.curator}.
   */
  publisher?: string;

  /**
   * Repo-relative path to a built entry module exposing ONLY this pack's
   * templates, for hosts that want pack-granular loading (the far-future
   * analogue of {@link MosaicTemplatePublisherDescriptor.entryModule}).
   */
  entryModule?: string;
};

/**
 * A publisher namespace inside a multi-publisher repo — the unit of ownership
 * and (future) selective loading. Each publisher owns the `@<id>/…` template
 * id prefix within the repo and maps to one `src/publishers/<id>/` subtree.
 *
 * Data-only: hosts use it to group the browse surface by publisher and to
 * resolve a per-publisher entry module without evaluating the whole repo.
 */
export type MosaicTemplatePublisherDescriptor = {
  /**
   * Publisher handle — the first segment of member template ids without the
   * leading `@` (e.g. `"m0saic-dev"`). Unique within a repo.
   */
  id: string;

  /** Human-friendly name shown in UI. */
  displayName: string;

  /** Short description / attribution blurb. */
  description?: string;

  /** Optional homepage or profile URL. */
  homepage?: string;

  /**
   * Repo-relative path to this publisher's built entry module (e.g.
   * `"./dist/publishers/m0saic-dev/index.js"`). Lets hosts load ONE
   * publisher's templates without evaluating the rest of the repo.
   */
  entryModule?: string;

  /** Number of manifest entries under this publisher (emitted by generators). */
  templateCount?: number;
};

/**
 * Schema for `template-manifest.json`.
 */
export type MosaicTemplateRepoManifest = {
  /**
   * Manifest schema version.
   *
   * Hosts MUST branch behavior by this value when making breaking changes.
   * Must be `1` for now.
   */
  schemaVersion: number;

  /**
   * Repo descriptor (identity + UI display metadata).
   *
   * Embedded so hosts can load a repo from **only** this manifest file
   * (no additional metadata fetch required).
   */
  repo: MosaicTemplateRepoDescriptor;

  /**
   * Template index for browsing.
   *
   * This array is the **authoritative browse surface**:
   * hosts SHOULD NOT import template code just to populate listings.
   */
  templates: MosaicTemplateRepoManifestEntry[];

  /**
   * Named packs in this repo — the releasable groupings member templates roll
   * up into (keyed by the `{pack}` segment of their ids). Optional: a repo with
   * no declared packs is still valid; hosts fall back to the per-entry `pack`
   * field or to no grouping at all.
   */
  packs?: MosaicTemplatePackDescriptor[];

  /**
   * Publisher namespaces in this repo (multi-publisher repos only — the
   * community repo). Optional and additive on schemaVersion 1: hosts that
   * predate the field ignore it; single-publisher repos omit it.
   */
  publishers?: MosaicTemplatePublisherDescriptor[];

  /**
   * Repo-relative path to the repo's built ESM entry module.
   *
   * This module is only needed when the host actually executes templates
   * (rendering / runtime behaviors).
   *
   * REQUIRED for any repo intended to render. Optional only to support
   * "index-only" repos during development.
   *
   * Example: "./dist/index.js"
   */
  entryModule?: string;
};