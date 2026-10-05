# Changelog

## 0.3.1 — 2026-10-05

### The pack's catalog sidecars + per-folder shipped lines in the freeze

The pack follows the 0.3.1 template convention: each template's description lives in `<name>.catalog.json` beside
its code (the freeze hashes code, never the sidecar, so it stays editable after the code freezes).
`tools/gen-template-catalog.mjs` (first build step) gathers the sidecars into `src/template-catalog.json` (imported
by both entries, which declare it before any template registers) and the wire copy `template-catalog.json` beside
`template-manifest.json` (shipped). The freeze manifest gains `shipped` (template folder → the line it shipped at,
carried forward; helper-registered ids keyed by the folder their id names) and `deprecated` (ids deprecated at the
mint — permanent). check-registry reads each template's shipped line from its folder; Stage 0d holds the catalog
(sidecars parse and sit beside their template, the generated file is current, ids / replacements / described props
exist, no template shipped since 0.3.1 describes itself in code, no shipped deprecation comes back); pins hash the
template as its code declares it. The pre-commit hook keeps `shipped`, `deprecated` and each sidecar's shipped
deprecation additive-only. The gate's JSON lists the lagging conventions per template.

**Compatibility.**

No template changed; every pin holds; the 28 templates deprecated in their own code stay deprecated. The shipped
fleet lags `catalogSidecar` until each template's next vN.

### The 0.3.1 generation: 47 new versions, every canvas a handle; deprecated versions ship no preview media

Every shipped template that could gain a Make-canvas handle got a `vN+1` beside its frozen `vN`, held to the
0.3.1 conventions (catalog sidecar, `bindingsDeclared`, `bindingHints`, `canvasFill`, an explicit output format):
47 new versions, the gate's worklist 40 → 0. The old version is deprecated in its sidecar (`replacedBy` the new
id) and stays registered for anyone pinned to it; nothing frozen changed. A media-input template now renders
"the slot before the footage" — a drop target on the canvas, marked incomplete — instead of an error card. The
monorepo's own deprecated versions no longer carry preview media (founder, 2026-09-30: "just delete them… we can
always regen them from their source"); a deprecated card gets drawn placeholder art in the hosts. The one
template held at its shipped line by decision is `@m0saic/brand/community-m/v1` (`src/conventions-held.json`;
the gate counts it apart and fails on a stale entry).

New versions: agents/commit-feed v2, agents/trace-timeline v2; alpine bar-graph v2, commit-feed v3,
contributor-table v2, donut v4, heatmap v3, kpi-card v3, leaderboard v2, line-chart v3, progress-card v2,
stat-card v2, timeline v3, treemap v3; benchmark/report v2; brand/business-card v2, brand/logo v4; charts
bar-graph v3, donut v5, line-chart v2, stat-card v2; code/snippet-morph v2; collage/image-collage v2;
dsl-tutorial v2; github/year-card v2; hero/ffmpeg-pulse/runner v2; media barcode v2, blur-regions v2,
highlights v2, logo-animate v2, metadata-stamp v2, qr/code v2, qr/stamp v2, screencap_grid v3,
screencap_grid_aspect_safe v2, scroll_wall v2, subtitle-burn v2, trickplay v2, video_to_png_sequence v2,
watermark v2; primitives/grid v3; social/quote-card v2; story/narrated-chapters v2, story/scrapbook v2;
theming v2; web/page-skeleton v2; wireframe/base v3.

**Compatibility.**

- Breaking: no. Every 0.3.0 id still registers from its pinned file with its pinned definition (108/108
  registry pins, 78/78 web pins); the 47 are additions. A host that resolved a deprecated id keeps rendering
  it; its catalog now says `deprecated` + `replacedBy`.
- The CLI tarball never carried preview media (`scripts/audit-publish-tarball.mjs` bans `assets/templates/`),
  so the strip changes nothing on npm; the web app's `public/template-assets` and Desktop's seeded copy of
  this package get smaller. A deprecated version has NO preview in any host now — hosts draw a placeholder.
- The `0.3.0` CLI and the web app's shipped id lists still name the previous versions (`web-template-ids.frozen.json`
  is frozen); the 0.3.1 CLI advertises the new ones when its lists are bumped (founder act).

**Release notes.**

- Ships with the 0.3.1 lockstep set; needs `@m0saic/template-utils` / `@m0saic/platform` at 0.3.1 for the
  `choice` binding kind the 15 card-bound versions carry (see `2026-10-01-card-is-a-handle.md`).
- The founder is reviewing the 47 in batches of 5 on the Make canvas; review fixes land as further entries.

### 15 cards bound to `preset`: a full-canvas card is where the theme gets changed

The twelve alpine new versions, both agents new versions and the GitHub year card bind their full-canvas card
surface to `preset` (the `light` / `dark` theme id), so a click on the card in Make offers the pick — the one
knob the user view had no door to. Paint is unchanged (every layout fingerprint holds). Three alpine versions
whose surface already bound `backgroundColor` carry both.

**Compatibility.**

- Breaking: no. Paint unchanged; the binding is a `choice` kind, which a 0.3.0 host (platform `<0.3.1`)
  classifies as unbindable and silently drops — the card is simply unbound there, as before.

**Release notes.**

Needs `@m0saic/platform` and `@m0saic/template-utils` at 0.3.1 (the `choice` kind) in the same cut.

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
