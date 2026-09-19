/**
 * Classify an ffmpeg non-zero exit into a known failure kind with
 * user-facing summary + suggested mitigations.
 *
 * Goal: turn opaque "ffmpeg exited 4294967284" into something the
 * operator can act on. Hosts (CLI / desktop / web) call this with the
 * captured exit code + stderr tail and surface the result in error
 * messages, sidecar reports, and the UI.
 *
 * Lives in `@m0saic/types` (pure, no `fs` — browser-safe) so ONE
 * implementation serves core AND the web bundle; the result types
 * (FfmpegFailureKind / FfmpegFailureClassification) are the cross-process
 * contract that rides the `command_end` telemetry event. `@m0saic/core`
 * re-exports these for its existing consumers.
 *
 * Detection rules are heuristic — ffmpeg doesn't expose stable error
 * codes for these conditions across versions, so we sniff the exit
 * code and stderr text. False positives are preferable to false
 * negatives here: a wrong hint is still better than a bare code.
 */

import type {
  FfmpegFailureKind,
  FfmpegFailureClassification,
} from "./event";

const ENOMEM_EXIT_CODES = new Set<number>([
  -12,
  // Windows surfaces -12 as the unsigned 32-bit complement.
  4294967284,
  // Some shells report SIGKILL-from-OOM as 137 (128 + 9).
  137,
]);

const CANCEL_EXIT_CODES = new Set<number>([
  // ffmpeg's own clean cancel.
  255,
  // SIGTERM = 128 + 15.
  143,
]);

/**
 * True when ffmpeg's stderr shows it produced at least one frame — i.e. a
 * `frame=<n>` progress report with a non-zero count. This is the load-bearing
 * distinguisher for the link-queue fuse trip: a fuse trip fails mid-render
 * (frames produced) whereas the W1 graph-init cliff fails before any frame.
 *
 * The whole verdict hangs on ffmpeg printing the FINAL `frame=` report to
 * stderr even under `-nostats` (it's INFO-gated) — the R6 integration test
 * asserts that production chain end-to-end.
 *
 * The left boundary `(^|[^\w])` is load-bearing: it must NOT match
 * `end_frame=300` (present in every frozen-frame stroke/rounding hoist and
 * echoed into stderr on init-error paths) — otherwise a genuine W1 graph-init
 * ENOMEM would misclassify as a fuse trip with inverted advice.
 */
export function stderrIndicatesFramesProduced(tail: string): boolean {
  return /(^|[^\w])frame=\s*0*[1-9]\d*/.test(tail);
}

/**
 * Classify a failed ffmpeg run.
 *
 * `exitCode` may be negative (POSIX style), positive small (SIGN+signal),
 * or the unsigned 32-bit representation on Windows — all handled.
 * `stderrTail` should be the last few KB of stderr (the runner already
 * keeps a bounded ring); we only do substring matches.
 */
