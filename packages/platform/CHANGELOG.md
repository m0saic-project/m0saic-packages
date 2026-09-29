# Changelog

## 0.3.0 — 2026-09-29

### ffmpeg toolchain install: prefer Windows' own bsdtar over a GNU tar on PATH

`m0saic setup` on Windows extracts the pinned ffmpeg zip with `System32\tar.exe` (bsdtar)
whenever it exists, instead of whatever `tar` is first on PATH. Under Git Bash and MSYS2 that
PATH tar is GNU tar 1.35, which cannot read the zip and parses the `C:\…` archive path as a
remote host, so the 0.2.0 first run downloaded and verified 209 MB and then failed with
`tar: Cannot connect to C: resolve failed`. PowerShell and cmd were never affected (Windows'
bsdtar is first on their PATH). macOS and Linux are unchanged.

**Compatibility.**

- Breaking: no. Same slot layout, same events, same CLI/desktop wrappers.
- A Windows machine without `System32\tar.exe` (very old builds) behaves exactly as before.

**Release notes.**

Ships with the CLI line that carries it (0.2.1). Until then the workaround is to run
`npx m0saic setup` once from PowerShell or cmd, or to have an ffmpeg with libx264 on PATH.

### inferOutputKind: a single-emit pipeline is always a video

`inferOutputKind(file)` now returns `"video"` for any pipeline document (`steps` present) that does
not declare `emit: "multi"`, before looking at the stamped `outputKind` or at whether the steps
animate. A single-emit pipeline concatenates its steps over time; the engine's planner already
refuses to produce an image for it, so an inference of `"image"` was a promise the render could
never keep. `emit: "multi"` pipelines keep the per-step decision (stamped kind, then animation).

**Compatibility.**

- Breaking: no. Only the inferred kind of a pipeline that could never render as an image changes.
- A `.mosaic` pipeline saved with a stamped `outputKind: "image"` and no `emit: "multi"` now infers
  video, which is what the engine would have produced anyway.

**Release notes.**

Ships with the next lockstep publish (the CLI line that carries it). No user-facing change in the
CLI itself; the desktop and web hosts are the consumers.

### One pinned ffmpeg: the LGPL toolchain rail is removed

m0saic has one pinned ffmpeg build — GPL (libx264/libx265, the full drawtext stack) — fetched from
its origin on the user's machine at the user's request. The LGPL twin is gone from the manifest,
the installer and the slot API. Founder ruling 2026-09-22: m0saic redistributes no ffmpeg, so a
"legally safer" second build bought nothing and lost the standard encoder stack; two builds from one
panel only produced machines that render differently from everyone else's.

### mosaicPackages: one classification of what an artifact is made of

New pure module `packages/mosaicPackages` (no `node:fs`; web-safe), re-exported from the index:

- `describeMosaicPackage(name)` → `{ name, tier, published, npmUrl?, repoUrl? }` for any `@m0saic/*`
  (scoped or bare name).
- `MosaicPackageTier` = `"language" | "substrate" | "product" | "community"`, with
  `MOSAIC_PACKAGE_TIER_ORDER` (display order) and `MOSAIC_PACKAGE_TIER_LABEL` (one label each).
- `sortMosaicPackages(list)` — by tier, then name.

Tiers: **language** = the `m0saic-dsl/m0` packages (`dsl`, `dsl-stdlib`, `dsl-file-formats`,
`dsl-visual-tests`); **substrate** = the lockstep set + vocabulary/data packages published from
`m0saic-project/m0saic-packages`; **community** = `community-templates` and `community-m`, each linking to
its own repo and to NO npm page (the npm copies lag the signed GitHub snapshots by design); **product** =
everything else — the moat (`core`, `cli`, `product`, `types-internal`, `momo`, `sandbox`…), which ships
inside artifacts and publishes nowhere, so it links nowhere rather than to a 404.

**Compatibility.**

- Breaking: no. New exports only; nothing existing changes shape.
- The lists are data. Adding a package to a tier is a patch to this file; a package absent from every
  published list is reported as product/moat, which is the safe default (no link beats a dead link).

**Release notes.**

