/**
 * Theming plumbing — the reference producer/consumer helpers over the shared
 * theming contract in `@m0saic/types` ({@link MosaicThemeTokens} published
 * under {@link MOSAIC_THEME_ALIAS}).
 *
 * A **producer** publishes a token set as a data source:
 *
 *   sources: [ ...previewCells, publishTheme(tokens) ]
 *
 * A **consumer** overlays whatever a producer supplied onto its own constants,
 * so an un-themed standalone render is byte-identical to today:
 *
 *   const LOCAL: MosaicThemeTokens = { …this template's current colors… };
 *   const theme = applyTheme(LOCAL, ctx);   // producer wins per-key; else LOCAL
 *   const bar = makeColorTile(theme.accent);
 *
 * Both sides only ever agree on the token SHAPE + the alias — never on a
 * specific producer template — so any conforming producer is swappable under
 * any consumer.
 */
import type {
  MosaicDataSource,
  MosaicEngineContext,
  MosaicThemeTokens,
} from "@m0saic/types";
import { asAliasId, MOSAIC_THEME_ALIAS } from "@m0saic/types";
import { getUpstreamBlock } from "../data/upstream";

export interface ThemeChannelOptions {
  /** Upstream alias to publish under / read from. Default {@link MOSAIC_THEME_ALIAS}. */
  alias?: string;
}

/**
 * Build the data source a theme producer emits. Drop it into the producer's
 * `sources` — it carries the tokens on the upstream channel (a side-channel,
 * not an m0 cell) under `alias` (default `"theme"`).
 */
export function publishTheme(
  tokens: MosaicThemeTokens,
  opts: ThemeChannelOptions = {},
): MosaicDataSource {
  return {
    type: "data",
    alias: asAliasId(opts.alias ?? MOSAIC_THEME_ALIAS),
    variables: { ...tokens } as Record<string, unknown>,
    editor: { owner: "template" },
  };
}

/**
 * Read the theme block a producer published (`ctx.upstreamData[alias]`), or
 * `undefined` when this template renders un-themed (standalone / no producer
 * wired ahead of it). Prefer {@link applyTheme} when you have local fallbacks.
 */
export function readTheme(
  ctx: MosaicEngineContext,
  opts: ThemeChannelOptions = {},
): MosaicThemeTokens | undefined {
  return getUpstreamBlock(ctx, opts.alias ?? MOSAIC_THEME_ALIAS) as
    | MosaicThemeTokens
    | undefined;
}

/**
 * Overlay the published theme (if any) onto `fallback`, per key. The consumer
 * workhorse: pass your template's current constants as `fallback` so an
 * un-themed render is unchanged, and a partial producer only overrides the
 * keys it supplies. Deterministic — pure merge, no ctx mutation.
 */
export function applyTheme<T extends MosaicThemeTokens>(
  fallback: T,
  ctx: MosaicEngineContext,
  opts: ThemeChannelOptions = {},
): T {
  const published = getUpstreamBlock(ctx, opts.alias ?? MOSAIC_THEME_ALIAS) as
    | Partial<T>
    | undefined;
  return published ? { ...fallback, ...published } : fallback;
}

export { MOSAIC_THEME_ALIAS, MOSAIC_THEME_TOKEN_KEYS } from "@m0saic/types";
export type {
  MosaicThemeTokens,
  MosaicThemeMode,
  MosaicThemeTokenKey,
} from "@m0saic/types";
