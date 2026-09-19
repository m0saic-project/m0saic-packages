import {
  classifyFfmpegFailure,
  formatFailureMessage,
  stderrIndicatesFramesProduced,
} from "./ffmpegFailure";

// Canonical classifier behaviour tests. They live next to the implementation
// in @m0saic/types (browser-safe, no core dependency); the root jest
// `testMatch` covers `packages/types`, so these run in CI. The sibling test in
// `packages/core/src/runtime/ffmpegFailure.test.ts` is only a thin re-export
// check — behaviour changes go HERE.

describe("classifyFfmpegFailure", () => {
  test("Windows ENOMEM exit code (4294967284) → out-of-memory", () => {
    const c = classifyFfmpegFailure(
      4294967284,
      "[fc#0] Error while filtering: Cannot allocate memory\nTask finished with error code: -12",
    );
    expect(c.kind).toBe("out-of-memory");
    expect(c.summary).toMatch(/memory/i);
    expect(c.hints.length).toBeGreaterThan(0);
    expect(c.hints.some((h) => /1080p|resolution/i.test(h))).toBe(true);
  });

  test("POSIX -12 exit → out-of-memory", () => {
    const c = classifyFfmpegFailure(-12, "Cannot allocate memory");
    expect(c.kind).toBe("out-of-memory");
  });

  test("SIGKILL-from-OOM exit 137 → out-of-memory", () => {
    const c = classifyFfmpegFailure(137, "");
    expect(c.kind).toBe("out-of-memory");
  });

  test("stderr-only OOM pattern with neutral exit code", () => {
    const c = classifyFfmpegFailure(1, "av_malloc: cannot allocate 8388608 bytes");
    expect(c.kind).toBe("out-of-memory");
  });

  test("ENOSPC → no-space", () => {
    const c = classifyFfmpegFailure(1, "No space left on device");
    expect(c.kind).toBe("no-space");
    expect(c.hints.some((h) => /disk|space/i.test(h))).toBe(true);
  });

  test("swscale EAGAIN flood → thread-exhaustion", () => {
    const c = classifyFfmpegFailure(
      1,
      "[swscaler @ 0x161248000] Failed initializing scaling graph (Resource temporarily unavailable): fmt:rgba csp:gbr prim:unknown trc:unknown -> fmt:gbrap csp:gbr prim:unknown trc:unknown",
    );
    expect(c.kind).toBe("thread-exhaustion");
    expect(c.hints.some((h) => /filter_complex_threads/.test(h))).toBe(true);
  });

  test("thread-exhaustion wins over a trailing cancel signal (the operator kills the grind)", () => {
    const c = classifyFfmpegFailure(
      124,
      "[swscaler @ 0x1] Failed initializing scaling graph (Resource temporarily unavailable): fmt:rgba -> fmt:argb\n" +
        "frame=  360 fps=1.0 dup=2253 drop=0 speed=5.99e-05x\n" +
        "Exiting normally, received signal 15.",
    );
    expect(c.kind).toBe("thread-exhaustion");
  });

  test("Cancel exit codes → killed", () => {
    expect(classifyFfmpegFailure(255, "").kind).toBe("killed");
    expect(classifyFfmpegFailure(143, "").kind).toBe("killed");
  });

  test("missing input → missing-input", () => {
    const c = classifyFfmpegFailure(1, "No such file or directory: foo.mp4");
    expect(c.kind).toBe("missing-input");
  });

  test("missing codec → missing-codec", () => {
    const c = classifyFfmpegFailure(1, "Unknown encoder 'libx264'");
    expect(c.kind).toBe("missing-codec");
  });

  test("runner stall marker → stalled (checked before the kill/signal branches)", () => {
    const c = classifyFfmpegFailure(
      1,
      "frame=    0 fps=0.0\n[m0saic] FFMPEG_STALLED: no progress or output for 120s — engine process killed\n",
    );
    expect(c.kind).toBe("stalled");
    expect(c.summary).toContain("FFMPEG_STALLED");
    // The shipped hints never point at a dev-only flag.
    const graph = classifyFfmpegFailure(1, "Error parsing filterchain 'overlay=foo'");
    expect(graph.hints.join(" ")).not.toContain("--print-commands");
  });

  test("filter graph invalid → filter-graph-invalid", () => {
    const c = classifyFfmpegFailure(1, "Error parsing filterchain 'overlay=foo'");
    expect(c.kind).toBe("filter-graph-invalid");
  });

  test("assertion failure → ffmpeg-crash", () => {
    const c = classifyFfmpegFailure(
      1,
      "Assertion frame->pts >= 0 failed at libavfilter/buffersrc.c",
    );
    expect(c.kind).toBe("ffmpeg-crash");
  });

  test("unrecognised → unknown with explicit unknown summary", () => {
    const c = classifyFfmpegFailure(7, "weird unfamiliar output");
    expect(c.kind).toBe("unknown");
    expect(c.summary).toMatch(/code 7/);
  });

  test("OOM exit code wins even with empty stderr", () => {
    const c = classifyFfmpegFailure(4294967284, "");
    expect(c.kind).toBe("out-of-memory");
    expect(c.matchedSignal).toMatch(/4294967284/);
  });

  test("null/undefined exit code and stderr default to code 0 / empty tail → unknown", () => {
    expect(classifyFfmpegFailure(null, undefined).kind).toBe("unknown");
    const c = classifyFfmpegFailure(undefined, undefined);
    expect(c.kind).toBe("unknown");
    expect(c.summary).toMatch(/code 0/);
  });

  test("raw ENOSPC exit (28) with silent stderr → no-space via exit-code signal", () => {
    const c = classifyFfmpegFailure(28, "");
    expect(c.kind).toBe("no-space");
    expect(c.matchedSignal).toBe("ENOSPC exit");
  });

  // ── Link-queue buffer overflow (fuse trip) ──────────────────────
  test("fused command + mid-render ENOMEM → link-queue-buffer-overflow, NOT out-of-memory", () => {
    const c = classifyFfmpegFailure(
      -12,
      "frame=  247 fps= 30\n[fc#0] Error while filtering: Cannot allocate memory",
      { carriedBufferFuse: true },
    );
    expect(c.kind).toBe("link-queue-buffer-overflow");
    expect(c.summary).toMatch(/not a memory shortage/i);
    expect(c.hints.some((h) => /M0SAIC_FILTER_BUFFERED_FRAMES/.test(h))).toBe(
      true,
    );
    // F8: hint must mention the restart requirement.
    expect(c.hints.some((h) => /restart/i.test(h))).toBe(true);
  });

  test("fused command but NO frames produced (graph-init cliff) → out-of-memory", () => {
    // W1 expression cliff: fails at init, before any frame → stays OOM.
    const c = classifyFfmpegFailure(
      -12,
      "[Parsed_geq] Cannot allocate memory",
      { carriedBufferFuse: true },
    );
    expect(c.kind).toBe("out-of-memory");
  });

  test("mid-render ENOMEM WITHOUT the fuse flag → out-of-memory (not our fuse)", () => {
    const c = classifyFfmpegFailure(
      -12,
      "frame=  247 fps= 30\nCannot allocate memory",
    );
    expect(c.kind).toBe("out-of-memory");
  });

  test("frame=0 does not count as frames produced", () => {
    const c = classifyFfmpegFailure(
      -12,
      "frame=    0 fps=0.0\nCannot allocate memory",
      { carriedBufferFuse: true },
    );
    expect(c.kind).toBe("out-of-memory");
  });

  // ── F4: framesProduced left boundary ────────────────────────────
  test("end_frame=300 in stderr does NOT count as frames produced (W1 stays OOM)", () => {
    const c = classifyFfmpegFailure(
      -12,
      "Error initializing filter 'trim' with args 'end_frame=300'\nCannot allocate memory",
      { carriedBufferFuse: true },
    );
    expect(c.kind).toBe("out-of-memory");
  });

  test("a line-start `frame=63` DOES count as frames produced", () => {
    const c = classifyFfmpegFailure(
      -12,
      "frame=63 fps=30\nCannot allocate memory",
      { carriedBufferFuse: true },
    );
    expect(c.kind).toBe("link-queue-buffer-overflow");
  });
});

