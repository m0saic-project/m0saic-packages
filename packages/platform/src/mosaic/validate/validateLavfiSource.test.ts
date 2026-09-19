import type { MosaicDiagnostic, MosaicLavfiSource } from "@m0saic/types";
import { validateLavfiSource } from "./validateLavfiSource";

function mkBase(overrides?: Partial<MosaicLavfiSource>): MosaicLavfiSource {
  return {
    type: "lavfi",
    color: "black@1",
    ...overrides,
  } as MosaicLavfiSource;
}

function run(source: MosaicLavfiSource, index = 0) {
  const diagnostics: MosaicDiagnostic[] = [];
  validateLavfiSource(source, index, diagnostics);
  return diagnostics;
}

function codes(diags: MosaicDiagnostic[]) {
  return diags.map((d) => d.code);
}

describe("validateLavfiSource", () => {
  describe("color path validation", () => {
    test("errors if color missing and lavfi also missing", () => {
      const d1 = run({ type: "lavfi" } as any, 3);
      expect(codes(d1)).toEqual(["LAVFI_SOURCE_MISSING"]);
      expect(d1[0].severity).toBe("error");
      expect(d1[0].message).toContain(`Source[3] (lavfi) must specify either "lavfi" or "color".`);
    });

    test("errors if color not a string", () => {
      const d = run(mkBase({ color: 123 as any }), 0);
      expect(codes(d)).toEqual(["LAVFI_COLOR_INVALID"]);
    });

    test("errors if color is empty string", () => {
      const d = run(mkBase({ color: "   " as any }), 0);
      expect(codes(d)).toEqual(["LAVFI_COLOR_EMPTY"]);
    });

    test("valid minimal lavfi source with color produces no diagnostics", () => {
      const d = run(mkBase(), 0);
      expect(d).toEqual([]);
    });
  });

  describe("lavfi escape route validation", () => {
    function mkLavfi(overrides?: Partial<MosaicLavfiSource>): MosaicLavfiSource {
      return {
        type: "lavfi",
        lavfi: "testsrc2",
        ...overrides,
      } as MosaicLavfiSource;
    }

    test("valid lavfi expression produces no diagnostics", () => {
      const d = run(mkLavfi(), 0);
      expect(d).toEqual([]);
    });

    test("errors if lavfi not a string", () => {
      const d = run(mkLavfi({ lavfi: 123 as any }), 0);
      expect(codes(d)).toEqual(["LAVFI_EXPR_INVALID"]);
    });

    test("errors if lavfi is empty string", () => {
      const d1 = run(mkLavfi({ lavfi: "" }), 1);
      expect(codes(d1)).toEqual(["LAVFI_EXPR_EMPTY"]);

      const d2 = run(mkLavfi({ lavfi: "   " }), 2);
      expect(codes(d2)).toEqual(["LAVFI_EXPR_EMPTY"]);
    });

    test("valid complex lavfi expression", () => {
      const d = run(mkLavfi({ lavfi: "testsrc2=duration=2:size=320x240:rate=30" }), 0);
      expect(d).toEqual([]);
    });

    test("valid lavfi with noise filter", () => {
      const d = run(mkLavfi({ lavfi: "noise=alls=20:allf=t+u" }), 0);
      expect(d).toEqual([]);
    });
  });

  describe("mutual exclusivity", () => {
    test("both lavfi and color can be validated (TypeScript prevents both at compile time)", () => {
      // TypeScript's discriminated union prevents both from being set,
      // but runtime validation should handle either path correctly
      const withColor = mkBase({ color: "red" });
      const d1 = run(withColor, 0);
      expect(d1).toEqual([]);

      const withLavfi = { type: "lavfi" as const, lavfi: "testsrc2" } as MosaicLavfiSource;
      const d2 = run(withLavfi, 0);
      expect(d2).toEqual([]);
    });
  });

  describe("size validation", () => {
    test("size.wExpr invalid type", () => {
      const d = run(mkBase({ size: { wExpr: 123 as any, hExpr: "200" } as any }), 1);
      expect(codes(d)).toContain("LAVFI_SIZE_WEXPR_INVALID");
    });

    test("size.wExpr empty string", () => {
      const d = run(mkBase({ size: { wExpr: "   ", hExpr: "200" } as any }), 1);
      expect(codes(d)).toContain("LAVFI_SIZE_WEXPR_EMPTY");
    });

    test("size.hExpr invalid type", () => {
      const d = run(mkBase({ size: { wExpr: "100", hExpr: {} as any } as any }), 1);
      expect(codes(d)).toContain("LAVFI_SIZE_HEXPR_INVALID");
    });

    test("size.hExpr empty string", () => {
      const d = run(mkBase({ size: { wExpr: "100", hExpr: "" } as any }), 1);
      expect(codes(d)).toContain("LAVFI_SIZE_HEXPR_EMPTY");
    });

    test("size strings ok", () => {
      const d = run(mkBase({ size: { wExpr: "W", hExpr: "H" } as any }), 0);
      expect(d).toEqual([]);
    });

    test("size can be omitted entirely", () => {
      const d = run(mkBase({ size: undefined }), 0);
      expect(d).toEqual([]);
    });
  });

  describe("overlay validation", () => {
    test("overlay.xExpr invalid type", () => {
      const d = run(mkBase({ overlay: { xExpr: 1 as any } as any }), 2);
      expect(codes(d)).toContain("LAVFI_OVERLAY_XEXPR_INVALID");
    });

    test("overlay.xExpr empty string", () => {
      const d = run(mkBase({ overlay: { xExpr: "   " } as any }), 2);
      expect(codes(d)).toContain("LAVFI_OVERLAY_XEXPR_EMPTY");
    });

    test("overlay.yExpr invalid type", () => {
      const d = run(mkBase({ overlay: { yExpr: [] as any } as any }), 2);
      expect(codes(d)).toContain("LAVFI_OVERLAY_YEXPR_INVALID");
    });

    test("overlay.yExpr empty string", () => {
      const d = run(mkBase({ overlay: { yExpr: "" } as any }), 2);
      expect(codes(d)).toContain("LAVFI_OVERLAY_YEXPR_EMPTY");
    });

    test("overlay.enable invalid type", () => {
      const d = run(mkBase({ overlay: { enable: 0 as any } as any }), 2);
      expect(codes(d)).toContain("LAVFI_OVERLAY_ENABLE_INVALID");
    });

    test("overlay.enable empty string", () => {
      const d = run(mkBase({ overlay: { enable: "   " } as any }), 2);
      expect(codes(d)).toContain("LAVFI_OVERLAY_ENABLE_EMPTY");
    });

    test("overlay.startAtSec invalid (non-finite)", () => {
      const d1 = run(mkBase({ overlay: { startAtSec: NaN } as any }), 2);
      expect(codes(d1)).toContain("LAVFI_OVERLAY_STARTAT_INVALID");

      const d2 = run(mkBase({ overlay: { startAtSec: Infinity } as any }), 2);
      expect(codes(d2)).toContain("LAVFI_OVERLAY_STARTAT_INVALID");

      const d3 = run(mkBase({ overlay: { startAtSec: "0" as any } as any }), 2);
      expect(codes(d3)).toContain("LAVFI_OVERLAY_STARTAT_INVALID");
    });

    test("overlay.startAtSec negative", () => {
      const d = run(mkBase({ overlay: { startAtSec: -0.01 } as any }), 2);
      expect(codes(d)).toContain("LAVFI_OVERLAY_STARTAT_NEGATIVE");
    });

    test("overlay valid (all fields)", () => {
      const d = run(
        mkBase({
          overlay: {
            xExpr: "0",
            yExpr: "0",
            enable: "gte(t,0)",
            startAtSec: 0.25,
          } as any,
        }),
        0
      );
      expect(d).toEqual([]);
    });

    test("overlay can be omitted entirely", () => {
      const d = run(mkBase({ overlay: undefined }), 0);
      expect(d).toEqual([]);
    });

    test("overlay tolerates missing optional fields", () => {
      const d = run(mkBase({ overlay: {} as any }), 0);
      expect(d).toEqual([]);
    });

    test("reports multiple overlay diagnostics when multiple fields are bad", () => {
      const d = run(
        mkBase({
          overlay: {
            xExpr: 1 as any,
            yExpr: "" as any,
            enable: {} as any,
            startAtSec: -1,
          } as any,
        }),
        5
      );

      expect(codes(d)).toEqual(
        expect.arrayContaining([
          "LAVFI_OVERLAY_XEXPR_INVALID",
          "LAVFI_OVERLAY_YEXPR_EMPTY",
          "LAVFI_OVERLAY_ENABLE_INVALID",
          "LAVFI_OVERLAY_STARTAT_NEGATIVE",
        ])
      );
    });
  });

  test("returns early on missing source (does not emit other diagnostics)", () => {
    // Omit both color and lavfi entirely to test missing source error
    const d = run(
      {
        type: "lavfi",
        size: { wExpr: 123 as any, hExpr: "" as any } as any,
        overlay: { xExpr: 1 as any, startAtSec: -1 } as any,
      } as any,
      0
    );
    expect(codes(d)).toEqual(["LAVFI_SOURCE_MISSING"]);
  });

  test("returns early on invalid lavfi (does not emit other diagnostics)", () => {
    const d = run(
      {
        type: "lavfi",
        lavfi: "" as any,
        size: { wExpr: 123 as any, hExpr: "" as any } as any,
        overlay: { xExpr: 1 as any, startAtSec: -1 } as any,
      } as MosaicLavfiSource,
      0
    );
    expect(codes(d)).toEqual(["LAVFI_EXPR_EMPTY"]);
  });

  test("returns early on invalid color (does not emit other diagnostics)", () => {
    const d = run(
      {
        type: "lavfi",
        color: "" as any,
        size: { wExpr: 123 as any, hExpr: "" as any } as any,
        overlay: { xExpr: 1 as any, startAtSec: -1 } as any,
      } as MosaicLavfiSource,
      0
    );
    expect(codes(d)).toEqual(["LAVFI_COLOR_EMPTY"]);
  });

  test("regression: removing lavfi validation would break this test", () => {
    // If someone removes the lavfi validation, this would fail
    const d = run({ type: "lavfi", lavfi: "testsrc2" } as MosaicLavfiSource, 0);
    expect(d).toEqual([]);
  });

  test("regression: removing color validation would break this test", () => {
    // If someone removes the color validation, this would fail
    const d = run(mkBase({ color: "red" }), 0);
    expect(d).toEqual([]);
  });
});
