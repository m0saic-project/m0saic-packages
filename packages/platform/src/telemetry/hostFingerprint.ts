import * as os from "os";
import type { MosaicHostFingerprint, MosaicHostOs } from "@m0saic/types";
import { versionMajorMinor } from "./renderRecord";

/** Floor a Node platform string into the coarse analytics OS bucket. */
export const toMosaicHostOs = (platform: string): MosaicHostOs => {
  switch (platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    default:
      return "other";
  }
};

/**
 * Coarse, bounded-cardinality host fingerprint for analytics events.
 * Versions are floored to major.minor (full semver accepted); platform
 * and arch default to the current process and are injectable for tests.
 */
export function buildHostFingerprint(opts: {
  mosaicVersion: string;
  ffmpegVersion?: string;
  platform?: string;
  arch?: string;
}): MosaicHostFingerprint {
  const ffmpeg = versionMajorMinor(opts.ffmpegVersion);
  return {
    os: toMosaicHostOs(opts.platform ?? os.platform()),
    arch: opts.arch ?? os.arch(),
    mosaicVersion: versionMajorMinor(opts.mosaicVersion) ?? "0.0",
    ...(ffmpeg !== undefined ? { ffmpegVersion: ffmpeg } : {}),
  };
}
