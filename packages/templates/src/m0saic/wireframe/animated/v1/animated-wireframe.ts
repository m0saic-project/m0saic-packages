import { asTemplateId } from "@m0saic/types";
import type { M0String } from "@m0saic/dsl";
import type {
  MosaicEngineContext,
  MosaicDocument,
  MosaicRenderableFile,
  MosaicSource,
  MosaicTemplate,
  MosaicColor,
} from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  definePropsSchema,
  registerTemplate,
  renderNestedTemplate,
  parseMosaicFrames,
  solidBackground,
  textEmUnits,
} from "@m0saic/template-utils";
import type { WireframeCellSchemaProps, WireframeCellTheme } from "../../utils/wireframeCell";
import type { WireframeTheme, WireframePreset } from "../../base/v1/wireframe";
import { resolveTheme } from "../../base/v1/wireframe";
import type { WireframeBackgroundValue, WireframeUnlabeledCellsValue } from "../../base/v2/wireframe";
import { appendTopOverlay, makePaperGridSource } from "../../utils/paperGrid";

/**
 * Animated Wireframe — the wireframe family's video baseline: every cell of
 * an m0 layout slides into place in document order, so a layout's structure
 * reads as a sequence instead of a still.
 *
 * Architecture: one nested `@m0saic/wireframe/cell/v1` document per cell
 * (drawtext labels), each bound to its m0 leaf with `overlay.startAtSec` +
 * `overlay.enable` for the reveal and a `yExpr` slide. The nested-cell path
 * costs one ffmpeg spawn per cell (100 cells ≈ 24s at 1080p) — fine for the
 * docs / explainer clips this is for; a single-pass port onto base/v2's
 * glyph-outline tiles is the v2 of this template if that ever matters.
 *
 * Gate 30 (v1 prod cut) findings fixed here:
 *  - cell labels printed the PRE-header geometry (960×540 for a 2×2 at
 *    1080p while the engine rendered 960×486 under the header band) — the
 *    frames now come from the WRAPPED string, so the dims are what renders;
 *  - the header was a fixed 26px drawtext that clipped long m0 strings and
 *    vanished at 4K — it now sizes to the band and shrinks / middle-ellipsizes
 *    to the canvas width under the CLI width model;
 *  - custom labels and the dims/ratio marks never fit-checked (a long label
 *    clipped at the cell edge; a narrow tall cell clipped its `W×H`) — both
 *    now shrink to the cell and the marks degrade (ratio → dims → number);
 *  - the `grid-paper` preset resolved a lattice nothing drew (base/v2's
 *    gate-29 finding, same resolver) — wired via the shared paperGrid util;
 *  - no `format` / `audio` stamps, no `background` knob (canvas fell to the
 *    engine's black), and `labels` blanked every unlabeled cell — all aligned
 *    with base/v2's shipped defaults (white canvas, unlabeled cells keep
 *    their marks, explicit debug defaults, a real 2×2 default layout).
 */

type AnimatedWireframeSchemaProps = {
  M0String: M0String;
  labels?: string[];

  /**
   * Padding in seconds at the start and end so the reveal is contained within duration.
   * Same value for both; trail is at least 0.3s so the final cell's slide animation completes.
   * Decimal allowed. Default: 0.35.
   * Total duration comes from ctx.target.durationMs (set by CLI/desktop).
   */
  paddingSec?: number;
  /** Hide the header band that prints the m0 string above the layout. */
  disableUi?: boolean;
  /** "debug" (default) renders numbers/dims/AR. "thumb" renders clean tiles. */
  mode?: "debug" | "thumb";
  /** Named theme preset. */
  preset?: WireframePreset | "none"; // "none" = mode-driven (the visible unset state)
  /** Theme overrides applied on top of preset defaults. */
  theme?: WireframeTheme;
  /** Canvas backing in debug mode: white (default) or the engine's default (black / alpha). */
  background?: WireframeBackgroundValue;
  /** What an unlabeled cell shows once some cells carry custom labels. */
  unlabeledCells?: WireframeUnlabeledCellsValue;
};