Ships with the next lockstep publish (the CLI line that carries it). Hosts are the consumers: the CLI's
`versions` and Desktop's Tools → About this build render it.

### collectMotionEvidence counts video FOOTAGE — inference is a last resort

`collectMotionEvidence` (behind `isAnimatedRenderable` / `inferOutputKind`) gains a `videoMedia`
count: a `type: "media"` source whose `mediaType` (or, for producers that only set it, `kind`) is
`"video"` is motion. Footage moves by itself — it needs no overlay expression, no camera and no second
step — and until now it counted for nothing, so "a video plays through a text mask" scored zero
evidence and was classified a still. An IMAGE media source is deliberately not evidence.

The module doc now says what the function is FOR: a last resort for a bare document opened cold with
no template behind it. A template that declares its kind (`outputHints.format`, or
`resolveOutputHints(props)` when the kind depends on its inputs) has already answered, and a host must
prefer that answer.

**Compatibility.**

- Breaking: no. The only documents whose inferred kind changes are those carrying a video media source
  and nothing else the counter already read — which the engine would have produced as video anyway.
- Public shape unchanged (`inferOutputKind`, `isAnimatedRenderable`, `collectMotionEvidence` keep
  their signatures; `MotionEvidence` gains one field).

**Release notes.**

Ships with the next lockstep publish (the CLI line that carries it). Hosts are the consumers.

### `PropBindingRef.hint`: the in-context line rides through binding resolution

`PropBindingRef` (`src/mosaic/propBindings/propBindings.ts`) gains `hint?: string`, passed through
`sourceBindings` verbatim so a host can read it beside `propKey` / `path` / `kind`. Sanitising (trim, a
length cap, non-strings ignored) is the host's job: Make does it in `bindingHint()`.

**Compatibility.**

Additive.

### An empty `layers[]` on a text source is a WARNING, not a render failure (P19)

`validateMosaicSources` raised `TEXT_LAYERS_EMPTY` at severity **error** for a text source whose
`layers[]` was empty, and the whole render died: "Source[7] (text) must have non-empty layers[]." The
binding contract asks a template to bind a rect even when its prop is empty, so the rect is a handle
to ADD — an optional subtitle left blank therefore killed a fifty-rail ledger (prague-hiphop finding
P19). Now:

- `layers` missing or not an array: still an **error** (a construction bug).
- `layers: []`: a **warning** — "has no layers — it draws nothing (an empty handle for a bound prop)".

The engine side (`@m0saic/core`, `buildTextRenderCommand`): a BOUND text source with no layers and no
explicit background paints a transparent input instead of the default fill, so the blank handle stamps
nothing where its text would go. An UNBOUND layer-less source keeps the default fill — "background-only"
text tiles are a supported way to paint a rect and their regression suite still passes.

Tests: validator cases updated (empty array → warning; aggregate count unchanged), engine case added
(bound → `black@0`, explicit background wins, unbound keeps the fill).

### Lifecycle stamps the host's launch context on install_completed

`checkAndEnqueueLifecycle` and `runUpstreamMaintenance` accept an optional `install: MosaicInstallContext`
and stamp it on `install_completed` ONLY (never on `update_completed`). New export
`sanitizeInstallContext(ctx)`: keeps `surface` / `invocation` only when they are the closed-enum values,
and `source` only when it is a bounded lower-case slug (trimmed + lower-cased first) — so a typo in
`--from` can never 422 the install event.

**Compatibility.**

- Breaking: no. The option is optional; callers that omit it get the previous behaviour byte for byte.

**Release notes.**

Ships with the next lockstep publish. The CLI and Desktop are the callers.

## 0.2.0 — 2026-09-19

### First npm publish

`@m0saic/platform` — The bridge between the private engine and public callers: asset resolvers, document loaders/validators, template-repo loading, the share-link wire format, ffmpeg expression helpers, and the telemetry client (deliberately public).

Published at the same source as the `m0saic` CLI 0.2.0 line (the CLI bundles its own copy). `0.x`: the surface is still being shaped; minor versions may change exports, and every change from here on carries a `pending-releases/platform/` entry.
