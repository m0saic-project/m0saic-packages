import { svgLabel, svgTextSource } from "./svgTextSource";

type TextLike = {
  type: string;
  rasterizer?: string;
  renderMode?: { kind?: string };
  layers: Array<{
    content?: { text?: string };
    style?: { fontSize?: number };
    placement?: { hAlign?: string; vAlign?: string };
  }>;
};

describe("svgTextSource", () => {
  it("emits an svg-rasterized static text source", () => {
    const source = svgTextSource([
      { text: "hello", fontSize: 24, color: "#ffffff" as never },
    ]) as unknown as TextLike;
    expect(source.type).toBe("text");
    expect(source.rasterizer).toBe("svg");
    expect(source.renderMode?.kind).toBe("image");
    expect(source.layers[0]?.content?.text).toBe("hello");
    expect(source.layers[0]?.placement?.hAlign).toBe("center");
  });
});

describe("svgLabel", () => {
  it("fits the label to its box and keeps the copy verbatim", () => {
    const source = svgLabel("42px", 320, 720) as unknown as TextLike;
    expect(source.layers).toHaveLength(1);
    expect(source.layers[0]?.content?.text).toBe("42px");
    expect(source.layers[0]?.style?.fontSize).toBeGreaterThanOrEqual(12);
  });

  it("honors vAlign/padding pass-through", () => {
    const source = svgLabel("caption", 640, 360, {
      vAlign: "bottom",
      padding: { bottom: 0.06 },
    }) as unknown as TextLike;
    expect(source.layers[0]?.placement?.vAlign).toBe("bottom");
  });
});
