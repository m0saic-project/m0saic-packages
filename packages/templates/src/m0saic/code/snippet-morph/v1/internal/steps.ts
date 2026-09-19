/**
 * Step / document construction for snippet-morph v1.
 *
 * Every code LINE is ONE svg text source: one layer per token run, each in
 * its token colour, placed on the monospace grid by an absolute px `xExpr`. The engine
 * rasterizes such a source to a single coloured RGBA image (core svg text,
 * multi-colour route) — one animatable unit per line — and Make's preview
 * draws the very same document. There is no template-side rasterizer and no
 * separate preview stand-in.
 */

import {
  type AssetId,
  type MosaicColor,
  type MosaicDocument,
  type MosaicDocumentPipeline,
  type MosaicOverlayExpr,
  type MosaicTextLayer,
  type MosaicTextSource,
} from "@m0saic/types";
import {
  easingExpr,
  fadeInExpr,
  placeInsetPieces,
  progressExpr,
  type InsetPiece,
  bindProp,
  bindPropRange,
} from "@m0saic/template-utils";
import {
  codeColumnCount,
  measureCodeGrid,
} from "../../../_shared/code-metrics";
import type { CodeTheme } from "../../../_shared/code-theme";
import type { LexedCodeLine, LexedCodeState } from "../../../_shared/code-lexer";
import {
  buildSnippetChromePieces,
  type SnippetFrameGeometry,
  type SnippetRect,
} from "./chrome";
import type { MorphStepTiming, SnippetMorphPlan, TransitionPlan } from "./plan";

export type SnippetCodeAlign = "left" | "center";
export type SnippetAddEntrance = "fade" | "rise";

export interface SnippetMotionOptions {
  reduceMotion: boolean;
  addEntrance: SnippetAddEntrance;
}

/** Typography of the code grid. */
export interface SnippetTextStyle {
  fontSize: number;
  lineHeight: number;
  fontFamily?: string;
  fontWeight?: number | "normal" | "bold";
  fontStyle?: "normal" | "italic";
}

export interface SnippetStepVisualOptions extends SnippetTextStyle {
  title: string;
  showChrome: boolean;
  trafficLights: boolean;
  lineNumbers: boolean;
  codeAlign: SnippetCodeAlign;
  /** Card fills the canvas (no outer margin). */
  fullBleed?: boolean;
}

/** One RAW line of a `states[i]` string: its text and `[start, end)` span
 *  in the prop value (newline excluded). Offsets index the raw prop — what
 *  Make's ranged inline edit splices — not the tab-expanded lexer copy. */
export type LiteLineSpan = { start: number; end: number; raw: string };

export type LiteBindSpans = {
  tabWidth: number;
  /** Line spans of the state the step shows (`states[bindStateIndex]`). */
  current?: LiteLineSpan[];
  /** Line spans of the previous state (removed lines bind there). */
  previous?: LiteLineSpan[];
};

/** Split a raw state into line spans the way the lexer splits lines
 *  (`\r\n` / `\r` / `\n`; a trailing newline yields an empty last line). */
export function rawLineSpans(raw: string): LiteLineSpan[] {
  const spans: LiteLineSpan[] = [];
  const re = /\r\n|\r|\n/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    spans.push({ start, end: m.index, raw: raw.slice(start, m.index) });
    start = m.index + m[0].length;
  }
  spans.push({ start, end: raw.length, raw: raw.slice(start) });
  return spans;
}

/** Raw string offset (UTF-16 units) of a character-grid column in a raw
 *  line: tabs advance `tabWidth` columns (the lexer expands them so), wide
 *  glyphs two, astral glyphs one column over two code units. */
export function rawOffsetForColumn(rawLine: string, col: number, tabWidth: number): number {
  let cols = 0;
  let offset = 0;
  for (const ch of rawLine) {
    if (cols >= col) break;
    cols += ch === "\t" ? tabWidth : codeColumnCount(ch);
    offset += ch.length;
  }
  return offset;
}

export interface BuildSnippetDocumentSpec {
  state: LexedCodeState;
  geometry: SnippetFrameGeometry;
  theme: CodeTheme;
  visual: SnippetStepVisualOptions;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  /** Morph context for an animated step (absent → the state at rest). */
  transition?: TransitionPlan;
  previousState?: LexedCodeState;
  stepTiming?: MorphStepTiming;
  motion?: SnippetMotionOptions;
  /** `states[]` index the code lines bind to (Make double-click → edit). */
  bindStateIndex?: number;
  bindPreviousStateIndex?: number;
  /** Raw line spans of the bound states — each line then binds ITS span. */
  bindSpans?: LiteBindSpans;
}

