import { validateMosaicDocument } from "./validateMosaicDocument";
import {
  isValidM0String,
  parseM0StringToRenderFrames,
} from "@m0saic/dsl";
import { validateMosaicSources } from "./validateSources";

jest.mock("@m0saic/dsl");
jest.mock("./validateSources");

const isValidMosaicStringMock = isValidM0String as jest.MockedFunction<
  typeof isValidM0String
>;
const parseMosaicStringMock = parseM0StringToRenderFrames as jest.MockedFunction<
  typeof parseM0StringToRenderFrames
>;
const validateMosaicSourcesMock = validateMosaicSources as jest.MockedFunction<
  typeof validateMosaicSources
>;

// use consistent dims for all tests
const TEST_WIDTH = 1920;
const TEST_HEIGHT = 1080;

// simple helper: one real frame covering the whole canvas
const ONE_REAL_FRAME = [
  {
    x: 0,
    y: 0,
    width: TEST_WIDTH,
    height: TEST_HEIGHT,
    nullRender: false,
  },
] as any;

// ─────────────────────────────────────────────────────────────
// PHASE 3d.3 NOTE — quarantine reactivated 2026-05-14
//
// Previously `.skip`'d tests below now run against the per-output
// validator (`validateMosaicOutput`) called once per entry in
// `MosaicDocument.outputs`. Fixtures migrated from the old
// `config: { durationMs, fps, advancedConfig: {...} }` shape to the
// new `durationMs, fps, format: {...} `
// shape.
// ─────────────────────────────────────────────────────────────

