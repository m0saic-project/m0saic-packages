/**
 * Pure ffmpeg version parsing + comparison. No Node-only imports, so
 * this module is safe to bundle into the web app (whereas the sibling
 * `probe.ts` shells out via child_process and is electron/Node only).
 *
 * Two public entry points:
 *   - compareFfmpegVersionToEpoch — verdict for "is the user older /
 *     newer than the m0saic baseline?"
 *   - describeFfmpegVersion       — structured shape for UI annotation
 *     ("tagged · n8.0.1 · 2025-11-20", "nightly · 2026-04-30 · ~ post
 *     n8.1").
 *
 * Both consume an optional `releaseDates` lookup of `version →
 * YYYY-MM-DD` sourced from upstream ffmpeg git tags. Pass
 * `ffmpegReleaseDates` from @m0saic/docs.
 */

export type EpochVerdict = "at" | "post" | "pre" | "unknown";

const BUILD_DATE_RE = /-(\d{8})\b/;
// Captures the major.minor[.patch] of a tagged ffmpeg release, e.g.
// "ffmpeg version 8.0.1 ...", "ffmpeg version 7.1 ...", "ffmpeg-6.0".
// Anchored on a non-digit prefix so the BtbN N-build counter
// (e.g. "N-124278-...") doesn't get misread as version 124278.
const RELEASE_VERSION_RE = /(?:^|[^\d])(\d+)\.(\d+)(?:\.(\d+))?(?![.\d])/;
// `ffmpeg -version` always emits a line like
//   "Copyright (c) 2000-YYYY the FFmpeg developers"
// The trailing year is a coarse but reliable freshness signal for
// tagged releases that lack a build-date stamp — Homebrew's
// "ffmpeg 8.0.1 Copyright (c) 2000-2025 …" is from 2025, so it can be
// compared against a baseline nightly's build year.
const COPYRIGHT_YEAR_RE = /Copyright\s*\(c\)\s*\d{4}\s*-\s*(\d{4})/i;

function parseBuildDate(version: string): number | null {
  if (!version) return null;
  const match = version.match(BUILD_DATE_RE);
  if (!match) return null;
  const yyyymmdd = match[1];
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return null;
  }
  return y * 10000 + m * 100 + d;
}

/** Year-only signal from either a `-YYYYMMDD` build stamp OR a
 *  `Copyright (c) YYYY-YYYY` line. Year granularity, not day, so it
 *  only resolves comparisons that span a calendar year. */
function parseYear(version: string): number | null {
  if (!version) return null;
  const buildDate = parseBuildDate(version);
  if (buildDate !== null) return Math.floor(buildDate / 10000);
  const m = version.match(COPYRIGHT_YEAR_RE);
  if (m) {
    const y = Number(m[1]);
    return Number.isFinite(y) ? y : null;
  }
  return null;
}

type ReleaseVersion = { major: number; minor: number; patch: number };

function parseReleaseVersion(version: string): ReleaseVersion | null {
  if (!version) return null;
  const m = version.match(RELEASE_VERSION_RE);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: m[3] !== undefined ? Number(m[3]) : 0,
  };
}

