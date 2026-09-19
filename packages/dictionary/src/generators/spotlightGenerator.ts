import { spotlight as stdlibSpotlight } from "@m0saic/dsl-stdlib";
import { toCanonicalM0String } from "@m0saic/dsl";
import { emitLabeledM0c, labelTierParam, resolveLabelTier } from "./labelTier";
import {
  applyForceQuantizationFree,
  forceQuantizationFreeParams,
  type ForceQuantizationFreeParams,
} from "./quantizationFix";
import type { GeneratorDescriptor, GeneratorResult } from "./types";

export const spotlightDescriptor: GeneratorDescriptor = {
  id: "spotlight",
  title: "Spotlight",
  description: "Hero tile with weighted supporting tiles. Composed from splits and weighted ratios.",
  category: "layout",
  group: "Core",
  params: [
    {
      key: "supportCount",
      title: "Support Tiles",
      type: "int",
      default: 3,
      min: 1,
      max: 8,
      description: "Number of small supporting tiles around the hero. Total cells = 1 hero + this many supports.",
    },
    {
      key: "arrangement",
      title: "Arrangement",
      type: "enum",
      default: "bottom",
      description: "Where the support tiles sit relative to the hero. Affects the overall composition shape.",
      options: [
        { value: "bottom", label: "Bottom", description: "Hero on top, supports in a row below. Reads like a feature article with thumbnails." },
        { value: "right", label: "Right", description: "Hero on the left, supports stacked in a column on the right. Magazine-style sidebar." },
        { value: "l-wrap", label: "Corner", description: "Hero in the top-left, supports wrapping along the bottom and right edges in an L shape." },
        { value: "u-wrap", label: "Surround", description: "Hero in the middle, supports wrapping around three or four sides for a framed look." },
      ],
    },
    {
      key: "heroWeight",
      title: "Hero Weight",
      type: "int",
      default: 2,
      min: 1,
      max: 4,
      description: "Relative size of the hero tile vs each support. 2 = hero is twice the support size; 4 = much bigger hero. For true golden-ratio (φ:1) splits, use the dedicated Golden Layout generator instead — Spotlight's multi-tile arrangement keeps integer weights.",
    },
    {
      key: "gutter",
      title: "Gutter",
      type: "float",
      default: 0,
      min: 0,
      max: 0.2,
      step: 0.01,
      description: "Spacing between hero and supports (and between supports), as a fraction of cell size.",
    },
    labelTierParam({
      defaultTier: "silent",
      description: "signposts marks the hero; atlas adds support-0..N for each support cell.",
    }),
    ...forceQuantizationFreeParams(),
  ],
};

export type SpotlightGeneratorParams = ForceQuantizationFreeParams & {
  supportCount?: number;
  arrangement?: string;
  heroWeight?: number;
  gutter?: number;
  labels?: string;
};

const PROBE_CANVAS = { width: 1920, height: 1080 } as const;

export function spotlightGenerator(params: SpotlightGeneratorParams): GeneratorResult {
  const result = stdlibSpotlight({
    supportCount: params.supportCount,
    arrangement: params.arrangement as any,
    heroWeight: params.heroWeight,
    gutter: (params.gutter ?? 0) > 0 ? params.gutter : undefined,
  });
  const portableM0 = toCanonicalM0String(result.m0);
  const fq = applyForceQuantizationFree(portableM0, params);
  const m0 = fq.m0;
  const canvas = fq.idealCanvas ?? PROBE_CANVAS;
  const tier = resolveLabelTier(params.labels);
  // Hero's logical-index depends on the arrangement. For `bottom`,
  // `right`, and `l-wrap` the stdlib builder lays the hero out FIRST
  // and the supports follow — hero at index 0. For `u-wrap` (UI label:
  // "Surround") the supports are split into left and right columns
  // around the hero, so the hero sits AFTER the left-column supports
  // at index ceil(supportCount / 2).
  const supportCount = params.supportCount ?? 3;
  const arrangement = params.arrangement ?? "bottom";
  const heroIdx =
    arrangement === "u-wrap" ? Math.ceil(supportCount / 2) : 0;
  const labelsBySourceIndex: Record<number, string> = {};
  if (tier !== "silent") {
    labelsBySourceIndex[heroIdx] = "hero";
    if (tier === "atlas") {
      // Walk the source list once, labeling each non-hero source as
      // support-{i} in encounter order. That keeps the numbering
      // intuitive regardless of where the hero sits.
      let supportI = 0;
      for (let i = 0; i < result.tileCount; i++) {
        if (i === heroIdx) continue;
        labelsBySourceIndex[i] = `support-${supportI++}`;
      }
    }
  }
  const m0c = emitLabeledM0c({
    m0,
    size: canvas,
    app: "spotlight-generator",
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
