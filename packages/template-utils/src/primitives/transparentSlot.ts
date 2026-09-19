import type { MosaicLavfiSource } from "@m0saic/types";

/**
 * Occupies a paint slot but renders fully transparent.
 *
 * Uses lavfi + visual.opacity so we don't depend on "#00000000" parsing.
 */
export function transparentSlot(): MosaicLavfiSource {
  return {
    type: "lavfi",
    color: "#000000",
    visual: { opacity: 0 },
  };
}