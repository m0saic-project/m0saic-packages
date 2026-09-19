# @m0saic/text

Node-only text → SVG glyph-path engine. Lays a string out inside a canvas and
returns SVG path `d` glyph **outlines** (via [opentype.js]) using bundled,
deterministic fonts — so the result does not depend on the host's installed
fonts and renders identically across macOS / Windows / Linux CI. Roboto
(Apache-2.0) remains the default prose font; JetBrains Mono (OFL-1.1) provides
the strict character grid used by code renderers.

The emitted `d` has two uses, one mechanism:

1. **FILL** — `<path d="…" fill="…"/>` to draw the text.
2. **MASK** — hand `d` to a source's `inline-mask.localPath` (with `bounds`
   equal to the canvas you passed) so a single flat color source shows through
   only as the glyph shapes. That turns "one drawtext ffmpeg spawn per label"
   into "one masked color source per cell", composited in a single filtergraph
   pass.

This package is the shared home for that capability: the renderer core
(`@m0saic/core`) uses it for the `svg` text rasterizer, and `@m0saic/template-utils`
re-exports it for template authors.

## API

- `textToPath(text, options, canvas): string` — glyph outlines as an SVG path `d`.
- `measureText(text, options): TextMetrics` — measure extent without rendering.
- `measureMonoGrid(options): MonoGridMetrics` — fixed-width char/line metrics plus
  an actual-advance `monospace` check.
- `runsToPaths(lines, options): RunsToPathsResult` — positioned code runs merged
  into one deterministic SVG path per opaque `colorKey`, with ligatures and
  kerning disabled by per-cell glyph placement.
- `bundledFontPath(): string` — absolute path to the bundled default font.

[opentype.js]: https://github.com/opentypejs/opentype.js
