/**
 * Tests for the ffmpeg probe helpers. The child spawns are mocked so this
 * runs without a real binary. The mock branches on the flag (`-version` /
 * `-filters` / `-encoders`) so version parsing and filter/encoder detection
 * can be exercised independently.
 */

// A realistic slice of `ffmpeg -filters` output. Note the traps: the `eq`
// filter's own description contains "contrast" but OTHER lines mention "eq"
// as a substring ("frequency", "aeval", a description with "gamma").
const FILTERS_OUTPUT = `Filters:
  T.. = Timeline support
  .S. = Slice threading
  ... = Command support
 ... aeval            |->A       Filter audio signal according to a specified expression.
 ..C eq               V->V       Adjust brightness, contrast, gamma, or saturation.
 T.. hue              V->V       Adjust the hue and saturation of the input video.
 ... showfreqs        A->V       Convert input audio to a frequency domain video output.
 ... scale            V->V       Scale the input video size and/or convert the image format.
`;

// Pinned-style nightly `-version` (libavfilter 11-era).
const VERSION_OUTPUT_LAVF11 = `ffmpeg version N-124278-gcc3ca17127-20260430 Copyright (c) 2000-2026 the FFmpeg developers
built with gcc 14
libavutil      60.  2.100 / 60.  2.100
libavcodec     62.  3.100 / 62.  3.100
libavformat    62.  0.102 / 62.  0.102
libavfilter    11. 17.100 / 11. 17.100
`;

// An old untagged build (2021 git-master) — libavfilter 8, no tagged x.y.
const VERSION_OUTPUT_LAVF8 = `ffmpeg version N-100000-gabcdef Copyright (c) 2000-2021 the FFmpeg developers
libavfilter     8.  3.100 /  8.  3.100
`;

const ENCODERS_OUTPUT = `Encoders:
 V..... libx264              libx264 H.264 / AVC
 V..... libopenh264          OpenH264
`;

// A slice of `ffmpeg -h long` output listing the fuse option as a token.
const HELP_LONG_OUTPUT = `Advanced global options:
  -filter_threads <int>       number of non-complex filter threads
  -filter_buffered_frames <int>  maximum number of buffered frames in a filtergraph
  -filter_complex_threads <int>  number of threads for -filter_complex
`;

jest.mock("child_process", () => ({
  ...jest.requireActual<typeof import("child_process")>("child_process"),
  execFileSync: jest.fn((_bin: string, args: string[]) => {
    const flag = args[0];
    if (flag === "-version") return VERSION_OUTPUT_LAVF11;
    if (flag === "-filters") return FILTERS_OUTPUT;
    if (flag === "-encoders") return ENCODERS_OUTPUT;
    if (flag === "-h") return HELP_LONG_OUTPUT;
    return "";
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  detectRuntimeFilters,
  detectFfmpegCliOption,
  probeFfmpegVersion,
  probeFfmpegRuntime,
} = require("./probe") as typeof import("./probe");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cp = require("child_process") as typeof import("child_process");

describe("detectRuntimeFilters", () => {
  test("finds a filter present in the NAME column", () => {
    expect(detectRuntimeFilters(["eq"])).toEqual({ eq: true });
    expect(detectRuntimeFilters(["scale"])).toEqual({ scale: true });
  });

  test("reports absent for a filter not in the list", () => {
    expect(detectRuntimeFilters(["libplacebo"])).toEqual({ libplacebo: false });
  });

  test("does NOT false-positive on `eq` inside descriptions/other names", () => {
    // "frequency"/"aeval"/the eq description all contain the substring "eq";
    // a real absence must still report false.
    expect(detectRuntimeFilters(["freq"])).toEqual({ freq: false });
    expect(detectRuntimeFilters(["contrast"])).toEqual({ contrast: false });
  });

  test("multiple names in one call", () => {
    expect(detectRuntimeFilters(["eq", "hue", "nope"])).toEqual({
      eq: true,
      hue: true,
      nope: false,
    });
  });
});

describe("detectRuntimeFilters — probe failure", () => {
  test("returns null for every name when the invocation throws", () => {
    (cp.execFileSync as jest.Mock).mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });
    expect(detectRuntimeFilters(["eq"])).toEqual({ eq: null });
  });
});

describe("probeFfmpegVersion (lean)", () => {
  test("parses the libavfilter major from the full -version output", () => {
    const info = probeFfmpegVersion();
    expect(info.found).toBe(true);
    expect(info.libavfilterMajor).toBe(11);
    expect(info.version).toMatch(/^ffmpeg version N-124278/);
  });

  test("libavfilterMajor is null when the libavfilter line is absent", () => {
    (cp.execFileSync as jest.Mock).mockImplementationOnce(
      () => "ffmpeg version 4.4.0 Copyright (c) 2000-2021\n",
    );
    const info = probeFfmpegVersion();
    expect(info.found).toBe(true);
    expect(info.libavfilterMajor).toBeNull();
  });

  test("found:false + null major when the probe fails", () => {
    (cp.execFileSync as jest.Mock).mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });
    expect(probeFfmpegVersion()).toEqual({
      found: false,
      version: "not found",
      libavfilterMajor: null,
    });
  });

  test("reads an old untagged build's libavfilter major (8)", () => {
    (cp.execFileSync as jest.Mock).mockImplementationOnce(
      () => VERSION_OUTPUT_LAVF8,
    );
    expect(probeFfmpegVersion().libavfilterMajor).toBe(8);
  });
});

describe("probeFfmpegRuntime", () => {
  test("surfaces libavfilterMajor alongside libx264", () => {
    const rt = probeFfmpegRuntime();
    expect(rt.found).toBe(true);
    expect(rt.libavfilterMajor).toBe(11);
    expect(rt.libx264).toBe(true);
  });
});

describe("detectFfmpegCliOption", () => {
  test("true when the option is a token in `-h long`", () => {
    expect(detectFfmpegCliOption("-filter_buffered_frames")).toBe(true);
  });

  test("false when the option is absent", () => {
    expect(detectFfmpegCliOption("-does_not_exist")).toBe(false);
  });

  test("does not false-match a substring (e.g. `-filter_buffered`)", () => {
    expect(detectFfmpegCliOption("-filter_buffered")).toBe(false);
  });

  test("null when the probe fails", () => {
    (cp.execFileSync as jest.Mock).mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });
    expect(detectFfmpegCliOption("-filter_buffered_frames")).toBeNull();
  });
});
