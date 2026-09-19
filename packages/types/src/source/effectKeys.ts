import type { MosaicEffectProps } from "./source";

/**
 * Runtime enumeration of every `MosaicEffectProps` field — the reflection
 * surface for the effect-knob coverage gate (ffmpeg-filter-adoption spec §8:
 * "no effect ships without a minimal example and a pixel test").
 *
 * The two `_assert*` checks below make this list COMPILE-TIME exhaustive in
 * both directions: adding a field to `MosaicEffectProps` without adding it
 * here (or vice versa) fails the types build — the audit can never silently
 * drift from the type.
 */
export const MOSAIC_EFFECT_PROP_KEYS = [
  "rounding",
  "stroke",
  "dropShadow",
  "rotate",
  "camera",
  "grade",
  "blur",
  "noise",
  "pixelize",
  "chromaKey",
  "zoomInPercent",
  "fadeInMs",
  "fadeOutMs",
] as const;

export type MosaicEffectPropKey = (typeof MOSAIC_EFFECT_PROP_KEYS)[number];

type MissingFromList = Exclude<keyof MosaicEffectProps, MosaicEffectPropKey>;
type ExtraInList = Exclude<MosaicEffectPropKey, keyof MosaicEffectProps>;
const _assertNoMissingKeys: MissingFromList extends never ? true : never = true;
const _assertNoExtraKeys: ExtraInList extends never ? true : never = true;
void _assertNoMissingKeys;
void _assertNoExtraKeys;
