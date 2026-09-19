import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicRenderableFile,
  MosaicTextSource,
} from "@m0saic/types";
import { entries } from "@m0saic/dictionary";
import { toCanonicalM0String } from "@m0saic/dsl";
import { TheMosaicM } from "./logo";

type LogoProps = Parameters<typeof TheMosaicM.render>[0];

function getEnableExpr(source: { overlay?: { enable?: string } }): string | undefined {
  return source.overlay?.enable;
}

const HERO_ORANGE = "#f97316";
// TODO: These entries moved to dictionary-private — tests skipped until re-pointed.
const DICT_ID_64 = "brand/m0saic-m-64";
const DICT_ID_256 = "brand/m0saic-m-256";
const SOURCE_COUNT_64 = entries.byId[DICT_ID_64]?.sourceCount ?? 0;
const SOURCE_COUNT_256 = entries.byId[DICT_ID_256]?.sourceCount ?? 0;

function makeCtx(overrides?: Partial<MosaicEngineContext["output"]>): MosaicEngineContext & { cache?: any } { return { mode: "render" as const,
    target: { width: 1080, height: 1080, fps: 30, durationMs: 3200 },
    output: {
      width: 1080,
      height: 1080,
      fps: 30,
      durationMs: 3200,
      workspaceDir: "/tmp",
      ...overrides,
    },
    media: {},
    cache: ({
      get: () => undefined,
      set: () => {},
      getOrCompute: async (_k: string, fn: () => any) => fn(),
    } as any),
  };
}

function asDocument(file: MosaicRenderableFile): MosaicDocument {
  expect(file.kind).toBe("mosaic_document");
  return file as MosaicDocument;
}

function isErrorDocument(doc: MosaicDocument): boolean {
  return (
    (doc.sources ?? []).length === 1 &&
    "engine" in (doc.sources ?? [])[0] &&
    ((doc.sources ?? [])[0] as { engine?: { renderStatus?: string } }).engine?.renderStatus === "error"
  );
}

async function render(props: Partial<LogoProps>) {
  return TheMosaicM.render(props, makeCtx());
}

