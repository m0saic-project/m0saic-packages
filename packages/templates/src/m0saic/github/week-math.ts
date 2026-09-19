/**
 * Pure calendar arithmetic for the GitHub connector — ISO-8601 weeks and
 * Monday-start week windows.
 *
 * DETERMINISM CONTRACT: every function here is a pure integer computation over
 * `"YYYY-MM-DD"` strings — NO `Date` construction, NO wall-clock. This is what
 * lets the core-tier `weekly-pulse-adapter` (and the beats) stay deterministic
 * while still doing week math, and it extends the `parseISODate` idiom already
 * in `hero/ffmpeg-pulse/_shared/pulse-data.ts`. Shared by: the client (window →
 * since/until), the adapter (weekNumber, trailing-8 grid), and — later — the
 * Jobs window tokens (F5 Phase 5), which import these instead of re-deriving.
 *
 * The engine (proleptic Gregorian) day-count is Howard Hinnant's
 * `days_from_civil` / `civil_from_days` — exact for all in-range dates, integer
 * throughout.
 */

/** A calendar date as integer parts (UTC, proleptic Gregorian). */
export type YMD = { y: number; m: number; d: number };

/** Parse `"YYYY-MM-DD"` (optionally with a trailing time) into integer parts. */
export function parseISODate(iso: string): YMD {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error(`week-math: not an ISO date: ${JSON.stringify(iso)}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** Format integer parts back to `"YYYY-MM-DD"` (zero-padded). */
export function formatISODate({ y, m, d }: YMD): string {
  const p = (n: number, w: number) => String(n).padStart(w, "0");
  return `${p(y, 4)}-${p(m, 2)}-${p(d, 2)}`;
}

/** Days since 1970-01-01 for a civil date. Pure integer (Hinnant). */
export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = y - (m <= 2 ? 1 : 0);
  const era = Math.floor((yy >= 0 ? yy : yy - 399) / 400);
  const yoe = yy - era * 400; // [0, 399]
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

/** Civil date from a 1970-epoch day-count. Inverse of {@link daysFromCivil}. */
export function civilFromDays(z: number): YMD {
  const zz = z + 719468;
  const era = Math.floor((zz >= 0 ? zz : zz - 146096) / 146097);
  const doe = zz - era * 146097; // [0, 146096]
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365); // [0, 399]
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const m = mp + (mp < 10 ? 3 : -9); // [1, 12]
  return { y: y + (m <= 2 ? 1 : 0), m, d };
}

const dayCount = (iso: string): number => { const { y, m, d } = parseISODate(iso); return daysFromCivil(y, m, d); };

/** Add `n` days (may be negative) to an ISO date, returning a new ISO date. */
export function addDaysISO(iso: string, n: number): string {
  return formatISODate(civilFromDays(dayCount(iso) + n));
}

/** ISO day-of-week: 0 = Monday … 6 = Sunday. */
export function isoDayOfWeek(iso: string): number {
  // 1970-01-01 (day 0) is a Thursday → Sunday-indexed weekday = (z + 4) mod 7.
  const sun = (((dayCount(iso) + 4) % 7) + 7) % 7; // 0 = Sunday
  return (sun + 6) % 7; // 0 = Monday
}

/** The Monday (`"YYYY-MM-DD"`) of the ISO week containing `iso`. */
export function mondayOfISO(iso: string): string {
  return addDaysISO(iso, -isoDayOfWeek(iso));
}

/** ISO-8601 week number (1–53) of the week containing `iso`. */
export function isoWeekNumber(iso: string): number {
  const z = dayCount(iso);
  const thursday = z - isoDayOfWeek(iso) + 3; // Thursday fixes the ISO week-year
  const { y } = civilFromDays(thursday);
  const jan1 = daysFromCivil(y, 1, 1);
  return Math.floor((thursday - jan1) / 7) + 1;
}

/**
 * The most recent COMPLETE Monday..Sunday week STRICTLY before `todayISO`.
 *
 * The week containing `todayISO` is never complete before its own Sunday
 * elapses, so the last guaranteed-complete week is always the one before it —
 * `[thisMonday - 7d, thisMonday - 1d]` — regardless of which weekday `today` is.
 * This is the window the Jobs `{{lastFullWeek*}}` tokens resolve to (F5 P5).
 */
export function lastFullWeek(todayISO: string): { startISO: string; endISO: string } {
  const thisMonday = mondayOfISO(todayISO);
  return { startISO: addDaysISO(thisMonday, -7), endISO: addDaysISO(thisMonday, -1) };
}