describe("stderrIndicatesFramesProduced", () => {
  test("true for a non-zero frame= progress report", () => {
    expect(stderrIndicatesFramesProduced("frame=  247 fps= 30")).toBe(true);
    expect(stderrIndicatesFramesProduced("frame=63 fps=30")).toBe(true);
  });

  test("false for frame=0 and no frame line", () => {
    expect(stderrIndicatesFramesProduced("frame=    0 fps=0.0")).toBe(false);
    expect(stderrIndicatesFramesProduced("no progress here")).toBe(false);
  });

  test("false for end_frame=300 (left boundary guard)", () => {
    expect(
      stderrIndicatesFramesProduced("Error initializing filter 'trim' with args 'end_frame=300'"),
    ).toBe(false);
  });
});

describe("formatFailureMessage", () => {
  test("known kind produces header + classification block + bullets", () => {
    const c = classifyFfmpegFailure(4294967284, "Cannot allocate memory");
    const msg = formatFailureMessage(
      "Command 52/54 exited 4294967284",
      c,
    );
    expect(msg).toContain("Command 52/54 exited 4294967284");
    expect(msg).toContain("out-of-memory");
    expect(msg).toContain("•");
  });

  test("unknown kind appends a terse single-line hint", () => {
    const c = classifyFfmpegFailure(7, "");
    const msg = formatFailureMessage("ffmpeg exited 7", c);
    expect(msg).toContain("ffmpeg exited 7");
    expect(msg.split("\n").length).toBeLessThanOrEqual(4);
  });
});