function compareReleaseVersions(a: ReleaseVersion, b: ReleaseVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * Extract the major version number from an ffmpeg `-version` line, or
 * `null` when the string carries no tagged x.y release number — which is
 * the case for BtbN nightly N-builds ("ffmpeg version N-124278-g…"): those
 * have no semver, only a build counter + date stamp.
 *
 * This is a FALLBACK capability signal only. The PRIMARY signal is the
 * libavfilter major (present on every build, tagged AND nightly —
 * `probeFfmpegVersion().libavfilterMajor`); callers use the release major
 * from here only when that's absent. A `null` here means "unknown — this
 * function cannot tell you", NOT "safe to treat as new": nightlies parse to
 * null but are NOT all post-7.0 (2020–2023 git-master nightlies exist). The
 * caller must have a better signal (libavfilter) before deciding; a standalone
 * null verdict from this function must never be read as "new".
 */
export function parseFfmpegMajorVersion(versionLine: string): number | null {
  // Reuse the module-private release parser so the BtbN N-counter guard
  // (RELEASE_VERSION_RE anchored on a non-digit prefix) applies here too —
  // "N-124278-…" has no x.y match → null.
  const release = parseReleaseVersion(versionLine);
  return release ? release.major : null;
}

/**
 * Look up the release date of a tagged ffmpeg version, given a
 * `version → YYYY-MM-DD` map. Returns the date as a numeric
 * YYYYMMDD (same shape as parseBuildDate) for direct comparison, or
 * null if the version doesn't parse as a release tag or isn't in the
 * lookup. The map is sourced from upstream git tag committer dates;
 * see @m0saic/docs ffmpegReleaseDates for the canonical snapshot.
 */
function lookupReleaseDate(
  version: string,
  releaseDates: Readonly<Record<string, string>> | null | undefined,
): number | null {
  if (!releaseDates) return null;
  const release = parseReleaseVersion(version);
  if (!release) return null;
  // Try "major.minor.patch" first (most specific), then "major.minor"
  // when patch is zero — the version string sometimes omits the patch.
  const fullKey = `${release.major}.${release.minor}.${release.patch}`;
  const shortKey = `${release.major}.${release.minor}`;
  const iso = releaseDates[fullKey] ?? (release.patch === 0 ? releaseDates[shortKey] : undefined);
  if (!iso) return null;
  // ISO "YYYY-MM-DD" → YYYYMMDD numeric.
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
}

/**
 * Format a YYYYMMDD numeric date back to an ISO "YYYY-MM-DD" string,
 * the inverse of parseBuildDate. Used by describeFfmpegVersion when
 * surfacing the build date back to the UI.
 */
function formatYYYYMMDD(numeric: number): string {
  const y = Math.floor(numeric / 10000);
  const m = Math.floor((numeric % 10000) / 100);
  const d = numeric % 100;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Find the latest tagged release at-or-before `buildDate` from a
 * release-date lookup. Used to give an N-build nightly a human-
 * readable "tracking ~ post n8.1" annotation by locating it on the
 * upstream release timeline. Returns null when the map has no
 * release older than the build date.
 */
function findReleaseAtOrBefore(
  buildDate: number,
  releaseDates: Readonly<Record<string, string>>,
): { version: string; date: string; numericDate: number } | null {
  let best: { version: string; date: string; numericDate: number } | null =
    null;
  for (const [version, date] of Object.entries(releaseDates)) {
    const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) continue;
    const numericDate = Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
    if (numericDate > buildDate) continue;
    if (!best || numericDate > best.numericDate) {
      best = { version, date, numericDate };
    }
  }
  return best;
}

/**
 * Structured description of an ffmpeg version string for UI display.
 *
 *   - `kind: "release"`  — tagged upstream release. `releaseTag` is the
 *      version as printed (e.g. "8.0.1"); `date` is the upstream
 *      release date if we have it in the lookup map.
 *   - `kind: "nightly"`  — BtbN N-build with a `-YYYYMMDD` stamp.
 *      `buildDate` is that stamp; `nearestRelease` is the latest
 *      tagged release at-or-before the build date — useful for placing
 *      the nightly on the release timeline ("~ post n8.1").
 *   - `kind: "unknown"`  — could not parse the version string.
 *
 * In every case `rawVersion` echoes the original string so the UI can
 * still surface what ffmpeg actually printed.
 */
export type FfmpegVersionDescription =
  | {
      kind: "release";
      rawVersion: string;
      releaseTag: string;
      date: string | null;
    }
  | {
      kind: "nightly";
      rawVersion: string;
      buildDate: string;
      nearestRelease: { version: string; date: string } | null;
    }
  | {
      kind: "unknown";
      rawVersion: string;
    };

/**
 * Classify a raw ffmpeg version string for UI annotation.
 *
 * Tagged releases (e.g. "ffmpeg version 8.0.1 Copyright (c) 2000-2025
 * the FFmpeg developers") are recognised even when the upstream release
 * date isn't in `releaseDates` — the `date` field is null in that case
 * and the UI can still show "tagged release".
 *
 * Nightly N-builds (e.g. "N-124278-gcc3ca17127-20260430") are dated
 * directly from the build stamp; the optional `releaseDates` map
 * powers the "nearestRelease" hint that lets the UI place the nightly
 * on the upstream release timeline.
 */
export function describeFfmpegVersion(
  rawVersion: string | null | undefined,
  releaseDates?: Readonly<Record<string, string>> | null,
): FfmpegVersionDescription {
  if (!rawVersion) return { kind: "unknown", rawVersion: "" };

  // Tagged release path. Day-precision wins via the lookup; we still
  // report kind="release" without a date when the tag isn't mapped.
  // Disambiguate from BtbN N-builds by checking for the `-YYYYMMDD`
  // build stamp — its presence means we're on a nightly even if the
  // string also contains semver-looking digits.
  const release = parseReleaseVersion(rawVersion);
  const hasBuildStamp = parseBuildDate(rawVersion) !== null;
  const looksReleaseTagged = release !== null && !hasBuildStamp;
  if (looksReleaseTagged) {
    const fullKey = `${release!.major}.${release!.minor}.${release!.patch}`;
    const shortKey = `${release!.major}.${release!.minor}`;
    const tag =
      releaseDates && fullKey in releaseDates
        ? fullKey
        : releaseDates && release!.patch === 0 && shortKey in releaseDates
          ? shortKey
          : fullKey;
    const date = releaseDates ? (releaseDates[tag] ?? null) : null;
    return {
      kind: "release",
      rawVersion,
      releaseTag: tag,
      date,
    };
  }

  // Nightly N-build path.
  const buildDate = parseBuildDate(rawVersion);
  if (buildDate !== null) {
    const nearest =
      releaseDates !== null && releaseDates !== undefined
        ? findReleaseAtOrBefore(buildDate, releaseDates)
        : null;
    return {
      kind: "nightly",
      rawVersion,
      buildDate: formatYYYYMMDD(buildDate),
      nearestRelease: nearest
        ? { version: nearest.version, date: nearest.date }
        : null,
    };
  }

  return { kind: "unknown", rawVersion };
}

export type EpochCompareOptions = {
  /**
   * Tagged-release lookup: `version → "YYYY-MM-DD"`. When provided,
   * tagged releases (e.g. "ffmpeg version 8.0.1") get promoted to
   * day-precision comparison instead of falling through to copyright
   * year. Pass `ffmpegReleaseDates` from @m0saic/docs.
   */
  releaseDates?: Readonly<Record<string, string>> | null;
};

/**
 * Compare an active ffmpeg version string against an epoch (baseline) version.
 *
 * Returns:
 *  - "at"      — same build date, or same tagged release.
 *  - "post"    — active is strictly newer.
 *  - "pre"     — active is strictly older.
 *  - "unknown" — cannot resolve confidently. Conservative.
 *
 * Matching strategy, in priority order (most precise first):
 *
 *  1. Exact string match → "at".
 *  2. Day-precision: pull a YYYYMMDD from either side via
 *       (a) a `-YYYYMMDD` BtbN build stamp, OR
 *       (b) tagged-release lookup against the optional `releaseDates`
 *           map (sourced from upstream git tag committer dates).
 *     Compare days when both sides resolve.
 *  3. Both sides are tagged releases → compare semver.
 *  4. Year-level fallback — copyright stamp or build year. Resolves
 *     mixed-format cases (release vs nightly) when the tag isn't in
 *     the release-dates map yet but years differ. Same-year mixed
 *     cases stay "unknown" because the copyright stamp doesn't tell
 *     us month-precision.
 *
 * We deliberately do NOT collapse "tagged release vs nightly" to a
 * blanket "release is pre" — there's no temporal ordering between
 * those two formats without an external signal. When neither side
 * carries a year and they're in different formats, "unknown" is the
 * honest answer.
 */
export function compareFfmpegVersionToEpoch(
  userVersion: string | null | undefined,
  epochVersion: string | null | undefined,
  options?: EpochCompareOptions,
): EpochVerdict {
  if (!userVersion || !epochVersion) return "unknown";
  if (userVersion === epochVersion) return "at";

  const releaseDates = options?.releaseDates ?? null;

  // 1) Day-precision: build stamp first, then tagged-release lookup.
  const userDate =
    parseBuildDate(userVersion) ?? lookupReleaseDate(userVersion, releaseDates);
  const epochDate =
    parseBuildDate(epochVersion) ?? lookupReleaseDate(epochVersion, releaseDates);
  if (userDate !== null && epochDate !== null) {
    if (userDate === epochDate) return "at";
    return userDate > epochDate ? "post" : "pre";
  }

  // 2) Both tagged releases (and neither was looked up above) — compare semver.
  const userRelease = parseReleaseVersion(userVersion);
  const epochRelease = parseReleaseVersion(epochVersion);
  if (userRelease && epochRelease) {
    const cmp = compareReleaseVersions(userRelease, epochRelease);
    if (cmp === 0) return "at";
    return cmp > 0 ? "post" : "pre";
  }

  // 3) Year-precision fallback — copyright year or build year.
  const userYear = parseYear(userVersion);
  const epochYear = parseYear(epochVersion);
  if (userYear !== null && epochYear !== null && userYear !== epochYear) {
    return userYear > epochYear ? "post" : "pre";
  }

  return "unknown";
}
