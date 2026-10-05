import { asTemplateId } from "@m0saic/types";
/**
 * ============================================================================
 * @m0saic/alpine/treemap/v3 — Alpine Treemap (RATIO rebuild)
 * ============================================================================
 *
 * Same picture as v1 — a squarified treemap of value-sized rounded tiles filling
 * the Alpine card, each labelled with its name + share — but rebuilt as a RATIO
 * layout instead of absolute full-canvas `placeRects`.
 *
 * The insight: the squarified algorithm is ALREADY a nested structure — it carves
 * a row/column off a shrinking rect and recurses on the remainder. v1 flattened
 * that to a flat rect list packed via `placeRects`, so precision tracked the
 * canvas (audit: ABSOLUTE, slope 1.04). v2 emits the algorithm's natural NESTED
 * `rowSplit`/`colSplit` tree: each split's weights are auto-normalized to a small
 * basis by the alpine `split()` kit, so precision is bounded and it composes at
 * any canvas (audit: RATIO). The inter-tile GAP rides as a per-tile
 * `placement.inset` (zero DSL tokens, axis-even pixels — the heatmap move), and
 * each tile's labels live inside its own cell. borderRadius rounds the tiles
 * (rounded rectangles — no mask needed). Tiles fade in biggest→smallest;
 * reduceMotion → the static map.
 * ============================================================================
 */

import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicSource,
  MosaicTextSource,
  MosaicTemplate,
} from "@m0saic/types";
import {
  definePropsSchema,
  registerTemplate,
  makeColorTile,
  makeIncompleteMosaic,
  fadeInExpr,
  withLayoutContract,
  textEmUnits,
  bindPropPath,
  type EaseName,
  type ThemeSourceConfig,
} from "@m0saic/template-utils";

import {
  alpineCard,
  EMPTY,
  paint,
  rowSplit,
  colSplit,
  overlay,
  textCell,
  tag,
  fitEmUnits,
  resolveColor,
  type Node,
  type Band,
} from "../../_shared/alpine-card";
import { resolveAlpineTheme, ALPINE_PALETTE, type AlpinePreset } from "../../_shared/alpine-theme";
import { revealGate } from "../../_shared/alpine-anim";
import { bBool, bStr, bFrac, bEnum, ALPINE_ANIM_FIELDS_BARE, ALPINE_ANIM_UNBOUND, ALPINE_THEME_UNBOUND, bindHeaderAddHandles, withAddHandles, bindCardSurface } from "../../_shared/alpine-conventions";
import {
  buildBrandedCover,
  brandedCoverHeroBox,
  inlineHeroDoc,
  onboardingFrame,
} from "../../../_shared/onboarding-cover";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type TreeItem = { label: string; value: number; color?: MosaicColor };
type ValueMode = "percent" | "value" | "none";
/** Reveal cost/quality dial. "premium" (default): tiles + text fade in (a geq each).
 *  "light": the same cascade via free enable-gate pops — no geq, composable. */
type RenderMode = "premium" | "light";
type AnimConfig = { renderMode: RenderMode; reduceMotion: boolean; introFrac: number; easing: EaseName };

type AlpineTreemapV3Props = {
  items: TreeItem[];
  title?: string;
  subtitle?: string;
  valueMode?: ValueMode;
  preset?: AlpinePreset;
  showValue?: boolean;
  tiles?: { cornerRadius?: number };
  anim?: AnimConfig;
  /** Opt-in producer theming. The preset is the fallback; a producer's published
   *  tokens override it. Explicit color props still win. */
  theme?: ThemeSourceConfig;
  /** Dev-only layout contract: assert tile text fits its slot. */
  debugLayout?: boolean;
};

const DEFAULT_PRESET: AlpinePreset = "light";
const DEFAULT_RENDER_MODE: RenderMode = "premium";
const DEFAULT_ANIM: AnimConfig = { renderMode: DEFAULT_RENDER_MODE, introFrac: 0.7, easing: "easeOut", reduceMotion: false };
const DEFAULT_VALUE_MODE: ValueMode = "percent";
const MAX_ITEMS = 12;

// ---------------------------------------------------------------------------
// Color / format helpers
// ---------------------------------------------------------------------------

