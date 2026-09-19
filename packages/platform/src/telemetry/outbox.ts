import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type {
  MosaicAnalyticsEvent,
  MosaicOutboxEntry,
  MosaicSentEntry,
} from "@m0saic/types";
import {
  TELEMETRY_OUTBOX_ENTRY_SCHEMA_VERSION,
  isMosaicOutboxEntry,
} from "@m0saic/types";
import { ensureDir } from "../paths/m0saicRoot";
import { getTelemetryOutboxDir, getTelemetrySentDir } from "./paths";

/**
 * On-disk upstream queues. One JSON file per payload:
 *
 *   outbox/<enqueueMs>-<kind>-<rand>.json   pending (the sender's input)
 *   sent/<same-basename>.json               archive of what actually left
 *
 * Both are part of the exact-transparency contract — the page and
 * `m0saic telemetry preview` render these files verbatim. Caps are
 * LOGGED, never silent: outbox keeps the newest 50 (oldest dropped);
 * sent/ archives the most recent 200 (a busy day is a couple of dozen
 * today-so-far updates, and install/update events must stay visible).
 *
 * Two sender processes may race on the same entry (a detached CLI
 * worker beside the desktop app's flush): the server de-duplicates by
 * event id, and every unlink / rewrite here tolerates an entry that the
 * other side already moved.
 */
export const OUTBOX_CAP = 50;
export const SENT_ARCHIVE_CAP = 200;

const entryPath = (dir: string, id: string): string =>
  path.join(dir, `${id}.json`);

const readEntries = <T extends MosaicOutboxEntry>(dir: string): T[] => {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const entries: T[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed: unknown = JSON.parse(
        fs.readFileSync(path.join(dir, name), "utf8"),
      );
      if (isMosaicOutboxEntry(parsed)) entries.push(parsed as T);
    } catch {
      /* tolerate corrupt entries — skip */
    }
  }
  entries.sort((a, b) => a.id.localeCompare(b.id)); // ids sort chronologically
  return entries;
};

const writeEntry = (dir: string, entry: MosaicOutboxEntry | MosaicSentEntry): void => {
  ensureDir(dir);
  const file = entryPath(dir, entry.id);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
};

const unlinkQuietly = (file: string): boolean => {
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
};

/**
 * Queue a payload for the sender. Applies the outbox cap (logged).
 * `carry` lets a superseding entry inherit the retry bookkeeping of the
 * entry it replaces, so a backed-off install does not re-POST every
 * render.
 */
export function enqueueOutbox(
  payload: MosaicAnalyticsEvent,
  opts: {
    channel: "rollup" | "immediate";
    nowMs?: number;
    carry?: { attempts: number; nextAttemptAtMs: number };
    /**
     * Epoch ms used for the entry id (sent upstream as the event id).
     * Defaults to `nowMs`.
     */
    idMs?: number;
  },
): MosaicOutboxEntry {
  const nowMs = opts.nowMs ?? Date.now();
  const entry: MosaicOutboxEntry = {
    schemaVersion: TELEMETRY_OUTBOX_ENTRY_SCHEMA_VERSION,
    id: `${opts.idMs ?? nowMs}-${payload.kind}-${crypto.randomBytes(3).toString("hex")}`,
    channel: opts.channel,
    kind: payload.kind,
    createdAt: new Date(nowMs).toISOString(),
    attempts: opts.carry?.attempts ?? 0,
    nextAttemptAtMs: opts.carry?.nextAttemptAtMs ?? 0,
    payload,
  };
  writeEntry(getTelemetryOutboxDir(), entry);
  const all = readEntries(getTelemetryOutboxDir());
  if (all.length > OUTBOX_CAP) {
    const drop = all.slice(0, all.length - OUTBOX_CAP);
    for (const d of drop) unlinkQuietly(entryPath(getTelemetryOutboxDir(), d.id));
    // No silent caps: dropped payloads are announced.
    console.warn(
      `[telemetry] outbox cap (${OUTBOX_CAP}) reached — dropped ${drop.length} oldest queued payload(s)`,
    );
  }
  return entry;
}

/** Pending payloads, oldest first. */
export function listOutbox(): MosaicOutboxEntry[] {
  return readEntries(getTelemetryOutboxDir());
}

/** Sent archive, oldest first. */
export function listSent(): MosaicSentEntry[] {
  return readEntries<MosaicSentEntry>(getTelemetrySentDir()).filter(
    (e): e is MosaicSentEntry => typeof (e as MosaicSentEntry).sentAt === "string",
  );
}

/** Drop one pending entry (superseded). Returns false when it was already gone. */
export function removeOutboxEntry(id: string): boolean {
  return unlinkQuietly(entryPath(getTelemetryOutboxDir(), id));
}

/**
 * Persist retry bookkeeping after a failed send. A no-op when the entry
 * is no longer pending (another sender moved it meanwhile) — never
 * resurrects a sent entry.
 */
export function updateOutboxEntry(entry: MosaicOutboxEntry): void {
  if (!fs.existsSync(entryPath(getTelemetryOutboxDir(), entry.id))) return;
  writeEntry(getTelemetryOutboxDir(), entry);
}

/**
 * Archive a payload that left the machine: write to `sent/` (with
 * `sentAt`, and `rejected` when the server refused the body), remove
 * from the outbox, prune the archive to its cap.
 */
export function markSent(
  entry: MosaicOutboxEntry,
  sentAtMs: number,
  extra?: { rejected: { status: number } },
): void {
  const sent: MosaicSentEntry = {
    ...entry,
    sentAt: new Date(sentAtMs).toISOString(),
    ...(extra?.rejected !== undefined ? { rejected: extra.rejected } : {}),
  };
  writeEntry(getTelemetrySentDir(), sent);
  unlinkQuietly(entryPath(getTelemetryOutboxDir(), entry.id));
  const archive = readEntries(getTelemetrySentDir());
  if (archive.length > SENT_ARCHIVE_CAP) {
    for (const d of archive.slice(0, archive.length - SENT_ARCHIVE_CAP)) {
      unlinkQuietly(entryPath(getTelemetrySentDir(), d.id));
    }
  }
}

/**
 * Drop every PENDING payload — the "opt-out clears pending queues"
 * rule (consent.ts). The sent/ archive is history, not a queue, and
 * stays (the user can clear the whole folder from the page).
 */
export function purgeOutbox(): { dropped: number } {
  const all = listOutbox();
  for (const e of all) unlinkQuietly(entryPath(getTelemetryOutboxDir(), e.id));
  return { dropped: all.length };
}
