import { mmToPx, mmSpanToPx } from "./units";

export type DielinePanelSpec<PanelId extends string = string> = {
  id: PanelId;
  widthMm: number;
  /** Optional panel-specific safe margin (useful for narrow spines/flaps). */
  safeMarginMm?: number;
};

export type DielineSpec<PanelId extends string = string> = {
  panels: readonly DielinePanelSpec<PanelId>[];
  heightMm: number;
  bleedMm: number;
  safeMarginMm: number;
};

export type PrintRectPx = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ResolvedDielinePanel<PanelId extends string = string> = {
  id: PanelId;
  widthMm: number;
  trim: PrintRectPx;
  safe: PrintRectPx;
};

export type ResolvedDieline<PanelId extends string = string> = {
  dpi: number;
  spec: DielineSpec<PanelId>;
  trimWidthMm: number;
  canvasWidthMm: number;
  canvasHeightMm: number;
  canvas: PrintRectPx;
  bleedBox: PrintRectPx;
  trimBox: PrintRectPx;
  panels: readonly ResolvedDielinePanel<PanelId>[];
  foldLinesX: readonly number[];
};

function assertSpec(spec: DielineSpec): void {
  if (!spec.panels.length) throw new Error("resolveDieline: at least one panel is required");
  if (!Number.isFinite(spec.heightMm) || spec.heightMm <= 0) {
    throw new Error("resolveDieline: heightMm must be positive");
  }
  if (!Number.isFinite(spec.bleedMm) || spec.bleedMm < 0) {
    throw new Error("resolveDieline: bleedMm must be non-negative");
  }
  if (!Number.isFinite(spec.safeMarginMm) || spec.safeMarginMm < 0) {
    throw new Error("resolveDieline: safeMarginMm must be non-negative");
  }
  const ids = new Set<string>();
  for (const panel of spec.panels) {
    if (!panel.id || ids.has(panel.id)) {
      throw new Error(`resolveDieline: panel ids must be unique (got ${JSON.stringify(panel.id)})`);
    }
    if (!Number.isFinite(panel.widthMm) || panel.widthMm <= 0) {
      throw new Error(`resolveDieline: panel ${panel.id} widthMm must be positive`);
    }
    const safeMarginMm = panel.safeMarginMm ?? spec.safeMarginMm;
    if (!Number.isFinite(safeMarginMm) || safeMarginMm < 0) {
      throw new Error(`resolveDieline: panel ${panel.id} safeMarginMm must be non-negative`);
    }
    if (panel.widthMm <= safeMarginMm * 2 || spec.heightMm <= safeMarginMm * 2) {
      throw new Error(`resolveDieline: safe margin collapses panel ${panel.id}`);
    }
    ids.add(panel.id);
  }
}

/**
 * Resolve a physical dieline into one seam-free pixel oracle. All x positions
 * are converted from cumulative millimetres, and widths are endpoint
 * differences; adjacent panels therefore tile exactly at every DPI.
 */
export function resolveDieline<PanelId extends string>(
  spec: DielineSpec<PanelId>,
  dpi: number,
): ResolvedDieline<PanelId> {
  assertSpec(spec);
  if (!Number.isFinite(dpi) || dpi <= 0) {
    throw new Error("resolveDieline: dpi must be positive");
  }

  const trimWidthMm = spec.panels.reduce((sum, panel) => sum + panel.widthMm, 0);
  const canvasWidthMm = trimWidthMm + spec.bleedMm * 2;
  const canvasHeightMm = spec.heightMm + spec.bleedMm * 2;
  const canvasWidth = mmToPx(canvasWidthMm, dpi);
  const canvasHeight = mmToPx(canvasHeightMm, dpi);
  const trimX = mmToPx(spec.bleedMm, dpi);
  const trimY = mmToPx(spec.bleedMm, dpi);
  const trimRight = mmToPx(spec.bleedMm + trimWidthMm, dpi);
  const trimBottom = mmToPx(spec.bleedMm + spec.heightMm, dpi);

  let cumulativeMm = spec.bleedMm;
  const panels: ResolvedDielinePanel<PanelId>[] = [];
  for (const panel of spec.panels) {
    const startMm = cumulativeMm;
    const endMm = startMm + panel.widthMm;
    const x = mmToPx(startMm, dpi);
    const right = mmToPx(endMm, dpi);
    const safeMarginMm = panel.safeMarginMm ?? spec.safeMarginMm;
    const safeX = mmToPx(startMm + safeMarginMm, dpi);
    const safeRight = mmToPx(endMm - safeMarginMm, dpi);
    const safeY = mmToPx(spec.bleedMm + safeMarginMm, dpi);
    const safeBottom = mmToPx(spec.bleedMm + spec.heightMm - safeMarginMm, dpi);
    panels.push({
      id: panel.id,
      widthMm: panel.widthMm,
      trim: { x, y: trimY, width: right - x, height: trimBottom - trimY },
      safe: {
        x: safeX,
        y: safeY,
        width: safeRight - safeX,
        height: safeBottom - safeY,
      },
    });
    cumulativeMm = endMm;
  }

  return {
    dpi,
    spec,
    trimWidthMm,
    canvasWidthMm,
    canvasHeightMm,
    canvas: { x: 0, y: 0, width: canvasWidth, height: canvasHeight },
    bleedBox: { x: 0, y: 0, width: canvasWidth, height: canvasHeight },
    trimBox: {
      x: trimX,
      y: trimY,
      width: trimRight - trimX,
      height: trimBottom - trimY,
    },
    panels,
    foldLinesX: panels.slice(0, -1).map((panel) => panel.trim.x + panel.trim.width),
  };
}

export type DielineOverlayGeometry = {
  trim: PrintRectPx;
  safeRects: readonly PrintRectPx[];
  foldLines: readonly { x: number; y: number; width: number; height: number }[];
};

/** Geometry-only guide data; templates decide colors and labels. */
export function dielineOverlayGeometry<PanelId extends string>(
  resolved: ResolvedDieline<PanelId>,
): DielineOverlayGeometry {
  return {
    trim: resolved.trimBox,
    safeRects: resolved.panels.map((panel) => panel.safe),
    foldLines: resolved.foldLinesX.map((x) => ({
      x,
      y: 0,
      width: 1,
      height: resolved.canvas.height,
    })),
  };
}

/** Resolve one arbitrary mm interval with the same cumulative policy. */
export function resolveMmSpan(startMm: number, endMm: number, dpi: number): PrintRectPx {
  return {
    x: mmToPx(startMm, dpi),
    y: 0,
    width: mmSpanToPx(startMm, endMm, dpi),
    height: 0,
  };
}
