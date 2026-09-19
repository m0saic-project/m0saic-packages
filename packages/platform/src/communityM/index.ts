// Pure (no node imports) — Community M manifest parsing, claim order and
// tile-state helpers. Shared by the web app, Mosaic Desktop (main), the
// CLI and the `@m0saic/brand/community-m/v1` template. Node-only readers
// (fs) live under `@m0saic/platform/communityM/node`.
export { M_TILES, M_GEOMETRY_M0, M_GEOMETRY_SIZE } from "./mTiles.generated";
export { computeClaimOrder } from "./claimOrder";
export { parseCommunityMManifest, isRelativeRepoPath } from "./parseCommunityMManifest";
export type { ParseCommunityMManifestResult } from "./parseCommunityMManifest";
export {
  communityMTileStates,
  nextOpenTile,
  communityMProgress,
  communityMFillDurationMs,
  resolveCommunitySlot,
} from "./tileState";
export type { CommunityMTileState, ResolveCommunitySlotResult } from "./tileState";
export {
  artHash,
  placeholderLogoSvg,
  placeholderAvatarSvg,
  placeholderLogoUrl,
  placeholderAvatarUrl,
  placeholderMixUrl,
  placeholderArtSvg,
  placeholderArtUrl,
  placeholderArtFocus,
  PLACEHOLDER_ART_SIZE,
} from "./placeholderArt";
export type { PlaceholderArtStyle } from "./placeholderArt";