type MotionContext = {
  transition: TransitionPlan;
  previousState?: LexedCodeState;
  timing: MorphStepTiming;
  motion: SnippetMotionOptions;
};

type GridMetrics = { charW: number; lineStep: number };

function codeOffsetX(
  state: LexedCodeState,
  geometry: SnippetFrameGeometry,
  visual: SnippetStepVisualOptions,
): number {
  if (visual.codeAlign === "left") return 0;
  const metrics = measureCodeGrid(state.lines, {
    fontSize: visual.fontSize,
    lineHeight: visual.lineHeight,
  });
  return Math.max(0, Math.floor((geometry.codeArea.w - metrics.width) / 2));
}

function seconds(milliseconds: number): number {
  return milliseconds / 1000;
}

function intersectRect(rect: SnippetRect, bounds: SnippetRect): SnippetRect | null {
  const left = Math.max(rect.x, bounds.x);
  const top = Math.max(rect.y, bounds.y);
  const right = Math.min(rect.x + rect.w, bounds.x + bounds.w);
  const bottom = Math.min(rect.y + rect.h, bounds.y + bounds.h);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * One code line as ONE svg text source: a layer per token run, each in its
 * token colour, placed at `col × charW` px from the line box's left edge
 * (a plain-number `xExpr` — an absolute px offset for the engine's svg text
 * path AND the preview, so the grid never scales with the quantized frame
 * width a fractional padding would). `vAlign: "top"` puts every run's
 * baseline at `ascent` from the row top: the line-box model the gutter
 * numbers share. Returns null for a blank line (nothing to draw, nothing to bind).
 */
function codeLineSource(
  line: LexedCodeLine,
  box: SnippetRect,
  metrics: GridMetrics,
  theme: CodeTheme,
  visual: SnippetStepVisualOptions,
  overlay: MosaicOverlayExpr | undefined,
  bindIndex: number | undefined,
  bindSpan: LiteLineSpan | undefined,
): MosaicTextSource | null {
  const layers: MosaicTextLayer[] = [];
  line.tokens.forEach((token) => {
    for (const match of token.text.matchAll(/\S+/gu)) {
      const text = match[0];
      const prefix = token.text.slice(0, match.index ?? 0);
      const startCol = token.col + codeColumnCount(prefix);
      const startPx = startCol * metrics.charW;
      if (startPx >= box.w) continue; // starts past the code area's right edge
      layers.push({
        content: { kind: "literal", text },
        style: { fontColor: theme.syntax[token.kind] as MosaicColor },
        placement: {
          hAlign: "left",
          vAlign: "top",
          xExpr: String(Math.round(startPx * 1000) / 1000),
        },
      });
    }
  });
  if (layers.length === 0) return null;
  const source: MosaicTextSource = {
    type: "text",
    rasterizer: "svg",
    renderMode: { kind: "image" },
    visual: { backgroundColor: "black@0" },
    style: {
      fontFamily: visual.fontFamily ?? "JetBrains Mono",
      fontSize: visual.fontSize,
      ...(visual.fontWeight != null ? { fontWeight: visual.fontWeight } : {}),
      ...(visual.fontStyle != null ? { fontStyle: visual.fontStyle } : {}),
    },
    layers,
    editor: { owner: "template" },
  };
  if (overlay) source.overlay = overlay;
  // Make double-click → inline edit of THIS line of its state (range in
  // raw-prop offsets); without spans, the whole state.
  if (bindIndex != null) {
    if (bindSpan) bindPropRange(source, "states", bindIndex, { start: bindSpan.start, end: bindSpan.end });
    else bindProp(source, "states", bindIndex);
  }
  return source;
}

/** Grid column just past the last glyph of a line (0 for a blank line). */
function lineEndCol(line: LexedCodeLine): number {
  let end = 0;
  for (const token of line.tokens) {
    const trimmed = token.text.replace(/\s+$/u, "");
    if (trimmed.length > 0) end = Math.max(end, token.col + codeColumnCount(trimmed));
  }
  return end;
}

/** Pixels kept to the right of the last glyph: room for a glyph's ink to
 *  overhang its advance box (anti-aliasing, italics) so nothing is clipped,
 *  and a little air for the hover ring. The raster itself is width-agnostic
 *  (measured: the same glyphs in a 26 px and a 300 px tile are pixel-identical). */
const LINE_BOX_INK_PAD_PX = 6;

function linePiece(
  line: LexedCodeLine | undefined,
  row: number,
  offsetX: number,
  geometry: SnippetFrameGeometry,
  metrics: GridMetrics,
  theme: CodeTheme,
  visual: SnippetStepVisualOptions,
  importance: number,
  overlay: MosaicOverlayExpr | undefined,
  bindIndex: number | undefined,
  bindSpan: LiteLineSpan | undefined,
): InsetPiece | null {
  if (!line) return null;
  const area = geometry.codeArea;
  // The line box HUGS its text: from the code column to just past the last
  // glyph (clipped at the code area's right edge). The render is unchanged
  // (runs sit at absolute px), the raster is only as wide as the ink, and in
  // Make the hover ring, the edit handle and the inline editor wrap the text
  // instead of running to the far edge of the card.
  const inkW = Math.ceil(lineEndCol(line) * metrics.charW) + LINE_BOX_INK_PAD_PX;
  const box = intersectRect(
    { x: area.x + offsetX, y: area.y + row * metrics.lineStep, w: Math.max(1, Math.min(inkW, area.w - offsetX)), h: metrics.lineStep },
    area,
  );
  if (!box || box.h < 2) return null;
  const source = codeLineSource(line, box, metrics, theme, visual, overlay, bindIndex, bindSpan);
  if (!source) return null;
  return { rect: { ...box, importance }, source };
}

/**
 * Code pieces for one step. With a morph context the lines carry the
 * transition's overlay expressions — persisting lines slide from their
 * previous row, added lines fade (and rise) in, removed lines fade out at
 * their old row (drawn from the previous state). Without one (first state,
 * reduced motion) the state sits at rest.
 */
function codePieces(
  state: LexedCodeState,
  geometry: SnippetFrameGeometry,
  theme: CodeTheme,
  visual: SnippetStepVisualOptions,
  motionCtx?: MotionContext,
  bindStateIndex?: number,
  bindPreviousStateIndex?: number,
  bindSpans?: LiteBindSpans,
): InsetPiece[] {
  const metrics = measureCodeGrid(state.lines, {
    fontSize: visual.fontSize,
    lineHeight: visual.lineHeight,
  });
  const offsetX = codeOffsetX(state, geometry, visual);
  const spanAt = (spans: LiteLineSpan[] | undefined, row: number) => spans?.[row];
  const pieces: InsetPiece[] = [];
  const push = (piece: InsetPiece | null) => {
    if (piece) pieces.push(piece);
  };

  const animate =
    motionCtx &&
    !motionCtx.motion.reduceMotion &&
    motionCtx.transition.fromStateIndex != null;
  if (!animate) {
    state.lines.forEach((line, row) => {
      push(linePiece(line, row, offsetX, geometry, metrics, theme, visual, 10, undefined, bindStateIndex, spanAt(bindSpans?.current, row)));
    });
    return pieces;
  }

  const { transition, previousState, timing, motion } = motionCtx!;
  const morphStartSec = seconds(timing.morph.startMs);
  const morphEndSec = seconds(timing.morph.endMs);
  const morphDurationSec = Math.max(0.0001, seconds(timing.morph.durationMs));
  const fade = fadeInExpr(morphStartSec, morphDurationSec, "easeInOut");
  const eased = easingExpr("easeInOut", progressExpr(morphStartSec, morphDurationSec));
  const risePx = Math.max(1, Math.round(metrics.lineStep * 0.25));
  const previousOffsetX = previousState ? codeOffsetX(previousState, geometry, visual) : offsetX;

  transition.ops.forEach((op) => {
    if (op.kind === "same") {
      const offsetPx = (op.fromLine - op.toLine) * metrics.lineStep;
      const overlay: MosaicOverlayExpr | undefined =
        offsetPx !== 0 ? { yExpr: `(1-(${eased}))*${offsetPx}`, startAtSec: morphStartSec } : undefined;
      push(linePiece(state.lines[op.toLine], op.toLine, offsetX, geometry, metrics, theme, visual, overlay ? 12 : 10, overlay, bindStateIndex, spanAt(bindSpans?.current, op.toLine)));
    } else if (op.kind === "add") {
      const overlay: MosaicOverlayExpr = {
        alpha: fade,
        ...(motion.addEntrance === "rise" ? { yExpr: `(1-(${eased}))*${risePx}` } : {}),
        startAtSec: morphStartSec,
        window: { startSec: morphStartSec },
      };
      push(linePiece(state.lines[op.toLine], op.toLine, offsetX, geometry, metrics, theme, visual, 30, overlay, bindStateIndex, spanAt(bindSpans?.current, op.toLine)));
    } else {
      const overlay: MosaicOverlayExpr = {
        alpha: `(1-(${fade}))`,
        startAtSec: morphStartSec,
        window: { endSec: morphEndSec },
      };
      push(linePiece(previousState?.lines[op.fromLine], op.fromLine, previousOffsetX, geometry, metrics, theme, visual, 11, overlay, bindPreviousStateIndex, spanAt(bindSpans?.previous, op.fromLine)));
    }
  });
  return pieces;
}

/** One state's document: chrome + code lines (+ the morph into it). */
export function buildSnippetDocument(spec: BuildSnippetDocumentSpec): MosaicDocument {
  const metrics = measureCodeGrid(spec.state.lines, {
    fontSize: spec.visual.fontSize,
    lineHeight: spec.visual.lineHeight,
  });
  const pieces = buildSnippetChromePieces({
    geometry: spec.geometry,
    theme: spec.theme,
    title: spec.visual.title,
    showChrome: spec.visual.showChrome,
    trafficLights: spec.visual.trafficLights,
    lineNumbers: spec.visual.lineNumbers,
    titleFontSize: Math.max(10, Math.round(spec.geometry.titleBar.h * 0.3)),
    lineCount: spec.state.lines.length,
    lineStep: metrics.lineStep,
    fontSize: spec.visual.fontSize,
    charW: metrics.charW,
  });
  pieces.push(
    ...codePieces(
      spec.state,
      spec.geometry,
      spec.theme,
      spec.visual,
      spec.transition && spec.stepTiming && spec.motion
        ? { transition: spec.transition, previousState: spec.previousState, timing: spec.stepTiming, motion: spec.motion }
        : undefined,
      spec.bindStateIndex,
      spec.bindPreviousStateIndex,
      spec.bindSpans,
    ),
  );
  const placed = placeInsetPieces({
    rootW: spec.width,
    rootH: spec.height,
    pieces,
  });
  return {
    kind: "mosaic_document",
    version: 1,
    m0: placed.m0,
    sources: placed.sources,
    assets: {} as Record<AssetId, never>,
    size: { width: spec.width, height: spec.height },
    fps: spec.fps,
    durationMs: spec.durationMs,
    backgroundColor: spec.theme.canvas,
    // Author stamp: a silent video deliverable. Also what Make's Output Type
    // reads (without it `inferOutputKind` judged a still-only doc an IMAGE).
    format: { kind: "video", container: "mp4" },
    audio: { mode: "off" },
  };
}

export interface BuildSnippetPipelineSpec {
  plan: SnippetMorphPlan;
  /** The RAW `states` prop + tab width: each code line then binds ITS line
   *  of its state in raw offsets (Make ranged inline edit). Absent →
   *  whole-state bindings. */
  rawStates?: string[];
  tabWidth?: number;
  geometry: SnippetFrameGeometry;
  theme: CodeTheme;
  visual: SnippetStepVisualOptions;
  width: number;
  height: number;
  fps: number;
  motion: SnippetMotionOptions;
}

/**
 * The per-state cut pipeline — one document per state, each carrying the
 * morph INTO it, step lengths from the plan's timing. The same pipeline is
 * the explicit render and Make's live preview (which scrubs it step by step).
 */
export function buildSnippetPipeline(spec: BuildSnippetPipelineSpec): MosaicDocumentPipeline {
  const spans = spec.rawStates?.map(rawLineSpans);
  const tabWidth = spec.tabWidth ?? 2;
  const steps = spec.plan.steps.map((step) => {
    const state = spec.plan.states[step.stateIndex]!;
    const from = step.transition.fromStateIndex;
    const file = buildSnippetDocument({
      state,
      geometry: spec.geometry,
      theme: spec.theme,
      visual: spec.visual,
      width: spec.width,
      height: spec.height,
      fps: spec.fps,
      durationMs: step.durationMs,
      transition: step.transition,
      previousState: from == null ? undefined : spec.plan.states[from],
      stepTiming: step.timing,
      motion: spec.motion,
      bindStateIndex: step.stateIndex,
      bindPreviousStateIndex: from == null ? undefined : from,
      ...(spans
        ? { bindSpans: { tabWidth, current: spans[step.stateIndex], previous: from == null ? undefined : spans[from] } }
        : {}),
    });
    return { name: `state-${step.index + 1}`, durationMs: step.durationMs, file };
  });
  return {
    kind: "mosaic_pipeline",
    version: 1,
    emit: "single",
    steps,
    defaultTransition: { type: "cut" },
    size: { width: spec.width, height: spec.height },
    fps: spec.fps,
    durationMs: spec.plan.timeline.durationMs,
    backgroundColor: spec.theme.canvas,
    format: { kind: "video", container: "mp4" },
    audio: { mode: "off" },
  };
}
