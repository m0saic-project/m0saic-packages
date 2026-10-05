/**
 * The shared gate for a 0.3.1-generation template — a `vN+1` beside its frozen
 * `vN` (`.ai/proposed-plans/templates-0.3.1-migration.md`). Every such template
 * makes the same five promises, so its test file states them once through
 * {@link vnextSuite} and then locks only what is its own (the handles).
 *
 *   1. shell — the id / version moved, and the CODE describes nothing: label,
 *      description, tags and every prop's copy come from the catalog sidecar
 *      (`<name>.catalog.json`), which the registry applies;
 *   2. nothing was lost — every prop `vN` labelled / described still is;
 *   3. `vN` is deprecated in ITS sidecar, pointing here;
 *   4. the render audit passes as NEW work (no error finding, no lag) — the
 *      one-template form of the build gate;
 *   5. PAINT PARITY — across the cases, the document is `vN`'s once the editor
 *      handles are stripped. A template whose look had to move (canvasFill)
 *      says how through `parityNextProps` / `parity: false`.
 *
 * Not a test file (jest's testMatch is `*.test.ts`); lives under `__tests__`
 * so the package build and the freeze both leave it out.
 */
import type { MosaicDocument, MosaicEngineContext, MosaicRenderableFile, MosaicTemplate } from "@m0saic/types";
import { splitPropPresentation } from "@m0saic/platform";
import { auditRenderedTemplate, getTemplate, getTemplateAsRegistered, resolvePropBindings } from "@m0saic/template-utils";

type AnyTemplate = MosaicTemplate<any>;
type Rec = Record<string, unknown>;

export type VNextCase = {
  name: string;
  props?: Rec;
  /** Canvas; defaults to the template's hinted size (else 1280×720). */
  w?: number;
  h?: number;
  media?: Rec;
  durationMs?: number;
  /** Pass `props` as-is instead of over the template's defaults. */
  raw?: boolean;
};

export function ctxFor(t: AnyTemplate, c: Pick<VNextCase, "w" | "h" | "media" | "durationMs"> = {}): MosaicEngineContext {
  const width = c.w ?? t.outputHints?.width ?? 1280;
  const height = c.h ?? t.outputHints?.height ?? 720;
  const target = { width, height, fps: t.outputHints?.fps ?? 30, durationMs: c.durationMs ?? t.outputHints?.durationMs ?? 2000 };
  return { mode: "render", target, output: { ...target, workspaceDir: "/tmp/m0saic-vnext-test" }, media: c.media ?? {} } as unknown as MosaicEngineContext;
}

/** The documents a render produced: the document itself, or each pipeline step's. */
export function docsOf(file: MosaicRenderableFile): MosaicDocument[] {
  const f = file as unknown as { kind?: string; steps?: Array<{ file?: MosaicRenderableFile }> };
  if (f.kind === "mosaic_pipeline") return (f.steps ?? []).flatMap((s) => (s.file ? docsOf(s.file) : []));
  return [file as MosaicDocument];
}

/**
 * What a render PAINTS: a deep copy with every SOURCE's `editor` block removed
 * (handles, tags, owner — what Make reads, never what ffmpeg draws). Document-
 * level `editor` (labels, contracts) stays: that is the template talking, and
 * it should not move either.
 */
export function stripHandles(file: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(file));
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const rec = node as Rec;
    if (Array.isArray(rec.sources)) for (const s of rec.sources) if (s && typeof s === "object") delete (s as Rec).editor;
    for (const v of Object.values(rec)) walk(v);
  };
  walk(copy);
  return copy;
}

const sizeOf = (doc: MosaicDocument, ctx: MosaicEngineContext) => ({
  w: (doc as { size?: { width?: number } }).size?.width ?? ctx.target.width,
  h: (doc as { size?: { height?: number } }).size?.height ?? ctx.target.height,
});

