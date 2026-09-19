/**
 * Official dictionary generator: grid
 *
 * Creates uniform grids with adjustable rows, columns, and spacing.
 * Wraps the stdlib grid builder with a simple, UI-friendly parameter surface.
 */

import { grid as stdlibGrid } from "@m0saic/dsl-stdlib";
import { toCanonicalM0String } from "@m0saic/dsl";
import { emitLabeledM0c, labelTierParam, resolveLabelTier } from "./labelTier";
import {
  applyForceQuantizationFree,
  forceQuantizationFreeParams,
  type ForceQuantizationFreeParams,
} from "./quantizationFix";
import type { GeneratorDescriptor, GeneratorResult } from "./types";

// ── Descriptor ────────────────────────────────────────────

export const gridDescriptor: GeneratorDescriptor = {
  id: "grid",
  title: "Grid",
  description: "Uniform grid with ratio-based gutters. The core building block for multi-tile layouts.",
  category: "grid",
  group: "Core",
  params: [
    {
      key: "rows",
      title: "Rows",
      type: "int",
      default: 3,
      min: 1,
      max: 10,
      description: "Number of horizontal rows in the grid.",
    },
    {
      key: "columns",
      title: "Columns",
      type: "int",
      default: 3,
      min: 1,
      max: 10,
      description: "Number of vertical columns in the grid.",
    },
    {
      key: "gutter",
      title: "Gutter",
      type: "float",
      default: 0,
      min: 0,
      max: 0.2,
      step: 0.01,
      description: "Spacing between cells as a fraction of cell width. 0 = touching cells; 0.04 ≈ 4% gutters.",
    },
    {
      key: "outerGutters",
      title: "Outer Gutters",
      type: "bool",
      default: false,
      description: "Also place gutters around the outer edges of the grid (between the grid and the canvas border).",
    },
    labelTierParam({
      defaultTier: "silent",
      description: "atlas labels every cell with r{row}c{col}; signposts has no landmark (a grid is all cells).",
    }),
    ...forceQuantizationFreeParams(),
  ],
};

// ── Params ────────────────────────────────────────────────

export type GridGeneratorParams = ForceQuantizationFreeParams & {
  columns: number;
  rows: number;
  gutter?: number;
  outerGutters?: boolean;
  labels?: string;
};

// ── Build ─────────────────────────────────────────────────

const PROBE_CANVAS = { width: 1920, height: 1080 } as const;

export function grid(params: GridGeneratorParams): GeneratorResult {
  const {
    columns,
    rows,
    gutter = 0,
    outerGutters = false,
  } = params;

  if (!Number.isInteger(columns) || columns < 1 || columns > 10) {
    throw new Error(`grid: columns must be an integer 1–10, got ${columns}`);
  }
  if (!Number.isInteger(rows) || rows < 1 || rows > 10) {
    throw new Error(`grid: rows must be an integer 1–10, got ${rows}`);
  }
  if (typeof gutter !== "number" || gutter < 0 || gutter > 0.2) {
    throw new Error(`grid: gutter must be 0–0.2, got ${gutter}`);
  }

  const result = stdlibGrid({
    cols: columns,
    rows,
    gutter: gutter > 0 ? gutter : undefined,
    outerGutters,
  });

  // Default: portable weighted-split grid. Opt-in: bake exact pixels at a target
  // canvas (quantization-free, resolution-locked) — for persisted/reused layouts.
  const portableM0 = toCanonicalM0String(result.m0);
  const fq = applyForceQuantizationFree(portableM0, params);
  const m0 = fq.m0;
  const canvas = fq.idealCanvas ?? PROBE_CANVAS;
  const tier = resolveLabelTier(params.labels);
  // A grid has no single landmark — every cell is structurally
  // equivalent. Signposts has nothing meaningful to mark (we don't pick
  // a "hero cell" out of a uniform grid), so only atlas emits labels.
  // Sources iterate row-major: source i = (row=i/cols, col=i%cols).
  const labelsBySourceIndex: Record<number, string> = {};
  if (tier === "atlas") {
    for (let i = 0; i < columns * rows; i++) {
      const row = Math.floor(i / columns);
      const col = i % columns;
      labelsBySourceIndex[i] = `r${row}c${col}`;
    }
  }
  const m0c = emitLabeledM0c({
    m0,
    size: canvas,
    app: "grid-generator",
    tier,
    labelsBySourceIndex,
  });

  return {
    m0,
    sourceCount: columns * rows,
    ...(m0c ? { m0c } : {}),
    ...(fq.idealCanvas ? { idealCanvas: fq.idealCanvas } : {}),
  };
}
