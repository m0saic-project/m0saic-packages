/**
 * @m0saic/brand/business-card/v3 — the QR back's geometry: everything inside
 * the safe area, the code as big as the text leaves it (never under 1.05 in,
 * never over the safe height), the title on one line or two.
 */
import { cardCanvas, inToPx, rectInside, type CardCanvas, type Rect } from "../v1/layout";
import { buildQrBackLayout, splitTitle } from "./layout";

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const rects = (c: CardCanvas, copy: { title: string; url: string; line: string }): Rect[] => {
  const b = buildQrBackLayout(c, copy);
  return [b.qr, ...b.title.map((l) => l.rect), b.url.rect, ...(b.line ? [b.line.rect] : [])];
};

const DEFAULT_COPY = { title: "See it for your business", url: "m0saic.io/solutions", line: "" };

describe("business-card/v3 — buildQrBackLayout", () => {
  it("keeps every rect inside the safe area, and the text clear of the code, on every preset and DPI", () => {
    for (const bleed of ["moo", "none", "sixteenth", "eighth"] as const) {
      for (const dpi of [150, 300, 600]) {
        const c = cardCanvas(bleed, dpi);
        for (const copy of [DEFAULT_COPY, { ...DEFAULT_COPY, line: "Booth 1234" }, { title: "Hi", url: "m0saic.io", line: "" }]) {
          const all = rects(c, copy);
          for (const r of all) expect(rectInside(r, c.safe)).toBe(true);
          const [qr, ...text] = all;
          for (const r of text) expect(overlaps(r, qr)).toBe(false);
        }
      }
    }
  });

  it("the default copy: a two-line title and the biggest code the safe area holds", () => {
    const c = cardCanvas("moo", 300);
    const b = buildQrBackLayout(c, DEFAULT_COPY);
    expect(b.title.map((l) => l.text)).toEqual(["See it for", "your business"]);
    expect(b.qr.w).toBe(b.qr.h);
    expect(b.qr.w).toBe(c.safe.h - 2 * inToPx(0.08, 300));
    expect(b.url.text).toBe("m0saic.io/solutions");
    expect(b.line).toBeNull();
  });

  it("a long link narrows the code instead of printing truncated", () => {
    const c = cardCanvas("moo", 300);
    const short = buildQrBackLayout(c, DEFAULT_COPY);
    const long = buildQrBackLayout(c, { ...DEFAULT_COPY, url: "m0saic.io/solutions/jewelry" });
    expect(long.url.text).toBe("m0saic.io/solutions/jewelry");
    expect(long.qr.w).toBeLessThan(short.qr.w);
    expect(long.qr.w).toBeGreaterThanOrEqual(inToPx(1.05, 300));
  });

  it("splitTitle: the balanced word break, and one word stays one line", () => {
    expect(splitTitle("See it for your business", 50).lines).toEqual(["See it for", "your business"]);
    expect(splitTitle("Solutions", 50).lines).toEqual(["Solutions"]);
  });

  it("is deterministic", () => {
    const c = cardCanvas("moo", 300);
    expect(buildQrBackLayout(c, DEFAULT_COPY)).toEqual(buildQrBackLayout(c, DEFAULT_COPY));
  });
});