/** Every prop key some rect binds (any document, any nested child), sorted; plus what was rejected. */
export function handlesOf(file: MosaicRenderableFile, t: AnyTemplate, ctx: MosaicEngineContext): { keys: string[]; rejected: unknown[] } {
  const keys = new Set<string>();
  const rejected: unknown[] = [];
  for (const doc of docsOf(file)) {
    const { w, h } = sizeOf(doc, ctx);
    const r = resolvePropBindings(doc, w, h, { propsSchema: t.propsSchema });
    for (const k of Object.keys(r.byProp)) keys.add(k);
    rejected.push(...r.rejected);
  }
  return { keys: [...keys].sort(), rejected };
}

type Bound = { editor?: { label?: string; binding?: { propKey: string }; bindings?: Array<{ propKey: string }> } };
const entriesOf = (s: Bound) => s.editor?.bindings ?? (s.editor?.binding ? [s.editor.binding] : []);

/** Every source a render carries — each document's, then its nested children's, in order. */
export function sourcesOf(file: MosaicRenderableFile): Bound[] {
  const out: Bound[] = [];
  const walk = (doc: MosaicDocument, seen: Set<unknown>) => {
    if (!doc || typeof doc !== "object" || seen.has(doc)) return;
    seen.add(doc);
    out.push(...((doc.sources ?? []) as Bound[]));
    for (const child of Object.values((doc as { children?: Record<string, unknown> }).children ?? {})) {
      if (child && typeof child === "object") for (const d of docsOf(child as MosaicRenderableFile)) walk(d, seen);
    }
  };
  const seen = new Set<unknown>();
  for (const doc of docsOf(file)) walk(doc, seen);
  return out;
}

/** The binding entries (`propKey`, `path`, `index`, `kind`, …) on the FIRST source tagged `label`. */
export function entriesOn(file: MosaicRenderableFile, label: string): Array<Record<string, unknown>> {
  const s = sourcesOf(file).find((x) => x.editor?.label === label);
  return s ? (entriesOf(s) as Array<Record<string, unknown>>) : [];
}

/** The prop keys on the FIRST source tagged `label` (children included, in order). */
export function keysOn(file: MosaicRenderableFile, label: string): string[] {
  return entriesOn(file, label).map((b) => String(b.propKey));
}

/** How many sources bind `key` (children included). */
export function countBound(file: MosaicRenderableFile, key: string): number {
  return sourcesOf(file).filter((s) => entriesOf(s).some((b) => b.propKey === key)).length;
}

export const renderStatusOf = (file: MosaicRenderableFile): string | undefined =>
  ((docsOf(file)[0]?.sources ?? [])[0] as { engine?: { renderStatus?: string } } | undefined)?.engine?.renderStatus;

/** Dotted prop keys → what presentation each carries (label / description), groups walked. */
function copyOf(schema: unknown, prefix = "", out: Record<string, { label: boolean; description: boolean }> = {}) {
  if (!schema || typeof schema !== "object") return out;
  for (const [key, def] of Object.entries(schema as Rec)) {
    if (!def || typeof def !== "object") continue;
    const d = def as { description?: unknown; meta?: { ui?: { label?: unknown } }; fields?: unknown };
    const dotted = prefix ? `${prefix}.${key}` : key;
    out[dotted] = { label: typeof d.meta?.ui?.label === "string", description: typeof d.description === "string" && d.description.trim().length > 0 };
    if (d.fields) copyOf(d.fields, dotted, out);
  }
  return out;
}

export type VNextSuiteOptions = {
  /** The new template (its exported object). */
  next: AnyTemplate;
  /** The frozen version it supersedes. */
  prev: AnyTemplate;
  /** Parity cases; a `defaults` case is always run first. */
  cases?: VNextCase[];
  /** Props merged into the NEW template's render for parity only (e.g. `{ useNestedBackgroundColor: true }`). */
  parityNextProps?: Rec;
  /** `false` = the look deliberately moved and the template's own test proves how. */
  parity?: boolean;
  /**
   * `false` = the DEFAULTS deliberately render differently (a media template
   * that showed a "missing source" card now shows its stand-in sheet); the
   * other cases still hold parity.
   */
  defaultsParity?: boolean;
  /** Prop keys a rect binds at defaults (sorted). */
  bound: string[];
  /** The template's `bindings.unbound` map. */
  unbound?: Record<string, string>;
  /** Catalog fields the sidecar must carry beyond label / description / tags (e.g. `{ primitive: true }`). */
  catalog?: Rec;
  /** Top-level prop keys whose definition deliberately changed (skipped by the schema-identity check). */
  schemaChanged?: string[];
  /** Context factory override (a template that needs more than target/output/media). */
  ctx?: (t: AnyTemplate, c: VNextCase) => MosaicEngineContext;
  /**
   * A capability-tier template: the build gate SKIPS its render audit (a bare
   * ctx cannot supply host handles), so nothing would hold its handles to the
   * conventions. Set this when its DEFAULTS render without those handles: the
   * suite then audits a core-tier twin of it, so the same rules apply.
   */
  capability?: boolean;
};

