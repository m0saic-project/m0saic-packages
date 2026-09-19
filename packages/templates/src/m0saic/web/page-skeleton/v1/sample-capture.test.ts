import { SAMPLE_CAPTURE } from "./sample-capture";
import { PAGE_SKELETON_RECT_KINDS, parseCapture } from "./schema";

describe("SAMPLE_CAPTURE", () => {
  it("is a valid, deterministic, full-coverage schema-v1 fixture", () => {
    expect(parseCapture(SAMPLE_CAPTURE)).toEqual(SAMPLE_CAPTURE);
    expect(SAMPLE_CAPTURE.rects).toHaveLength(64);
    expect(SAMPLE_CAPTURE.meta).toEqual({ total: 64, dropped: 0 });
    expect(new Set(SAMPLE_CAPTURE.rects.map((rect) => rect.k))).toEqual(
      new Set(PAGE_SKELETON_RECT_KINDS),
    );
    expect(JSON.stringify(SAMPLE_CAPTURE)).toBe(JSON.stringify(SAMPLE_CAPTURE));
  });

  it("keeps every anonymous rect inside the fixture viewport", () => {
    for (const rect of SAMPLE_CAPTURE.rects) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(SAMPLE_CAPTURE.viewport.w);
      expect(rect.y + rect.h).toBeLessThanOrEqual(SAMPLE_CAPTURE.viewport.h);
    }
  });

  it("contains geometry only, with no page identity or captured content fields", () => {
    const keys = new Set<string>();
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
      } else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          keys.add(key.toLowerCase());
          visit(child);
        }
      }
    };
    visit(SAMPLE_CAPTURE);

    for (const forbiddenKey of [
      "url",
      "title",
      "text",
      "value",
      "class",
      "attribute",
      "timestamp",
      "userAgent",
    ]) {
      expect(keys).not.toContain(forbiddenKey.toLowerCase());
    }
  });
});
