import {
  type AssetId,
  type MosaicAsset,
  type MosaicAssetManifest,
  type MosaicMediaKind,
} from "@m0saic/types";

/**
 * The single boundary between the asset manifest and concrete representations.
 *
 * Every callsite that needs to turn a `MosaicMediaSource.assetId` into a
 * concrete form (filesystem path, browser URL, ffmpeg argv, display name)
 * goes through this function. The caller declares which target form it
 * needs; the resolver picks the right representation for the entry's kind
 * or throws an `AssetResolveError` with a structured code.
 *
 * Browser-safe: no Node `path` or `fs` imports at module scope. Path joining
 * for `mosaic-asset://` URLs is pure string work that runs identically in
 * Node and the browser.
 *
 * Scope: only the on-disk `MosaicAsset` kinds (`file`, `url`, `data-uri`).
 * The engine has its own private bookkeeping kinds; those never reach this
 * resolver and live inside `@m0saic/core`.
 */

export type AssetResolveCode =
  | "ASSET_NOT_FOUND"
  | "ASSET_KIND_INCOMPATIBLE"
  | "ASSET_MALFORMED";

export class AssetResolveError extends Error {
  readonly code: AssetResolveCode;
  readonly assetId?: AssetId;

  constructor(code: AssetResolveCode, message: string, assetId?: AssetId) {
    super(message);
    this.name = "AssetResolveError";
    this.code = code;
    this.assetId = assetId;
  }
}

export type AssetResolveMode =
  | { target: "node-path" }
  | { target: "browser-url" }
  | {
      target: "ffmpeg-input";
      /** Frame rate for image inputs that need `-loop 1 -framerate <fps>`. */
      fps?: number;
      /**
       * The source's declared `mediaType`. Determines whether to emit
       * the still-image input flags or the video/audio input form.
       */
      mediaType?: MosaicMediaKind;
    }
  | { target: "display-name" };

export type AssetResolveResult =
  | { target: "node-path"; value: string }
  | { target: "browser-url"; value: string }
  | { target: "ffmpeg-input"; argv: string[] }
  | { target: "display-name"; value: string };

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the `mosaic-asset:///<path>` URL the editor / Electron protocol
 * handler exchanges. Mirrors the editor's prior `toAssetUrl` exactly so
 * the existing protocol handler at `apps/mosaic/electron/main.js` works
 * unchanged. Browser-safe (string-only).
 *
 * Percent-encodes the three characters that would otherwise be eaten by
 * the URL parser before `decodeURIComponent` runs on the other side:
 *   - `%` (must be escaped first, as the escape introducer)
 *   - `#` (fragment delimiter — without encoding, paths like
 *     `foo#31.jpg` get truncated to `foo` in `url.pathname`)
 *   - `?` (query delimiter — same class of bug as `#`)
 * Path separators (`/`), Windows drive-letter colon, spaces, ampersands,
 * etc. survive intact because Chromium's URL parser tolerates them in a
 * path component.
 */
function toMosaicAssetUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/");
  const withLeading = normalized.startsWith("/") ? normalized : "/" + normalized;
  const encoded = withLeading
    .replace(/%/g, "%25")
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F");
  return "mosaic-asset://" + encoded;
}

/** Last segment of a forward-or-backslash path. Pure string work. */
function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx === -1 ? p : p.slice(idx + 1);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-kind handlers
// ─────────────────────────────────────────────────────────────────────────────

function resolveFile(
  assetId: AssetId,
  asset: Extract<MosaicAsset, { kind: "file" }>,
  mode: AssetResolveMode,
): AssetResolveResult {
  if (typeof asset.path !== "string" || asset.path.length === 0) {
    throw new AssetResolveError(
      "ASSET_MALFORMED",
      `asset ${String(assetId)} (kind=file) has no path`,
      assetId,
    );
  }
  switch (mode.target) {
    case "node-path":
      return { target: "node-path", value: asset.path };
    case "browser-url":
      return { target: "browser-url", value: toMosaicAssetUrl(asset.path) };
    case "ffmpeg-input": {
      const mediaType = mode.mediaType ?? asset.mediaType;
      if (mediaType === "image") {
        const fps = mode.fps;
        if (fps == null) {
          throw new AssetResolveError(
            "ASSET_MALFORMED",
            `asset ${String(assetId)} (kind=file, mediaType=image) requires fps for ffmpeg-input`,
            assetId,
          );
        }
        return {
          target: "ffmpeg-input",
          argv: ["-loop", "1", "-framerate", String(fps), "-i", asset.path],
        };
      }
      return { target: "ffmpeg-input", argv: ["-i", asset.path] };
    }
    case "display-name":
      return {
        target: "display-name",
        value: asset.displayName ?? basename(asset.path),
      };
  }
}

