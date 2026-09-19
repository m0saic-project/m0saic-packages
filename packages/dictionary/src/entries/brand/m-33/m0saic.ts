import { loadEntryM0 } from "../../../loadEntryM0";

/**
 * Brand M-33 m0 string, loaded from `m0saic.m0c`. The entry's masks
 * (per-StableKey clipping silhouettes for the 8 non-rect cells) ride
 * inside the same file and surface at runtime as `entry.masks`.
 */
export const m0saic = loadEntryM0(__dirname).m0;

export default m0saic;
