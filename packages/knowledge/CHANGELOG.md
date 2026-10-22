# Changelog

## 0.4.0 — 2026-10-22

### Docs: how a template takes a data file (a `media` prop it reads)

- `templates/ui-controls.md`, new section "Data files: a `media` prop the template reads": a CSV,
  spreadsheet, line-delimited JSON, parquet or SQLite export reaches a template as a `media` prop
  whose `meta.control.extensions` names the formats (the picker's default filter offers only video,
  image and audio); `render` reads and parses the file; the template declares `fs.read`; the
  formats the engine never sends to ffprobe, listed; CLI and Desktop only; the file's contents are
  an input; small data belongs in a `json` / `number[]` / `string[]` prop instead.

Regenerated with `npm run knowledge:sync`; only this file's content differs.

**Compatibility.**

Docs only.

### Docs: installed template repos (`community fetch`, `install`, `uninstall`); `--community-repo` removed

- `runtime/cli-usage.md`: three new command rows (`community fetch`, `install [source]`,
  `uninstall <repoId>`); `hello-world` and `list-templates` rows and the `make` repo flags drop
  `--community-repo`; the gate section becomes "External template repos and the community gate
  (2026-09-16; installs 2026-10-13)": three reserved namespaces, where installed repos live and how
  a bundle is checked and unpacked, how they load (no flag, once per process, after `--template-repo`
  folders, quietly, a broken one skipped), the grant now checked at install and on every load (a copy
  that fails is skipped and never imported), the signed tree including `template-catalog.json`,
  bundle upload after a mint, the DEV seam for installs and for the in-repo community package as a
  `--template-repo`, and the current notice lines and test locks.
- `runtime/cli-usage.md`: the `list-templates` row: output grouped by source (built-in, installed
  repos, `--template-repo` folders), `--source <name>` lists one, `--json` stays a flat id array.
- `runtime/cli-usage.md`: `install` asks first (third-party: notice + question after bundle.json, before the
  runtime downloads; `--yes` for CI, required with no terminal), `declined`; given the community repo it runs
  `community fetch` (one way in).
- `runtime/cli-usage.md`: three tiers (second-party = signed by m0saic: no question; a false signed claim is
  refused) and private repos with an access key (`--key-env` / `M0SAIC_REPO_KEY` / saved, asked for once in a
  terminal; the key goes to api.github.com only; `uninstall` deletes it).

Regenerated with `npm run knowledge:sync`; only this file's content differs.

### Docs: print authoring rules (a dark pattern must clear paper's black floor)

