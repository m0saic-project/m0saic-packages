import { execFileSync } from "child_process";
import { sanitizedFfmpegEnv } from "./childEnv";
import { DEFAULT_PROBE_TIMEOUT_MS } from "./probeChild";

/**
 * Wall-clock cap on the synchronous toolchain probes (`ffmpeg -version`,
 * `-encoders`, `-filters`, `-h long`, `ffprobe -version`). They answer in
 * milliseconds; a binary that hangs (a wedged shim on PATH, a network
 * mount) must not block the host forever. On expiry `execFileSync` kills
 * the child (SIGKILL — a sync child cannot be escalated) and the probe
 * reports "not found" / `null`, the same as a missing binary.
 */
export const SYNC_PROBE_TIMEOUT_MS = DEFAULT_PROBE_TIMEOUT_MS;

/** Lean version-only probe result (no encoder/filter spawns). */
export type FfmpegVersionInfo = {
  found: boolean;
  version: string;
  /**
   * libavfilter major version, parsed from the `libavfilter X.Y.Z` line of
   * `ffmpeg -version`. Present on every ffmpeg build (tagged AND nightly), so
   * it's the primary capability signal for feature gating (unlike the tagged
   * `x.y` release, which N-nightlies omit). `null` when the line is absent /
   * the probe failed. Reference points: ffmpeg 7.0/7.1 → libavfilter 10;
   * ffmpeg 8.0 → libavfilter 11.
   */
  libavfilterMajor: number | null;
};

/** Full runtime probe: the lean version info plus encoder capabilities. */
export type FfmpegRuntime = FfmpegVersionInfo & {
  libx264: boolean | null;
  /**
   * Optional: if probeFfmpegRuntime is called with `extraEncoders`, the result
   * for each requested encoder name appears here. `null` indicates the probe
   * itself failed; otherwise true/false reflects presence in `ffmpeg -encoders`.
   */
  encoders?: Record<string, boolean | null>;
};

export type FfprobeRuntime = {
  found: boolean;
  version: string;
};

/**
 * Run `ffmpeg <flag>` once and return stdout, or `null` if the invocation
 * fails (binary missing / non-zero exit). Shared spawn + catch behind the
 * list-style probes so they can't drift.
 */
function probeFfmpegList(
  args: readonly string[],
  ffmpegPath?: string,
): string | null {
  try {
    return execFileSync(ffmpegPath ?? "ffmpeg", [...args], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      env: sanitizedFfmpegEnv(),
      timeout: SYNC_PROBE_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
  } catch {
    return null;
  }
}

/**
 * Run `ffmpeg -encoders` once and check for each requested name. Returns
 * `null` for every requested name if the invocation fails. Names are matched
 * via simple substring on the output (matches existing libx264 detection).
 */
export function detectRuntimeEncoders(
  names: readonly string[],
  ffmpegPath?: string,
): Record<string, boolean | null> {
  const result: Record<string, boolean | null> = {};
  const out = probeFfmpegList(["-encoders"], ffmpegPath);
  if (out === null) {
    for (const n of names) result[n] = null;
    return result;
  }
  for (const n of names) result[n] = out.includes(n);
  return result;
}

/**
 * Detect whether the ffmpeg CLI accepts a given global option (e.g.
 * `-filter_buffered_frames`), by scanning `ffmpeg -h long` for the flag as a
 * whole token. Returns `null` when the probe fails (binary missing / error).
 *
 * This is a DIRECT capability check — used as a tiebreak when the libavfilter
 * major version is ambiguous (the library soname bumps at the start of a dev
 * cycle, but an fftools option can land later inside it). The library version
 * alone can't distinguish those mid-cycle nightlies.
 */
export function detectFfmpegCliOption(
  name: string,
  ffmpegPath?: string,
): boolean | null {
  const out = probeFfmpegList(["-h", "long"], ffmpegPath);
  if (out === null) return null;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `-h long` lists options one per (indented) line: match the flag as a whole
  // token — leading whitespace/line-start, then whitespace/line-end after it.
  return new RegExp(`(^|\\s)${esc}(\\s|$)`, "m").test(out);
}

function detectRuntimeLibx264(ffmpegPath?: string): boolean | null {
  return detectRuntimeEncoders(["libx264"], ffmpegPath).libx264 ?? null;
}

/**
 * Run `ffmpeg -filters` once and check for each requested filter NAME.
 * Returns `null` for every name if the invocation fails.
 *
 * Unlike {@link detectRuntimeEncoders} this does NOT use a naive substring
 * test: `ffmpeg -filters` lists one filter per line as
 * `" <flags> <name>  <in>-><out>  <desc>"`, and a short name like `eq` occurs
 * as a substring inside unrelated descriptions ("frequency", "Adjust … gamma")
 * and other filter names. We match the NAME column specifically — leading
 * flags token, whitespace, the exact name, then whitespace.
 */
export function detectRuntimeFilters(
  names: readonly string[],
  ffmpegPath?: string,
): Record<string, boolean | null> {
  const result: Record<string, boolean | null> = {};
  const out = probeFfmpegList(["-filters"], ffmpegPath);
  if (out === null) {
    for (const n of names) result[n] = null;
    return result;
  }
  for (const n of names) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result[n] = new RegExp(`^\\s*\\S{1,3}\\s+${esc}\\s`, "m").test(out);
  }
  return result;
}

