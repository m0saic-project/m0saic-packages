import {
  MOSAIC_TELEMETRY_CATEGORIES,
  isMosaicTelemetryCategory,
  type MosaicTelemetryCategory,
} from "./category";

describe("MOSAIC_TELEMETRY_CATEGORIES", () => {
  it("exposes the seven expected categories in order", () => {
    expect(MOSAIC_TELEMETRY_CATEGORIES).toEqual([
      "engine.template",
      "engine.plan",
      "engine.runtime",
      "engine.resolve",
      "platform.jobs",
      "platform.sets",
      "platform.batch",
    ]);
  });

  it("is a closed registry — narrowing covers every member", () => {
    // A switch with assertNever in the default branch is the
    // strongest test: any future widening would fail to compile.
    const seen = new Set<string>();
    for (const c of MOSAIC_TELEMETRY_CATEGORIES) {
      const cat: MosaicTelemetryCategory = c;
      switch (cat) {
        case "engine.template":
        case "engine.plan":
        case "engine.runtime":
        case "engine.resolve":
        case "platform.jobs":
        case "platform.sets":
        case "platform.batch":
          seen.add(cat);
          break;
        default: {
          const _exhaustive: never = cat;
          void _exhaustive;
        }
      }
    }
    expect(seen.size).toBe(MOSAIC_TELEMETRY_CATEGORIES.length);
  });
});

describe("isMosaicTelemetryCategory", () => {
  it("accepts known categories", () => {
    for (const c of MOSAIC_TELEMETRY_CATEGORIES) {
      expect(isMosaicTelemetryCategory(c)).toBe(true);
    }
  });

  it("rejects unknown strings, undefined, and wrong types", () => {
    for (const bad of [
      "engine.bogus",
      "engine",
      "ENGINE.TEMPLATE",
      "",
      undefined,
      null,
      42,
      {},
    ]) {
      expect(isMosaicTelemetryCategory(bad as unknown)).toBe(false);
    }
  });
});