// Default layout: the same basic 2×2 grid base/v2 opens on (founder ruling,
// gate 29 take 3 — a dev template gets no cover; the default face is a real
// layout, not a bare cell).
const DEFAULT_LAYOUT = "2(2[1,1],2[1,1])";
const DEFAULT_BACKGROUND: WireframeBackgroundValue = "white";
const DEFAULT_UNLABELED_CELLS: WireframeUnlabeledCellsValue = "marks";
const DEFAULT_PADDING_SEC = 0.35;
// The slide-in tween length; the trail padding is never shorter than this
// so the last cell settles before the clip ends.
const OVERLAY_SLIDE_MS = 300;

// ── Header band (the `m0: …` strip above the layout) ──
// One row of a 10-row stack; the passthroughs donate the other nine rows to
// the layout (`10[F,>,…,>,LAYOUT]`), so the band is exactly 1/10 of the canvas.
const HEADER_ROWS = 10;
const HEADER_FONT_FRAC = 0.36; // of the band height
const HEADER_FONT_MIN = 12;
const HEADER_FONT_MAX = 48;
const HEADER_PAD_FRAC = 0.02; // of the canvas width, each side
const HEADER_FONT_FAMILY = "Arial, sans-serif";

// ── CLI width model ──
// The cells and the header draw with ffmpeg drawtext (whatever face fontconfig
// resolves for the family), not the bundled glyph font, so widths are modelled
// rather than measured: script-aware em-units × fontSize × this factor — the
// conservative CLI figure the pack-wide `textFits` contract uses (Latin runs
// measure ~0.5–0.65em on the real face, so a fit here never clips there).
const CLI_EM = 0.72;

// ── Cell text (mirrors utils/wireframeCell.ts so the fit math predicts the
// nested cell's real font sizes) ──
const CELL_TEXT_FRAC = 0.18; // textSize = min side × this, clamped
const CELL_TEXT_MAX = 96;
const CELL_OVERLAY_SCALE = 0.75; // overlay font = textSize × this
const CELL_DIM_SCALE = 1.25; // first line = overlay font × this
const CELL_AR_SCALE = 0.85; // further lines = overlay font × this
const CELL_LINE_SPACING = 1.45; // mirrors utils/wireframeCell.ts LINE_SPACING
const CELL_INDEX_SCALE = 0.9; // index font = textSize × this
const CELL_INDEX_PAD = 0.03; // of the cell's width / height
const CELL_PAD_FRAC = 0.04; // horizontal text padding, of the min side
const MIN_LEGIBLE_PX = 9;

function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Per-character em width of ordinary label text on the CLI face, by glyph
 * class. The flat 0.72 figure is the CAPITALS figure; lowercase runs measure
 * ~0.5em (Helvetica) to ~0.6em (DejaVu Sans), digits .556/.636, spaces and
 * punctuation ~.28–.39. Modelling by class keeps a long lowercase label whole
 * where the flat model cut it to an ellipsis; every class stays above both
 * fallback faces so a fit here never clips there. Wide scripts keep the
 * measured `textEmUnits` ratios (Cyrillic ~.96em, CJK ~.99em).
 */
