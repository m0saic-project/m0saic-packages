import baselineJson from "./baseline.json";
import releaseDatesFile from "./release-dates.json";

/**
 * One profile entry inside `baseline.json` (`ffmpeg` or `ffmpegGpl`).
 * Mirrors the JSON exactly — see baseline.json for the source of truth.
 */
export interface FfmpegBuildEntry {
  snapshot: string;
  date: string;
  source: string;
  binarySource: string;
  profile: string;
  gplEnabled: boolean;
  libx264: boolean;
  libx265: boolean;
  btbnReleaseTag: string;
  btbnReleaseUrl: string;
  retentionNote: string;
  features: {
    av1: boolean;
    nvenc: boolean;
    vaapi: boolean;
  };
}

/** One downloadable archive inside a platform target. */
export interface FfmpegArtifact {
  /** Which tools this archive provides (BtbN archives carry both; martin-riedl ships one per zip). */
  tools: Array<"ffmpeg" | "ffprobe">;
  archive: "zip" | "tar.xz";
  /** Preferred download URL (the m0saic-ffmpeg-base mirror for vendored LGPL builds). */
  url: string;
  /** Origin fallback when the mirror asset isn't published yet (or is unreachable). */
  upstreamUrl?: string;
  /** Pinned hex digest — downloads that don't hash to this are rejected. */
  sha256: string;
}

/** A concrete, installable build target for one platform-arch + variant. */
export interface FfmpegPlatformTarget {
  available: true;
  snapshot: string;
  date: string;
  profile: "lgpl" | "gpl";
  source: string;
  /** True when the binaries are served from m0saic-ffmpeg-base releases. */
  vendored: boolean;
  /** True when m0saic may ship the binaries inside its own bundles. */
  redistributable: boolean;
  infoUrl: string;
  licenseNote: string;
  artifacts: FfmpegArtifact[];
}

/** A platform-arch + variant with no installable build (documented gap). */
export interface FfmpegPlatformGap {
  available: false;
  reason: string;
  trackingUrl?: string;
}

export type FfmpegPlatformEntry = FfmpegPlatformTarget | FfmpegPlatformGap;

/** Per-platform variant map: `platforms["darwin-arm64"].gpl` etc. */
export interface FfmpegPlatformVariants {
  lgpl: FfmpegPlatformEntry;
  gpl: FfmpegPlatformEntry;
}

/** The standalone vendor repo that mirrors LGPL binaries + source. */
export interface FfmpegVendorRepo {
  name: string;
  url: string;
  releaseTag: string;
  note: string;
}

/**
 * Full shape of `baseline.json`. Declared as an interface (not
 * `typeof baselineJson`) so the emitted `.d.ts` doesn't carry the
 * `import "./baseline.json"` through to downstream consumers —
 * otherwise every dependent package would need
 * `resolveJsonModule: true` in its tsconfig.
 */
export interface FfmpegBaseline {
  m0saicVersion: string;
  ffmpeg: FfmpegBuildEntry;
  ffmpegGpl: FfmpegBuildEntry;
  vendorRepo: FfmpegVendorRepo;
  platforms: Record<string, FfmpegPlatformVariants>;
}

export const ffmpegBaseline: FfmpegBaseline =
  baselineJson as unknown as FfmpegBaseline;

export function getFfmpegBaseline(): FfmpegBaseline {
  return ffmpegBaseline;
}

/** `${process.platform}-${arch}` key used by the `platforms` manifest map. */
export function getPlatformKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return `${platform}-${arch}`;
}

/**
 * Resolve the manifest entry for a platform-arch + variant. Unknown
 * platform keys resolve to a synthetic gap entry (never undefined) so
 * callers have one shape to branch on.
 */
export function getFfmpegPlatformEntry(
  variant: "lgpl" | "gpl",
  platformKey: string = getPlatformKey(),
): FfmpegPlatformEntry {
  const variants = ffmpegBaseline.platforms[platformKey];
  if (!variants) {
    return {
      available: false,
      reason: `No pinned ffmpeg target for platform "${platformKey}".`,
      trackingUrl: ffmpegBaseline.vendorRepo.url,
    };
  }
  return variants[variant];
}

/**
 * The baseline the runtime FFmpeg is compared against (snapshot + capability).
 * Matches the `baseline` block written into `_toolchain.json` and the render
 * report's `versions.ffmpeg.baseline`.
 */
export interface FfmpegBaselineRef {
  snapshot: string;
  profile: "lgpl" | "gpl";
  libx264: boolean;
  source: string;
}

/**
 * Resolve the FFmpeg baseline for a platform.
 *
 * m0saic's baseline is a *per-platform target*, not one global snapshot: the
 * pinned build differs by OS (Windows/Linux pin the BtbN build; macOS pins the
 * martin-riedl build one commit later).
 *
 * Picks the first *available* variant in preference order — `gpl` FIRST
 * (founder ruling 2026-07-19: the official m0saic baseline is the pinned GPL
 * build on every platform — x264/x265 are the standard; a runtime without
 * them is degraded) then `lgpl` (kept for the future bundled/mirrored case).
 * `libx264` is derived from the profile (libx264 is GPL-only, so it tracks the
 * `gpl` profile exactly). Falls back to the top-level build entry for platforms
 * with no pinned target (e.g. Intel macOS).
 */
export function resolveFfmpegBaseline(
  platformKey: string = getPlatformKey(),
): FfmpegBaselineRef {
  for (const variant of ["gpl", "lgpl"] as const) {
    const entry = getFfmpegPlatformEntry(variant, platformKey);
    if (entry.available) {
      return {
        snapshot: entry.snapshot,
        profile: entry.profile,
        libx264: entry.profile === "gpl",
        source: entry.source,
      };
    }
  }
  const bl = ffmpegBaseline.ffmpeg;
  return {
    snapshot: bl.snapshot,
    profile: bl.profile === "gpl" ? "gpl" : "lgpl",
    libx264: bl.libx264,
    source: bl.source,
  };
}

/**
 * Tagged-release → release date (committer date of the tag).
 *
 * Source of truth: `git for-each-ref refs/tags/n*` against
 * github.com/FFmpeg/FFmpeg. Regenerated periodically via
 * `packages/platform/scripts/refresh-ffmpeg-release-dates.sh`. Keys are
 * the version exactly as ffmpeg prints it (e.g. "8.0.1", "7.1",
 * "6.1.3") — the leading "n" git prefix is stripped so callers can
 * look up by the user-visible version string.
 *
 * Used by `compareFfmpegVersionToEpoch` (../probe) to give tagged
 * releases day-precision dates instead of falling back to copyright-year.
 */
export const ffmpegReleaseDates: Readonly<Record<string, string>> =
  releaseDatesFile.releases as Readonly<Record<string, string>>;

export interface FfmpegReleaseDatesMeta {
  generatedAt: string;
  source: string;
  releases: Readonly<Record<string, string>>;
}

export const ffmpegReleaseDatesMeta: FfmpegReleaseDatesMeta = {
  generatedAt: releaseDatesFile._generatedAt,
  source: releaseDatesFile._source,
  releases: ffmpegReleaseDates,
};
