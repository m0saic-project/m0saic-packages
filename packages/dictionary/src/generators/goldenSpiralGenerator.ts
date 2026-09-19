/**
 * Official dictionary generator: Golden Spiral
 *
 * Recursive golden splits forming a Fibonacci/golden spiral composition.
 * Wraps the stdlib `goldenSpiral` builder.
 */

import { goldenSpiral } from "@m0saic/dsl-stdlib";
import type { GoldenSpiralCorner, GoldenPrecision } from "@m0saic/dsl-stdlib";
import { toCanonicalM0String } from "@m0saic/dsl";
import { emitLabeledM0c, labelTierParam, resolveLabelTier } from "./labelTier";
import type { GeneratorDescriptor, GeneratorResult } from "./types";

// ── Descriptor ────────────────────────────────────────────

export const goldenSpiralDescriptor: GeneratorDescriptor = {
  id: "golden-spiral",
  title: "Golden Spiral",
  description:
    "Recursive golden-ratio splits that approximate a Fibonacci spiral. Each level golden-splits the larger cell on the perpendicular axis, creating curved eye-flow through the composition.",
  category: "layout",
  group: "Composition",
  params: [
    {
      key: "depth",
      title: "Depth",
      type: "int",
      default: 4,
      min: 2,
      max: 7,
      description:
        "Number of recursive splits. 2–3 reads as a basic 'L' composition; 4–5 is the classic recognizable spiral; 6+ adds detail at the cost of longer DSL.",
    },
    {
      key: "direction",
      title: "Direction",
      type: "enum",
      default: "br",
      description:
        "Which corner the spiral originates from / wraps around. Determines the visual flow.",
      options: [
        { value: "tl", label: "Top-left",     description: "Spiral wraps clockwise from the top-left corner." },
        { value: "tr", label: "Top-right",    description: "Spiral wraps counter-clockwise from the top-right corner." },
        { value: "bl", label: "Bottom-left",  description: "Spiral wraps counter-clockwise from the bottom-left corner." },
        { value: "br", label: "Bottom-right", description: "Spiral wraps clockwise from the bottom-right corner. The classic Fibonacci spiral orientation." },
      ],
    },
    {
      key: "precision",
      title: "Precision",
      type: "enum",
      default: "21/13",
      description: "Fibonacci pair used at each split level. Higher precision = closer to true φ but longer DSL.",
      options: [
        { value: "13/8",   label: "13:8 (compact)" },
        { value: "21/13",  label: "21:13 (default)" },
        { value: "34/21",  label: "34:21" },
        { value: "55/34",  label: "55:34" },
      ],
    },
    labelTierParam({
      defaultTier: "silent",
      description: "signposts marks the largest 'head' cell (the dominant block where hero content goes). atlas adds level-1..N — the inner rings, counting inward from the head (level-1 = first ring inside head, level-depth = innermost speck).",
    }),
  ],
};

// ── Params ────────────────────────────────────────────────

export type GoldenSpiralGeneratorParams = {
  depth: number;
  direction?: GoldenSpiralCorner | string;
  precision?: GoldenPrecision | string;
  labels?: string;
};

// ── Build ─────────────────────────────────────────────────

const VALID_DIR = new Set<GoldenSpiralCorner>(["tl", "tr", "bl", "br"]);
const VALID_PRECISION = new Set<GoldenPrecision>([
  "13/8", "21/13", "34/21", "55/34", "89/55", "144/89",
]);

const PROBE_CANVAS = { width: 1920, height: 1080 } as const;

export function goldenSpiralGenerator(params: GoldenSpiralGeneratorParams): GeneratorResult {
  const depth = Number.isInteger(params.depth) ? params.depth : 4;
  const direction = VALID_DIR.has(params.direction as GoldenSpiralCorner)
    ? (params.direction as GoldenSpiralCorner)
    : "br";
  const precision = VALID_PRECISION.has(params.precision as GoldenPrecision)
    ? (params.precision as GoldenPrecision)
    : "21/13";

  const m0 = toCanonicalM0String(goldenSpiral({ depth, direction, precision }));
  const tier = resolveLabelTier(params.labels);
  const sourceCount = depth + 1;
  // Source-walk order does NOT follow spiral size, because each
  // recursive wrap level decides whether the larger half (the outer
  // leaf at that level) comes first or second in source order via
  // `dominantFirst`. So we mirror the stdlib's wrap logic: walk
  // levels from outermost (0) to deepest (depth-1), tracking the
  // [base, size] of the remaining recursive subtree. At each step the
  // outer leaf for that wrap lands at either `base` (dominantFirst=true)
  // or `base+size-1` (dominantFirst=false).
  //
  // Naming convention (design-language, not math):
  //   - `head` = the LARGEST cell (outermost wrap level=0) — where
  //     the hero content goes; matches the spotlight/magazine
  //     "hero"/"feature" convention.
  //   - `level-N` = inner rings, counting INWARD from the head:
  //     level-1 = first ring inside head (next-largest), level-depth =
  //     innermost speck (the original `F` after all wraps).
  const labelsBySourceIndex: Record<number, string> = {};
  if (tier !== "silent") {
    // Mirror stdlib's per-level dominantFirst computation.
    const cornerToInitial = {
      tl: { dominantFirstStart: false, clockwise: true },
      tr: { dominantFirstStart: true, clockwise: false },
      bl: { dominantFirstStart: false, clockwise: false },
      br: { dominantFirstStart: true, clockwise: true },
    } as const;
    const { dominantFirstStart, clockwise } = cornerToInitial[direction];

    let base = 0;
    let size = sourceCount;
    for (let level = 0; level < depth; level++) {
      const dominantFirst = level % 2 === 0
        ? dominantFirstStart
        : (clockwise ? !dominantFirstStart : dominantFirstStart);
      // level=0 is the outermost wrap → that cell is the largest → "head".
      // level=1..depth-1 are the inner wraps → "level-{level}".
      // At signposts we only emit head (level=0); inner rings stay
      // unlabeled.
      const label = level === 0
        ? "head"
        : tier === "atlas" ? `level-${level}` : null;
      if (dominantFirst) {
        if (label) labelsBySourceIndex[base] = label;
        base += 1;
        size -= 1;
      } else {
        if (label) labelsBySourceIndex[base + size - 1] = label;
        size -= 1;
      }
    }
    // After all wraps, `base` indexes the innermost slot — the original
    // `F`. At atlas it gets the deepest level-{depth} label; signposts
    // leaves it unlabeled.
    if (tier === "atlas") {
      labelsBySourceIndex[base] = `level-${depth}`;
    }
  }
  const m0c = emitLabeledM0c({
    m0,
    size: PROBE_CANVAS,
    app: "golden-spiral-generator",
    tier,
    labelsBySourceIndex,
  });

  return {
    m0,
    sourceCount,
    ...(m0c ? { m0c } : {}),
  };
}
