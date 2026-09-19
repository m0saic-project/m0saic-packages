export { buildOverlayStack } from "./build-overlay-stack";

// NOTE: loadSession + readLayoutFile + assetPath (and their types /
// parseLayoutContent) are NOT re-exported here because they touch node:fs /
// node:path, which breaks webpack (react-scripts) in the web app. Their only
// consumers are node-only, web-excluded templates. Import directly from the
// dist deep paths:
//   require("@m0saic/template-utils/dist/m0saic/loadSession")
//   require("@m0saic/template-utils/dist/m0saic/readLayoutFile")
//   require("@m0saic/template-utils/dist/m0saic/assetPath")