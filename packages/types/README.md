# @m0saic/types

The canonical cross-package type definitions for m0saic: the shape of a
mosaic document and its sources, template and template-repo contracts, the
engine context handed to a template's `render`, diagnostics, output formats,
identifiers, colors, themes, dictionary and telemetry records.

Every other m0saic package (`core`, `platform`, `product`, `templates`,
`template-utils`, `dictionary`, the CLI and the desktop app) imports its types
from here so a document means the same thing at every layer.

## Contents

- `dist/` — compiled `.js` + `.d.ts` (entry: `dist/index.js`)
- `schemas/mosaic.schema.json` — the JSON Schema for a mosaic document
- `assets/icons/` — the `mosaic` / `mosaicx` source-kind icons
- `LICENSE`, `NOTICE`

## Distribution

This package is `private` and is not published to npm on its own. It ships
vendored inside the `m0saic` CLI tarball as `node_modules/@m0saic/types`
(the `dist/`, schema, icons, LICENSE and NOTICE listed under `files`).

## License

Apache-2.0 — see `LICENSE` and `NOTICE`. The m0saic rendering engine and
desktop application are proprietary and licensed separately.
