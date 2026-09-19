import type { DictionaryEntryId } from "../identifiers";
import type { MosaicAspectRatio } from "../primitives";

export const OFFICIAL_DICTIONARY_CATEGORIES = [
  "split",
  "grid",
  "layout",
  "brand",
] as const;

export type OfficialMosaicDictionaryEntryCategory =
  (typeof OFFICIAL_DICTIONARY_CATEGORIES)[number];

export type MosaicDictionaryEntryCategory =
  | OfficialMosaicDictionaryEntryCategory
  | (string & {});

export type MosaicDictionaryEntry = {
  /**
   * Permanent entry identifier (e.g., "splits/2-col", "brand/m0saic-m-256").
   * Additive-only in minor/patch versions. Removal or rename requires major version.
   *
   * Branded as {@link DictionaryEntryId} — values must match
   * {@link NAMESPACED_ID_PATTERN}. Construct via the platform-layer
   * helpers or {@link asDictionaryEntryId} at JSON parse boundaries.
   */
  id: DictionaryEntryId;
  m0: string;
  sourceCount: number;

  // required discovery
  title: string;
  description: string;
  category: MosaicDictionaryEntryCategory;
  tags: string[];

  // optional metadata
  aspectRatio?: MosaicAspectRatio;
  emphasizeAllEqually?: boolean;
  recommendedResolutions?: { width: number; height: number }[];
  notes?: string;

  /**
   * Exact minimum feasible resolution for this layout.
   *
   * Computed via `computeFeasibility` from `@m0saic/dsl` at build time and
   * written into metadata.json by `validate.js`. Below these dimensions,
   * parsing produces 0-size frames and rendering fails.
   *
   * Shape mirrors the `M0Feasibility` type from `@m0saic/dsl`.
   *
   * Required: dictionary entries are static .m0 files, so this is always
   * known at build time. Dynamic DSL producers use `GeneratorDescriptor`
   * (a different type) instead.
   */
  feasibility: {
    minWidthPx: number;
    minHeightPx: number;
  };

  /**
   * The dimensions this entry was authored at, when known.
   *
   * Read from the `# size: WxH` header in the entry's `m0saic.m0` file
   * during build (`validate.js`). Optional because abstract layouts
   * (e.g. grids, splits) have no intrinsic "source resolution" — they
   * scale to any canvas above the feasibility floor.
   *
   * Consumers that load an entry "plain" with no canvas override should
   * default to this size. If absent, fall back to a recommended resolution
   * or the feasibility minimum.
   */
  sourceResolution?: {
    width: number;
    height: number;
  };

  /**
   * Precomputed complexity metrics for this entry's DSL.
   *
   * Populated at dictionary build time by `validate.js`, which reads each
   * entry's `m0saic.m0` file and runs `getComplexityMetricsFast` from
   * `@m0saic/dsl`. Consumers read this verbatim — there must be NO DSL ops
   * on dictionary entries at runtime. Heavy entries (e.g. the 700K-char
   * brand pattern) have non-trivial scan cost that would freeze the React
   * render / hover paths if computed on demand.
   *
   * Mirrors the `ComplexityMetrics` shape from `@m0saic/dsl` but kept
   * inline here so this package doesn't take a dependency on `@m0saic/dsl`.
   *
   * Required because the underlying .m0 is static. Dynamic DSL producers
   * use `GeneratorDescriptor` (a different type) instead of this one.
   */
  complexity: {
    frameCount: number;
    passthroughCount: number;
    nullCount: number;
    groupCount: number;
    nodeCount: number;
    precisionCost: number;
    precision: {
      maxSplitX: number;
      maxSplitY: number;
      maxSplitAny: number;
    };
  };

  /**
   * Relative path to the .m0 source file within the dictionary dist.
   * Present on heavy entries whose DSL is too large to inline in browser bundles.
   * The browser resolver fetches this file and parses it to get the m0 string.
   * When m0 is non-empty this field is not needed.
   */
  m0File?: string;

  /**
   * Per-entry config for generated text artifacts.
   * Defaults: { pretty: true, tree: true }
   *
   * - pretty:     m0saic_pretty.txt (indented multi-line DSL)
   * - tree:       m0saic_tree.txt (ASCII tree view)
   * - visual:     m0saic_visual.txt (valid DSL with whitespace, one row per line)
   * - visualArt:  m0saic_visual_art.txt (block art — zoom out to see shape)
   * - visualAreas: m0saic_visual_areas.txt (area labels — connected component IDs)
   *
   * Visual artifacts are dev affordances. Only m0saic.m0 is used at runtime.
   */
  artifacts?: {
    pretty?: boolean;
    tree?: boolean;
    visual?: boolean;
    visualArt?: boolean;
    visualAreas?: boolean;
  };

  /**
   * Preview strategy for dictionary cards.
   *
   * - canvas: lightweight SVG computed from DSL (default if absent)
   * - image:  shipped PNG asset (for heavy/complex entries)
   *
   * When mode is "image", `src` is the filename relative to the entry directory
   * (e.g. "preview.png"). At runtime in browser bundles, `dataUrl` carries the
   * resolved base64 data URL so no asset resolution is needed.
   */
  preview?: {
    mode: "canvas" | "image";
    src?: string;
    dataUrl?: string;
  };

  /**
   * Per-cell rank sets carried by the entry's source m0c file (`m0saic.m0c`).
   *
   * Populated at dictionary build time when the entry ships as a `.m0c`
   * file. Outer keys are friendly set names (`"diag"`, `"cascade"`,
   * `"radial"`, `"hero"`, `"custom"`, …); inner keys are post-parse
   * `StableKey`s in the entry's local keyspace; values match
   * {@link MosaicRankSet}. `null` inner entries mean "this frame has no
   * rank in this set"; absent inner keys mean "no opinion".
   *
   * This is the canonical rank-access path for `.m0c`-sourced entries.
   * The older sidecar `*_ranks.json` mechanism (which had this field shaped
   * as `Record<string, string>` of relative file paths) has been retired
   * — rank data now flows through the m0c, the same way labels and masks
   * do.
   *
   * Absent when the entry's source is plain `.m0` (no rank channel).
   */
  rankSets?: Record<string, MosaicRankSet>;

  /**
   * Named mask sets (first-class).
   * Key = mask set name used by templates (e.g. "default").
   * Value = relative path to a JSON file within this dictionary entry folder
   * (e.g. "masks.json").
   *
   * Mask JSON file format: { masks: (MosaicMaskEntry | null)[] }
   * Array length === sourceCount. null = full rect (no mask needed).
   */
  maskSets?: Record<string, string>;

  /**
   * Per-cell labels carried by the entry's source m0c file (`m0saic.m0c`).
   *
   * Populated at dictionary build time when the entry ships as a `.m0c`
   * file rather than a plain `.m0`. Keys are post-parse `StableKey`s in
   * the entry's local keyspace; values match the canonical `M0Label`
   * shape from `@m0saic/dsl`.
   *
   * Consumers (templates, the editor) look up named landmarks by `text`
   * — e.g. a brand-QR entry exposes its centre safe area as
   * `{ text: "safe-area" }` so `@m0saic/media/qr/animate/v1` can target
   * the M region without being told a stableKey.
   *
   * Absent when the entry's source is plain `.m0` (no label channel).
   */
  labels?: Record<string, { text: string; color?: string }>;

  /**
   * Per-cell clipping masks carried by the entry's source m0c file
   * (`m0saic.m0c`).
   *
   * Populated at dictionary build time when the entry ships as a `.m0c`
   * file rather than a plain `.m0`. Keys are post-parse `StableKey`s in
   * the entry's local keyspace; values match {@link MosaicMaskEntry}.
   * `null` entries mean the tile is a full rect (no mask needed) — kept
   * explicit so callers can distinguish "intentionally rectangular" from
   * "no entry at all" if they ever need to.
   *
   * Consumers look up per-frame masks by the source frame's StableKey;
   * see `getSourceOrderStableKeys` in `@m0saic/dictionary` for resolving
   * source index → StableKey.
   *
   * This is the canonical mask-access path for `.m0c`-sourced entries.
   * The older `maskSets` / `maskSetsResolved` mechanism is reserved for
   * future named-alternate mask sets (parallel to `rankSets`) and is
   * NOT populated for entries that carry their canonical masks here.
   *
   * Absent when the entry's source is plain `.m0` (no mask channel).
   */
  masks?: Record<string, MosaicMaskEntry | null>;
};