export function vnextSuite(o: VNextSuiteOptions): void {
  const id = String(o.next.id);
  const prevId = String(o.prev.id);
  const mkCtx = o.ctx ?? ((t: AnyTemplate, c: VNextCase) => ctxFor(t, c));
  const propsFor = (t: AnyTemplate, c: VNextCase, extra: Rec = {}) => (c.raw ? { ...(c.props ?? {}), ...extra } : { ...(t.defaultProps as Rec | undefined), ...(c.props ?? {}), ...extra });
  const cases: VNextCase[] = [{ name: "defaults" }, ...(o.cases ?? [])];

  describe(`${id} — 0.3.1 generation of ${prevId}`, () => {
    it("moved the id and the version, and kept the output kind", () => {
      const v = (s: string) => Number(/\/v(\d+)$/.exec(s)?.[1]);
      expect(id.replace(/\/v\d+$/, "")).toBe(prevId.replace(/\/v\d+$/, ""));
      expect(v(id)).toBe(v(prevId) + 1);
      expect(o.next.version).toBe(v(id));
      expect(o.next.outputHints?.format).toEqual(o.prev.outputHints?.format);
      expect(o.next.capabilities).toEqual(o.prev.capabilities);
    });

    it("the code describes nothing; the catalog sidecar does, and the registry applies it", () => {
      const code = getTemplateAsRegistered(id) as unknown as Rec;
      for (const field of ["label", "description", "tags", "primitive", "internal", "deprecated", "preview", "platforms", "channels"]) expect(code[field]).toBeUndefined();
      for (const [key, c] of Object.entries(copyOf(code.propsSchema))) expect([key, c]).toEqual([key, { label: false, description: false }]);
      const registered = getTemplate(id)!;
      expect(typeof registered.label === "string" && registered.label.length > 0).toBe(true);
      expect(typeof registered.description === "string" && registered.description.length > 0).toBe(true);
      expect((registered.tags ?? []).length).toBeGreaterThan(0);
      expect(registered.deprecated).toBeUndefined();
      for (const [field, value] of Object.entries(o.catalog ?? {})) expect((registered as unknown as Rec)[field]).toEqual(value);
    });

    it(`nothing was lost: every prop ${prevId.match(/v\d+$/)?.[0]} labelled or described still is`, () => {
      const before = copyOf((getTemplateAsRegistered(prevId) ?? getTemplate(prevId))!.propsSchema);
      const after = copyOf(getTemplate(id)!.propsSchema);
      const lost: string[] = [];
      for (const [key, c] of Object.entries(before)) {
        if (!after[key]) continue; // a prop the new version dropped is its own test's business
        if (c.label && !after[key].label) lost.push(`${key}.label`);
        if (c.description && !after[key].description) lost.push(`${key}.description`);
      }
      expect(lost).toEqual([]);
    });

    it("what each value IS did not move: types, constraints and controls are the old version's", () => {
      const was = splitPropPresentation((getTemplateAsRegistered(prevId) ?? getTemplate(prevId))!.propsSchema).schema;
      const is = splitPropPresentation(getTemplateAsRegistered(id)!.propsSchema).schema;
      const skip = new Set(o.schemaChanged ?? []);
      const norm = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));
      for (const key of Object.keys(was)) if (!skip.has(key)) expect([key, norm(is[key])]).toEqual([key, norm(was[key])]);
    });

    it("the old version is deprecated in its own sidecar, pointing here", () => {
      expect(getTemplate(prevId)!.deprecated).toMatchObject({ replacement: id });
    });

    it("meets every 0.3.1 convention as new work (the build gate's render audit, no lag)", async () => {
      const audit = await auditRenderedTemplate(getTemplate(id)!, { record: false });
      // Keys first (the worklist at a glance), the first detail after (the fix text).
      const keysOf = (a: typeof audit) => a.findings.filter((f) => f.severity === "error").flatMap((f) => f.violations.map((v) => `${f.convention}: ${v.key}`));
      if (!o.capability) {
        expect(audit.skipped).toBeUndefined();
        expect(keysOf(audit)).toEqual([]);
        expect(audit.lagging).toEqual([]);
        return;
      }
      // The gate's own view: render audit skipped, the file still judged (catalogSidecar).
      expect(audit.skipped).toMatch(/capability tier/);
      expect(keysOf(audit)).toEqual([]);
      expect(audit.lagging).toEqual([]);
      // The render rules, on a core-tier twin (the catalog-applied view, so the
      // hint lines are present; `catalogSidecar` was judged above, on the file).
      const twin = { ...(getTemplate(id)! as object), capabilities: { tier: "core" } } as AnyTemplate;
      const rendered = await auditRenderedTemplate(twin, { record: false });
      expect(rendered.skipped).toBeUndefined();
      expect(keysOf(rendered).filter((k) => !k.startsWith("catalogSidecar:"))).toEqual([]);
    });

    if (o.parity !== false) {
      const parityCases = o.defaultsParity === false ? cases.slice(1) : cases;
      it.each(parityCases.map((c) => [c.name, c] as const))("paints what the old version paints — %s", async (_name, c) => {
        const prev = await o.prev.render(propsFor(o.prev, c), mkCtx(o.prev, c));
        const next = await o.next.render(propsFor(o.next, c, o.parityNextProps), mkCtx(o.next, c));
        const same = JSON.parse(JSON.stringify(stripHandles(next)).split(id).join(prevId));
        expect(same).toEqual(stripHandles(prev));
      });
    }

    it("is deterministic (two renders, one document)", async () => {
      const c = cases[0];
      const a = await o.next.render(propsFor(o.next, c), mkCtx(o.next, c));
      const b = await o.next.render(propsFor(o.next, c), mkCtx(o.next, c));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it("handles at defaults: what is bound, what is declared, nothing rejected", async () => {
      const c = cases[0];
      const ctx = mkCtx(o.next, c);
      const h = handlesOf(await o.next.render(propsFor(o.next, c), ctx), o.next, ctx);
      expect(h.rejected).toEqual([]);
      expect(h.keys).toEqual([...o.bound].sort());
      expect(o.next.bindings?.unbound ?? {}).toEqual(o.unbound ?? {});
    });
  });
}

