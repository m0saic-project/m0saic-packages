import {
  getDefaultToolchainBinaries,
  resetDefaultToolchainBinaries,
  resolveFfmpegPath,
  resolveFfprobePath,
  setDefaultToolchainBinaries,
} from "./defaultBinaries";

const GPL = "C:/Users/dev/m0saic/toolchains/ffmpeg/1.0.0-gpl/bin/ffmpeg.exe";
const GPL_PROBE = "C:/Users/dev/m0saic/toolchains/ffmpeg/1.0.0-gpl/bin/ffprobe.exe";

beforeEach(() => resetDefaultToolchainBinaries());
afterAll(() => resetDefaultToolchainBinaries());

describe("unregistered — the historical behaviour is preserved", () => {
  it("falls back to the bare names (PATH)", () => {
    expect(resolveFfmpegPath()).toBe("ffmpeg");
    expect(resolveFfprobePath()).toBe("ffprobe");
  });

  it("still honours an explicit path", () => {
    expect(resolveFfmpegPath("/opt/ffmpeg")).toBe("/opt/ffmpeg");
    expect(resolveFfprobePath("/opt/ffprobe")).toBe("/opt/ffprobe");
  });
});

describe("registered — a forgotten path no longer means PATH", () => {
  it("uses the registered binaries when the caller passes nothing", () => {
    setDefaultToolchainBinaries({ ffmpegPath: GPL, ffprobePath: GPL_PROBE });
    // This is the whole point: the call site that FORGOT to thread the path
    // gets the resolved toolchain instead of silently ENOENTing on a machine
    // where `m0saic setup` installed ffmpeg without touching PATH.
    expect(resolveFfmpegPath()).toBe(GPL);
    expect(resolveFfprobePath()).toBe(GPL_PROBE);
  });

  it("an explicit argument still wins over the registration", () => {
    setDefaultToolchainBinaries({ ffmpegPath: GPL, ffprobePath: GPL_PROBE });
    expect(resolveFfmpegPath("/opt/other")).toBe("/opt/other");
    expect(resolveFfprobePath("/opt/other-probe")).toBe("/opt/other-probe");
  });

  it("registering only one binary leaves the other on its bare default", () => {
    setDefaultToolchainBinaries({ ffmpegPath: GPL });
    expect(resolveFfmpegPath()).toBe(GPL);
    expect(resolveFfprobePath()).toBe("ffprobe");
  });

  it("ignores empty strings rather than spawning \"\"", () => {
    setDefaultToolchainBinaries({ ffmpegPath: "", ffprobePath: "" });
    expect(resolveFfmpegPath()).toBe("ffmpeg");
    expect(resolveFfprobePath()).toBe("ffprobe");
  });

  it("a later registration replaces the earlier one wholesale", () => {
    setDefaultToolchainBinaries({ ffmpegPath: GPL, ffprobePath: GPL_PROBE });
    setDefaultToolchainBinaries({ ffmpegPath: "/opt/second" });
    expect(getDefaultToolchainBinaries()).toEqual({ ffmpegPath: "/opt/second" });
    expect(resolveFfprobePath()).toBe("ffprobe");
  });

  it("reset returns to the bare defaults", () => {
    setDefaultToolchainBinaries({ ffmpegPath: GPL });
    resetDefaultToolchainBinaries();
    expect(getDefaultToolchainBinaries()).toEqual({});
    expect(resolveFfmpegPath()).toBe("ffmpeg");
  });

  it("the getter hands back a copy, not the live registration", () => {
    setDefaultToolchainBinaries({ ffmpegPath: GPL });
    const snapshot = getDefaultToolchainBinaries() as { ffmpegPath?: string };
    snapshot.ffmpegPath = "/tampered";
    expect(resolveFfmpegPath()).toBe(GPL);
  });
});
