/**
 * ============================================================================
 * Alpine pack — shared card chrome + geometry kit
 * ============================================================================
 *
 * The signature Alpine surface: a rounded white card with a hairline border and
 * a left-aligned title / subtitle header band, with the chart body laid out in
 * the region below. Every template in the pack wraps its content in
 * {@link alpineCard} so the whole pack looks like one set.
 *
 * Geometry follows the construction-strategy hard rule (real m0 cells, not
 * full-frame drawtext): the card is a rounded `makeColorTile` overlay base, the
 * header + body are a row split, all placed via the small {@link Node} combinator
 * kit below (lifted from `@m0saic/charts/bar-graph/v2`, the canonical tight-rect
 * template). The kit is exported so Alpine templates build their interiors with
 * the same primitives.
 *
 * `alpineCard` returns a two-part contract:
 *   - `contentRect` — the pixel rect available to the body (so the template can
 *     size fonts / rails against real dimensions);
 *   - `compose(content)` — wraps that body in the card + header and returns the
 *     root {@link Node}.
 * ============================================================================
 */

import type {
  MosaicColor,
  MosaicSource,
  MosaicTextSource,
} from "@m0saic/types";
import { makeColorTile, textEmUnits, tag, fitEmUnits, bindProp, bindProps, latticeWeights } from "@m0saic/template-utils";
import { weightedSplit } from "@m0saic/dsl-stdlib";

import type { AlpineTheme } from "./alpine-theme";

// ---------------------------------------------------------------------------
// Node combinator kit — build the m0 string and its sources together so source
// emission order always matches the DSL's DFS order. (Mirrors bar-graph v2.)
// ---------------------------------------------------------------------------

/** One cell's m0 plus the sources its painted leaves contribute, in order. */
export type Node = { m0: string; sources: MosaicSource[] };
export type Band = { weight: number; node: Node };

export const EMPTY: Node = { m0: "-", sources: [] };
export const paint = (source: MosaicSource): Node => ({ m0: "F", sources: [source] });

/** Resolve a user color field to a concrete color: a cleared / "none" / blank
 *  picker falls back to the default. A bare `props.color ?? fallback` keeps `""`
 *  (not nullish), which renders the element in no color — i.e. invisible. Every
 *  Alpine color knob goes through this so clearing the field never blanks a mark. */
export function resolveColor(value: string | undefined | null, fallback: MosaicColor): MosaicColor {
  const v = (value ?? "").trim();
  return v && v.toLowerCase() !== "none" ? (v as MosaicColor) : fallback;
}

// Cap on a single split's cell count — scale weights to a small basis before
// weightedSplit so coprime pixel weights don't expand the DSL to their sum.
// 120 is the per-axis gcd of the modern canvas family (1080/1920/2160/3840…):
// a total of exactly 120 GCD-reduces to a divisor of 120, which is 5-smooth and
// pixel-exact on every family member (handbook composition-arithmetic §2).
const SPLIT_BASIS_CAP = 120;

/** Weighted split along an axis; drops zero/neg-weight bands, collapses singletons. */
export function split(axis: "row" | "col", bands: Band[]): Node {
  const bs = bands.filter((b) => b.weight > 0);
  if (bs.length === 0) return EMPTY;
  // A split whose every cell paints nothing is itself empty — collapse to EMPTY
  // so it doesn't reach weightedSplit as an all-`-` container (NO_SOURCES). This
  // happens when a card has no header and its content lives in an overlay layer.
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

/** Overlay layers as nested overlays: base{l1{l2{…}}}. Sources concat in order. */
export function overlay(layers: Node[]): Node {
  const ls = layers.filter((l) => l.sources.length > 0 || l.m0 !== "-");
  if (ls.length === 0) return EMPTY;
  if (ls.length === 1) return ls[0];
  let m0 = ls[ls.length - 1].m0;
  for (let i = ls.length - 2; i >= 0; i--) m0 = `${ls[i].m0}{${m0}}`;
  return { m0, sources: ls.flatMap((l) => l.sources) };
}

/** Wrap a node in empty margins so it occupies an inset rect of the parent. */
export function insetNode(node: Node, top: number, right: number, bottom: number, left: number, W: number, H: number): Node {
  const mid = colSplit([{ weight: left, node: EMPTY }, { weight: W - left - right, node }, { weight: right, node: EMPTY }]);
  return rowSplit([{ weight: top, node: EMPTY }, { weight: H - top - bottom, node: mid }, { weight: bottom, node: EMPTY }]);
}

// ---------------------------------------------------------------------------
// Text leaves
// ---------------------------------------------------------------------------

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
  const placement: any = { fit: "contain", hAlign, vAlign };
  if (padding) placement.padding = padding;
  return {
    type: "text",
    visual: { backgroundColor: "black@0" },
    layers: [{ content: { kind: "literal", text: text || " " }, style: { fontSize, fontColor: color }, placement }],
  } as MosaicTextSource;
}

