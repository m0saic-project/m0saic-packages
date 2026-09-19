import * as React from "react";
import { parseM0StringToLogicalFrames } from "@m0saic/dsl";

/**
 * A positioned rectangle in canvas units (pixels). Mirrors the engine's
 * frame geometry — declared locally so this package's public surface
 * doesn't depend on whether `@m0saic/dsl` re-exports its rect type.
 */
export type LayoutRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * `.m0c` label map: `stableKey → label`. Accepts the on-disk shape
 * (`{ text, color? }`) or a bare string. The label's `text` becomes the
 * region NAME you address with `<LayoutRegion name="…">`.
 */
export type LayoutLabelMap = Record<string, { text?: string } | string>;

/** Resolved regions: `regionName → rect`. */
export type LayoutRegionMap = Map<string, LayoutRect>;

function labelText(label: { text?: string } | string): string | undefined {
  const t = typeof label === "string" ? label : label?.text;
  return t && t.trim() !== "" ? t : undefined;
}

/**
 * Pure core of {@link useLayoutRegions} — parses an m0 layout at the given
 * canvas size and joins each label's `stableKey` to its rendered rect,
 * keyed by the label's text (the region name).
 *
 * A label whose stableKey no longer resolves (e.g. its geometry was
 * occluded by a later edit) is skipped — the region simply won't be in the
 * returned map. Use this directly outside React (codegen, tests).
 */
export function computeLayoutRegions(
  m0: string,
  canvasW: number,
  canvasH: number,
  labels: LayoutLabelMap,
): LayoutRegionMap {
  const frames = parseM0StringToLogicalFrames(m0, canvasW, canvasH);
  const byKey = new Map<string, (typeof frames)[number]>();
  for (const f of frames) byKey.set(f.meta.stableKey as string, f);

  const out: LayoutRegionMap = new Map();
  for (const [stableKey, label] of Object.entries(labels)) {
    const name = labelText(label);
    if (!name) continue;
    const f = byKey.get(stableKey);
    if (!f) continue;
    out.set(name, { x: f.x, y: f.y, width: f.width, height: f.height });
  }
  return out;
}

/**
 * React hook: memoized {@link computeLayoutRegions}. Recomputes only when
 * the m0 string, canvas size, or label map identity changes.
 */
export function useLayoutRegions(
  m0: string,
  canvasW: number,
  canvasH: number,
  labels: LayoutLabelMap,
): LayoutRegionMap {
  return React.useMemo(
    () => computeLayoutRegions(m0, canvasW, canvasH, labels),
    [m0, canvasW, canvasH, labels],
  );
}
