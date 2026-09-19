import {
  cut,
  fade,
  xfade,
  transition,
  isXfadeMode,
  applyTransitionsBetween,
  MOSAIC_XFADE_MODES,
} from "./transitions";
import type { MosaicPipelineStep } from "@m0saic/types";

// A ref-based step is the minimal valid MosaicPipelineStep (no MosaicDocument
// needed). `intermediate`/`transitionToNext` are optional overrides.
function step(
  ref: string,
  extra: Partial<Pick<MosaicPipelineStep, "intermediate" | "transitionToNext">> = {},
): MosaicPipelineStep {
  return { durationMs: 1000, ref, ...extra } as MosaicPipelineStep;
}

describe("transition constructors", () => {
  it("cut() → { type: 'cut' }", () => {
    expect(cut()).toEqual({ type: "cut" });
  });

  it("fade(ms) → { type: 'fade', durationMs }", () => {
    expect(fade(350)).toEqual({ type: "fade", durationMs: 350 });
  });

  it("fade rounds to whole ms", () => {
    expect(fade(349.6)).toEqual({ type: "fade", durationMs: 350 });
    expect(fade(0.6)).toEqual({ type: "fade", durationMs: 1 });
  });

  it("xfade(kind, ms) → { type: 'xfade', kind, durationMs }", () => {
    expect(xfade("wipeleft", 400)).toEqual({
      type: "xfade",
      kind: "wipeleft",
      durationMs: 400,
    });
    expect(xfade("circleopen", 250.4)).toEqual({
      type: "xfade",
      kind: "circleopen",
      durationMs: 250,
    });
  });

  it("duration guards: non-positive / non-finite / rounds-to-zero throw", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 0.4]) {
      expect(() => fade(bad)).toThrow();
      expect(() => xfade("fade", bad)).toThrow();
    }
  });

  it("xfade rejects a non-catalog kind (incl. 'custom')", () => {
    // Cast around the compile-time union to exercise the runtime guard that
    // protects stringly-typed callers.
    expect(() => xfade("custom" as never, 300)).toThrow(/not a valid xfade mode/);
    expect(() => xfade("garbage" as never, 300)).toThrow(/not a valid xfade mode/);
  });
});

describe("transition() one-call form", () => {
  it("'cut' → cut(), durationMs ignored", () => {
    expect(transition("cut")).toEqual({ type: "cut" });
    expect(transition("cut", 999)).toEqual({ type: "cut" });
  });

  it("'fade' routes to the fade sugar", () => {
    expect(transition("fade", 350)).toEqual({ type: "fade", durationMs: 350 });
  });

  it("a catalog mode routes to xfade", () => {
    expect(transition("circleopen", 350)).toEqual({
      type: "xfade",
      kind: "circleopen",
      durationMs: 350,
    });
  });

  it("non-cut kinds require a durationMs", () => {
    expect(() => transition("fade")).toThrow(/requires a durationMs/);
    expect(() => transition("wipeleft")).toThrow(/requires a durationMs/);
  });

  it("rejects a non-catalog kind", () => {
    expect(() => transition("custom" as never, 300)).toThrow(/not a valid xfade mode/);
  });
});

describe("isXfadeMode", () => {
  it("true for catalog modes, false otherwise", () => {
    expect(isXfadeMode("fade")).toBe(true);
    expect(isXfadeMode("circleopen")).toBe(true);
    expect(isXfadeMode("custom")).toBe(false);
    expect(isXfadeMode("cut")).toBe(false);
    expect(isXfadeMode("garbage")).toBe(false);
  });

  it("agrees with the exported catalog", () => {
    expect(MOSAIC_XFADE_MODES.every((m) => isXfadeMode(m))).toBe(true);
  });
});

describe("applyTransitionsBetween", () => {
  const t = fade(300);

  it("stamps every output step except the last", () => {
    const out = applyTransitionsBetween([step("a"), step("b"), step("c")], t);
    expect(out[0].transitionToNext).toEqual(t);
    expect(out[1].transitionToNext).toEqual(t);
    expect(out[2].transitionToNext).toBeUndefined(); // last output step
  });

  it("preserves a step's existing transitionToNext", () => {
    const own = cut();
    const out = applyTransitionsBetween(
      [step("a", { transitionToNext: own }), step("b"), step("c")],
      t,
    );
    expect(out[0].transitionToNext).toBe(own); // kept, not overwritten
    expect(out[1].transitionToNext).toEqual(t);
  });

  it("leaves intermediate steps untouched and treats the last output step as the boundary end", () => {
    // b is intermediate; c is the last *output* step.
    const out = applyTransitionsBetween(
      [step("a"), step("b", { intermediate: true }), step("c")],
      t,
    );
    expect(out[0].transitionToNext).toEqual(t); // a → stamped
    expect(out[1].transitionToNext).toBeUndefined(); // intermediate → untouched
    expect(out[2].transitionToNext).toBeUndefined(); // last output → untouched
  });

  it("stamps a middle output step when a later output step exists past an intermediate", () => {
    // a (output), b (intermediate), c (output), d (output=last)
    const out = applyTransitionsBetween(
      [step("a"), step("b", { intermediate: true }), step("c"), step("d")],
      t,
    );
    expect(out[0].transitionToNext).toEqual(t);
    expect(out[1].transitionToNext).toBeUndefined(); // intermediate
    expect(out[2].transitionToNext).toEqual(t); // c: still has d after it
    expect(out[3].transitionToNext).toBeUndefined(); // last output
  });

  it("is pure — input array and step objects are not mutated", () => {
    const input = [step("a"), step("b")];
    const snapshotA = { ...input[0] };
    const out = applyTransitionsBetween(input, t);
    expect(input[0]).toEqual(snapshotA); // original unchanged
    expect(input[0].transitionToNext).toBeUndefined();
    expect(out).not.toBe(input);
    expect(out[0]).not.toBe(input[0]); // stamped step is a new object
  });

  it("single-step pipeline: nothing to stamp", () => {
    const out = applyTransitionsBetween([step("only")], t);
    expect(out[0].transitionToNext).toBeUndefined();
  });
});
