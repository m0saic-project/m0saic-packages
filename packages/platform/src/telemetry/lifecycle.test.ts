import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { M0SAIC_TMP_PREFIX } from "../paths/tempPrefix";
import { listOutbox } from "./outbox";
import { loadTelemetrySettings, setTelemetryMode } from "./settingsStore";
import { checkAndEnqueueLifecycle } from "./lifecycle";

const originalEnv = process.env.M0SAIC_ROOT;
let fixture: string;

beforeEach(() => {
  fixture = path.join(
    os.tmpdir(),
    `${M0SAIC_TMP_PREFIX}telemetry-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  process.env.M0SAIC_ROOT = fixture;
});

afterEach(() => {
  if (fs.existsSync(fixture)) fs.rmSync(fixture, { recursive: true, force: true });
});

afterAll(() => {
  if (originalEnv === undefined) delete process.env.M0SAIC_ROOT;
  else process.env.M0SAIC_ROOT = originalEnv;
});

describe("checkAndEnqueueLifecycle", () => {
  it("fresh install → install_completed once, then quiet", () => {
    const first = checkAndEnqueueLifecycle({ currentVersion: "0.1.0", nowMs: 1000, env: {} });
    expect(first.enqueued).toBe("install_completed");
    expect(loadTelemetrySettings().lastSeenVersion).toBe("0.1.0");
    const again = checkAndEnqueueLifecycle({ currentVersion: "0.1.0", nowMs: 2000, env: {} });
    expect(again.enqueued).toBeNull();
    expect(listOutbox()).toHaveLength(1);
    expect(listOutbox()[0].payload.kind).toBe("install_completed");
  });

  it("patch bumps stay quiet; major.minor moves fire update_completed", () => {
    checkAndEnqueueLifecycle({ currentVersion: "0.1.0", nowMs: 1000, env: {} });
    expect(
      checkAndEnqueueLifecycle({ currentVersion: "0.1.7", nowMs: 2000, env: {} }).enqueued,
    ).toBeNull();
    const moved = checkAndEnqueueLifecycle({ currentVersion: "0.2.0", nowMs: 3000, env: {} });
    expect(moved.enqueued).toBe("update_completed");
    const payload = listOutbox()[1].payload as { fromVersion: string; toVersion: string };
    expect(payload.fromVersion).toBe("0.1");
    expect(payload.toVersion).toBe("0.2");
  });

  it("gated modes still advance lastSeenVersion but enqueue nothing", () => {
    setTelemetryMode("local");
    const res = checkAndEnqueueLifecycle({ currentVersion: "0.1.0", nowMs: 1000, env: {} });
    expect(res.enqueued).toBeNull();
    expect(listOutbox()).toHaveLength(0);
    expect(loadTelemetrySettings().lastSeenVersion).toBe("0.1.0");
    // Later upgrade + opt back in: no retro install event, only real moves.
    setTelemetryMode("standard");
    expect(
      checkAndEnqueueLifecycle({ currentVersion: "0.1.0", nowMs: 2000, env: {} }).enqueued,
    ).toBeNull();
  });

  it("env ghost is fully inert — no settings mint, no bookkeeping", () => {
    const res = checkAndEnqueueLifecycle({
      currentVersion: "0.1.0",
      nowMs: 1000,
      env: { M0SAIC_TELEMETRY: "ghost" },
    });
    expect(res.enqueued).toBeNull();
    expect(fs.existsSync(path.join(fixture, "telemetry"))).toBe(false);
  });

  it("DNT suppresses emission (env gate)", () => {
    const res = checkAndEnqueueLifecycle({
      currentVersion: "0.1.0",
      nowMs: 1000,
      env: { DO_NOT_TRACK: "1" },
    });
    expect(res.enqueued).toBeNull();
    expect(listOutbox()).toHaveLength(0);
  });
});
