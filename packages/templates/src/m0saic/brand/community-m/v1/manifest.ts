import * as fs from "fs";
import * as path from "path";
import type { CommunityMSlot } from "@m0saic/types";
import { loadCommunityManifestFromDir, resolveCommunityPath } from "@m0saic/platform/communityM/node";
import { seedCommunityDir } from "./paths";
import { buildTarget, type BuildTargetResult } from "./target";

/**
 * The NODE reader: load a community-m folder off disk and resolve the
 * target inside it. The bundled seed by default; the app / CLI cache when
 * the host pre-fills `communityDir`. Everything past this file is
 * filesystem-free (see `target.ts`), which is what lets the browser build
 * render the same beats.
 */
export function resolveTarget(opts: {
  communityDir: string;
  m: string;
  tile: string;
  asOf: "now" | "claim";
  allowUnclaimed?: boolean;
}): BuildTargetResult & { dir?: string } {
  const dir = opts.communityDir.trim() === "" ? seedCommunityDir() : path.resolve(opts.communityDir);
  const loaded = loadCommunityManifestFromDir(dir);
  if (!loaded.ok) return { ok: false, error: `community-m folder: ${loaded.error}` };

  // A picture only counts if it is really on disk — a missing image paints
  // as dormant, and never fails the render.
  const pictureFor = (slot: CommunityMSlot) => {
    if (!slot.tile) return null;
    const abs = resolveCommunityPath(dir, slot.tile);
    return fs.existsSync(abs) ? ({ kind: "file", path: abs } as const) : null;
  };

  const r = buildTarget(loaded.manifest, { ...opts, pictureFor });
  if (!r.ok) return r;
  // The subject's own piece must exist when we intend to read it.
  if (!r.target.synthetic) {
    const piece = resolveCommunityPath(dir, r.target.slot.piece);
    if (!fs.existsSync(piece)) return { ok: false, error: `piece file missing: ${piece}` };
  }
  return { ok: true, target: r.target, dir };
}

/** Absolute path of a slot's `.mosaic` piece inside a community folder. */
export function pieceAbsFor(dir: string, slot: CommunityMSlot): string {
  return resolveCommunityPath(dir, slot.piece);
}

export { identityLine, tileLine } from "./target";
export type { ProvenanceTarget } from "./target";
