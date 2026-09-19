import type { MosaicSource } from "@m0saic/types";
import { revealGate, revealGateNode, ALPINE_ANIM_FIELDS, fBool, fStr } from "./alpine-anim";

const src = (): MosaicSource => ({ type: "lavfi", color: "#fff" } as unknown as MosaicSource);

describe("alpine-anim — revealGate", () => {
  it("sets a raw overlay.enable gate (no alpha, no comma-escape)", () => {
    const g = revealGate(src(), 0.65) as { overlay?: { enable?: string; alpha?: string } };
    expect(g.overlay?.enable).toBe("gte(t,0.650)");
    expect(g.overlay?.alpha).toBeUndefined();
    expect(g.overlay?.enable).not.toContain("\\"); // raw form — engine escapes commas
    expect((g.overlay as { window?: object } | undefined)?.window).toEqual({ startSec: 0.65 });
  });

  it("on=false returns the source untouched (reduceMotion / static)", () => {
    const s = src();
    expect(revealGate(s, 0.5, false)).toBe(s);
  });

  it("preserves an existing overlay (e.g. a slide), only adding enable", () => {
    const sliding = { type: "lavfi", color: "#fff", overlay: { startAtSec: 0.1, xExpr: "-(w*0.5)" } } as unknown as MosaicSource;
    const g = revealGate(sliding, 0.2) as { overlay?: { xExpr?: string; startAtSec?: number; enable?: string } };
    expect(g.overlay?.xExpr).toBe("-(w*0.5)");
    expect(g.overlay?.startAtSec).toBe(0.1);
    expect(g.overlay?.enable).toBe("gte(t,0.200)");
  });

  it("revealGateNode gates every source in a node; on=false passes through", () => {
    const node = { m0: "F", sources: [src(), src()] };
    const gated = revealGateNode(node, 0.3);
    expect(gated.sources.every((s) => (s as { overlay?: { enable?: string } }).overlay?.enable === "gte(t,0.300)")).toBe(true);
    expect(revealGateNode(node, 0.3, false)).toBe(node);
  });
});

describe("alpine-anim — schema field helpers", () => {
  it("ALPINE_ANIM_FIELDS carries labeled sub-fields (not a JSON bag)", () => {
    expect(Object.keys(ALPINE_ANIM_FIELDS)).toEqual(expect.arrayContaining(["reduceMotion", "introFrac", "easing"]));
    expect(ALPINE_ANIM_FIELDS.reduceMotion.type).toBe("boolean");
    expect(ALPINE_ANIM_FIELDS.introFrac.meta.ui.label).toBeTruthy();
  });

  it("field helpers produce optional defs with a ui label", () => {
    expect(fBool("X").required).toBe(false);
    expect(fBool("X").meta.ui.label).toBe("X");
    expect(fStr("Y").type).toBe("string");
  });
});
