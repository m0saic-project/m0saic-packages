import * as os from "os";
import type { BenchmarkSystemInfo } from "@m0saic/types";
import { probeFfmpegRuntime } from "../toolchain/probe";

/**
 * Hardware video encoders we probe for when reporting a machine's ffmpeg
 * acceleration potential. This is the hardware subset of the canonical
 * `VIDEO_CODECS` list in `@m0saic/types` (`packages/types/src/output/format.ts`)
 * — kept as an explicit local list so we only shell `ffmpeg -encoders` for the
 * names that matter to a benchmark, not every software codec. Keep in sync with
 * the hardware families in that file.
 */
export const HW_VIDEO_ENCODERS = [
  // macOS / iOS (VideoToolbox)
  "h264_videotoolbox",
  "hevc_videotoolbox",
  "prores_videotoolbox",
  // NVIDIA (NVENC)
  "h264_nvenc",
  "hevc_nvenc",
  "av1_nvenc",
  // Intel (Quick Sync Video)
  "h264_qsv",
  "hevc_qsv",
  "av1_qsv",
  "vp9_qsv",
  // AMD (AMF)
  "h264_amf",
  "hevc_amf",
  "av1_amf",
  // Linux generic (VAAPI)
  "h264_vaapi",
  "hevc_vaapi",
  "av1_vaapi",
  "vp9_vaapi",
  "mjpeg_vaapi",
] as const;

function roundGb(bytes: number): number {
  return Math.round((bytes / 1024 ** 3) * 10) / 10;
}

/**
 * Capture host machine specs for a benchmark run. Node-only (reads `os` and
 * shells `ffmpeg`), so this module is intentionally NOT re-exported from the
 * platform root index — import it via `@m0saic/platform/system` from CLI /
 * Electron / template-runner contexts only, never from the web bundle.
 *
 * Values that cannot be determined degrade gracefully (empty model, `null`
 * clock, ffmpeg `found: false`) rather than throwing — mirrors the resilience
 * of the toolchain probes.
 */
export function collectSystemInfo(opts?: {
  ffmpegPath?: string;
}): BenchmarkSystemInfo {
  const cpus = os.cpus() ?? [];
  const first = cpus[0];
  const speedMhz = first && first.speed > 0 ? first.speed : null;
  const totalBytes = os.totalmem();

  const ff = probeFfmpegRuntime(opts?.ffmpegPath, {
    extraEncoders: HW_VIDEO_ENCODERS,
  });
  const encoders = ff.encoders ?? {};
  const hwEncoders = HW_VIDEO_ENCODERS.filter((name) => encoders[name] === true);

  return {
    cpu: {
      model: (first?.model ?? "").trim(),
      cores: cpus.length,
      speedMhz,
    },
    ram: {
      totalBytes,
      totalGb: roundGb(totalBytes),
    },
    os: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
    },
    ffmpeg: {
      found: ff.found,
      version: ff.version,
      hwEncoders,
    },
  };
}
