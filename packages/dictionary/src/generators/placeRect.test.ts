import {
  isValidM0String,
  parseM0StringToRenderFrames,
} from "@m0saic/dsl";
import { placeRect } from "./placeRect";

describe("placeRect generator", () => {
  test("exact fit returns F", () => {
    const r = placeRect({ rootW: 1920, rootH: 1080, rectW: 1920, rectH: 1080 });
    expect(r.m0).toBe("1");
    expect(r.sourceCount).toBe(1);
  });

  test("centered rect produces valid DSL", () => {
    const r = placeRect({ rootW: 1920, rootH: 1080, rectW: 1740, rectH: 975 });
    expect(isValidM0String(r.m0)).toBe(true);
    const frames = parseM0StringToRenderFrames(r.m0, 1920, 1080);
    expect(frames.length).toBe(1);
    expect(frames[0].width).toBe(1740);
    expect(frames[0].height).toBe(975);
  });

  test("alignment works", () => {
    const r = placeRect({ rootW: 1920, rootH: 1080, rectW: 1000, rectH: 600, hAlign: "left", vAlign: "top" });
    expect(isValidM0String(r.m0)).toBe(true);
    const frames = parseM0StringToRenderFrames(r.m0, 1920, 1080);
    expect(frames[0].x).toBe(0);
    expect(frames[0].y).toBe(0);
  });

  test("invalid rectW > rootW throws", () => {
    expect(() => placeRect({ rootW: 100, rootH: 100, rectW: 200, rectH: 50 })).toThrow(/rectW/);
  });
});
