import { loadEntryM0 } from "../../../loadEntryM0";

/**
 * Brand m0saic-pattern m0 string, loaded from `m0saic.m0c`. The entry's
 * rank sets (diag / cascade / radial, keyed by stableKey) ride inside the
 * same file and surface at runtime as `entry.rankSets`.
 */
export const m0saic = loadEntryM0(__dirname).m0;

export default m0saic;
