import { comparison as stdlibComparison } from "@m0saic/dsl-stdlib";
import { toCanonicalM0String } from "@m0saic/dsl";
import { emitLabeledM0c, labelTierParam, resolveLabelTier } from "./labelTier";
import {
  applyForceQuantizationFree,
  forceQuantizationFreeParams,
  type ForceQuantizationFreeParams,
} from "./quantizationFix";
import type { GeneratorDescriptor, GeneratorResult } from "./types";

export const comparisonDescriptor: GeneratorDescriptor = {
  id: "comparison",
  title: "Comparison",
  description: "Side-by-side or stacked pairs for A/B layouts. Composed from equal splits with optional divider space.",
  category: "layout",
  group: "Examples",
  params: [
    {
      key: "pairs",
      title: "Pairs",
      type: "int",
      default: 1,
      min: 1,
      max: 4,
      description: "How many A/B pairs to render. Each pair is two equal-size cells. 1 = a single before/after, 4 = four pairs stacked.",
    },
    {
      key: "direction",
      title: "Direction",
      type: "enum",
      default: "horizontal",
      description: "Whether each pair sits side-by-side or stacked vertically.",
      options: [
        { value: "horizontal", label: "Side-by-side", description: "A and B sit next to each other horizontally — the classic before/after split." },
        { value: "vertical", label: "Stacked", description: "A on top, B below — better for tall canvases or when comparing wide content." },
      ],
    },
    {
      key: "labelSpace",
      title: "Label Space",
      type: "float",
      default: 0,
      min: 0,
      max: 0.15,
      step: 0.01,
      description: "Reserved space (as a fraction of canvas) above/beside each cell for labels. 0 = no label area.",
    },
    {
      key: "gutter",
      title: "Gutter",
      type: "float",
      default: 0,
      min: 0,
      max: 0.2,
      step: 0.01,
      description: "Spacing between cells in a pair (and between pairs), as a fraction of cell size. 0 = touching.",
    },
    labelTierParam({
      defaultTier: "silent",
      description: "signposts/atlas alternate cells as a/b across each pair.",
    }),
    ...forceQuantizationFreeParams(),
  ],
};

export type ComparisonGeneratorParams = ForceQuantizationFreeParams & {
  pairs?: number;
  direction?: string;
  labelSpace?: number;
  gutter?: number;
  labels?: string;
};

const PROBE_CANVAS = { width: 1920, height: 1080 } as const;

export function comparisonGenerator(params: ComparisonGeneratorParams): GeneratorResult {
  const result = stdlibComparison({
    pairs: params.pairs,
    direction: params.direction as any,
    labelSpace: params.labelSpace,
    gutter: (params.gutter ?? 0) > 0 ? params.gutter : undefined,
  });
  const portableM0 = toCanonicalM0String(result.m0);
  const fq = applyForceQuantizationFree(portableM0, params);
  const m0 = fq.m0;
  const canvas = fq.idealCanvas ?? PROBE_CANVAS;
  const tier = resolveLabelTier(params.labels);
  // Comparison emits source order (a1, b1, a2, b2, …): each pair
  // contributes its A then its B in turn. Plain "a"/"b" labels alone
  // collide across pairs (the 3rd pair's `a` is indistinguishable from
  // the 1st's), so always include the 1-based pair number. With one
  // pair the labels read as `a1`/`b1`, which is consistent rather than
  // a special case. Both signposts and atlas converge — comparison
  // has no per-cell axis beyond its named A/B sides.
  const labelsBySourceIndex: Record<number, string> = {};
  if (tier !== "silent") {
    for (let i = 0; i < result.tileCount; i++) {
      const pairNum = Math.floor(i / 2) + 1;
      const side = i % 2 === 0 ? "a" : "b";
      labelsBySourceIndex[i] = `${side}${pairNum}`;
    }
  }
  const m0c = emitLabeledM0c({
    m0,
    size: canvas,
    app: "comparison-generator",
    tier,
    labelsBySourceIndex,
  });
  return {
    m0,
    sourceCount: result.tileCount,
    ...(m0c ? { m0c } : {}),
    ...(fq.idealCanvas ? { idealCanvas: fq.idealCanvas } : {}),
  };
}