/**
 * Rank set file referenced by MosaicDictionaryEntry.rankSets
 *
 * Represents a deterministic ordering / progression over tiles.
 */
export type MosaicRankSetFile = {
  /**
   * Optional semantic hint for how the ranks were generated
   * (e.g. "diag", "spiral", "row-major").
   * Informational only; not interpreted by core.
   */
  mode?: string;

  /**
   * Rank values, one per source.
   * Must have length === entry.sourceCount.
   * Values are typically normalized to [0, 1].
   */
  ranks: number[];
};

/**
 * Per-frame rank value carried in `MosaicRankSet.ranks`. Sweep progress,
 * conventionally normalized to `[0..1]`.
 */
export type MosaicRankSetEntry = number;

/**
 * A single named rank set carried inline on the `MosaicDictionaryEntry`
 * (sourced from the entry's `m0saic.m0c` `rankSets` field), keyed by the
 * entry's local-keyspace `StableKey`s.
 *
 * Structural mirror of `M0cRankSet` in `@m0saic/dsl-file-formats` — see
 * that package's `MIRRORED_TYPES.md` for the alignment policy.
 *
 * Use this shape for ranks-as-first-class on `.m0c`-sourced dictionary
 * entries. The older `MosaicRankSetFile` (positional `ranks: number[]`,
 * loaded from a `*_ranks.json` sidecar) is preserved as the shape returned
 * by `@m0saic/dsl-stdlib`'s positional rank builders; it is **not** the
 * m0c-inline shape.
 *
 * Field semantics:
 * - `mode`: optional informational ordering hint (e.g. `"diag"`,
 *   `"cascade"`, `"radial"`, `"custom"`). Round-trips unchanged.
 * - `ranks`: per-frame rank values keyed by `StableKey`. Null entries mean
 *   "explicitly no rank for this frame"; absent keys mean "no opinion".
 */
