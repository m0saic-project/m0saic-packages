import type { AssetId } from "../identifiers";
import type { MosaicMediaKind } from "../source";

export type { AssetId } from "../identifiers";
export { asAssetId } from "../identifiers";

// ─────────────────────────────────────────────────────────────────────────────
// MosaicAsset — discriminated union
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Optional fields shared by every asset entry.
 *
 * `displayName` is the human-friendly label for editor UIs.
 * `mediaType` is the author-declared kind (image/video/audio) — advisory
 * metadata that helps the editor; the renderer probes the actual content
 * for authoritative dimensions / duration.
 */
type MosaicAssetCommon = {
  displayName?: string;
  mediaType?: MosaicMediaKind;
};

/**
 * Local-filesystem media asset.
 *
 * `path` is an absolute filesystem path on the machine that loaded the
 * `.mosaic` file. Relative paths are normalized against the document's
 * source-file directory at load time, so by the time downstream code sees
 * an entry, `path` is absolute.
 */
export type MosaicAssetFile = MosaicAssetCommon & {
  kind: "file";
  path: string;
};

/** Remote URL asset (http(s)://…). */
export type MosaicAssetUrl = MosaicAssetCommon & {
  kind: "url";
  url: string;
};

/** Inline `data:` URI asset. */
export type MosaicAssetDataUri = MosaicAssetCommon & {
  kind: "data-uri";
  uri: string;
};

/**
 * The three asset kinds that appear in a serialized `.mosaic` JSON file.
 *
 * A `MosaicAsset` is always one of:
 *   - `file`     — a local filesystem path
 *   - `url`      — a remote http(s):// URL
 *   - `data-uri` — an inline `data:` URI
 *
 * Plugin and template authors emit entries of these kinds when they want
 * a media source to reference content. Validators in `@m0saic/platform`
 * enforce that nothing else is present at parse time.
 */
export type MosaicAsset =
  | MosaicAssetFile
  | MosaicAssetUrl
  | MosaicAssetDataUri;

/** Set of asset kinds that are valid in serialized `.mosaic` JSON. */
export const ASSET_KINDS = ["file", "url", "data-uri"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/**
 * Per-document asset manifest.
 *
 * A flat map from {@link AssetId} keys to {@link MosaicAsset} entries.
 * Each `MosaicDocument` owns its own manifest at authoring time;
 * nested children's manifests are namespaced and merged into one
 * master manifest at flatten time. See {@link MosaicDocument.assets}
 * for the full authoring-vs-render-time story.
 */
export type MosaicAssetManifest = Record<AssetId, MosaicAsset>;
