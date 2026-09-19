import { validateMosaicSources as validateMosaicSourcesRaw } from "./validateSources";
import type { MosaicAssetManifest } from "@m0saic/types";

type Diag = { code: string; severity: "error" | "warning" };

const codes = (diags: any[]): Diag[] =>
  diags.map(d => ({ code: d.code, severity: d.severity }));

// Stock manifest covering every assetId test fixtures reference. Adding a
// new id here is cheaper than passing a custom manifest at each callsite.
const STOCK_ASSETS = {
  v1: { kind: "file", path: "/abs/video.mp4", mediaType: "video" },
  v: { kind: "file", path: "/abs/v.mp4", mediaType: "video" },
  img1: { kind: "file", path: "/abs/poster.png", mediaType: "image" },
  audio1: { kind: "file", path: "/abs/song.mp3", mediaType: "audio" },
} as unknown as MosaicAssetManifest;

// Wrapper: every existing test that called `validateMosaicSources(sources)`
// keeps working by routing through here with the stock manifest. New tests
// that want a different manifest can call `validateMosaicSourcesRaw`.
function validateMosaicSources(sources: any[], assets: MosaicAssetManifest = STOCK_ASSETS) {
  return validateMosaicSourcesRaw(sources, assets);
}

describe("validateMosaicSources (branch coverage)", () => {
  test("unknown source type => UNKNOWN_SOURCE_TYPE", () => {
    const diags = validateMosaicSources([{ type: "weird" } as any]);
    expect(codes(diags)).toEqual(
      expect.arrayContaining([{ code: "UNKNOWN_SOURCE_TYPE", severity: "error" }])
    );
  });

  describe("media source", () => {
    const base = (overrides: any = {}) => ({
      type: "media",
      assetId: "v1",
      mediaType: "video",
      ...overrides,
    });

    test.each([
      [
        "empty assetId",
        base({ assetId: "   " }),
        [{ code: "MEDIA_ASSETID_EMPTY", severity: "error" }],
      ],
      [
        "invalid mediaType",
        base({ mediaType: "gif" }),
        [{ code: "INVALID_MEDIA_TYPE", severity: "error" }],
      ],
      [
        "invalid audio.volume (<0)",
        base({ audio: { volume: -0.01 } }),
        [{ code: "INVALID_VOLUME", severity: "error" }],
      ],
      [
        // volume is a GAIN factor, not a percentage: ffmpeg's `volume=`
        // amplifies above unity and the type documents "2 = double".
        "audio.volume above 1 amplifies — legal, no diagnostic",
        base({ audio: { volume: 2 } }),
        [],
      ],
      [
        "audio.volume far past unity warns about clipping (typo'd percentage)",
        base({ audio: { volume: 100 } }),
        [{ code: "LOUD_VOLUME", severity: "warning" }],
      ],
      [
        "invalid audio.volume (NaN)",
        base({ audio: { volume: Number.NaN } }),
        [{ code: "INVALID_VOLUME", severity: "error" }],
      ],
      [
        "valid audio.volume boundary 0",
        base({ audio: { volume: 0 } }),
        [],
      ],
      [
        "valid audio.volume boundary 1",
        base({ audio: { volume: 1 } }),
        [],
      ],
      [
        "invalid playback.playSpeed (0)",
        base({ playback: { playSpeed: 0 } }),
        [{ code: "INVALID_PLAY_SPEED", severity: "error" }],
      ],
      [
        "invalid playback.playSpeed (-1)",
        base({ playback: { playSpeed: -1 } }),
        [{ code: "INVALID_PLAY_SPEED", severity: "error" }],
      ],
      [
        "invalid playback.playSpeed (NaN)",
        base({ playback: { playSpeed: Number.NaN } }),
        [{ code: "INVALID_PLAY_SPEED", severity: "error" }],
      ],
      [
        "valid playback.playSpeed (0.5)",
        base({ playback: { playSpeed: 0.5 } }),
        [],
      ],
      [
        "invalid visual.opacity (<0)",
        base({ visual: { opacity: -0.1 } }),
        [{ code: "INVALID_OPACITY", severity: "error" }],
      ],
      [
        "invalid visual.opacity (>1)",
        base({ visual: { opacity: 1.1 } }),
        [{ code: "INVALID_OPACITY", severity: "error" }],
      ],
      [
        "invalid visual.opacity (NaN)",
        base({ visual: { opacity: Number.NaN } }),
        [{ code: "INVALID_OPACITY", severity: "error" }],
      ],
      [
        "valid visual.opacity boundary 0",
        base({ visual: { opacity: 0 } }),
        [],
      ],
      [
        "valid visual.opacity boundary 1",
        base({ visual: { opacity: 1 } }),
        [],
      ],
      [
        "invalid placement.fit",
        base({ placement: { fit: "stretch" } }),
        [{ code: "MEDIA_PLACEMENT_INVALID_FIT", severity: "error" }],
      ],
      [
        "valid placement.fit contain",
        base({ placement: { fit: "contain" } }),
        [],
      ],
      [
        "valid placement.fit cover",
        base({ placement: { fit: "cover" } }),
        [],
      ],
      [
        "image with audio->enabled => IMAGE_HAS_AUDIO warning",
        base({ mediaType: "image", audio: { enabled: true } }),
        [{ code: "IMAGE_HAS_AUDIO", severity: "warning" }],
      ],
      [
        "image with audio->enabled=false => no warning",
        base({ mediaType: "image", audio: { enabled: false } }),
        [],
      ],
      [
        "image with no audio object => no warning",
        base({ mediaType: "image", audio: undefined }),
        [],
      ],
      [
        "valid media => no diagnostics",
        base(),
        [],
      ],
    ])("%s", (_name, src, expected) => {
      const diags = validateMosaicSources([src as any]);
      expect(codes(diags)).toEqual(expect.arrayContaining(expected as any));
      // also ensure we don't accidentally emit extras in cases meant to be clean:
      if (expected.length === 0) expect(diags).toHaveLength(0);
    });
  });

  describe("mosaic source", () => {
    const base = (overrides: any = {}) => ({
      type: "mosaic",
      ref: "child",
      ...overrides,
    });

    test.each([
      [
        "empty ref",
        base({ ref: "  " }),
        [{ code: "MOSAIC_REF_EMPTY", severity: "error" }],
      ],
      [
        // Same gain rule as media sources: 2 = double, and only
        // non-finite / negative values are unrenderable.
        "invalid audio.volume (negative)",
        base({ audio: { volume: -1 } }),
        [{ code: "INVALID_MOSAIC_VOLUME", severity: "error" }],
      ],
      [
        "audio.volume above 1 amplifies — legal, no diagnostic",
        base({ audio: { volume: 2 } }),
        [],
      ],
      [
        "audio.volume far past unity warns about clipping",
        base({ audio: { volume: 100 } }),
        [{ code: "LOUD_VOLUME", severity: "warning" }],
      ],
      [
        "invalid playback.playSpeed",
        base({ playback: { playSpeed: 0 } }),
        [{ code: "INVALID_MOSAIC_PLAY_SPEED", severity: "error" }],
      ],
      [
        "invalid visual.opacity",
        base({ visual: { opacity: -0.5 } }),
        [{ code: "INVALID_MOSAIC_OPACITY", severity: "error" }],
      ],
      [
        "invalid placement.fit",
        base({ placement: { fit: "stretch" } }),
        [{ code: "MOSAIC_PLACEMENT_INVALID_FIT", severity: "error" }],
      ],
      [
        "all valid optional fields => no diagnostics",
        base({
          audio: { volume: 1 },
          playback: { playSpeed: 1 },
          visual: { opacity: 1 },
          placement: { fit: "contain" },
        }),
        [],
      ],
    ])("%s", (_name, src, expected) => {
      const diags = validateMosaicSources([src as any]);
      expect(codes(diags)).toEqual(expect.arrayContaining(expected as any));
      if (expected.length === 0) expect(diags).toHaveLength(0);
    });
  });

  describe("text source", () => {
    const base = (overrides: any = {}) => ({
      type: "text",
      layers: [{ content: { kind: "literal", text: "hello" } }],
      ...overrides,
    });

    test("no style => returns early (and does not validate fontSize/opacity/fit)", () => {
      const diags = validateMosaicSources([
        base({
          style: undefined,
          visual: { opacity: 2 }, // would be invalid, but should be skipped due to early return
          placement: { fit: "stretch" }, // would be invalid, but should be skipped
        }) as any,
      ]);
      expect(diags).toHaveLength(0);
    });

    describe("layers validation", () => {
      test.each([
        [
          "layers missing entirely",
          { type: "text" },
          [{ code: "TEXT_LAYERS_EMPTY", severity: "error" }],
        ],
        [
          "layers is null",
          { type: "text", layers: null },
          [{ code: "TEXT_LAYERS_EMPTY", severity: "error" }],
        ],
        [
          "layers is not an array",
          { type: "text", layers: "not-an-array" },
          [{ code: "TEXT_LAYERS_EMPTY", severity: "error" }],
        ],
        [
          "layers is empty array",
          { type: "text", layers: [] },
          [{ code: "TEXT_LAYERS_EMPTY", severity: "error" }],
        ],
      ])("%s", (_name, src, expected) => {
        const diags = validateMosaicSources([src as any]);
        expect(codes(diags)).toEqual(expect.arrayContaining(expected as any));
      });
    });

    describe("renderMode validation", () => {
      test.each([
        [
          "renderMode.kind invalid (not image or video)",
          base({ renderMode: { kind: "gif" } }),
          [{ code: "TEXT_RENDER_MODE_INVALID", severity: "error" }],
        ],
        [
          "renderMode.kind undefined",
          base({ renderMode: {} }),
          [{ code: "TEXT_RENDER_MODE_INVALID", severity: "error" }],
        ],
        [
          "renderMode.kind=video with durationMs=0",
          base({ renderMode: { kind: "video", durationMs: 0 } }),
          [{ code: "TEXT_RENDER_MODE_DURATION_INVALID", severity: "error" }],
        ],
        [
          "renderMode.kind=video with durationMs negative",
          base({ renderMode: { kind: "video", durationMs: -100 } }),
          [{ code: "TEXT_RENDER_MODE_DURATION_INVALID", severity: "error" }],
        ],
        [
          "renderMode.kind=video with durationMs NaN",
          base({ renderMode: { kind: "video", durationMs: NaN } }),
          [{ code: "TEXT_RENDER_MODE_DURATION_INVALID", severity: "error" }],
        ],
        [
          "renderMode.kind=video with durationMs Infinity",
          base({ renderMode: { kind: "video", durationMs: Infinity } }),
          [{ code: "TEXT_RENDER_MODE_DURATION_INVALID", severity: "error" }],
        ],
        [
          "renderMode.kind=video with valid durationMs",
          base({ renderMode: { kind: "video", durationMs: 1000 } }),
          [],
        ],
        [
          "renderMode.kind=video without durationMs (optional)",
          base({ renderMode: { kind: "video" } }),
          [],
        ],
        [
          "renderMode.kind=image is valid",
          base({ renderMode: { kind: "image" } }),
          [],
        ],
        [
          "no renderMode is valid",
          base(),
          [],
        ],
      ])("%s", (_name, src, expected) => {
        const diags = validateMosaicSources([src as any]);
        expect(codes(diags)).toEqual(expect.arrayContaining(expected as any));
        if (expected.length === 0) expect(diags).toHaveLength(0);
      });
    });

    describe("layer content validation", () => {
      test.each([
        [
          "layer content missing (null)",
          base({ layers: [{ content: null }] }),
          [{ code: "TEXT_LAYER_CONTENT_MISSING", severity: "error" }],
        ],
        [
          "layer content missing (undefined)",
          base({ layers: [{}] }),
          [{ code: "TEXT_LAYER_CONTENT_MISSING", severity: "error" }],
        ],
        [
          "layer content not an object (string)",
          base({ layers: [{ content: "hello" }] }),
          [{ code: "TEXT_LAYER_CONTENT_MISSING", severity: "error" }],
        ],
        [
          "layer content.kind invalid",
          base({ layers: [{ content: { kind: "markdown" } }] }),
          [{ code: "TEXT_LAYER_CONTENT_KIND_INVALID", severity: "error" }],
        ],
        [
          "layer content.kind missing",
          base({ layers: [{ content: { text: "hello" } }] }),
          [{ code: "TEXT_LAYER_CONTENT_KIND_INVALID", severity: "error" }],
        ],
      ])("%s", (_name, src, expected) => {
        const diags = validateMosaicSources([src as any]);
        expect(codes(diags)).toEqual(expect.arrayContaining(expected as any));
      });
    });

    describe("literal content validation", () => {
      test.each([
        [
          "literal text is not a string (number)",
          base({ layers: [{ content: { kind: "literal", text: 123 } }] }),
          [{ code: "TEXT_LAYER_LITERAL_TEXT_INVALID", severity: "error" }],
        ],
        [
          "literal text is not a string (null)",
          base({ layers: [{ content: { kind: "literal", text: null } }] }),
          [{ code: "TEXT_LAYER_LITERAL_TEXT_INVALID", severity: "error" }],
        ],
        [
          "literal text is not a string (undefined)",
          base({ layers: [{ content: { kind: "literal" } }] }),
          [{ code: "TEXT_LAYER_LITERAL_TEXT_INVALID", severity: "error" }],
        ],
        [
          "literal text empty string is valid (background-only use case)",
          base({ layers: [{ content: { kind: "literal", text: "" } }] }),
          [],
        ],
        [
          "literal text valid",
          base({ layers: [{ content: { kind: "literal", text: "hello" } }] }),
          [],
        ],
      ])("%s", (_name, src, expected) => {
        const diags = validateMosaicSources([src as any]);
        expect(codes(diags)).toEqual(expect.arrayContaining(expected as any));
        if (expected.length === 0) expect(diags).toHaveLength(0);
      });
    });

    describe("expr content validation", () => {
      test.each([
        [
          "expr is empty string",
          base({ layers: [{ content: { kind: "expr", expr: "" } }] }),
          [{ code: "TEXT_LAYER_EXPR_INVALID", severity: "error" }],
        ],
        [
          "expr is whitespace only",
          base({ layers: [{ content: { kind: "expr", expr: "   " } }] }),
          [{ code: "TEXT_LAYER_EXPR_INVALID", severity: "error" }],
        ],
        [
          "expr is not a string (number)",
          base({ layers: [{ content: { kind: "expr", expr: 123 } }] }),
          [{ code: "TEXT_LAYER_EXPR_INVALID", severity: "error" }],
        ],
        [
          "expr is missing",
          base({ layers: [{ content: { kind: "expr" } }] }),
          [{ code: "TEXT_LAYER_EXPR_INVALID", severity: "error" }],
        ],
        [
          "expr eval invalid value",
          base({ layers: [{ content: { kind: "expr", expr: "t", eval: "always" } }] }),
          [{ code: "TEXT_LAYER_EVAL_INVALID", severity: "error" }],
        ],
        [
          "expr eval=once is valid",
          base({ layers: [{ content: { kind: "expr", expr: "t", eval: "once" } }] }),
          [],
        ],
        [
          "expr eval=frame is valid",
          base({ layers: [{ content: { kind: "expr", expr: "t", eval: "frame" } }] }),
          [],
        ],
        [
          "expr without eval defaults to frame (valid)",
          base({ layers: [{ content: { kind: "expr", expr: "t" } }] }),
          [],
        ],
      ])("%s", (_name, src, expected) => {
        const diags = validateMosaicSources([src as any]);
        expect(codes(diags)).toEqual(expect.arrayContaining(expected as any));
        if (expected.length === 0) expect(diags).toHaveLength(0);
      });
    });

    describe("frame-eval + image render mode cross-check", () => {
      test("expr with eval=frame and renderMode.kind=image emits warning", () => {
        const diags = validateMosaicSources([
          base({
            layers: [{ content: { kind: "expr", expr: "t", eval: "frame" } }],
            renderMode: { kind: "image" },
          }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "TEXT_EXPR_FRAME_WITH_IMAGE_RENDER_MODE",
          severity: "warning",
        });
      });

      test("expr with default eval (frame) and renderMode.kind=image emits warning", () => {
        const diags = validateMosaicSources([
          base({
            layers: [{ content: { kind: "expr", expr: "t" } }],
            renderMode: { kind: "image" },
          }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "TEXT_EXPR_FRAME_WITH_IMAGE_RENDER_MODE",
          severity: "warning",
        });
      });

      test("expr with eval=once and renderMode.kind=image does NOT emit warning", () => {
        const diags = validateMosaicSources([
          base({
            layers: [{ content: { kind: "expr", expr: "t", eval: "once" } }],
            renderMode: { kind: "image" },
          }) as any,
        ]);
        expect(codes(diags)).not.toContainEqual(
          expect.objectContaining({ code: "TEXT_EXPR_FRAME_WITH_IMAGE_RENDER_MODE" })
        );
      });

      test("expr with eval=frame and renderMode.kind=video does NOT emit warning", () => {
        const diags = validateMosaicSources([
          base({
            layers: [{ content: { kind: "expr", expr: "t", eval: "frame" } }],
            renderMode: { kind: "video" },
          }) as any,
        ]);
        expect(codes(diags)).not.toContainEqual(
          expect.objectContaining({ code: "TEXT_EXPR_FRAME_WITH_IMAGE_RENDER_MODE" })
        );
      });

      test("literal content with renderMode.kind=image does NOT emit warning", () => {
        const diags = validateMosaicSources([
          base({
            layers: [{ content: { kind: "literal", text: "hello" } }],
            renderMode: { kind: "image" },
          }) as any,
        ]);
        expect(codes(diags)).not.toContainEqual(
          expect.objectContaining({ code: "TEXT_EXPR_FRAME_WITH_IMAGE_RENDER_MODE" })
        );
      });
    });

    describe("multiple layers validation", () => {
      test("validates all layers and reports errors from each", () => {
        const diags = validateMosaicSources([
          base({
            layers: [
              { content: { kind: "literal", text: 123 } }, // invalid
              { content: { kind: "expr", expr: "" } }, // invalid
              { content: { kind: "literal", text: "valid" } }, // valid
            ],
          }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "TEXT_LAYER_LITERAL_TEXT_INVALID",
          severity: "error",
        });
        expect(codes(diags)).toContainEqual({
          code: "TEXT_LAYER_EXPR_INVALID",
          severity: "error",
        });
        expect(diags).toHaveLength(2);
      });
    });

    test.each([
      [
        "invalid style.fontSize",
        base({ style: { fontSize: 0 } }),
        [{ code: "INVALID_FONT_SIZE", severity: "error" }],
      ],
      [
        "invalid style.fontSize (negative)",
        base({ style: { fontSize: -10 } }),
        [{ code: "INVALID_FONT_SIZE", severity: "error" }],
      ],
      [
        "invalid style.fontSize (NaN)",
        base({ style: { fontSize: NaN } }),
        [{ code: "INVALID_FONT_SIZE", severity: "error" }],
      ],
      [
        "invalid style.fontSize (Infinity)",
        base({ style: { fontSize: Infinity } }),
        [{ code: "INVALID_FONT_SIZE", severity: "error" }],
      ],
      [
        "invalid visual.opacity",
        base({ style: { fontSize: 12 }, visual: { opacity: 2 } }),
        [{ code: "INVALID_TEXT_OPACITY", severity: "error" }],
      ],
      [
        "invalid visual.opacity (NaN)",
        base({ style: { fontSize: 12 }, visual: { opacity: NaN } }),
        [{ code: "INVALID_TEXT_OPACITY", severity: "error" }],
      ],
      [
        "invalid placement.fit",
        base({ style: { fontSize: 12 }, placement: { fit: "stretch" } }),
        [{ code: "TEXT_PLACEMENT_INVALID_FIT", severity: "error" }],
      ],
      [
        "all valid => no diagnostics",
        base({
          layers: [{ content: { kind: "literal", text: "hi" } }],
          style: { fontSize: 12 },
          visual: { opacity: 0.5 },
          placement: { fit: "cover" },
        }),
        [],
      ],
    ])("%s", (_name, src, expected) => {
      const diags = validateMosaicSources([src as any]);
      expect(codes(diags)).toEqual(expect.arrayContaining(expected as any));
      if (expected.length === 0) expect(diags).toHaveLength(0);
    });
  });

  describe("media source edge cases", () => {
    const base = (overrides: any = {}) => ({
      type: "media",
      assetId: "v1",
      mediaType: "video",
      ...overrides,
    });

    test.each([
      [
        "src undefined",
        base({ assetId: undefined }),
        [{ code: "MEDIA_ASSETID_EMPTY", severity: "error" }],
      ],
      [
        "audio.volume Infinity",
        base({ audio: { volume: Infinity } }),
        [{ code: "INVALID_VOLUME", severity: "error" }],
      ],
      [
        "audio.volume -Infinity",
        base({ audio: { volume: -Infinity } }),
        [{ code: "INVALID_VOLUME", severity: "error" }],
      ],
      [
        "playback.playSpeed Infinity",
        base({ playback: { playSpeed: Infinity } }),
        [{ code: "INVALID_PLAY_SPEED", severity: "error" }],
      ],
      [
        "visual.opacity Infinity",
        base({ visual: { opacity: Infinity } }),
        [{ code: "INVALID_OPACITY", severity: "error" }],
      ],
      [
        "visual.opacity -Infinity",
        base({ visual: { opacity: -Infinity } }),
        [{ code: "INVALID_OPACITY", severity: "error" }],
      ],
    ])("%s", (_name, src, expected) => {
      const diags = validateMosaicSources([src as any]);
      expect(codes(diags)).toEqual(expect.arrayContaining(expected as any));
    });
  });

  describe("effects validation (wired knobs: rotate / blur / fades)", () => {
    const base = (overrides: any = {}) => ({
      type: "media",
      assetId: "v1",
      mediaType: "video",
      ...overrides,
    });

    test.each([
      ["rotate NaN", base({ effects: { rotate: NaN } }), "INVALID_EFFECT_ROTATE"],
      ["rotate Infinity", base({ effects: { rotate: Infinity } }), "INVALID_EFFECT_ROTATE"],
      ["rotate string", base({ effects: { rotate: "45" } }), "INVALID_EFFECT_ROTATE"],
      ["blur negative", base({ effects: { blur: -2 } }), "INVALID_EFFECT_BLUR"],
      ["blur NaN", base({ effects: { blur: NaN } }), "INVALID_EFFECT_BLUR"],
      ["blur array", base({ effects: { blur: [4] } }), "INVALID_EFFECT_BLUR"],
      ["blur object missing sigma", base({ effects: { blur: { backdrop: true } } }), "INVALID_EFFECT_BLUR"],
      ["blur object negative sigma", base({ effects: { blur: { sigma: -1 } } }), "INVALID_EFFECT_BLUR"],
      ["blur.backdrop non-boolean", base({ effects: { blur: { sigma: 4, backdrop: "yes" } } }), "INVALID_EFFECT_BLUR"],
      ["fadeInMs negative", base({ effects: { fadeInMs: -100 } }), "INVALID_EFFECT_FADE"],
      ["fadeOutMs Infinity", base({ effects: { fadeOutMs: Infinity } }), "INVALID_EFFECT_FADE"],
      ["fadeInMs string", base({ effects: { fadeInMs: "300" } }), "INVALID_EFFECT_FADE"],
      ["grade non-object", base({ effects: { grade: 1.4 } }), "INVALID_EFFECT_GRADE"],
      ["grade array", base({ effects: { grade: [1, 2] } }), "INVALID_EFFECT_GRADE"],
      ["grade.brightness out of range", base({ effects: { grade: { brightness: 1.5 } } }), "INVALID_EFFECT_GRADE"],
      ["grade.brightness NaN", base({ effects: { grade: { brightness: NaN } } }), "INVALID_EFFECT_GRADE"],
      ["grade.contrast negative", base({ effects: { grade: { contrast: -0.1 } } }), "INVALID_EFFECT_GRADE"],
      ["grade.saturation above 3", base({ effects: { grade: { saturation: 3.5 } } }), "INVALID_EFFECT_GRADE"],
      ["grade.gamma below 0.1", base({ effects: { grade: { gamma: 0.05 } } }), "INVALID_EFFECT_GRADE"],
      ["grade.gamma string", base({ effects: { grade: { gamma: "2" } } }), "INVALID_EFFECT_GRADE"],
      ["noise non-object", base({ effects: { noise: 30 } }), "INVALID_EFFECT_NOISE"],
      ["noise.amount missing", base({ effects: { noise: { seed: 42 } } }), "INVALID_EFFECT_NOISE"],
      ["noise.amount above 100", base({ effects: { noise: { amount: 150, seed: 42 } } }), "INVALID_EFFECT_NOISE"],
      ["noise.seed missing", base({ effects: { noise: { amount: 30 } } }), "EFFECT_NOISE_SEED_REQUIRED"],
      ["noise.seed NaN", base({ effects: { noise: { amount: 30, seed: NaN } } }), "EFFECT_NOISE_SEED_REQUIRED"],
      ["pixelize negative", base({ effects: { pixelize: -4 } }), "INVALID_EFFECT_PIXELIZE"],
      ["pixelize string", base({ effects: { pixelize: "16" } }), "INVALID_EFFECT_PIXELIZE"],
      ["chromaKey non-object", base({ effects: { chromaKey: "#00ff00" } }), "INVALID_EFFECT_CHROMAKEY"],
      ["chromaKey.color missing", base({ effects: { chromaKey: { similarity: 0.2 } } }), "INVALID_EFFECT_CHROMAKEY"],
      ["chromaKey.color empty", base({ effects: { chromaKey: { color: "  " } } }), "INVALID_EFFECT_CHROMAKEY"],
      ["chromaKey.similarity above 1", base({ effects: { chromaKey: { color: "#00ff00", similarity: 1.5 } } }), "INVALID_EFFECT_CHROMAKEY"],
      ["chromaKey.blend negative", base({ effects: { chromaKey: { color: "#00ff00", blend: -0.1 } } }), "INVALID_EFFECT_CHROMAKEY"],
      ["chromaKey.despill non-boolean", base({ effects: { chromaKey: { color: "#00ff00", despill: "yes" } } }), "INVALID_EFFECT_CHROMAKEY"],
      ["chromaKey on image media", base({ mediaType: "image", assetId: "img1", effects: { chromaKey: { color: "#00ff00" } } }), "EFFECT_CHROMAKEY_MEDIA_TYPE"],
      ["chromaKey on audio media", base({ mediaType: "audio", assetId: "audio1", effects: { chromaKey: { color: "#00ff00" } } }), "EFFECT_CHROMAKEY_MEDIA_TYPE"],
    ])("%s => diagnostic", (_name, src, code) => {
      const diags = validateMosaicSources([src as any]);
      expect(codes(diags)).toEqual(
        expect.arrayContaining([{ code, severity: "error" }])
      );
    });

    test.each([
      ["valid values", base({ effects: { rotate: -15.5, blur: 4, fadeInMs: 300, fadeOutMs: 500 } })],
      ["zero values", base({ effects: { rotate: 0, blur: 0, fadeInMs: 0, fadeOutMs: 0 } })],
      ["valid grade", base({ effects: { grade: { brightness: -0.2, contrast: 1.4, saturation: 1.6, gamma: 0.9 } } })],
      ["boundary grade", base({ effects: { grade: { brightness: 1, contrast: 0, saturation: 3, gamma: 0.1 } } })],
      ["empty grade object", base({ effects: { grade: {} } })],
      ["valid noise", base({ effects: { noise: { amount: 30, seed: 42 } } })],
      ["noise amount 0 with seed", base({ effects: { noise: { amount: 0, seed: 0 } } })],
      ["valid pixelize", base({ effects: { pixelize: 16 } })],
      ["pixelize 0", base({ effects: { pixelize: 0 } })],
      ["valid chromaKey on video", base({ effects: { chromaKey: { color: "#00ff00", similarity: 0.2, blend: 0.1, despill: false } } })],
      ["blur object content form", base({ effects: { blur: { sigma: 8 } } })],
      ["blur object backdrop form", base({ effects: { blur: { sigma: 12, backdrop: true } } })],
      ["chromaKey color-only", base({ effects: { chromaKey: { color: "#00ff00" } } })],
      ["absent effects", base()],
    ])("%s => no diagnostics", (_name, src) => {
      expect(validateMosaicSources([src as any])).toEqual([]);
    });

    test("chromaKey on a lavfi source passes (video-like — the corpus fixture shape)", () => {
      const diags = validateMosaicSources([
        { type: "lavfi", lavfi: "color=c=0x00ff00", effects: { chromaKey: { color: "#00ff00" } } },
      ] as any[]);
      expect(diags).toEqual([]);
    });

    test("effects are validated on mosaic / text / lavfi sources too", () => {
      const diags = validateMosaicSources([
        { type: "mosaic", ref: "child", effects: { rotate: NaN } },
        {
          type: "text",
          layers: [{ content: { kind: "literal", text: "hi" } }],
          effects: { blur: -1 },
        },
        { type: "lavfi", lavfi: "color=c=red", effects: { fadeInMs: -5 } },
      ] as any[]);
      expect(codes(diags)).toEqual(
        expect.arrayContaining([
          { code: "INVALID_EFFECT_ROTATE", severity: "error" },
          { code: "INVALID_EFFECT_BLUR", severity: "error" },
          { code: "INVALID_EFFECT_FADE", severity: "error" },
        ])
      );
    });
  });

  describe("mosaic source edge cases", () => {
    const base = (overrides: any = {}) => ({
      type: "mosaic",
      ref: "child",
      ...overrides,
    });

    test.each([
      [
        "ref undefined",
        base({ ref: undefined }),
        [{ code: "MOSAIC_REF_EMPTY", severity: "error" }],
      ],
      [
        "audio.volume NaN",
        base({ audio: { volume: NaN } }),
        [{ code: "INVALID_MOSAIC_VOLUME", severity: "error" }],
      ],
      [
        "audio.volume Infinity",
        base({ audio: { volume: Infinity } }),
        [{ code: "INVALID_MOSAIC_VOLUME", severity: "error" }],
      ],
      [
        "playback.playSpeed NaN",
        base({ playback: { playSpeed: NaN } }),
        [{ code: "INVALID_MOSAIC_PLAY_SPEED", severity: "error" }],
      ],
      [
        "playback.playSpeed Infinity",
        base({ playback: { playSpeed: Infinity } }),
        [{ code: "INVALID_MOSAIC_PLAY_SPEED", severity: "error" }],
      ],
      [
        "visual.opacity NaN",
        base({ visual: { opacity: NaN } }),
        [{ code: "INVALID_MOSAIC_OPACITY", severity: "error" }],
      ],
      [
        "visual.opacity Infinity",
        base({ visual: { opacity: Infinity } }),
        [{ code: "INVALID_MOSAIC_OPACITY", severity: "error" }],
      ],
      [
        "valid placement.fit cover",
        base({ placement: { fit: "cover" } }),
        [],
      ],
    ])("%s", (_name, src, expected) => {
      const diags = validateMosaicSources([src as any]);
      expect(codes(diags)).toEqual(expect.arrayContaining(expected as any));
      if (expected.length === 0) expect(diags).toHaveLength(0);
    });
  });

  describe("multiple sources", () => {
    test("validates all sources and aggregates diagnostics", () => {
      const diags = validateMosaicSources([
        { type: "media", assetId: "", mediaType: "video" }, // MEDIA_ASSETID_EMPTY
        { type: "mosaic", ref: "" }, // MOSAIC_REF_EMPTY
        { type: "text", layers: [] }, // TEXT_LAYERS_EMPTY
      ] as any);
      expect(codes(diags)).toContainEqual({ code: "MEDIA_ASSETID_EMPTY", severity: "error" });
      expect(codes(diags)).toContainEqual({ code: "MOSAIC_REF_EMPTY", severity: "error" });
      expect(codes(diags)).toContainEqual({ code: "TEXT_LAYERS_EMPTY", severity: "error" });
      expect(diags).toHaveLength(3);
    });

    test("empty sources array returns no diagnostics", () => {
      const diags = validateMosaicSources([]);
      expect(diags).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Placement: inset (MosaicBoxFrac)  (all source types)
  // ---------------------------------------------------------------------------

  describe("placement inset validation", () => {
    const mediaSrc = (placement: any) => ({
      type: "media",
      assetId: "v",
      mediaType: "video",
      placement,
    });
    const mosaicSrc = (placement: any) => ({
      type: "mosaic",
      ref: "child",
      placement,
    });
    const textSrc = (placement: any) => ({
      type: "text",
      layers: [{ content: { kind: "literal", text: "hi" } }],
      style: { fontSize: 12 },
      placement,
    });

    describe.each([
      ["media", mediaSrc, "MEDIA_PLACEMENT"],
      ["mosaic", mosaicSrc, "MOSAIC_PLACEMENT"],
      ["text", textSrc, "TEXT_PLACEMENT"],
    ] as const)("%s source", (_label, factory, prefix) => {
      // ---- inset as number ----
      test("inset=0 is valid", () => {
        const diags = validateMosaicSources([factory({ inset: 0 }) as any]);
        expect(diags.filter(d => d.code.includes("INSET"))).toHaveLength(0);
      });

      test("inset=0.49 is valid (boundary)", () => {
        const diags = validateMosaicSources([factory({ inset: 0.49 }) as any]);
        expect(diags.filter(d => d.code.includes("INSET"))).toHaveLength(0);
      });

      test("inset=0.5 is invalid (>= 0.5)", () => {
        const diags = validateMosaicSources([factory({ inset: 0.5 }) as any]);
        expect(codes(diags)).toContainEqual({
          code: `${prefix}_INVALID_INSET`,
          severity: "error",
        });
      });

      test("inset=-0.01 is invalid (negative)", () => {
        const diags = validateMosaicSources([factory({ inset: -0.01 }) as any]);
        expect(codes(diags)).toContainEqual({
          code: `${prefix}_INVALID_INSET`,
          severity: "error",
        });
      });

      test("inset=NaN is invalid", () => {
        const diags = validateMosaicSources([factory({ inset: NaN }) as any]);
        expect(codes(diags)).toContainEqual({
          code: `${prefix}_INVALID_INSET`,
          severity: "error",
        });
      });

      test("inset=Infinity is invalid", () => {
        const diags = validateMosaicSources([factory({ inset: Infinity }) as any]);
        expect(codes(diags)).toContainEqual({
          code: `${prefix}_INVALID_INSET`,
          severity: "error",
        });
      });

      // ---- inset as object with x/y ----
      test("inset={x:0.3} is valid", () => {
        const diags = validateMosaicSources([factory({ inset: { x: 0.3 } }) as any]);
        expect(diags.filter(d => d.code.includes("INSET"))).toHaveLength(0);
      });

      test("inset={x:0.5} is invalid", () => {
        const diags = validateMosaicSources([factory({ inset: { x: 0.5 } }) as any]);
        expect(codes(diags)).toContainEqual({
          code: `${prefix}_INVALID_INSET_X`,
          severity: "error",
        });
      });

      test("inset={y:0.2} is valid", () => {
        const diags = validateMosaicSources([factory({ inset: { y: 0.2 } }) as any]);
        expect(diags.filter(d => d.code.includes("INSET"))).toHaveLength(0);
      });

      test("inset={y:NaN} is invalid", () => {
        const diags = validateMosaicSources([factory({ inset: { y: NaN } }) as any]);
        expect(codes(diags)).toContainEqual({
          code: `${prefix}_INVALID_INSET_Y`,
          severity: "error",
        });
      });

      // ---- inset as object with per-side overrides ----
      test("inset={left:-1} is invalid", () => {
        const diags = validateMosaicSources([factory({ inset: { left: -1 } }) as any]);
        expect(codes(diags)).toContainEqual({
          code: `${prefix}_INVALID_INSET_LEFT`,
          severity: "error",
        });
      });

      // ---- undefined insets produce no errors ----
      test("no inset fields => no inset diagnostics", () => {
        const diags = validateMosaicSources([factory({}) as any]);
        expect(diags.filter(d => d.code.includes("INSET"))).toHaveLength(0);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Placement: padding (MosaicBoxFrac, fit-dependent rules)
  // ---------------------------------------------------------------------------

  describe("placement padding validation", () => {
    const mediaSrc = (placement: any) => ({
      type: "media",
      assetId: "v",
      mediaType: "video",
      placement,
    });

    describe("fit=cover forbids padding", () => {
      test("padding present with cover is forbidden", () => {
        const diags = validateMosaicSources([
          mediaSrc({ fit: "cover", padding: 0.1 }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "MEDIA_PLACEMENT_COVER_PADDING",
          severity: "error",
        });
      });

      test("padding={x:0.1} with cover is forbidden", () => {
        const diags = validateMosaicSources([
          mediaSrc({ fit: "cover", padding: { x: 0.1 } }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "MEDIA_PLACEMENT_COVER_PADDING",
          severity: "error",
        });
      });

      test("padding undefined with cover => no error", () => {
        const diags = validateMosaicSources([
          mediaSrc({ fit: "cover" }) as any,
        ]);
        expect(diags.filter(d => d.code.includes("PADDING"))).toHaveLength(0);
      });
    });

    describe("fit=contain (or unspecified) allows bounded padding", () => {
      test("padding=0.3 with contain is valid", () => {
        const diags = validateMosaicSources([
          mediaSrc({ fit: "contain", padding: 0.3 }) as any,
        ]);
        expect(diags.filter(d => d.code.includes("PADDING"))).toHaveLength(0);
      });

      test("padding=0.5 with contain is invalid (>= 0.5)", () => {
        const diags = validateMosaicSources([
          mediaSrc({ fit: "contain", padding: 0.5 }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "MEDIA_PLACEMENT_INVALID_PADDING",
          severity: "error",
        });
      });

      test("padding=-0.1 with contain is invalid (negative)", () => {
        const diags = validateMosaicSources([
          mediaSrc({ fit: "contain", padding: -0.1 }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "MEDIA_PLACEMENT_INVALID_PADDING",
          severity: "error",
        });
      });

      test("padding={x:NaN} with contain is invalid", () => {
        const diags = validateMosaicSources([
          mediaSrc({ fit: "contain", padding: { x: NaN } }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "MEDIA_PLACEMENT_INVALID_PADDING_X",
          severity: "error",
        });
      });

      test("padding={y:0.49} with contain is valid (boundary)", () => {
        const diags = validateMosaicSources([
          mediaSrc({ fit: "contain", padding: { y: 0.49 } }) as any,
        ]);
        expect(diags.filter(d => d.code.includes("PADDING"))).toHaveLength(0);
      });

      test("padding={y:0.5} with contain is invalid", () => {
        const diags = validateMosaicSources([
          mediaSrc({ fit: "contain", padding: { y: 0.5 } }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "MEDIA_PLACEMENT_INVALID_PADDING_Y",
          severity: "error",
        });
      });

      test("padding={bottom:Infinity} with contain is invalid", () => {
        const diags = validateMosaicSources([
          mediaSrc({ fit: "contain", padding: { bottom: Infinity } }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "MEDIA_PLACEMENT_INVALID_PADDING_BOTTOM",
          severity: "error",
        });
      });

      test("no fit specified treats as contain (padding=0.3 valid)", () => {
        const diags = validateMosaicSources([
          mediaSrc({ padding: 0.3 }) as any,
        ]);
        expect(diags.filter(d => d.code.includes("PADDING"))).toHaveLength(0);
      });

      test("no fit specified treats as contain (padding=0.5 invalid)", () => {
        const diags = validateMosaicSources([
          mediaSrc({ padding: 0.5 }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "MEDIA_PLACEMENT_INVALID_PADDING",
          severity: "error",
        });
      });
    });

    describe("focusX/focusY (cover-crop anchor)", () => {
      test("focusY=0 with cover is valid (top anchor)", () => {
        const diags = validateMosaicSources([
          mediaSrc({ fit: "cover", focusY: 0 }) as any,
        ]);
        expect(diags.filter(d => d.code.includes("FOCUS"))).toHaveLength(0);
      });

      test("focusX=0.5 / focusY=1 with cover are valid (boundaries)", () => {
        const diags = validateMosaicSources([
          mediaSrc({ fit: "cover", focusX: 0.5, focusY: 1 }) as any,
        ]);
        expect(diags.filter(d => d.code.includes("FOCUS"))).toHaveLength(0);
      });

      test("focusY=1.5 with cover is invalid (out of range)", () => {
        const diags = validateMosaicSources([
          mediaSrc({ fit: "cover", focusY: 1.5 }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "MEDIA_PLACEMENT_INVALID_FOCUSY",
          severity: "error",
        });
      });

      test("focusX=-0.1 with cover is invalid (negative)", () => {
        const diags = validateMosaicSources([
          mediaSrc({ fit: "cover", focusX: -0.1 }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "MEDIA_PLACEMENT_INVALID_FOCUSX",
          severity: "error",
        });
      });

      test("focusX=NaN with cover is invalid (non-finite)", () => {
        const diags = validateMosaicSources([
          mediaSrc({ fit: "cover", focusX: NaN }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "MEDIA_PLACEMENT_INVALID_FOCUSX",
          severity: "error",
        });
      });

      test("focus with contain is rejected (contain never crops)", () => {
        const diags = validateMosaicSources([
          mediaSrc({ fit: "contain", focusY: 0 }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "MEDIA_PLACEMENT_FOCUS_REQUIRES_COVER",
          severity: "error",
        });
      });

      test("focus with no fit (default contain) is rejected", () => {
        const diags = validateMosaicSources([
          mediaSrc({ focusX: 0.2 }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "MEDIA_PLACEMENT_FOCUS_REQUIRES_COVER",
          severity: "error",
        });
      });
    });

    describe("sourceRect (source-px window, media-only)", () => {
      test("valid on media under both fits", () => {
        for (const fit of ["cover", "contain"] as const) {
          const diags = validateMosaicSources([
            mediaSrc({ fit, sourceRect: { x: 64, y: 48, w: 240, h: 160 } }) as any,
          ]);
          expect(diags.filter(d => d.code.includes("SOURCERECT"))).toHaveLength(0);
        }
      });

      test("negative x / zero-size / non-object are invalid", () => {
        for (const bad of [
          { x: -1, y: 0, w: 10, h: 10 },
          { x: 0, y: 0, w: 0, h: 10 },
          { x: 0, y: 0, w: 10, h: NaN },
          "64,48,240,160",
        ]) {
          const diags = validateMosaicSources([
            mediaSrc({ fit: "cover", sourceRect: bad }) as any,
          ]);
          expect(codes(diags)).toContainEqual({
            code: "MEDIA_PLACEMENT_INVALID_SOURCERECT",
            severity: "error",
          });
        }
      });

      test("rejected on non-media sources (v1 scope)", () => {
        const diags = validateMosaicSources([
          {
            type: "mosaic",
            ref: "child",
            placement: { fit: "cover", sourceRect: { x: 0, y: 0, w: 10, h: 10 } },
          } as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "MOSAIC_PLACEMENT_SOURCERECT_UNSUPPORTED",
          severity: "error",
        });
      });
    });

    describe("inline-mask authoring extensions (strokes / parts / featherPx)", () => {
      const maskedMedia = (mask: Record<string, unknown>) =>
        ({
          type: "media",
          assetId: "v",
          mediaType: "video",
          mask: { kind: "inline-mask", localPath: "", bounds: { x: 0, y: 0, width: 10, height: 10 }, ...mask },
        }) as any;

      test("well-formed strokes / parts / feather pass", () => {
        const diags = validateMosaicSources([
          maskedMedia({
            strokes: [{ d: "M0 5L10 5", width: 2 }],
            parts: [
              {
                d: "M0 0H5V5H0Z",
                translate: { x: 1, y: 2 },
                scale: { x: 2, y: 2 },
                clip: { x: 1, y: 2, width: 5, height: 5 },
              },
            ],
            featherPx: 4,
          }),
        ]);
        expect(diags.filter(d => d.code === "MASK_INLINE_INVALID")).toHaveLength(0);
      });

      test("malformed strokes / parts / feather each produce MASK_INLINE_INVALID", () => {
        for (const mask of [
          { strokes: [] },
          { strokes: [{ d: "", width: 2 }] },
          { strokes: [{ d: "M0 0L1 1", width: -1 }] },
          { parts: [{ d: "M0 0H1V1H0Z" }] }, // missing translate
          { parts: [{ d: "M0 0H1V1H0Z", translate: { x: NaN, y: 0 } }] },
          { parts: [{ d: "M0 0H1V1H0Z", translate: { x: 0, y: 0 }, clip: { x: 0, y: 0, width: 0, height: 5 } }] },
          { parts: [{ d: "M0 0H1V1H0Z", translate: { x: 0, y: 0 }, clip: { x: NaN, y: 0, width: 5, height: 5 } }] },
          { featherPx: -1 },
          { featherPx: "soft" },
        ]) {
          const diags = validateMosaicSources([maskedMedia(mask)]);
          expect(codes(diags)).toContainEqual({
            code: "MASK_INLINE_INVALID",
            severity: "error",
          });
        }
      });
    });

    describe("no placement at all => no errors", () => {
      test("media with no placement", () => {
        const diags = validateMosaicSources([
          { type: "media", assetId: "v", mediaType: "video" } as any,
        ]);
        expect(diags).toHaveLength(0);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Lavfi source validation
  // ---------------------------------------------------------------------------

  describe("lavfi source", () => {
    const base = (overrides: any = {}) => ({
      type: "lavfi",
      lavfi: "color=c=red:s=320x240",
      ...overrides,
    });

    describe("required fields", () => {
      test("no lavfi and no color => LAVFI_SOURCE_MISSING", () => {
        const diags = validateMosaicSources([
          { type: "lavfi" } as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "LAVFI_SOURCE_MISSING",
          severity: "error",
        });
      });

      test("lavfi present => valid", () => {
        const diags = validateMosaicSources([base() as any]);
        expect(diags).toHaveLength(0);
      });

      test("color present (no lavfi) => valid", () => {
        const diags = validateMosaicSources([
          { type: "lavfi", color: "#ff0000" } as any,
        ]);
        expect(diags).toHaveLength(0);
      });
    });

    describe("lavfi field validation", () => {
      test("lavfi not a string => error", () => {
        const diags = validateMosaicSources([
          { type: "lavfi", lavfi: 123 } as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "LAVFI_EXPR_INVALID",
          severity: "error",
        });
      });

      test("lavfi empty string => error", () => {
        const diags = validateMosaicSources([
          { type: "lavfi", lavfi: "   " } as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "LAVFI_EXPR_EMPTY",
          severity: "error",
        });
      });
    });

    describe("color field validation", () => {
      test("color not a string => error", () => {
        const diags = validateMosaicSources([
          { type: "lavfi", color: 0xff0000 } as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "LAVFI_COLOR_INVALID",
          severity: "error",
        });
      });

      test("color empty string => error", () => {
        const diags = validateMosaicSources([
          { type: "lavfi", color: "  " } as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "LAVFI_COLOR_EMPTY",
          severity: "error",
        });
      });
    });

    describe("size validation", () => {
      test("size.wExpr not a string => error", () => {
        const diags = validateMosaicSources([
          base({ size: { wExpr: 320 } }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "LAVFI_SIZE_WEXPR_INVALID",
          severity: "error",
        });
      });

      test("size.wExpr empty string => error", () => {
        const diags = validateMosaicSources([
          base({ size: { wExpr: "  " } }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "LAVFI_SIZE_WEXPR_EMPTY",
          severity: "error",
        });
      });

      test("size.hExpr not a string => error", () => {
        const diags = validateMosaicSources([
          base({ size: { hExpr: 240 } }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "LAVFI_SIZE_HEXPR_INVALID",
          severity: "error",
        });
      });

      test("size.hExpr empty string => error", () => {
        const diags = validateMosaicSources([
          base({ size: { hExpr: "" } }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "LAVFI_SIZE_HEXPR_EMPTY",
          severity: "error",
        });
      });

      test("valid size expressions => no errors", () => {
        const diags = validateMosaicSources([
          base({ size: { wExpr: "iw", hExpr: "ih" } }) as any,
        ]);
        expect(diags).toHaveLength(0);
      });

      test("size with null wExpr/hExpr => no errors", () => {
        const diags = validateMosaicSources([
          base({ size: { wExpr: null, hExpr: null } }) as any,
        ]);
        expect(diags).toHaveLength(0);
      });
    });

    describe("overlay validation", () => {
      test("overlay.xExpr not a string => error", () => {
        const diags = validateMosaicSources([
          base({ overlay: { xExpr: 10 } }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "LAVFI_OVERLAY_XEXPR_INVALID",
          severity: "error",
        });
      });

      test("overlay.xExpr empty string => error", () => {
        const diags = validateMosaicSources([
          base({ overlay: { xExpr: "" } }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "LAVFI_OVERLAY_XEXPR_EMPTY",
          severity: "error",
        });
      });

      test("overlay.yExpr not a string => error", () => {
        const diags = validateMosaicSources([
          base({ overlay: { yExpr: 20 } }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "LAVFI_OVERLAY_YEXPR_INVALID",
          severity: "error",
        });
      });

      test("overlay.yExpr empty string => error", () => {
        const diags = validateMosaicSources([
          base({ overlay: { yExpr: " " } }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "LAVFI_OVERLAY_YEXPR_EMPTY",
          severity: "error",
        });
      });

      test("overlay.enable not a string => error", () => {
        const diags = validateMosaicSources([
          base({ overlay: { enable: true } }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "LAVFI_OVERLAY_ENABLE_INVALID",
          severity: "error",
        });
      });

      test("overlay.enable empty string => error", () => {
        const diags = validateMosaicSources([
          base({ overlay: { enable: "" } }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "LAVFI_OVERLAY_ENABLE_EMPTY",
          severity: "error",
        });
      });

      test("overlay.startAtSec not finite => error", () => {
        const diags = validateMosaicSources([
          base({ overlay: { startAtSec: NaN } }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "LAVFI_OVERLAY_STARTAT_INVALID",
          severity: "error",
        });
      });

      test("overlay.startAtSec negative => error", () => {
        const diags = validateMosaicSources([
          base({ overlay: { startAtSec: -1 } }) as any,
        ]);
        expect(codes(diags)).toContainEqual({
          code: "LAVFI_OVERLAY_STARTAT_NEGATIVE",
          severity: "error",
        });
      });

      test("overlay.startAtSec=0 is valid", () => {
        const diags = validateMosaicSources([
          base({ overlay: { startAtSec: 0 } }) as any,
        ]);
        expect(diags).toHaveLength(0);
      });

      test("overlay.startAtSec=5.5 is valid", () => {
        const diags = validateMosaicSources([
          base({ overlay: { startAtSec: 5.5 } }) as any,
        ]);
        expect(diags).toHaveLength(0);
      });

      test("valid overlay with all fields => no errors", () => {
        const diags = validateMosaicSources([
          base({
            overlay: {
              xExpr: "W-w",
              yExpr: "H-h",
              enable: "between(t,0,5)",
              startAtSec: 1,
            },
          }) as any,
        ]);
        expect(diags).toHaveLength(0);
      });

      test("overlay with null optional fields => no errors", () => {
        const diags = validateMosaicSources([
          base({
            overlay: { xExpr: null, yExpr: null, enable: null, startAtSec: null },
          }) as any,
        ]);
        expect(diags).toHaveLength(0);
      });
    });
  });

  // covers: T:source.type=data, T:source.type=data.variables,
  //         T:source.type=data.alias, T:asset.diagnostic.DATA_SOURCE_VARIABLES_MALFORMED,
  //         T:asset.diagnostic.DATA_SOURCE_ALIAS_INVALID,
  //         T:asset.diagnostic.MOSAIC_ALIAS_COLLISION
  describe("data source (3b)", () => {
    test("accepts a minimal data source with variables", () => {
      const diags = validateMosaicSources([
        { type: "data", variables: { x: 1 } } as any,
      ]);
      expect(diags).toEqual([]);
    });

    test("accepts a data source with alias", () => {
      const diags = validateMosaicSources([
        { type: "data", variables: { tokens: { primary: "#fff" } }, alias: "designTokens" } as any,
      ]);
      expect(diags).toEqual([]);
    });

    test("DATA_SOURCE_VARIABLES_MALFORMED — variables missing", () => {
      const diags = validateMosaicSources([
        { type: "data" } as any,
      ]);
      expect(diags.some((d) => d.code === "DATA_SOURCE_VARIABLES_MALFORMED")).toBe(true);
    });

    test("DATA_SOURCE_VARIABLES_MALFORMED — variables is null", () => {
      const diags = validateMosaicSources([
        { type: "data", variables: null } as any,
      ]);
      expect(diags.some((d) => d.code === "DATA_SOURCE_VARIABLES_MALFORMED")).toBe(true);
    });

    test("DATA_SOURCE_VARIABLES_MALFORMED — variables is an array", () => {
      const diags = validateMosaicSources([
        { type: "data", variables: [1, 2, 3] } as any,
      ]);
      expect(diags.some((d) => d.code === "DATA_SOURCE_VARIABLES_MALFORMED")).toBe(true);
    });

    test("DATA_SOURCE_ALIAS_INVALID — alias has hyphen (not STRICT_IDENTIFIER)", () => {
      const diags = validateMosaicSources([
        { type: "data", variables: {}, alias: "bad-alias" } as any,
      ]);
      expect(diags.some((d) => d.code === "DATA_SOURCE_ALIAS_INVALID")).toBe(true);
    });

    test("DATA_SOURCE_ALIAS_INVALID — alias starts with digit", () => {
      const diags = validateMosaicSources([
        { type: "data", variables: {}, alias: "0bad" } as any,
      ]);
      expect(diags.some((d) => d.code === "DATA_SOURCE_ALIAS_INVALID")).toBe(true);
    });

    test("accepts data + lavfi in same array (data sources may sit alongside renderables)", () => {
      const diags = validateMosaicSources([
        { type: "data", variables: { x: 1 } } as any,
        { type: "lavfi", color: "#000" } as any,
      ]);
      expect(diags).toEqual([]);
    });

    test("accepts data + media in same array (data sources may sit alongside renderables)", () => {
      const diags = validateMosaicSources(
        [
          { type: "data", variables: {} } as any,
          { type: "media", mediaType: "image", assetId: "hero" } as any,
        ],
        { hero: { kind: "file", path: "hero.png" } } as any,
      );
      expect(diags).toEqual([]);
    });

    test("accepts interleaved data + renderable + data (data sources behave like audio-only sources)", () => {
      const diags = validateMosaicSources([
        { type: "data", variables: {}, alias: "a" } as any,
        { type: "lavfi", color: "#000" } as any,
        { type: "data", variables: {}, alias: "b" } as any,
      ]);
      expect(diags).toEqual([]);
    });

    test("MOSAIC_ALIAS_COLLISION — two data sources share alias", () => {
      const diags = validateMosaicSources([
        { type: "data", variables: {}, alias: "heroData" } as any,
        { type: "data", variables: {}, alias: "heroData" } as any,
      ]);
      expect(diags.some((d) => d.code === "MOSAIC_ALIAS_COLLISION")).toBe(true);
    });

    test("MOSAIC_ALIAS_COLLISION — third source uses a third alias, no false positive", () => {
      const diags = validateMosaicSources([
        { type: "data", variables: {}, alias: "heroData" } as any,
        { type: "data", variables: {}, alias: "rollData" } as any,
        { type: "data", variables: {}, alias: "tokensData" } as any,
      ]);
      expect(diags.some((d) => d.code === "MOSAIC_ALIAS_COLLISION")).toBe(false);
    });

    test("unaliased data sources do not collide with each other", () => {
      const diags = validateMosaicSources([
        { type: "data", variables: { a: 1 } } as any,
        { type: "data", variables: { b: 2 } } as any,
      ]);
      expect(diags.some((d) => d.code === "MOSAIC_ALIAS_COLLISION")).toBe(false);
    });

    test("data source no longer trips UNKNOWN_SOURCE_TYPE (was a Phase 1 gap)", () => {
      const diags = validateMosaicSources([
        { type: "data", variables: {} } as any,
      ]);
      expect(diags.some((d) => d.code === "UNKNOWN_SOURCE_TYPE")).toBe(false);
    });
  });
});
