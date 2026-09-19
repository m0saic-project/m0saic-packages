import { hash32, kenBurnsCamera, MOVES, ZOOMS } from "./kenburns";
import type { KenBurnsOptions } from "./kenburns";

function opts(partial?: Partial<KenBurnsOptions>): KenBurnsOptions {
  return {
    seed: 7,
    sectionIndex: 0,
    imageIndex: 0,
    startSec: 0,
    endSec: 3.34,
    intensity: 1,
    ampScale: 1,
    ...partial,
  };
}

describe("hash32", () => {
  it("is deterministic and input-sensitive", () => {
    expect(hash32("z", 7, 0, 0)).toBe(hash32("z", 7, 0, 0));
    expect(hash32("z", 7, 0, 0)).not.toBe(hash32("z", 8, 0, 0));
    expect(hash32("z", 7, 0, 0)).not.toBe(hash32("mv", 7, 0, 0));
    expect(hash32("z", 7, 0, 0)).not.toBe(hash32("z", 7, 0, 1));
  });

  it("returns unsigned 32-bit values", () => {
    for (const v of [hash32("a"), hash32("still", 999, 29, 7), hash32("")]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("kenBurnsCamera", () => {
  it("same seed → identical camera; different seed → different somewhere", () => {
    const a = kenBurnsCamera(opts());
    const b = kenBurnsCamera(opts());
    expect(b).toEqual(a);

    // Across many (seed, image) pairs the outputs must not all collapse.
    const signatures = new Set(
      Array.from({ length: 24 }, (_, i) => JSON.stringify(kenBurnsCamera(opts({ seed: i, imageIndex: i % 3 })))),
    );
    expect(signatures.size).toBeGreaterThan(4);
  });

  it("~20% of shots are locked-off stills (no camera)", () => {
    let stills = 0;
    const n = 500;
    for (let i = 0; i < n; i++) {
      if (kenBurnsCamera(opts({ seed: 1, sectionIndex: i % 30, imageIndex: i % 7 })) === undefined) stills++;
    }
    expect(stills / n).toBeGreaterThan(0.12);
    expect(stills / n).toBeLessThan(0.28);
  });

  it("zoom is ALWAYS a plain number from the genre band (R10: never animate zoom)", () => {
    for (let i = 0; i < 100; i++) {
      const cam = kenBurnsCamera(opts({ seed: i, imageIndex: i }));
      if (cam === undefined) continue;
      expect(typeof cam.zoom).toBe("number");
      expect(ZOOMS).toContain(cam.zoom as (typeof ZOOMS)[number]);
    }
  });

  it("moving shots keyframe focus linearly over the image window", () => {
    // Find a seeded moving shot with horizontal travel.
    let found = false;
    for (let i = 0; i < 50 && !found; i++) {
      const cam = kenBurnsCamera(opts({ seed: i, startSec: 1.5, endSec: 4.25 }));
      if (cam === undefined || typeof cam.focusX !== "string") continue;
      found = true;
      expect(cam.focusX).toContain("1.5");
      expect(cam.focusX).toContain("lt(t");
    }
    expect(found).toBe(true);
  });

  it("intensity 0 pins focus to static numbers", () => {
    for (let i = 0; i < 20; i++) {
      const cam = kenBurnsCamera(opts({ seed: i, intensity: 0 }));
      if (cam === undefined) continue;
      expect(typeof cam.focusX).toBe("number");
      expect(typeof cam.focusY).toBe("number");
    }
  });

  it("focus values stay inside 0..1 for any subject anchor", () => {
    const cam = kenBurnsCamera(opts({ seed: 3, subjectX: 0.02, subjectY: 0.98 }));
    if (cam !== undefined) {
      for (const axis of [cam.focusX, cam.focusY]) {
        if (typeof axis === "number") {
          expect(axis).toBeGreaterThanOrEqual(0);
          expect(axis).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("portrait amp scale shrinks the travel", () => {
    // Compare travel magnitude embedded in the keyframed expr endpoints.
    let checked = false;
    for (let i = 0; i < 60 && !checked; i++) {
      const full = kenBurnsCamera(opts({ seed: i }));
      const scaled = kenBurnsCamera(opts({ seed: i, ampScale: 0.5 }));
      if (full === undefined || scaled === undefined) continue;
      if (typeof full.focusX !== "string" || typeof scaled.focusX !== "string") continue;
      checked = true;
      expect(scaled.focusX).not.toBe(full.focusX);
    }
    expect(checked).toBe(true);
  });

  it("the manifest ease shapes the drift expression", () => {
    let checked = false;
    for (let i = 0; i < 60 && !checked; i++) {
      const linear = kenBurnsCamera(opts({ seed: i }));
      const eased = kenBurnsCamera(opts({ seed: i, ease: "smoothstep" }));
      if (linear === undefined || eased === undefined) continue;
      if (typeof linear.focusX !== "string" || typeof eased.focusX !== "string") continue;
      checked = true;
      expect(eased.focusX).not.toBe(linear.focusX);
    }
    expect(checked).toBe(true);
  });

  it("MOVES/ZOOMS tables are non-empty and in the restrained band", () => {
    expect(MOVES.length).toBeGreaterThan(0);
    for (const z of ZOOMS) {
      expect(z).toBeGreaterThanOrEqual(1.05);
      expect(z).toBeLessThanOrEqual(1.2);
    }
  });
});