// TODO: Skipped — dictionary entries moved to dictionary-private
describe.skip("TheMosaicM logo template", () => {
  const D = TheMosaicM.defaultProps!;

  describe("defaults and partial props", () => {
    it("all props omitted uses every default and succeeds", async () => {
      const doc = asDocument(await render({}));
      expect((doc.sources ?? []).length).toBe(SOURCE_COUNT_64);
      expect(isErrorDocument(doc)).toBe(false);
      const first = (doc.sources ?? [])[0];
      expect("visual" in first && first.visual?.backgroundColor).toBe(HERO_ORANGE);
    });

    it("explicit full defaultProps produces same source count as omitted", async () => {
      const fromOmitted = asDocument(await render({}));
      const fromExplicit = asDocument(await render({ ...D }));
      expect((fromOmitted.sources ?? []).length).toBe((fromExplicit.sources ?? []).length);
      expect((fromOmitted.sources ?? []).length).toBe(SOURCE_COUNT_64);
    });

    it("default props (no animation) produce same m0saic and sources length as before", async () => {
      const doc = asDocument(await render({}));
      expect(doc.m0).toBe(toCanonicalM0String(entries.byId[DICT_ID_64]!.m0));
      expect((doc.sources ?? []).length).toBe(SOURCE_COUNT_64);
      expect(isErrorDocument(doc)).toBe(false);
      const firstEnable = getEnableExpr((doc.sources ?? [])[0] as MosaicTextSource);
      expect(firstEnable).toBeDefined();
      expect(firstEnable).toContain("mod(t,");
      expect(firstEnable).toContain("/0.25");
      expect(firstEnable).toContain("0.75");
    });

    it("only size omitted defaults to 64", async () => {
      const doc = asDocument(await render({ color: "#ff0000", easing: "linear" }));
      expect((doc.sources ?? []).length).toBe(SOURCE_COUNT_64);
    });

    it("only color omitted uses HERO_ORANGE", async () => {
      const doc = asDocument(await render({ size: "m-33_bitmap" }));
      const first = (doc.sources ?? [])[0];
      expect("visual" in first && first.visual?.backgroundColor).toBe(HERO_ORANGE);
    });

    it("only animation props omitted use defaults and succeed", async () => {
      const doc = asDocument(await render({ size: "m-33_bitmap", color: "#00ff00" }));
      expect((doc.sources ?? []).length).toBe(SOURCE_COUNT_64);
      expect(isErrorDocument(doc)).toBe(false);
    });
  });

  describe("size", () => {
    it('size "64" yields 64-grid source count', async () => {
      const doc = asDocument(await render({ ...D, size: "m-33_bitmap" }));
      expect((doc.sources ?? []).length).toBe(SOURCE_COUNT_64);
    });

    it('size "256" yields 256-grid source count', async () => {
      const doc = asDocument(await render({ ...D, size: "m-33_bitmap" }));
      expect((doc.sources ?? []).length).toBe(SOURCE_COUNT_256);
    });
  });

  describe("color", () => {
    it("uses custom color for all tiles", async () => {
      const doc = asDocument(await render({ ...D, color: "#0000ff" }));
      expect("visual" in (doc.sources ?? [])[0] && ((doc.sources ?? [])[0] as any).visual?.backgroundColor).toBe("#0000ff");
      // spot-check another tile
      expect("visual" in (doc.sources ?? [])[100] && ((doc.sources ?? [])[100] as any).visual?.backgroundColor).toBe("#0000ff");
    });

    it("accepts black and white", async () => {
      const black = asDocument(await render({ ...D, color: "#000000" }));
      const white = asDocument(await render({ ...D, color: "#ffffff" }));
      expect("visual" in (black.sources ?? [])[0] && ((black.sources ?? [])[0] as any).visual?.backgroundColor).toBe("#000000");
      expect("visual" in (white.sources ?? [])[0] && ((white.sources ?? [])[0] as any).visual?.backgroundColor).toBe("#ffffff");
    });
  });

  describe("animation props — valid values", () => {
    it("loopSec at min (0.1) succeeds", async () => {
      const doc = asDocument(await render({ ...D, loopSec: 0.1 }));
      expect((doc.sources ?? []).length).toBe(SOURCE_COUNT_64);
      expect(isErrorDocument(doc)).toBe(false);
    });

    it("loopSec at max (60) succeeds", async () => {
      const doc = asDocument(await render({ ...D, loopSec: 60 }));
      expect((doc.sources ?? []).length).toBe(SOURCE_COUNT_64);
      expect(isErrorDocument(doc)).toBe(false);
    });

    it("inEnd at min (0.0001) with outStart > inEnd succeeds", async () => {
      const doc = asDocument(await render({ ...D, inEnd: 0.0001, outStart: 0.5 }));
      expect((doc.sources ?? []).length).toBe(SOURCE_COUNT_64);
      expect(isErrorDocument(doc)).toBe(false);
    });

    it("inEnd at max (1) with outStart 0.9999 fails (inEnd < outStart required)", async () => {
      const doc = asDocument(await render({ ...D, inEnd: 1, outStart: 0.9999 }));
      expect(isErrorDocument(doc)).toBe(true);
    });

    it("inEnd 0.25 and outStart 0.75 (defaults) succeed", async () => {
      const doc = asDocument(await render({ ...D, inEnd: 0.25, outStart: 0.75 }));
      expect((doc.sources ?? []).length).toBe(SOURCE_COUNT_64);
      expect(isErrorDocument(doc)).toBe(false);
    });

    it("outStart 0 fails when inEnd > 0 (inEnd < outStart required)", async () => {
      const doc = asDocument(await render({ ...D, inEnd: 0.1, outStart: 0 }));
      expect(isErrorDocument(doc)).toBe(true);
    });

    it("outStart just above inEnd (e.g. 0.11, inEnd 0.1) succeeds", async () => {
      const doc = asDocument(await render({ ...D, inEnd: 0.1, outStart: 0.11 }));
      expect((doc.sources ?? []).length).toBe(SOURCE_COUNT_64);
      expect(isErrorDocument(doc)).toBe(false);
    });

    it("outStart at max (0.9999) with inEnd < outStart succeeds", async () => {
      const doc = asDocument(await render({ ...D, inEnd: 0.2, outStart: 0.9999 }));
      expect((doc.sources ?? []).length).toBe(SOURCE_COUNT_64);
      expect(isErrorDocument(doc)).toBe(false);
    });

    it("feather at min (0) and max (0.2) succeed", async () => {
      const doc0 = asDocument(await render({ ...D, feather: 0 }));
      const doc2 = asDocument(await render({ ...D, feather: 0.2 }));
      expect((doc0.sources ?? []).length).toBe(SOURCE_COUNT_64);
      expect((doc2.sources ?? []).length).toBe(SOURCE_COUNT_64);
      expect(isErrorDocument(doc0)).toBe(false);
      expect(isErrorDocument(doc2)).toBe(false);
    });

    it("startDelay 0 and endDelay 0 succeed (active window 1)", async () => {
      const doc = asDocument(await render({ ...D, startDelay: 0, endDelay: 0 }));
      expect((doc.sources ?? []).length).toBe(SOURCE_COUNT_64);
      expect(isErrorDocument(doc)).toBe(false);
    });

    it("startDelay and endDelay at max (0.9) fails (active window negative)", async () => {
      const doc = asDocument(await render({ ...D, startDelay: 0.9, endDelay: 0.9 }));
      expect(isErrorDocument(doc)).toBe(true);
    });

    it("startDelay 0.4 + endDelay 0.4 leaves active 0.2 and succeeds", async () => {
      const doc = asDocument(await render({ ...D, startDelay: 0.4, endDelay: 0.4 }));
      expect((doc.sources ?? []).length).toBe(SOURCE_COUNT_64);
      expect(isErrorDocument(doc)).toBe(false);
    });

    it('easing "linear" succeeds', async () => {
      const doc = asDocument(await render({ ...D, easing: "linear" }));
      expect((doc.sources ?? []).length).toBe(SOURCE_COUNT_64);
      expect(isErrorDocument(doc)).toBe(false);
    });

    it('easing "smoothstep" succeeds', async () => {
      const doc = asDocument(await render({ ...D, easing: "smoothstep" }));
      expect((doc.sources ?? []).length).toBe(SOURCE_COUNT_64);
      expect(isErrorDocument(doc)).toBe(false);
    });
  });

  describe("sensible combinations", () => {
    it("size 64 + custom color + easing linear", async () => {
      const doc = asDocument(
        await render({ size: "m-33_bitmap", color: "#00ff00", easing: "linear" })
      );
      expect((doc.sources ?? []).length).toBe(SOURCE_COUNT_64);
      expect("visual" in (doc.sources ?? [])[0] && ((doc.sources ?? [])[0] as any).visual?.backgroundColor).toBe("#00ff00");
      expect(isErrorDocument(doc)).toBe(false);
    });

    it("size 256 + short loop + tight reveal window", async () => {
      const doc = asDocument(
        await render({
          size: "m-33_bitmap",
          loopSec: 1,
          inEnd: 0.2,
          outStart: 0.8,
          startDelay: 0,
          endDelay: 0,
        })
      );
      expect((doc.sources ?? []).length).toBe(SOURCE_COUNT_256);
      expect(isErrorDocument(doc)).toBe(false);
    });

    it("minimal valid animation (inEnd just before outStart)", async () => {
      const doc = asDocument(
        await render({ ...D, inEnd: 0.4, outStart: 0.41 })
      );
      expect((doc.sources ?? []).length).toBe(SOURCE_COUNT_64);
      expect(isErrorDocument(doc)).toBe(false);
    });
  });

  describe("invalid props (error document)", () => {
    it("loopSec <= 0", async () => {
      expect(isErrorDocument(asDocument(await render({ ...D, loopSec: 0 })))).toBe(true);
      expect(isErrorDocument(asDocument(await render({ ...D, loopSec: -1 })))).toBe(true);
    });

    it("inEnd > outStart", async () => {
      expect(isErrorDocument(asDocument(await render({ ...D, inEnd: 0.9, outStart: 0.1 })))).toBe(true);
    });

    it("inEnd <= 0", async () => {
      expect(isErrorDocument(asDocument(await render({ ...D, inEnd: 0, outStart: 0.5 })))).toBe(true);
    });

    it("inEnd > 1", async () => {
      expect(isErrorDocument(asDocument(await render({ ...D, inEnd: 1.1, outStart: 0.99 })))).toBe(true);
    });

    it("outStart < 0", async () => {
      expect(isErrorDocument(asDocument(await render({ ...D, inEnd: 0.2, outStart: -0.1 })))).toBe(true);
    });

    it("outStart >= 1", async () => {
      expect(isErrorDocument(asDocument(await render({ ...D, inEnd: 0.2, outStart: 1 })))).toBe(true);
    });

    it("feather < 0 or > 0.2", async () => {
      expect(isErrorDocument(asDocument(await render({ ...D, feather: -0.01 })))).toBe(true);
      expect(isErrorDocument(asDocument(await render({ ...D, feather: 0.21 })))).toBe(true);
    });

    it("startDelay + endDelay >= 1", async () => {
      expect(isErrorDocument(asDocument(await render({ ...D, startDelay: 0.5, endDelay: 0.5 })))).toBe(true);
      expect(isErrorDocument(asDocument(await render({ ...D, startDelay: 0.9, endDelay: 0.1 })))).toBe(true);
    });

    it("startDelay < 0 or >= 1", async () => {
      expect(isErrorDocument(asDocument(await render({ ...D, startDelay: -0.1 })))).toBe(true);
      expect(isErrorDocument(asDocument(await render({ ...D, startDelay: 1 })))).toBe(true);
    });

    it("endDelay < 0 or >= 1", async () => {
      expect(isErrorDocument(asDocument(await render({ ...D, endDelay: -0.1 })))).toBe(true);
      expect(isErrorDocument(asDocument(await render({ ...D, endDelay: 1 })))).toBe(true);
    });

    it("active window zero (startDelay + endDelay = 1)", async () => {
      expect(isErrorDocument(asDocument(await render({ ...D, startDelay: 0.5, endDelay: 0.5 })))).toBe(true);
    });

    it("invalid easing", async () => {
      expect(
        isErrorDocument(asDocument(await render({ ...D, easing: "invalid" as "linear" })))
      ).toBe(true);
    });
  });

  describe("progress_fill animation", () => {
    const baseProgressFill = { animation: "progress_fill" as const, size: "m-33_bitmap" as const };

    it("progress_fill + progress=0: enable expr uses p≈0 so most tiles disabled (gte(0+feather, rank))", async () => {
      const doc = asDocument(await render({ ...baseProgressFill, progress: 0 }));
      expect(isErrorDocument(doc)).toBe(false);
      expect((doc.sources ?? []).length).toBe(SOURCE_COUNT_64);
      const firstEnable = getEnableExpr((doc.sources ?? [])[0] as MosaicTextSource);
      expect(firstEnable).toBeDefined();
      expect(firstEnable).toContain("gte(");
      expect(firstEnable).toMatch(/gte\(\(0\)\+/);
      expect(firstEnable).not.toContain("mod(t,");
      expect(firstEnable).not.toContain("inEnd");
    });

    it("progress_fill + progress=1: enable expr always-on (gte(1+feather, rank))", async () => {
      const doc = asDocument(await render({ ...baseProgressFill, progress: 1 }));
      expect(isErrorDocument(doc)).toBe(false);
      expect((doc.sources ?? []).length).toBe(SOURCE_COUNT_64);
      const firstEnable = getEnableExpr((doc.sources ?? [])[0] as MosaicTextSource);
      expect(firstEnable).toBeDefined();
      expect(firstEnable).toContain("gte(");
      expect(firstEnable).toMatch(/gte\(\(1\)\+/);
      expect(firstEnable).not.toContain("mod(t,");
    });

    it("progress_fill + progress=0.5 succeeds and enable contains 0.5", async () => {
      const doc = asDocument(await render({ ...baseProgressFill, progress: 0.5 }));
      expect(isErrorDocument(doc)).toBe(false);
      const firstEnable = getEnableExpr((doc.sources ?? [])[0] as MosaicTextSource);
      expect(firstEnable).toMatch(/gte\(\(0\.5\)\+/);
    });

    it("progress_fill without progress uses time-based p (mod(t, progressSec) or min(max(t/", async () => {
      const doc = asDocument(await render({ ...baseProgressFill, progressSec: 2 }));
      expect(isErrorDocument(doc)).toBe(false);
      const firstEnable = getEnableExpr((doc.sources ?? [])[0] as MosaicTextSource);
      expect(firstEnable).toContain("mod(t,2)");
      expect(firstEnable).toContain("gte(t,1/");
    });

    it("progress_fill + oneShot uses min(max(t/progressSec,0),1)", async () => {
      const doc = asDocument(
        await render({ ...baseProgressFill, oneShot: true, progressSec: 3 })
      );
      expect(isErrorDocument(doc)).toBe(false);
      const firstEnable = getEnableExpr((doc.sources ?? [])[0] as MosaicTextSource);
      expect(firstEnable).toContain("min(max(t/3,0),1)");
    });

    it("animation=logo_loop (explicit) preserves existing enable expr shape", async () => {
      const doc = asDocument(await render({ ...D, animation: "logo_loop" }));
      expect((doc.sources ?? []).length).toBe(SOURCE_COUNT_64);
      const firstEnable = getEnableExpr((doc.sources ?? [])[0] as MosaicTextSource);
      expect(firstEnable).toContain("mod(t,");
      expect(firstEnable).toContain("/0.25");
      expect(firstEnable).toContain("0.75");
    });

    it("progress_fill invalid progress (out of range) returns error document", async () => {
      expect(
        isErrorDocument(asDocument(await render({ ...baseProgressFill, progress: -0.1 })))
      ).toBe(true);
      expect(
        isErrorDocument(asDocument(await render({ ...baseProgressFill, progress: 1.1 })))
      ).toBe(true);
    });

    it("progress_fill progressSec <= 0 when progress not set returns error", async () => {
      expect(
        isErrorDocument(
          asDocument(await render({ ...baseProgressFill, progressSec: 0 }))
        )
      ).toBe(true);
    });
  });
});
