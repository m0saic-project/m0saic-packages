/**
 * Build unique, filename-safe step names from input paths.
 *
 * Two distinct files can share a basename (`a/clip.mp4`, `b/clip.mp4`).
 * Dedupe by appending `_2`, `_3`, … so each step.name is unique inside
 * the pipeline (the engine rejects duplicates with
 * `PIPELINE_STEP_NAME_DUPLICATE`).
 *
 * Lifted from screencap-grid — the shared helper for every N-inputs →
 * N-steps pipeline template (screencap grids, watermark batch, …).
 */

import { slugifyAssetKeyFromPath } from "@m0saic/platform";

export function buildStepNames(inputs: string[]): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  for (const input of inputs) {
    const base = slugifyAssetKeyFromPath(input);
    let name = base;
    let i = 2;
    while (used.has(name)) {
      name = `${base.slice(0, 128 - String(i).length - 1)}_${i}`;
      i++;
    }
    used.add(name);
    out.push(name);
  }
  return out;
}
