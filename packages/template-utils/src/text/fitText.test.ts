import { measureText } from "./textToPath";
import { fitSvgLines, fitSvgParagraphs, fitSvgText, wrapMeasured } from "./fitText";

describe("wrapMeasured", () => {
  it("never splits a word and preserves order", () => {
    const lines = wrapMeasured("one two three four", 40, 160);
    expect(lines.join(" ")).toBe("one two three four");
    expect(lines.length).toBeGreaterThan(1);
  });

  it("gives an over-long single word its own line", () => {
    expect(wrapMeasured("indivisible", 40, 10)).toEqual(["indivisible"]);
  });
});

describe("fitSvgText", () => {
  it("shrinks the font as the box narrows, never below 12", () => {
    const wide = fitSvgText("Reads the room", 800, 400, { maxPx: 96, maxLines: 3 });
    const narrow = fitSvgText("Reads the room", 200, 400, { maxPx: 96, maxLines: 3 });
    expect(wide.fontSize).toBeGreaterThan(narrow.fontSize);
    expect(narrow.fontSize).toBeGreaterThanOrEqual(12);
  });

  it("the fitted block genuinely measures inside the width budget", () => {
    const fit = fitSvgText("a considerably longer headline that must wrap", 420, 700, {
      maxPx: 120,
      maxLines: 3,
    });
    const m = measureText(fit.text, { fontSize: fit.fontSize });
    expect(m.width).toBeLessThanOrEqual(420 * 0.72 + 1);
    expect(fit.lineCount).toBe(fit.text.split("\n").length);
  });
});

describe("fitSvgParagraphs", () => {
  it("wraps long paragraphs instead of shrinking them, and keeps them separated", () => {
    const fit = fitSvgParagraphs(
      [
        "a long first paragraph that certainly needs to wrap onto several lines to stay readable",
        "short second",
      ],
      600,
      500,
      { maxPx: 28 },
    );
    expect(fit.text).toContain("\n\n");
    expect(fit.fontSize).toBeGreaterThanOrEqual(16);
    const m = measureText(fit.text, { fontSize: fit.fontSize });
    expect(m.width).toBeLessThanOrEqual(600 * 0.72 + 1);
  });
});

describe("fitSvgLines", () => {
  it("keeps the caller's line breaks verbatim", () => {
    const lines = ["m0  3(1,1,1)", "", "feasibility  120 x 40"];
    const fit = fitSvgLines(lines, 800, 400, { maxPx: 40 });
    expect(fit.text).toBe(lines.join("\n"));
  });

  it("sizes down for long widest lines", () => {
    const short = fitSvgLines(["ab", "cd"], 400, 400, { maxPx: 200 });
    const long = fitSvgLines(["a very very very long single line"], 400, 400, {
      maxPx: 200,
    });
    expect(short.fontSize).toBeGreaterThan(long.fontSize);
  });
});

describe("the too-small box (the fallback that used to overflow)", () => {
  // Both free-copy fitters used to give up and return the copy UNWRAPPED at
  // 12px when nothing fit. The rasterizer never soft-wraps, so that shipped
  // one long line running off BOTH edges of the box — a fitter emitting text
  // wider than the box it was handed. Wrapping at the floor clips vertically
  // instead, which is recoverable.
  const LONG =
    "A frame sequence is emit multi where every step is an IMAGE and each one " +
    "declares its own format, so the folder you end up with IS the deliverable.";

  it("fitSvgText wraps at the floor rather than emitting one endless line", () => {
    const fit = fitSvgText(LONG, 200, 30, { maxPx: 40, maxLines: 99 });
    expect(fit.lineCount).toBeGreaterThan(1);
    for (const line of fit.text.split("\n")) {
      expect(measureText(line, { fontSize: fit.fontSize }).width).toBeLessThanOrEqual(200);
    }
    // Nothing was dropped on the way.
    expect(fit.text.split("\n").join(" ").replace(/\s+/g, " ")).toBe(LONG);
  });

  it("fitSvgParagraphs wraps at the floor too, keeping the paragraph split", () => {
    const fit = fitSvgParagraphs([LONG, LONG], 200, 30, { maxPx: 40 });
    expect(fit.text).toContain("\n\n");
    for (const line of fit.text.split("\n").filter((l) => l.length > 0)) {
      expect(measureText(line, { fontSize: fit.fontSize }).width).toBeLessThanOrEqual(200);
    }
  });

  it("honors a lower minPx so a small canvas can still fit its copy", () => {
    // A 640x360 canvas is read on a stage many times its width, so 8px there
    // is legible — holding the 12px floor is what pushed tutorial copy past
    // its box.
    const floored = fitSvgText(LONG, 300, 60, { maxPx: 40, maxLines: 99 });
    const smaller = fitSvgText(LONG, 300, 60, { maxPx: 40, minPx: 7, maxLines: 99 });
    expect(smaller.fontSize).toBeLessThan(floored.fontSize);
    expect(smaller.fontSize).toBeGreaterThanOrEqual(7);
  });
});
