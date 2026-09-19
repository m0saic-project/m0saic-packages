import { toCanonicalM0String } from "@m0saic/dsl";
import type { GeneratorDescriptor, GeneratorResult } from "./types";

export const bentoGridDescriptor: GeneratorDescriptor = {
  id: "bento-grid",
  title: "Bento Grid",
  description: "Irregular grids with mixed-size tiles \u2014 the dashboard/showcase aesthetic.",
  category: "grid",
  group: "Examples",
  params: [
    {
      key: "base",
      title: "Base Grid",
      type: "enum",
      default: "3x3",
      description: "The underlying row × column structure. Bento variants live within this grid by merging adjacent cells into larger tiles.",
      options: [
        { value: "3x3", label: "3\u00D73", description: "Compact 3-row, 3-column base — classic dashboard look with 3 variant arrangements." },
        { value: "4x3", label: "4\u00D73", description: "Wider 4-row, 3-column base — more horizontal real estate, 2 arrangements." },
        { value: "4x4", label: "4\u00D74", description: "Square-ish 4-row, 4-column base — most detail-rich, 2 arrangements." },
      ],
    },
    {
      key: "variant",
      title: "Variant",
      type: "int",
      default: 1,
      min: 1,
      max: 3,
      description: "Which tile-merging pattern to use within the chosen base grid. 1 is the most balanced; higher numbers introduce more tile-size variation.",
    },
  ],
};

const ARRANGEMENTS: Record<string, string[]> = {
  "3x3": [
    "3[2(1,1),2(1,1),3(1,1,1)]",
    "2[3(1,1,1),2(1,2[1,1])]",
    "2(2[1,1],2[2(1,1),2(1,1)])",
  ],
  "4x3": [
    "2[4(0,1,1,1),4(1,1,1,1)]",
    "2[3(1,1,1),4(0,1,1,1)]",
  ],
  "4x4": [
    "2[4(0,1,1,1),4(1,1,1,1)]",
    "3[4(1,1,1,1),4(1,1,1,1),4(0,1,1,1)]",
  ],
};

export type BentoGridGeneratorParams = {
  base?: string;
  variant?: number;
};

export function bentoGridGenerator(params: BentoGridGeneratorParams): GeneratorResult {
  const base = params.base ?? "3x3";
  const variant = params.variant ?? 1;

  const arrangements = ARRANGEMENTS[base];
  if (!arrangements) {
    throw new Error(`bentoGrid: unknown base "${base}".`);
  }

  const idx = variant - 1;
  if (idx < 0 || idx >= arrangements.length) {
    throw new Error(`bentoGrid: variant ${variant} out of range for base "${base}" (1–${arrangements.length})`);
  }

  const m0 = toCanonicalM0String(arrangements[idx]);
  let sourceCount = 0;
  for (let i = 0; i < m0.length; i++) {
    if (m0[i] === "1") sourceCount++;
  }

  return { m0, sourceCount };
}
