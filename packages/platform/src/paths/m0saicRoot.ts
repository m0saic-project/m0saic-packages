import * as os from "os";
import * as path from "path";
import * as fs from "fs";

const ENV_OVERRIDE = "M0SAIC_ROOT";
const ROOT_DIRNAME = "m0saic";

export function getM0saicRoot(): string {
  const override = process.env[ENV_OVERRIDE];
  if (override && override.trim() !== "") {
    return path.resolve(override.trim());
  }
  return path.join(os.homedir(), ROOT_DIRNAME);
}

export function getToolchainsRoot(): string {
  return path.join(getM0saicRoot(), "toolchains");
}

export function getFfmpegToolchainsRoot(): string {
  return path.join(getToolchainsRoot(), "ffmpeg");
}

export type FfmpegSlotVariant = "lgpl" | "gpl";

export function getGoldenFfmpegSlotDir(
  m0saicVersion: string,
  variant: FfmpegSlotVariant,
): string {
  return path.join(getFfmpegToolchainsRoot(), `${m0saicVersion}-${variant}`);
}

export function getGoldenFfmpegBinaryPath(
  m0saicVersion: string,
  variant: FfmpegSlotVariant,
): string {
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  return path.join(
    getGoldenFfmpegSlotDir(m0saicVersion, variant),
    "bin",
    exe,
  );
}

export function getGoldenFfprobeBinaryPath(
  m0saicVersion: string,
  variant: FfmpegSlotVariant,
): string {
  const exe = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  return path.join(
    getGoldenFfmpegSlotDir(m0saicVersion, variant),
    "bin",
    exe,
  );
}

export function getCustomFfmpegRoot(): string {
  return path.join(getFfmpegToolchainsRoot(), "custom");
}

/**
 * Root for everything Momo (the local AI assistant) owns on disk. Lives
 * under the m0saic data root so it's visible and user-touchable, matching
 * the `~/m0saic/` convention. Holds models, sessions, and (future) caches.
 */
export function getMomoRoot(): string {
  return path.join(getM0saicRoot(), "momo");
}

/**
 * Where downloaded GGUF model files land. One file per quant per model id.
 */
export function getMomoModelsRoot(): string {
  return path.join(getMomoRoot(), "models");
}

/**
 * Resolve an absolute path for a specific GGUF filename under the models
 * root. `filename` is the bare filename from the manifest (no slashes).
 */
export function getMomoModelPath(filename: string): string {
  return path.join(getMomoModelsRoot(), filename);
}

/**
 * Root for the live render feed — the file-based bridge that lets a running
 * Mosaic Desktop (e.g. the Worker 01 Showcase kiosk) mirror renders started
 * by the `m0saic` CLI in a separate process. The app drops a marker here
 * while it's up; the CLI appends render events to the log when the marker
 * exists. Loopback-free (no ports/tokens) by design — fire-and-forget stream.
 */
export function getRenderFeedRoot(): string {
  return path.join(getM0saicRoot(), "render");
}

/** Presence marker written by the desktop app while it can display renders. */
export function getRenderFeedMarkerPath(): string {
  return path.join(getRenderFeedRoot(), "active.json");
}

/** Append-only JSONL the CLI writes render events to; the app tails it. */
export function getRenderFeedLogPath(): string {
  return path.join(getRenderFeedRoot(), "live.jsonl");
}

/**
 * Root for the Community M cache — the app / CLI's local copy of the public
 * `community-m` repo (manifest + tile images + pieces). App-managed and
 * disposable, but deliberately under `~/m0saic/` rather than Electron's
 * userData so the CLI and the `@m0saic/brand/community-m/v1` template can
 * read the same files. `current/` holds the installed tree.
 */
export function getCommunityMRoot(): string {
  return path.join(getM0saicRoot(), "community-m");
}

export function ensureDir(absDir: string): void {
  fs.mkdirSync(absDir, { recursive: true });
}
