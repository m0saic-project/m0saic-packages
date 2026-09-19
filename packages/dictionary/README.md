# @m0saic/dictionary

The official catalog of reusable m0saic layouts — 30 fixed entries and 10 parameterized generators.

```
npm install @m0saic/dictionary
```

---

## Where this fits

```
              @m0saic/dsl
        the language core (zero deps)
      grammar, parser, validator, types
                    |
      +-------------+-------------+
      |                           |
  @m0saic/dsl-         @m0saic/dsl-stdlib
  file-formats           builders, transforms
  .m0  .m0c              authoring toolkit
      |                           |
      +-------------+-------------+
                    |
            @m0saic/dictionary       <── you are here
         curated entries + generators
```

The dictionary depends on all three packages above. It consumes DSL validation, stdlib builders, and file-format parsing to produce a curated, tested catalog of reusable layouts.

---

## Quick start

```typescript
import { entries, generators, resolveM0saic } from "@m0saic/dictionary";

// Browse all entries
entries.all.forEach(e => console.log(e.id, e.sourceCount));

// Get a specific entry
const hero = entries.byId["layouts/hero-sidebar"];
console.log(hero.m0saic);  // "2(F,2[F,F])"

// Resolve heavy entries (brand logos with large DSL)
const dsl = await resolveM0saic(entries.byId["brand/m0saic-m-256"]);

// Use a generator
const { m0saic, sourceCount } = generators.grid({
  columns: 4, rows: 3, gutter: 0.1
});
```

---

## Entries

30 fixed canonical layouts across 4 categories.

```
  entries/
  ├── splits/          10 entries    simple N-way splits
  │   ├── 2-col                      2(F,F)
  │   ├── 2-row                      2[F,F]
  │   ├── 3-col                      3(F,F,F)
  │   ├── 3-row                      3[F,F,F]
  │   ├── 4-col                      4(F,F,F,F)
  │   ├── 4-row                      4[F,F,F,F]
  │   ├── 2-1-col                    3(0,F,F)         2:1 ratio
  │   ├── 1-2-col                    3(F,0,F)         1:2 ratio
  │   ├── 2-1-row                    3[0,F,F]         2:1 ratio
  │   └── 1-2-row                    3[F,0,F]         1:2 ratio
  │
  ├── grids/           5 entries     uniform rectangular grids
  │   ├── 2x2                        2[2(F,F),2(F,F)]
  │   ├── 2x3                        3[2(F,F),2(F,F),2(F,F)]
  │   ├── 3x2                        2[3(F,F,F),3(F,F,F)]
  │   ├── 3x3                        3[3(F,F,F),3(F,F,F),3(F,F,F)]
  │   └── 4x4                        4[4(...),4(...),4(...),4(...)]
  │
  ├── layouts/         8 entries     editorial / compositional layouts
  │   ├── hero-sidebar                2(F,2[F,F])
  │   ├── hero-bottom-strip           2[F,3(F,F,F)]
  │   ├── hero-top-strip              2[3(F,F,F),F]
  │   ├── sidebar-main                2(2[F,F],F)
  │   ├── l-shape                     2[2(F,F),2(F,-)]
  │   ├── t-shape                     2[3(F,F,F),3(-,F,-)]
  │   ├── three-up                    2[F,2(F,F)]
  │   └── main-two-supporting         3[0,F,2(F,F)]
  │
  └── brand/           7 entries     canonical brand primitives
      ├── m0saic-m-64                 2,242 tiles (64x64 bitmap)
      ├── m0saic-m-256                35,298 tiles (256x256 bitmap)
      ├── m0saic-m-rects              109 tiles (rect decomposition)
      ├── m0saic-pattern              110 tiles (brand pattern)
      ├── m-33                        33 tiles (composed logo)
      ├── m-33_bitmap                 36,426 tiles (bitmap logo)
      └── m0                          26 tiles (M0 mark)
```

### Entry shape

Each entry is a `MosaicDictionaryEntryResolved`:

```
  MosaicDictionaryEntry
  +── id: string                    permanent identifier
  +── m0saic: string                canonical DSL (empty for heavy entries)
  +── sourceCount: number           rendered tile count
  +── title: string                 display name
  +── description: string           human-readable description
  +── category: string              "split" | "grid" | "layout" | "brand"
  +── tags: string[]                searchable tags
  +── m0File?: string               path to .m0 file (heavy entries)
  +── preview?: { mode, src? }      "canvas" (SVG from DSL) or "image" (shipped PNG)
  +── minWidthPx?: number           exact minimum feasible width
  +── minHeightPx?: number          exact minimum feasible height
  +── rankSets?: Record<...>        named rank orderings
  +── maskSets?: Record<...>        named clipping masks
```

### Light vs heavy entries

```
  Light entries (splits, grids, layouts)
  ──────────────────────────────────────
  DSL inlined in browser bundle
  m0saic: "2(F,F)"
  Instant access, no fetch needed

  Heavy entries (brand)
  ─────────────────────
  DSL in .m0 file on disk/server
  m0saic: "" (empty in browser)
  m0File: "entries/brand/m0saic-m-256/m0saic.m0"
  Resolved via: await resolveM0saic(entry)
```

