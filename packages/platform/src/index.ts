export * from "./mosaic/flatten";
export * from "./mosaic/layoutFloors";
export * from "./mosaic/validate";
// Pure (no node imports) — the flat-document rect-edit operation
// (Make-page geometry Edit mode), safe for both CLI/Electron and web.
export * from "./mosaic/edit";
// Pure (no node imports) — the one predicate for "which template prop does
// this rect edit?" (source.editor.binding), shared by template-utils'
// resolver/tests and the Make page's inline prop editor.
export * from "./mosaic/propBindings";
// Pure (no node imports) — still-vs-video resolution for a renderable:
// the author's `format.kind` stamp, else inferred from the document's own
// time-variance. Shared by Make's Auto output type and template tests.
export * from "./mosaic/outputKind";
// Pure (no node imports) — the canonical-m0 document serializer, safe for
// both CLI/Electron and the webpack/web Compose save path.
export * from "./mosaic/serializeMosaicDocument";
// Pure (no node imports) — browser-safe manifest-path absolutizer, the web
// Compose open path's sibling of loadMosaicDocument's node-only version.
export * from "./mosaic/absolutizeManifestPathsWeb";
// Pure (no node imports) — template invocations over the wire: the share-link
// payload codec, query grammar, prop portability rules and the .mosaicx bridge.
// Shared by the web app (Make share), the CLI and Mosaic Desktop.
export * from "./share";
// Pure (no node imports) — Community M manifest parsing, claim order and
// tile-state helpers (fs readers live under "@m0saic/platform/communityM/node").
export * from "./communityM";
export * from "./asset";
export * from "./jobs";
export * from "./language";
export * from "./output";
// Pure (no node imports) — bridge protocol version + warn-never-block compat
// check shared by the CLI and Mosaic Desktop (momo bridge, render feed).
export * from "./bridges/protocol";
// Pure (no node:fs) — safe to re-export here for both CLI and webpack/web.
export * from "./templateId";

// NOTE: template-repos is NOT re-exported here because it uses node:fs/node:path
// which breaks webpack (react-scripts) in the web app.
// Import directly: require("@m0saic/platform/dist/template-repos")

// NOTE: loadMosaicDocument is NOT re-exported here because it uses node:path.
// CLI / Electron-side callers should import it directly:
//   require("@m0saic/platform/dist/mosaic/loadMosaicDocument")

// NOTE: secrets is NOT re-exported here because keychainSecretResolver uses
// node:fs/node:path. CLI / Electron-side callers should import via:
//   require("@m0saic/platform/secrets")  // or "@m0saic/platform/dist/secrets"

// NOTE: host-connections is NOT re-exported here because fileConnectionResolver
// uses node:fs/node:path. CLI / Electron-side callers should import via:
//   require("@m0saic/platform/host-connections")
