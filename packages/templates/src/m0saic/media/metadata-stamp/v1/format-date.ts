/**
 * Pure, machine-independent timestamp helpers for
 * `@m0saic/media/metadata-stamp/v1`.
 *
 * Container creation tags arrive as ISO-8601 strings from the engine's
 * ffprobe pass (`ctx.media[...]`). These helpers parse and format them
 * WITHOUT `Date.parse`-on-naive-strings, `toLocale*`, or `Intl` — all of
 * which read machine locale/timezone and would break byte-identical
 * renders (agent contract §9). A wall time with no zone designator is
 * treated as UTC, never as local time.
 */

/** Apple's QuickTime creation tag — carries the local UTC offset. */
export const APPLE_CREATION_TAG = "com.apple.quicktime.creationdate";

/** The generic MP4/MOV creation tag — normalized to UTC by ffmpeg. */
export const CREATION_TIME_TAG = "creation_time";

/** Date-format presets. English month names, fixed — no locale reads. */
export const STAMP_DATE_FORMATS = [
  "YYYY-MM-DD",
  "YYYY-MM-DD HH:mm",
  "MMM D, YYYY",
  "D MMM YYYY",
  "MM/DD/YYYY",
  "DD.MM.YYYY",
] as const;
export type StampDateFormat = (typeof STAMP_DATE_FORMATS)[number];

const MONTHS_EN = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** A parsed creation timestamp: absolute instant + authored offset (if any). */
export type ParsedVideoTimestamp = {
  /** Epoch milliseconds (UTC instant). */
  epochMs: number;
  /** UTC offset the tag carried, minutes east of UTC; null = none stated. */
  offsetMinutes: number | null;
};

/** The subset of `MosaicMediaMetadata` the tag extraction reads. */
export type CreationTagCarrier = {
  /** Merged format + stream tags. */
  tags?: Record<string, string | undefined>;
  format?: { tags?: Record<string, string | undefined> };
};

/**
 * Pull the raw creation-timestamp string off probed metadata. Prefers
 * the Apple key (it keeps the local UTC offset the camera stamped);
 * falls back to `creation_time` (UTC). Returns null when neither tag is
 * present — a common, normal case (transcoded or stripped files).
 */
export function extractCreationTimestampRaw(
  meta: CreationTagCarrier | undefined,
): string | null {
  if (!meta) return null;
  const apple = meta.format?.tags?.[APPLE_CREATION_TAG] ?? meta.tags?.[APPLE_CREATION_TAG];
  if (apple && apple.trim().length > 0) return apple.trim();
  const generic = meta.tags?.[CREATION_TIME_TAG] ?? meta.format?.tags?.[CREATION_TIME_TAG];
  return generic && generic.trim().length > 0 ? generic.trim() : null;
}

// ISO-8601-ish: date, optional time (T or space), optional fraction,
// optional zone (Z, ±hh:mm, ±hhmm). Covers ffprobe's
// "2024-03-11T18:22:04.000000Z" and Apple's "2024-03-11T19:22:04+0100".
const TS_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|z|[+-]\d{2}:?\d{2})?$/;

/**
 * Parse a creation-tag string into an absolute instant + stated offset.
 * Missing zone designator = UTC (deterministic; NEVER local time).
 * Returns null for anything malformed or out of range.
 */
export function parseVideoTimestamp(
  raw: string | null | undefined,
): ParsedVideoTimestamp | null {
  if (!raw) return null;
  const m = TS_RE.exec(raw.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = m[4] !== undefined ? Number(m[4]) : 0;
  const minute = m[5] !== undefined ? Number(m[5]) : 0;
  const second = m[6] !== undefined ? Number(m[6]) : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 60) return null;

  let offsetMinutes: number | null = null;
  const zone = m[7];
  if (zone !== undefined) {
    if (zone === "Z" || zone === "z") {
      offsetMinutes = 0;
    } else {
      const sign = zone.startsWith("-") ? -1 : 1;
      const hh = Number(zone.slice(1, 3));
      const mm = Number(zone.slice(-2));
      if (hh > 23 || mm > 59) return null;
      offsetMinutes = sign * (hh * 60 + mm);
    }
  }

  const wallUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  // The wall-clock fields are local to `offsetMinutes`; subtract it to
  // land on the absolute instant. No offset stated → wall time IS UTC.
  const epochMs = offsetMinutes === null ? wallUtcMs : wallUtcMs - offsetMinutes * 60_000;
  return { epochMs, offsetMinutes };
}

/**
 * Format a parsed timestamp. The rendered wall time uses, in order:
 * the explicit `utcOffsetMinutes` override, the offset the tag carried,
 * else UTC. `new Date(number)` + `getUTC*` only — pure epoch math.
 */
export function formatVideoTimestamp(
  ts: ParsedVideoTimestamp,
  format: StampDateFormat,
  utcOffsetMinutes?: number | null,
): string {
  const offset = utcOffsetMinutes ?? ts.offsetMinutes ?? 0;
  const t = new Date(ts.epochMs + offset * 60_000);
  const y = t.getUTCFullYear();
  const mo = t.getUTCMonth() + 1;
  const d = t.getUTCDate();
  const p2 = (n: number) => String(n).padStart(2, "0");
  switch (format) {
    case "YYYY-MM-DD":
      return `${y}-${p2(mo)}-${p2(d)}`;
    case "YYYY-MM-DD HH:mm":
      return `${y}-${p2(mo)}-${p2(d)} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}`;
    case "MMM D, YYYY":
      return `${MONTHS_EN[mo - 1]} ${d}, ${y}`;
    case "D MMM YYYY":
      return `${d} ${MONTHS_EN[mo - 1]} ${y}`;
    case "MM/DD/YYYY":
      return `${p2(mo)}/${p2(d)}/${y}`;
    case "DD.MM.YYYY":
      return `${p2(d)}.${p2(mo)}.${y}`;
    default: {
      const never: never = format;
      throw new Error(`formatVideoTimestamp: unknown format ${String(never)}`);
    }
  }
}
