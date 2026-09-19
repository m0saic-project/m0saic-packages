/* Per-KPI glyphs — GitHub Octicon (MIT) SVG path `d` strings, 24×24 viewBox.
 * Drawn as inline-mask lavfi tiles on the stat-card accent chip (NOT media images,
 * which mis-lay-out the card). Keyed by PulseKpi.key.
 *
 * The catalog itself moved to `alpine/_shared/alpine-glyphs.ts` (2026-08-20)
 * so the alpine cards' friendly `icon` knob and these programmatic callers
 * share one source of truth. This alias keeps every pulse-beat import working. */
import { ALPINE_GLYPHS } from "../../../alpine/_shared/alpine-glyphs";

export const KPI_GLYPHS: Record<string, string> = ALPINE_GLYPHS;
