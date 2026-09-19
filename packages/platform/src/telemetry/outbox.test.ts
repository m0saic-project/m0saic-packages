import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { MosaicAnalyticsEvent } from "@m0saic/types";
import { asInstallId } from "@m0saic/types";
import { M0SAIC_TMP_PREFIX } from "../paths/tempPrefix";
import {
  OUTBOX_CAP,
  enqueueOutbox,
  listOutbox,
  listSent,
  markSent,
  purgeOutbox,
  removeOutboxEntry,
  updateOutboxEntry,
} from "./outbox";

const originalEnv = process.env.M0SAIC_ROOT;
let fixture: string;

beforeEach(() => {
  fixture = path.join(
    os.tmpdir(),
    `${M0SAIC_TMP_PREFIX}telemetry-outbox-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

const PAYLOAD = (kind: "install_completed" | "rollup" = "install_completed"): MosaicAnalyticsEvent =>
  kind === "install_completed"
    ? {
        kind,
        installId: asInstallId("550e8400-e29b-41d4-a716-446655440000"),
        timestamp: 1,
        schemaVersion: 1,
        host: { os: "macos", arch: "arm64", mosaicVersion: "0.1" },
      }
    : ({
        kind: "rollup",
        installId: asInstallId("550e8400-e29b-41d4-a716-446655440000"),
        timestamp: 1,
        schemaVersion: 1,
        windowStart: 0,
        windowEnd: 1,
        host: { os: "macos", arch: "arm64", mosaicVersion: "0.1" },
        metrics: {
          rendersStarted: 0,
          rendersByOutcome: {
            ok: 0, cancelled: 0, error_plan_build: 0, error_validation: 0,
            error_ffmpeg: 0, error_template: 0, error_other: 0,
          },
          rendersByKind: { mosaic_document: 0, mosaic_pipeline: 0 },
          ffmpegInvocations: 0,
          renderDurationMsBuckets: [0, 0, 0, 0, 0, 0, 0],
          distinctTemplatesUsed: 0,
        },
      } as MosaicAnalyticsEvent);

describe("outbox", () => {
  it("enqueue + list round trip (oldest first)", () => {
    enqueueOutbox(PAYLOAD(), { channel: "immediate", nowMs: 1000 });
    enqueueOutbox(PAYLOAD("rollup"), { channel: "rollup", nowMs: 2000 });
    const all = listOutbox();
    expect(all).toHaveLength(2);
    expect(all[0].kind).toBe("install_completed");
    expect(all[1].channel).toBe("rollup");
    expect(all[0].attempts).toBe(0);
  });

  it("enforces the cap by dropping oldest (logged)", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < OUTBOX_CAP + 3; i++) {
      enqueueOutbox(PAYLOAD(), { channel: "immediate", nowMs: 10_000 + i });
    }
    expect(listOutbox()).toHaveLength(OUTBOX_CAP);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("markSent moves the entry to the sent archive with sentAt", () => {
    const entry = enqueueOutbox(PAYLOAD(), { channel: "immediate", nowMs: 1000 });
    markSent(entry, 5000);
    expect(listOutbox()).toHaveLength(0);
    const sent = listSent();
    expect(sent).toHaveLength(1);
    expect(sent[0].id).toBe(entry.id);
    expect(sent[0].sentAt).toBe(new Date(5000).toISOString());
  });

  it("updateOutboxEntry persists retry bookkeeping", () => {
    const entry = enqueueOutbox(PAYLOAD(), { channel: "immediate", nowMs: 1000 });
    updateOutboxEntry({ ...entry, attempts: 3, nextAttemptAtMs: 999_999 });
    expect(listOutbox()[0]).toMatchObject({ attempts: 3, nextAttemptAtMs: 999_999 });
  });

  it("purgeOutbox drops pending but keeps the sent archive", () => {
    const a = enqueueOutbox(PAYLOAD(), { channel: "immediate", nowMs: 1000 });
    markSent(a, 2000);
    enqueueOutbox(PAYLOAD(), { channel: "immediate", nowMs: 3000 });
    expect(purgeOutbox()).toEqual({ dropped: 1 });
    expect(listOutbox()).toHaveLength(0);
    expect(listSent()).toHaveLength(1);
  });

  it("tolerates corrupt entry files", () => {
    enqueueOutbox(PAYLOAD(), { channel: "immediate", nowMs: 1000 });
    fs.writeFileSync(
      path.join(fixture, "telemetry", "outbox", "zz-corrupt.json"),
      "{nope",
      "utf8",
    );
    expect(listOutbox()).toHaveLength(1);
  });
});

describe("outbox — supersession + race tolerance", () => {
  it("removeOutboxEntry drops one pending entry and reports whether it existed", () => {
    const a = enqueueOutbox(PAYLOAD("rollup"), { channel: "rollup", nowMs: 1000 });
    enqueueOutbox(PAYLOAD("rollup"), { channel: "rollup", nowMs: 2000 });
    expect(removeOutboxEntry(a.id)).toBe(true);
    expect(removeOutboxEntry(a.id)).toBe(false);
    expect(listOutbox()).toHaveLength(1);
  });

  it("carry seeds the retry bookkeeping of a superseding entry", () => {
    const e = enqueueOutbox(PAYLOAD("rollup"), {
      channel: "rollup",
      nowMs: 1000,
      carry: { attempts: 2, nextAttemptAtMs: 777_777 },
    });
    expect(e).toMatchObject({ attempts: 2, nextAttemptAtMs: 777_777 });
    expect(listOutbox()[0]).toMatchObject({ attempts: 2, nextAttemptAtMs: 777_777 });
  });

  it("markSent with rejected keeps the payload in the ledger, marked", () => {
    const entry = enqueueOutbox(PAYLOAD(), { channel: "immediate", nowMs: 1000 });
    markSent(entry, 5000, { rejected: { status: 422 } });
    expect(listOutbox()).toHaveLength(0);
    expect(listSent()[0]).toMatchObject({ id: entry.id, rejected: { status: 422 } });
  });

  it("updateOutboxEntry never resurrects an entry another sender already moved", () => {
    const entry = enqueueOutbox(PAYLOAD(), { channel: "immediate", nowMs: 1000 });
    markSent(entry, 2000);
    updateOutboxEntry({ ...entry, attempts: 1, nextAttemptAtMs: 9999 });
    expect(listOutbox()).toHaveLength(0);
    expect(listSent()).toHaveLength(1);
  });
});
