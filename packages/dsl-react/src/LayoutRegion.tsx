import * as React from "react";
import {
  useLayoutRegions,
  type LayoutLabelMap,
  type LayoutRegionMap,
} from "./useLayoutRegions";

type LayoutCtxValue = {
  regions: LayoutRegionMap;
  canvasW: number;
  canvasH: number;
};

const LayoutCtx = React.createContext<LayoutCtxValue | null>(null);

export type LayoutRegionsProps = {
  /** The m0 layout string (typically from a signed-off `.m0c`). */
  m0: string;
  /** Canvas width the layout is authored against, in pixels. */
  canvasW: number;
  /** Canvas height the layout is authored against, in pixels. */
  canvasH: number;
  /** `stableKey → label` map (the `.m0c` labels). Label text = region name. */
  labels: LayoutLabelMap;
  /**
   * Uniform scale applied to the whole stage. Region coordinates stay in
   * canvas units; the stage is rendered at canvas size and scaled. Default 1.
   */
  scale?: number;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

/**
 * Stage that resolves an m0 layout into named regions and provides them to
 * descendant `<LayoutRegion>`s. Renders a `position: relative` box scaled to
 * the viewport; children position absolutely within the canvas coordinate
 * space.
 */
export function LayoutRegions({
  m0,
  canvasW,
  canvasH,
  labels,
  scale = 1,
  className,
  style,
  children,
}: LayoutRegionsProps): React.ReactElement {
  const regions = useLayoutRegions(m0, canvasW, canvasH, labels);
  const ctx = React.useMemo<LayoutCtxValue>(
    () => ({ regions, canvasW, canvasH }),
    [regions, canvasW, canvasH],
  );
  return (
    <LayoutCtx.Provider value={ctx}>
      <div
        className={className}
        style={{
          position: "relative",
          width: canvasW * scale,
          height: canvasH * scale,
          overflow: "hidden",
          ...style,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: canvasW,
            height: canvasH,
            transform: scale === 1 ? undefined : `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          {children}
        </div>
      </div>
    </LayoutCtx.Provider>
  );
}

export type LayoutRegionProps = {
  /** The region name (a label's text in the `.m0c`). */
  name: string;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

/**
 * Absolutely-positioned box at the named region's rect. Must be rendered
 * inside a `<LayoutRegions>`. If the layout has no region with this name it
 * renders nothing (and warns in development) — so a stale name fails loud in
 * dev and silent in prod rather than throwing.
 */
export function LayoutRegion({
  name,
  className,
  style,
  children,
}: LayoutRegionProps): React.ReactElement | null {
  const ctx = React.useContext(LayoutCtx);
  if (!ctx) {
    throw new Error("LayoutRegion must be rendered inside <LayoutRegions>.");
  }
  const rect = ctx.regions.get(name);
  if (!rect) {
    if (
      typeof process !== "undefined" &&
      process.env &&
      process.env.NODE_ENV !== "production"
    ) {
      // eslint-disable-next-line no-console
      console.warn(`LayoutRegion: no region named "${name}" in this layout.`);
    }
    return null;
  }
  return (
    <div
      data-layout-region={name}
      className={className}
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
