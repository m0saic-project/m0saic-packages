/**
 * The `preview: true` render — a "Theme Tokens" sheet showing the active
 * preset's real values: an M mark + wordmark header, a title, the categorical
 * `dataPalette`, and the semantic tokens (accent / positive / negative /
 * surfaces), every swatch labelled with role name + hex.
 *
 * Aspect-adaptive: a **wide** grid (swatches side-by-side) for landscape/square,
 * a **tall** stacked list (each swatch a row) for portrait. The brand M is drawn
 * as a `placeRect` overlay so it is a **perfect square at every resolution**
 * (a split-cell M distorts across aspect ratios).
 *
 * Self-contained node kit — `@m0saic/theming` stays foundational (no dependency
 * on a consumer pack's shared card).
 */
import type { MosaicSource, MosaicColor, MosaicTextSource } from "@m0saic/types";
import { weightedSplit, placeRect } from "@m0saic/dsl-stdlib";
import { makeColorTile, latticeWeights } from "@m0saic/template-utils";
import type { ThemeTokens, ThemeMode } from "./theme-tokens";
import { BRAND_M_GLYPH } from "./brand-m-glyph";

type Node = { m0: string; sources: MosaicSource[] };
type Band = { weight: number; node: Node };
const EMPTY: Node = { m0: "-", sources: [] };
const paint = (s: MosaicSource): Node => ({ m0: "F", sources: [s] });
const tile = (c: MosaicColor): Node => paint(makeColorTile(c));

const SPLIT_CAP = 240;
function split(axis: "row" | "col", bands: Band[]): Node {
  const bs = bands.filter((b) => b.weight > 0);
  if (bs.length === 0) return EMPTY;
  if (bs.length === 1) return bs[0].node;
  const weights = bs.map((b) => Math.max(1, Math.round(b.weight)));
  // Basis on the 5-smooth lattice (latticeWeights, @m0saic/template-utils):
  // over the cap the bands are Hamilton-scaled to EXACTLY the cap (GCD ⇒ a
  // divisor of it); a rough pixel sum under the cap drifts ≤ 1 px onto the
  // nearest smooth basis; a symmetric inset or an item/gutter list is rewritten
  // as the same pattern on a smooth total (every item stays equal to its
  // siblings); smooth, tiny and equal-weight splits keep their basis.
  const m0 = String(weightedSplit(latticeWeights(weights, { cap: SPLIT_CAP }), axis, { claimants: bs.map((b) => b.node.m0) }));
  return { m0, sources: bs.flatMap((b) => b.node.sources) };
}
const rowSplit = (bands: Band[]): Node => split("row", bands);
const colSplit = (bands: Band[]): Node => split("col", bands);

/** base{layer1{layer2…}} — overlay layers, sources concatenated in order. */
function overlay(layers: Node[]): Node {
  const ls = layers.filter((l) => l.sources.length > 0 || l.m0 !== "-");
  if (ls.length === 0) return EMPTY;
  if (ls.length === 1) return ls[0];
  let m0 = ls[ls.length - 1].m0;
  for (let i = ls.length - 2; i >= 0; i--) m0 = `${ls[i].m0}{${m0}}`;
  return { m0, sources: ls.flatMap((l) => l.sources) };
}

type HAlign = "left" | "center" | "right";
type VAlign = "top" | "middle" | "bottom";
function textSrc(s: string, fontSize: number, color: MosaicColor, hAlign: HAlign = "left", vAlign: VAlign = "middle"): MosaicTextSource {
  return {
    type: "text",
    visual: { backgroundColor: "black@0" },
    layers: [{ content: { kind: "literal", text: s || " " }, style: { fontSize, fontColor: color }, placement: { fit: "contain", hAlign, vAlign } as never }],
  } as MosaicTextSource;
}
const text = (s: string, fontSize: number, color: MosaicColor, hAlign: HAlign = "left", vAlign: VAlign = "middle"): Node =>
  paint(textSrc(s, fontSize, color, hAlign, vAlign));

/** A swatch color block — stroked (for dark surfaces that would vanish on the
 *  navy) or solid (vivid data/accent colors). */
function block(color: MosaicColor, t: ThemeTokens, bordered: boolean): Node {
  if (!bordered) return tile(color);
  // A thin hairline outline so a dark surface (esp. Surface App == the bg)
  // shows its bounds. `stroke.width` is a FRACTION of the block's min dim
  // (widthPx ≈ floor(width × min(w,h)), clamped ≥1) — keep it small.
  return paint(makeColorTile(color, { effects: { stroke: { width: 0.012, color: t.textMuted } } as never }));
}

