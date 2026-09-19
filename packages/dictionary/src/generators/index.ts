// ── Core generators ───────────────────────────────────────
export { grid, gridDescriptor } from "./grid";
export type { GridGeneratorParams } from "./grid";

export { aspectFit, aspectFitDescriptor } from "./aspectFit";
export type { AspectFitGeneratorParams } from "./aspectFit";

export { spotlightGenerator, spotlightDescriptor } from "./spotlightGenerator";
export type { SpotlightGeneratorParams } from "./spotlightGenerator";

export { magazineGenerator, magazineDescriptor } from "./magazineGenerator";
export type { MagazineGeneratorParams } from "./magazineGenerator";

// ── Precision generators ─────────────────────────────────
export { placeRect, placeRectDescriptor } from "./placeRect";
export type { PlaceRectGeneratorParams } from "./placeRect";

export { safeCanvasGenerator, safeCanvasDescriptor } from "./safeCanvas";
export type { SafeCanvasGeneratorParams } from "./safeCanvas";

export { snapGridGenerator, snapGridDescriptor } from "./snapGrid";
export type { SnapGridGeneratorParams } from "./snapGrid";

export { aspectSafeGrid, aspectSafeGridDescriptor } from "./aspectSafeGrid";
export type { AspectSafeGridGeneratorParams } from "./aspectSafeGrid";

// ── Example generators ───────────────────────────────────
export { comparisonGenerator, comparisonDescriptor } from "./comparisonGenerator";
export type { ComparisonGeneratorParams } from "./comparisonGenerator";

export { rankedListGenerator, rankedListDescriptor } from "./rankedListGenerator";
export type { RankedListGeneratorParams } from "./rankedListGenerator";

// ── Composition generators (golden ratio family) ─────────
export { goldenLayoutGenerator, goldenLayoutDescriptor } from "./goldenLayout";
export type { GoldenLayoutGeneratorParams } from "./goldenLayout";

export { goldenSpiralGenerator, goldenSpiralDescriptor } from "./goldenSpiralGenerator";
export type { GoldenSpiralGeneratorParams } from "./goldenSpiralGenerator";

// ── Brand / encoders ──────────────────────────────────────
export { qrCodeGenerator, qrCodeDescriptor } from "./qrCodeGenerator";
export type { QrCodeGeneratorParams } from "./qrCodeGenerator";

export { barcodeGenerator, barcodeDescriptor } from "./barcodeGenerator";
export type { BarcodeGeneratorParams } from "./barcodeGenerator";

// ── Shared types ──────────────────────────────────────────
export type {
  GeneratorDescriptor,
  GeneratorEnumOption,
  GeneratorParamDescriptor,
  GeneratorParamType,
  GeneratorResult,
} from "./types";

// ── All descriptors (for UI enumeration) ──────────────────
// Order matters — UI renders in this sequence, grouped by `group` field.
import { gridDescriptor } from "./grid";
import { aspectFitDescriptor } from "./aspectFit";
import { spotlightDescriptor } from "./spotlightGenerator";
import { magazineDescriptor } from "./magazineGenerator";
import { placeRectDescriptor } from "./placeRect";
import { safeCanvasDescriptor } from "./safeCanvas";
import { snapGridDescriptor } from "./snapGrid";
import { aspectSafeGridDescriptor } from "./aspectSafeGrid";
import { comparisonDescriptor } from "./comparisonGenerator";
import { rankedListDescriptor } from "./rankedListGenerator";
import { goldenLayoutDescriptor } from "./goldenLayout";
import { goldenSpiralDescriptor } from "./goldenSpiralGenerator";
import { qrCodeDescriptor } from "./qrCodeGenerator";
import { barcodeDescriptor } from "./barcodeGenerator";
import type { GeneratorDescriptor } from "./types";

export const descriptors: GeneratorDescriptor[] = [
  // Core — the strongest m0 stories
  gridDescriptor,
  aspectFitDescriptor,
  spotlightDescriptor,
  magazineDescriptor,
  // Precision — quantization-aware / cross-resolution
  placeRectDescriptor,
  safeCanvasDescriptor,
  snapGridDescriptor,
  aspectSafeGridDescriptor,
  // Examples — composition patterns built from primitives
  comparisonDescriptor,
  rankedListDescriptor,
  // Composition — golden ratio family
  goldenLayoutDescriptor,
  goldenSpiralDescriptor,
  // Brand / encoders
  qrCodeDescriptor,
  barcodeDescriptor,
];
