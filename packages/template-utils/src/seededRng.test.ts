import { mulberry32, splitmix32 } from "./seededRng";

describe("mulberry32", () => {
  it("is deterministic given a seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it("diverges across seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let same = 0;
    for (let i = 0; i < 20; i++) if (a() === b()) same++;
    expect(same).toBeLessThan(5);
  });

  it("returns values in [0, 1)", () => {
    const r = mulberry32(99);
    for (let i = 0; i < 200; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("splitmix32", () => {
  it("is deterministic given a seed", () => {
    const a = splitmix32(7);
    const b = splitmix32(7);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it("produces well-separated streams from adjacent seeds", () => {
    const a = splitmix32(1);
    const b = splitmix32(2);
    // First draws should differ; the entire point of splitmix is to
    // spread bits aggressively so neighbours don't share prefixes.
    expect(a()).not.toBe(b());
  });

  it("returns values in [0, 1)", () => {
    const r = splitmix32(123);
    for (let i = 0; i < 200; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
