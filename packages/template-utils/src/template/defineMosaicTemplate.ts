import { enforceTemplateConventions } from "./templateConventions";
import { currentTemplateOrigin } from "./templateOriginScope";
import type {
  MosaicTemplate,
  MosaicTemplateProps,
  MosaicTemplateOutputs,
  MosaicTemplateUpstreamVariables,
  MosaicTemplateUpstreamData,
  MosaicTemplateSidecars,
  MosaicEngineContext,
  MosaicTelemetrySink,
  TemplateId,
} from "@m0saic/types";
import { emitTemplateLog } from "@m0saic/types";
import { assertTiming } from "../assertTiming";
import { stampRenderableOutput, type StampSource } from "../render/stampOutput";
import { finalizeRenderable } from "../render/finalizeRenderable";
import { autoCompactRenderable } from "../render/autoCompactRenderable";

/**
 * Helper for defining strongly-typed templates.
 *
 * # Simple usage (1 generic) — recommended for most templates:
 *
 *   type CalendarProps = { year: number; month: number; ... };
 *
 *   export const Calendar = defineMosaicTemplate<CalendarProps>({
 *     id: "Calendar",
 *     propsSchema: { ... },
 *     render: (props, ctx) => { ... },
 *   });
 *
 * # Full usage (5 generics) — for templates that declare typed
 *   outputs / upstream reads / sidecars:
 *
 *   type GitHubOutputs = { repositories: { repos: …; pageInfo: …; … } };
 *   type GitHubSidecars = { repositories: GitHubOutputs["repositories"] };
 *
 *   export const GitHubFetcher = defineMosaicTemplate<
 *     GitHubProps,
 *     GitHubOutputs,
 *     Record<string, never>,    // U — no upstream variables
 *     Record<string, never>,    // D — no upstream data
 *     GitHubSidecars
 *   >({ ... });
 *
 * The 5-generic form lets the type-checker enforce that:
 * - sidecars returned by render() match the declared S shape
 * - ctx.upstreamData reads are typed against D
 * - ctx.upstreamVariables reads are typed against U
 * - outputsSchema keys align with O
 *
 * Defaults preserve back-compat: every existing 1-generic call site
 * compiles unchanged.
 *
 * IMPORTANT TIMING INVARIANT
 *
 * Templates MUST propagate engine-decided timing (fps, durationMs)
 * into the returned renderable (document or pipeline).
 *
 * Why:
 * - Nested mosaics rely on these values being correct for resampling,
 *   looping, and composition.
 * - Pipelines rely on consistent fps and correct step duration totals.
 *
 * Policy:
 * - The engine treats `ctx.target` as authoritative for the current
 *   template invocation (top-level and nested can differ).
 * - We stamp here to guarantee correctness.
 * - We still assert after stamping so regressions are caught immediately.
 *
 * Finalization:
 * - finalizeRenderable is applied automatically after stamping.
 * - Every document and source gets engine.renderStatus "ok" by default;
 *   templates may set source.engine.renderStatus "error" to mark a source as failed.
 */
/** How {@link defineMosaicTemplate} treats a convention violation. */
export type DefineMosaicTemplateOptions = {
  /**
   * Convention posture. Default = derived from the ambient origin scope:
   * `"throw"` for first-party, `"record"` inside `withExternalTemplateOrigin`
   * (an external repo's module body calls this wrapper directly at import,
   * never through `registerTemplate`). Pass explicitly only to override.
   */
  conventions?: "throw" | "record";
};

const DEFAULT_FINALIZE_OPTS = {
  defaultRenderableOwner: "user" as const,
  defaultSourceOwner: "user" as const,
};

/**
 * The optional capability handles the Level 1 gate withholds from a
 * template that hasn't declared `tier: "capability"`. Hosts thread
 * both onto every ctx, so a core-tier template loses exactly this
 * pair — and only this pair.
 */
const DENIED_CAPABILITY_FIELDS = ["secrets", "connections"] as const;
type DeniedCapabilityField = (typeof DENIED_CAPABILITY_FIELDS)[number];

/**
 * What the template said about its tier. `"unset"` is a MISSING
 * `capabilities` block — denied the same way as `"core"`, but a
 * different authoring mistake, so the advice names it differently.
 */
type DeclaredTier = "core" | "unset";

/**
 * `console.warn` dedupe: one line per (template, field) per process.
 * A render loop — cron, `--watch`, a desktop session re-rendering on
 * every prop tweak — would otherwise repeat the same advice forever.
 * Telemetry is NOT deduped here; it is scoped per render invocation
 * (see `gateCapabilityCtx`), so every render is still attributable.
 */
