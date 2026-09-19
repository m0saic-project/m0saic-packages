import { goldenPlatformSlot, resolveGoldenFfmpeg } from "./goldenFfmpeg";
import { resolveFfmpegBaseline } from "./ffmpeg";
import type { FfmpegRuntime } from "./probe";

const foundRuntime = (version: string): FfmpegRuntime => ({
  found: true,
  version,
  libavfilterMajor: 11,
  libx264: true,
});

const NOT_FOUND: FfmpegRuntime = {
  found: false,
  version: "",
  libavfilterMajor: null,
  libx264: null,
};

describe("goldenPlatformSlot", () => {
  test("returns the current platform on the two dev platforms", () => {
    // The suite only runs on win32/darwin dev machines; elsewhere the
    // helper's throw is the contract and this test would need a skip.
    expect(goldenPlatformSlot()).toBe(process.platform);
  });
});

describe("resolveGoldenFfmpeg", () => {
  test("slot-missing when the golden binary does not exist (never falls back to PATH)", () => {
    const res = resolveGoldenFfmpeg({
      exists: () => false,
      probe: () => {
        throw new Error("probe must not run when the slot is missing");
      },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("slot-missing");
    expect(res.message).toContain("m0saic setup");
    expect(res.message).toContain(res.baseline.snapshot);
    // The failed path is the slot path, not a bare "ffmpeg" PATH lookup.
    expect(res.ffmpegPath).toContain("toolchains");
  });

  test("probe-failed when the binary exists but does not run", () => {
    const res = resolveGoldenFfmpeg({
      exists: () => true,
      probe: () => NOT_FOUND,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("probe-failed");
  });

  test("snapshot-mismatch when the probed version is a different build", () => {
    const res = resolveGoldenFfmpeg({
      exists: () => true,
      probe: () =>
        foundRuntime("ffmpeg version 8.0.1 Copyright (c) 2000-2026"),
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("snapshot-mismatch");
    expect(res.message).toContain(res.baseline.snapshot);
    expect(res.message).toContain("8.0.1");
  });

  test("ok when the probed version carries the pinned baseline snapshot", () => {
    const baseline = resolveFfmpegBaseline();
    const res = resolveGoldenFfmpeg({
      exists: () => true,
      probe: (p) =>
        foundRuntime(`ffmpeg version ${baseline.snapshot} Copyright (c)`),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.baseline.snapshot).toBe(baseline.snapshot);
    expect(res.ffmpegPath).toContain(`-${baseline.profile}`);
    expect(res.ffprobePath).toContain(`-${baseline.profile}`);
  });

  test("platformKey drives the variant slot: GPL-first on every platform (official baseline)", () => {
    const win = resolveGoldenFfmpeg({
      platformKey: "win32-x64",
      exists: () => false,
    });
    expect(win.ok).toBe(false);
    if (!win.ok) expect(win.ffmpegPath).toContain("-gpl");

    const mac = resolveGoldenFfmpeg({
      platformKey: "darwin-arm64",
      exists: () => false,
    });
    expect(mac.ok).toBe(false);
    if (!mac.ok) expect(mac.ffmpegPath).toContain("-gpl");
  });
});
