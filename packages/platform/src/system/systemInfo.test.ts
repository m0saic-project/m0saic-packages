import { collectSystemInfo, HW_VIDEO_ENCODERS } from "./systemInfo";

describe("collectSystemInfo", () => {
  it("reports plausible host specs", () => {
    const info = collectSystemInfo();
    expect(typeof info.cpu.model).toBe("string");
    expect(info.cpu.cores).toBeGreaterThanOrEqual(1);
    // speedMhz is either a positive number or null (some platforms report 0).
    expect(info.cpu.speedMhz === null || info.cpu.speedMhz > 0).toBe(true);
    expect(info.ram.totalBytes).toBeGreaterThan(0);
    expect(info.ram.totalGb).toBeGreaterThan(0);
    expect(info.os.platform).toBe(process.platform);
    expect(info.os.arch).toBe(process.arch);
    expect(typeof info.os.release).toBe("string");
    expect(Array.isArray(info.ffmpeg.hwEncoders)).toBe(true);
  });

  it("degrades gracefully when ffmpeg is absent", () => {
    // A path that cannot resolve forces the probe's catch branch.
    const info = collectSystemInfo({
      ffmpegPath: "/nonexistent/definitely-not-ffmpeg",
    });
    expect(info.ffmpeg.found).toBe(false);
    expect(info.ffmpeg.version).toBe("not found");
    expect(info.ffmpeg.hwEncoders).toEqual([]);
    // Host specs are still captured even with no ffmpeg.
    expect(info.cpu.cores).toBeGreaterThanOrEqual(1);
  });

  it("only reports hardware encoders from the known list", () => {
    const info = collectSystemInfo();
    for (const name of info.ffmpeg.hwEncoders) {
      expect(HW_VIDEO_ENCODERS).toContain(name);
    }
  });
});