function luminance(hex: MosaicColor): number {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex));
  if (!m) return 0;
  const v = parseInt(m[1], 16);
  return (0.2126 * ((v >> 16) & 0xff) + 0.7152 * ((v >> 8) & 0xff) + 0.0722 * (v & 0xff)) / 255;
}
function onColor(hex: MosaicColor, light: MosaicColor, dark: MosaicColor): MosaicColor {
  return luminance(hex) > 0.62 ? dark : light;
}
function compactNum(v: number): string {
  const n = Math.round(v);
  const abs = Math.abs(n);
  const fmt = (x: number, suf: string) => `${x.toFixed(1).replace(/\.0$/, "")}${suf}`;
  if (abs < 1000) return String(n);
  if (abs < 1e6) return fmt(n / 1e3, "K");
  if (abs < 1e9) return fmt(n / 1e6, "M");
  return fmt(n / 1e9, "B");
}
/** Script-aware single-line clip (fitEmUnits at the pack's 0.62em model) —
 *  flat chars under-cut wide scripts ~1.5× and still clipped. */
function truncateToWidth(text: string, font: number, maxW: number): string {
  return fitEmUnits(text, Math.max(1, maxW / (font * 0.62)));
}

// ---------------------------------------------------------------------------
// Squarified treemap → NESTED SPLITS (the algorithm's natural structure)
// ---------------------------------------------------------------------------

type TileInfo = { origIdx: number; rank: number; area: number };
type PxRect = { w: number; h: number };

/** Worst (largest) aspect ratio of a row of areas laid along a side of length `side`. */
function worstRatio(areas: number[], side: number): number {
  if (areas.length === 0) return Infinity;
  const s = areas.reduce((a, b) => a + b, 0);
  const rmax = Math.max(...areas), rmin = Math.min(...areas);
  return Math.max((side * side * rmax) / (s * s), (s * s) / (side * side * rmin));
}

/**
 * Build a Node for `tiles` filling a `w×h` rect, via squarified nested splits.
 * `mk(tile, pxW, pxH)` renders one tile Node given its pixel footprint.
 */
