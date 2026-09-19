/**
 * Shared frame resolution — the one parse both the geometry checker and the
 * layout checker build on. Turns a doc into: paint frames indexed by the
 * engine's source-binding index (`logicalIndex`), the source-tag reader, the
 * `stableKey → label` map (for backfill), and the `label → sourceIndices` map
 * (the label-keyed selector, one-to-MANY).
 */

import type { MosaicDocument, MosaicRenderableFile } from "@m0saic/types";
import { parseM0StringComplete, validateM0String, type RenderFrame } from "@m0saic/dsl";
import {
  bindingPath,
  isListPropType,
  isStructuredPropType,
  propDefinitionAtPath,
  classifyBindableProp,
  type BindableKind,
  type PropBindingRef,
  type PropPathSegment,
  type PropSchemaMap,
  sourceBindings,
} from "@m0saic/platform";

export type DocFrames = {
  frames: RenderFrame[];
  /** Frames indexed by `logicalIndex` (= the index into `sources[]`). */
  framesByLogical: RenderFrame[];
  /** The human tag at a source index: `sources[i].editor.label`. */
  srcLabel: (logicalIndex: number) => string | undefined;
  /** `stableKey → label` for every tagged source (for `doc.labels` backfill). */
  resolvedLabels: Record<string, string>;
  /** `label → the sourceIndices tagged with it` — the label-keyed selector. */
  labelToIndices: Map<string, number[]>;
};

/** Parse `doc.m0` at the canvas and resolve the source ⇄ geometry bindings. */
export function resolveDocFrames(doc: MosaicDocument, w: number, h: number): DocFrames {
  const m0 = String(doc.m0 ?? "");
  const parsed = validateM0String(m0).ok ? parseM0StringComplete(m0, w, h) : null;
  const frames: RenderFrame[] = parsed && parsed.ok ? parsed.ir.renderFrames : [];

  const framesByLogical: RenderFrame[] = [];
  for (const f of frames) framesByLogical[f.logicalIndex] = f;

  const sources = (doc.sources ?? []) as Array<{ editor?: { label?: string } } | undefined>;
  const srcLabel = (i: number): string | undefined => sources[i]?.editor?.label;

  const resolvedLabels: Record<string, string> = {};
  const labelToIndices = new Map<string, number[]>();
  for (const f of frames) {
    const label = srcLabel(f.logicalIndex);
    if (!label) continue;
    resolvedLabels[String(f.meta.stableKey)] = label;
    const arr = labelToIndices.get(label);
    if (arr) arr.push(f.logicalIndex);
    else labelToIndices.set(label, [f.logicalIndex]);
  }

  return { frames, framesByLogical, srcLabel, resolvedLabels, labelToIndices };
}

// ── Prop bindings — `source.editor.binding` → the rect it lands on ─────────
//
// Same law as labels: the template AUTHORS the binding on the source; the
// per-render `stableKey` is OUTPUT. Sources are positional, so a binding is
// aligned to whatever key its frame gets on THIS render — no migration on
// re-keying (autoCompact rewrites `m0`, never `sources`).

/** One resolved binding: the prop a rect displays and where the rect is. */
export type ResolvedPropBinding = {
  propKey: string;
  /** Element index for basic lists (kept for readability; also `path[0]`). */
  index?: number;
  /** Full route from the prop value to the bound leaf (`index` folded in);
   *  absent for a basic scalar. */
  path?: PropPathSegment[];
  /** Leaf value type: declared on structured bindings, derived from the
   *  schema for basic props (present when `propsSchema` was given). */
  kind?: BindableKind;
  /** Text layer of the source that shows this leaf (multi-layer sources). */
  layer?: number;
  /** Character span of the string leaf this rect edits (`bindPropRange`). */
  range?: { start: number; end: number };
  /** Sub-span of `range` the rect shows (the clicked token). */
  focus?: { start: number; end: number };
  /** Doc-LOCAL structural key (a child doc has its own keyspace). */
  stableKey: string;
  /** = `logicalIndex` into the OWNING doc's `sources[]`. */
  sourceIndex: number;
  /** `mosaic` refs walked from the root: `[]` = root, `["plot"]` = a child. */
  childPath: string[];
};