export function classifyFfmpegFailure(
  exitCode: number | null | undefined,
  stderrTail: string | undefined,
  opts?: {
    /** True when the failing command carried the `-filter_buffered_frames`
     *  fuse (see core bufferGuard.ts). Gates the link-queue-buffer-overflow
     *  classification so a genuine graph-init OOM on a non-fused command
     *  isn't mislabelled. */
    carriedBufferFuse?: boolean;
  },
): FfmpegFailureClassification {
  const tail = (stderrTail ?? "").toString();
  const code = exitCode ?? 0;
  const framesProduced = stderrIndicatesFramesProduced(tail);
  // Both the fuse branch and the memory branch key off the same ENOMEM signal;
  // compute it once so the two can't drift apart (they used to duplicate the
  // regex).
  const enomemSignal =
    ENOMEM_EXIT_CODES.has(code) ||
    /Cannot allocate memory|out of memory|ENOMEM|cannot allocate.+bytes/i.test(
      tail,
    );

  // ── Stall watchdog (runner-originated) ─────────────────────────
  // The runner appends this marker after killing a command that produced
  // no progress and no stderr for the stall window. Checked first: the
  // kill itself looks like "killed" (SIGTERM/SIGKILL exit) to every later
  // branch, and the whole point is to say WHY it was killed.
  if (/\[m0saic\] FFMPEG_STALLED:/.test(tail)) {
    return {
      kind: "stalled",
      summary:
        "ffmpeg produced no progress and no output for the stall window, so " +
        "the runner stopped it (FFMPEG_STALLED). Usually a source that never " +
        "ends or never decodes — a corrupt image or clip, a stream that hangs.",
      hints: [
        "Check the inputs of the failing node: a corrupt or truncated image/clip, or a network source that never answers, will hang the decoder.",
        "Try the render with that node's media replaced by a known-good file.",
      ],
      matchedSignal: "stderr matched runner stall marker",
    };
  }

  // ── Thread exhaustion ──────────────────────────────────────────
  // Checked first: the signature is exact, and these runs often ALSO
  // carry a cancel signal (the operator kills the ~1 fps grind) or dup
  // warnings that would otherwise classify as "killed"/"unknown".
  if (
    /Failed initializing scaling graph \(Resource temporarily unavailable\)/i.test(
      tail,
    )
  ) {
    return {
      kind: "thread-exhaustion",
      summary:
        "ffmpeg hit the platform's per-process thread limit while creating " +
        "swscale worker pools (dense filter graphs spawn one pool per " +
        "scale/format conversion). Frames stop advancing — the output " +
        "freezes on the first frame while render speed collapses.",
      hints: [
        "This should be prevented by the engine's swscale thread guard — if you're seeing it, the failing command likely bypassed the guard (hand-rolled args?). Capture the .commands.json sidecar and report it.",
        "Workaround: re-run with fewer tiles / lower grid density, or add `-filter_complex_threads 2` and `-threads 1` before each still-image input to the failing command.",
        "macOS caps a process at `sysctl kern.num_taskthreads` threads (2048 default) — this failure is expected on macOS first; Windows/Linux limits are far higher.",
      ],
      matchedSignal: "stderr matched swscale EAGAIN pattern",
    };
  }

  // ── Link-queue buffer overflow (fuse trip) ─────────────────────
  // MUST run before the memory branch: a fuse trip prints the same
  // "Cannot allocate memory" (-12) as a real OOM. It's distinguished by
  // (a) the failing command carried the `-filter_buffered_frames` fuse and
  // (b) frames were already produced (mid-render), which rules out the W1
  // graph-init expression cliff. Without this the fuse re-opens the historical
  // ENOMEM-misdiagnosis loop.
  if (opts?.carriedBufferFuse && framesProduced && enomemSignal) {
    return {
      kind: "link-queue-buffer-overflow",
      summary:
        "the filtergraph's link-queue buffering exceeded the " +
        "`-filter_buffered_frames` fuse (an unbalanced sync filter — overlay / " +
        "xfade / concat — queued too many frames). ffmpeg reports this as " +
        "'Cannot allocate memory', but this is almost certainly a graph-shape " +
        "problem, not a memory shortage.",
      hints: [
        "Almost certainly a template/layout issue: before adding RAM, check the failing node for inputs of very different durations feeding one overlay/concat, or a stalled early-EOF source.",
        "A genuine mid-render OOM on this command looks identical — but the layout imbalance is far more likely, so investigate clip-length mismatches first.",
        "To confirm it's the fuse (not real OOM): set `M0SAIC_FILTER_BUFFERED_FRAMES=0` and RESTART the app (or re-run via the CLI) — the render will then climb memory slowly instead of tripping, proving the buffering imbalance.",
      ],
      matchedSignal: "fused command + mid-render ENOMEM signal",
    };
  }

  // ── Memory ─────────────────────────────────────────────────────
  // ENOMEM exit code OR a stderr line that explicitly names the
  // condition. The stderr line is the strongest signal — newer ffmpeg
  // builds prefix it with "[fc#0 @ …] Error while filtering: Cannot
  // allocate memory" and "Task finished with error code: -12".
  if (enomemSignal) {
    return {
      kind: "out-of-memory",
      summary:
        "ffmpeg ran out of memory while building the filter graph. " +
        "This is usually triggered by very high output resolutions " +
        "combined with many concurrent input streams or lossless " +
        "intermediate codecs (qtrle, huffyuv).",
      hints: [
        "Render at a lower resolution (e.g. 1080p instead of 4K) and upscale at the end if needed — peak memory scales quadratically with width × height.",
        "Reduce the number of concurrent inputs in the template (fewer cells / shorter source list).",
        "Avoid lossless ARGB intermediates (qtrle) for large canvases — try yuv420p / prores 422 instead. Per-frame bytes drop ~4× when alpha isn't required.",
        "Close other memory-hungry apps; the ffmpeg process needs to allocate large filter-graph buffers all at once.",
      ],
      matchedSignal:
        ENOMEM_EXIT_CODES.has(code)
          ? `exit code ${code}`
          : "stderr matched memory pattern",
    };
  }

  // ── Disk full ──────────────────────────────────────────────────
  if (
    /No space left on device|ENOSPC|disk full/i.test(tail) ||
    code === 28 // ENOSPC raw
  ) {
    return {
      kind: "no-space",
      summary:
        "ran out of disk space while writing intermediates or the final output.",
      hints: [
        "Free disk space on the workspace drive (often %TEMP% on Windows, /tmp on Unix).",
        "Choose a different workspace directory on a larger drive.",
        "For long high-bitrate renders, intermediates can be tens of GB — check headroom before starting.",
      ],
      matchedSignal: code === 28 ? "ENOSPC exit" : "stderr matched ENOSPC",
    };
  }

  // ── Cancellation / kill ────────────────────────────────────────
  if (
    CANCEL_EXIT_CODES.has(code) ||
    /Exiting normally, received signal 2|Interrupt|signal 15/i.test(tail)
  ) {
    return {
      kind: "killed",
      summary: "render was cancelled or the process was killed.",
      hints: [
        "If this wasn't intentional, check whether another process or the OS terminated ffmpeg (out-of-memory killer, antivirus, sleep/standby).",
      ],
      matchedSignal: `exit code ${code}`,
    };
  }

  // ── Missing input ──────────────────────────────────────────────
  if (
    /No such file or directory|Could not open file|Invalid data found when processing input/i.test(
      tail,
    )
  ) {
    return {
      kind: "missing-input",
      summary:
        "one of the input files couldn't be opened (path missing, permission denied, or unsupported container).",
      hints: [
        "Verify every asset path in the doc resolves to a real file with read permission.",
        "Container probe via ffprobe on the failing input to confirm ffmpeg can read it.",
      ],
      matchedSignal: "stderr matched missing-input pattern",
    };
  }

  // ── Missing codec ──────────────────────────────────────────────
  if (
    /Unknown encoder|Encoder not found|Decoder not found|Unsupported codec/i.test(
      tail,
    )
  ) {
    return {
      kind: "missing-codec",
      summary:
        "the requested encoder or decoder isn't available in this ffmpeg build.",
      hints: [
        "Run `ffmpeg -encoders` / `ffmpeg -decoders` to confirm which codecs are present.",
        "On Windows the bundled m0saic ffmpeg may be LGPL (no libx264). Use `Tools → Upgrade ffmpeg` to switch to the GPL build for libx264 / libx265.",
      ],
      matchedSignal: "stderr matched codec pattern",
    };
  }

  // ── Filter graph invalid ───────────────────────────────────────
  if (
    /Error (?:parsing|reinitializing) (?:filter|filters|filtergraph)|No such filter|Filtergraph .* No such option|Invalid argument to filter/i.test(
      tail,
    )
  ) {
    return {
      kind: "filter-graph-invalid",
      summary:
        "ffmpeg rejected the filter graph (syntax or unsupported filter combination).",
      hints: [
        "Check the failing node's tiles and effects — the graph is composed from the doc, so an unsupported effect/filter combination on that node is the usual cause.",
        "Check ffmpeg version — newer filters (e.g. zscale, libplacebo) require recent builds.",
      ],
      matchedSignal: "stderr matched filter pattern",
    };
  }

  // ── ffmpeg crash (segfault / assert) ───────────────────────────
  if (
    /Assertion .* failed|Segmentation fault|signal 11|signal 6|av_log.*FATAL/i.test(
      tail,
    )
  ) {
    return {
      kind: "ffmpeg-crash",
      summary:
        "ffmpeg crashed (likely a bug in the codec / filter implementation).",
      hints: [
        "Try a different ffmpeg build (the bundled vs system version often differ).",
        "Reduce input variety or try simpler filter combinations to isolate the crash trigger.",
        "Report the failing stderr tail + plan upstream — assertion failures are usually fixable bugs.",
      ],
      matchedSignal: "stderr matched crash pattern",
    };
  }

  return {
    kind: "unknown",
    summary: `ffmpeg exited with code ${code} and no recognised failure signal in stderr.`,
    hints: [
      "Run again with `--verbose` to capture full ffmpeg output.",
      "Check `qr_stamp.failed.json` (or the equivalent sidecar) for the full stderr tail.",
    ],
  };
}

/**
 * Render a classification as a multi-line error message. Used by the
 * CLI and Electron host to enrich their existing exit-code messages.
 *
 * Format:
 *   <header line — what the caller already had>
 *   <blank>
 *   ⚠ <kind>: <summary>
 *      • <hint 1>
 *      • <hint 2>
 *      ...
 */
export function formatFailureMessage(
  header: string,
  classification: FfmpegFailureClassification,
): string {
  if (classification.kind === "unknown") {
    // Don't bloat unknown failures — the header alone is the right
    // amount of noise. Hints stay short and go on one line.
    return `${header}\n\n${classification.hints.join(" ")}`;
  }
  const lines = [header, "", `⚠ ${classification.kind}: ${classification.summary}`];
  for (const hint of classification.hints) {
    lines.push(`   • ${hint}`);
  }
  return lines.join("\n");
}
