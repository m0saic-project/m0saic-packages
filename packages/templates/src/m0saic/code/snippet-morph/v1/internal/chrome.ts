/** Pure editor-frame geometry and chrome-source construction. */

import {
  type MosaicColor,
  type MosaicSource,
  type MosaicTextSource,
} from "@m0saic/types";
import {
  bindProp,
  makeColorTile,
  type InsetPiece,
} from "@m0saic/template-utils";
import type { CodeTheme } from "../../../_shared/code-theme";

export interface SnippetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SnippetFrameGeometry {
  canvas: SnippetRect;
  card: SnippetRect;
  titleBar: SnippetRect;
  gutter: SnippetRect;
  codeArea: SnippetRect;
  titleSlot: SnippetRect;
  padding: number;
}

export interface ComputeSnippetFrameGeometrySpec {
  width: number;
  height: number;
  fontSize: number;
  showChrome: boolean;
  lineNumbers: boolean;
  /** Card fills the canvas edge to edge (no outer margin). Default false here
   *  (legacy framed card); the template defaults it ON (gate 32 ruling). */
  fullBleed?: boolean;
}

export interface BuildSnippetChromeSpec {
  geometry: SnippetFrameGeometry;
  theme: CodeTheme;
  title: string;
  showChrome: boolean;
  trafficLights: boolean;
  lineNumbers: boolean;
  titleFontSize: number;
  /** Code grid, for the per-line gutter numbers. */
  lineCount: number;
  lineStep: number;
  fontSize?: number;
  charW?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function positiveInt(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite number > 0, got ${value}`);
  }
  return Math.max(1, Math.round(value));
}

/** Derive all static frame rectangles once in integer canvas pixels. */
export function computeSnippetFrameGeometry(
  spec: ComputeSnippetFrameGeometrySpec,
): SnippetFrameGeometry {
  const width = positiveInt(spec.width, "computeSnippetFrameGeometry: width");
  const height = positiveInt(spec.height, "computeSnippetFrameGeometry: height");
  const fontSize = positiveInt(
    spec.fontSize,
    "computeSnippetFrameGeometry: fontSize",
  );
  const marginX = spec.fullBleed
    ? 0
    : clamp(Math.round(width * 0.07), 8, Math.max(8, Math.floor(width / 5)));
  const marginY = spec.fullBleed
    ? 0
    : clamp(Math.round(height * 0.08), 8, Math.max(8, Math.floor(height / 5)));
  const card: SnippetRect = {
    x: marginX,
    y: marginY,
    w: Math.max(1, width - marginX * 2),
    h: Math.max(1, height - marginY * 2),
  };
  const titleBarH = spec.showChrome
    ? clamp(
        Math.round(card.h * 0.09),
        Math.min(24, card.h),
        Math.max(1, Math.floor(card.h / 4)),
      )
    : 0;
  const padding = clamp(
    Math.round(Math.min(card.w, card.h) * 0.035),
    4,
    Math.max(4, Math.floor(Math.min(card.w, card.h) / 8)),
  );
  const innerX = card.x + padding;
  const innerRight = card.x + card.w - padding;
  const codeY = card.y + titleBarH + padding;
  const codeBottom = card.y + card.h - padding;
  const innerW = Math.max(1, innerRight - innerX);
  const desiredGutter = spec.lineNumbers
    ? Math.max(30, Math.round(fontSize * 3.2))
    : 0;
  const gutterW = Math.min(desiredGutter, Math.max(0, Math.floor(innerW * 0.28)));
  const gutterGap = gutterW > 0
    ? Math.min(Math.max(6, Math.round(fontSize * 0.8)), Math.max(0, innerW - gutterW - 1))
    : 0;
  const codeX = innerX + gutterW + gutterGap;
  const codeArea: SnippetRect = {
    x: codeX,
    y: codeY,
    w: Math.max(1, innerRight - codeX),
    h: Math.max(1, codeBottom - codeY),
  };
  const titleInset = Math.max(8, Math.round(titleBarH * 0.3));
  const trafficReserve = spec.showChrome ? Math.round(titleBarH * 2.4) : 0;

  return {
    canvas: { x: 0, y: 0, w: width, h: height },
    card,
    titleBar: { x: card.x, y: card.y, w: card.w, h: titleBarH },
    gutter: {
      x: innerX,
      y: codeY,
      w: gutterW,
      h: Math.max(1, codeBottom - codeY),
    },
    codeArea,
    titleSlot: {
      x: card.x + titleInset + trafficReserve,
      y: card.y,
      w: Math.max(1, card.w - titleInset * 2 - trafficReserve),
      h: Math.max(1, titleBarH),
    },
    padding,
  };
}

function labelSource(
  text: string,
  fontSize: number,
  color: MosaicColor,
): MosaicTextSource {
  const src: MosaicTextSource = {
    type: "text",
    rasterizer: "svg",
    renderMode: { kind: "image" },
    visual: { backgroundColor: "black@0" },
    layers: [
      {
        content: { kind: "literal", text: text.trim() || " " },
        style: {
          fontFamily: "JetBrains Mono",
          fontSize,
          fontColor: color,
        },
        placement: { hAlign: "left", vAlign: "middle" },
      },
    ],
    editor: { owner: "template", label: "title" },
  };
  // The title slot DISPLAYS `chrome.title` — bound for Make's double-click
  // inline edit (rect present whenever the chrome shows, even when blank).
  return bindProp(src, "chrome.title");
}

function labeledSource(source: MosaicSource, label: string): MosaicSource {
  return {
    ...source,
    editor: { owner: "template", label },
  };
}

function baseChromePieces(
  spec: BuildSnippetChromeSpec,
): InsetPiece[] {
  const { geometry, theme } = spec;
  const pieces: InsetPiece[] = [
    {
      rect: { ...geometry.canvas, importance: 0 },
      source: makeColorTile(theme.canvas),
    },
    {
      rect: { ...geometry.card, importance: 1 },
      // A full-bleed card IS the canvas: no rounded corners or hairline
      // against the frame edge (they read as a stray border in the render).
      source: labeledSource(
        geometry.card.x === 0 &&
          geometry.card.y === 0 &&
          geometry.card.w === geometry.canvas.w &&
          geometry.card.h === geometry.canvas.h
          ? makeColorTile(theme.editor)
          : makeColorTile(theme.editor, {
              effects: {
                rounding: { cornerStyle: "rounded", borderRadius: 0.025 },
                stroke: {
                  position: "inner",
                  width: 0.002,
                  color: theme.border,
                  alpha: 1,
                },
              },
            }),
        "card",
      ),
    },
    {
      rect: { ...geometry.codeArea, importance: 2 },
      source: labeledSource(makeColorTile(theme.editor), "code-area"),
    },
  ];

  if (spec.showChrome && geometry.titleBar.h > 0) {
    pieces.push({
      rect: { ...geometry.titleBar, importance: 2 },
      source: makeColorTile(theme.titleBar),
    });
    pieces.push({
      rect: { ...geometry.titleSlot, importance: 4 },
      source: labelSource(spec.title, spec.titleFontSize, theme.title),
    });
  }
  if (spec.lineNumbers && geometry.gutter.w > 0) {
    pieces.push({
      rect: { ...geometry.gutter, importance: 2 },
      source: labeledSource(makeColorTile(theme.gutter), "gutter"),
    });
  }
  return pieces;
}

/**
 * One label glyph run (gutter number): a single-layer svg text source in
 * JetBrains Mono. `vAlign: "top"` puts its baseline at `ascent` from the row
 * top — the same line-box model the code lines use — so numbers and code sit
 * on one baseline. Make draws it in the real face (the app registers the
 * bundled font); the engine rasterizes it through the core svg text path.
 */
export function codeTextSource(
  text: string,
  fontSize: number,
  color: MosaicColor,
  hAlign: "left" | "right" = "left",
  label?: string,
): MosaicTextSource {
  return {
    type: "text",
    rasterizer: "svg",
    renderMode: { kind: "image" },
    visual: { backgroundColor: "black@0" },
    layers: [
      {
        content: { kind: "literal", text },
        style: { fontFamily: "JetBrains Mono", fontSize, fontColor: color },
        placement: { hAlign, vAlign: "top" },
      },
    ],
    editor: { owner: "template", ...(label ? { label } : {}) },
  };
}

/**
 * The editor chrome — canvas, card, code area, title bar + title, traffic
 * lights (rounded colour tiles) and per-line gutter numbers — entirely from
 * native colour and text sources. The render and Make's preview are the same
 * document (no pre-rasterized chrome PNGs since the core svg-text promotion).
 */
export function buildSnippetChromePieces(
  spec: BuildSnippetChromeSpec,
): InsetPiece[] {
  const pieces = baseChromePieces(spec);
  const { geometry, theme } = spec;

  if (spec.showChrome && spec.trafficLights && geometry.titleBar.h > 0) {
    // Three "●" glyphs in ONE svg text source (a layer per light, three inks
    // → one coloured raster in the engine, the real face in the preview):
    // round in both, where a rounded colour tile came out as a squircle in
    // ffmpeg. Same glyph + spacing as the retired raster (cols 0 / 2 / 4).
    const size = Math.max(4, Math.round(geometry.titleBar.h * 0.24));
    const fontSize = Math.max(6, Math.round(size * 1.45)); // ● ink ≈ 0.7em in JetBrains Mono
    const charW = fontSize * 0.6;
    const boxW = Math.ceil(charW * 5);
    const boxH = Math.max(size, Math.round(fontSize * 1.2));
    const colors = [theme.trafficClose, theme.trafficMinimize, theme.trafficMaximize];
    pieces.push({
      rect: {
        x: geometry.card.x + geometry.padding,
        y: geometry.titleBar.y + Math.floor((geometry.titleBar.h - boxH) / 2),
        w: boxW,
        h: boxH,
        importance: 4,
      },
      source: {
        type: "text",
        rasterizer: "svg",
        renderMode: { kind: "image" },
        visual: { backgroundColor: "black@0" },
        style: { fontFamily: "JetBrains Mono", fontSize },
        layers: colors.map((color, index) => ({
          content: { kind: "literal" as const, text: "●" },
          style: { fontColor: color },
          placement: { hAlign: "left" as const, vAlign: "middle" as const, xExpr: String(Math.round(index * 2 * charW * 1000) / 1000) },
        })),
        editor: { owner: "template", label: "traffic-lights" },
      },
    });
  }
  if (spec.lineNumbers && geometry.gutter.w > 0) {
    // Real line numbers (the raster path right-aligns them on the code grid,
    // one column short of the gutter edge) — not the old bars.
    const fontSize = spec.fontSize ?? Math.max(8, Math.round(spec.lineStep / 1.5));
    const charW = spec.charW ?? fontSize * 0.6;
    const rightPad = Math.round(charW);
    for (let line = 0; line < spec.lineCount; line += 1) {
      const y = geometry.codeArea.y + line * spec.lineStep;
      if (y >= geometry.codeArea.y + geometry.codeArea.h) break;
      const h = Math.min(spec.lineStep, geometry.codeArea.y + geometry.codeArea.h - y);
      if (h < 2) break;
      pieces.push({
        rect: {
          x: geometry.gutter.x,
          y,
          w: Math.max(1, geometry.gutter.w - rightPad),
          h,
          importance: 4,
        },
        source: codeTextSource(String(line + 1), fontSize, theme.lineNumber, "right"),
      });
    }
  }
  return pieces;
}
