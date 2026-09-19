/**
 * Official dictionary generator: Golden Layout
 *
 * Two-cell asymmetric split with the cells weighted φ:1 (or 1:φ). The
 * "main content + sidebar" pattern that the design article on golden
 * ratio centers on. Wraps the stdlib `goldenSplit` with a UI-friendly
 * parameter surface.
 */

import { goldenSplit } from "@m0saic/dsl-stdlib";
import type { GoldenPrecision } from "@m0saic/dsl-stdlib";
import { toCanonicalM0String } from "@m0saic/dsl";
import { emitLabeledM0c, labelTierParam, resolveLabelTier } from "./labelTier";
import {
  applyForceQuantizationFree,
  forceQuantizationFreeParams,
  type ForceQuantizationFreeParams,
} from "./quantizationFix";
import type { GeneratorDescriptor, GeneratorResult } from "./types";

// ── Descriptor ────────────────────────────────────────────

export const goldenLayoutDescriptor: GeneratorDescriptor = {
  id: "golden-layout",
  title: "Golden Layout",
  description:
    "Two-cell split weighted at the golden ratio (φ ≈ 1.618:1). The classic 'main content + sidebar' layout used in editorial and blog templates.",
  category: "layout",
  group: "Composition",
  params: [
    {
      key: "direction",
      title: "Direction",
      type: "enum",
      default: "horizontal",
      description:
        "How the two cells are arranged. Horizontal = side-by-side (main content + sidebar). Vertical = stacked (hero on top + content below).",
      options: [
        { value: "horizontal", label: "Side-by-side", description: "Two columns — large left, small right (or flipped)." },
        { value: "vertical", label: "Stacked", description: "Two rows — large top, small bottom (or flipped)." },
      ],
    },
    {
      key: "dominantSide",
      title: "Dominant Side",
      type: "enum",
      default: "first",
      description:
        "Which side gets the larger φ-weighted cell. 'First' = left/top, 'Second' = right/bottom.",
      options: [
        { value: "first", label: "First (left / top)", description: "Larger cell on the left (horizontal) or top (vertical)." },
        { value: "second", label: "Second (right / bottom)", description: "Larger cell on the right (horizontal) or bottom (vertical)." },
      ],
    },
    {
      key: "precision",
      title: "Precision",
      type: "enum",
      default: "21/13",
      description:
        "Fibonacci pair used to approximate φ. Higher precision = closer to true φ but longer DSL string. 21/13 is the visually-golden default.",
      options: [
        { value: "13/8",   label: "13:8 (compact)",   description: "Ratio 1.625, error 0.43%. Shortest DSL — best when DSL size matters." },
        { value: "21/13",  label: "21:13 (default)",  description: "Ratio 1.6154, error 0.16%. Visually golden, compact DSL." },
        { value: "34/21",  label: "34:21",            description: "Ratio 1.61905, error 0.063%." },
        { value: "55/34",  label: "55:34",            description: "Ratio 1.61765, error 0.024%." },
        { value: "89/55",  label: "89:55",            description: "Ratio 1.61818, error 0.009%." },
        { value: "144/89", label: "144:89 (precise)", description: "Ratio 1.61798, error 0.003%. Tightest approximation, longest DSL." },
      ],
    },
    labelTierParam({
      defaultTier: "silent",
      description: "signposts/atlas label the φ-weighted cell 'major' and the smaller cell 'minor'.",
    }),
    ...forceQuantizationFreeParams(),
  ],
};

// ── Params ────────────────────────────────────────────────

export type GoldenLayoutGeneratorParams = ForceQuantizationFreeParams & {
  direction?: "horizontal" | "vertical" | string;
  dominantSide?: "first" | "second" | string;
  precision?: GoldenPrecision | string;
  labels?: string;
};

// ── Build ─────────────────────────────────────────────────

const VALID_PRECISION = new Set<GoldenPrecision>([
  "13/8", "21/13", "34/21", "55/34", "89/55", "144/89",
]);

const PROBE_CANVAS = { width: 1920, height: 1080 } as const;

export function goldenLayoutGenerator(params: GoldenLayoutGeneratorParams): GeneratorResult {
  const direction = params.direction === "vertical" ? "vertical" : "horizontal";
  const dominantFirst = (params.dominantSide ?? "first") === "first";
  const precision = VALID_PRECISION.has(params.precision as GoldenPrecision)
    ? (params.precision as GoldenPrecision)
    : "21/13";

  const portableM0 = toCanonicalM0String(goldenSplit({
    axis: direction === "horizontal" ? "col" : "row",
    dominantFirst,
    precision,
  }));
  const fq = applyForceQuantizationFree(portableM0, params);
  const m0 = fq.m0;
  const canvas = fq.idealCanvas ?? PROBE_CANVAS;

  const tier = resolveLabelTier(params.labels);
  // `dominantFirst` controls which logical-source slot holds the φ-weighted
  // cell. The "first" slot is source 0; the smaller cell is source 1.
  // When dominantFirst is false the roles flip.
  const labelsBySourceIndex: Record<number, string> = {};
  if (tier !== "silent") {
    const majorIdx = dominantFirst ? 0 : 1;
    const minorIdx = dominantFirst ? 1 : 0;
    labelsBySourceIndex[majorIdx] = "major";
    labelsBySourceIndex[minorIdx] = "minor";
  }
  const m0c = emitLabeledM0c({
    m0,
    size: canvas,
    app: "golden-layout-generator",
    tier,
    labelsBySourceIndex,
  });

  return {
    m0,
    sourceCount: 2,
    ...(m0c ? { m0c } : {}),
    ...(fq.idealCanvas ? { idealCanvas: fq.idealCanvas } : {}),
  };
}
