import type { TerritoryProfile } from "./compliance";

describe("TerritoryProfile", () => {
  it("carries generic print compliance facts without DVD-specific fields", () => {
    const profile: TerritoryProfile = {
      id: "US",
      label: "United States",
      barcodeSymbology: "upca",
      regionCode: "1",
      videoStandard: "NTSC",
      ratingSystem: "MPAA",
      ratingPlacements: [],
      legalClauseTokens: ["copyright"],
      spineTextDirection: "top-to-bottom",
      bilingual: false,
      requiredEcoMarks: [],
      facts: { rating: "convention" },
    };
    expect(profile.id).toBe("US");
    expect(profile.barcodeSymbology).toBe("upca");
  });
});
