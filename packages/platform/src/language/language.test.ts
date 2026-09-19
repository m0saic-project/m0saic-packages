import { matchesLanguageCode, normalizeLanguageCode } from "./language";

describe("normalizeLanguageCode", () => {
  it("returns undefined for nullish or empty input", () => {
    expect(normalizeLanguageCode(undefined)).toBeUndefined();
    expect(normalizeLanguageCode("")).toBeUndefined();
    expect(normalizeLanguageCode("   ")).toBeUndefined();
  });

  it("lowercases and trims", () => {
    expect(normalizeLanguageCode("ENG")).toBe("eng");
    expect(normalizeLanguageCode("  Eng  ")).toBe("eng");
  });

  it("expands ISO 639-1 to ISO 639-2/B", () => {
    expect(normalizeLanguageCode("en")).toBe("eng");
    expect(normalizeLanguageCode("es")).toBe("spa");
    expect(normalizeLanguageCode("ja")).toBe("jpn");
    expect(normalizeLanguageCode("zh")).toBe("zho");
  });

  it("strips locale suffix", () => {
    expect(normalizeLanguageCode("en-US")).toBe("eng");
    expect(normalizeLanguageCode("zh-Hant")).toBe("zho");
    expect(normalizeLanguageCode("pt-BR")).toBe("por");
  });

  it("normalizes ISO 639-2/T to 639-2/B for known pairs", () => {
    expect(normalizeLanguageCode("fre")).toBe("fra");
    expect(normalizeLanguageCode("ger")).toBe("deu");
    expect(normalizeLanguageCode("chi")).toBe("zho");
  });

  it("returns unknown codes unchanged (lowercased)", () => {
    expect(normalizeLanguageCode("xyz")).toBe("xyz");
    expect(normalizeLanguageCode("klingon")).toBe("klingon");
  });
});

describe("matchesLanguageCode", () => {
  it("matches across 639-1 ↔ 639-2/B", () => {
    expect(matchesLanguageCode("eng", "en")).toBe(true);
    expect(matchesLanguageCode("en", "eng")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(matchesLanguageCode("ENG", "eng")).toBe(true);
    expect(matchesLanguageCode("Eng", "EN")).toBe(true);
  });

  it("matches across locale suffixes", () => {
    expect(matchesLanguageCode("en-US", "eng")).toBe(true);
    expect(matchesLanguageCode("eng", "en-GB")).toBe(true);
  });

  it("matches across 639-2/T ↔ 639-2/B pairs", () => {
    expect(matchesLanguageCode("fre", "fra")).toBe(true);
    expect(matchesLanguageCode("ger", "deu")).toBe(true);
    expect(matchesLanguageCode("chi", "zho")).toBe(true);
  });

  it("returns false for distinct languages", () => {
    expect(matchesLanguageCode("eng", "spa")).toBe(false);
    expect(matchesLanguageCode("fr", "de")).toBe(false);
  });

  it("returns false when either side is missing", () => {
    expect(matchesLanguageCode(undefined, "eng")).toBe(false);
    expect(matchesLanguageCode("eng", undefined)).toBe(false);
    expect(matchesLanguageCode(undefined, undefined)).toBe(false);
    expect(matchesLanguageCode("", "eng")).toBe(false);
  });
});
