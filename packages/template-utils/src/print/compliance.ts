export type PrintBarcodeSymbology = "upca" | "ean13";
export type PrintVideoStandard = "NTSC" | "PAL";
export type PrintSpineTextDirection = "top-to-bottom" | "bottom-to-top";

export type CompliancePlacement = {
  panelId: string;
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  minSizeMm: number;
  required: boolean;
};

/** Generic structured compliance facts shared by physical-media packaging. */
export type TerritoryProfile = {
  id: string;
  label: string;
  barcodeSymbology: PrintBarcodeSymbology;
  regionCode: string;
  videoStandard: PrintVideoStandard;
  ratingSystem: string;
  ratingPlacements: readonly CompliancePlacement[];
  legalClauseTokens: readonly string[];
  spineTextDirection: PrintSpineTextDirection;
  bilingual: boolean;
  requiredEcoMarks: readonly string[];
  facts: Readonly<Record<string, "verified" | "statutory" | "convention" | "verify-P2">>;
};
