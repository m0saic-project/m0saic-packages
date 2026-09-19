/**
 * Process-wide fallback for the ffmpeg / ffprobe binaries.
 *
 * # Why this exists
 *
 * Every probe and spawn helper takes an optional `ffmpegPath` and falls back
 * to the bare name `"ffmpeg"` — i.e. to PATH. That default is wrong for the
 * m0saic CLI's most common install: `m0saic setup` puts the pinned toolchain
 * in `~/m0saic/toolchains/…` and **never touches PATH**. A host that resolved
 * the toolchain correctly can still lose it the moment one call site forgets
 * to thread the path down, and the failure is invisible — the spawn ENOENTs,
 * a `catch` somewhere degrades, and the run reports success.
 *
 * That already happened: the free-tier QR stamp's image branch omitted
 * `ffmpegPath` on its luminance probe, so every free-tier image render on a
 * machine without PATH ffmpeg shipped **unstamped** and exited 0.
 *
 * A host registers its resolved binaries once at startup; from then on the
 * bare-name fallback is the LAST resort, not the first. Forgetting to thread
 * the path costs you nothing, which is the point — the safe thing is what
 * happens when you do nothing.
 *
 * # What this is NOT
 *
 * It is not toolchain *resolution*, and it must never be consulted by the
 * resolution/detection path itself (`probe.ts`). "Is there a usable ffmpeg on
 * PATH?" is the question `m0saic setup` asks to decide whether it needs to
 * download anything; answering it with a previously-registered binary would
 * be circular. Those probes keep their bare-name default on purpose.
 */

type ToolchainBinaries = { ffmpegPath?: string; ffprobePath?: string };

let registered: ToolchainBinaries = {};

/**
 * Register the host's resolved binaries. Call once, as early as possible —
 * before any render, probe, or post-render wrap.
 *
 * Passing `undefined` for either leaves that binary on the bare-name default.
 */
export function setDefaultToolchainBinaries(paths: ToolchainBinaries): void {
  registered = {
    ...(paths.ffmpegPath ? { ffmpegPath: paths.ffmpegPath } : {}),
    ...(paths.ffprobePath ? { ffprobePath: paths.ffprobePath } : {}),
  };
}

/** Clear the registration. For tests, and for hosts that switch toolchains. */
export function resetDefaultToolchainBinaries(): void {
  registered = {};
}

/** What is registered right now. Mostly for diagnostics + tests. */
export function getDefaultToolchainBinaries(): Readonly<ToolchainBinaries> {
  return { ...registered };
}

/**
 * The ffmpeg binary a call site should spawn.
 *
 * `explicit` always wins — an argument the caller actually passed is a
 * deliberate choice (a test pinning a build, a host overriding per-render).
 * Otherwise the registered binary, otherwise bare `"ffmpeg"` (PATH).
 */
export function resolveFfmpegPath(explicit?: string): string {
  return explicit ?? registered.ffmpegPath ?? "ffmpeg";
}

/** The ffprobe binary a call site should spawn. See {@link resolveFfmpegPath}. */
export function resolveFfprobePath(explicit?: string): string {
  return explicit ?? registered.ffprobePath ?? "ffprobe";
}
