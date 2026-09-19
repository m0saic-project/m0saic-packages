import { buildHostFingerprint, toMosaicHostOs } from "./hostFingerprint";

describe("toMosaicHostOs", () => {
  it("buckets the big three and floors the rest", () => {
    expect(toMosaicHostOs("darwin")).toBe("macos");
    expect(toMosaicHostOs("win32")).toBe("windows");
    expect(toMosaicHostOs("linux")).toBe("linux");
    expect(toMosaicHostOs("freebsd")).toBe("other");
  });
});

describe("buildHostFingerprint", () => {
  it("floors versions to major.minor and honors injected platform/arch", () => {
    expect(
      buildHostFingerprint({
        mosaicVersion: "0.1.7",
        ffmpegVersion: "8.0.1",
        platform: "win32",
        arch: "x64",
      }),
    ).toEqual({ os: "windows", arch: "x64", mosaicVersion: "0.1", ffmpegVersion: "8.0" });
  });

  it("omits ffmpeg when unparseable and falls back mosaicVersion to 0.0", () => {
    const fp = buildHostFingerprint({
      mosaicVersion: "dev",
      platform: "darwin",
      arch: "arm64",
    });
    expect(fp).toEqual({ os: "macos", arch: "arm64", mosaicVersion: "0.0" });
  });

  it("defaults platform/arch from the process", () => {
    const fp = buildHostFingerprint({ mosaicVersion: "0.1.0" });
    expect(["macos", "windows", "linux", "other"]).toContain(fp.os);
    expect(typeof fp.arch).toBe("string");
  });
});
