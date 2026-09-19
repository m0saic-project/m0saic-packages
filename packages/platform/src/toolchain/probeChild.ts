/**
 * One spawn path for every ffmpeg / ffprobe PROBE child (media metadata,
 * luminance, subtitle cues …): sanitized env, live-child tracking (so a
 * host signal handler kills it — see `liveChildren.ts`), bounded stdout /
 * stderr capture, and a wall-clock timeout with SIGTERM → SIGKILL
 * escalation.
 *
 * A probe is short by nature (a local ffprobe finishes in milliseconds), so
 * a probe that runs for a minute is stuck — a FIFO, a blocking network
 * mount, a stalled http(s) server (ffprobe's http reader has no default read
 * timeout). Without a cap the host hangs at plan time with no render to
 * cancel; with it the probe fails as `PROBE_TIMEOUT` and the caller reports
 * a clear error.
 */
import { spawn } from "child_process";
import { sanitizedFfmpegEnv } from "./childEnv";
import { killChildWithEscalation, trackLiveChild } from "./liveChildren";

/** Default wall-clock cap for a probe child. `timeoutMs: 0` disables it. */
export const DEFAULT_PROBE_TIMEOUT_MS = 60_000;

/** Stable error code for a probe that hit its wall-clock cap. */
export const PROBE_TIMEOUT = "PROBE_TIMEOUT";

/** Thrown (or embedded in stderr) when a probe child hits its timeout. */
export class ProbeTimeoutError extends Error {
  readonly code = PROBE_TIMEOUT;
  readonly tool: string;
  readonly timeoutMs: number;
  constructor(tool: string, timeoutMs: number, detail?: string) {
    super(
      `${PROBE_TIMEOUT}: ${tool} timed out after ${timeoutMs}ms (killed)` +
        (detail ? `\n${detail}` : ""),
    );
    this.name = "ProbeTimeoutError";
    this.tool = tool;
    this.timeoutMs = timeoutMs;
  }
}

export type ProbeChildOptions = {
  /** Working directory for the child. */
  cwd?: string;
  /**
   * Wall-clock cap in ms (default {@link DEFAULT_PROBE_TIMEOUT_MS}; `0` or a
   * negative value disables). On expiry the child is killed (SIGTERM →
   * SIGKILL after the grace period) and the result carries `timedOut`.
   */
  timeoutMs?: number;
  /** Grace between SIGTERM and SIGKILL on timeout (test hook). */
  killGraceMs?: number;
  /** Human label for messages (default: the binary's basename). */
  tool?: string;
};

export type ProbeChildResult = {
  stdout: string;
  stderr: string;
  /** Exit code; `-1` when the child could not start, was killed, or timed out. */
  code: number;
  /** True when the child was killed by the timeout. */
  timedOut: boolean;
  /** Set when the child could not be spawned (ENOENT, EACCES …). */
  spawnError?: Error;
};

function resolveTimeoutMs(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_PROBE_TIMEOUT_MS;
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
}

/**
 * Spawn `bin argv` as a tracked probe child and collect its output. Never
 * rejects: a spawn failure resolves with `code: -1` and `spawnError`, a
 * timeout resolves with `code: -1`, `timedOut: true` and a
 * `PROBE_TIMEOUT` line at the head of `stderr`.
 */
export function runProbeChild(
  bin: string,
  argv: readonly string[],
  opts?: ProbeChildOptions,
): Promise<ProbeChildResult> {
  const timeoutMs = resolveTimeoutMs(opts?.timeoutMs);
  const tool = opts?.tool ?? bin.split(/[\\/]/).pop() ?? bin;
  return new Promise<ProbeChildResult>((resolve) => {
    const child = spawn(bin, [...argv], {
      cwd: opts?.cwd,
      env: sanitizedFfmpegEnv(),
    });
    trackLiveChild(child);

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let spawnError: Error | undefined;
    let settled = false;

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            void killChildWithEscalation(child, opts?.killGraceMs);
          }, timeoutMs)
        : undefined;
    timer?.unref?.();

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (timedOut) {
        const err = new ProbeTimeoutError(tool, timeoutMs);
        stderr = err.message + (stderr ? `\n${stderr}` : "");
      }
      resolve({
        stdout,
        stderr,
        code: timedOut || spawnError ? -1 : (code ?? -1),
        timedOut,
        ...(spawnError ? { spawnError } : {}),
      });
    };

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", (err: Error) => {
      spawnError = err;
      // A post-spawn error can arrive while the child is alive — never
      // leave it orphaned. `close` still follows and settles the promise
      // with the streams drained; settle here too in case it never does.
      if (child.exitCode == null && !child.killed) {
        try {
          child.kill();
        } catch {
          /* already gone */
        }
      }
      setImmediate(() => finish(null));
    });
    child.on("close", (code) => finish(code));
  });
}
