/**
 * Media-free built-in demo story — rendered on null/absent props so the
 * template previews with zero setup (Templates page, null-props E2E case,
 * `m0saic make` with no --props).
 *
 * Every section pins its length via `overrides.durationMs`, so no audio is
 * probed. The values are deliberately unequal and non-round (they mirror the
 * committed demo project's minted narration clips) — a timing model that
 * divides time evenly instead of reading per-section durations fails
 * visibly against this fixture.
 */

import type { StoryDocument } from "./props";

export const DEMO_STORY: StoryDocument = {
  schemaVersion: 1,
  title: "Every Level of a City Block",
  subtitle: "From the sidewalk to the skyline",
  brand: {
    accentColor: "#2f6df6",
    backgroundColor: "#0d0f12",
    textColor: "#f4f6f8",
  },
  // No `outputs` on purpose: the demo adopts the requested canvas
  // orientation, so `-w 1080 -h 1920` previews portrait out of the box.
  sections: [
    {
      id: "sidewalk",
      title: "Street Level",
      narrationText:
        "Start at the pavement. Everything a block does for a person happens in the first three metres.",
      overrides: { durationMs: 2640 },
    },
    {
      id: "storefront",
      title: "The Storefront",
      narrationText:
        "One step up, the block starts selling. Glass, signage, and a doorway that decides who comes in.",
      overrides: { durationMs: 4120 },
    },
    {
      id: "upper-floors",
      title: "The Upper Floors",
      narrationText:
        "Above the shopfront the block goes quiet: offices, apartments, and the windows nobody looks up at.",
      overrides: { durationMs: 3360 },
    },
    {
      id: "skyline",
      title: "The Skyline",
      narrationText:
        "At the top the block stops being architecture and becomes silhouette — the shape the city remembers.",
      overrides: { durationMs: 5080 },
    },
  ],
};