---

## Generators

10 parameterized layout producers. Each has a descriptor (for UI controls) and a build function.

```
  Generator            Description                        Key params
  ─────────            ───────────                        ──────────
  grid                 rectangular grid                   columns, rows, gutter
  aspectFit            fit content to aspect ratio        rootW/H, target ratio
  placeRect            position rect in canvas            rootW/H, rectW/H, align
  aspectSafeGrid       grid with aspect preservation      columns, rows, priority
  magazine             editorial hero + sidebar + strip   heroWeight, sidebarCount
  safeCanvas           canvas with constraints            columns, rows, gutter
  spotlight            hero + supporting tiles            supportCount, arrangement
  comparison           before/after pairs                 pairs, direction
  rankedList           ranked items with decay            count, decay, direction
  bentoGrid            curated irregular grids            base, variant
```

### Using generators

```typescript
import { generators } from "@m0saic/dictionary";

// Call directly
const { m0saic, sourceCount } = generators.grid({
  columns: 3, rows: 2, gutter: 0.05
});

// Enumerate all descriptors (for UI)
generators.descriptors.forEach(d => {
  console.log(d.id, d.title, d.params.length);
});
```

### Generator descriptor shape

```
  GeneratorDescriptor
  +── id: string                    generator identifier
  +── title: string                 display name
  +── description: string           what it produces
  +── category: string              grouping
  +── params: GeneratorParamDescriptor[]
        +── key: string             parameter name
        +── title: string           display label
        +── type: "int" | "float" | "bool" | "enum"
        +── default: number | boolean | string
        +── min?: number
        +── max?: number
        +── step?: number
        +── options?: { value, label }[]     (enum only)
        +── visibleWhen?: Record<string, ...>  conditional visibility
```

---

## Resolution

### `resolveM0saic(entry): Promise<string>`

Resolves the m0saic DSL string for any entry. Light entries return immediately. Heavy entries fetch and parse the `.m0` file.

```typescript
import { resolveM0saic, entries } from "@m0saic/dictionary";

const dsl = await resolveM0saic(entries.byId["brand/m0saic-m-rects"]);
// Returns canonical DSL string (109 tiles)
```

Results are cached (bounded, max 64, FIFO eviction).

### `setDictionaryAssetsBase(base)`

Set the base URL for `.m0` file fetches. Default: `"/dictionary"`.

```typescript
import { setDictionaryAssetsBase } from "@m0saic/dictionary";

setDictionaryAssetsBase("/assets/dictionary");
// Heavy entries will fetch from /assets/dictionary/entries/brand/...
```

---

## Mask sets

Entries with non-rectangular silhouettes (e.g. `brand/m-33`, `brand/m0`) ship a `masks.json` whose entries describe each frame's clip shape (`localPath` + design-space `bounds`). Templates load the set at template-execution time and bake the data inline on each `MosaicSource.mask`:

```typescript
import { registry } from "@m0saic/dictionary";

const masks = registry.getMaskSet("brand/m-33", "default").masks;
sources.forEach((s, i) => {
  const m = masks[i];
  if (m) s.mask = { kind: "inline-mask", localPath: m.localPath, bounds: m.bounds };
});
```

Rasterization happens engine-side in `@m0saic/core` (`rasterizeMaskPng`) — `@m0saic/dictionary` no longer carries `sharp` as a dependency, and there is no `getOrCreateMaskPng` export. The dictionary's job is to ship the silhouette source-of-truth; turning it into pixels is the engine's job.

---

## Browser vs Node

```
  Browser (via bundler)              Node / CLI
  ─────────────────────              ──────────
  Resolves to browser.ts             Resolves to index.ts
  via package.json "browser"         via package.json "main"

  Light DSL inlined                  Light DSL inlined
  Heavy DSL: fetch .m0 from server   Heavy DSL: fs.readFileSync

  Same API shape:                    Same API shape:
    entries.all                        entries.all
    entries.byId                       entries.byId
    generators.*                       generators.*
    resolveM0saic()                    resolveM0saic()
    registry.getMaskSet()              registry.getMaskSet()
```

Consumers always import from `@m0saic/dictionary` — the bundler handles resolution automatically.

---

## Stability contract

Entry IDs and generator schemas are **permanent public contract**.

```
  Action                          Allowed in
  ──────                          ──────────
  Add new entries                 minor / patch
  Add new generators              minor / patch
  Change metadata (title, tags)   minor / patch
  Change entry m0saic string      major only (geometry changes)
  Remove / rename entry IDs       major only
  Change generator param schemas  major only
```

---

## Development

### Add a new entry

```bash
cd packages/dictionary
npx ts-node tools/create-new-entry.ts <group> <slug> <path-to-file.m0>
npm run dictionary:build
```

### Build

```bash
npm run dictionary:build
# validates -> generates artifacts -> generates index -> compiles -> copies assets
```

### Test

```bash
npm test                    # unit + generator tests
npm run test:visual         # golden wireframe PNGs
npm run test:visual:update  # regenerate goldens
```

---

## License

Licensed under the Apache License, Version 2.0.
See `LICENSE` and `NOTICE`.
