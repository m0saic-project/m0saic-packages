/**
 * Canonical m0saic language code.
 *
 * **Preferred form: ISO 639-2/B 3-letter lowercase.** Examples:
 *
 *   - `"eng"` — English
 *   - `"spa"` — Spanish
 *   - `"fra"` — French
 *   - `"deu"` — German
 *
 * The underlying type is `string` because raw values come from external
 * sources (ffprobe stream tags, user input, sidecar files) and may arrive
 * as ISO 639-1 2-letter codes (`"en"`), with locale suffixes (`"en-US"`),
 * or in mixed case (`"ENG"`). Templates and engine code that compare or
 * match language codes should first normalize via
 * `normalizeLanguageCode` from `@m0saic/platform/language`.
 *
 * This type exists to give a single named anchor for "the thing m0saic
 * means by a language code" across templates, types, and runtime —
 * different packages all reference the same notion.
 */
export type MosaicLanguageCode = string;

/**
 * Common ISO 639-2/B codes m0saic templates may reference by name.
 *
 * Templates can use either named constants (`MOSAIC_LANGUAGE_CODES.ENGLISH`)
 * or raw 3-letter codes (`"eng"`) interchangeably — both produce the same
 * canonical form. This list is non-exhaustive; raw codes for unlisted
 * languages are equally valid.
 */
export const MOSAIC_LANGUAGE_CODES = {
  ENGLISH: "eng",
  SPANISH: "spa",
  FRENCH: "fra",
  GERMAN: "deu",
  ITALIAN: "ita",
  PORTUGUESE: "por",
  DUTCH: "nld",
  RUSSIAN: "rus",
  POLISH: "pol",
  TURKISH: "tur",
  ARABIC: "ara",
  HEBREW: "heb",
  HINDI: "hin",
  BENGALI: "ben",
  JAPANESE: "jpn",
  KOREAN: "kor",
  CHINESE: "zho",
  THAI: "tha",
  VIETNAMESE: "vie",
  INDONESIAN: "ind",
} as const satisfies Record<string, MosaicLanguageCode>;
