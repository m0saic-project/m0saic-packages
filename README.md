# m0saic packages

The public packages of the **m0saic** system — everything above the [m0 layout DSL](https://github.com/m0saic-dsl/m0) that is open source: the shared types, the platform layer, the template toolkit, the dictionary of named layouts, and the built-in template library.

The system's entry points are the `m0saic` CLI (`npm i -g m0saic`), which renders m0 layouts to video and image sequences, and Mosaic Desktop / [app.m0saic.io](https://app.m0saic.io). Both are built on the packages in this repository.

---

## What is here

Each package sits in `packages/<name>` and publishes to npm as `@m0saic/<name>`.

| Package | License | What it is |
|---|---|---|
| [`momo-types`](./packages/momo-types) | Apache-2.0 | The vocabulary contract for the m0saic AI-human work-session protocol: types plus a few pure helpers, so file-format and tooling packages can share the shape cheaply. |
| [`types`](./packages/types) | Apache-2.0 | Canonical TypeScript type definitions shared across every package — the `.mosaic` document shape, sources, effects, template props. The lowest-level public surface. |
| [`platform`](./packages/platform) | Apache-2.0 | The layer between the renderer and public callers: asset resolvers, document loaders and validators, template-repo loading, the share-link wire format, toolchain (ffmpeg) discovery, telemetry client. |
| [`text`](./packages/text) | Apache-2.0 | Node-only text → SVG glyph-path engine (opentype.js) with a bundled deterministic font. Shared by the renderer and `template-utils`. |
| [`template-utils`](./packages/template-utils) | Apache-2.0 | Template runtime helpers — `definePropsSchema`, `defineMosaicTemplate`, seeded RNG, ffmpeg expression builders, primitives, the `forensic` namespace. Anything a template author uses that is not producing m0. |
| [`dictionary`](./packages/dictionary) | MIT | Named layout entries (the brand M, patterns, QR codes, masks, generators) — the canonical shape library. |
| [`dsl-react`](./packages/dsl-react) | Apache-2.0 | Render m0 DSL layouts as positioned React regions — the Layout → React bridge. |
| [`templates-advanced`](./packages/templates-advanced) | MIT | Catch-all for anything `templates` needs that would otherwise add an external dependency to the core template package. |
| [`templates`](./packages/templates) | MIT | The built-in template library — brand, hero, demos, media, ui, primitives, forensic — with its generated `template-manifest.json`. |

### Elsewhere

Three public pieces of m0saic live in their own repositories, not here:

- **`@m0saic/community-m`** — the Community M, the 33-tile brand mark as data (one tile per contributor). It publishes to npm from [m0saic-project/community-m](https://github.com/m0saic-project/community-m); `@m0saic/templates` depends on it from the registry, exactly like the dsl substrate.
- **Community templates** — [m0saic-project/m0saic-community-templates](https://github.com/m0saic-project/m0saic-community-templates), released as signed git snapshots.
- **The sandbox corpus** — the `.m0` / `.m0c` / `.mosaic` / `.mosaicx` iteration sessions, at [m0saic-project/m0saic-sandbox](https://github.com/m0saic-project/m0saic-sandbox).

---

## Install

```bash
# types + platform: read, validate and write .mosaic documents
npm i @m0saic/types @m0saic/platform

# author templates
npm i @m0saic/template-utils @m0saic/types @m0saic/platform

# the built-in template library (pulls dictionary, templates-advanced, template-utils)
npm i @m0saic/templates

# named layouts on their own
npm i @m0saic/dictionary

# m0 layouts as React regions
npm i @m0saic/dsl-react react

# text → SVG glyph paths
npm i @m0saic/text

# the AI work-session vocabulary
npm i @m0saic/momo-types

# the Community M seed data — published from m0saic-project/community-m, consumed here via @m0saic/templates
npm i @m0saic/community-m
```

Every package depends on the `@m0saic/dsl*` substrate — `@m0saic/dsl`, `@m0saic/dsl-stdlib`, `@m0saic/dsl-file-formats` (and `@m0saic/dsl-visual-tests` for tests). Those come from npm and are developed in the [m0saic-dsl/m0](https://github.com/m0saic-dsl/m0) repository; they are **not** workspaces here. Install them explicitly when you import them directly:

```bash
npm i @m0saic/dsl @m0saic/dsl-stdlib @m0saic/dsl-file-formats
```

Render from the command line:

```bash
npm i -g m0saic
m0saic make my-layout.mosaic
```

---

## Working in this repo

```bash
npm install        # links the workspaces, fetches @m0saic/dsl* from npm
npm run build      # every package, in dependency order
npm test
```

The build order is the dependency order: `momo-types → types → platform → text → template-utils → dictionary → dsl-react → templates-advanced → templates`. `npm install` pulls `@m0saic/dsl*` and `@m0saic/community-m` from npm — neither is a workspace here.

---

## Licensing

Two licenses, chosen per package (see the table above and each package's own `LICENSE`):

- **Apache-2.0** — `momo-types`, `types`, `platform`, `text`, `template-utils`, `dsl-react`. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE) at the root; each of these packages ships both.
- **MIT** — `dictionary`, `templates-advanced`, `templates`. The template libraries are MIT so you can copy a template into your own project without ceremony. (The community repos linked above are MIT too; the sandbox corpus is Apache-2.0.)

m0saic and the m0saic logo are trademarks of m0saic LLC. Neither license grants permission to use the trade names, trademarks, service marks, or product names of m0saic LLC, except as required for reasonable and customary use in describing the origin of the work.

The renderer, the CLI and the desktop application are not in this repository.

---

## Links

- The m0 layout DSL: https://github.com/m0saic-dsl/m0
- The CLI: `npm i -g m0saic`
- Website: https://m0saic.io
- Editor: https://app.m0saic.io/layout
- Learn: https://app.m0saic.io/learn

Maintained by **m0saic LLC**.
