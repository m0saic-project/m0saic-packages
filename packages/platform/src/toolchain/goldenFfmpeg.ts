// Golden-toolchain resolver for the visual-golden test harnesses (core
// __tests__, dsl-visual-tests, dictionary/visual-tests) and the
// goldens:status tooling. Pixel goldens are a function of (code, toolchain),
// so golden minting/comparison must run the PINNED golden-slot binary for
// this platform — never whatever ffmpeg happens to be in PATH (on the macOS
// dev machine PATH is typically a homebrew build, not the pinned
// martin-riedl slot).
//
// Lives in platform (not core, not cli) deliberately: dsl-visual-tests and
// dictionary are public packages that must not import the private tiers, and
// the CLI's own resolver (packages/cli/src/utils/toolchainConfig.ts) layers
// config/env/PATH fallbacks that a golden harness must NOT inherit — a PATH
// fallback is precisely the bug this resolver exists to prevent.

import * as fs from "fs";
import {
  getGoldenFfmpegBinaryPath,
  getGoldenFfprobeBinaryPath,
} from "../paths";
import { ffmpegBaseline, resolveFfmpegBaseline } from "./ffmpeg";
import type { FfmpegBaselineRef } from "./ffmpeg";
import { probeFfmpegRuntime } from "./probe";
import type { FfmpegRuntime } from "./probe";

/**
 * The per-platform golden-slot directory name (dual-platform-goldens plan):
 * pixel goldens live under `__goldens__/<suite>/<slot>/`, each set minted by
 * that platform's pinned toolchain. Only the two dev platforms have golden
 * sets; anything else has nothing to validate against.
 */
export function goldenPlatformSlot(): "win32" | "darwin" {
  const p = process.platform;
  if (p === "win32" || p === "darwin") return p;
  throw new Error(
    `Unsupported golden platform "${p}" — pixel goldens exist for win32 and darwin only.`,
  );
}

export type GoldenFfmpegResolution =
  | {
      ok: true;
      ffmpegPath: string;
      ffprobePath: string;
      baseline: FfmpegBaselineRef;
      runtime: FfmpegRuntime;
    }
  | {
      ok: false;
      reason: "slot-missing" | "probe-failed" | "snapshot-mismatch";
      /** Human-readable, actionable — harnesses throw this verbatim. */
      message: string;
      baseline: FfmpegBaselineRef;
      ffmpegPath: string;
      runtime?: FfmpegRuntime;
    };

/**
 * Resolve the pinned golden-slot ffmpeg for this platform and verify its
 * identity against the platform baseline (snapshot + profile). Never
 * consults PATH. `probe` / `exists` / `platformKey` are test seams;
 * production callers pass nothing.
 */
export function resolveGoldenFfmpeg(opts?: {
  platformKey?: string;
  probe?: (ffmpegPath: string) => FfmpegRuntime;
  exists?: (p: string) => boolean;
}): GoldenFfmpegResolution {
  const baseline = resolveFfmpegBaseline(opts?.platformKey);
  const variant = baseline.profile;
  const m0saicVersion = ffmpegBaseline.m0saicVersion;
  const ffmpegPath = getGoldenFfmpegBinaryPath(m0saicVersion, variant);
  const ffprobePath = getGoldenFfprobeBinaryPath(m0saicVersion, variant);

  const exists = opts?.exists ?? fs.existsSync;
  if (!exists(ffmpegPath)) {
    return {
      ok: false,
      reason: "slot-missing",
      baseline,
      ffmpegPath,
      message:
        `Golden ffmpeg slot not installed: ${ffmpegPath}\n` +
        `Expected the pinned ${variant.toUpperCase()} toolchain ` +
        `(${baseline.snapshot}, ${baseline.source}).\n` +
        `Install it with: m0saic setup (variant "${variant}"). ` +
        `Golden tests never fall back to PATH ffmpeg.`,
    };
  }

  const probe = opts?.probe ?? probeFfmpegRuntime;
  const runtime = probe(ffmpegPath);
  if (!runtime.found) {
    return {
      ok: false,
      reason: "probe-failed",
      baseline,
      ffmpegPath,
      runtime,
      message:
        `Golden ffmpeg exists but failed to run: ${ffmpegPath}\n` +
        `Reinstall the pinned toolchain with: m0saic setup (variant "${variant}").`,
    };
  }

  if (!runtime.version.includes(baseline.snapshot)) {
    return {
      ok: false,
      reason: "snapshot-mismatch",
      baseline,
      ffmpegPath,
      runtime,
      message:
        `Golden ffmpeg at ${ffmpegPath} is not the pinned baseline build.\n` +
        `  expected snapshot: ${baseline.snapshot} (${baseline.source})\n` +
        `  probed version:    ${runtime.version}\n` +
        `Reinstall the pinned toolchain with: m0saic setup (variant "${variant}").`,
    };
  }

  return { ok: true, ffmpegPath, ffprobePath, baseline, runtime };
}