/**
 * The paint of a document with its timestamp CHIPS set aside (screencap grid,
 * 0.3.1): the base lattice (the m0 before its first overlay), every non-chip
 * source, and the chips themselves with their placement removed — so a test
 * can hold "everything but where the chips sit" to the old version while the
 * chips moved to rects of their own. A chip is the one text source the
 * screencap family draws: `buildTimestampSource`'s 18 px, hairline-bordered type.
 */
export function paintSansChips(file: MosaicRenderableFile): { base: string; others: unknown[]; chips: unknown[] }[] {
  return docsOf(stripHandles(file) as MosaicRenderableFile).map((doc) => {
    const isChip = (s: unknown): boolean => {
      const src = s as { type?: string; layers?: Array<{ style?: { fontSize?: number; borderWidth?: number } }> };
      return src.type === "text" && src.layers?.[0]?.style?.fontSize === 18 && src.layers[0].style.borderWidth === 0.003;
    };
    const sources = (doc.sources ?? []) as unknown[];
    // Chips as a SET: a chip's position is its own placement, so the order the
    // placer emits them in (lattice order) is not paint.
    const chips = sources
      .filter(isChip)
      .map((s) => {
        const c = JSON.parse(JSON.stringify(s)) as { placement?: unknown; layers: Array<{ placement?: unknown }> };
        delete c.placement;
        for (const layer of c.layers) delete layer.placement;
        return c;
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return { base: String(doc.m0).split("{")[0], others: sources.filter((s) => !isChip(s)), chips };
  });
}
