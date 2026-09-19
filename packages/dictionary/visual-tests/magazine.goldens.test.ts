import { isValidM0String } from "@m0saic/dsl";
import { magazine } from "../src/generators/magazine";
import { assertWireframeGolden } from "./__harness__/goldens";

// ---------------------------------------------------------------------------
// Golden wireframe PNG tests
// ---------------------------------------------------------------------------

describe("magazine goldens", () => {
  test("default layout (no gutter)", () => {
    const r = magazine({});
    expect(isValidM0String(r.m0)).toBe(true);

    assertWireframeGolden({
      id: "build-magazine-m0saic__default",
      m0: r.m0,
      width: r.totalX * 20,
      height: r.totalY * 20,
    });
  });

  test("default layout with gutter", () => {
    const r = magazine({ gutter: 0.02 });
    expect(isValidM0String(r.m0)).toBe(true);

    assertWireframeGolden({
      id: "build-magazine-m0saic__gutter_0p02",
      m0: r.m0,
      width: r.totalX * 20,
      height: r.totalY * 20,
    });
  });

  test("hero-dominant 3:1 with gutter", () => {
    const r = magazine({ heroWeight: 3, sidebarWeight: 1, gutter: 0.02 });
    expect(isValidM0String(r.m0)).toBe(true);

    assertWireframeGolden({
      id: "build-magazine-m0saic__hero3_sidebar1__gutter_0p02",
      m0: r.m0,
      width: r.totalX * 20,
      height: r.totalY * 20,
    });
  });

  test("4 sidebar + 4 bottom with gutter", () => {
    const r = magazine({ sidebarCount: 4, bottomCount: 4, gutter: 0.02 });
    expect(isValidM0String(r.m0)).toBe(true);

    assertWireframeGolden({
      id: "build-magazine-m0saic__sidebar4_bottom4__gutter_0p02",
      m0: r.m0,
      width: r.totalX * 20,
      height: r.totalY * 20,
    });
  });

  test("default layout 1920x1080", () => {
    const r = magazine({});
    expect(isValidM0String(r.m0)).toBe(true);

    assertWireframeGolden({
      id: "build-magazine-m0saic__default__1920x1080",
      m0: r.m0,
      width: 1920,
      height: 1080,
    });
  });

  test("default with gutter 1920x1080", () => {
    const r = magazine({ gutter: 0.02 });
    expect(isValidM0String(r.m0)).toBe(true);

    assertWireframeGolden({
      id: "build-magazine-m0saic__gutter_0p02__1920x1080",
      m0: r.m0,
      width: 1920,
      height: 1080,
    });
  });

  test("hero-dominant 3:1 1920x1080", () => {
    const r = magazine({ heroWeight: 3, sidebarWeight: 1, gutter: 0.02 });
    expect(isValidM0String(r.m0)).toBe(true);

    assertWireframeGolden({
      id: "build-magazine-m0saic__hero3_sidebar1__gutter_0p02__1920x1080",
      m0: r.m0,
      width: 1920,
      height: 1080,
    });
  });

  test("4 sidebar + 4 bottom 1920x1080", () => {
    const r = magazine({ sidebarCount: 4, bottomCount: 4, gutter: 0.02 });
    expect(isValidM0String(r.m0)).toBe(true);

    assertWireframeGolden({
      id: "build-magazine-m0saic__sidebar4_bottom4__gutter_0p02__1920x1080",
      m0: r.m0,
      width: 1920,
      height: 1080,
    });
  });

  test("editorial spread 1920x1080", () => {
    const r = magazine({
      heroWeight: 3,
      sidebarWeight: 2,
      sidebarCount: 3,
      topWeight: 3,
      bottomWeight: 1,
      bottomCount: 4,
      gutter: 0.02,
    });
    expect(isValidM0String(r.m0)).toBe(true);

    assertWireframeGolden({
      id: "build-magazine-m0saic__hero3_sidebar2x3__top3_bottom1x4__gutter_0p02__1920x1080",
      m0: r.m0,
      width: 1920,
      height: 1080,
    });
  });

  test("editorial spread 1080x1080", () => {
    const r = magazine({
      heroWeight: 3,
      sidebarWeight: 2,
      sidebarCount: 3,
      topWeight: 3,
      bottomWeight: 1,
      bottomCount: 4,
      gutter: 0.02,
    });
    expect(isValidM0String(r.m0)).toBe(true);

    assertWireframeGolden({
      id: "build-magazine-m0saic__hero3_sidebar2x3__top3_bottom1x4__gutter_0p02__1080x1080",
      m0: r.m0,
      width: 1080,
      height: 1080,
    });
  });
});
