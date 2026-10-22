# A template repo's brand schema (`m0saic.brand.json`)

**Since:** Mosaic Desktop 0.4.0 line (2026-10-19). **Applies to:** any template repo a solution or a
Mosaic Consumer install connects. The CLI ignores the file.

## What it is

A person using Mosaic for Jewelry, or a Mosaic Consumer install built around one business, fills in
their details **once** — "Your brand" on the Templates page: a name, a logo, colours, a website, where
they post most — and every design that has a place for those opens with them already in. The profile is
kept per solution on the machine as `~/m0saic/solutions/<id>/brand.m0v`, the `brand` slot of a Mosaic
Vocabulary (`.m0v`; see `file-formats/m0p-and-custom-field.md` §1).

A template repo says **what to ask for** and **which props take it** by shipping `m0saic.brand.json`
at its root, beside `m0saic.workspace.json`:

```json
{
  "fields": [
    { "key": "lyricFont", "label": "Your font", "placeholder": "The one your lyrics land in", "kind": "choice",
      "options": [{ "value": "anton", "label": "Anton" }, { "value": "bebas-neue", "label": "Bebas Neue" }] },
    { "key": "textColor", "label": "Lyric colour", "placeholder": "#FFFFFF", "kind": "color" },
    { "key": "fontFile", "label": "Your own font file", "placeholder": "A .ttf or .otf", "kind": "file" },
    { "key": "channel", "label": "Where you post most", "kind": "choice",
      "options": [{ "value": "instagram-reel", "label": "Instagram Reels" }, { "value": "tiktok", "label": "TikTok" }] }
  ],
  "props": { "font": "lyricFont", "textColor": "textColor", "fontFile": "fontFile", "platform": "channel" }
}
```

- `fields[]` — what the profile asks for. `key` (a prop-style identifier), `label`, optional
  `placeholder`, and `kind`: `text` | `color` | `file` | `choice`. A `choice` needs `options`
  (`{ value, label }`; a bare string is a value that is its own label). A value outside the options is
  never seeded.
- `props` — template prop name → field key. **Top-level props only.** The field must be one of
  `fields[]` (or one of the app's own, below).

## What Desktop does with it

- Reads the file when the repo loads (a local folder, or a GitHub source once installed), beside the
  manifest; drops it when the source is forgotten.
- **Seeds on a fresh open.** When a template opens with no props of its own (not from a `.mosaicx`, a
  share link or an agent), every mapped prop the template declares gets the profile's value, folded into
  the template's **defaults** — so the open is not dirty, a rebuild keeps the values, and a saved recipe
  carries them like any value. The person can still change any of them per post. A `media` prop takes
  the file path; a `media[]` prop takes a one-item list.
- **Asks only what some prop takes.** The profile shows the fields that some mapped prop reads; a field
  nothing reads would promise what no design does.
- **Merges across repos.** A solution may have a map of its own (the jewelry pack's prop names are declared
  in the app) and several connected repos; the solution's map comes first, then each repo's, and a prop
  is never re-mapped once mapped.
- **The app's own fields win for their keys:** `name`, `tagline`, `logo`, `accent`, `site`, `email`,
  `phone`, `address`, `platform` (the app's channel list: story / feed / square / landscape / email). A
  repo mapping `brand → name` gets the app's "Brand name" field. A repo whose `platform` prop takes
  **its own** values should map it to a key of its own (`channel`), not `platform`.

## Authoring rules

- One schema per repo, at the root. Keep the prop names consistent across the repo's templates — the
  schema is the API the templates adhere to; a template that spells `brandName` differently is simply
  not seeded.
- Keys are identifiers (`^[a-zA-Z][a-zA-Z0-9]*$`); at most 24 fields. Odd fields and unmapped props are
  dropped, not fatal.
- The file is outside the signature (`dist/` + the manifest, package and catalog): adding or changing it never
  moves a release's verdict. It rides in `runtime.tgz` when present (packer `BRAND_FILE`, 2026-10-20), so a repo
  installed from a release has it too — **re-pack and re-publish the bundle** after changing it; a clone or the
  dev stand-in reads it straight from disk.
- The CLI reads none of this; a `.mosaicx` written by Make carries the seeded values as plain props.

## See also

- `templates/reference/prop-bindings.md` — how props reach tiles on the canvas.
- `file-formats/m0p-and-custom-field.md` §1 — `.m0v`, the Mosaic Vocabulary, and its `brand` slot.
