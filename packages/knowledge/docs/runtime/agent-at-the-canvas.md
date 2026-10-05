# An agent at the canvas (0.3.1)

> The m0saic MCP server has two flows. **Ecosystem**: you are in a template workspace or any
> terminal, writing templates in code — the rest of this shelf. **In the room**: you were launched
> from Mosaic Desktop's Agent panel and the person has Make open beside you. `desktop_status` tells
> you which (`flow: "in-the-room" | "ecosystem"`). This page is the in-room flow. Both flows get the
> same tools.

## The idea

Make shows a template as **rectangles on a canvas**; every tile that displays a prop is bound to it.
An agent can therefore work on what is on screen the way a person does — not by regenerating pixels
and hoping, but by changing the structured program behind them: a prop through Make's own writer, a
tile through Make's own selection, geometry through Make's own edit mode. Every tool below runs the
handler a click would. None steals the window's focus.

## See first

- `desktop_layout` — the template id and label, the file that backs it (`null` when the person
  browsed to it), every tile with its canvas rect, the prop and leaf it is bound to **and the value
  it shows**, the current prop bag with `changedKeys` (what differs from the defaults), what is
  selected, and the modes to respect: `edit.{mode, grabbed, pending, count}`, `view`,
  `previewMode`, `dims` / `canvasMode`. `detail: "tiles" | "props"` cuts it; `tileId` keeps one
  tile; `prop: "<key>"` returns ONE prop's full value (a chart's rows, a cue track) — the report
  only previews structured values.
- `desktop_snapshot` — a PNG of the canvas as the person sees it, written to disk; read the file.
- `template_props` — the full schema when you need constraints and types.

Never guess the template or its values from files. Ask the canvas.

## "What can I change?"

Answer from the layout: the tiles the person can click, in the labels' words, one line each, with
what each shows now. Settings the canvas cannot show are in the schema (`template_props`) and in
Make's More-settings dock.

## Act, one small step per turn

- `desktop_set_props` — **the** way to change a prop on the open template. `set` whole props or a
  `path` inside one (`[1, "title"]`); `clear` a prop so its default shows; `reset` all. Values are
  validated as the panel validates — a refused item comes back in `rejected`, the rest apply
  (`atomic` for all-or-nothing). It is ONE undoable write: the person sees "Agent changed …" with
  an Undo, and ⌘Z reverts it. **Never reopen the template to change a prop** — that resets their
  session.
- `desktop_select_tile` — "this one": by `tileId`, by `label`, or by the `propKey` it shows;
  `inspect` zooms, `card` opens its editor on the right field.
- `desktop_make_control` — `reveal` (the wand), `camera`, `undo` / `redo`, `set_view`,
  `set_preview_mode` (`dsl` shows the person the m0), `set_canvas`, `open_tile_card`,
  `open_studio`, `dismiss_cover` / `show_cover`, `hover`, `clear_selection`.

When the person is driving, make one change per turn and say what you did.

## When the template has no knob

Say so. Then branch:

1. `desktop_fork_to_document` — the open template, exactly as it resolves now (their props,
   overrides and geometry edits included), as a plain `.mosaic`. You get the path and the m0 string.
   A document is rectangles on a canvas with all of the layout in the m0 — change the geometry there
   (the stdlib builders; `validate_m0` every string).
2. `desktop_open_file` — show the fork in Make (a `note` / `question` lands in its File tab), or
3. `desktop_edit_geometry` — nudge, place or resize a tile as a **pending ghost** the person
   applies (`commit: true` applies it for them). If Geometry Edit was off, the first call turns it on
   and answers `edit-mode-off`: call again.
4. `desktop_read_verdict` with the fork's path — their answer, and when they edited geometry,
   `srcMosaic` + `geometryEdits`. **Edits are intent, never geometry to copy**: read what they meant
   ("moved the attribution up"), then re-encode it into template math in your workspace, build,
   `desktop_reload_sources`, `desktop_open_in_make`. That last leg is the ecosystem flow — the fork
   is where the two meet.

## The refusals, and what they mean

| Refusal | Meaning | Do |
|---|---|---|
| `make-not-active` | Make is not on screen (or not mounted) | tell the person; wait |
| `not-ready` | a template is still resolving | wait a turn |
| `no-template` | nothing is open | offer `desktop_open_in_make` |
| `human-busy` | a grabbed ghost, an open editor, a rect draw — the person is mid-gesture | wait a turn; never fight a gesture |
| `edits-pending` | a prop change would discard their geometry edits | ask, pass `discardEdits: true`, or fork first |
| `invalid` (+ `rejected[]`) | a value or target the panel would refuse | fix the item; the rest applied unless `atomic` |
| `no-preview` / `no-camera` | Geometry (DSL) mode is on | `set_preview_mode: "preview"` |
| `no-tile` | nothing matched | read `desktop_layout` again |
| `edit-mode-off` | Geometry Edit is on now | call `desktop_edit_geometry` again |
| `not-available` | an older Mosaic Desktop | say so; use what works |

## A worked turn (Quote Card)

> **Person:** what can I change here?
> **Agent:** `desktop_layout` → "Quote Card. Five tiles you can click: the quote (now *Everything is
> rectangles on a canvas.*), the attribution, the role line, the opening quote mark and divider
> (accent colour), and the whole card (preset light/dark, background, margin). Avatar slot is
> empty."
> **Person:** make it say "Rectangles all the way down", left-aligned, dark.
> **Agent:** `desktop_set_props {set: [{quote}, {align: "left"}, {preset: "dark"}]}` → "Done — three
> changes, one undo. ⌘Z or the Undo on the toast takes them back."
> **Person:** which one is the attribution?
> **Agent:** `desktop_select_tile {propKey: "attribution", card: true}` → "This one — its card is
> open."
> **Person:** move it up a bit.
> **Agent:** "The template has no knob for that. I'll branch it." `desktop_fork_to_document` →
> `desktop_edit_geometry {tileId, by: {dx: 0, dy: -0.04}}` → "It's a ghost on your canvas — press
> Apply if that is the spot, or drag it where you want. I'll read what you did."

---

The wire detail — every route, each verb's arguments and returns, the refusal vocabulary as main
relays it — is `docs/compat-bridges.md` (0.3.1 routes). The tools' own descriptions carry the one
rule each; this page is the behaviour.
