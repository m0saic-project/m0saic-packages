import type { MosaicTimeWindow } from "./time-window";

describe("MosaicTimeWindow", () => {
  test("accepts the full field set and stays JSON-serializable", () => {
    const win: MosaicTimeWindow = {
      fraction: 0.7,
      ms: 1200,
      delayMs: 100,
      staggerMs: 50,
      ease: "easeOut",
    };
    expect(JSON.parse(JSON.stringify(win))).toEqual(win);
  });

  test("every field is optional (empty window is valid)", () => {
    const win: MosaicTimeWindow = {};
    expect(win).toEqual({});
  });

  test("ease is the shared four-name union", () => {
    const eases: NonNullable<MosaicTimeWindow["ease"]>[] = [
      "linear",
      "smoothstep",
      "easeOut",
      "easeInOut",
    ];
    expect(eases).toHaveLength(4);
  });
});
