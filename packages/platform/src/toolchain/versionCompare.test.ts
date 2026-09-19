import {
  compareFfmpegVersionToEpoch,
  describeFfmpegVersion,
  parseFfmpegMajorVersion,
} from "./versionCompare";

describe("parseFfmpegMajorVersion", () => {
  it("parses the major from a tagged release line", () => {
    expect(
      parseFfmpegMajorVersion("ffmpeg version 8.0.1 Copyright (c) 2000-2025"),
    ).toBe(8);
    expect(parseFfmpegMajorVersion("ffmpeg version 7.1 Copyright")).toBe(7);
    expect(parseFfmpegMajorVersion("ffmpeg version 6.0")).toBe(6);
  });

  it("returns null for a BtbN nightly N-build (no x.y)", () => {
    // The N-counter must NOT be misread as a major version.
    expect(
      parseFfmpegMajorVersion(
        "ffmpeg version N-124278-gcc3ca17127-20260430 Copyright (c) 2000-2026",
      ),
    ).toBeNull();
  });

  it("returns null for unparseable garbage", () => {
    expect(parseFfmpegMajorVersion("not an ffmpeg version at all")).toBeNull();
    expect(parseFfmpegMajorVersion("")).toBeNull();
  });
});

describe("compareFfmpegVersionToEpoch", () => {
  const epoch = "ffmpeg version N-123549-g70537ec8e6-20260318";

  it("returns 'at' on exact string match", () => {
    expect(compareFfmpegVersionToEpoch(epoch, epoch)).toBe("at");
  });

  it("returns 'at' when build dates match (different git counter)", () => {
    const userSameDate = "ffmpeg version N-998877-gAAAAAAAAAA-20260318";
    expect(compareFfmpegVersionToEpoch(userSameDate, epoch)).toBe("at");
  });

  it("returns 'post' when user date is newer", () => {
    const userNewer = "ffmpeg version N-123550-g70537ec8e6-20260319";
    expect(compareFfmpegVersionToEpoch(userNewer, epoch)).toBe("post");
  });

  it("returns 'pre' when user date is older", () => {
    const userOlder = "ffmpeg version N-100000-gOLD0000000-20240101";
    expect(compareFfmpegVersionToEpoch(userOlder, epoch)).toBe("pre");
  });

  it("returns 'unknown' on null inputs", () => {
    expect(compareFfmpegVersionToEpoch(null, epoch)).toBe("unknown");
    expect(compareFfmpegVersionToEpoch(epoch, null)).toBe("unknown");
    expect(compareFfmpegVersionToEpoch(null, null)).toBe("unknown");
  });

  it("compares semver-tagged releases against each other", () => {
    expect(compareFfmpegVersionToEpoch("ffmpeg 4.4.0", "ffmpeg 4.4.0")).toBe(
      "at",
    );
    expect(
      compareFfmpegVersionToEpoch("ffmpeg 4.4.0", "ffmpeg 5.0.0"),
    ).toBe("pre");
    expect(
      compareFfmpegVersionToEpoch("ffmpeg 8.0.1", "ffmpeg 7.1.0"),
    ).toBe("post");
    expect(
      compareFfmpegVersionToEpoch("ffmpeg 7.1.2", "ffmpeg 7.1.0"),
    ).toBe("post");
  });

  it("handles two-segment release versions (no patch)", () => {
    expect(compareFfmpegVersionToEpoch("ffmpeg 7.1", "ffmpeg 7.1.0")).toBe(
      "at",
    );
    expect(compareFfmpegVersionToEpoch("ffmpeg 7.1", "ffmpeg 7.1.1")).toBe(
      "pre",
    );
  });

  it("treats a tagged release as 'pre' a baseline N-build (Homebrew case)", () => {
    // The reported user case: Homebrew ffmpeg 8.0.1 stamped
    // "Copyright (c) 2000-2025" vs an m0saic baseline pinned to a
    // 2026-04-30 BtbN nightly. Resolved by the copyright-year fallback.
    const userRelease =
      "ffmpeg version 8.0.1 Copyright (c) 2000-2025 the FFmpeg developers";
    const baselineNightly = "ffmpeg N-124278-gcc3ca17127-20260430";
    expect(
      compareFfmpegVersionToEpoch(userRelease, baselineNightly),
    ).toBe("pre");
    // Symmetric: baseline-tagged 2025 release, user on 2026 nightly.
    expect(
      compareFfmpegVersionToEpoch(baselineNightly, userRelease),
    ).toBe("post");
  });

  it("stays 'unknown' when a release with no copyright stamp is compared to a nightly", () => {
    // Bare "ffmpeg 4.4.0" strings without the copyright line carry no
    // year signal — the comparator refuses to guess. The user has to
    // upgrade past this corner case manually (and the UI surfaces
    // "unable to determine" as before).
    const epoch = "ffmpeg version N-123549-g70537ec8e6-20260318";
    expect(compareFfmpegVersionToEpoch("ffmpeg 4.4.0", epoch)).toBe("unknown");
    expect(compareFfmpegVersionToEpoch(epoch, "ffmpeg 4.4.0")).toBe("unknown");
  });

  it("stays 'unknown' when both sides share the same year but differ in format", () => {
    // Year-precision can't disambiguate within a single calendar year —
    // the comparator declines to guess month-precision from a
    // copyright stamp. Conservative is correct here.
    const sameYearRelease =
      "ffmpeg version 8.0.1 Copyright (c) 2000-2026 the FFmpeg developers";
    const sameYearNightly = "ffmpeg N-124000-gabc-20260101";
    expect(
      compareFfmpegVersionToEpoch(sameYearRelease, sameYearNightly),
    ).toBe("unknown");
  });

  it("handles BtbN release tag stamps", () => {
    const a = "N-123549-g70537ec8e6-20260318";
    const b = "N-123549-g70537ec8e6-20260318";
    expect(compareFfmpegVersionToEpoch(a, b)).toBe("at");
  });

  it("does not misread the BtbN counter as a release version", () => {
    // The N-counter (e.g. 124278) is huge and would otherwise look like
    // major version 124278 to a naive semver match. The release-version
    // regex anchors on a non-digit prefix so this can't happen.
    const baseline = "ffmpeg N-124278-gcc3ca17127-20260430";
    const otherBaseline = "ffmpeg N-100000-gOLD0000000-20260318";
    expect(compareFfmpegVersionToEpoch(baseline, otherBaseline)).toBe("post");
  });

  it("returns 'unknown' when neither side parses as a date or release", () => {
    const noDate = "ffmpeg 12345678-no-date-stamp";
    const noVersion = "garbage with no version info";
    expect(compareFfmpegVersionToEpoch(noVersion, noDate)).toBe("unknown");
  });

  /* ── release-date lookup path ──────────────────────────── */

  const releaseDates = {
    "8.0.1": "2025-11-20",
    "8.0": "2025-08-22",
    "7.1.2": "2025-09-14",
    "7.1": "2024-09-30",
    "4.4.7": "2026-05-05",
  };

  it("uses the release-date lookup for day-precision against a nightly", () => {
    // Homebrew 8.0.1 (released 2025-11-20) vs baseline nightly built
    // 2026-04-30 → released BEFORE the baseline, "pre" with day
    // precision (better than the year fallback's "pre" verdict).
    const userRelease =
      "ffmpeg version 8.0.1 Copyright (c) 2000-2025 the FFmpeg developers";
    const baseline = "ffmpeg N-124278-gcc3ca17127-20260430";
    expect(
      compareFfmpegVersionToEpoch(userRelease, baseline, {
        releaseDates,
      }),
    ).toBe("pre");
  });

  it("uses the release-date lookup symmetrically (nightly vs tagged)", () => {
    const userNightly = "ffmpeg N-124278-gcc3ca17127-20260430";
    const baselineRelease =
      "ffmpeg version 8.0.1 Copyright (c) 2000-2025 the FFmpeg developers";
    expect(
      compareFfmpegVersionToEpoch(userNightly, baselineRelease, {
        releaseDates,
      }),
    ).toBe("post");
  });

  it("uses release dates to compare two tagged releases at day precision", () => {
    // 8.0.1 (2025-11-20) is after 7.1.2 (2025-09-14) — same year so
    // year fallback would say "unknown", but the lookup resolves it.
    const newer = "ffmpeg version 8.0.1 Copyright (c) 2000-2025";
    const older = "ffmpeg version 7.1.2 Copyright (c) 2000-2025";
    expect(
      compareFfmpegVersionToEpoch(newer, older, {
        releaseDates,
      }),
    ).toBe("post");
  });

  it("falls back to year/semver when a release isn't in the lookup map", () => {
    const partialMap = { "8.0.1": "2025-11-20" };
    // 4.4.0 isn't in partialMap. With copyright stamps that differ in
    // year, the year fallback still resolves it.
    const user = "ffmpeg version 4.4.0 Copyright (c) 2000-2021";
    const baseline = "ffmpeg N-100000-gabc-20260318";
    expect(
      compareFfmpegVersionToEpoch(user, baseline, {
        releaseDates: partialMap,
      }),
    ).toBe("pre");
  });

  it("falls back to semver when neither tag is in the lookup map", () => {
    expect(
      compareFfmpegVersionToEpoch("ffmpeg 4.4.0", "ffmpeg 5.0.0", {
        releaseDates: {},
      }),
    ).toBe("pre");
  });

  it("accepts a two-segment version when the patch entry is missing", () => {
    // Version string just says "7.1" (no patch). Map has "7.1" key.
    const user = "ffmpeg version 7.1 Copyright (c) 2000-2024";
    const baseline = "ffmpeg N-100000-gabc-20260318";
    expect(
      compareFfmpegVersionToEpoch(user, baseline, {
        releaseDates,
      }),
    ).toBe("pre");
  });
});