function squarifyNode(tiles: TileInfo[], rect: PxRect, mk: (t: TileInfo, px: PxRect) => Node): Node {
  if (tiles.length === 0) return EMPTY;
  if (tiles.length === 1) return mk(tiles[0], { w: rect.w, h: rect.h });

  // Greedily accumulate the first row while it keeps aspect ratios improving.
  const side = Math.min(rect.w, rect.h);
  let split = 1;
  while (
    split < tiles.length &&
    worstRatio(tiles.slice(0, split + 1).map((t) => t.area), side) <= worstRatio(tiles.slice(0, split).map((t) => t.area), side)
  ) {
    split++;
  }
  const row = tiles.slice(0, split);
  const rest = tiles.slice(split);
  const rowSum = row.reduce((a, t) => a + t.area, 0);
  const horizontal = rect.w >= rect.h; // carve a COLUMN down the left edge

  // Weights are PX/4 along the split axis (px-per-weight ≥4 law) — raw px²
  // areas rescale to a 120 basis even inside a ~40px strip (0.3px cells →
  // SPLIT_EXCEEDS_AXIS at small canvases; max12@360×640 refused to render).
  const q4 = (v: number) => Math.max(1, Math.round(v / 4));
  if (horizontal) {
    const rw = rest.length ? rowSum / rect.h : rect.w; // last group fills the width
    const colNode = rowSplit(row.map((t): Band => ({ weight: q4((t.area / rowSum) * rect.h), node: mk(t, { w: rw, h: (t.area / rowSum) * rect.h }) })));
    if (!rest.length) return colNode;
    return colSplit([
      { weight: q4(rw), node: colNode },
      { weight: q4(rect.w - rw), node: squarifyNode(rest, { w: rect.w - rw, h: rect.h }, mk) },
    ]);
  } else {
    const rh = rest.length ? rowSum / rect.w : rect.h; // last group fills the height
    const rowNode = colSplit(row.map((t): Band => ({ weight: q4((t.area / rowSum) * rect.w), node: mk(t, { w: (t.area / rowSum) * rect.w, h: rh }) })));
    if (!rest.length) return rowNode;
    return rowSplit([
      { weight: q4(rh), node: rowNode },
      { weight: q4(rect.h - rh), node: squarifyNode(rest, { w: rect.w, h: rect.h - rh }, mk) },
    ]);
  }
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const propsSchema = definePropsSchema<AlpineTreemapV3Props>({
  items: { type: "array" as any, required: true, meta: { control: { flavor: "objectRows", columns: [{ label: "Label", key: "label", kind: "text", placeholder: "Segment" }, { label: "Value", key: "value", kind: "number" }, { label: "Color", key: "color", kind: "color" }] } } },
  title: { type: "string", required: false },
  subtitle: { type: "string", required: false },
  valueMode: { type: "string", required: false, meta: { constraints: { oneOf: ["percent", "value", "none"] } } },
  preset: { type: "string", required: false, meta: { constraints: { oneOf: ["light", "dark"] } } },
  showValue: { type: "boolean", required: false },
  tiles: {
    type: "group" as any, required: false,
    fields: { cornerRadius: bFrac() },
  } as any,
  anim: {
    type: "group" as any, required: false,
    fields: {
      renderMode: bEnum(["premium", "light"]),
      reduceMotion: ALPINE_ANIM_FIELDS_BARE.reduceMotion,
      introFrac: ALPINE_ANIM_FIELDS_BARE.introFrac,
      easing: ALPINE_ANIM_FIELDS_BARE.easing,
    },
  } as any,
  theme: {
    type: "group" as any, required: false,
    fields: { slug: bStr(), preset: bStr(), namespace: bStr(), forceFetch: bBool() },
  } as any,
  debugLayout: { type: "boolean", required: false },
});

export const AlpineTreemapV3: MosaicTemplate<AlpineTreemapV3Props> = {
  id: asTemplateId("@m0saic/alpine/treemap/v3"),
  version: 3,
  capabilities: { tier: "core" },
  outputHints: { format: { kind: "video", container: "mp4" }, width: 1280, height: 800, fps: 30, durationMs: 2000, posterTimeMs: 1900 },
  bindings: { unbound: { ...ALPINE_THEME_UNBOUND, ...ALPINE_ANIM_UNBOUND } },
  propsSchema,

  defaultProps: {
    debugLayout: false,
    theme: { forceFetch: false },
    items: [
      { label: "Engineering", value: 42 },
      { label: "Sales", value: 26 },
      { label: "Marketing", value: 16 },
      { label: "Support", value: 9 },
      { label: "Design", value: 7 },
    ],
    title: "HEADCOUNT",
    subtitle: "By department",
    preset: DEFAULT_PRESET,
    valueMode: DEFAULT_VALUE_MODE,
    tiles: { cornerRadius: 0.06 },
    showValue: true,
    anim: DEFAULT_ANIM,
  },

  async render(props: AlpineTreemapV3Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const W = Math.max(1, Math.round(ctx.target.width));
    const H = Math.max(1, Math.round(ctx.target.height));

    // Keep each drawn item's ORIGINAL index into props.items: the leaf bindings
    // (Make's double-click edit of items[i].label / value) must address the prop
    // value, not the culled / truncated / size-sorted draw order.
    const rawEntries = (props.items ?? [])
      .map((it, srcIndex) => ({ it, srcIndex }))
      .filter(({ it }) => it && typeof it.label === "string" && Number.isFinite(it.value) && it.value > 0)
      .slice(0, MAX_ITEMS);
    const raw = rawEntries.map((e) => e.it);
    if (raw.length === 0) {
      return makeIncompleteMosaic("Add an item — a label and a value above zero.", { title: "Treemap", width: W, height: H });
    }

    const theme = await resolveAlpineTheme(props.preset ?? DEFAULT_PRESET, ctx, props.theme);
    const anim: AnimConfig = { ...DEFAULT_ANIM, ...(props.anim ?? {}) };
    const animate = !anim.reduceMotion;
    const light = (anim.renderMode ?? DEFAULT_RENDER_MODE) === "light";
    const revealOv = (s: number, dur: number): Record<string, unknown> => light ? { startAtSec: s, enable: `gte(t,${s.toFixed(3)})` } : { startAtSec: s, alpha: fadeInExpr(s, dur) };
    const ffText = <T extends MosaicSource>(src: T, s: number, dur: number): T => !animate ? src : light ? revealGate(src, s) : ({ ...src, overlay: { ...((src as { overlay?: Record<string, unknown> }).overlay ?? {}), alpha: fadeInExpr(s, dur) } } as T);
    const showValue = props.showValue ?? true;
    const valueMode: ValueMode = props.valueMode ?? DEFAULT_VALUE_MODE;
    const cornerRadius = Math.max(0, Math.min(0.5, props.tiles?.cornerRadius ?? 0.06));

    // Sort biggest→smallest (squarify expects descending); keep the original index
    // so per-item color overrides + palette cycling track the input order.
    const order = raw.map((_, i) => i).sort((a, b) => raw[b].value - raw[a].value);
    const total = raw.reduce((s, it) => s + it.value, 0);
    const tileColor = (origIdx: number): MosaicColor => resolveColor(raw[origIdx].color, ALPINE_PALETTE[origIdx % ALPINE_PALETTE.length]);

    const card = alpineCard({ theme, W, H, title: props.title, subtitle: props.subtitle });
    const cr = card.contentRect;

    const gap = Math.max(2, Math.round(Math.min(cr.w, cr.h) * 0.012));
    const baseNameFont = Math.max(12, Math.round(H * 0.028));
    const baseValFont = Math.max(10, Math.round(H * 0.022));
    const minNameFont = Math.max(10, Math.round(H * 0.018));

    const clipSec = Math.max(0.1, (ctx.target.durationMs ?? 2000) / 1000);
    const introT = Math.max(0.1, Math.min(1, anim.introFrac) * clipSec);
    const fadeDur = Math.max(0.08, introT * 0.45);
    const N = order.length;
    const startAt = (rank: number) => (animate ? (introT - fadeDur) * (N > 1 ? rank / (N - 1) : 0) : 0);

    // One tile: a rounded color cell with the gap as a per-tile inset (axis-even px),
    // plus its name/value labels in the top-left of the cell.
    const mkTile = (t: TileInfo, px: PxRect): Node => {
      const fill = tileColor(t.origIdx);
      const s = startAt(t.rank);
      // Leaf binding into the `items` prop at the item's ORIGINAL index
      // (t.origIdx indexes the culled `raw` list; its entry remembers the prop index).
      const bindItem = <T extends MosaicSource>(src: T, field: string, kind: "string" | "number"): T =>
        bindPropPath(src, "items", [rawEntries[t.origIdx].srcIndex, field], kind);
      // Gap as a placement.inset — half-gap per side, in cell-relative fractions so
      // the pixel gap is even on both axes (zero DSL tokens, the heatmap move).
      const insetX = Math.min(0.45, gap / 2 / Math.max(1, px.w));
      const insetY = Math.min(0.45, gap / 2 / Math.max(1, px.h));
      // The tile's AREA is the value — one surface per item — so it binds items[i].value.
      // v3: …and it also shows the item's own colour (a handle to set one) and
      // the rounding every tile shares.
      const tileBg = withAddHandles(bindItem(tag(makeColorTile(fill, {
        effects: { rounding: { cornerStyle: "rounded", borderRadius: cornerRadius } },
        placement: { inset: { top: insetY, right: insetX, bottom: insetY, left: insetX } } as any,
        ...(animate ? { overlay: revealOv(s, fadeDur) } : {}),
      }) as MosaicSource, "tile"), "value", "number"), [
        { propKey: "items", path: [rawEntries[t.origIdx].srcIndex, "color"], kind: "color" },
        { propKey: "tiles.cornerRadius" },
      ]);

      // The visible (post-inset) tile footprint, for label sizing.
      const tw = px.w - gap, th = px.h - gap;
      const pad = Math.max(2, Math.round(Math.min(tw, th) * 0.1));
      const innerW = tw - pad * 2;
      const nameLen = Math.max(1, textEmUnits(raw[t.origIdx].label));
      const nameFont = Math.max(minNameFont, Math.min(baseNameFont, Math.floor(innerW / (nameLen * 0.62))));
      const valFont = Math.max(8, Math.round(nameFont * (baseValFont / baseNameFont)));
      const txtColor = onColor(fill, "#FFFFFF", theme.title);
      const subColor = onColor(fill, "#FFFFFF", theme.subtitle);
      const wantValue = showValue && valueMode !== "none";
      const fitsName = innerW >= nameFont * 2 && th >= nameFont * 1.9;
      const fitsValue = wantValue && th >= pad * 2 + nameFont * 1.7 + valFont * 1.2;

      if (!fitsName) return paint(tileBg);

      const name = truncateToWidth(raw[t.origIdx].label, nameFont, innerW);
      const padFracL = pad / Math.max(1, px.w);
      // `bind` = the items[i] leaf this text SHOWS (name → label; a raw value → value).
      const mkText = (text: string, font: number, color: MosaicColor, sd: number, kind: string, bind?: readonly [string, "string" | "number"]): Node => {
        const src = ffText(tag(textCell(text, font, color, "left", "middle", { left: padFracL }) as MosaicTextSource, kind), s + sd, fadeDur);
        return paint(bind ? bindItem(src, bind[0], bind[1]) : src);
      };

      // Label stack in the top of the cell: [padTop · name · (gap · value)? · rest].
      // Weights are PX/4 (px-per-weight ≥4 law), NOT a forced 100 basis — a
      // 100-unit split inside a ~30px tile is sub-pixel, and the engine folds
      // those cells away (paint-slot/sources count mismatch → doc refused;
      // 20/84 baseline battery canvases failed exactly here).
      const q4 = (v: number) => Math.max(1, Math.round(v / 4));
      const padTop = pad, nameH = Math.round(nameFont * 1.5);
      const gapH = Math.round(nameFont * 0.35), valH = Math.round(valFont * 1.4);
      const bands: Band[] = [{ weight: q4(padTop), node: EMPTY }];
      bands.push({ weight: q4(nameH), node: mkText(name, nameFont, txtColor, fadeDur * 0.3, "tile-name", ["label", "string"]) });
      let usedPx = padTop + nameH;
      if (fitsValue) {
        const vText = valueMode === "percent" ? `${Math.round((raw[t.origIdx].value / total) * 100)}%` : compactNum(raw[t.origIdx].value);
        bands.push({ weight: q4(gapH), node: EMPTY });
        // A percent share is value/total — it merges every item's value, so it
        // stays unbound; the raw compact value is a formatting of the one leaf.
        bands.push({ weight: q4(valH), node: mkText(vText, valFont, subColor, fadeDur * 0.4, "tile-value", valueMode === "value" ? ["value", "number"] : undefined) });
        usedPx += gapH + valH;
      }
      if (usedPx < px.h - 4) bands.push({ weight: q4(px.h - usedPx), node: EMPTY });
      return overlay([paint(tileBg), rowSplit(bands)]);
    };

    // Areas scaled to the content rect's PIXEL area — squarify's aspect-ratio + strip
    // math (rw = area/height) needs px², not fractions.
    const areaPx = Math.max(1, cr.w * cr.h);
    const tileInfos: TileInfo[] = order.map((oi, rank) => ({ origIdx: oi, rank, area: (raw[oi].value / total) * areaPx }));
    const body = squarifyNode(tileInfos, { w: cr.w, h: cr.h }, mkTile);

    const root = card.compose(body);
    // v3: a header that is missing (or half there) can be added from the canvas.
    bindHeaderAddHandles(root.sources as MosaicSource[], props, ["tile-name", "tile"]);

    const doc = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as any,
      m0: root.m0 as any,
      // The card surface is a handle for `preset` (bindCardSurface) — a full-canvas
      // card that nothing binds is a dead click target (founder, 2026-10-01).
      sources: bindCardSurface(root.sources),
      backgroundColor: card.backgroundColor,
      fps: ctx.target.fps,
      durationMs: ctx.target.durationMs,
    } as MosaicDocument;

    // Dev tripwire: every painted tile label FITS its slot at the CLI's
    // metrics (the tile sizes themselves are value-proportional by
    // construction — no equal relation applies; an area-proportionality rule
    // is a future contract primitive). No expr text → full coverage. Falsy
    // debugLayout (default) returns the doc untouched at zero cost.
    // hasNames/hasValues: tiny tiles legitimately DROP their labels
    // (fitsName/fitsValue gates) — an unmatched label is a violation.
    const hasNames = doc.sources.some((x) => (x as { editor?: { label?: string } }).editor?.label === "tile-name");
    const hasValues = doc.sources.some((x) => (x as { editor?: { label?: string } }).editor?.label === "tile-value");
    return Promise.resolve(
      withLayoutContract(doc, ctx, {
        templateId: "@m0saic/alpine/treemap/v3",
        constraints: [
          ...card.constraints,
          ...(hasNames ? [{ label: "tile-name", textFits: { charWidthEm: 0.62 } }] : []),
          ...(hasValues ? [{ label: "tile-value", textFits: { charWidthEm: 0.62 } }] : []),
        ],
        debug: props.debugLayout === true,
      }),
    );
  },

  // Editor-only first-open cover — the mosaic-branding theme; hero = the
  // template's own static default render, INLINED flat (gate-15/21 keeper).
  async renderCover(_props: AlpineTreemapV3Props, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    const heroBox = brandedCoverHeroBox(ctx, "band");
    const heroCtx = {
      ...ctx,
      target: { ...ctx.target, width: heroBox.width, height: heroBox.height },
      output: { ...ctx.output, width: heroBox.width, height: heroBox.height },
    } as MosaicEngineContext;
    const hero = (await AlpineTreemapV3.render(
      {
        ...(AlpineTreemapV3.defaultProps as AlpineTreemapV3Props),
        anim: { ...DEFAULT_ANIM, reduceMotion: true },
      },
      heroCtx,
    )) as MosaicDocument;

    return buildBrandedCover({
      ctx,
      // Band variant (founder ruling 08-30): basic viz needs no
      // explanation — hero full-bleed + brand band, nothing else.
      variant: "band",
      copy: {
        productName: "Treemap",
        title: "A treemap.",
      },
      hero: (theme) => onboardingFrame(inlineHeroDoc(hero), theme.borderStrong),
      heroAssets: hero.assets,
      children: (hero as { children?: Record<string, MosaicDocument> }).children,
    });
  },
};

registerTemplate(AlpineTreemapV3);
