# Changelog

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
