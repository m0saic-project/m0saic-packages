import {
  PAGE_SKELETON_CAPTURE_FORMAT,
  PAGE_SKELETON_CAPTURE_VERSION,
  parseCapture,
} from "./schema";

const validCapture = () => ({
  format: PAGE_SKELETON_CAPTURE_FORMAT,
  version: PAGE_SKELETON_CAPTURE_VERSION,
  viewport: { w: 1440, h: 900, dpr: 2 },
  rects: [
    { x: 24, y: 16, w: 120, h: 32, k: "control", r: 16, d: 3 },
  ],
  meta: { total: 1, dropped: 0 },
});

describe("parseCapture", () => {
  it("normalizes equivalent object and JSON-string inputs", () => {
    const input = validCapture();
    expect(parseCapture(input)).toEqual(input);
    expect(parseCapture(JSON.stringify(input))).toEqual(input);
  });

  it("defaults optional rect fields, folds unknown kinds to block, and ignores unknown keys", () => {
    const input = {
      ...validCapture(),
      ignored: { pageUrl: "not part of the seam" },
      viewport: { w: 320, h: 180, ignored: true },
      rects: [
        { x: 1, y: 2, w: 30, h: 20, extra: "ignored" },
        { x: 4, y: 5, w: 10, h: 8, k: "future-kind", r: 1, d: 2 },
      ],
      meta: undefined,
    };

    expect(parseCapture(input)).toEqual({
      format: PAGE_SKELETON_CAPTURE_FORMAT,
      version: 1,
      viewport: { w: 320, h: 180 },
      rects: [
        { x: 1, y: 2, w: 30, h: 20, k: "block", r: 0, d: 0 },
        { x: 4, y: 5, w: 10, h: 8, k: "block", r: 1, d: 2 },
      ],
    });
  });

  it.each([
    ["invalid JSON", "{", /invalid JSON/],
    ["non-object payload", "[]", /payload must be an object/],
    [
      "wrong format",
      JSON.stringify({ ...validCapture(), format: "other" }),
      /format must be "m0saic-page-skeleton"/,
    ],
    [
      "wrong version",
      JSON.stringify({ ...validCapture(), version: 2 }),
      /version must be 1/,
    ],
    [
      "bad viewport width",
      JSON.stringify({ ...validCapture(), viewport: { w: 0, h: 10 } }),
      /viewport\.w must be at least 1/,
    ],
    [
      "bad device-pixel ratio",
      JSON.stringify({ ...validCapture(), viewport: { w: 10, h: 10, dpr: 0 } }),
      /viewport\.dpr must be a positive finite number/,
    ],
    [
      "non-array rects",
      JSON.stringify({ ...validCapture(), rects: {} }),
      /rects must be an array/,
    ],
  ])("rejects %s", (_label, input, expected) => {
    expect(() => parseCapture(input)).toThrow(expected);
  });

  it.each([
    [{ x: 0.5, y: 0, w: 10, h: 10 }, /rects\[0\]\.x must be a finite integer/],
    [{ x: 0, y: 0, w: 0, h: 10 }, /rects\[0\]\.w must be at least 1/],
    [{ x: 0, y: 0, w: 10, h: 10, k: 4 }, /rects\[0\]\.k must be a string/],
    [{ x: 0, y: 0, w: 10, h: 10, r: -1 }, /rects\[0\]\.r must be at least 0/],
    [{ x: 0, y: 0, w: 10, h: 10, r: 6 }, /rects\[0\]\.r must be at most 5/],
    [{ x: 0, y: 0, w: 10, h: 10, d: -1 }, /rects\[0\]\.d must be at least 0/],
  ])("reports the offending rect index for malformed geometry", (rect, expected) => {
    expect(() => parseCapture({ ...validCapture(), rects: [rect] })).toThrow(expected);
  });

  it("validates optional metadata counts", () => {
    expect(() =>
      parseCapture({ ...validCapture(), meta: { total: 1, dropped: -1 } }),
    ).toThrow(/meta\.dropped must be at least 0/);
  });
});
