import * as fs from "fs";
import * as path from "path";
import type { CommunityMManifest } from "@m0saic/types";
import { parseCommunityMManifest } from "../parseCommunityMManifest";

export type LoadCommunityManifestResult =
  | { ok: true; manifest: CommunityMManifest; dir: string; indexPath: string }
  | { ok: false; code: "MISSING" | "UNREADABLE" | "INVALID"; error: string };

/**
 * Read + validate `<dir>/index.json`. Never throws — a missing or corrupt
 * checkout/cache must degrade (to the bundled seed) rather than crash.
 */
export function loadCommunityManifestFromDir(dir: string): LoadCommunityManifestResult {
  const indexPath = path.join(dir, "index.json");
  if (!fs.existsSync(indexPath)) {
    return { ok: false, code: "MISSING", error: `no index.json in ${dir}` };
  }
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch (err) {
    return {
      ok: false,
      code: "UNREADABLE",
      error: `${indexPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const parsed = parseCommunityMManifest(json);
  if (!parsed.ok) return { ok: false, code: "INVALID", error: `${indexPath}: ${parsed.error}` };
  return { ok: true, manifest: parsed.manifest, dir: path.resolve(dir), indexPath };
}

/** Absolute path of a repo-root-relative manifest path inside `dir`. */
export function resolveCommunityPath(dir: string, relPath: string): string {
  return path.join(dir, ...relPath.split("/"));
}