function firstLine(output: string): string {
  return (output.split(/\r?\n/)[0] ?? "").trim();
}

/** Parse the libavfilter major version from full `ffmpeg -version` output. */
function parseLibavfilterMajor(versionOutput: string): number | null {
  const m = versionOutput.match(/^libavfilter\s+(\d+)\./m);
  return m ? Number(m[1]) : null;
}

/**
 * Lean probe: runs ONLY `ffmpeg -version` (no `-encoders` / `-filters`
 * spawns). Returns the first line + parsed libavfilter major. Used by the
 * exec-time filter-file capability gate, which must not pay for encoder
 * detection it never reads.
 */
export function probeFfmpegVersion(ffmpegPath?: string): FfmpegVersionInfo {
  const out = probeFfmpegList(["-version"], ffmpegPath);
  if (out === null) {
    return { found: false, version: "not found", libavfilterMajor: null };
  }
  return {
    found: true,
    version: firstLine(out),
    libavfilterMajor: parseLibavfilterMajor(out),
  };
}

export function probeFfmpegRuntime(
  ffmpegPath?: string,
  options?: { extraEncoders?: readonly string[] },
): FfmpegRuntime {
  const info = probeFfmpegVersion(ffmpegPath);
  if (!info.found) return { ...info, libx264: null };
  if (options?.extraEncoders && options.extraEncoders.length > 0) {
    const names = Array.from(
      new Set<string>(["libx264", ...options.extraEncoders]),
    );
    const encoders = detectRuntimeEncoders(names, ffmpegPath);
    return { ...info, libx264: encoders.libx264 ?? null, encoders };
  }
  return { ...info, libx264: detectRuntimeLibx264(ffmpegPath) };
}

export function probeFfprobeRuntime(ffprobePath?: string): FfprobeRuntime {
  try {
    const bin = ffprobePath ?? "ffprobe";
    const out = execFileSync(bin, ["-version"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      env: sanitizedFfmpegEnv(),
      timeout: SYNC_PROBE_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    return { found: true, version: firstLine(out) };
  } catch {
    return { found: false, version: "not found" };
  }
}


/* ------------------------------------------------------------------ */
/*  Version comparison + description — re-exported from the pure       */
/*  versionCompare module so callers can import either path. The web   */
/*  app must import the pure module directly                            */
/*  (`@m0saic/platform/toolchain/versionCompare`) to avoid pulling      */
/*  child_process into the bundle.                                     */
/* ------------------------------------------------------------------ */

export {
  compareFfmpegVersionToEpoch,
  describeFfmpegVersion,
  parseFfmpegMajorVersion,
} from "./versionCompare";
export type {
  EpochVerdict,
  EpochCompareOptions,
  FfmpegVersionDescription,
} from "./versionCompare";
