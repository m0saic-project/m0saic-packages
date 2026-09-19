import type { MosaicDocument, MosaicTextSource } from "@m0saic/types";
import { makeErrorMosaic } from "./makeErrorMosaic";

describe("makeErrorMosaic", () => {
  describe("basic functionality", () => {
    test("creates a valid MosaicDocument", () => {
      const doc = makeErrorMosaic("Test error message", {
        width: 1920,
        height: 1080,
      });

      expect(doc.kind).toBe("mosaic_document");
      expect(doc.version).toBe(1);
      expect(doc.m0).toBe("1"); // "F" canonicalizes to "1"
      expect((doc.sources ?? [])).toHaveLength(1);
    });

    test("uses default title when not provided", () => {
      const doc = makeErrorMosaic("Test message", {
        width: 1920,
        height: 1080,
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
    expect(source.layers?.[0].content).toEqual({
      kind: "literal",
      text: "ERROR: Template Error",
    });
    });

    test("uses custom title when provided", () => {
      const doc = makeErrorMosaic("Test message", {
        width: 1920,
        height: 1080,
        title: "Custom Error",
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
    expect(source.layers?.[0].content).toEqual({
      kind: "literal",
      text: "ERROR: Custom Error",
    });
    });

    test("uses default colors when not provided", () => {
      const doc = makeErrorMosaic("Test message", {
        width: 1920,
        height: 1080,
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      expect(source.visual?.backgroundColor).toBe("#000000");
      expect(source.layers?.[0].style?.fontColor).toBe("#ffffff");
    });

    test("uses custom colors when provided", () => {
      const doc = makeErrorMosaic("Test message", {
        width: 1920,
        height: 1080,
        backgroundColor: "#ff0000",
        textColor: "#00ff00",
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      expect(source.visual?.backgroundColor).toBe("#ff0000");
      expect(source.layers?.[0].style?.fontColor).toBe("#00ff00");
    });
  });

  describe("engine metadata", () => {
    test("stamps error status in engine metadata", () => {
      const doc = makeErrorMosaic("Test error", {
        width: 1920,
        height: 1080,
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      expect(source.engine?.renderStatus).toBe("error");
      expect(source.engine?.renderError).toBeDefined();
    });

    test("includes message in render error", () => {
      const doc = makeErrorMosaic("Something went wrong", {
        width: 1920,
        height: 1080,
        title: "Test Error",
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      expect(source.engine?.renderError?.message).toBe("Test Error: Something went wrong");
    });

    test("includes error code when provided", () => {
      const doc = makeErrorMosaic("Test error", {
        width: 1920,
        height: 1080,
        errorCode: "INVALID_INPUT",
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      expect(source.engine?.renderError?.code).toBe("INVALID_INPUT");
    });

    test("omits error code when not provided", () => {
      const doc = makeErrorMosaic("Test error", {
        width: 1920,
        height: 1080,
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      expect(source.engine?.renderError?.code).toBeUndefined();
    });
  });

  describe("text wrapping", () => {
    test("wraps long messages into multiple lines", () => {
      const longMessage = "This is a very long error message that should wrap across multiple lines when rendered in the error mosaic display because it contains many words that need to be broken up";
      const doc = makeErrorMosaic(longMessage, {
        width: 1920,
        height: 1080,
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      // Should have title layer + at least one body layer (may wrap to multiple)
      expect(source.layers?.length).toBeGreaterThanOrEqual(2);
      // If message is long enough, it should wrap
      if (longMessage.length > 100) {
        expect(source.layers?.length).toBeGreaterThan(2);
      }
    });

    test("handles single word messages", () => {
      const doc = makeErrorMosaic("Error", {
        width: 1920,
        height: 1080,
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      // Title + at least one body line
      expect(source.layers?.length).toBeGreaterThanOrEqual(2);
    });

    test("handles empty message", () => {
      const doc = makeErrorMosaic("", {
        width: 1920,
        height: 1080,
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      // Should still have title layer
      expect(source.layers?.length).toBeGreaterThanOrEqual(1);
    });

    test("trims whitespace from message", () => {
      const doc = makeErrorMosaic("   Test message   ", {
        width: 1920,
        height: 1080,
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      const bodyLayer = source.layers?.[1];
    expect(bodyLayer?.content).toEqual({
      kind: "literal",
      text: "Test message",
    });
    });

    test("handles messages with newlines", () => {
      const doc = makeErrorMosaic("Line 1\nLine 2\nLine 3", {
        width: 1920,
        height: 1080,
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      // Should wrap properly (newlines converted to spaces)
      // At minimum: title + at least one body line
      expect(source.layers?.length).toBeGreaterThanOrEqual(2);
    });

    test("handles Windows line endings", () => {
      const doc = makeErrorMosaic("Line 1\r\nLine 2\r\nLine 3", {
        width: 1920,
        height: 1080,
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      // Should handle \r\n properly (converts to spaces)
      // At minimum: title + at least one body line
      expect(source.layers?.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("font size scaling", () => {
    test("scales font size based on width", () => {
      const smallDoc = makeErrorMosaic("Test", {
        width: 640,
        height: 360,
      });

      const largeDoc = makeErrorMosaic("Test", {
        width: 3840,
        height: 2160,
      });

      const smallSource = (smallDoc.sources ?? [])[0] as MosaicTextSource;
      const largeSource = (largeDoc.sources ?? [])[0] as MosaicTextSource;

      const smallTitleFont = smallSource.layers?.[0].style?.fontSize;
      const largeTitleFont = largeSource.layers?.[0].style?.fontSize;

      expect(largeTitleFont).toBeGreaterThan(smallTitleFont!);
    });

    test("clamps title font size between 16 and 40", () => {
      const tinyDoc = makeErrorMosaic("Test", {
        width: 100,
        height: 100,
      });

      const hugeDoc = makeErrorMosaic("Test", {
        width: 10000,
        height: 10000,
      });

      const tinySource = (tinyDoc.sources ?? [])[0] as MosaicTextSource;
      const hugeSource = (hugeDoc.sources ?? [])[0] as MosaicTextSource;

      const tinyTitleFont = tinySource.layers?.[0].style?.fontSize;
      const hugeTitleFont = hugeSource.layers?.[0].style?.fontSize;

      // Tiny canvases get PROPORTIONAL type (≤14% of the height) — the old
      // 16px floor on a 100px canvas is the "wall of letters" once a preview
      // scales it to the stage (2026-09-13). The 40px ceiling still holds.
      expect(tinyTitleFont).toBeGreaterThanOrEqual(4);
      expect(tinyTitleFont).toBeLessThanOrEqual(Math.round(100 * 0.14));
      expect(hugeTitleFont).toBe(40);
      // Ordinary canvases keep the legible floor the old clamp guaranteed.
      const midSource = (makeErrorMosaic("Test", { width: 400, height: 400 }).sources ?? [])[0] as MosaicTextSource;
      expect(midSource.layers?.[0].style?.fontSize).toBeGreaterThanOrEqual(16);
    });

    test("clamps body font size between 12 and 22", () => {
      const tinyDoc = makeErrorMosaic("Test message", {
        width: 100,
        height: 100,
      });

      const hugeDoc = makeErrorMosaic("Test message", {
        width: 10000,
        height: 10000,
      });

      const tinySource = (tinyDoc.sources ?? [])[0] as MosaicTextSource;
      const hugeSource = (hugeDoc.sources ?? [])[0] as MosaicTextSource;

      const tinyBodyFont = tinySource.layers?.[1]?.style?.fontSize;
      const hugeBodyFont = hugeSource.layers?.[1]?.style?.fontSize;

      // Same proportional rule for the body (≤9% of the height); 22px ceiling.
      expect(tinyBodyFont).toBeGreaterThanOrEqual(3);
      expect(tinyBodyFont).toBeLessThanOrEqual(Math.round(100 * 0.09));
      expect(hugeBodyFont).toBe(22);
      const midSource = (makeErrorMosaic("Test message", { width: 400, height: 400 }).sources ?? [])[0] as MosaicTextSource;
      expect(midSource.layers?.[1]?.style?.fontSize).toBeGreaterThanOrEqual(12);
    });
  });

  describe("line truncation", () => {
    test("truncates very long lines", () => {
      const veryLongLine = "a".repeat(200);
      const doc = makeErrorMosaic(veryLongLine, {
        width: 1920,
        height: 1080,
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      const bodyLayer = source.layers?.[1];
    expect(bodyLayer?.content).toMatchObject({
      kind: "literal",
    });
    expect(bodyLayer?.content.kind).toBe("literal");
    const bodyText =
      bodyLayer?.content.kind === "literal" ? bodyLayer?.content.text : "";
    expect(bodyText.length).toBeLessThan(200);
    expect(bodyText).toMatch(/\.\.\.$/);
    });

    test("handles truncation with maxCols <= 3", () => {
      const doc = makeErrorMosaic("Test message", {
        width: 50, // Very small width
        height: 50,
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      // Should still produce valid output
      expect(source.layers?.length).toBeGreaterThan(0);
    });
  });

  describe("line limit", () => {
    test("limits number of lines based on height", () => {
      const manyLines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join(" ");
      const doc = makeErrorMosaic(manyLines, {
        width: 1920,
        height: 1080,
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      // Should have title + limited body lines (max 24)
      expect(source.layers?.length).toBeLessThanOrEqual(25); // 1 title + 24 max body
    });

    test("ensures minimum of 3 lines when possible", () => {
      const shortMessage = "Short";
      const doc = makeErrorMosaic(shortMessage, {
        width: 1920,
        height: 1080,
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      // Should have at least title + some body content
      expect(source.layers?.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("ASCII-only conversion", () => {
    test("converts non-ASCII characters to ?", () => {
      const doc = makeErrorMosaic("Test with émojis 🎉 and unicode 中文", {
        width: 1920,
        height: 1080,
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      const bodyLayer = source.layers?.[1];
      // Should contain ? for non-ASCII characters
    const bodyText =
      bodyLayer?.content.kind === "literal" ? bodyLayer?.content.text : "";
    expect(bodyText).toMatch(/\?/);
    expect(bodyText).not.toMatch(/🎉/);
    expect(bodyText).not.toMatch(/中文/);
    });

    test("preserves ASCII characters", () => {
      const doc = makeErrorMosaic("Test message with ASCII: !@#$%^&*()", {
        width: 1920,
        height: 1080,
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      const bodyLayer = source.layers?.[1];
    const bodyText =
      bodyLayer?.content.kind === "literal" ? bodyLayer?.content.text : "";
    expect(bodyText).toContain("Test message");
    expect(bodyText).toContain("ASCII");
    });
  });

  describe("layout positioning", () => {
    test("positions title at top", () => {
      const doc = makeErrorMosaic("Test", {
        width: 1920,
        height: 1080,
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      const titleLayer = source.layers?.[0];
      expect(titleLayer?.placement?.vAlign).toBe("top");
      expect(titleLayer?.placement?.yExpr).toContain("0.06");
    });

    test("positions body text below title", () => {
      const doc = makeErrorMosaic("Test message", {
        width: 1920,
        height: 1080,
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      const bodyLayer = source.layers?.[1];
      expect(bodyLayer?.placement?.vAlign).toBe("top");
      expect(bodyLayer?.placement?.yExpr).toContain("0.18");
    });

    test("left-aligns all text", () => {
      const doc = makeErrorMosaic("Test message", {
        width: 1920,
        height: 1080,
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      source.layers?.forEach((layer) => {
        expect(layer.placement?.hAlign).toBe("left");
        expect(layer.placement?.xExpr).toBe("w*0.06");
      });
    });
  });

  describe("edge cases", () => {
    test("handles very small dimensions", () => {
      const doc = makeErrorMosaic("Test", {
        width: 100,
        height: 100,
      });

      expect(doc.kind).toBe("mosaic_document");
      expect((doc.sources ?? [])).toHaveLength(1);
    });

    test("handles very large dimensions", () => {
      const doc = makeErrorMosaic("Test", {
        width: 10000,
        height: 10000,
      });

      expect(doc.kind).toBe("mosaic_document");
      expect((doc.sources ?? [])).toHaveLength(1);
    });

    test("handles message with only whitespace", () => {
      const doc = makeErrorMosaic("   \n\t   ", {
        width: 1920,
        height: 1080,
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      // Should still have title
      expect(source.layers?.length).toBeGreaterThanOrEqual(1);
    });

    test("handles special characters in title", () => {
      const doc = makeErrorMosaic("Test", {
        width: 1920,
        height: 1080,
        title: "Error: Something <went> wrong!",
      });

      const source = (doc.sources ?? [])[0] as MosaicTextSource;
      const titleLayer = source.layers?.[0];
    const titleText =
      titleLayer?.content.kind === "literal" ? titleLayer?.content.text : "";
    expect(titleText).toContain("ERROR:");
    });
  });
});

// 2026-09-13: the card must stay legible at tiny / squat canvases. The 64×64
// data-carrier tile (repo-facts-fetcher) drew 16px/12px type on a 64px canvas
// — title and body stacked over each other once Make scaled it to the stage.
describe("makeErrorMosaic — proportional layout at small canvases", () => {
  const layersOf = (doc: ReturnType<typeof makeErrorMosaic>) =>
    ((doc.sources[0] as { layers: Array<{ style: { fontSize: number }; placement: { yExpr: string }; content: { text: string } }> }).layers);
  const yFrac = (yExpr: string) => Number(yExpr.replace(/^h\*/, ""));

  test("64×64: fonts shrink with the canvas, the body starts below the title, every line fits", () => {
    const doc = makeErrorMosaic("GitHub fetch failed for FFmpeg/FFmpeg (2026-06-01..2026-06-08): boom", { width: 64, height: 64, title: "GitHub Repo Facts" });
    const [title, ...body] = layersOf(doc);
    expect(title.style.fontSize).toBeLessThanOrEqual(Math.round(64 * 0.14));
    expect(body.length).toBeGreaterThan(0);
    for (const l of body) expect(l.style.fontSize).toBeLessThanOrEqual(Math.round(64 * 0.09));
    // Body's first line sits under the title's line box (title top + 1.25 × its size).
    const titleBottomFrac = (0.06 * 64 + title.style.fontSize * 1.25) / 64;
    expect(yFrac(body[0].placement.yExpr)).toBeGreaterThanOrEqual(titleBottomFrac - 1e-6);
    // Nothing is placed below the canvas.
    for (const l of body) expect(yFrac(l.placement.yExpr) + (l.style.fontSize * 1.25) / 64).toBeLessThanOrEqual(1.0001);
    // Lines wrap to the 64px width (≈0.62em per char).
    for (const l of body) expect(l.content.text.length * l.style.fontSize * 0.62).toBeLessThanOrEqual(64 * 0.88 + 1);
  });

  test("1920×64 strip: the height cap keeps the title from eating the whole card", () => {
    const doc = makeErrorMosaic("a ".repeat(200), { width: 1920, height: 64 });
    const [title, ...body] = layersOf(doc);
    expect(title.style.fontSize).toBeLessThanOrEqual(Math.round(64 * 0.14));
    expect(body.length).toBeGreaterThan(0);
    for (const l of body) expect(yFrac(l.placement.yExpr) + (l.style.fontSize * 1.25) / 64).toBeLessThanOrEqual(1.0001);
  });

  test("1920×1080: the large-canvas type is unchanged (40 / 22)", () => {
    const [title, first] = layersOf(makeErrorMosaic("x", { width: 1920, height: 1080 }));
    expect(title.style.fontSize).toBe(40);
    expect(first.style.fontSize).toBe(22);
    expect(yFrac(first.placement.yExpr)).toBeCloseTo(0.18, 6);
  });
});