function labelPair(name: string, hex: MosaicColor, t: ThemeTokens, nameFont: number, hexFont: number, hAlign: HAlign, _vAlign: VAlign): Node {
  return rowSplit([
    { weight: 4, node: text(name, nameFont, t.textPrimary, hAlign, "bottom") },
    { weight: 2, node: EMPTY }, // space between the name and the hex
    { weight: 3, node: text(String(hex).toUpperCase(), hexFont, t.textSecondary, hAlign, "top") },
  ]);
}

type Swatch = { name: string; hex: MosaicColor; bordered: boolean };

function collect(t: ThemeTokens): { data: Swatch[]; sem: Swatch[] } {
  const data: Swatch[] = t.dataPalette.slice(0, 6).map((c, i) => ({ name: `Data 0${i + 1}`, hex: c, bordered: false }));
  const sem: Swatch[] = [
    { name: "Accent", hex: t.accent, bordered: false },
    { name: "Positive", hex: t.positive, bordered: false },
    { name: "Negative", hex: t.negative, bordered: false },
    { name: "Surface App", hex: t.surfaceApp, bordered: true },
    { name: "Surface", hex: t.surface, bordered: true },
    { name: "Surface Raised", hex: t.surfaceRaised, bordered: true },
    { name: "Surface Inset", hex: t.surfaceInset, bordered: true },
  ];
  return { data, sem };
}

/** Header lockup drawn as placeRect overlays — the M as an exact SQUARE and the
 *  wordmark beside it — so neither distorts nor collides at any aspect ratio.
 *  `align: "center"` centers the whole M+wordmark lockup (portrait). */
function headerOverlay(t: ThemeTokens, W: number, H: number, marginX: number, y: number, size: number, wordFont: number, align: "left" | "center"): Node {
  const gap = Math.round(size * 0.4);
  const wordW = Math.round(wordFont * 3.4); // "m0saic" measured width, so the lockup centers true
  const lockupW = size + gap + wordW;
  const x = align === "center" ? Math.max(marginX, Math.round((W - lockupW) / 2)) : marginX;
  const glyph = makeColorTile(t.accent, {
    mask: { kind: "inline-mask", localPath: BRAND_M_GLYPH.path, bounds: BRAND_M_GLYPH.bounds },
  }) as MosaicSource;
  const mNode: Node = { m0: String(placeRect({ rootW: W, rootH: H, rectW: size, rectH: size, x, y }).m0), sources: [glyph] };
  const wNode: Node = {
    m0: String(placeRect({ rootW: W, rootH: H, rectW: wordW, rectH: size, x: x + size + gap, y }).m0),
    sources: [textSrc("m0saic", wordFont, t.textPrimary, "left", "middle")],
  };
  return overlay([mNode, wNode]);
}

/** Human-readable preset name for the eyebrow. */
function presetLabel(mode: ThemeMode): string {
  return mode === "high-contrast" ? "High Contrast" : mode === "light" ? "Light" : "Dark";
}

// ── Wide (landscape / square) — swatches side by side ───────────────────────
function wide(t: ThemeTokens, W: number, H: number, mode: ThemeMode): Node {
  const marginX = Math.round(W * 0.045);
  const marginY = Math.round(H * 0.055);
  const hHeader = Math.round(Math.min(W, H) * 0.09);
  const nameFont = Math.max(11, Math.round(H * 0.019));
  const hexFont = Math.max(10, Math.round(H * 0.015));
  const gutter = Math.round(W * 0.012);
  const { data, sem } = collect(t);

  const swatchCol = (s: Swatch, blockW: number): Node =>
    rowSplit([
      { weight: 3, node: labelPair(s.name, s.hex, t, nameFont, hexFont, "left", "top") },
      { weight: 1, node: EMPTY }, // breathing room between the label and the block
      { weight: blockW, node: block(s.hex, t, s.bordered) },
    ]);
  const rowOf = (cells: Node[]): Node => {
    const bands: Band[] = [];
    cells.forEach((c, i) => {
      if (i > 0) bands.push({ weight: gutter, node: EMPTY });
      bands.push({ weight: 100, node: c });
    });
    return colSplit(bands);
  };

  const secFont = Math.round(H * 0.028);
  const stack = rowSplit([
    { weight: hHeader, node: EMPTY }, // header lockup drawn by overlay
    { weight: Math.round(H * 0.03), node: EMPTY },
    { weight: Math.round(H * 0.028), node: text(presetLabel(mode).toUpperCase(), Math.round(H * 0.022), t.eyebrow, "left", "bottom") },
    { weight: Math.round(H * 0.11), node: text("Theme Tokens", Math.round(H * 0.075), t.textPrimary, "left", "middle") },
    { weight: Math.round(H * 0.045), node: EMPTY },
    { weight: Math.round(H * 0.035), node: text("Data · categorical", secFont, t.textPrimary, "left", "middle") },
    { weight: Math.round(H * 0.28), node: rowOf(data.map((s) => swatchCol(s, 5))) },
    { weight: Math.round(H * 0.05), node: EMPTY },
    { weight: Math.round(H * 0.035), node: text("Semantic", secFont, t.textPrimary, "left", "middle") },
    { weight: Math.round(H * 0.2), node: rowOf(sem.map((s) => swatchCol(s, 3))) },
  ]);
  const withMargins = rowSplit([
    { weight: marginY, node: EMPTY },
    { weight: H - 2 * marginY, node: colSplit([{ weight: marginX, node: EMPTY }, { weight: W - 2 * marginX, node: stack }, { weight: marginX, node: EMPTY }]) },
    { weight: marginY, node: EMPTY },
  ]);
  return overlay([withMargins, headerOverlay(t, W, H, marginX, marginY, hHeader, Math.round(H * 0.03), "left")]);
}

