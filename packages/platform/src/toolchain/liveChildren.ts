/**
 * Live-child registry + kill escalation, shared by EVERY ffmpeg / ffprobe
 * child m0saic spawns — the render runner in `@m0saic/core` and every
 * probe (media metadata, luminance, subtitle cues, toolchain version).
 *
 * One process-wide registry so a host's signal handler can tear ALL of
 * them down at once (`abortLiveChildren`): a Ctrl-C during the plan-time
 * `ffprobe <asset>` must not orphan that probe (ppid 1) any more than a
 * Ctrl-C mid-render may orphan the ffmpeg encoder.
 *
 * `@m0saic/platform` is the public, core-free layer, so the registry lives
 * here and `@m0saic/core` re-exports it under its engine-facing names
 * (`abortLiveEngineChildren`, `liveEngineChildCount`).
 */
import type { ChildProcess } from "child_process";

/** Grace period between SIGTERM and SIGKILL when stopping a child. */
export const CHILD_KILL_GRACE_MS = 2_000;

const liveChildren = new Set<ChildProcess>();

/**
 * Track a child from spawn to exit. Returns the untrack function (the
 * child is also untracked automatically on `exit` / `error`).
 */
export function trackLiveChild(child: ChildProcess): () => void {
  liveChildren.add(child);
  const untrack = () => {
    liveChildren.delete(child);
  };
  child.once("exit", untrack);
  child.once("error", untrack);
  // A spawn failure (ENOENT) emits `error` then `close` but never `exit`.
  child.once("close", untrack);
  return untrack;
}

/** Number of tracked children currently alive (test / diagnostics hook). */
export function liveChildCount(): number {
  return liveChildren.size;
}

/**
 * True while the child has neither exited nor been signalled. Loose `==`
 * on purpose: a real ChildProcess holds `null` for both before exit; a
 * test double may leave them `undefined`.
 */
export function isChildAlive(child: ChildProcess): boolean {
  return child.exitCode == null && child.signalCode == null;
}

/**
 * Stop one child: SIGTERM, then SIGKILL after `graceMs` if it is still
 * alive. Resolves once the child has exited (or at once when it already
 * has). On Windows `child.kill()` is TerminateProcess either way. Never
 * throws.
 */
export function killChildWithEscalation(
  child: ChildProcess,
  graceMs: number = CHILD_KILL_GRACE_MS,
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!isChildAlive(child)) {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(escalate);
      resolve();
    };
    const escalate = setTimeout(() => {
      if (isChildAlive(child)) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
      // Belt and braces: a child that ignores SIGKILL (zombie / not ours)
      // must not wedge the caller — give the kernel a moment, then move on.
      setTimeout(finish, 500).unref?.();
    }, graceMs);
    escalate.unref?.();
    child.once("exit", finish);
    child.once("close", finish);
    child.once("error", finish);
    try {
      child.kill();
    } catch {
      finish();
    }
  });
}

/**
 * Kill every tracked child (SIGTERM → SIGKILL after 2 s) and wait for all
 * of them to exit. Hosts call this from their SIGINT/SIGTERM handler
 * before removing the workspace and exiting. Idempotent.
 */
export async function abortLiveChildren(): Promise<void> {
  const children = [...liveChildren];
  await Promise.all(children.map((c) => killChildWithEscalation(c)));
}

/** Test hook: forget every tracked child without signalling it. */
export function __resetLiveChildrenForTests(): void {
  liveChildren.clear();
}