const warnedDeniedCapabilityReads = new Set<string>();

/**
 * Brand on a denial-tripwire getter so a gate can RECOGNISE one without
 * invoking it. Load-bearing: `registerTemplate` wraps every template through
 * `defineMosaicTemplate` again (a repo module already wrapped it), so the
 * inner gate sees a ctx the outer gate has already stripped — its own
 * "is a handle supplied?" check must not read the outer wire and report a
 * denial the template never committed. Same symbol across module copies.
 */
const DENIAL_TRIPWIRE = Symbol.for("m0saic.capabilityDenialTripwire");

/** True when `obj[field]` is an outer gate's denial tripwire (checked via the
 *  descriptor — never by reading the property). */
export function isCapabilityDenialTripwire(obj: object, field: string): boolean {
  const d = Object.getOwnPropertyDescriptor(obj, field);
  return typeof d?.get === "function" && (d.get as unknown as Record<symbol, unknown>)[DENIAL_TRIPWIRE] === true;
}

/** Test seam: forget the process-wide `console.warn` dedupe. */
export function __resetCapabilityDenialWarnings(): void {
  warnedDeniedCapabilityReads.clear();
}

/**
 * Link from a wrapper function this module emits back to the function it
 * wraps. The freeze gate pins a shipped template's RENDER IDENTITY — the
 * source text of its compiled `render` / `renderLite` / `renderCover` — and
 * every registered template is wrapped at least once (twice when the module
 * called `defineMosaicTemplate` itself and `registerTemplate` wrapped again),
 * so `fn.toString()` of what the registry holds would be this file's wrapper,
 * identical for every template. `freeze.ts` (which may import nothing outside
 * node builtins) follows this symbol-keyed, non-enumerable link down to the
 * template's own function. `Symbol.for` so a hot-reloaded copy of this module
 * and the vendored one agree.
 */
export const TEMPLATE_WRAPPED_FROM: unique symbol = Symbol.for("m0saic.templateWrappedFrom") as never;