// ── Tall (portrait) — swatches stacked as list rows ─────────────────────────
function tall(t: ThemeTokens, W: number, H: number, mode: ThemeMode): Node {
  const marginX = Math.round(W * 0.06);
  const marginY = Math.round(H * 0.04);
  const hHeader = Math.round(Math.min(W, H) * 0.11);
  const nameFont = Math.max(12, Math.round(W * 0.032));
  const hexFont = Math.max(10, Math.round(W * 0.026));
  const gutter = Math.round(H * 0.008);
  const { data, sem } = collect(t);

  // Each swatch = a row: color block (left) + name/hex (right).
  const swatchRow = (s: Swatch): Node =>
    colSplit([
      { weight: 3, node: block(s.hex, t, s.bordered) },
      { weight: 1, node: EMPTY },
      { weight: 7, node: labelPair(s.name, s.hex, t, nameFont, hexFont, "left", "middle") },
    ]);
  const listOf = (cells: Node[]): Node => {
    const bands: Band[] = [];
    cells.forEach((c, i) => {
      if (i > 0) bands.push({ weight: gutter, node: EMPTY });
      bands.push({ weight: 100, node: c });
    });
    return rowSplit(bands);
  };

  const secFont = Math.round(W * 0.04);
  const stack = rowSplit([
    { weight: hHeader, node: EMPTY }, // header lockup drawn by overlay
    { weight: Math.round(H * 0.018), node: EMPTY },
    { weight: Math.round(H * 0.024), node: text(presetLabel(mode).toUpperCase(), Math.round(W * 0.03), t.eyebrow, "center", "bottom") },
    { weight: Math.round(H * 0.07), node: text("Theme Tokens", Math.round(W * 0.09), t.textPrimary, "center", "middle") },
    { weight: Math.round(H * 0.03), node: EMPTY },
    { weight: Math.round(H * 0.03), node: text("Data · categorical", secFont, t.textPrimary, "left", "middle") },
    { weight: Math.round(H * 0.32), node: listOf(data.map(swatchRow)) },
    { weight: Math.round(H * 0.03), node: EMPTY },
    { weight: Math.round(H * 0.03), node: text("Semantic", secFont, t.textPrimary, "left", "middle") },
    { weight: Math.round(H * 0.37), node: listOf(sem.map(swatchRow)) },
  ]);
  const withMargins = rowSplit([
    { weight: marginY, node: EMPTY },
    { weight: H - 2 * marginY, node: colSplit([{ weight: marginX, node: EMPTY }, { weight: W - 2 * marginX, node: stack }, { weight: marginX, node: EMPTY }]) },
    { weight: marginY, node: EMPTY },
  ]);
  return overlay([withMargins, headerOverlay(t, W, H, marginX, marginY, hHeader, Math.round(W * 0.05), "center")]);
}

/** Build the Theme-Tokens sheet node for a `W×H` canvas (aspect-adaptive). */
export function buildTokenSheet(t: ThemeTokens, W: number, H: number, mode: ThemeMode): Node {
  return H > W * 1.1 ? tall(t, W, H, mode) : wide(t, W, H, mode);
}
