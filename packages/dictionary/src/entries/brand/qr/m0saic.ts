import { loadEntryM0 } from "../../../loadEntryM0";

/**
 * Brand QR m0 string, loaded from `m0saic.m0c` (carries the
 * `safe-area` label on the 272×272 centre region — see the entry's
 * `metadata.json` for the resolved labels map).
 */
export const m0saic = loadEntryM0(__dirname).m0;

export default m0saic;
