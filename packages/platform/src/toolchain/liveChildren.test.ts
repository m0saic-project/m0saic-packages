import { EventEmitter } from "events";
import {
  trackLiveChild,
  liveChildCount,
  isChildAlive,
  killChildWithEscalation,
  abortLiveChildren,
  __resetLiveChildrenForTests,
} from "./liveChildren";

type FakeChild = EventEmitter & {
  kill: jest.Mock;
  killed: boolean;
  exitCode: number | null;
  signalCode: string | null;
};

/** A child that never exits on its own; `kill(sig)` exits it only for `diesOn`. */
function hungChild(diesOn?: string[]): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = jest.fn((sig?: string) => {
    const signal = sig ?? "SIGTERM";
    if (diesOn && !diesOn.includes(signal)) return true;
    child.killed = true;
    setImmediate(() => {
      child.signalCode = signal;
      child.emit("exit", null, signal);
    });
    return true;
  });
  return child;
}

describe("liveChildren", () => {
  beforeEach(() => __resetLiveChildrenForTests());

  it("tracks a child until it exits, errors or closes", () => {
    const a = hungChild();
    const b = hungChild();
    const c = hungChild();
    trackLiveChild(a as never);
    trackLiveChild(b as never);
    const untrackC = trackLiveChild(c as never);
    expect(liveChildCount()).toBe(3);
    a.emit("exit", 0);
    expect(liveChildCount()).toBe(2);
    // A spawn failure emits `error` + `close`, never `exit`.
    b.emit("error", new Error("spawn ENOENT"));
    expect(liveChildCount()).toBe(1);
    untrackC();
    expect(liveChildCount()).toBe(0);
  });

  it("isChildAlive is loose on null/undefined so test doubles count as alive", () => {
    const real = { exitCode: null, signalCode: null } as never;
    const dbl = {} as never;
    const dead = { exitCode: 0, signalCode: null } as never;
    expect(isChildAlive(real)).toBe(true);
    expect(isChildAlive(dbl)).toBe(true);
    expect(isChildAlive(dead)).toBe(false);
  });

  it("killChildWithEscalation: SIGTERM first, SIGKILL after the grace period", async () => {
    const child = hungChild(["SIGKILL"]);
    const t0 = Date.now();
    await killChildWithEscalation(child as never, 40);
    expect(child.kill.mock.calls.map((c) => c[0] ?? "SIGTERM")).toEqual(["SIGTERM", "SIGKILL"]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
    expect(child.signalCode).toBe("SIGKILL");
  });

  it("killChildWithEscalation resolves at once for a child that already exited", async () => {
    const child = hungChild();
    child.exitCode = 0;
    await killChildWithEscalation(child as never, 10);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("killChildWithEscalation never throws when kill() throws", async () => {
    const child = hungChild();
    child.kill = jest.fn(() => {
      throw new Error("ESRCH");
    });
    await expect(killChildWithEscalation(child as never, 10)).resolves.toBeUndefined();
  });

  it("abortLiveChildren kills every tracked child and waits for them", async () => {
    const a = hungChild();
    const b = hungChild();
    trackLiveChild(a as never);
    trackLiveChild(b as never);
    await abortLiveChildren();
    expect(a.kill).toHaveBeenCalled();
    expect(b.kill).toHaveBeenCalled();
    expect(liveChildCount()).toBe(0);
    // Idempotent.
    await abortLiveChildren();
  });
});