export type MosaicRankSet = {
  mode?: string;
  ranks: Record<string /* StableKey */, MosaicRankSetEntry | null>;
};

/**
 * A single mask entry for a non-rectangular source frame.
 *
 * Describes an SVG path in local (node-relative) coordinates that clips
 * the tile to its true shape. At render time the engine scales the path
 * from designBounds to actual tile pixel dimensions and rasterizes it.
 */
export type MosaicMaskEntry = {
  /**
   * SVG path data in local coordinates (relative to the tile's design bounds).
   * Example: "M 21.3477 30.9223 L -0.325 0.388 V 45.1067 H 31.924 Z"
   */
  localPath: string;

  /**
   * Design-space bounding box this path was authored against.
   * Used to compute the scale factor at render time:
   *   scaleX = tileRenderWidth / bounds.width
   *   scaleY = tileRenderHeight / bounds.height
   */
  bounds: { x: number; y: number; width: number; height: number };
};

/**
 * Mask set file referenced by MosaicDictionaryEntry.maskSets
 *
 * Describes per-source clipping masks for non-rectangular tiles.
 * Array is indexed by canonical source order (same as sources[]).
 * null entries mean the tile is a full rectangle — no masking needed.
 */
export type MosaicMaskSetFile = {
  /**
   * One entry per source frame.
   * Must have length === entry.sourceCount.
   * null = full rect tile, no mask applied.
   */
  masks: (MosaicMaskEntry | null)[];
};

export type MosaicDictionaryEntryResolved = MosaicDictionaryEntry & {
  /**
   * Parsed mask sets, resolved from maskSets file paths.
   * Present only at runtime (not serialized).
   */
  maskSetsResolved?: Record<string, MosaicMaskSetFile>;

  /**
   * Base URL for this entry's assets (preview images, .m0 files).
   * Set automatically by the registry when an entry is registered from
   * a non-default dictionary source. If absent, the global
   * `dictionaryAssetsBase` is used.
   */
  assetsBase?: string;
};

// ─────────────────────────────────────────────────────────────
// Dictionary source (extensible dictionary contract)
// ─────────────────────────────────────────────────────────────

/**
 * A dictionary source — the contract any dictionary package must export.
 *
 * The official `@m0saic/dictionary` is one source. Additional dictionaries
 * (custom, community, private) register at runtime via
 * `registry.register(source)` from `@m0saic/dictionary`.
 */
export type MosaicDictionarySource = {
  /** Unique identifier, e.g. "@m0saic/dictionary", "@my-org/my-dictionary". */
  readonly name: string;
  /** All entries from this source. */
  readonly all: MosaicDictionaryEntryResolved[];
  /** Entries keyed by id. */
  readonly byId: Record<string, MosaicDictionaryEntryResolved>;
  /** Look up a rank set by entry ID and set name. */
  getRankSet(entryId: string, name: string): MosaicRankSet;
  /** Look up a mask set by entry ID and set name. */
  getMaskSet(entryId: string, name: string): MosaicMaskSetFile;
  /** Base path for serving this dictionary's assets via HTTP. */
  readonly assetsBasePath: string;
};

// ─────────────────────────────────────────────────────────────
// Dictionary manifest (zero-exec browsable catalog)
// ─────────────────────────────────────────────────────────────

/** Manifest entry for a single dictionary entry (zero-exec browsable). */
export type DictionaryManifestEntry = {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  sourceCount: number;
  preview?: { image?: string };
};

/**
 * Dictionary manifest — the zero-exec browsable surface for a dictionary repo.
 * Mirrors the template-manifest.json pattern from template repos.
 */
export type DictionaryManifest = {
  schemaVersion: 1;
  repo: {
    repoId: string;
    displayName: string;
    description: string;
    curator: string;
    homepage?: string;
  };
  entryModule: string;
  entries: DictionaryManifestEntry[];
  generators?: Array<{
    id: string;
    title: string;
    description: string;
    category: string;
  }>;
};
