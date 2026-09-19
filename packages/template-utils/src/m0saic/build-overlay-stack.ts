import type { M0String } from "@m0saic/dsl";
import { finalizeM0saic } from "./utils";

/**
 * Build an overlay stack with `count` paint layers.
 *
 * Examples:
 *  1 -> "F"
 *  3 -> "F{F{F}}"
 */
export function buildOverlayStack(count: number): M0String {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("buildOverlayStack: count must be an integer >= 1");
  }

  let s = "F";
  for (let i = 0; i < count - 1; i++) s += "{F";
  for (let i = 0; i < count - 1; i++) s += "}";

  return finalizeM0saic(s, `buildOverlayStack(${count})`);
}