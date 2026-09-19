/**
 * Official dictionary generator: Magazine
 *
 * Builds hero+sidebar+strip editorial layouts from weighted primitives.
 * Wraps the existing magazine builder with a UI-friendly parameter surface.
 */

import { toCanonicalM0String } from "@m0saic/dsl";
import { magazine } from "./magazine";
import { emitLabeledM0c, labelTierParam, resolveLabelTier } from "./labelTier";
import {
  applyForceQuantizationFree,
  forceQuantizationFreeParams,
  type ForceQuantizationFreeParams,
} from "./quantizationFix";
import type { GeneratorDescriptor, GeneratorResult } from "./types";

// ── Descriptor ────────────────────────────────────────────

export const magazineDescriptor: GeneratorDescriptor = {
  id: "magazine",
  title: "Magazine",
  description:
    "Editorial composition with hero, sidebar, and strip sections. Built from weighted splits.",
  category: "layout",
  group: "Core",
  params: [
    {
      key: "proportions",
      title: "Proportions",
      type: "enum",
      default: "custom",
      description:
        "How section weights are chosen. 'Custom' lets you tune each section's weight. 'Golden ratio' picks φ-based weights (hero:sidebar, top:bottom both at ~1.618:1) and hides the manual weight sliders.",
      options: [
        { value: "custom", label: "Custom (manual)", description: "Tune each section weight by hand." },
        { value: "golden", label: "Golden ratio (φ)", description: "Auto: hero:sidebar = top:bottom = φ:1 ≈ 1.618:1. Skips manual weight tuning." },
      ],
    },
    {
      key: "heroWeight",
      title: "Hero Weight",
      type: "int",
      default: 2,
      min: 1,
      max: 6,
      description: "Relative width of the hero (left) section vs the sidebar. Higher = bigger hero, smaller sidebar.",
      visibleWhen: { proportions: "custom" },
    },
    {
      key: "sidebarWeight",
      title: "Sidebar Weight",
      type: "int",
      default: 1,
      min: 1,
      max: 6,
      description: "Relative width of the sidebar (right) section vs the hero. Higher = wider sidebar.",
      visibleWhen: { proportions: "custom" },
    },
    {
      key: "sidebarCount",
      title: "Sidebar Tiles",
      type: "int",
      default: 2,
      min: 1,
      max: 6,
      description: "Number of stacked tiles in the sidebar. More tiles = each one gets a smaller vertical share.",
    },
    {
      key: "topWeight",
      title: "Top Weight",
      type: "int",
      default: 2,
      min: 1,
      max: 6,
      description: "Relative height of the top section (hero + sidebar) vs the bottom strip.",
      visibleWhen: { proportions: "custom" },
    },
    {
      key: "bottomWeight",
      title: "Bottom Weight",
      type: "int",
      default: 1,
      min: 1,
      max: 6,
      description: "Relative height of the bottom strip vs the top section. Higher = taller bottom row.",
      visibleWhen: { proportions: "custom" },
    },
    {
      key: "bottomCount",
      title: "Bottom Tiles",
      type: "int",
      default: 3,
      min: 1,
      max: 8,
      description: "Number of tiles in the bottom strip, laid out horizontally.",
    },
    {
      key: "gutter",
      title: "Gutter",
      type: "float",
      default: 0,
      min: 0,
      max: 0.2,
      step: 0.01,
      description: "Spacing between sections and tiles, as a fraction of cell size. 0 = touching.",
    },
    labelTierParam({
      defaultTier: "silent",
      description: "signposts marks the hero 'feature'; atlas enumerates sidebar-N and bottom-N for the strip cells.",
    }),
    ...forceQuantizationFreeParams(),
  ],
};

// ── Params ────────────────────────────────────────────────

export type MagazineGeneratorParams = ForceQuantizationFreeParams & {
  proportions?: "custom" | "golden" | string;
  heroWeight?: number;
  sidebarWeight?: number;
  sidebarCount?: number;
  topWeight?: number;
  bottomWeight?: number;
  bottomCount?: number;
  gutter?: number;
  labels?: string;
};

// ── Build ─────────────────────────────────────────────────

// Golden ratio Fibonacci pair used when `proportions: "golden"` is selected.
// 21:13 ≈ 1.6154 — visually golden with compact integer weights that compose
// cleanly with the magazine builder's other weight params.
const GOLDEN_LARGE = 21;
const GOLDEN_SMALL = 13;

const PROBE_CANVAS = { width: 1920, height: 1080 } as const;

export function magazineGenerator(params: MagazineGeneratorParams): GeneratorResult {
  const golden = params.proportions === "golden";
  const sidebarCount = params.sidebarCount ?? 2;
  const bottomCount = params.bottomCount ?? 3;

  const result = magazine({
    // In golden mode override the four section weights with the φ:1
    // Fibonacci pair (hero:sidebar = top:bottom = 21:13). Sidebar/bottom
    // counts and gutter remain user-controlled.
    heroWeight:    golden ? GOLDEN_LARGE : params.heroWeight,
    sidebarWeight: golden ? GOLDEN_SMALL : params.sidebarWeight,
    sidebarCount,
    topWeight:     golden ? GOLDEN_LARGE : params.topWeight,
    bottomWeight:  golden ? GOLDEN_SMALL : params.bottomWeight,
    bottomCount,
    gutter:        (params.gutter ?? 0) > 0 ? params.gutter : undefined,
  });

  const portableM0 = toCanonicalM0String(result.m0);
  const fq = applyForceQuantizationFree(portableM0, params);
  const m0 = fq.m0;
  const canvas = fq.idealCanvas ?? PROBE_CANVAS;
  const tier = resolveLabelTier(params.labels);
  // Magazine's source layout: source 0 = hero, sources 1..sidebarCount =
  // sidebar tiles (top to bottom), sources (1 + sidebarCount)..end =
  // bottom strip tiles (left to right). Signposts marks only the hero —
  // the sidebar / bottom strip are multi-cell regions whose individual
  // tiles need atlas-tier enumeration to label cleanly.
  const labelsBySourceIndex: Record<number, string> = {};
  if (tier !== "silent") {
    labelsBySourceIndex[0] = "feature";
    if (tier === "atlas") {
      for (let i = 0; i < sidebarCount; i++) {
        labelsBySourceIndex[1 + i] = `sidebar-${i}`;
      }
      for (let i = 0; i < bottomCount; i++) {
        labelsBySourceIndex[1 + sidebarCount + i] = `bottom-${i}`;
      }
    }
  }
  const m0c = emitLabeledM0c({
    m0,
    size: canvas,
    app: "magazine-generator",
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
