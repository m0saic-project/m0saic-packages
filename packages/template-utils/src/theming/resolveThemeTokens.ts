/**
 * `resolveThemeTokens` — the consumer-side theme resolver that serves BOTH
 * roles a template can play, with one call:
 *
 *  - **As a child** (nested under a parent/pipeline that already published a
 *    theme): the tokens are on `ctx.upstreamData[namespace]` → read + overlay.
 *  - **As the head** (top-level, nothing upstream): if a `slug` is configured,
 *    INVOKE that producer template to seed the tokens, then overlay them.
 *
 * The resolution is always `ctx[namespace] ?? seed(slug) ?? fallback`, per-key
 * overlaid onto the consumer's own `fallback` constants — so an un-configured,
 * un-themed render is byte-identical to the fallback.
 *
 * Swapping the theme is swapping the `slug` (or its `props`) — a data change,
 * never a consumer code change. That is the whole point: the consumer agrees
 * with the producer on the token SHAPE + the alias only, never on a specific
 * producer template.
 *
 * `renderNestedTemplate` is a BUILD-TIME call (it runs the producer's `render`
 * + finalize, NOT ffmpeg), so self-seeding costs a doc build, not a render.
 */
import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicRenderableFile,
  MosaicThemeTokens,
} from "@m0saic/types";
import { MOSAIC_THEME_ALIAS } from "@m0saic/types";
import { getUpstreamBlock } from "../data/upstream";
import { renderNestedTemplate } from "../render/renderNestedTemplate";

/**
 * Opt-in theme-source configuration a consumer accepts (typically as a `theme`
 * prop). ABSENT → the consumer reads the default `"theme"` namespace off ctx
 * and falls back to local (serves the child case with zero config); it never
 * self-seeds. PRESENT with a `slug` → it additionally self-seeds when the
 * namespace isn't already on ctx (the head case).
 */
export interface ThemeSourceConfig {
  /**
   * Producer template slug to invoke when `namespace` isn't already present on
   * ctx (the head/self-seed case). Omit → never self-seed (read ctx or use the
   * fallback). Swapping this id swaps the theme with no consumer code change.
   */
  slug?: string;
  /**
   * Upstream alias to read the tokens from (and to publish under when seeding).
   * Default {@link MOSAIC_THEME_ALIAS} (`"theme"`).
   */
  namespace?: string;
  /**
   * Props passed to the producer when self-seeding (e.g. `{ preset: "dark" }`).
   * The resolver always forces `alias` = `namespace` so the published tokens
   * land where the consumer reads them.
   */
  props?: Record<string, unknown>;
  /**
   * Convenience for the one producer knob almost every theme exposes: the
   * preset / variant to request when self-seeding (e.g. `"light"` | `"dark"` |
   * `"high-contrast"` for `@m0saic/theming/v1` — but **producer-defined**;
   * another producer may accept `"pulsar"`, etc.). Pure sugar for
   * `props: { preset }`; an explicit `props.preset` still wins. Lets a template
   * expose one friendly string field instead of a raw props object.
   */
  preset?: string;
  /**
   * Re-seed via `slug` even when `namespace` is ALREADY populated on ctx.
   * Escape hatch for a namespace collision (a different producer higher in the
   * chain published the same alias with tokens you don't want) — though the
   * real fix is usually to correct the chain, not to force here. Default false.
   */
  forceFetch?: boolean;
}

/** Pull the published token block out of a producer's rendered doc — the data
 *  source whose alias matches (falling back to a matching sidecar). */
function readPublishedTokens(
  file: MosaicRenderableFile,
  alias: string,
): Partial<MosaicThemeTokens> | undefined {
  if (!file || file.kind !== "mosaic_document") return undefined;
  const doc = file as MosaicDocument;
  for (const s of doc.sources ?? []) {
    const src = s as { type?: string; alias?: unknown; variables?: Record<string, unknown> };
    if (src.type === "data" && String(src.alias) === alias && src.variables) {
      return src.variables as Partial<MosaicThemeTokens>;
    }
  }
  const sidecars = (doc as { sidecars?: Record<string, unknown> }).sidecars;
  const sc = sidecars?.[alias] ?? sidecars?.[MOSAIC_THEME_ALIAS];
  return sc as Partial<MosaicThemeTokens> | undefined;
}

/**
 * Resolve the theme tokens for a consumer: overlay whatever is found (on ctx,
 * or seeded from a producer) onto `fallback`, per-key.
 *
 * @param fallback the consumer's own constants — returned unchanged when
 *   nothing is found (byte-identical un-themed render).
 * @param ctx the render context (read for `upstreamData[namespace]`).
 * @param config opt-in theme source; omit for pure ctx-read-or-fallback.
 */
export async function resolveThemeTokens<T extends MosaicThemeTokens>(
  fallback: T,
  ctx: MosaicEngineContext,
  config?: ThemeSourceConfig,
): Promise<T> {
  const alias = config?.namespace ?? MOSAIC_THEME_ALIAS;
  let published = getUpstreamBlock(ctx, alias) as Partial<T> | undefined;

  if (config?.slug && (!published || config.forceFetch)) {
    // Head (or collision-escape): invoke the producer to seed the tokens.
    // Force `alias` last so the producer publishes where we read.
    const seeded = await renderNestedTemplate(
      config.slug,
      // `preset` sugar first, explicit `props` overrides it, `alias` forced last.
      { preview: false, ...(config.preset != null ? { preset: config.preset } : {}), ...(config.props ?? {}), alias },
      ctx,
    );
    published = readPublishedTokens(seeded, alias) as Partial<T> | undefined;
  }

  return published ? { ...fallback, ...published } : fallback;
}
