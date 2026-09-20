# Theming — design tokens over the upstream channel

> Templates layer. How a template consumes (or produces) shared design tokens.
> Landed in F4 (`charts/stat-card/v1` is the first consumer). The token
> plumbing lives in `@m0saic/template-utils` (`src/theming/`); the contract in
> `@m0saic/types`; the reference producer at `@m0saic/theming/v1`.

Theming lets a **producer** template publish design tokens that any **consumer**
template overlays onto its own constants. Producer and consumer agree ONLY on a
token SHAPE + an alias — never on a specific producer — so any conforming
producer is swappable under any consumer.

## The three homes

- **Contract** — `@m0saic/types`: `MosaicThemeTokens` (21 role-based keys:
  `surface*` / `text*` / `accent*` / `positive` / `negative` / `grid*` /
  `axis*` / `radius` / `dataPalette`), `MosaicThemeMode`
  (`dark` | `light` | `high-contrast`), `MOSAIC_THEME_ALIAS` (`"theme"`),
  `MOSAIC_THEME_TOKEN_KEYS`. Keys are ADDITIVE-ONLY (renames force a
  re-checkpoint).
- **Plumbing** — `@m0saic/template-utils` (`src/theming/`): `publishTheme`,
  `readTheme`, `applyTheme` (sync — ctx-read + per-key overlay), and
  `resolveThemeTokens` (async — find-or-seed) + `ThemeSourceConfig`.
- **Reference producer** — `@m0saic/theming/v1`: a layered system —
  `M0SAIC_BRAND` (reference: navy + orange) → semantic `ThemeTokens` →
  `THEME_PRESETS` / `resolveTheme(mode)`. Publishes via `publishTheme`;
  `preview:false` emits a data-only doc valid only as an `intermediate`
  pipeline step.

## Consumer authoring pattern (the copyable recipe)

1. Declare your current constants as a full `MosaicThemeTokens` `LOCAL_THEME`
   (used keys carry the current hexes VERBATIM → byte-identity; unused keys are
   defensible locals, never read). Do NOT import the producer's `resolveTheme`
   into the fallback — coupling the fallback to a producer preset risks a drift
   that breaks byte-identity.
2. Add an opt-in `theme?: ThemeSourceConfig` prop
   (`{ slug?, namespace?, props?, forceFetch? }`).
3. In `render`: `const theme = await resolveThemeTokens(LOCAL_THEME, ctx,
   props.theme);` then read `theme.<key>` everywhere a constant was read.

## The resolution model — `theme = ctx[namespace] ?? seed(slug) ?? fallback`

The same one call serves both roles a template can play:

- **Vanilla** (no config, or a config without a `slug`): reads the default
  `"theme"` namespace off ctx, else `LOCAL_THEME`. Un-themed → byte-identical.
- **Child** (nested under a producer/pipeline that published tokens): finds them
  on `ctx.upstreamData[namespace]` → uses them. No `slug` needed.
- **Head** (top-level, nothing upstream, `slug` configured): INVOKES the producer
  (`renderNestedTemplate` — a BUILD-TIME doc build, NOT ffmpeg) to seed the
  tokens, then reads them.
- **`forceFetch`**: re-seed via `slug` even when the namespace is populated
  (escape hatch for a namespace collision; the real fix is usually higher in the
  chain).

**Swap the theme = swap `props.theme.slug` (or its `props`)** — a data change,
never consumer code. `applyTheme` is the sync subset (ctx-read + overlay, no
seeding) for consumers that never self-seed.

## Two hard rules

- Read via `applyTheme` / `resolveThemeTokens` (which read
  `ctx.upstreamData[alias]` through `getUpstreamBlock`). NEVER hand-read
  `ctx.upstreamVariables` for theme.
- `LOCAL_THEME`'s used keys = the template's current hexes, so an un-themed,
  un-configured render is byte-identical to pre-theming. Verify with a doc
  snapshot deep-equal.

## Pipeline alternative (production path for a chain)

To re-skin a whole chain, put the producer as an `intermediate: true` step ahead
of the consumers:
`[ @m0saic/theming/v1 preset:dark preview:false → …consumers ]`. The producer
threads tokens downstream at zero render cost; swapping the step's `preset`
re-skins everything. Consumers need no `slug` in this mode — they find the tokens
on ctx as children.

Reference consumer: `charts/stat-card/v1` (first `resolveThemeTokens` consumer,
F4). See also `data-pipeline.md`
§"Publish channels × read views" for the underlying upstream channel.
