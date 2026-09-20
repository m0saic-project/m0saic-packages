# Prop bindings — the rect that SHOWS a prop is its handle in Make

A template marks the source that DISPLAYS a prop with `source.editor.binding`
(or `bindings`, several leaves on one rect). Make resolves them per render and
turns the rect into the prop's canvas handle: double-click / a badge to edit,
a file dropped on it to fill a media slot. Bindings are re-resolved on every
render and keyed by the PROP — never by a stableKey, which changes whenever the
geometry does.

One predicate decides what is bindable: `classifyBindableProp` in
`@m0saic/platform` (`mosaic/propBindings`). Template tests
(`resolvePropBindings` in `@m0saic/template-utils`) and the Make page both use
it, so a template can never offer an edit the page refuses, or vice versa.
`bindProps` / `bindPropPath` THROW at author time for what the platform would
silently drop — a template test should never reach the silent path.

## The wire shape

```ts
binding: {
  propKey: string;                 // dotted path as propsSchema nests it: "label", "titles.title"
  index?: number;                  // ONE element of string[] / number[] / media[]
  path?: Array<string | number>;   // route into a json / list / array value: [2, "title"]
  kind?: "string" | "number" | "color" | "rect" | "media";  // required on structured leaves
  layer?: number;                  // which text layer shows the leaf (multi-layer text)
  onClear?: "remove-element" | "unset-leaf";
  seedDraft?: string;
  companion?: boolean;
  range?: { start: number; end: number };   // one line of a multi-line string leaf
  focus?: { start: number; end: number };   // the token the rect shows, inside range
}
```

Rules:

- `propKey` is exactly as `propsSchema` nests it; every segment past the
  first walks a `type: "group"` prop's `fields`.
- Basic lists (`string[]`, `number[]`, `media[]`) bind ONE element — a
  non-negative integer `index`. The list itself is never bindable.
- Structured props (`json` / `list` / `array`) bind a LEAF: `path` from the
  prop's value plus an explicit `kind` (the schema has no per-leaf type, and an
  empty leaf must still be an "add" handle). `index` is shorthand for a leading
  numeric segment.
- `meta.ui.hidden` props, booleans, enum / connection-option strings (closed
  pickers) and whole lists are never bindable. A stray `index` on a scalar is
  ignored.
- Bind even when the value is empty — the rect is then a handle to ADD.

## Kinds

| prop / leaf | binding | kind | Make handle |
|---|---|---|---|
| free-text `string` (or one `string[]` element, or a structured leaf) | `bindProp(src, key[, i])` / `bindPropPath(src, key, path, "string")` | `"string"` | T — the inline text form |
| colour-valued string (`isColor` / `colorPicker`) | same | `"color"` | swatch — a picker |
| `number` (or one `number[]` element, or a leaf) | same, `"number"` | `"number"` | 123 — the inline form |
| `json` with `picker: "regions"`, `regions.max: 1` | `bindPropRect(src, key)` — no path | `"rect"` | move glyph — the regions draw session on the cell |
| `media`, one `media[]` element, or a leaf holding a path | `bindProp(src, key[, i])` / `bindPropPath(…, "media")` | `"media"` | picture glyph — a DROP target + the media chip |

Order the entries the way a double-click should read them: `fields[0]` is the
primary action (a plain double-click); the badge row offers every kind.

## Authoring helpers (`@m0saic/template-utils`)

- `bindProp(src, propKey, index?)` — the basic case.
- `bindProps(src, entries)` — several leaves on one rect (a multi-layer text,
  a cell that moves AND edits AND takes a drop). Writes `editor.bindings`,
  which wins over the single `binding`.
- `bindPropPath(src, propKey, path, kind, { onClear?, seedDraft? })` — one
  structured leaf.
- `bindPropRect(src, propKey)` — a one-region regions picker edited in place.
- `bindPropRange(src, propKey, index, range, focus?)` — one line of a
  multi-line string prop (a code state, a lyric block); offsets index the RAW
  prop string.
