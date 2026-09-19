/**
 * ============================================================================
 * dsl-tutorial — Node combinator kit
 * ============================================================================
 *
 * A local copy of the tight-rect Node kit (lifted from `@m0saic/charts/bar-graph/v2`
 * via the Alpine pack) so this template is self-contained — NOT coupled to the
 * Alpine pack. Build the m0 string and its sources together so source emission
 * order always matches the DSL's DFS order (the Rect Thesis: every painted leaf
 * is a real, addressable cell).
 * ============================================================================
 */

import type {
  MosaicColor,
  MosaicSource,
  MosaicTextSource,
  MosaicEffectProps,
} from "@m0saic/types";
import { makeColorTile, latticeWeights } from "@m0saic/template-utils";
import { weightedSplit } from "@m0saic/dsl-stdlib";

/** One cell's m0 plus the sources its painted leaves contribute, in order. */
export type Node = { m0: string; sources: MosaicSource[] };
export type Band = { weight: number; node: Node };

export const EMPTY: Node = { m0: "-", sources: [] };
export const paint = (source: MosaicSource): Node => ({ m0: "F", sources: [source] });

// Cap a single split's cell count — scale weights to a small basis before
// weightedSplit so coprime pixel weights don't expand the DSL to their sum.
const SPLIT_BASIS_CAP = 120;

/** Weighted split along an axis; drops zero/neg-weight bands, collapses singletons. */
export function split(axis: "row" | "col", bands: Band[]): Node {
  const bs = bands.filter((b) => b.weight > 0);
  if (bs.length === 0) return EMPTY;
  if (bs.every((b) => b.node.sources.length === 0)) return EMPTY;
  if (bs.length === 1) return bs[0].node;
  const weights = bs.map((b) => Math.max(1, Math.round(b.weight)));
  // Basis on the 5-smooth lattice (latticeWeights, @m0saic/template-utils):
  // over the cap the bands are Hamilton-scaled to EXACTLY the cap (GCD ⇒ a
  // divisor of it); a rough pixel sum under the cap drifts ≤ 1 px onto the
  // nearest smooth basis; a symmetric inset or an item/gutter list is rewritten
  // as the same pattern on a smooth total (every item stays equal to its
  // siblings); smooth, tiny and equal-weight splits keep their basis.
  const m0 = String(weightedSplit(latticeWeights(weights, { cap: SPLIT_BASIS_CAP }), axis, { claimants: bs.map((b) => b.node.m0) }));
  return { m0, sources: bs.flatMap((b) => b.node.sources) };
}
export const rowSplit = (bands: Band[]): Node => split("row", bands);
export const colSplit = (bands: Band[]): Node => split("col", bands);

/** End index of a node's BODY — the count digits + balanced bracket group, or a
 *  single leaf char — i.e. the position right before any ROOT-level overlay `{`. */
function rootBodyEnd(m0: string): number {
  let i = 0;
  while (i < m0.length && m0[i] >= "0" && m0[i] <= "9") i++; // split count
  if (i < m0.length && (m0[i] === "(" || m0[i] === "[")) {
    let depth = 0;
    for (; i < m0.length; i++) {
      const c = m0[i];
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    return i;
  }
  return Math.max(1, i); // a leaf is a single char (F/1/0/>/-)
}

/** Overlay `over` on top of `base`, NESTING into `base`'s deepest root overlay so
 *  we never emit an illegal overlay CHAIN (`A{B}{C}`): when the base layout already
 *  carries a root overlay (`A{B}`), the result is `A{B{over}}`, not `A{B}{over}`.
 *  This is what lets the canvas composite its guides over a layout that itself uses
 *  `{}` overlays (e.g. the brand M). */
function nestOverlayM0(base: string, over: string): string {
  const end = rootBodyEnd(base);
  if (end < base.length && base[end] === "{") {
    const inner = base.slice(end + 1, base.length - 1); // strip the root `{ … }`
    return base.slice(0, end) + "{" + nestOverlayM0(inner, over) + "}";
  }
  return base + "{" + over + "}";
}

/** Overlay layers as nested overlays: base{l1{l2{…}}}. Sources concat in order.
 *  Composition NESTS (never chains) so a base whose own m0 ends in a root overlay
 *  stays valid (see {@link nestOverlayM0}). */
export function overlay(layers: Node[]): Node {
  const ls = layers.filter((l) => l.sources.length > 0 || l.m0 !== "-");
  if (ls.length === 0) return EMPTY;
  if (ls.length === 1) return ls[0];
  let m0 = ls[ls.length - 1].m0;
  for (let i = ls.length - 2; i >= 0; i--) m0 = nestOverlayM0(ls[i].m0, m0);
  return { m0, sources: ls.flatMap((l) => l.sources) };
}

/** Wrap a node in empty margins so it occupies an inset rect of the parent. */
export function insetNode(
  node: Node,
  top: number,
  right: number,
  bottom: number,
  left: number,
  W: number,
  H: number,
): Node {
  const mid = colSplit([
    { weight: left, node: EMPTY },
    { weight: W - left - right, node },
    { weight: right, node: EMPTY },
  ]);
  return rowSplit([
    { weight: top, node: EMPTY },
    { weight: H - top - bottom, node: mid },
    { weight: bottom, node: EMPTY },
  ]);
}

type HAlign = "left" | "center" | "right";
type VAlign = "top" | "middle" | "bottom";

/** A single fitted text cell. */
export function textCell(
  text: string,
  fontSize: number,
  color: MosaicColor,
  hAlign: HAlign = "center",
  vAlign: VAlign = "middle",
  padding?: { top?: number; right?: number; bottom?: number; left?: number },
): MosaicTextSource {
  const placement: Record<string, unknown> = { fit: "contain", hAlign, vAlign };
  if (padding) placement.padding = padding;
  return {
    type: "text",
    visual: { backgroundColor: "black@0" },
    layers: [
      {
        content: { kind: "literal", text: text || " " },
        style: { fontSize, fontColor: color },
        placement: placement as never,
      },
    ],
  } as MosaicTextSource;
}

/** A solid (optionally rounded + bordered) color tile leaf source. */
export function colorTile(
  color: MosaicColor,
  opts?: {
    cornerRadius?: number;
    cornerStyle?: "rounded" | "pill";
    border?: { color: MosaicColor; width?: number; alpha?: number };
  },
): MosaicSource {
  const effects: MosaicEffectProps = {};
  if (opts?.cornerRadius != null) {
    effects.rounding = {
      cornerStyle: opts.cornerStyle ?? "rounded",
      borderRadius: opts.cornerRadius,
    };
  }
  if (opts?.border) {
    effects.stroke = {
      position: "inner",
      width: opts.border.width ?? 0.002,
      color: opts.border.color,
      alpha: opts.border.alpha ?? 1,
    };
  }
  return makeColorTile(color, Object.keys(effects).length ? { effects } : undefined);
}

/** A reference to a nested-template child document. Size the child's slot to the
 *  cell rect (matched aspect) so `"contain"` fills it with no letterbox/distortion. */
export function mosaicRef(ref: string, fit: "contain" | "cover" = "contain"): MosaicSource {
  return { type: "mosaic", ref, placement: { fit } } as MosaicSource;
}
