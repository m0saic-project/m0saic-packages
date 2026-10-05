/**
 * ============================================================================
 * Canvas handles — helpers for the 0.3.1 generation (NEW file; the older
 * `_shared` modules are frozen with the templates that shipped on them)
 * ============================================================================
 *
 * A 0.3.1 template is a `vN+1` that reuses its frozen `vN`'s builders, so its
 * rects arrive already built — and already bound to whatever `vN` bound. What
 * the new version adds is MORE handles on those same rects:
 *
 *  - {@link withAddHandles} — append binding entries to one source, keeping
 *    the ones it carries (its own value stays the primary, first entry);
 *  - {@link addHandlesByLabel} — the post-pass form: after the document is
 *    composed, hang entries on every source tagged with a label (`tag(src,
 *    "bar")`). One place, by name, instead of threading binders through
 *    builders that must stay byte-identical for paint parity;
 *  - {@link sourcesOfTree} — a document's sources plus its nested children's,
 *    for a template that clips part of itself into a child document.
 *
 * Every helper edits in place (like `bindProp`) and never touches paint.
 * ============================================================================
 */

import type { MosaicDocument, MosaicSource } from "@m0saic/types";
import { bindProps, type PropBindingEntry } from "@m0saic/template-utils";

type Bound = MosaicSource & { editor?: { label?: string; binding?: PropBindingEntry; bindings?: PropBindingEntry[] } };

type Ranged = PropBindingEntry & { range?: { start: number; end: number }; focus?: { start: number; end: number } };

const sameEntry = (a: PropBindingEntry, b: PropBindingEntry): boolean =>
  a.propKey === b.propKey && a.index === b.index && JSON.stringify(a.path ?? null) === JSON.stringify(b.path ?? null);

/**
 * Append binding entries to a source, keeping the ones it already carries (a
 * single `binding` or a `bindings` list) and skipping any it already has. No
 * entries → the source untouched.
 */
export function withAddHandles<T extends MosaicSource>(src: T, entries: ReadonlyArray<PropBindingEntry>): T {
  const s = src as unknown as Bound;
  const existing = s.editor?.bindings ?? (s.editor?.binding ? [s.editor.binding] : []);
  const fresh = entries.filter((e) => !existing.some((x) => sameEntry(x, e)));
  if (fresh.length === 0) return src;
  const out = bindProps(s, [...existing, ...fresh]);
  // `bindProps` normalises an entry to the fields it knows; a ranged binding
  // (`bindPropRange` — one line of a string) carries its span beside them, and
  // losing it would turn "edit this line" into "edit the whole value".
  existing.forEach((was, i) => {
    const kept = out.editor?.bindings?.[i] as Ranged | undefined;
    const { range, focus } = was as Ranged;
    if (kept && range) kept.range = { ...range };
    if (kept && focus) kept.focus = { ...focus };
  });
  if (out.editor) delete out.editor.binding;
  return out as unknown as T;
}

/** The label a source was tagged with (`tag(src, label)` / `editor.label`). */
export const labelOf = (src: MosaicSource): string | undefined => (src as Bound).editor?.label;

/** Entries for one label: fixed, or computed per matching source (`nth` = its order among that label's sources). */
export type HandlesForLabel = ReadonlyArray<PropBindingEntry> | ((src: MosaicSource, nth: number) => ReadonlyArray<PropBindingEntry>);

/**
 * Hang entries on every source tagged with a label. `first: [labels…]` limits
 * those labels to their FIRST source (an anchor for a one-off add handle).
 */
export function addHandlesByLabel(
  sources: ReadonlyArray<MosaicSource>,
  byLabel: Record<string, HandlesForLabel>,
  opts: { first?: readonly string[] } = {},
): void {
  const seen = new Map<string, number>();
  for (const src of sources) {
    const label = labelOf(src);
    if (!label || !Object.prototype.hasOwnProperty.call(byLabel, label)) continue;
    const nth = seen.get(label) ?? 0;
    seen.set(label, nth + 1);
    if (nth > 0 && opts.first?.includes(label)) continue;
    const spec = byLabel[label];
    withAddHandles(src, typeof spec === "function" ? spec(src, nth) : spec);
  }
}

/** A document's sources, then its nested children's (depth-first, each document once). */
export function sourcesOfTree(sources: ReadonlyArray<MosaicSource>, children?: Record<string, MosaicDocument | undefined>): MosaicSource[] {
  const out: MosaicSource[] = [...sources];
  const seen = new Set<unknown>();
  const walk = (docs: Record<string, MosaicDocument | undefined> | undefined) => {
    for (const doc of Object.values(docs ?? {})) {
      if (!doc || seen.has(doc)) continue;
      seen.add(doc);
      out.push(...((doc.sources ?? []) as MosaicSource[]));
      walk((doc as { children?: Record<string, MosaicDocument> }).children);
    }
  };
  walk(children);
  return out;
}

/** The first of `labels` some source carries — an anchor picker ("cat-label", else "bar"). */
export function firstLabelPresent(sources: ReadonlyArray<MosaicSource>, labels: readonly string[]): string | undefined {
  return labels.find((l) => sources.some((s) => labelOf(s) === l));
}