- `stripPropBindings(doc)` — a host composing ANOTHER template's render drops
  its bindings (they name the inner template's props).
- `tag(src, label)` composes either way round with all of them.

## `onClear` — what an EMPTY commit means

```ts
{ propKey: "days", path: [rowIndex, "day"], kind: "number", onClear: "remove-element" }
```

- `"remove-element"` — splice the element at the leading numeric path segment
  (the whole row, or one element of a basic list) out of its array. Needs an
  `index` or a numeric first `path` segment.
- `"unset-leaf"` — delete the leaf key from its object, or unset a basic prop
  so its default shows again. Not for array-element leaves (no key).
- Absent — numbers and colours refuse an empty commit; strings write `""`;
  a scalar media clears to `""`; a `media[]` element refuses (a hole in a media
  list is not a value the engine can open).

Editor rules: "empty" is blank for numbers / colours, `""` for text. An empty
commit against an already-empty leaf writes nothing. In a multi-field session a
row removal supersedes its siblings' writes; rows go highest index first. The
panel stays the primary place rows are deleted — canvas clear is an accelerator.

## `seedDraft` — prefill an EMPTY leaf from the rect's context

```ts
{ propKey: "days", path: [len, "day"], kind: "number", onClear: "remove-element", seedDraft: String(info.day) }
```

- Applies only when the bound leaf reads EMPTY / absent; a leaf with a value
  ignores it. A DRAFT: shown pre-selected (Enter alone accepts it), written on
  commit like typed text, never applied by itself. Deleting it and committing
  empty still runs `onClear`.
- Blur commits too, so an untouched seeded form that loses focus WRITES the
  seed — mind this when seeding.
- Wire shape is a string; a blank seed, or a non-numeric seed on a number
  leaf, throws at author time; `rect` and `media` leaves take no seed.
- Focus lands on the FIRST field: order a seeded field first when the seed is
  the whole suggestion.

## `kind: "media"` — a rect that takes a dropped file

A media-bound rect is a DROP target on the Make canvas (a file dragged onto it
writes the path) with a picture-glyph handle that opens the media chip —
`Choose file…` / `Replace…` · `Remove` (when clearable) · "or drop a file on
the cell". A file in flight lights every media slot; a slot whose prop refuses
the kind lights muted.

- What may land is the PROP's say: `meta.control.accept` (`["image","video"]`)
  and `meta.control.extensions`. Judged by MIME while in flight, by extension
  at drop.
- `media[]`: index `< length` replaces, `=== length` appends (an add handle),
  `> length` is refused. A media list is never padded with `""`.
- A tile pairs handles freely — the drop-calendar's facecam is
  `bindProps(src, [{ propKey: "facecamRegion", kind: "rect" }, { propKey: "facecam" }])`:
  move it, or drop on it. Put the MEDIA entry first when a double-click should
  mean "replace the picture".

### A drop commits the tile's seeded companions

When a file lands, every EMPTY sibling leaf on the tile that carries a
`seedDraft` is written with its seed — the rect's meaning travels with the
gesture (the clicked date; the slot number). Leaves with a value, or empty
leaves without a seed, are untouched.

`companion: true` marks a seeded leaf ONLY the drop fills:

```ts
{ propKey: "days", path: [row, "teaser"], kind: "number", seedDraft: String(teasers.length + 1), companion: true }
```

It never shows in the text form (a blur-commit there would write the seed on
an unrelated edit) and never earns a badge. Needs a kept `seedDraft`; refused
on media / rect leaves. The drop-calendar date cell, in full — one drop births
a pictured row:

```ts
bindProps(cell, [
  { propKey: "days", path: [n, "day"],   kind: "number", onClear: "remove-element", seedDraft: String(day) },
  { propKey: "days", path: [n, "title"], kind: "string" },
  { propKey: "teasers", index: teasers.length, kind: "media" },
  { propKey: "days", path: [n, "teaser"], kind: "number", seedDraft: String(teasers.length + 1), companion: true },
])
```

## Starter media — the slot before the footage

A template that wants the slot present (and droppable) before the user has a
file renders a stand-in while the prop is empty. Two sources:

1. **Bring your own** — media bundled next to the template
   (`assets/*.png|mp4|svg`, mirrored by copy-assets), built with
   `fileAsset(resolve(__dirname, "assets"), name, kind)` from
   `@m0saic/template-utils/dist/m0saic/assetPath` (asar-safe).
2. **Included defaults** — `starterMedia(role)` from
   `@m0saic/template-utils/dist/media/defaultMedia` (node-only deep import):
   roles `portrait` `landscape` `square` `facecam` `avatar` `logo`, one small
   viewBox-only SVG each (`assets/starter/`, minted by
   `tools/mint-starter-svg.mjs`). Returns `null` when the file is not on disk —
   degrade to the template's own stand-in, never an error mosaic.

An `.svg` file asset is rasterized to a PNG at plan time by the engine, and
Make's preview still-extractor rasterizes it the same way before ffmpeg sees
it — ffmpeg itself has no svg decoder, so never hand an svg path to it directly.
A still stand-in in a video slot keeps a no-footage render a poster (PNG);
motion arrives with the real clip.

Make marks an EXISTING slot with no path (a starter showing) with a persistent
dashed outline and an "Add …" glyph. An add handle (`teasers[len]`, an unborn
row) is not a slot and stays quiet — otherwise every empty date cell would light.

## What Make does with them (the host side, for orientation)

- Badge row on hover: one glyph per kind (T · 123 · swatch · move · picture),
  collapsing to one dot on a tile under ~60 on-screen px. A click on a glyph is
  a double-click WITH that intent.
- Text / number / colour → the inline form over the rect (Enter / blur commit,
  Esc cancels, an unchanged draft writes nothing). Rect → the regions draw
  session seeded from the painted cell. Media → the chip; a drop needs no click.
- Every write goes through the ONE prop writer, so it survives every other
  edit and re-renders the template; the panel field updates because it IS the
  prop.
- The double-clicked tile is often chrome stacked over the bound rect (gridlines,
  glass) — Make looks THROUGH the stack under the pointer for the topmost bound
  tile, for clicks and drops alike.

First implementers: `@m0saic-dev/creator/drop-calendar/v1` (every kind, the
companion, the facecam slot); `@m0saic/alpine/*` (text / number / colour);
`@m0saic-dev/music/lyric-video/v1` (ranges).
