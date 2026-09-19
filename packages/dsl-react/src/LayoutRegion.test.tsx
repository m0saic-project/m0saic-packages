import { renderToStaticMarkup } from "react-dom/server";
import { parseM0StringToLogicalFrames } from "@m0saic/dsl";
import { LayoutRegions, LayoutRegion } from "./LayoutRegion";

const W = 100;
const H = 100;
const M0 = "2[1,1]"; // top / bottom halves

function labels() {
  const [topKey, bottomKey] = parseM0StringToLogicalFrames(M0, W, H).map(
    (f) => f.meta.stableKey as string,
  );
  return { [topKey]: { text: "top" }, [bottomKey]: { text: "bottom" } };
}

describe("<LayoutRegions> / <LayoutRegion>", () => {
  test("positions named regions absolutely at their rects", () => {
    const html = renderToStaticMarkup(
      <LayoutRegions m0={M0} canvasW={W} canvasH={H} labels={labels()}>
        <LayoutRegion name="top">A</LayoutRegion>
        <LayoutRegion name="bottom">B</LayoutRegion>
      </LayoutRegions>,
    );

    expect(html).toContain('data-layout-region="top"');
    expect(html).toContain('data-layout-region="bottom"');
    // bottom half starts at y=50 and is 50 tall.
    expect(html).toContain("top:50px");
    expect(html).toContain("height:50px");
    expect(html).toContain("A");
    expect(html).toContain("B");
    expect(html).toContain("position:absolute");
  });

  test("renders nothing for an unknown region name", () => {
    const html = renderToStaticMarkup(
      <LayoutRegions m0={M0} canvasW={W} canvasH={H} labels={labels()}>
        <LayoutRegion name="ghost">X</LayoutRegion>
      </LayoutRegions>,
    );
    expect(html).not.toContain('data-layout-region="ghost"');
    expect(html).not.toContain("X");
  });

  test("LayoutRegion outside a LayoutRegions stage throws", () => {
    expect(() => renderToStaticMarkup(<LayoutRegion name="x">y</LayoutRegion>)).toThrow(
      /inside <LayoutRegions>/,
    );
  });
});