// tag + fitEmUnits moved to @m0saic/template-utils (the charts pack needs
// them too); re-exported here so every alpine import keeps working.
export { tag, fitEmUnits };

/** Which template props the header displays — `bindProp` targets for Make's
 *  double-click edit. Every curated alpine template names them `title` /
 *  `subtitle`, so that is the default; pass `false` for a header that shows
 *  derived text (nothing to edit). */
export type AlpineHeaderBinding = { title?: string; subtitle?: string } | false;
const DEFAULT_HEADER_BINDING: AlpineHeaderBinding = { title: "title", subtitle: "subtitle" };

/** Left-aligned title (top) + subtitle (bottom) — the Alpine header signature.
 *  One source, two layers: each layer binds its own prop (Make opens the rect
 *  as a stacked Title / Subtitle form). */
function headerCell(opts: { title?: string; subtitle?: string; titleFont: number; subFont: number; titleColor: MosaicColor; subColor: MosaicColor; binding: AlpineHeaderBinding }): MosaicTextSource {
  const layers: any[] = [];
  if (opts.title) layers.push({ content: { kind: "literal", text: opts.title }, style: { fontSize: opts.titleFont, fontColor: opts.titleColor }, placement: { fit: "contain", hAlign: "left", vAlign: opts.subtitle ? "top" : "middle" } });
  if (opts.subtitle) layers.push({ content: { kind: "literal", text: opts.subtitle }, style: { fontSize: opts.subFont, fontColor: opts.subColor }, placement: { fit: "contain", hAlign: "left", vAlign: opts.title ? "bottom" : "middle" } });
  const src = tag({ type: "text", visual: { backgroundColor: "black@0" }, layers } as MosaicTextSource, "card-header");
  if (!opts.binding) return src;
  const entries: Array<{ propKey: string; layer: number }> = [];
  if (opts.title && opts.binding.title) entries.push({ propKey: opts.binding.title, layer: 0 });
  if (opts.subtitle && opts.binding.subtitle) entries.push({ propKey: opts.binding.subtitle, layer: opts.title ? 1 : 0 });
  if (entries.length === 0) return src;
  return entries.length === 1 ? bindProp(src, entries[0].propKey) : bindProps(src, entries);
}

// ---------------------------------------------------------------------------
// Card chrome
// ---------------------------------------------------------------------------

/** Pixel rect (canvas coordinates). */
export type AlpineRect = { x: number; y: number; w: number; h: number };

export type AlpineCardResult = {
  /** The rect available to the chart body (inside padding, below the header). */
  contentRect: AlpineRect;
  /** Wrap a body node in the card surface + header; returns the root node.
   *  `extraLayers` overlay ON TOP of the content within the card's overlay chain
   *  (for full-canvas absolutely-positioned content). */
  compose: (content: Node, ...extraLayers: Node[]) => Node;
  /** Canvas color behind the card. */
  backgroundColor: MosaicColor;
  /** Layout-contract entries the card chrome contributes (header text-fit).
   *  Templates spread these into their `withLayoutContract` constraints so a
   *  clipping title/subtitle reds the debug wireframe during stress. */
  constraints: Array<{ label: string; textFits: { charWidthEm?: number; padPx?: number } }>;
};

