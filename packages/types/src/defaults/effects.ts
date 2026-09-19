/**
 * Neutral values for the `effects.grade` scalars — the values at which each
 * adjustment is a visual no-op. Used to fill partial grade objects and to
 * decide "nothing to emit" (a grade whose every field sits at these values
 * produces no filter). Absent `grade` = off.
 */
export const DEFAULT_GRADE = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
  gamma: 1,
} as const;

/**
 * Defaults for the optional `effects.chromaKey` fields (`color` is required
 * and has no default). `despill: true` — the paired despill pass runs unless
 * explicitly disabled (or the key color is neither green- nor blue-dominant).
 */
export const DEFAULT_CHROMAKEY = {
  similarity: 0.1,
  blend: 0,
  despill: true,
} as const;
