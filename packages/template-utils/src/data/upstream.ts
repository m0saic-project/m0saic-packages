import type {
  MosaicEngineContext,
  MosaicUpstreamPublication,
} from "@m0saic/types";

/**
 * Human-friendly readers for the upstream data channel on
 * `MosaicEngineContext` — the ctx views populated by cross-step /
 * cross-tile threading (`ctx.upstreamVariables`, `ctx.upstreamData`,
 * `ctx.upstreamPublications`).
 *
 * Why these exist: the raw fields are optional, readonly, and typed by
 * template generics, so direct reads decay into cast-heavy optional
 * chains (`(ctx.upstreamData as Record<...> | undefined)?.[alias] ?? null`).
 * Consumers should read like prose instead:
 *
 *   if (!hasUpstream(ctx)) return renderMissingCard();
 *   const athlete = requireUpstreamBlock(ctx, "athleteData");
 *   const theme = getUpstreamVariable<string>(ctx, "chromeDark") ?? "#111";
 *
 * Semantics preserved exactly: "no upstream at all" (nothing threaded —
 * standalone render or no producers) stays distinguishable from
 * "threaded but empty / key absent". None of these helpers coerce or
 * transform values — they return the producer's raw data.
 */

/** One aliased data block, as published (raw values, untransformed). */
export type UpstreamBlock = Readonly<Record<string, unknown>>;

/**
 * Whether ANY upstream context was threaded onto this ctx (pipeline
 * seed, doc-level step variables, or data-source publications). False
 * for standalone renders and producer-free layouts — the "am I inside
 * a wired pipeline at all?" check.
 */
export function hasUpstream(ctx: MosaicEngineContext): boolean {
  return ctx.upstreamVariables !== undefined || ctx.upstreamData !== undefined;
}

/**
 * The aliases of every data block visible to this ctx, sorted.
 * `[]` when no upstream was threaded — handy for MISSING-state
 * diagnostics ("available blocks: …").
 */
export function listUpstreamAliases(ctx: MosaicEngineContext): string[] {
  return Object.keys(ctx.upstreamData ?? {}).sort();
}

/** Whether a specific aliased block arrived. */
export function hasUpstreamBlock(ctx: MosaicEngineContext, alias: string): boolean {
  return getUpstreamBlock(ctx, alias) !== undefined;
}

/**
 * Read one aliased data block (`ctx.upstreamData[alias]`), or
 * `undefined` when it didn't arrive. The generic is a CONVENIENCE
 * assertion, not a validation — pair it with `upstreamDataSchema` on
 * the template so drift fails at resolve time.
 */
export function getUpstreamBlock<T extends UpstreamBlock = UpstreamBlock>(
  ctx: MosaicEngineContext,
  alias: string,
): T | undefined {
  const blocks = ctx.upstreamData as
    | Readonly<Record<string, UpstreamBlock>>
    | undefined;
  return blocks?.[alias] as T | undefined;
}

/**
 * Like {@link getUpstreamBlock}, but fail-fast: throws with a message
 * naming the missing alias AND what WAS available — the right default
 * for consumers that are meaningless without their producer.
 */
export function requireUpstreamBlock<T extends UpstreamBlock = UpstreamBlock>(
  ctx: MosaicEngineContext,
  alias: string,
): T {
  const block = getUpstreamBlock<T>(ctx, alias);
  if (block === undefined) {
    const available = listUpstreamAliases(ctx);
    throw new Error(
      `upstream block "${alias}" not found on ctx.upstreamData ` +
        (available.length > 0
          ? `(available: ${available.join(", ")})`
          : "(no upstream data was threaded — is this template wired after its producer?)"),
    );
  }
  return block;
}

/**
 * The flat last-write-wins union (`ctx.upstreamVariables`), or
 * `undefined` when no upstream was threaded. Use `?? {}` at call sites
 * that don't care about the distinction.
 */
export function getUpstreamVariables(
  ctx: MosaicEngineContext,
): Readonly<Record<string, unknown>> | undefined {
  return ctx.upstreamVariables as Readonly<Record<string, unknown>> | undefined;
}

/**
 * Read one key from the flat union. `undefined` when the key (or the
 * union itself) is absent — combine with `??` for defaults:
 * `getUpstreamVariable<string>(ctx, "accent") ?? "#e33"`.
 */
export function getUpstreamVariable<T = unknown>(
  ctx: MosaicEngineContext,
  key: string,
): T | undefined {
  return (getUpstreamVariables(ctx) ?? {})[key] as T | undefined;
}

/**
 * The lossless, ordered publications list (`ctx.upstreamPublications`),
 * `[]` when absent. One entry per contributing data source, stamped
 * with provenance (`alias?`, `stepIndex?`, `tileStableKey?`,
 * `templateId?`) — same-alias colliders BOTH survive here even though
 * the merged views are last-write-wins.
 */
export function getUpstreamPublications(
  ctx: MosaicEngineContext,
): readonly MosaicUpstreamPublication[] {
  return ctx.upstreamPublications ?? [];
}

/**
 * Filter publications by provenance — the escape-hatch lookup for
 * "what did THIS tile / step / template publish". Every supplied field
 * must match; omitted fields match anything.
 *
 *   const [heroPub] = findUpstreamPublications(ctx, { tileStableKey: "r/fc0" });
 */
export function findUpstreamPublications(
  ctx: MosaicEngineContext,
  filter: {
    alias?: string;
    stepIndex?: number;
    tileStableKey?: string;
    templateId?: string;
  },
): MosaicUpstreamPublication[] {
  return getUpstreamPublications(ctx).filter((pub) => {
    if (filter.alias !== undefined && String(pub.alias) !== filter.alias) return false;
    if (filter.stepIndex !== undefined && pub.stepIndex !== filter.stepIndex) return false;
    if (
      filter.tileStableKey !== undefined &&
      String(pub.tileStableKey) !== filter.tileStableKey
    ) {
      return false;
    }
    if (filter.templateId !== undefined && String(pub.templateId) !== filter.templateId) {
      return false;
    }
    return true;
  });
}
