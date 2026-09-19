import type { MosaicSourceMask } from "@m0saic/types";
import { makeColorTile } from "./makeColorTile";

describe("makeColorTile", () => {
  it("returns a lavfi source carrying the supplied color", () => {
    const src = makeColorTile("#050314");
    expect(src.type).toBe("lavfi");
    expect((src as { color?: string }).color).toBe("#050314");
  });

  it("omits overlay when no overlay opts are supplied", () => {
    const src = makeColorTile("#000000");
    expect(src.overlay).toBeUndefined();
  });

  it("omits overlay when an empty overlay object is supplied", () => {
    const src = makeColorTile("#000000", { overlay: {} });
    expect(src.overlay).toBeUndefined();
  });

  it("passes through alpha + enable + xExpr + yExpr unchanged", () => {
    const src = makeColorTile("#abcdef", {
      overlay: {
        alpha: "min(1,max(0,t))",
        enable: "gte(t,0.2)",
        xExpr: "1*(1-t)",
        yExpr: "1*(1-t)",
        startAtSec: 0.3,
        blendMode: "screen",
      },
    });
    expect(src.overlay).toEqual({
      alpha: "min(1,max(0,t))",
      enable: "gte(t,0.2)",
      xExpr: "1*(1-t)",
      yExpr: "1*(1-t)",
      startAtSec: 0.3,
      blendMode: "screen",
    });
  });

  /**
   * Regression: `window` was absent from the has-anything gate, so a typed
   * lifetime was dropped SILENTLY — the tile came back with no overlay and no
   * error, leaving the source unbounded, which is the opposite of what
   * declaring a window is for.
   */
  it("keeps a typed overlay.window on its own", () => {
    const src = makeColorTile("#abcdef", {
      overlay: { window: { startSec: 1, endSec: 2 } },
    });
    expect(src.overlay).toEqual({ window: { startSec: 1, endSec: 2 } });
  });

  it("keeps a window alongside an alpha", () => {
    const src = makeColorTile("#abcdef", {
      overlay: { alpha: "1", window: { startSec: 0, endSec: 0.5 } },
    });
    expect(src.overlay).toEqual({
      alpha: "1",
      window: { startSec: 0, endSec: 0.5 },
    });
  });

  /**
   * The gate must list EVERY field of MosaicOverlayExpr. Anything missing is
   * discarded without a word, so this enumerates the surface: a new field
   * added to the type should fail here until the gate knows about it.
   */
  it("keeps every overlay field, one at a time", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["alpha", { alpha: "1" }],
      ["enable", { enable: "gte(t,1)" }],
      ["window", { window: { startSec: 0, endSec: 1 } }],
      ["xExpr", { xExpr: "0" }],
      ["yExpr", { yExpr: "0" }],
      ["startAtSec", { startAtSec: 0.5 }],
      ["blendMode", { blendMode: "screen" }],
    ];
    for (const [name, overlay] of cases) {
      const src = makeColorTile("#000000", { overlay: overlay as never });
      expect([name, src.overlay]).toEqual([name, overlay]);
    }
  });

  it("forwards mask when supplied", () => {
    const mask = {
      kind: "alpha-image" as const,
      assetId: "m0_mask" as never,
    } as unknown as MosaicSourceMask;
    const src = makeColorTile("#f97316", { mask });
    expect(src.mask).toBe(mask);
  });

  it("forwards placement when supplied", () => {
    const src = makeColorTile("#fff", {
      placement: { fit: "contain", padding: { top: 4, right: 4, bottom: 4, left: 4 } },
    });
    expect(src.placement).toEqual({
      fit: "contain",
      padding: { top: 4, right: 4, bottom: 4, left: 4 },
    });
  });

  it("is deterministic — same inputs produce structurally identical output", () => {
    const a = makeColorTile("#000", { overlay: { alpha: "1" } });
    const b = makeColorTile("#000", { overlay: { alpha: "1" } });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
