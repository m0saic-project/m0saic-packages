import { entrance, exit, composeMotion, RISE_SINK_DISTANCE_FRAC } from "./motion";

// Expr-shape tests (the spec's "snapshot" for the animation kit): these
// strings ARE the product — the engine consumes them verbatim on the wired
// overlay binding, so any change here changes rendered motion.

describe("entrance", () => {
  test("fade: alpha ramps 0→1 over [atSec, atSec+durationMs]", () => {
    expect(entrance({ kind: "fade", durationMs: 300, atSec: 0.5 })).toEqual({
      alpha: "(min(1,max(0,(t-0.5)/0.3)))",
      startAtSec: 0.5,
      window: { startSec: 0.5 },
    });
  });

  test("slide-left: x offset from +W to 0, native enable gate before start", () => {
    expect(entrance({ kind: "slide-left", durationMs: 600, atSec: 0.2 })).toEqual({
      xExpr: "(1-(min(1,max(0,(t-0.2)/0.6))))*W",
      enable: "gte(t,0.2)",
      startAtSec: 0.2,
      window: { startSec: 0.2 },
    });
  });

  test("slide-up: y offset from +H to 0", () => {
    expect(entrance({ kind: "slide-up", durationMs: 500, atSec: 1 })).toEqual({
      yExpr: "(1-(min(1,max(0,(t-1)/0.5))))*H",
      enable: "gte(t,1)",
      startAtSec: 1,
      window: { startSec: 1 },
    });
  });

  test("rise: fade + subtle upward drift", () => {
    expect(entrance({ kind: "rise", durationMs: 400, atSec: 0 })).toEqual({
      alpha: "(min(1,max(0,(t-0)/0.4)))",
      yExpr: `(1-(min(1,max(0,(t-0)/0.4))))*${RISE_SINK_DISTANCE_FRAC}*H`,
      startAtSec: 0,
      window: { startSec: 0 },
    });
  });

  test("easing wraps the progress ramp", () => {
    const m = entrance({ kind: "fade", durationMs: 300, atSec: 0, ease: "easeOut" });
    expect(m.alpha).toBe("(1-(1-(min(1,max(0,(t-0)/0.3))))*(1-(min(1,max(0,(t-0)/0.3)))))");
  });
});

describe("exit", () => {
  test("fade: alpha ramps 1→0 over the exit window", () => {
    expect(exit({ kind: "fade", durationMs: 300, atSec: 2 })).toEqual({
      alpha: "(1-(min(1,max(0,(t-2)/0.3))))",
      startAtSec: 2,
      window: { endSec: 2.3 },
    });
  });

  test("slide-right: x offset 0→+W, disabled after completion", () => {
    expect(exit({ kind: "slide-right", durationMs: 600, atSec: 1.4 })).toEqual({
      xExpr: "(min(1,max(0,(t-1.4)/0.6)))*W",
      enable: "lt(t,2)",
      startAtSec: 1.4,
      window: { endSec: 2 },
    });
  });

  test("slide-down: y offset 0→+H", () => {
    expect(exit({ kind: "slide-down", durationMs: 500, atSec: 1 })).toEqual({
      yExpr: "(min(1,max(0,(t-1)/0.5)))*H",
      enable: "lt(t,1.5)",
      startAtSec: 1,
      window: { endSec: 1.5 },
    });
  });

  test("sink: fade-out + subtle downward drift", () => {
    expect(exit({ kind: "sink", durationMs: 400, atSec: 1 })).toEqual({
      alpha: "(1-(min(1,max(0,(t-1)/0.4))))",
      yExpr: `(min(1,max(0,(t-1)/0.4)))*${RISE_SINK_DISTANCE_FRAC}*H`,
      startAtSec: 1,
      window: { endSec: 1.4 },
    });
  });
});

describe("composeMotion", () => {
  test("entrance + exit fades: alphas multiply, earliest start wins", () => {
    const m = composeMotion(
      entrance({ kind: "fade", durationMs: 300, atSec: 0.2 }),
      exit({ kind: "fade", durationMs: 300, atSec: 1 })
    );
    expect(m).toEqual({
      alpha: "((min(1,max(0,(t-0.2)/0.3))))*((1-(min(1,max(0,(t-1)/0.3)))))",
      startAtSec: 0.2,
      window: { startSec: 0.2, endSec: 1.3 },
    });
  });

  test("slide entrance + slide exit: offsets add, enables multiply", () => {
    const m = composeMotion(
      entrance({ kind: "slide-left", durationMs: 400, atSec: 0 }),
      exit({ kind: "slide-right", durationMs: 400, atSec: 1 })
    );
    expect(m.xExpr).toBe(
      "((1-(min(1,max(0,(t-0)/0.4))))*W)+((min(1,max(0,(t-1)/0.4)))*W)"
    );
    expect(m.enable).toBe("(gte(t,0))*(lt(t,1.4))");
    expect(m.yExpr).toBeUndefined();
    expect(m.startAtSec).toBe(0);
    expect(m.window).toEqual({ startSec: 0, endSec: 1.4 });
  });

  test("windows intersect: latest start, earliest end", () => {
    const m = composeMotion(
      entrance({ kind: "slide-up", durationMs: 300, atSec: 0.5 }),
      exit({ kind: "slide-down", durationMs: 300, atSec: 2 }),
      exit({ kind: "fade", durationMs: 300, atSec: 1 })
    );
    // Two exits: the earlier end (1.3) bounds the intersection.
    expect(m.window).toEqual({ startSec: 0.5, endSec: 1.3 });
  });

  test("single motion passes through unwrapped", () => {
    const only = entrance({ kind: "fade", durationMs: 300, atSec: 0 });
    expect(composeMotion(only)).toEqual(only);
  });

  test("determinism: identical specs compose to identical exprs", () => {
    const a = composeMotion(
      entrance({ kind: "rise", durationMs: 250, atSec: 0.1 }),
      exit({ kind: "sink", durationMs: 250, atSec: 2 })
    );
    const b = composeMotion(
      entrance({ kind: "rise", durationMs: 250, atSec: 0.1 }),
      exit({ kind: "sink", durationMs: 250, atSec: 2 })
    );
    expect(a).toEqual(b);
  });
});
