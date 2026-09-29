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

  it("hAlign and fontFamily reach the layer (P9 / P18); the defaults are centre and the bundled face", () => {
    const left = svgLabel("Hello", 400, 100, { hAlign: "left", fontFamily: "Helvetica Neue" }) as { layers?: Array<{ placement?: { hAlign?: string }; style?: { fontFamily?: string } }> };
    expect(left.layers?.[0]?.placement?.hAlign).toBe("left");
    expect(left.layers?.[0]?.style?.fontFamily).toBe("Helvetica Neue");
    const plain = svgLabel("Hello", 400, 100) as { layers?: Array<{ placement?: { hAlign?: string }; style?: { fontFamily?: string } }> };
    expect(plain.layers?.[0]?.placement?.hAlign).toBe("center");
    expect(plain.layers?.[0]?.style).not.toHaveProperty("fontFamily");
  });

  it("honors vAlign/padding pass-through", () => {
    const source = svgLabel("caption", 640, 360, {
      vAlign: "bottom",
      padding: { bottom: 0.06 },
    }) as unknown as TextLike;
    expect(source.layers[0]?.placement?.vAlign).toBe("bottom");
  });
});
