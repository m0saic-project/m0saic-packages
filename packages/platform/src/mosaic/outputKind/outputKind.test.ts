import { collectMotionEvidence, inferOutputKind, isAnimatedRenderable, stampedOutputKind } from "./outputKind";

const still = { kind: "mosaic_document", version: 1, m0: "2(1,1)", assets: {}, sources: [{ type: "lavfi", color: "#000" }, { type: "text", layers: [{ content: { kind: "literal", text: "hi" } }] }] };
const withOverlay = { ...still, sources: [{ type: "lavfi", color: "#000", overlay: { startAtSec: 0.2, alpha: "min(1,t)" } }] };
const withExprText = { ...still, sources: [{ type: "text", layers: [{ content: { kind: "expr", expr: "%{eif:t}" } }] }] };
const withVideoText = { ...still, sources: [{ type: "text", renderMode: { kind: "video" }, layers: [{ content: { kind: "literal", text: "x" } }] }] };
const withCamera = { ...still, sources: [{ type: "lavfi", color: "#000", effects: { camera: { zoom: "1+t" } } }] };
const nestedAnimated = { ...still, sources: [{ type: "mosaic", ref: "kid" }], children: { kid: withOverlay } };
// ⭐ Footage. The regression this guards: a video playing through a text mask —
// no overlay expression, no camera, one step — scored ZERO evidence until
// 2026-09-26 and was classified a still (`carved-type`, found in Make).
const withVideoMedia = { ...still, sources: [{ type: "media", mediaType: "video", assetId: "clip" }] };
const withVideoMediaKindOnly = { ...still, sources: [{ type: "media", kind: "video", assetId: "clip" }] };
const withImageMedia = { ...still, sources: [{ type: "media", mediaType: "image", assetId: "pic" }] };
const maskedVideo = {
  ...still,
  m0: "1",
  sources: [{ type: "media", mediaType: "video", assetId: "clip", mask: { kind: "inline-mask", localPath: "/tmp/w.svg" } }],
};

describe("inferOutputKind", () => {
  it("honours an author stamp before anything else", () => {
    expect(inferOutputKind({ ...withOverlay, format: { kind: "image" } })).toBe("image");
    expect(inferOutputKind({ ...still, format: { kind: "video" } })).toBe("video");
    expect(stampedOutputKind(still)).toBeNull();
  });
  describe("video FOOTAGE is motion (2026-09-26)", () => {
    it("a video media source makes it a video", () => {
      expect(inferOutputKind(withVideoMedia)).toBe("video");
      expect(isAnimatedRenderable(withVideoMedia)).toBe(true);
      expect(collectMotionEvidence(withVideoMedia).videoMedia).toBe(1);
    });

    it("...read from `kind` too, not only `mediaType`", () => {
      expect(inferOutputKind(withVideoMediaKindOnly)).toBe("video");
    });

    it("⭐ the regression: footage through a MASK, with no other evidence", () => {
      expect(inferOutputKind(maskedVideo)).toBe("video");
    });

    it("an IMAGE media source is NOT motion", () => {
      expect(inferOutputKind(withImageMedia)).toBe("image");
      expect(collectMotionEvidence(withImageMedia).videoMedia).toBe(0);
    });

    it("a stamp still wins over the footage", () => {
      expect(inferOutputKind({ ...withVideoMedia, format: { kind: "image" } })).toBe("image");
    });

    it("counts footage inside a CHILD too", () => {
      const nested = { ...still, sources: [{ type: "mosaic", ref: "kid" }], children: { kid: withVideoMedia } };
      expect(inferOutputKind(nested)).toBe("video");
    });
  });

  it("infers video from any time-varying source, including inside children", () => {
    expect(inferOutputKind(withOverlay)).toBe("video");
    expect(inferOutputKind(withExprText)).toBe("video");
    expect(inferOutputKind(withVideoText)).toBe("video");
    expect(inferOutputKind(withCamera)).toBe("video");
    expect(inferOutputKind(nestedAnimated)).toBe("video");
    expect(collectMotionEvidence(nestedAnimated)).toMatchObject({ overlayExprs: 1 });
  });
  it("infers image for a document with nothing time-varying", () => {
    expect(inferOutputKind(still)).toBe("image");
    expect(isAnimatedRenderable(still)).toBe(false);
  });
  it("pipelines under emit:single are always a video — the planner refuses an image output for them", () => {
    const pipe = { kind: "mosaic_pipeline", steps: [{ intermediate: true, file: { ...still, format: { kind: "image" } } }, { file: still }, { file: still }] };
    expect(stampedOutputKind(pipe)).toBeNull(); // the stamped step is intermediate
    expect(inferOutputKind(pipe)).toBe("video"); // two output steps
    // One still step is still a stitched deliverable: video. (2026-09-21 — this
    // used to infer "image", which sent Make down a path the planner refuses.)
    const one = { kind: "mosaic_pipeline", steps: [{ file: still }] };
    expect(inferOutputKind(one)).toBe("video");
    const stamped = { kind: "mosaic_pipeline", steps: [{ file: { ...still, format: { kind: "video" } } }] };
    expect(inferOutputKind(stamped)).toBe("video");
    // Even an author stamp of "image" on a single-emit pipeline's step cannot
    // make the stitched output an image; the stamp describes the step.
    const stampedImage = { kind: "mosaic_pipeline", steps: [{ file: { ...still, format: { kind: "image" } } }] };
    expect(inferOutputKind(stampedImage)).toBe("video");
  });
  it("pipelines under emit:multi keep the per-step decision (each step is its own deliverable)", () => {
    const multiStill = { kind: "mosaic_pipeline", emit: "multi", steps: [{ file: still }] };
    expect(inferOutputKind(multiStill)).toBe("image");
    const multiStamped = { kind: "mosaic_pipeline", emit: "multi", steps: [{ file: { ...still, format: { kind: "video" } } }] };
    expect(inferOutputKind(multiStamped)).toBe("video");
  });
  it("returns null for nothing", () => {
    expect(inferOutputKind(null)).toBeNull();
    expect(inferOutputKind(undefined)).toBeNull();
  });
});
