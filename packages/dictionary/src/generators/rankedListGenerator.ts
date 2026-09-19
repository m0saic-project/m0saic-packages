import { rankedList as stdlibRankedList } from "@m0saic/dsl-stdlib";
import { toCanonicalM0String } from "@m0saic/dsl";
import { emitLabeledM0c, labelTierParam, resolveLabelTier } from "./labelTier";
import {
  applyForceQuantizationFree,
  forceQuantizationFreeParams,
  type ForceQuantizationFreeParams,
} from "./quantizationFix";
import type { GeneratorDescriptor, GeneratorResult } from "./types";

export const rankedListDescriptor: GeneratorDescriptor = {
  id: "ranked-list",
  title: "Ranked List",
  description: "Weighted stack with progressive size decay. Demonstrates how weight ratios control tile proportion.",
  category: "layout",
  group: "Examples",
  params: [
    {
      key: "count",
      title: "Items",
      type: "int",
      default: 3,
      min: 2,
      max: 10,
      description: "Number of ranked items in the list. Each gets progressively smaller from rank 1 to rank N.",
    },
    {
      key: "decay",
      title: "Decay",
      type: "enum",
      default: "linear",
      description: "How quickly cell sizes shrink down the rankings. Steeper decay emphasizes the top item; gentler decay keeps cells closer in size.",
      options: [
        { value: "linear", label: "Linear", description: "Even step-down — rank 2 is 1 unit smaller than rank 1, rank 3 another unit smaller, etc." },
        { value: "gentle", label: "Gentle", description: "Slower size drop — top items are only modestly larger; low-rank items still get visible space." },
        { value: "steep", label: "Steep", description: "Aggressive size drop — top item is significantly larger; bottom items are small thumbnails." },
      ],
    },
    {
      key: "direction",
      title: "Direction",
      type: "enum",
      default: "vertical",
      description: "Whether the ranking flows top-to-bottom or left-to-right.",
      options: [
        { value: "vertical", label: "Vertical", description: "Rank 1 at the top, descending downward. Reads like a leaderboard or news feed." },
        { value: "horizontal", label: "Horizontal", description: "Rank 1 on the left, descending rightward. Better for wide canvases." },
      ],
    },
    labelTierParam({
      defaultTier: "silent",
      description: "signposts marks the top item 'hero'; atlas adds rank-0..N for each row.",
    }),
    ...forceQuantizationFreeParams(),
  ],
};

export type RankedListGeneratorParams = ForceQuantizationFreeParams & {
  count?: number;
  decay?: string;
  direction?: string;
  labels?: string;
};

const PROBE_CANVAS = { width: 1920, height: 1080 } as const;

export function rankedListGenerator(params: RankedListGeneratorParams): GeneratorResult {
  const result = stdlibRankedList({
    count: params.count,
    decay: params.decay as any,
    direction: params.direction as any,
  });
  const portableM0 = toCanonicalM0String(result.m0);
  const fq = applyForceQuantizationFree(portableM0, params);
  const m0 = fq.m0;
  const canvas = fq.idealCanvas ?? PROBE_CANVAS;
  const tier = resolveLabelTier(params.labels);
  // rankedList emits sources in descending-rank order — source 0 is the
  // largest (hero). Signposts only labels the hero; atlas enumerates
  // every row with `rank-N` (0-indexed to match programmatic consumers).
  const labelsBySourceIndex: Record<number, string> = {};
  if (tier !== "silent") {
    labelsBySourceIndex[0] = "hero";
    if (tier === "atlas") {
      for (let i = 0; i < result.tileCount; i++) {
        labelsBySourceIndex[i] = `rank-${i}`;
      }
    }
  }
  const m0c = emitLabeledM0c({
    m0,
    size: canvas,
    app: "ranked-list-generator",
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