export type PropBindingRejection = ResolvedPropBinding & {
  reason: "unknown-prop" | "unsupported-type" | "index-required" | "path-required" | "kind-required";
};

export type PropBindingResolution = {
  /** `propKey → bindings`, in source (logical) order, root first. */
  byProp: Record<string, ResolvedPropBinding[]>;
  /** Bindings the schema refused (only populated when `propsSchema` is given). */
  rejected: PropBindingRejection[];
};

function rejectReason(
  schema: PropSchemaMap,
  b: PropBindingRef,
): PropBindingRejection["reason"] | null {
  const def = propDefinitionAtPath(schema, b.propKey);
  if (!def) return "unknown-prop";
  if (classifyBindableProp(def, b) !== null) return null;
  if (isListPropType(def) && b.index === undefined && !b.path?.length) return "index-required";
  if (isStructuredPropType(def)) {
    // A rect binding only fits a regions picker — whole (one region) or one
    // element by index (a rect list); anything else structured needs a
    // path + a leaf kind.
    if (b.kind === "rect") return "unsupported-type";
    if (!bindingPath(b).length) return "path-required";
    if (b.kind !== "string" && b.kind !== "number" && b.kind !== "color" && b.kind !== "media") return "kind-required";
  }
  return "unsupported-type";
}

type BoundSource = {
  type?: string;
  ref?: string;
  editor?: { binding?: PropBindingRef; bindings?: PropBindingRef[] };
};

/**
 * Resolve every `source.editor.binding` in a doc (and, by default, its
 * `mosaic`-ref children, each parsed at the frame it fills — the same walk the
 * Make preview does) to the rect it lands on this render.
 *
 * With `propsSchema`, bindings the schema refuses land in `rejected` instead
 * of `byProp` — a template test asserts `rejected` is empty; the Make page
 * passes the registry schema and ignores `rejected`. Never throws: invalid m0
 * resolves to no frames.
 */
export function resolvePropBindings(
  doc: MosaicDocument,
  w: number,
  h: number,
  opts: { propsSchema?: PropSchemaMap; children?: boolean } = {},
): PropBindingResolution {
  const byProp: Record<string, ResolvedPropBinding[]> = {};
  const rejected: PropBindingRejection[] = [];
  const walkChildren = opts.children ?? true;

  const visit = (d: MosaicDocument, cw: number, ch: number, childPath: string[]): void => {
    const { framesByLogical } = resolveDocFrames(d, cw, ch);
    const sources = (d.sources ?? []) as Array<BoundSource | undefined>;
    for (let i = 0; i < framesByLogical.length; i++) {
      const f = framesByLogical[i];
      if (!f) continue;
      const src = sources[i];
      for (const b of sourceBindings(src?.editor)) {
        const full = bindingPath(b);
        const def = opts.propsSchema ? propDefinitionAtPath(opts.propsSchema, b.propKey) : undefined;
        const kind = def ? classifyBindableProp(def, b) : b.kind;
        const hit: ResolvedPropBinding = {
          propKey: b.propKey,
          ...(b.index !== undefined ? { index: b.index } : {}),
          ...(full.length ? { path: full } : {}),
          ...(kind ? { kind } : {}),
          ...(b.layer !== undefined ? { layer: b.layer } : {}),
          ...(b.range ? { range: b.range } : {}),
          ...(b.focus ? { focus: b.focus } : {}),
          stableKey: String(f.meta.stableKey),
          sourceIndex: i,
          childPath,
        };
        const reason = opts.propsSchema ? rejectReason(opts.propsSchema, b) : null;
        if (reason) rejected.push({ ...hit, reason });
        else (byProp[b.propKey] ??= []).push(hit);
      }
      if (walkChildren && src?.type === "mosaic" && src.ref) {
        const child = d.children?.[src.ref] as MosaicRenderableFile | undefined;
        if (child && (child as { kind?: string }).kind === "mosaic_document") {
          visit(child as MosaicDocument, f.width, f.height, [...childPath, src.ref]);
        }
      }
    }
  };

  visit(doc, w, h, []);
  return { byProp, rejected };
}