- New `templates/patterns/print-authoring.md`, rules P1–P5 for a template whose deliverable goes to paper:
  - P1: a dark pattern must clear paper's black floor (soft-proofed: a near-black navy prints at L* 11 coated, 29
    uncoated). Put it at L* 28 or more, at least 25 over the ground. Lift the lightness, keep the hue and raise
    the chroma, then raise it again for paper (print took a sixth to a third of it).
  - P2: a light pattern needs only about 9 L* under the page.
  - P3: lifting a dark pattern lowers text contrast, so hold secondary inks at 4:1 or better against it.
  - P4: lock print contrast in a test.
  - P5: soft-proof through the press profiles (littleCMS, Adobe's FOGRA39 / FOGRA29), then proof a ladder on the
    stock you are ordering.
- Indexed in `templates/README.md` (patterns) and in the root README's "Doing X → read Y" table.

Regenerated with `npm run knowledge:sync`; only these files' content differs.

**Compatibility.**

Docs only.

### Docs: a template repo's brand schema (`m0saic.brand.json`) and the `.m0v` brand slot

- New `templates/reference/brand-schema.md`: what `m0saic.brand.json` is (the fields a person fills in
  once and the template props that take them), what Mosaic Desktop does with it (reads it with the
  repo, seeds mapped props into a template's defaults on a fresh open, asks only what some prop takes,
  merges several repos, the app's own field keys), and the authoring rules (one per repo root, consistent
  prop names, a signed release re-minted after the file changes, the CLI reads none of it).
- `file-formats/m0p-and-custom-field.md` §1: the `.m0v` row gains the `brand` slot.
- `templates/README.md`: the reference index lists the new doc.

**Compatibility.**

Docs only.

**Release notes.**

Ships with the next lockstep set.

### Docs: a cover can be a start page (answer tiles, `editor.start`, own-size covers)

- `templates/reference/prop-bindings.md`: `value` in the wire shape (and `choice`, which the rules already
  described); a new section "`value` — a rect that IS one answer": what a click writes, what `bindingValue`
  keeps, answer tiles, booleans bind only as answers, draw an option in pieces with the same bindings.
- `templates/render-lifecycle.md`: a cover may return its own size; the first-edit dismissal has one exception
  (an answer on a cover); a new section "The start page": answers keep the cover and redraw it, `editor.start`
  closes it, a cover that asks ignores stray clicks, agents skip it by supplying props.
- `templates/reference/prop-bindings.md`: "Grips": several tiles may bind one rect leaf; the first paints it
  and seeds every session on it, later ones are grips (a handle on top of a box its own content covers).

**Compatibility.**

Docs only.

**Release notes.**

Ships with the next lockstep set.

### Docs: `m0saic.brand.json` is outside the signature and rides in `runtime.tgz`

- `templates/reference/brand-schema.md`: the "part of the repo tree" bullet no longer says a signed release must be
  re-minted after the file changes — the signature covers `dist/` and the three signed root files only. It now says
  the file rides in `runtime.tgz` when present (packer `BRAND_FILE`, 2026-10-20), so the step after a change is a
  re-pack and re-publish of the bundle; a clone or the dev stand-in reads it from disk.

### Docs: print authoring rule P6 — print scale, the walls past 8K

- `templates/patterns/print-authoring.md`, new **P6 — Print scale**: ffmpeg's frame limit and how to refuse with the
  max DPI; what a 259 MP banner costs to render; that a `.jpg` still (and a `jpeg` / `png` / `tiff` / `bmp` encode)
  is encoded at best quality by the engine since 0.4.0 (`yuvj444p`, q 1, one encoder thread, `-huffman default` from
  64 MP) so hand-set `mjpeg` options are no longer needed; that the engine writes no DPI / ICC and how to add them
  without re-encoding; drawtext for proof labels; inches authoritative, never upscale a proof, verify the file.
- The doc's header now says P6 was paid for by the booth banner.

### Docs: a template repo's samples (`repo.assets.samplesDir` → `samples.tgz` → Mosaic Desktop's Files dock)

- `runtime/cli-usage.md`, "Installed template repos": a new **Samples (2026-10-20)** paragraph — the manifest field,
  the third archive `samples.tgz` the packer writes (`bundle.json.samples`, `--no-samples`, the cap and the refusals),
  what Mosaic Desktop does with it (installs it beside the previews, shows the folder as the Files dock's "Samples"),
  and that the CLI never fetches it. The install paragraph now says previews *and samples* are never downloaded.

### Docs: the thread guard caps video decoders in a dense command (flag 3)

- `runtime/ffmpeg-expression-limits.md`, the swscale paragraph: since 0.4.0 the engine's thread guard also caps every
  video decoder past six threaded video inputs (`-threads K`, K = 32 / inputs, between 1 and 4), why (each mp4
  decoder's frame-thread pool + frames in flight; 22 inputs panicked an 8 GB machine), what is not counted (stills,
  lavfi, the engine's qtrle intermediates), and the measurement on the panic case (16 videos, 5 s at 1080p: 29 s,
  1.3 GB peak, no swap).

## 0.3.1 — 2026-10-05

### The 0.3.1 template convention — a template's description lives in its catalog sidecar

Two reference docs teach the 0.3.1 template convention: a template's CODE declares what it IS; what DESCRIBES it —
label, description, tags, platforms, channels, preview, internal, primitive, deprecated, and each prop's label /
hint / placeholder / order — lives in its catalog sidecar, `<name>.catalog.json` beside the module.

- `templates/reference/template-flags.md`: `internal` / `primitive` / `deprecated` are catalog fields, declared in
  the sidecar and applied catalog-first; deprecating means an entry in the OLD version's sidecar (permanent once
  shipped), never an edit to its frozen code.
- `templates/reference/prop-bindings.md` ("The in-context line"): a bound prop's hint comes from the sidecar's
  `props.<key>.description` (or a per-rect binding `hint`); `propsSchema.<key>.description` in code is the pre-0.3.1
  form.

- `runtime/cli-usage.md` (`m0saic doctor`): the repo's conventions target — `repo.conventions` — holds each template
  to the lower of its shipped line and the target; newer rules are lag, never errors, so a new m0saic release never
  turns a repo's build red.

Regenerated with `npm run knowledge:sync`; `npm run test:knowledge` green (10/10, zero leaks).

### Docs: the `choice` binding kind; `canvasFill` no longer exempts a rounded card (from 0.3.1)

- `templates/reference/prop-bindings.md`: a closed set binds as kind `choice` (how Make shows it, basic props
  only, `seedDraft` dropped, the card-bound-to-`preset` case); the kinds table splits the old "closed set —
  NEVER" row into `choice` (never DEMANDED, bind it when a rect IS the mode) and the connection-driven /
  number closed sets (never).
- `templates/standalone-pack-authoring.md`: the `canvasFill` paragraph — a rounded or stroked card is not exempt
  from 0.3.1 on, a rect that carries a handle is, a repo held to 0.3.0 keeps the exemption it shipped under;
  the bindings paragraph names the `choice` glyph and the case.

Regenerated with `npm run knowledge:sync` (52 files; only these two differ).

**Compatibility.**

Docs only.

### Docs: the `outputFormat` knob's precedence lives in `resolveTemplateOutputHints`

`templates/output-resolution-tree.md` (L2, the template tier): since 0.3.1 the order — static hint < the
reserved `outputFormat` knob < a `format` the template's own `resolveOutputHints` returns — is applied in
`resolveTemplateOutputHints`, so every host gets it; a knob that moves the container yields the bare
`{ kind, container }`.

**Compatibility.**

Docs only.

### An agent at the canvas — the live-canvas flow, and the CLI's agent surface at 21 tools

The runtime shelf gained the in-room flow of the m0saic MCP server:
an agent beside a person who has Make open — see the canvas with values, change props through Make's
own undoable writer, point at tiles, branch a template into a plain `.mosaic` when it has no knob.
Regenerated with `npm run knowledge:sync`; `npm run test:knowledge` green.

### Docs: an optional colour prop clears back to the template's colour by default

- `templates/reference/prop-bindings.md`, the `onClear` section: an absent `onClear` on an OPTIONAL colour
  prop (a basic prop or a group field — not a leaf inside a row or list) now unsets it, back to the template's
  own colour (platform `defaultOnClear`); a required colour and other numbers still refuse an empty commit;
  `"none"` is a colour (transparent), never a clear.

Regenerated with `npm run knowledge:sync`; only this file's content differs.

**Compatibility.**

Docs only.

## 0.3.0 — 2026-09-29

### The binding contract, the roll call, and the CLI's agent surface

Three docs a template author or an agent reads gained the 0.3.0 rules. Regenerated with
`npm run knowledge:sync` (52 files); `npm run test:knowledge` green, so nothing leaks.
