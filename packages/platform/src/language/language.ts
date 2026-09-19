import type { MosaicLanguageCode } from "@m0saic/types";

/**
 * ISO 639-1 (2-letter) → ISO 639-2/B (3-letter) lookup for the languages
 * we ship as named constants in `MOSAIC_LANGUAGE_CODES`. Entries that
 * don't appear here fall back to a direct case-insensitive compare in
 * {@link matchesLanguageCode}, which is fine for the long tail.
 *
 * Note: ISO 639-2/B uses bibliographic codes for several languages where
 * 639-2/T (terminological) differs (e.g. `"fre"` vs `"fra"`). We pick
 * 639-2/B by default because that's what `ffprobe` surfaces from most
 * MKV / MP4 tag formats. The matcher tolerates both forms.
 */
const ISO_639_1_TO_2B: Record<string, string> = {
  en: "eng",
  es: "spa",
  fr: "fra",
  de: "deu",
  it: "ita",
  pt: "por",
  nl: "nld",
  ru: "rus",
  pl: "pol",
  tr: "tur",
  ar: "ara",
  he: "heb",
  hi: "hin",
  bn: "ben",
  ja: "jpn",
  ko: "kor",
  zh: "zho",
  th: "tha",
  vi: "vie",
  id: "ind",
};

/**
 * Pairs of ISO 639-2/B ↔ 639-2/T codes that point at the same language.
 * Each pair is checked symmetrically in {@link normalizeLanguageCode} so
 * `"fre"` and `"fra"` both canonicalize to the same string.
 */
const ISO_639_2_T_TO_B: Record<string, string> = {
  fre: "fra",
  ger: "deu",
  dut: "nld",
  chi: "zho",
  cze: "ces",
  gre: "ell",
  ice: "isl",
  per: "fas",
  rum: "ron",
  slo: "slk",
  alb: "sqi",
  arm: "hye",
  bur: "mya",
  geo: "kat",
  may: "msa",
  mac: "mkd",
  mao: "mri",
  wel: "cym",
};

/**
 * Coerce a raw language tag to a comparable canonical form.
 *
 * Pipeline: trim → lowercase → strip locale suffix (`"en-US"` → `"en"`)
 * → 2-letter → 3-letter via the ISO 639-1 → 639-2/B map → 639-2/T →
 * 639-2/B for the cases where they differ.
 *
 * Returns `undefined` for empty / nullish input. Returns the lowercased
 * stripped value unchanged when no mapping applies (so unfamiliar codes
 * still round-trip and remain comparable to themselves).
 */
export function normalizeLanguageCode(
  code: string | undefined,
): MosaicLanguageCode | undefined {
  if (!code) return undefined;
  const stripped = stripLocale(code.trim().toLowerCase());
  if (stripped.length === 0) return undefined;
  // 2-letter → 3-letter where known
  if (stripped.length === 2) {
    return ISO_639_1_TO_2B[stripped] ?? stripped;
  }
  // 3-letter — normalize 639-2/T to 639-2/B for the pairs we know
  if (stripped.length === 3) {
    return ISO_639_2_T_TO_B[stripped] ?? stripped;
  }
  return stripped;
}

/**
 * Returns `true` when two raw language tags refer to the same language
 * after normalization. Either argument missing → `false`.
 *
 * Examples:
 *   matchesLanguageCode("eng", "en")       === true
 *   matchesLanguageCode("ENG", "eng")      === true
 *   matchesLanguageCode("en-US", "eng")    === true
 *   matchesLanguageCode("fre", "fra")      === true
 *   matchesLanguageCode("eng", "spa")      === false
 */
export function matchesLanguageCode(
  streamLang: string | undefined,
  requested: string | undefined,
): boolean {
  const a = normalizeLanguageCode(streamLang);
  const b = normalizeLanguageCode(requested);
  if (!a || !b) return false;
  return a === b;
}

function stripLocale(code: string): string {
  const i = code.indexOf("-");
  return i >= 0 ? code.slice(0, i) : code;
}
