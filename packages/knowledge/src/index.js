"use strict";
// The one programmatic surface: where the docs are, for tools that want to
// point an agent at them (`require.resolve("@m0saic/knowledge")` → this file,
// `docsDir` → the Markdown tree). The content is the docs themselves.
const path = require("path");
const docsDir = path.join(__dirname, "..", "docs");
module.exports = { docsDir, readme: path.join(__dirname, "..", "README.md"), thesis: path.join(docsDir, "m0saic-thesis.md"), router: path.join(docsDir, "README.md") };
