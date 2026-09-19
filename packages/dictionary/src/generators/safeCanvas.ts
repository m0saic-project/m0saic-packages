/**
 * Official dictionary generator: Safe Canvas
 *
 * Computes the largest canvas dimensions where a guttered grid renders
 * with zero pixel distortion, then emits the grid at those dimensions.
 */

import { safeCanvas as stdlibSafeCanvas } from "@m0saic/dsl-stdlib";
import { toCanonicalM0String } from "@m0saic/dsl";
import { emitLabeledM0c, labelTierParam, resolveLabelTier } from "./labelTier";
import type { GeneratorDescriptor, GeneratorResult } from "./types";

export const safeCanvasDescriptor: GeneratorDescriptor = {
  id: "safe-canvas",
  title: "Quantization-Free Canvas",
  description:
    "Find the largest canvas where a guttered grid has zero pixel rounding. Eliminates quantization artifacts.",
  category: "grid",
  group: "Precision",
  params: [
    { key: "rows", title: "Rows", type: "int", default: 6, min: 1, max: 10, description: "Number of rows in the grid." },
    { key: "columns", title: "Columns", type: "int", default: 8, min: 1, max: 10, description: "Number of columns in the grid." },
    {
      key: "gutter",
      title: "Gutter",
      type: "float",
      default: 0.1,
      min: 0,
      max: 0.2,
      step: 0.01,
      description: "Spacing between cells, as a fraction of cell width. 0 = no gutters; 0.1 = 10% gutters.",
    },
    {
      key: "outerGutters",
      title: "Outer Gutters",
      type: "bool",
      default: false,
      description: "Also include gutters on the outer edges of the grid (around the perimeter), not just between cells.",
    },
    {
      key: "maxWidth",
      title: "Max Width",
      type: "int",
      default: 1920,
      min: 1,
      max: 7680,
      description: "Upper bound for the searched canvas width. The actual canvas the algorithm picks is the largest multiple of the grid total weight that fits under this cap.",
    },
    {
      key: "maxHeight",
      title: "Max Height",
      type: "int",
      default: 1080,
      min: 1,
      max: 4320,
      description: "Upper bound for the searched canvas height. Same logic as Max Width but for the vertical axis.",
    },
    labelTierParam({
      defaultTier: "silent",
      description: "atlas labels every cell with r{row}c{col}; signposts has no landmark (a uniform grid is all cells). Outer-gutter nulls are not labeled.",
    }),
  ],
};

export type SafeCanvasGeneratorParams = {
  columns: number;
  rows: number;
  gutter?: number;
  outerGutters?: boolean;
  maxWidth?: number;
  maxHeight?: number;
  labels?: string;
};

export function safeCanvasGenerator(params: SafeCanvasGeneratorParams): GeneratorResult {
  const result = stdlibSafeCanvas({
    cols: params.columns,
    rows: params.rows,
    gutter: (params.gutter ?? 0) > 0 ? params.gutter : undefined,
    outerGutters: params.outerGutters,
    maxWidth: params.maxWidth,
    maxHeight: params.maxHeight,
  });

  const m0 = toCanonicalM0String(result.gridResult.m0);
  const tier = resolveLabelTier(params.labels);
  // Mirrors the grid generator: a uniform grid has no single landmark,
  // so silent + signposts are both no-ops. atlas enumerates every cell
  // as r{row}c{col}. Outer-gutter nulls (when `outerGutters: true`)
  // are not labeled — they're canvas margin, not addressable cells.
  const labelsBySourceIndex: Record<number, string> = {};
  if (tier === "atlas") {
    for (let i = 0; i < params.columns * params.rows; i++) {
      const row = Math.floor(i / params.columns);
      const col = i % params.columns;
      labelsBySourceIndex[i] = `r${row}c${col}`;
    }
  }
  const m0c = emitLabeledM0c({
    m0,
    size: { width: result.width, height: result.height },
    app: "safe-canvas-generator",
    tier,
    labelsBySourceIndex,
  });

  return {
    m0,
    sourceCount: params.columns * params.rows,
    idealCanvas: { width: result.width, height: result.height },
    ...(m0c ? { m0c } : {}),
  };
}
