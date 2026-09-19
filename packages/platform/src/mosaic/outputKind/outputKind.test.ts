import { collectMotionEvidence, inferOutputKind, isAnimatedRenderable, stampedOutputKind } from "./outputKind";

const still = { kind: "mosaic_document", version: 1, m0: "2(1,1)", assets: {}, sources: [{ type: "lavfi", color: "#000" }, { type: "text", layers: [{ content: { kind: "literal", text: "hi" } }] }] };
const withOverlay = { ...still, sources: [{ type: "lavfi", color: "#000", overlay: { startAtSec: 0.2, alpha: "min(1,t)" } }] };
const withExprText = { ...still, sources: [{ type: "text", layers: [{ content: { kind: "expr", expr: "%{eif:t}" } }] }] };
const withVideoText = { ...still, sources: [{ type: "text", renderMode: { kind: "video" }, layers: [{ content: { kind: "literal", text: "x" } }] }] };
const withCamera = { ...still, sources: [{ type: "lavfi", color: "#000", effects: { camera: { zoom: "1+t" } } }] };
const nestedAnimated = { ...still, sources: [{ type: "mosaic", ref: "kid" }], children: { kid: withOverlay } };

describe("inferOutputKind", () => {
  it("honours an author stamp before anything else", () => {
    expect(inferOutputKind({ ...withOverlay, format: { kind: "image" } })).toBe("image");
    expect(inferOutputKind({ ...still, format: { kind: "video" } })).toBe("video");
    expect(stampedOutputKind(still)).toBeNull();
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
  it("pipelines: the first non-intermediate stamped step wins; several output steps are a video", () => {
    const pipe = { kind: "mosaic_pipeline", steps: [{ intermediate: true, file: { ...still, format: { kind: "image" } } }, { file: still }, { file: still }] };
    expect(stampedOutputKind(pipe)).toBeNull(); // the stamped step is intermediate
    expect(inferOutputKind(pipe)).toBe("video"); // two output steps
    const one = { kind: "mosaic_pipeline", steps: [{ file: still }] };
    expect(inferOutputKind(one)).toBe("image");
    const stamped = { kind: "mosaic_pipeline", steps: [{ file: { ...still, format: { kind: "video" } } }] };
    expect(inferOutputKind(stamped)).toBe("video");
  });
  it("returns null for nothing", () => {
    expect(inferOutputKind(null)).toBeNull();
    expect(inferOutputKind(undefined)).toBeNull();
  });
});
