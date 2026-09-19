import * as fs from "fs";
import * as path from "path";
import type { MosaicDocument } from "@m0saic/types";
import { loadMosaicDocument } from "@m0saic/platform/mosaic/loadMosaicDocument";
import { COMMUNITY_PIECE_DEFAULT_LIMITS, validateCommunityPiece } from "@m0saic/platform/communityM/node";
import type { LoadedPiece } from "./piece";

/**
 * Load + validate the contributor's `.mosaic` piece (data only: local
 * media, colour, text, inline children; bounded size and duration; every
 * asset inside its own folder). Never throws — a bad piece is an error
 * card, not a crash.
 */
export function loadPiece(pieceAbs: string): { ok: true; piece: LoadedPiece } | { ok: false; error: string } {
  let raw: string;
  try {
    raw = fs.readFileSync(pieceAbs, "utf8");
  } catch (err) {
    return { ok: false, error: `piece unreadable: ${err instanceof Error ? err.message : String(err)}` };
  }
  let loaded;
  try {
    loaded = loadMosaicDocument(raw, pieceAbs);
  } catch (err) {
    return { ok: false, error: `piece invalid: ${err instanceof Error ? err.message : String(err)}` };
  }
  const v = validateCommunityPiece(loaded, { pieceDir: path.dirname(pieceAbs), ...COMMUNITY_PIECE_DEFAULT_LIMITS });
  if (!v.ok) return { ok: false, error: `piece rejected: ${v.errors.join("; ")}` };
  const doc = loaded as MosaicDocument;
  if (!doc.size || typeof doc.durationMs !== "number") return { ok: false, error: "piece must declare size and durationMs" };
  return { ok: true, piece: { doc, declaredMs: doc.durationMs, size: { width: doc.size.width, height: doc.size.height } } };
}
