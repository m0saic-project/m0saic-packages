import type { MosaicXDocument } from "@m0saic/types";
import { mosaicxFromShareParams, shareParamsFromMosaicx } from "./mosaicxLink";

const T = "@m0saic/alpine/contributor-table/v1";

function doc(overrides: Partial<MosaicXDocument> = {}): MosaicXDocument {
  return {
    kind: "mosaicx_document",
    version: 1,
    m0: "1" as MosaicXDocument["m0"],
    assets: {} as MosaicXDocument["assets"],
    size: { width: 1280, height: 720 },
    sources: [
      { type: "template_invocation", templateId: T as never, props: { title: "Hi", sourceIds: ["/x.mp4"] } },
    ],
    ...overrides,
  } as MosaicXDocument;
}

describe("shareParamsFromMosaicx", () => {
  it("lifts the single invocation, canvas and optional asks; scrubs sourceIds", () => {
    expect(shareParamsFromMosaicx(doc({ fps: 24, durationMs: 4000 }))).toEqual({
      templateId: T,
      props: { title: "Hi" },
      w: 1280,
      h: 720,
      asks: { fps: 24, durationMs: 4000 },
    });
  });

  it("omits asks when the doc carries no fps / duration; a file-level version pin does not travel", () => {
    const d = doc();
    (d.sources![0] as { templateVersion?: number }).templateVersion = 2;
    expect(shareParamsFromMosaicx(d)).toEqual({ templateId: T, props: { title: "Hi" }, w: 1280, h: 720 });
  });

  it("returns null without exactly one invocation or without a canvas", () => {
    expect(shareParamsFromMosaicx(doc({ sources: [] }))).toBeNull();
    const two = doc();
    two.sources = [two.sources![0], two.sources![0]];
    expect(shareParamsFromMosaicx(two)).toBeNull();
    expect(shareParamsFromMosaicx(doc({ size: undefined }))).toBeNull();
    expect(shareParamsFromMosaicx(doc({ size: { width: 0, height: 10 } }))).toBeNull();
  });
});

describe("mosaicxFromShareParams", () => {
  it("builds one invocation at the link's canvas", () => {
    const d = mosaicxFromShareParams({ templateId: T, props: { title: "Hi", sourceId: "/x" }, w: 1920, h: 1080 });
    expect(d.kind).toBe("mosaicx_document");
    expect(d.size).toEqual({ width: 1920, height: 1080 });
    expect(d.sources).toEqual([{ type: "template_invocation", templateId: T, props: { title: "Hi" } }]);
    expect("fps" in d).toBe(false);
    expect("durationMs" in d).toBe(false);
  });

  it("stamps fps / durationMs only when present", () => {
    const d = mosaicxFromShareParams({
      templateId: T, props: {}, w: 1, h: 1, asks: { fps: 24, durationMs: 4000 },
    });
    expect(d.fps).toBe(24);
    expect(d.durationMs).toBe(4000);
    expect("templateVersion" in d.sources![0]).toBe(false);
  });

  it("round-trips through the file", () => {
    const params = { templateId: T, props: { a: [1, 2] }, w: 640, h: 480, asks: { fps: 30 } };
    expect(shareParamsFromMosaicx(mosaicxFromShareParams(params))).toEqual(params);
  });
});

describe("mosaicxFromShareParams — no canvas in the link (2026-09-13)", () => {
  it("stamps no size, so the file resolves at the template's own hint", () => {
    const d = mosaicxFromShareParams({ templateId: "@m0saic/alpine/contributor-table/v1", props: {} });
    expect(d.size).toBeUndefined();
    expect(d.sources).toHaveLength(1);
  });
});
