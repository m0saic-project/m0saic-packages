/**
 * Folder → media file list expansion.
 *
 * Shared by the CLI (`--input-dir`) and the desktop app (folder picker IPC).
 * Both call into here so the set of "what counts as a video file" stays
 * consistent across surfaces.
 *
 * Uses `node:fs` / `node:path`, so this module is NOT re-exported from
 * `@m0saic/platform` root — webpack-bound callers (the web bundle) must
 * import via `@m0saic/platform/media`. Same convention as `template-repos`,
 * `secrets`, `host-connections`.
 *
 * Extension sets come from `@m0saic/types/defaults/media` so the matching
 * stays canonical with the rest of the system (mediaType inference, output
 * format detection, etc.).
 */
import * as fs from "node:fs";
import * as path from "node:path";

import {
  IMAGE_FILE_EXTENSIONS,
  VIDEO_FILE_EXTENSIONS,
} from "@m0saic/types";
import type { MosaicMediaKind } from "@m0saic/types";

/**
 * Media kinds `expandFolder` can include. A subset of `MosaicMediaKind`
 * because folder-expansion for `"audio"` isn't a surface the templates
 * use today — add it here when an audio-consuming template needs it.
 */
export type ExpandFolderKind = Extract<MosaicMediaKind, "video" | "image">;

export type ExpandFolderOptions = {
  /**
   * Which media kinds to include. Default: `["video"]` — matches the
   * user-facing "every video in this folder" flow.
   */
  kinds?: ExpandFolderKind[];
  /**
   * Recurse into subdirectories. Default: `false` — flat listing is the
   * safer default for the folder-picker UX (a user pointing at a folder
   * expects "these files", not "everything underneath this tree").
   */
  recursive?: boolean;
};

function dottedExtSet(exts: readonly string[]): Set<string> {
  return new Set(exts.map((e) => `.${e.toLowerCase()}`));
}

function extensionsForKinds(kinds: ExpandFolderKind[]): Set<string> {
  const merged = new Set<string>();
  for (const k of kinds) {
    const src =
      k === "video" ? VIDEO_FILE_EXTENSIONS : IMAGE_FILE_EXTENSIONS;
    for (const ext of src) merged.add(`.${ext.toLowerCase()}`);
  }
  return merged;
}

/** Pre-computed extension sets exposed for callers that need the same filter. */
export const VIDEO_EXTENSIONS: ReadonlySet<string> = dottedExtSet(
  VIDEO_FILE_EXTENSIONS,
);
export const IMAGE_EXTENSIONS: ReadonlySet<string> = dottedExtSet(
  IMAGE_FILE_EXTENSIONS,
);

/**
 * Walk `dir` and return absolute paths for every file whose extension is
 * in the allowed set. Sorted alphabetically for deterministic output.
 *
 * Throws if `dir` doesn't exist or isn't a directory. Returns an empty
 * array when the directory exists but has no matching files.
 *
 * Hidden files (leading dot) and symlinks are skipped. With
 * `recursive: true` the walk follows directory entries depth-first;
 * symlinked subdirectories are skipped to avoid cycles.
 */
export function expandFolder(
  dir: string,
  opts: ExpandFolderOptions = {},
): string[] {
  const kinds = opts.kinds ?? ["video"];
  const recursive = opts.recursive ?? false;
  const exts = extensionsForKinds(kinds);

  const absDir = path.resolve(dir);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absDir);
  } catch {
    throw new Error(`expandFolder: path does not exist: ${absDir}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`expandFolder: not a directory: ${absDir}`);
  }

  const results: string[] = [];
  walk(absDir, exts, recursive, results);
  results.sort((a, b) => a.localeCompare(b, "en"));
  return results;
}

function walk(
  current: string,
  exts: ReadonlySet<string>,
  recursive: boolean,
  out: string[],
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isSymbolicLink()) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (recursive) walk(full, exts, recursive, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (exts.has(ext)) out.push(full);
  }
}
