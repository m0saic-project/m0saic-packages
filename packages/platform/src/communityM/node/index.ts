// Node-only (fs/path) Community M helpers. Import via
// `@m0saic/platform/communityM/node` — NOT re-exported from the platform
// root, which must stay webpack/browser-safe.
export {
  loadCommunityManifestFromDir,
  resolveCommunityPath,
} from "./loadCommunityManifestFromDir";
export type { LoadCommunityManifestResult } from "./loadCommunityManifestFromDir";
export {
  validateCommunityPiece,
  COMMUNITY_PIECE_DEFAULT_LIMITS,
} from "./validateCommunityPiece";
export type {
  CommunityPieceLimits,
  ValidateCommunityPieceResult,
} from "./validateCommunityPiece";
export {
  COMMUNITY_DIR_PROP,
  hostCommunityDir,
  prefillCommunityDir,
  schemaWantsCommunityDir,
} from "./hostCommunityDir";