/** Attach the {@link TEMPLATE_WRAPPED_FROM} link on a wrapper. */
function linkWrappedFrom<F extends Function>(wrapper: F, original: Function): F {
  Object.defineProperty(wrapper, TEMPLATE_WRAPPED_FROM, {
    value: original,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return wrapper;
}

/**
 * The innermost function under a chain of `defineMosaicTemplate` wrappers —
 * the template's own `render` (or `renderLite` / `renderCover`) as compiled.
 * A function that was never wrapped is returned as is.
 */
export function unwrapTemplateFunction<F extends Function>(fn: F): F {
  let cur: Function = fn;
  const seen = new Set<Function>();
  for (;;) {
    const inner = (cur as unknown as Record<symbol, unknown>)[TEMPLATE_WRAPPED_FROM];
    if (typeof inner !== "function" || seen.has(inner)) return cur as F;
    seen.add(cur);
    cur = inner;
  }
}

/**
 * What the template author is told. The whole point is to separate
 * the two indistinguishable `undefined`s: "the host has no connection
 * configured" (fix your host/env) vs. "your declared tier denied the
 * one it does have" (fix your template). Name the field, the
 * template, and the declaration that would grant it.
 */
function deniedCapabilityMessage(
  templateId: string,
  field: DeniedCapabilityField,
  declared: DeclaredTier,
): string {
  return (
    `[m0saic] Template "${templateId}" read ctx.${field}, but ` +
    (declared === "core"
      ? `declares capabilities: { tier: "core" }. `
      : `declares no "capabilities" block at all (missing → treated as core). `) +
    `The Level 1 capability gate withheld the ` +
    `handle, so the read returned undefined — the host DID supply ctx.${field}; ` +
    `the tier declaration is what denied it. To receive ctx.secrets / ` +
    `ctx.connections, declare capabilities: { tier: "capability", caps: { … } } ` +
    `(see the capability-tier docs).`
  );
}

/**
 * Re-attach a withheld handle as a **non-enumerable getter** that
 * still reads `undefined`, and report the denial the first time the
 * template reaches for it.
 *
 * Non-enumerable is load-bearing: `Object.keys`, spread and
 * `JSON.stringify` all skip it, so the denied ctx keeps the exact
 * key set a core-tier template has always seen. Nothing about the
 * gate's semantics changes — only its observability.
 */
function attachDenialTripwire(
  target: Record<string, unknown>,
  field: DeniedCapabilityField,
  templateId: TemplateId,
  declared: DeclaredTier,
  ctx: { telemetry?: MosaicTelemetrySink },
  reported: Set<DeniedCapabilityField>,
): void {
  const get = (): undefined => {
      // Once per render invocation — a template that probes the same
      // handle per frame shouldn't flood the telemetry stream.
      if (!reported.has(field)) {
        reported.add(field);
        emitTemplateLog(ctx, {
          templateId,
          level: "warn",
          message: `Denied read of ctx.${field}: template is core tier`,
          data: {
            event: "capability_denied_read",
            field,
            declaredTier: declared,
            requiredTier: "capability",
          },
        });
      }
      const key = `${templateId}::${field}`;
      if (!warnedDeniedCapabilityReads.has(key)) {
        warnedDeniedCapabilityReads.add(key);
        console.warn(deniedCapabilityMessage(templateId, field, declared));
      }
      return undefined;
  };
  (get as unknown as Record<symbol, unknown>)[DENIAL_TRIPWIRE] = true;
  Object.defineProperty(target, field, {
    enumerable: false,
    // Configurable so a host (or a test) can redefine the field.
    configurable: true,
    get,
  });
}

export function defineMosaicTemplate<
  P extends MosaicTemplateProps,
  O extends MosaicTemplateOutputs = MosaicTemplateOutputs,
  U extends MosaicTemplateUpstreamVariables = MosaicTemplateUpstreamVariables,
  D extends MosaicTemplateUpstreamData = MosaicTemplateUpstreamData,
  S extends MosaicTemplateSidecars = MosaicTemplateSidecars,
>(
  template: MosaicTemplate<P, O, U, D, S>,
  opts: DefineMosaicTemplateOptions = {},
): MosaicTemplate<P, O, U, D, S> {
  // Conventions fire FIRST, at definition time — the one seam every registered
  // template passes through (see templateConventions.ts). A first-party
  // template that hides a default throws here; a `legacy`-marked or external
  // one is recorded. The posture follows the ambient origin scope unless the
  // caller overrides it.
  const conventions =
    opts.conventions ?? (currentTemplateOrigin().kind === "external" ? "record" : "throw");
  enforceTemplateConventions(template as unknown as MosaicTemplate<P>, { mode: conventions });

  const originalRender = template.render;
  const originalRenderLite = template.renderLite;
  const originalRenderCover = template.renderCover;
  const originalRenderTutorial = template.renderTutorial;
  const finalizeOpts =
    (template as MosaicTemplate<P, O, U, D, S> & {
      defaultFinalizeOpts?: typeof DEFAULT_FINALIZE_OPTS;
    }).defaultFinalizeOpts ?? DEFAULT_FINALIZE_OPTS;

  // Level 1 capability gate (default-deny): templates that don't
  // declare `capabilities: { tier: "capability" }` never see
  // `ctx.secrets` / `ctx.connections` — hosts thread the resolvers
  // onto every ctx, so this wrapper is the seam where the declared
  // tier is enforced, uniformly across all render paths (CLI direct,
  // jobs template input, resolveMosaicx invocations, and nested
  // renders — renderNestedTemplate spreads the parent ctx but calls
  // the child's own wrapped render, so the gate cascades in both
  // directions). Missing/undefined `capabilities` → treated as core
  // → denied.
  //
  // Known limitation (by design): this is capability HYGIENE, not a
  // sandbox. A raw template object that bypasses defineMosaicTemplate
  // is not gated, and a capability-tier template's code is not
  // restricted beyond what the ctx exposes — consistent with the
  // Level 1 posture documented in @m0saic/types secrets.ts.
  const isCapabilityTier = template.capabilities?.tier === "capability";
  const declaredTier: DeclaredTier =
    template.capabilities === undefined ? "unset" : "core";
  const gateCapabilityCtx = (
    ctx: MosaicEngineContext<U, D>,
  ): MosaicEngineContext<U, D> => {
    if (isCapabilityTier) return ctx;
    const open = ctx as MosaicEngineContext<U, D> & {
      secrets?: unknown;
      connections?: unknown;
    };
    // Which handles did the host actually supply? Decided from the property
    // DESCRIPTOR, never by reading: an outer gate (this template is wrapped
    // twice — once by its repo module, once by `registerTemplate`) leaves a
    // non-enumerable tripwire getter behind, and reading it here would report
    // a denial the template never committed.
    const supplied = (field: DeniedCapabilityField): boolean => {
      if (isCapabilityDenialTripwire(open, field)) return false; // already withheld upstream
      const d = Object.getOwnPropertyDescriptor(open, field);
      if (d) return typeof d.get === "function" || d.value !== undefined;
      return (open as Record<string, unknown>)[field] !== undefined; // inherited — no tripwire lives there
    };
    const withheld = DENIED_CAPABILITY_FIELDS.filter(supplied);
    // Nothing to strip → keep the ctx reference-identical (legacy).
    if (withheld.length === 0) return ctx;
    // Shallow copy omitting the capability handles. Spread preserves every
    // other own ENUMERABLE field, including the engine-internal `cache`
    // intersection attached by createEngineContext — and skips (never
    // invokes) an upstream tripwire, which is non-enumerable by design.
    const rest: Record<string, unknown> = { ...(open as Record<string, unknown>) };
    for (const field of withheld) delete rest[field];
    // The denial used to be SILENT — the fields simply vanished, and a
    // template that read one got an `undefined` indistinguishable from
    // "no connection configured". That is the failure this file's own
    // doc calls "the #1 silent failure", and it cost a third-party pack
    // a full bisect through the CLI, core and template-utils before
    // landing back here. Re-attach each WITHHELD field (only the ones
    // the host actually supplied — an absent handle denied nothing) as
    // a tripwire that names the tier problem on first read.
    const reported = new Set<DeniedCapabilityField>();
    for (const field of withheld) {
      attachDenialTripwire(rest, field, template.id, declaredTier, ctx, reported);
    }
    return rest as MosaicEngineContext<U, D>;
  };

  return {
    ...template,

    // IMPORTANT: must be `function`, not arrow, to preserve `this`
    render: linkWrappedFrom(async function (
      this: unknown,
      props: P,
      ctx: MosaicEngineContext<U, D>
    ) {
      // Preserve template `this` for templates using `this.id`, `this.defaultProps`, etc.
      const out = await originalRender.call(this as any, props, gateCapabilityCtx(ctx));

      // Auto-compact the render output (lossless): drop pure-null layers
      // and reduce split counts to their minimum representation, unless
      // the template (or this document) opts out. Runs BEFORE stamping so
      // the self-describing on-disk m0 is the compacted one.
      const compacted = autoCompactRenderable(
        out,
        { width: ctx.target.width, height: ctx.target.height },
        { skip: template.skipAutoCompact === true },
      );

      // Stamp resolved output onto the doc/pipeline so the on-disk
      // .mosaic file is self-describing (rule: "stamp at write time").
      // ctx.target carries the slot dims (== top-level for non-nested
      // or non-slot-aware renders); ctx.output carries codec/format.
      const stampSource: StampSource = {
        width: ctx.target.width,
        height: ctx.target.height,
        fps: ctx.target.fps,
        durationMs: ctx.target.durationMs,
        target: ctx.output.target,
        format: ctx.output.format,
        audio: ctx.output.audio,
        color: ctx.output.color,
      };
      const stamped = stampRenderableOutput(compacted, stampSource);
      const finalized = finalizeRenderable(stamped, ctx, finalizeOpts);

      assertTiming(finalized, ctx, template.id);

      return finalized;
    }, originalRender),

    // The preview stand-in gets the same Level 1 gate — a core-tier
    // template must not read capability handles on the design hot
    // path either. No stamping/finalize here: renderLite output is
    // ephemeral preview material, matching the unwrapped legacy
    // behavior in every other respect.
    ...(originalRenderLite
      ? {
          renderLite: linkWrappedFrom(function (
            this: unknown,
            props: P,
            ctx: MosaicEngineContext<U, D>,
          ) {
            return originalRenderLite.call(this as any, props, gateCapabilityCtx(ctx));
          }, originalRenderLite),
        }
      : {}),

    // The first-open cover and the "?" tutorial are the same kind of
    // ephemeral preview material as renderLite — gate-only, no
    // autoCompact / stamp / finalize / assertTiming. A tutorial in
    // particular declares its OWN per-step durations, so stamping
    // ctx.target's timing over it would be actively wrong.
    ...(originalRenderCover
      ? {
          renderCover: linkWrappedFrom(function (
            this: unknown,
            props: P,
            ctx: MosaicEngineContext<U, D>,
          ) {
            return originalRenderCover.call(this as any, props, gateCapabilityCtx(ctx));
          }, originalRenderCover),
        }
      : {}),

    ...(originalRenderTutorial
      ? {
          renderTutorial: linkWrappedFrom(function (
            this: unknown,
            props: P,
            ctx: MosaicEngineContext<U, D>,
          ) {
            return originalRenderTutorial.call(this as any, props, gateCapabilityCtx(ctx));
          }, originalRenderTutorial),
        }
      : {}),
  };
}
