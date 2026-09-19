// Public surface of @m0saic/template-utils. Grouped into concern folders
// (2026-07-07 reorg; see .scratch/claude/template-utils-reorg-proposal.md).
// Each folder owns its own index.ts barrel; the surface is unchanged.
export * from "./template";
export * from "./render";
export * from "./theming";
export * from "./data";
export * from "./codes";
export * from "./sources";
export * from "./layout";
export * from "./geometry";
export * from "./geometry-contract";
export * from "./media";
export * from "./stamp";
export * from "./text";
export * from "./print";
export * from "./lattice";

// Root-level cross-cutting helpers (deliberately not foldered).
export * from "./transitions";
export * from "./seededRng";
export * from "./deprecation";
export * from "./deprecated";

// Pre-existing concern folders (unchanged by the reorg).
export * from "./anim";
export * from "./m0saic";
// NOTE: ./dev is NOT re-exported here — renderTemplateToMosaicFile /
// renderTemplatePackToMosaicFiles use node:fs/node:path/node:os, which break
// webpack (react-scripts) in the web app. Node callers (CLI tooling, tests)
// import directly: require("@m0saic/template-utils/dist/dev")
export * from "./primitives";
export * from "./brand";
export * from "./ffexpr";

import * as forensicNs from "./forensic";
export { forensicNs as forensic };

// Re-exported from @m0saic/platform as the recommended convention for
// template authors who need to mint a safe manifest key from a user-
// supplied string (typically a file path). The authoritative home is
// platform — the helper is a pure document-substrate transform — but
// surfacing it here points template authors at it under their habitual
// namespace.
export {
  slugifyAssetKey,
  slugifyAssetKeyFromPath,
  uniqueAssetKey,
} from "@m0saic/platform";