describe("validateMosaicDocument", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns early when the mosaic string is invalid", () => {
    isValidMosaicStringMock.mockReturnValue(false);

    const file = {
      m0: "not-valid",
      config: {
        durationMs: 0,
        fps: 0,
        sources: [],
      },
    } as any;

    const diags = validateMosaicDocument(file, TEST_WIDTH, TEST_HEIGHT);

    expect(diags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_MOSAIC_STRING",
          severity: "error",
        }),
      ])
    );
    // early return, so sources validation should not run
    expect(validateMosaicSourcesMock).not.toHaveBeenCalled();
    expect(parseMosaicStringMock).not.toHaveBeenCalled();
  });

  it("collects duration/fps/source-count errors and appends source diagnostics", () => {
    isValidMosaicStringMock.mockReturnValue(true);
    parseMosaicStringMock.mockReturnValue(ONE_REAL_FRAME);
    validateMosaicSourcesMock.mockReturnValue([
      {
        code: "FROM_SOURCES",
        message: "from sources",
        severity: "warning",
      } as any,
    ]);

    const file = {
      m0: "1", // one real tile frame
      sources: [], // 0 sources -> mismatch vs 1 non-null frame
      durationMs: 0, // invalid
          fps: 500, // invalid (>240),
    } as any;

    const diags = validateMosaicDocument(file, TEST_WIDTH, TEST_HEIGHT);

    expect(diags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_DURATION" }),
        expect.objectContaining({ code: "INVALID_FPS" }),
        expect.objectContaining({ code: "SOURCE_COUNT_MISMATCH" }),
        expect.objectContaining({ code: "FROM_SOURCES" }),
      ])
    );

    expect(validateMosaicSourcesMock).toHaveBeenCalledTimes(1);
    expect(validateMosaicSourcesMock.mock.calls[0][0]).toBe(
      file.sources
    );
  });

  it("adds audio-container warnings for pixelFormat and videoCodec (sample case: mp3)", () => {
    isValidMosaicStringMock.mockReturnValue(true);
    parseMosaicStringMock.mockReturnValue(ONE_REAL_FRAME);
    validateMosaicSourcesMock.mockReturnValue([]);

    const file = {
      m0: "1",
      sources: [{}],
      durationMs: 1000,
      fps: 30,
      format: {
        container: "mp3",
        pixelFormat: "yuv420p",
        videoCodec: "libx264",
        bitrate: "1000k",
      },
    } as any;

    const diags = validateMosaicDocument(file, TEST_WIDTH, TEST_HEIGHT);

    expect(diags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PIXELFORMAT_IGNORED_FOR_AUDIO_CONTAINER",
          severity: "warning",
        }),
        expect.objectContaining({
          code: "VIDEO_CODEC_IGNORED_FOR_AUDIO_CONTAINER",
          severity: "warning",
        }),
      ])
    );
  });

  it("adds empty-string warnings for bitrate and pixelFormat", () => {
    isValidMosaicStringMock.mockReturnValue(true);
    parseMosaicStringMock.mockReturnValue(ONE_REAL_FRAME);
    validateMosaicSourcesMock.mockReturnValue([]);

    const file = {
      m0: "1",
      sources: [{}],
      durationMs: 1000,
      fps: 30,
      format: {
        container: "mp4", // not mp3; we just want the empty-string checks
        bitrate: "",
        pixelFormat: "",
      },
    } as any;

    const diags = validateMosaicDocument(file, TEST_WIDTH, TEST_HEIGHT);

    expect(diags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "EMPTY_BITRATE" }),
        expect.objectContaining({ code: "EMPTY_PIXEL_FORMAT" }),
      ])
    );

    // backgroundColor was retired from the per-output config when
    // advancedConfig went away; ensure nothing emits the legacy code.
    expect(diags.map((d) => d.code)).not.toContain("EMPTY_BACKGROUND_COLOR");
  });

  it("has no diagnostics for a fully valid config", () => {
    isValidMosaicStringMock.mockReturnValue(true);
    parseMosaicStringMock.mockReturnValue(ONE_REAL_FRAME);
    validateMosaicSourcesMock.mockReturnValue([]);

    const file = {
      m0: "1",
      assets: {},
      sources: [{}],
      durationMs: 1000,
          fps: 30,
          // format omitted on purpose — defaults resolved by core.,
    } as any;

    const diags = validateMosaicDocument(file, TEST_WIDTH, TEST_HEIGHT);

    expect(diags).toHaveLength(0);
  });

  describe("duration/fps branch coverage", () => {
    const mkBase = (durationMs: any, fps: any) =>
      ({
        m0: "1",
        sources: [{}],
        durationMs, fps,
      } as any);

    beforeEach(() => {
      isValidMosaicStringMock.mockReturnValue(true);
      parseMosaicStringMock.mockReturnValue(ONE_REAL_FRAME);
      validateMosaicSourcesMock.mockReturnValue([]);
    });

    test.each([
      ["duration not number", "1000", [{ code: "INVALID_DURATION" }]],
      ["duration NaN", Number.NaN, [{ code: "INVALID_DURATION" }]],
      ["duration non-integer", 1.25, [{ code: "INVALID_DURATION" }]],
      ["duration < 1", 0, [{ code: "INVALID_DURATION" }]],
      ["duration valid integer", 1000, []],
    ])("%s", (_name, durationMs, expected) => {
      const diags = validateMosaicDocument(mkBase(durationMs, 30), TEST_WIDTH, TEST_HEIGHT);
      expect(diags).toEqual(
        expect.arrayContaining((expected as any[]).map((e) => expect.objectContaining(e)))
      );
      if (expected.length === 0) {
        expect(diags.map((d) => d.code)).not.toContain("INVALID_DURATION");
      }
    });

    test.each([
      ["fps not number", "30", [{ code: "INVALID_FPS" }]],
      ["fps NaN", Number.NaN, [{ code: "INVALID_FPS" }]],
      ["fps non-integer", 29.97, [{ code: "INVALID_FPS" }]],
      ["fps < 1", 0, [{ code: "INVALID_FPS" }]],
      ["fps > 240", 241, [{ code: "INVALID_FPS" }]],
      ["fps valid boundary 1", 1, []],
      ["fps valid boundary 240", 240, []],
    ])("%s", (_name, fps, expected) => {
      const diags = validateMosaicDocument(mkBase(1000, fps), TEST_WIDTH, TEST_HEIGHT);
      expect(diags).toEqual(
        expect.arrayContaining((expected as any[]).map((e) => expect.objectContaining(e)))
      );
      if (expected.length === 0) {
        expect(diags.map((d) => d.code)).not.toContain("INVALID_FPS");
      }
    });
  });

  describe("text renderMode duration checks", () => {
    beforeEach(() => {
      isValidMosaicStringMock.mockReturnValue(true);
      parseMosaicStringMock.mockReturnValue(ONE_REAL_FRAME);
      validateMosaicSourcesMock.mockReturnValue([]);
    });

    test("emits TEXT_RENDER_MODE_DURATION_MISSING for text video with no local or parent duration", () => {
      const file = {
        m0: "1",
        assets: {},
        sources: [
          { type: "text", layers: [{ content: { kind: "literal", text: "x" } }], renderMode: { kind: "video" } },
        ],
      } as any;

      const diags = validateMosaicDocument(file, TEST_WIDTH, TEST_HEIGHT);
      expect(diags).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "TEXT_RENDER_MODE_DURATION_MISSING", severity: "error" }),
        ])
      );
    });

    test("does not emit TEXT_RENDER_MODE_DURATION_MISSING when text video has local playback.clipDurationMs", () => {
      const file = {
        m0: "1",
        assets: {},
        sources: [
          {
            type: "text",
            layers: [{ content: { kind: "literal", text: "x" } }],
            renderMode: { kind: "video" },
            playback: { clipDurationMs: 500 },
          },
        ],
      } as any;

      const diags = validateMosaicDocument(file, TEST_WIDTH, TEST_HEIGHT);
      expect(diags.map((d) => d.code)).not.toContain("TEXT_RENDER_MODE_DURATION_MISSING");
    });

    test("does not emit TEXT_RENDER_MODE_DURATION_MISSING when parent duration is valid", () => {
      const file = {
        m0: "1",
        assets: {},
        sources: [
          { type: "text", layers: [{ content: { kind: "literal", text: "x" } }], renderMode: { kind: "video" } },
        ],
        durationMs: 1000, fps: 30 ,
      } as any;

      const diags = validateMosaicDocument(file, TEST_WIDTH, TEST_HEIGHT);
      expect(diags.map((d) => d.code)).not.toContain("TEXT_RENDER_MODE_DURATION_MISSING");
    });

    test("does not evaluate duration rule for non-video text renderMode", () => {
      const file = {
        m0: "1",
        assets: {},
        sources: [
          { type: "text", layers: [{ content: { kind: "literal", text: "x" } }], renderMode: { kind: "image" } },
        ],
      } as any;

      const diags = validateMosaicDocument(file, TEST_WIDTH, TEST_HEIGHT);
      expect(diags.map((d) => d.code)).not.toContain("TEXT_RENDER_MODE_DURATION_MISSING");
    });

    test("does not evaluate duration rule for non-text sources", () => {
      const file = {
        m0: "1",
        assets: {},
        sources: [{ type: "media", src: "x.mp4", mediaType: "video" }],
      } as any;

      const diags = validateMosaicDocument(file, TEST_WIDTH, TEST_HEIGHT);
      expect(diags.map((d) => d.code)).not.toContain("TEXT_RENDER_MODE_DURATION_MISSING");
    });

    test("does not evaluate duration rule when source entry is nullish", () => {
      const file = {
        m0: "1",
        assets: {},
        sources: [undefined],
      } as any;

      const diags = validateMosaicDocument(file, TEST_WIDTH, TEST_HEIGHT);
      expect(diags.map((d) => d.code)).not.toContain("TEXT_RENDER_MODE_DURATION_MISSING");
    });

    test("defaults text render kind to image when renderMode is omitted", () => {
      const file = {
        m0: "1",
        assets: {},
        sources: [{ type: "text", layers: [{ content: { kind: "literal", text: "x" } }] }],
      } as any;

      const diags = validateMosaicDocument(file, TEST_WIDTH, TEST_HEIGHT);
      expect(diags.map((d) => d.code)).not.toContain("TEXT_RENDER_MODE_DURATION_MISSING");
    });
  });

  it("does not emit audio-container warnings when fields are absent", () => {
    isValidMosaicStringMock.mockReturnValue(true);
    parseMosaicStringMock.mockReturnValue(ONE_REAL_FRAME);
    validateMosaicSourcesMock.mockReturnValue([]);

    const file = {
      m0: "1",
      sources: [{}],
      durationMs: 1000,
      fps: 30,
      format: {
        container: "mp3",
        bitrate: "192k",
      },
    } as any;

    const diags = validateMosaicDocument(file, TEST_WIDTH, TEST_HEIGHT);
    const diagsCodes = diags.map((d) => d.code);
    expect(diagsCodes).not.toContain("PIXELFORMAT_IGNORED_FOR_AUDIO_CONTAINER");
    expect(diagsCodes).not.toContain("VIDEO_CODEC_IGNORED_FOR_AUDIO_CONTAINER");
  });
});
