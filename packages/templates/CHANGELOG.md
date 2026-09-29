# Changelog

## 0.3.0 — 2026-09-29

### Easy Blur's tutorial clips ship with the package (W4) — ⚠ edits a FROZEN file

The first-user test opened Easy Blur's "?" tutorial in the PACKAGED Desktop app and it played without
its four recordings. Cause: `TUTORIAL_CLIPS` held `kind:"file"` paths into
`packages/sandbox/production/media-blur-regions-v1/fixtures/screen_recordings/` — the author's laptop.
No package carries that folder, and the installer check (`verify-packaged-assets.mjs`) could not see it:
it compares what the build produced with what shipped, and these files were never in the build.

Now the four mp4s (2.8 MB) live at `assets/templates/@m0saic__media__blur-regions__v1/tutorial/` —
the package-root tree every surface already ships (the web build mirrors `assets/templates/**` to
`/template-assets/`; Desktop unpacks `**/assets/**` from the asar and `rebaseTemplateAssetUrls` turns
the served URL into the file on disk). `tutorialClipAsset()` resolves them the way the Screencap Grid,
Aspect-Safe and Subtitle Burn covers do: Node (`m0saic make --tutorial`, electron main) → `kind:"file"`
from `__dirname` five folders up (asar → unpacked inlined, no node:path); browser → `kind:"url"` at
`/template-assets/<rel>`. Render output is unchanged; only where the clips come from.

## 0.2.0 — 2026-09-19

### First npm publish

`@m0saic/templates` — The built-in template library — brand, hero, demos, media, ui, primitives, forensic packs — with the authoritative registry and the 0.2.0 freeze manifest. Preview media is not part of the npm package.

Published at the same source as the `m0saic` CLI 0.2.0 line (the CLI bundles its own copy). `0.x`: the surface is still being shaped; minor versions may change exports, and every change from here on carries a `pending-releases/templates/` entry.
