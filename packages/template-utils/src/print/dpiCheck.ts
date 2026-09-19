export type PixelDimensions = { width: number; height: number };
export type PhysicalDimensionsMm = { width: number; height: number };

export type EffectiveDpiResult = {
  x: number;
  y: number;
  min: number;
};

/** Effective raster resolution after placing an asset at a physical size. */
export function effectiveDpi(
  assetPx: PixelDimensions,
  placedMm: PhysicalDimensionsMm,
): EffectiveDpiResult {
  if (
    assetPx.width <= 0 || assetPx.height <= 0 ||
    placedMm.width <= 0 || placedMm.height <= 0 ||
    !Number.isFinite(assetPx.width) || !Number.isFinite(assetPx.height) ||
    !Number.isFinite(placedMm.width) || !Number.isFinite(placedMm.height)
  ) {
    throw new Error("effectiveDpi: pixel and physical dimensions must be positive");
  }
  const x = (assetPx.width / placedMm.width) * 25.4;
  const y = (assetPx.height / placedMm.height) * 25.4;
  return { x, y, min: Math.min(x, y) };
}

export type DpiFloorPolicy = "strict" | "warn" | "off";
export type DpiFloorClassification = "pass" | "warn" | "error" | "off";

export function classifyEffectiveDpi(
  dpi: number,
  policy: DpiFloorPolicy,
  preferredDpi = 300,
  hardFloorDpi = 150,
): DpiFloorClassification {
  if (policy === "off") return "off";
  if (dpi >= preferredDpi) return "pass";
  if (policy === "strict" && dpi < hardFloorDpi) return "error";
  return "warn";
}
