import { autoZoomForTile, parkedCamera, zoomToTileCamera } from "./camera";

describe("camera", () => {
  it("auto zoom fills ~55% of the tighter axis, clamped to [1.2, 4]", () => {
    expect(autoZoomForTile({ width: 350, height: 238 }, 3840, 1966)).toBe(4); // the tip at 4K wants more than 4
    expect(autoZoomForTile({ width: 1000, height: 1000 }, 1280, 720)).toBeCloseTo(1.2); // huge tile → floor
    const z = autoZoomForTile({ width: 200, height: 100 }, 1280, 720);
    expect(z).toBeGreaterThan(1.2); expect(z).toBeLessThan(4);
  });
  it("dolly keyframes run 1 → Z with the focus centred on the tile; reverse runs Z → 1", () => {
    const tile = { x: 100, y: 100, width: 50, height: 34 };
    const cam = zoomToTileCamera({ tile, stageW: 1000, stageH: 500, zoom: 3, startSec: 1, endSec: 2 });
    expect(typeof cam.zoom).toBe("string");
    expect(cam.zoom as string).toContain("1.00000");
    expect(cam.zoom as string).toContain("3.00000");
    expect(typeof cam.focusX).toBe("number");
    const rev = zoomToTileCamera({ tile, stageW: 1000, stageH: 500, zoom: 3, startSec: 0, endSec: 1, reverse: true });
    expect((rev.zoom as string).indexOf("3.00000")).toBeLessThan((rev.zoom as string).indexOf("1.00000") + 200);
    const parked = parkedCamera({ tile, stageW: 1000, stageH: 500, zoom: 3 });
    expect(parked.zoom).toBe(3);
    expect(parked.focusX).toBe(cam.focusX);
  });
});
