import { EventEmitter } from "events";

const spawnMock = jest.fn();
jest.mock("child_process", () => ({
  ...jest.requireActual<typeof import("child_process")>("child_process"),
  spawn: (...a: unknown[]) => spawnMock(...a),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runProbeChild, ProbeTimeoutError, PROBE_TIMEOUT, DEFAULT_PROBE_TIMEOUT_MS } =
  require("./probeChild") as typeof import("./probeChild");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { liveChildCount, abortLiveChildren, __resetLiveChildrenForTests } =
  require("./liveChildren") as typeof import("./liveChildren");

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: jest.Mock;
  killed: boolean;
  exitCode: number | null;
  signalCode: string | null;
};

function baseChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = jest.fn(() => true);
  return child;
}

/** Emits `out`/`err` then closes with `code`. */
function finishingChild(out: string, err: string, code: number): FakeChild {
  const child = baseChild();
  setImmediate(() => {
    if (out) child.stdout.emit("data", Buffer.from(out));
    if (err) child.stderr.emit("data", Buffer.from(err));
    child.exitCode = code;
    child.emit("exit", code);
    child.emit("close", code);
  });
  return child;
}

/** Never exits on its own; dies only on the signals in `diesOn` (default any). */
function hungChild(diesOn?: string[]): FakeChild {
  const child = baseChild();
  child.kill = jest.fn((sig?: string) => {
    const signal = sig ?? "SIGTERM";
    if (diesOn && !diesOn.includes(signal)) return true;
    child.killed = true;
    setImmediate(() => {
      child.signalCode = signal;
      child.emit("exit", null, signal);
      child.emit("close", null, signal);
    });
    return true;
  });
  return child;
}

describe("runProbeChild", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    __resetLiveChildrenForTests();
  });

  it("collects stdout/stderr and the exit code; env is sanitized; the child is tracked while alive", async () => {
    process.env.FFREPORT = "file=leak.log";
    const child = finishingChild('{"ok":1}', "warn\n", 0);
    spawnMock.mockImplementation(() => child);
    const p = runProbeChild("/opt/bin/ffprobe", ["-version"], { cwd: "/tmp" });
    expect(liveChildCount()).toBe(1);
    const r = await p;
    delete process.env.FFREPORT;
    expect(r).toEqual({ stdout: '{"ok":1}', stderr: "warn\n", code: 0, timedOut: false });
    expect(liveChildCount()).toBe(0);
    const [bin, argv, opts] = spawnMock.mock.calls[0] as [string, string[], { cwd?: string; env: NodeJS.ProcessEnv }];
    expect(bin).toBe("/opt/bin/ffprobe");
    expect(argv).toEqual(["-version"]);
    expect(opts.cwd).toBe("/tmp");
    expect(opts.env).not.toHaveProperty("FFREPORT");
    expect(opts.env.AV_LOG_FORCE_NOCOLOR).toBe("1");
  });

  it("a probe that never exits is killed at the timeout (SIGTERM → SIGKILL) and reports PROBE_TIMEOUT", async () => {
    const child = hungChild(["SIGKILL"]);
    spawnMock.mockImplementation(() => child);
    const t0 = Date.now();
    const r = await runProbeChild("ffprobe", ["x.mp4"], { timeoutMs: 30, killGraceMs: 20 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45);
    expect(child.kill.mock.calls.map((c) => c[0] ?? "SIGTERM")).toEqual(["SIGTERM", "SIGKILL"]);
    expect(r.timedOut).toBe(true);
    expect(r.code).toBe(-1);
    expect(r.stderr).toContain(PROBE_TIMEOUT);
    expect(r.stderr).toContain("ffprobe timed out after 30ms (killed)");
    expect(liveChildCount()).toBe(0);
  });

  it("the default timeout is 60 s and timeoutMs: 0 disables it", async () => {
    expect(DEFAULT_PROBE_TIMEOUT_MS).toBe(60_000);
    jest.useFakeTimers();
    try {
      const child = hungChild();
      spawnMock.mockImplementation(() => child);
      const p = runProbeChild("ffprobe", ["x.mp4"], { timeoutMs: 0 });
      jest.advanceTimersByTime(DEFAULT_PROBE_TIMEOUT_MS * 3);
      expect(child.kill).not.toHaveBeenCalled();
      child.exitCode = 0;
      child.emit("close", 0);
      const r = await p;
      expect(r.timedOut).toBe(false);
      expect(r.code).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("abort during a probe (abortLiveChildren) kills the child and the probe settles", async () => {
    const child = hungChild();
    spawnMock.mockImplementation(() => child);
    const p = runProbeChild("ffprobe", ["fifo.mp4"], { timeoutMs: 0 });
    expect(liveChildCount()).toBe(1);
    await abortLiveChildren();
    expect(child.kill).toHaveBeenCalled();
    const r = await p;
    expect(r.code).toBe(-1);
    expect(r.timedOut).toBe(false);
    expect(liveChildCount()).toBe(0);
  });

  it("a spawn failure (ENOENT) resolves with code -1 + spawnError and never rejects", async () => {
    const child = baseChild();
    spawnMock.mockImplementation(() => child);
    setImmediate(() => {
      child.emit("error", new Error("spawn ffprobe ENOENT"));
      child.emit("close", -2);
    });
    const r = await runProbeChild("ffprobe", ["x.mp4"]);
    expect(r.code).toBe(-1);
    expect(r.spawnError?.message).toContain("ENOENT");
    expect(liveChildCount()).toBe(0);
  });

  it("ProbeTimeoutError carries the stable code, tool and window", () => {
    const err = new ProbeTimeoutError("ffmpeg", 1234, "extra");
    expect(err.code).toBe(PROBE_TIMEOUT);
    expect(err.tool).toBe("ffmpeg");
    expect(err.timeoutMs).toBe(1234);
    expect(err.message).toBe("PROBE_TIMEOUT: ffmpeg timed out after 1234ms (killed)\nextra");
    expect(err.name).toBe("ProbeTimeoutError");
  });
});