/**
 * Build the Alpine card chrome for a `W×H` canvas. Returns the body's pixel rect
 * plus a `compose(body)` that stacks card surface → (header) → body.
 */
export function alpineCard(opts: {
  theme: AlpineTheme;
  W: number;
  H: number;
  title?: string;
  subtitle?: string;
  /** Outer padding in px. Defaults to ~5.5% of the shorter side. */
  padding?: number;
  /** Corner radius fraction (0..1). Defaults to the theme's. */
  cornerRadius?: number;
  /** Prop keys the header displays (Make inline-edit). Default `title` /
   *  `subtitle`; `false` = the header is not editable. */
  headerBinding?: AlpineHeaderBinding;
}): AlpineCardResult {
  const { theme, W, H } = opts;
  const pad = opts.padding ?? Math.round(Math.min(W, H) * 0.055);
  const cornerRadius = opts.cornerRadius ?? theme.cornerRadius;

  const hasTitle = !!(opts.title && opts.title.trim());
  const hasSubtitle = !!(opts.subtitle && opts.subtitle.trim());
  const hasHeader = hasTitle || hasSubtitle;

  // Width-capped: H-scaled fonts clip long titles at the canvas edge (the
  // header text is plain, hAlign left — it runs off the card). 0.72em/char:
  // titles render ALL-CAPS-ish wide. Script-aware length (textEmUnits):
  // Cyrillic/CJK run wider than a Latin char — a flat .length let a Cyrillic
  // title clip at the card edge. Caps bind only when the string would
  // overflow the inner width — ASCII titles render byte-identical.
  const capW = (px: number, text: string | undefined, slotPx: number, min: number): number =>
    Math.max(min, Math.min(px, Math.floor(slotPx / (Math.max(1, textEmUnits(text ?? "")) * 0.72))));
  const titleFont = capW(Math.max(12, Math.round(H * 0.05)), opts.title, (W - 2 * pad) * 0.96, 12);
  const subFont = capW(Math.max(10, Math.round(H * 0.026)), opts.subtitle, (W - 2 * pad) * 0.96, 10);
  const headerH = hasHeader
    ? Math.round((hasSubtitle ? titleFont * 1.25 + subFont * 1.6 : titleFont * 1.5) + H * 0.018)
    : 0;

  const innerW = W - 2 * pad;
  const innerH = H - 2 * pad;
  const contentRect: AlpineRect = { x: pad, y: pad + headerH, w: innerW, h: innerH - headerH };

  const headerNode: Node = hasHeader
    ? paint(headerCell({
        title: hasTitle ? opts.title : undefined,
        subtitle: hasSubtitle ? opts.subtitle : undefined,
        titleFont, subFont,
        titleColor: theme.title, subColor: theme.subtitle,
        binding: opts.headerBinding ?? DEFAULT_HEADER_BINDING,
      }))
    : EMPTY;

  const cardSurface = paint(makeColorTile(theme.card, {
    effects: {
      rounding: { cornerStyle: "rounded", borderRadius: cornerRadius },
      stroke: { position: "inner", width: 0.002, color: theme.border, alpha: theme.borderAlpha },
    },
  }));

  // `extraLayers` are full-canvas overlay layers composited ON TOP of the
  // content, INSIDE the card's overlay chain (so the chain stays legal:
  // cardSurface{ content{ layer1{ … } } }). Use for absolutely-positioned
  // content (e.g. a donut ring placed on the full-canvas grid) that must NOT go
  // through a scaled child cell.
  const compose = (content: Node, ...extraLayers: Node[]): Node => {
    const stack = hasHeader
      ? rowSplit([{ weight: headerH, node: headerNode }, { weight: contentRect.h, node: content }])
      : content;
    return overlay([cardSurface, insetNode(stack, pad, pad, pad, pad, W, H), ...extraLayers]);
  };

  return {
    contentRect,
    compose,
    backgroundColor: theme.canvas,
    // capW sizes header fonts so text fits by construction; the contract entry
    // turns that from a convention into a guarantee (breaks loudly if capW or
    // the header geometry ever regress).
    constraints: hasHeader ? [{ label: "card-header", textFits: {} }] : [],
  };
}