function charEm(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp > 0x7f) return textEmUnits(ch) * CLI_EM;
  if (ch >= "a" && ch <= "z") return 0.62;
  if (ch >= "A" && ch <= "Z") return 0.75;
  if (ch >= "0" && ch <= "9") return 0.66;
  if (/[\s,.;:'"`()[\]{}|!\-]/.test(ch)) return 0.4;
  return CLI_EM;
}

/** Em width of a label line under {@link charEm}. */
export function textEm(text: string): number {
  let em = 0;
  for (const ch of text) em += charEm(ch);
  return em;
}

/**
 * Per-character em width of the header's m0 alphabet. The generic CLI model
 * (`textEmUnits` × CLI_EM) treats a comma like a capital; an m0 string is
 * ~45% commas / brackets / parens, so that model over-measures it ~1.7× and
 * ellipsizes strings that fit with room to spare. These figures stay ABOVE
 * both fallback faces the CLI resolves for the family (Helvetica: comma .278,
 * paren .333, bracket .278; DejaVu Sans: comma .318, paren .39, bracket .39,
 * digit .636, `>` .838, brace .635), so a fit here never clips there.
 */
function m0CharEm(ch: string): number {
  if (ch === ">") return 0.85;
  if (ch === "{" || ch === "}") return 0.65;
  if (/[,()[\]\-: ]/.test(ch)) return 0.42;
  return charEm(ch);
}

/** Em width of an m0 header line under {@link m0CharEm}. */
export function m0TextEm(text: string): number {
  let em = 0;
  for (const ch of text) em += m0CharEm(ch);
  return em;
}

/**
 * Middle-ellipsize to at most `maxEm` ems under `emOf`, keeping the head and
 * the tail — an m0 string's shape is its opening and closing structure, so
 * the ends carry more than a truncated head would.
 */
export function middleEllipsize(text: string, maxEm: number, emOf: (ch: string) => number = m0CharEm): string {
  const emOfText = (t: string) => Array.from(t).reduce((a, ch) => a + emOf(ch), 0);
  if (emOfText(text) <= maxEm) return text;
  const budget = Math.max(0, maxEm - emOf("…"));
  const chars = Array.from(text);
  const headMax = budget / 2;
  const tailMax = budget - headMax;
  let head = "";
  let used = 0;
  for (const ch of chars) {
    const u = emOf(ch);
    if (used + u > headMax) break;
    head += ch;
    used += u;
  }
  let tail = "";
  used = 0;
  for (let i = chars.length - 1; i >= 0; i--) {
    const u = emOf(chars[i]);
    if (used + u > tailMax) break;
    tail = chars[i] + tail;
    used += u;
  }
  return `${head}…${tail}`;
}

/**
 * Header text sized to the band and fitted to the canvas width: font = 36% of
 * the band height (12–48px), shrunk to fit; below the floor the m0 string is
 * middle-ellipsized so the strip never clips.
 */
export function fitHeader(m0: string, canvasW: number, bandH: number): { text: string; fontSize: number } {
  const availW = Math.max(1, canvasW * (1 - 2 * HEADER_PAD_FRAC));
  let fontSize = clamp(Math.round(bandH * HEADER_FONT_FRAC), HEADER_FONT_MIN, HEADER_FONT_MAX);
  const prefix = "m0: ";
  const fullEm = m0TextEm(prefix) + m0TextEm(m0);
  if (fullEm * fontSize > availW) fontSize = Math.max(HEADER_FONT_MIN, Math.floor(availW / fullEm));
  const maxEm = availW / fontSize;
  const body = fullEm > maxEm ? middleEllipsize(m0, Math.max(0.5, maxEm - m0TextEm(prefix))) : m0;
  return { text: `${prefix}${body}`, fontSize };
}

/** The nested cell's real font sizes for a given `textSize` (its math, verbatim). */
function cellFonts(textSize: number): { index: number; dim: number; ar: number } {
  const overlay = Math.round(textSize * CELL_OVERLAY_SCALE);
  return {
    index: Math.round(textSize * CELL_INDEX_SCALE),
    dim: Math.round(overlay * CELL_DIM_SCALE),
    ar: Math.round(overlay * CELL_AR_SCALE),
  };
}

/** The lines the debug marks want, richest last: `W × H`, then `16:9 · 1.78`. */
function markLines(cellW: number, cellH: number): string[] {
  const g = gcd(cellW, cellH);
  const ratio = parseFloat((cellW / cellH).toFixed(2)).toString();
  return [`${cellW} × ${cellH}`, `${Math.round(cellW) / g}:${Math.round(cellH) / g} · ${ratio}`];
}

type FittedCell = { text: string; textSize: number; showOrder: boolean };

/**
 * Largest `textSize` (≤ `maxSize`) at which `lines` fit the cell under the
 * nested cell's own layout: every line inside the padded width, the stack
 * (line heights × spacing) below the top-left index. `null` when even the
 * floor doesn't fit.
 */
function fitLines(lines: string[], cellW: number, cellH: number, minSize: number, maxSize: number): number | null {
  if (lines.length === 0) return maxSize;
  const pad = Math.max(4, Math.round(Math.min(cellW, cellH) * CELL_PAD_FRAC));
  const availW = cellW - 2 * pad;
  if (availW <= 0) return null;
  let size = maxSize;
  for (let i = 0; i < lines.length; i++) {
    const scale = CELL_OVERLAY_SCALE * (i === 0 ? CELL_DIM_SCALE : CELL_AR_SCALE);
    const em = textEm(lines[i]);
    if (em <= 0) continue;
    // width = em × (textSize × scale) ≤ availW
    size = Math.min(size, availW / (em * scale));
  }
  const fitsHeight = (ts: number): boolean => {
    const f = cellFonts(ts);
    const stackH = lines.reduce((h, _l, i) => h + (i === 0 ? f.dim : f.ar) * CELL_LINE_SPACING, 0);
    const indexBottom = cellH * CELL_INDEX_PAD + f.index;
    // the stack is centred; it must start below the index and end inside the cell
    return (cellH - stackH) / 2 >= indexBottom && stackH <= cellH;
  };
  size = Math.floor(size);
  while (size >= minSize && !fitsHeight(size)) size -= 1;
  if (size < minSize) return null;
  if (cellFonts(size).ar < MIN_LEGIBLE_PX && lines.length > 1) return null;
  return size;
}

/**
 * Resolve what a cell prints and at what size. A custom label replaces the
 * marks (one centred line, shrunk to fit, ellipsized at the floor); the marks
 * degrade ratio → dims → number-only so a narrow cell never clips.
 */
export function fitCellText(opts: {
  cellW: number;
  cellH: number;
  label: string | undefined;
  minTextSize: number;
}): FittedCell {
  const { cellW, cellH, label, minTextSize } = opts;
  const smaller = Math.min(cellW, cellH);
  const maxSize = clamp(Math.round(smaller * CELL_TEXT_FRAC), minTextSize, CELL_TEXT_MAX);

  if (label != null) {
    const t = label.trim();
    if (!t) return { text: "", textSize: maxSize, showOrder: false };
    const size = fitLines([t], cellW, cellH, minTextSize, maxSize);
    if (size != null) return { text: t, textSize: size, showOrder: false };
    // Floor reached: keep the floor size and cut the label to the width.
    const pad = Math.max(4, Math.round(smaller * CELL_PAD_FRAC));
    const availW = Math.max(1, cellW - 2 * pad);
    const linePx = cellFonts(minTextSize).dim;
    return { text: cutToEm(t, availW / linePx), textSize: minTextSize, showOrder: false };
  }

  const lines = markLines(cellW, cellH);
  for (const candidate of [lines, lines.slice(0, 1), []]) {
    const size = fitLines(candidate, cellW, cellH, minTextSize, maxSize);
    if (size != null) return { text: candidate.join("\n"), textSize: size, showOrder: true };
  }
  return { text: "", textSize: minTextSize, showOrder: true };
}

/** End-ellipsize to `maxEm` ems under {@link charEm} (the ellipsis reserved). */
function cutToEm(text: string, maxEm: number): string {
  if (textEm(text) <= maxEm) return text;
  let out = "";
  let used = charEm("…");
  for (const ch of text) {
    const u = charEm(ch);
    if (used + u > maxEm) break;
    out += ch;
    used += u;
  }
  return `${out}…`;
}

/** Per-cell label decision (base/v2's `cellLabelFor`, verbatim). */
function cellLabelFor(
  labels: readonly string[] | undefined,
  order: number,
  unlabeledCells: WireframeUnlabeledCellsValue,
): string | undefined {
  const custom = labels?.[order - 1];
  if (custom && custom.trim()) return custom;
  const anyCustom = (labels?.length ?? 0) > 0;
  return anyCustom && unlabeledCells === "empty" ? "" : undefined;
}

// public props schema for editors and validation
const propsSchema = definePropsSchema<AnimatedWireframeSchemaProps>({
  M0String: {
    type: "m0",
    required: true,
    description: "m0 string to generate layout of",
  },
  labels: {
    type: "string[]",
    required: false,
    description:
      "Optional custom label per cell (1-based order). A labeled cell shows its label instead of its number and size marks; unlabeled cells keep their marks (see Unlabeled Cells).",
  },
  paddingSec: {
    type: "number",
    required: false,
    description:
      "Padding at start and end. Same value for both; trail is at least 0.3s for the slide. Default: 0.35s.",
    meta: {
      constraints: { min: 0, max: 2 },
      control: { unit: "s", placeholder: "e.g., 0.35" },
      ui: { label: "Padding" },
    },
  },
  disableUi: {
    type: "boolean",
    required: false,
    description:
      "If true, hides the header band that prints the m0 string above the layout (debug mode only — thumb presets never draw it).",
    meta: {
      ui: { label: "Hide Header" },
    },
  },
  mode: {
    type: "string",
    required: false,
    description: 'Render mode. "debug" (default) shows numbers/dims/AR. "thumb" shows clean tiles only.',
    meta: {
      constraints: { oneOf: ["debug", "thumb"] },
      control: {
        options: [
          { value: "debug", label: "Debug" },
          { value: "thumb", label: "Thumbnail" },
        ],
      },
      ui: { label: "Mode" },
    },
  },
  preset: {
    type: "string",
    required: false,
    description: "Named theme preset. Sets mode, colors, borders, and effects.",
    meta: {
      constraints: {
        oneOf: ["none", "thumb-dark", "thumb-light", "debug-contrast", "heatmap-depth", "grid-paper"],
      },
      control: {
        options: [
          { value: "none", label: "None (mode-driven)" },
          { value: "thumb-dark", label: "Thumb Dark" },
          { value: "thumb-light", label: "Thumb Light" },
          { value: "debug-contrast", label: "Debug Contrast" },
          { value: "heatmap-depth", label: "Heatmap Depth" },
          { value: "grid-paper", label: "Grid Paper" },
        ],
      },
      ui: { label: "Preset" },
    },
  },
  theme: {
    type: "group",
    required: false,
    description: "Theme overrides applied on top of preset defaults.",
    meta: {
      ui: {
        label: "Theme",
        collapsedByDefault: true,
      },
    },
  },
  background: {
    type: "string",
    required: false,
    description:
      'Canvas backing: "white" (default — an opaque white fill the cells slide onto) or "transparent" (no fill — the engine\'s default black for mp4, alpha where the output supports it). Ignored when a theme/preset sets its own background.',
    meta: {
      constraints: { oneOf: ["transparent", "white"] },
      control: {
        options: [
          { value: "transparent", label: "Transparent" },
          { value: "white", label: "White" },
        ],
      },
      ui: { label: "Background" },
    },
  },
  unlabeledCells: {
    type: "string",
    required: false,
    description:
      'What a cell without a custom label shows once some cells are labeled: "marks" (default — its number and size) or "empty" (blank — labels are the only text on the board).',
    meta: {
      constraints: { oneOf: ["marks", "empty"] },
      control: {
        options: [
          { value: "marks", label: "Keep marks" },
          { value: "empty", label: "Leave empty" },
        ],
      },
      ui: { label: "Unlabeled Cells" },
    },
  },
});

export const AnimatedWireframe: MosaicTemplate<AnimatedWireframeSchemaProps> = {
  id: asTemplateId("@m0saic/wireframe/animated/v1"),
  label: "Animated Wireframe",
  version: 1,
  description:
    "Deprecated — use DSL Tutorial (@m0saic/dsl-tutorial/v1) for an animated layout walk. Animated wireframe of any m0 layout string: every cell slides into place in order — numbered, with its pixel size and aspect ratio — on a white canvas, with the m0 string printed in a header band. Custom labels, header toggle, thumb / heatmap / paper presets; the reveal spreads across whatever duration you render.",
  capabilities: {
    tier: "core",
  },
  // Founder ruling, gate 30 (2026-09-04): superseded by the DSL tutorial —
  // "if you want a static wireframe, you use wireframe; if you want
  // animation, DSL tutorial is just better." Kept, fully callable (the CLI's
  // `wireframe --anim` path and "Show deprecated" still reach it): it holds
  // its own for small-to-mid layouts and at extreme m0 sizes where the
  // tutorial's walk gets long, but that is not where the value is.
  deprecated: {
    reason:
      "Superseded by the DSL tutorial: a static layout wants the wireframe, an animated one wants the tutorial's geometry walk, which explains the layout instead of only revealing it. This template stays as the lightweight reveal for small-to-mid layouts.",
    replacement: asTemplateId("@m0saic/dsl-tutorial/v1"),
    since: "2026-09-04",
  },
  tags: ["wireframe", "animated", "docs-only"],
  outputHints: {
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 5000,
    note: "Animated wireframe reveal; duration set by CLI/desktop",
    format: { kind: "video", container: "mp4" },
  },
  propsSchema,
  // Explicit debug style (gate 29 ruling, carried to the family): every knob
  // the default look depends on is spelled out so the Make form shows the
  // state it renders. Byte-identical to the implicit defaults; a chosen
  // `preset` still decides thumb-vs-debug (v1 resolveTheme, layer 3).
  defaultProps: {
    preset: "none",
    M0String: DEFAULT_LAYOUT as M0String,
    paddingSec: DEFAULT_PADDING_SEC,
    disableUi: false,
    mode: "debug",
    background: DEFAULT_BACKGROUND,
    unlabeledCells: DEFAULT_UNLABELED_CELLS,
  },

  async render(props: AnimatedWireframeSchemaProps, ctx: MosaicEngineContext): Promise<MosaicDocument> {
    // "none" is the visible unset state of the preset picker — identical to omitting it.
    if (props.preset === "none") { const { preset: _none, ...rest } = props; props = rest; }
    const { M0String, labels, disableUi } = props;
    const hasTheming = !!props.preset || !!props.theme || props.mode === "thumb";
    const resolved = hasTheming ? resolveTheme(props) : null;
    const useThumb = resolved?.useThumb ?? false;
    const useDebugText = resolved?.useDebugText ?? true;
    const unlabeledCells: WireframeUnlabeledCellsValue = props.unlabeledCells ?? DEFAULT_UNLABELED_CELLS;

    // The header band exists only in debug mode. When it is on, the layout
    // renders in the nine rows beneath it — so the cell geometry (and the
    // dims the cells print) MUST come from the wrapped string, not the bare
    // one: a 2×2 at 1080p is 960×486 under the header, not 960×540.
    const showHeader = !disableUi && !useThumb;
    let finalM0saic: string = M0String;
    if (showHeader) {
      const donors = Array(HEADER_ROWS - 2).fill(">").join(",");
      finalM0saic = `${HEADER_ROWS}[F,${donors},${M0String}]`;
    }
    const allFrames = parseMosaicFrames(finalM0saic, ctx);
    const headerFrame = showHeader ? allFrames[0] : undefined;
    const tiles = showHeader ? allFrames.slice(1) : allFrames;

    // Canvas from the frame bounds (they tile the whole canvas).
    let canvasW = 0;
    let canvasH = 0;
    for (const f of allFrames) {
      canvasW = Math.max(canvasW, f.x + f.width);
      canvasH = Math.max(canvasH, f.y + f.height);
    }

    const totalMs = ctx.target.durationMs;

    const paddingSec = props.paddingSec ?? DEFAULT_PADDING_SEC;
    const leadPaddingMs = Math.round(paddingSec * 1000);
    const trailPaddingMs = Math.max(leadPaddingMs, OVERLAY_SLIDE_MS);
    const animationWindowMs = Math.max(0, totalMs - leadPaddingMs - trailPaddingMs);
    const leadPaddingSec = leadPaddingMs / 1000;
    const animationWindowSec = animationWindowMs / 1000;

    const finalDurationMs = totalMs;

    const tileCount = tiles.length;
    const sources: MosaicSource[] = [];
    const children: Record<string, MosaicRenderableFile> = {};

    const baseCellTheme: WireframeCellTheme | undefined = resolved
      ? {
          tileBackgroundColor: resolved.tileColor,
          borderColor: resolved.borderColor,
          borderAlpha: resolved.borderAlpha,
          borderWidthFrac: resolved.borderWidthFrac,
          rounding: resolved.rounding,
          dropShadow: resolved.dropShadow,
        }
      : undefined;

    const minTextSize = props.preset === "debug-contrast" ? 18 : 14;

    const staggerSec = tileCount <= 1 ? 0 : animationWindowSec / (tileCount - 1);

    for (let i = 0; i < tiles.length; i++) {
      const frame = tiles[i];
      const order = i + 1;

      let textString = "";
      let renderOrderNumberString = false;
      let textSize = clamp(Math.round(Math.min(frame.width, frame.height) * CELL_TEXT_FRAC), minTextSize, CELL_TEXT_MAX);

      if (useDebugText) {
        const fitted = fitCellText({
          cellW: frame.width,
          cellH: frame.height,
          label: cellLabelFor(labels, order, unlabeledCells),
          minTextSize,
        });
        textString = fitted.text;
        textSize = fitted.textSize;
        renderOrderNumberString = fitted.showOrder;
      }

      const startAtSec = leadPaddingSec + i * staggerSec;

      // Per-cell tile color
      let tileCellTheme = baseCellTheme;
      if (baseCellTheme && resolved) {
        let tileBg = resolved.tileColor;
        if (resolved.heatmap?.enabled && resolved.heatmap.shades.length > 0) {
          tileBg = resolved.heatmap.shades[(order - 1) % resolved.heatmap.shades.length] as MosaicColor;
        } else if (order % 2 === 0) {
          tileBg = resolved.tileColorAlt;
        }
        tileCellTheme = { ...baseCellTheme, tileBackgroundColor: tileBg };
      }

      const templateProps: WireframeCellSchemaProps & { theme?: WireframeCellTheme } = {
        orderString: String(order),
        showOrderString: renderOrderNumberString,
        text: textString,
        textSize,
        mode: useThumb ? "thumb" : "debug",
        theme: tileCellTheme,
      };

      const childId = `cell-${i}`;

      const childFile = await renderNestedTemplate("@m0saic/wireframe/cell/v1", templateProps, ctx);

      children[childId] = childFile;

      sources.push({
        type: "mosaic",
        ref: childId,
        placement: { fit: "contain" },
        overlay: {
          startAtSec,
          enable: `gte(t,${startAtSec.toFixed(3)})`,
          yExpr: "-(1-min(lt/0.3,1))*H*0.08",
        },
      });
    }

    if (showHeader && headerFrame) {
      const header = fitHeader(M0String, canvasW, headerFrame.height);
      sources.unshift({
        type: "text",
        style: {
          fontSize: header.fontSize,
          fontColor: "#000000",
          fontFamily: HEADER_FONT_FAMILY,
        },
        layers: [{ content: { kind: "literal", text: header.text } }],
        placement: { hAlign: "center", vAlign: "middle" },
        visual: { backgroundColor: "#ffffff" },
      });
    }

    // Background, in priority order: a theme/preset backgroundColor, else the
    // `background` prop — "white" (default) bakes an opaque fill the cells
    // slide onto; "transparent" leaves the engine's default (black for mp4).
    const background = props.background ?? DEFAULT_BACKGROUND;
    const bg: MosaicColor | null = resolved?.backgroundColor ?? (background === "white" ? "#ffffff" : null);

    // Paper grid (the `grid-paper` preset / `theme.paperGrid`): ONE static
    // lattice source appended as a full-canvas TOP overlay leaf — visible
    // from t=0, the cells slide in beneath it. Off → the m0 stays verbatim.
    if (resolved?.paperGrid?.enabled) {
      sources.push(
        makePaperGridSource({
          width: canvasW,
          height: canvasH,
          ink: (resolved.borderColor ?? "#000000") as MosaicColor,
          stepFrac: resolved.paperGrid.stepFrac,
          alpha: resolved.paperGrid.alpha,
        }),
      );
      finalM0saic = appendTopOverlay(finalM0saic);
    }

    return {
      kind: "mosaic_document",
      version: 1,
      sources,
      assets: {} as MosaicDocument["assets"],
      m0: toM0String(finalM0saic, "AnimatedWireframe"),
      durationMs: finalDurationMs,
      // Gate-26 convention: every rendered doc declares its format. A silent
      // video deliverable — never mux a placeholder audio track.
      format: { kind: "video", container: "mp4" },
      audio: { mode: "off" },
      ...(bg != null ? { backgroundColor: solidBackground(bg) } : {}),
      children,
    };
  },
};

registerTemplate(AnimatedWireframe);
