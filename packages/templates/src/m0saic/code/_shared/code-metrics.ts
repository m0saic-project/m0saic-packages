/** Deterministic JetBrains-Mono grid math and integer code-block bounds. */

/** JetBrains Mono's registered advance width: 600 units on a 1000-unit em. */
export const JETBRAINS_MONO_ADVANCE_EM = 0.6;
export const MIN_AUTOFIT_FONT_SIZE = 8;

export interface CodeLineLike {
  text: string;
}

export interface CodeGridMetrics {
  fontSize: number;
  lineHeight: number;
  charW: number;
  lineStep: number;
  lineCount: number;
  maxColumns: number;
  width: number;
  height: number;
}

export interface CodeBlockRect {
  x: number;
  y: number;
  width: number;
  height: number;
  originCol: number;
  originLine: number;
  endCol: number;
  endLine: number;
}

export interface AutoFitCodeOptions {
  preferredFontSize: number;
  lineHeight?: number;
  minFontSize?: number;
  maxWidth: number;
  maxHeight: number;
  charWidthEm?: number;
}

export interface AutoFitCodeResult {
  fontSize: number;
  fits: boolean;
  overflowX: boolean;
  overflowY: boolean;
  metrics: CodeGridMetrics;
}

function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite number > 0, got ${value}`);
  }
}

function requireNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite number >= 0, got ${value}`);
  }
}

/** Count Unicode code points; v1's documented envelope remains single-width glyphs. */
export function codeColumnCount(text: string): number {
  if (typeof text !== "string") {
    throw new Error("codeColumnCount: text must be a string");
  }
  return Array.from(text).length;
}

export function measureCodeGrid(
  lines: ReadonlyArray<CodeLineLike>,
  options: {
    fontSize: number;
    lineHeight?: number;
    charWidthEm?: number;
  },
): CodeGridMetrics {
  if (!Array.isArray(lines)) {
    throw new Error("measureCodeGrid: lines must be an array");
  }
  const lineHeight = options.lineHeight ?? 1.5;
  const charWidthEm = options.charWidthEm ?? JETBRAINS_MONO_ADVANCE_EM;
  requirePositiveFinite(options.fontSize, "measureCodeGrid: fontSize");
  requirePositiveFinite(lineHeight, "measureCodeGrid: lineHeight");
  requirePositiveFinite(charWidthEm, "measureCodeGrid: charWidthEm");

  let maxColumns = 0;
  lines.forEach((line, index) => {
    if (line == null || typeof line.text !== "string") {
      throw new Error(`measureCodeGrid: lines[${index}].text must be a string`);
    }
    maxColumns = Math.max(maxColumns, codeColumnCount(line.text));
  });

  const charW = options.fontSize * charWidthEm;
  const lineStep = Math.max(1, Math.round(options.fontSize * lineHeight));
  return {
    fontSize: options.fontSize,
    lineHeight,
    charW,
    lineStep,
    lineCount: lines.length,
    maxColumns,
    width: maxColumns === 0 ? 0 : Math.ceil(maxColumns * charW),
    height: lines.length * lineStep,
  };
}

/** Round a grid-aligned block outward once, matching the A2 raster placement. */
export function codeBlockRect(
  span: {
    originCol?: number;
    originLine: number;
    endCol: number;
    endLine: number;
  },
  metrics: Pick<CodeGridMetrics, "charW" | "lineStep">,
): CodeBlockRect {
  const originCol = span.originCol ?? 0;
  for (const [name, value] of [
    ["originCol", originCol],
    ["originLine", span.originLine],
    ["endCol", span.endCol],
    ["endLine", span.endLine],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`codeBlockRect: ${name} must be a non-negative integer, got ${value}`);
    }
  }
  if (span.endCol < originCol || span.endLine < span.originLine) {
    throw new Error("codeBlockRect: end coordinates must not precede the origin");
  }
  requirePositiveFinite(metrics.charW, "codeBlockRect: charW");
  requirePositiveFinite(metrics.lineStep, "codeBlockRect: lineStep");

  const x = Math.floor(originCol * metrics.charW);
  const y = Math.floor(span.originLine * metrics.lineStep);
  const right = Math.ceil(span.endCol * metrics.charW);
  const bottom = Math.ceil(span.endLine * metrics.lineStep);
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
    originCol,
    originLine: span.originLine,
    endCol: span.endCol,
    endLine: span.endLine,
  };
}

/** Largest integer font size that fits, clamped at the documented 8px floor. */
export function autoFitCodeFont(
  lines: ReadonlyArray<CodeLineLike>,
  options: AutoFitCodeOptions,
): AutoFitCodeResult {
  const lineHeight = options.lineHeight ?? 1.5;
  const minFontSize = options.minFontSize ?? MIN_AUTOFIT_FONT_SIZE;
  const charWidthEm = options.charWidthEm ?? JETBRAINS_MONO_ADVANCE_EM;
  requirePositiveFinite(options.preferredFontSize, "autoFitCodeFont: preferredFontSize");
  requirePositiveFinite(minFontSize, "autoFitCodeFont: minFontSize");
  requirePositiveFinite(lineHeight, "autoFitCodeFont: lineHeight");
  requirePositiveFinite(charWidthEm, "autoFitCodeFont: charWidthEm");
  requireNonNegativeFinite(options.maxWidth, "autoFitCodeFont: maxWidth");
  requireNonNegativeFinite(options.maxHeight, "autoFitCodeFont: maxHeight");

  const floorSize = Math.max(1, Math.ceil(minFontSize));
  const preferredSize = Math.max(floorSize, Math.floor(options.preferredFontSize));
  let metrics = measureCodeGrid(lines, {
    fontSize: preferredSize,
    lineHeight,
    charWidthEm,
  });

  for (let candidate = preferredSize; candidate >= floorSize; candidate -= 1) {
    metrics = measureCodeGrid(lines, {
      fontSize: candidate,
      lineHeight,
      charWidthEm,
    });
    if (metrics.width <= options.maxWidth && metrics.height <= options.maxHeight) {
      return {
        fontSize: candidate,
        fits: true,
        overflowX: false,
        overflowY: false,
        metrics,
      };
    }
  }

  metrics = measureCodeGrid(lines, {
    fontSize: floorSize,
    lineHeight,
    charWidthEm,
  });
  return {
    fontSize: floorSize,
    fits: false,
    overflowX: metrics.width > options.maxWidth,
    overflowY: metrics.height > options.maxHeight,
    metrics,
  };
}
