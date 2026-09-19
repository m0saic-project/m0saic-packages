import type { MosaicTextSource } from "@m0saic/types";
import { codeTheme } from "../../../_shared/code-theme";
import {
  buildSnippetChromePieces,
  computeSnippetFrameGeometry,
} from "./chrome";

describe("snippet frame geometry", () => {
  it("locks the default 16:9 editor frame", () => {
    expect(
      computeSnippetFrameGeometry({
        width: 1280,
        height: 720,
        fontSize: 16,
        showChrome: true,
        lineNumbers: true,
      }),
    ).toMatchInlineSnapshot(`
{
  "canvas": {
    "h": 720,
    "w": 1280,
    "x": 0,
    "y": 0,
  },
  "card": {
    "h": 604,
    "w": 1100,
    "x": 90,
    "y": 58,
  },
  "codeArea": {
    "h": 508,
    "w": 994,
    "x": 175,
    "y": 133,
  },
  "gutter": {
    "h": 508,
    "w": 51,
    "x": 111,
    "y": 133,
  },
  "padding": 21,
  "titleBar": {
    "h": 54,
    "w": 1100,
    "x": 90,
    "y": 58,
  },
  "titleSlot": {
    "h": 54,
    "w": 938,
    "x": 236,
    "y": 58,
  },
}
`);
  });

  it("keeps every rectangle integral and inside hostile small canvases", () => {
    const geometry = computeSnippetFrameGeometry({
      width: 383,
      height: 211,
      fontSize: 12,
      showChrome: true,
      lineNumbers: true,
    });
    for (const rect of Object.values(geometry).filter(
      (value): value is { x: number; y: number; w: number; h: number } =>
        typeof value === "object" && value != null && "x" in value,
    )) {
      expect(Object.values(rect).every(Number.isInteger)).toBe(true);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(383);
      expect(rect.y + rect.h).toBeLessThanOrEqual(211);
    }
  });
});

describe("snippet chrome pieces", () => {
  const geometry = computeSnippetFrameGeometry({
    width: 1280,
    height: 720,
    fontSize: 16,
    showChrome: true,
    lineNumbers: true,
  });

  it("is built only from native colour + text sources: title bound, one 3-glyph traffic-light source, one top-aligned number per row", () => {
    const pieces = buildSnippetChromePieces({
      geometry,
      theme: codeTheme("light"),
      title: "preview.ts",
      showChrome: true,
      trafficLights: true,
      lineNumbers: true,
      titleFontSize: 16,
      lineCount: 4,
      lineStep: 24,
    });

    expect(pieces.some((piece) => piece.source.type === "media")).toBe(false);
    expect(pieces).toHaveLength(11); // canvas, card, code-area, title bar, title, gutter, traffic lights, 4 numbers
    expect(pieces.map((p) => p.source.editor?.label).filter(Boolean)).toEqual(["card", "code-area", "title", "gutter", "traffic-lights"]);
    const title = pieces.find((p) => p.source.editor?.label === "title")!.source as MosaicTextSource;
    expect(title.editor?.binding).toEqual({ propKey: "chrome.title" });
    const lights = pieces.find((p) => p.source.editor?.label === "traffic-lights")!.source as MosaicTextSource;
    expect(lights.layers.map((l) => (l.content as { text: string }).text)).toEqual(["●", "●", "●"]);
    expect(new Set(lights.layers.map((l) => l.style?.fontColor)).size).toBe(3); // three inks → one coloured raster
    expect(lights.layers.map((l) => Number((l.placement as { xExpr: string }).xExpr))).toEqual([0, expect.any(Number), expect.any(Number)]);
    const numbers = pieces.filter((p) => p.source.type === "text" && p.source !== title && p.source !== lights).map((p) => p.source as MosaicTextSource);
    expect(numbers.map((n) => n.layers[0]!.content)).toEqual([1, 2, 3, 4].map((n) => ({ kind: "literal", text: String(n) })));
    expect(numbers.every((n) => n.rasterizer === "svg" && n.layers[0]!.placement?.vAlign === "top" && n.layers[0]!.placement?.hAlign === "right")).toBe(true);
    expect(pieces.filter((p) => p.rect.h === 24)).toHaveLength(4); // one lineStep-tall box per number
  });
});
