import type { FfmpegRuntime, FfprobeRuntime } from "./probe";
import { probeFfmpegRuntime, probeFfprobeRuntime } from "./probe";
import { resolveFfmpegBaseline } from "./ffmpeg";
import * as fs from "fs";
import * as path from "path";

export type ToolchainMetadata = {
  ffmpeg: {
    baseline: {
      snapshot: string;
      profile: string;
      libx264: boolean;
      source: string;
    };
    runtime: FfmpegRuntime;
  };
  ffprobe: {
    runtime: FfprobeRuntime;
  };
};

export type ToolchainSidecar = {
  schemaVersion: 1;
  toolchain: ToolchainMetadata;
};

export function buildToolchainMetadata(opts?: {
  ffmpegPath?: string;
  ffprobePath?: string;
}): ToolchainMetadata {
  // Baseline is the pinned target for *this* platform (GPL everywhere —
  // the official m0saic baseline; see resolveFfmpegBaseline), not the
  // top-level entry — otherwise macOS falsely reports a version mismatch
  // against the Windows snapshot.
  const bl = resolveFfmpegBaseline();
  return {
    ffmpeg: {
      baseline: {
        snapshot: bl.snapshot,
        profile: bl.profile,
        libx264: bl.libx264,
        source: bl.source,
      },
      runtime: probeFfmpegRuntime(opts?.ffmpegPath),
    },
    ffprobe: {
      runtime: probeFfprobeRuntime(opts?.ffprobePath),
    },
  };
}

export function buildToolchainSidecar(opts?: {
  ffmpegPath?: string;
  ffprobePath?: string;
}): ToolchainSidecar {
  return {
    schemaVersion: 1,
    toolchain: buildToolchainMetadata(opts),
  };
}

export function serializeToolchainSidecar(sidecar: ToolchainSidecar): string {
  return JSON.stringify(sidecar, null, 2) + "\n";
}

export function formatToolchainSummary(metadata: ToolchainMetadata): string {
  const bl = metadata.ffmpeg.baseline;
  const x264 = bl.libx264 ? "x264=true" : "x264=false";
  return `ffmpeg ${bl.snapshot} (${bl.profile}, ${x264})`;
}

/**
 * Write _toolchain.json to a directory. Safe to call multiple times per
 * process — tracks which directories have already been written.
 */
const written = new Set<string>();
export function writeToolchainSidecar(dir: string, opts?: {
  ffmpegPath?: string;
  ffprobePath?: string;
}): void {
  const resolved = path.resolve(dir);
  if (written.has(resolved)) return;
  written.add(resolved);
  const sidecar = buildToolchainSidecar(opts);
  fs.mkdirSync(resolved, { recursive: true });
  fs.writeFileSync(
    path.join(resolved, "_toolchain.json"),
    serializeToolchainSidecar(sidecar),
    "utf8",
  );
}