describe("describeFfmpegVersion", () => {
  const releaseDates = {
    "8.0.1": "2025-11-20",
    "8.0": "2025-08-22",
    "7.1.2": "2025-09-14",
    "7.1": "2024-09-30",
    "7.1.4": "2026-05-05",
    "8.1": "2026-03-16",
    "4.4": "2021-04-08",
  };

  it("returns kind='unknown' for empty / null inputs", () => {
    expect(describeFfmpegVersion(null)).toEqual({
      kind: "unknown",
      rawVersion: "",
    });
    expect(describeFfmpegVersion("")).toEqual({
      kind: "unknown",
      rawVersion: "",
    });
    expect(describeFfmpegVersion("garbage no version")).toMatchObject({
      kind: "unknown",
    });
  });

  it("recognises a tagged release with date from the lookup map", () => {
    const v =
      "ffmpeg version 8.0.1 Copyright (c) 2000-2025 the FFmpeg developers";
    const d = describeFfmpegVersion(v, releaseDates);
    expect(d).toEqual({
      kind: "release",
      rawVersion: v,
      releaseTag: "8.0.1",
      date: "2025-11-20",
    });
  });

  it("recognises a tagged release with no date when not in the map", () => {
    const d = describeFfmpegVersion("ffmpeg version 6.0.0", releaseDates);
    expect(d).toMatchObject({
      kind: "release",
      releaseTag: "6.0.0",
      date: null,
    });
  });

  it("resolves a two-segment version against the short-key in the map", () => {
    // "ffmpeg version 7.1" → look up "7.1" (no patch), which is in the map.
    const d = describeFfmpegVersion("ffmpeg version 7.1", releaseDates);
    expect(d).toMatchObject({
      kind: "release",
      releaseTag: "7.1",
      date: "2024-09-30",
    });
  });

  it("recognises a BtbN nightly N-build and dates it", () => {
    const v = "ffmpeg N-124278-gcc3ca17127-20260430";
    const d = describeFfmpegVersion(v, releaseDates);
    expect(d).toMatchObject({
      kind: "nightly",
      rawVersion: v,
      buildDate: "2026-04-30",
    });
  });

  it("annotates a nightly with the latest release at-or-before the build date", () => {
    // 2026-04-30 nightly: the latest release ≤ that date is 8.1
    // (2026-03-16). 7.1.4 (2026-05-05) is AFTER, so it doesn't qualify.
    const d = describeFfmpegVersion(
      "ffmpeg N-124278-gcc3ca17127-20260430",
      releaseDates,
    );
    expect(d.kind).toBe("nightly");
    if (d.kind === "nightly") {
      expect(d.nearestRelease).toEqual({ version: "8.1", date: "2026-03-16" });
    }
  });

  it("works without a release-dates map (nearestRelease=null)", () => {
    const d = describeFfmpegVersion("ffmpeg N-124278-gcc3ca17127-20260430");
    expect(d).toMatchObject({
      kind: "nightly",
      buildDate: "2026-04-30",
      nearestRelease: null,
    });
  });
});