function resolveUrl(
  assetId: AssetId,
  asset: Extract<MosaicAsset, { kind: "url" }>,
  mode: AssetResolveMode,
): AssetResolveResult {
  switch (mode.target) {
    case "node-path":
      throw new AssetResolveError(
        "ASSET_KIND_INCOMPATIBLE",
        `asset ${String(assetId)} (kind=url) has no filesystem path`,
        assetId,
      );
    case "browser-url":
      return { target: "browser-url", value: asset.url };
    case "ffmpeg-input":
      return { target: "ffmpeg-input", argv: ["-i", asset.url] };
    case "display-name":
      return { target: "display-name", value: asset.displayName ?? asset.url };
  }
}

function resolveDataUri(
  assetId: AssetId,
  asset: Extract<MosaicAsset, { kind: "data-uri" }>,
  mode: AssetResolveMode,
): AssetResolveResult {
  switch (mode.target) {
    case "node-path":
      throw new AssetResolveError(
        "ASSET_KIND_INCOMPATIBLE",
        `asset ${String(assetId)} (kind=data-uri) has no filesystem path`,
        assetId,
      );
    case "browser-url":
      return { target: "browser-url", value: asset.uri };
    case "ffmpeg-input": {
      // Mirror resolveFile: a still image needs `-loop 1 -framerate <fps>` so
      // it produces a continuous stream (otherwise it's a single frame and an
      // overlay over a multi-frame base breaks). ffmpeg's `data:` protocol
      // decodes the URI in place, so the loop/framerate stamps apply just as
      // they do to a file path. mediaType defaults to undefined (no loop) so
      // non-image data-uris are unaffected.
      const mediaType = mode.mediaType ?? asset.mediaType;
      if (mediaType === "image") {
        const fps = mode.fps;
        if (fps == null) {
          throw new AssetResolveError(
            "ASSET_MALFORMED",
            `asset ${String(assetId)} (kind=data-uri, mediaType=image) requires fps for ffmpeg-input`,
            assetId,
          );
        }
        return {
          target: "ffmpeg-input",
          argv: ["-loop", "1", "-framerate", String(fps), "-i", asset.uri],
        };
      }
      return { target: "ffmpeg-input", argv: ["-i", asset.uri] };
    }
    case "display-name":
      return {
        target: "display-name",
        value: asset.displayName ?? `<${truncate(asset.uri, 32)}>`,
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function resolveAsset(
  manifest: MosaicAssetManifest,
  assetId: AssetId,
  mode: AssetResolveMode,
): AssetResolveResult {
  const asset = manifest[assetId];
  if (asset == null) {
    throw new AssetResolveError(
      "ASSET_NOT_FOUND",
      `asset ${String(assetId)} not found in manifest`,
      assetId,
    );
  }
  switch (asset.kind) {
    case "file":
      return resolveFile(assetId, asset, mode);
    case "url":
      return resolveUrl(assetId, asset, mode);
    case "data-uri":
      return resolveDataUri(assetId, asset, mode);
    default: {
      // Exhaustiveness guard — if a new on-disk kind is added without a
      // handler, surface it as a structured error rather than returning
      // undefined. Engine-internal kinds (lavfi, node-output) are NOT
      // expected here and would fall through to this branch.
      throw new AssetResolveError(
        "ASSET_MALFORMED",
        `asset ${String(assetId)} has unknown kind ${(asset as { kind: string }).kind}`,
        assetId,
      );
    }
  }
}
