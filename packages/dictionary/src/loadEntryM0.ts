import * as fs from "fs";
import * as path from "path";
import { parseM0File, parseM0cFile } from "@m0saic/dsl-file-formats";
import type { M0cMaskEntry, M0cRankSet } from "@m0saic/dsl-file-formats";

/**
 * Shape returned by {@link loadEntryM0}.
 *
 * `labels`, `masks`, and `rankSets` are `null` when the entry's source is
 * plain `.m0`; all three channels only exist on `.m0c`-sourced entries.
 */
export type LoadedEntryM0 = {
  m0: string;
  size: { width: number; height: number } | null;
  labels: Record<string, { text: string; color?: string }> | null;
  masks: Record<string, M0cMaskEntry | null> | null;
  rankSets: Record<string, M0cRankSet | null> | null;
};

/**
 * Read an entry's m0 payload from disk, auto-detecting `.m0c` vs `.m0`.
 *
 * Intended for an entry's own `m0saic.ts` loader (one call, returns the
 * canonical m0 string + optional size + optional labels). Keeps each
 * entry file a one-liner regardless of source format.
 *
 * Detection rules:
 *  - `m0saic.m0c` wins when present (carries labels).
 *  - `m0saic.m0`  is the fallback (legacy / label-less entries).
 *  - Having BOTH is an authoring error — throws.
 *  - Having NEITHER is a build error — throws.
 *
 * Labels and masks themselves flow into runtime via `metadata.json`
 * (written by `tools/validate.js`), not through this helper. This loader
 * is the source-of-truth for the m0 string only; labels and masks are
 * exposed here as a convenience for callers that want to bypass
 * metadata.json (build tools, the migration script, tests).
 *
 * @example
 * ```ts
 * // packages/dictionary/src/entries/brand/qr/m0saic.ts
 * import { loadEntryM0 } from "../../../loadEntryM0";
 * export const m0saic = loadEntryM0(__dirname).m0;
 * export default m0saic;
 * ```
 */
export function loadEntryM0(entryDir: string): LoadedEntryM0 {
  const m0cPath = path.join(entryDir, "m0saic.m0c");
  const m0Path = path.join(entryDir, "m0saic.m0");
  const hasM0c = fs.existsSync(m0cPath);
  const hasM0 = fs.existsSync(m0Path);

  if (!hasM0c && !hasM0) {
    throw new Error(
      [
        `Missing dictionary asset in ${entryDir}: expected m0saic.m0c or m0saic.m0`,
        `This usually means the dictionary build did not copy entry files into dist/.`,
        `Fix: ensure packages/dictionary build runs a copy step (e.g. copy src/**/*.m0(c)? -> dist/**).`,
      ].join("\n"),
    );
  }
  if (hasM0c && hasM0) {
    throw new Error(
      `Dictionary entry at ${entryDir} has BOTH m0saic.m0c and m0saic.m0 — pick one (m0c wins if you intend labels).`,
    );
  }

  if (hasM0c) {
    const parsed = parseM0cFile(fs.readFileSync(m0cPath, "utf8"));
    return {
      m0: parsed.m0,
      size: parsed.size ?? null,
      labels: parsed.labels ?? null,
      masks: parsed.masks ?? null,
      rankSets: parsed.rankSets ?? null,
    };
  }

  const parsed = parseM0File(fs.readFileSync(m0Path, "utf8"));
  return {
    m0: parsed.m0,
    size: parsed.size ?? null,
    labels: null,
    masks: null,
    rankSets: null,
  };
}
