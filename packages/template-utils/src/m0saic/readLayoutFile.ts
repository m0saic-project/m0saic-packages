/**
 * Read a layout file (`.m0` / `.m0c` / `.m0g` / `.m0p`) that ships as a sidecar
 * asset alongside a template, and parse it for use at render time.
 *
 * The model: a template can publish hand-authored layouts in its `assets/` dir
 * (mirrored to `dist/**​/assets/` by the templates build's copy-assets step) and
 * adopt them when it renders — e.g. a responsive `.m0p` pack whose variants are
 * the approved per-aspect layouts. This is the runtime counterpart to
 * {@link loadSession} (which reads a sandbox session directory): a single file,
 * format-detected, parsed.
 *
 *   const layout = readLayoutFile(path.resolve(__dirname, "assets", "chrome.m0p"));
 *   if (layout.kind === "m0p") { … findVariantBySize(layout.file, W, H) … }
 *
 * Pure file-system read; no side effects.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseM0File, parseM0cFile, parseM0pFile } from "@m0saic/dsl-file-formats";
import type { M0File, M0cFile, M0pFile } from "@m0saic/dsl-file-formats";

/** Discriminated parse result — `.m0g` is the `.m0c` (m0g) flavor. */
export type ReadLayoutResult =
  | { kind: "m0"; file: M0File }
  | { kind: "m0c"; file: M0cFile }
  | { kind: "m0p"; file: M0pFile };

type LayoutFormat = "m0" | "m0c" | "m0p";

/** Resolve the format from the file extension, falling back to a content sniff. */
function detectFormat(content: string, hintPath?: string): LayoutFormat {
  const ext = hintPath ? path.extname(hintPath).toLowerCase() : "";
  if (ext === ".m0p") return "m0p";
  if (ext === ".m0c" || ext === ".m0g") return "m0c";
  if (ext === ".m0") return "m0";
  // No (or unknown) extension → sniff: strip a leading comment block, JSON-parse,
  // read `format`; a non-JSON body is the text `.m0` DSL.
  const stripped = content.replace(/^\s*(?:#[^\n]*\n)+/, "");
  try {
    const obj = JSON.parse(stripped);
    if (obj && typeof obj === "object" && typeof obj.format === "string") {
      if (obj.format === "m0p") return "m0p";
      if (obj.format === "m0c" || obj.format === "m0g") return "m0c";
    }
  } catch {
    /* not JSON → text .m0 */
  }
  return "m0";
}

/** Parse already-read layout content. `hintPath` (optional) supplies the
 *  extension used for format detection; without it the content is sniffed. */
export function parseLayoutContent(content: string, hintPath?: string): ReadLayoutResult {
  switch (detectFormat(content, hintPath)) {
    case "m0p":
      return { kind: "m0p", file: parseM0pFile(content) };
    case "m0c":
      return { kind: "m0c", file: parseM0cFile(content) };
    default:
      return { kind: "m0", file: parseM0File(content) };
  }
}

/** Read + parse a layout sidecar file by absolute path. */
export function readLayoutFile(absPath: string): ReadLayoutResult {
  return parseLayoutContent(fs.readFileSync(absPath, "utf8"), absPath);
}
