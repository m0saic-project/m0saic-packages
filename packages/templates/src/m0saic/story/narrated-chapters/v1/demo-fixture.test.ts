import { DEMO_STORY } from "./demo-fixture";
import { validateStoryShape } from "./props";

describe("DEMO_STORY", () => {
  it("passes the template's own render-time shape gate", () => {
    expect(validateStoryShape(DEMO_STORY)).toEqual([]);
  });

  it("pins every section length explicitly — the demo must never need probed media", () => {
    for (const section of DEMO_STORY.sections ?? []) {
      expect(section.narrationAudio).toBeUndefined();
      expect(typeof section.overrides?.durationMs).toBe("number");
    }
  });

  it("uses unequal, non-round section durations so even-division bugs fail visibly", () => {
    const durations = (DEMO_STORY.sections ?? []).map((s) => s.overrides!.durationMs!);
    expect(new Set(durations).size).toBe(durations.length);
    expect(durations.some((d) => d % 1000 !== 0)).toBe(true);
  });
});
