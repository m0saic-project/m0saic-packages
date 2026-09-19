import type { MosaicDocument } from "@m0saic/types";
import type { LoadedPiece } from "./piece";

/**
 * The contributor's own canvas, in the browser.
 *
 * The web app serves each seed slot's `piece.mosaic` next to its tile, so the
 * real canvas plays here rather than a stand-in card. What it CANNOT do is
 * bring the piece's own media with it — slot assets are not served — so a
 * piece that references files is declined and the caller falls back (and
 * says Desktop renders that one for real).
 *
 * Deliberately narrow: this is untrusted third-party data arriving over the
 * network, so it must look exactly like what the seed ships or be refused.
 */

export type WebPieceResult = { ok: true; piece: LoadedPiece } | { ok: false; error: string };

/** Source kinds a served piece may use — everything else needs files or the engine. */
const ALLOWED_SOURCE_KINDS = new Set(["lavfi", "text", "mosaic"]);

export function acceptWebPiece(raw: unknown): WebPieceResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "piece is not an object" };
  const doc = raw as Partial<MosaicDocument> & { assets?: Record<string, unknown>; sources?: { type?: string }[] };
  if (doc.kind !== "mosaic_document") return { ok: false, error: `piece kind is "${String(doc.kind)}"` };
  const size = doc.size;
  if (!size || !(size.width > 0) || !(size.height > 0)) return { ok: false, error: "piece declares no size" };
  if (typeof doc.durationMs !== "number" || !(doc.durationMs > 0)) return { ok: false, error: "piece declares no durationMs" };
  if (doc.assets && Object.keys(doc.assets).length > 0) {
    return { ok: false, error: "piece carries its own media, which the browser cannot reach" };
  }
  if (!Array.isArray(doc.sources) || doc.sources.length === 0) return { ok: false, error: "piece has no sources" };
  for (const s of doc.sources) {
    if (!s || !ALLOWED_SOURCE_KINDS.has(String(s.type))) {
      return { ok: false, error: `piece uses a "${String(s?.type)}" source, which the browser cannot render` };
    }
  }
  const d = raw as MosaicDocument;
  return { ok: true, piece: { doc: d, declaredMs: d.durationMs as number, size: { width: size.width, height: size.height } } };
}

/** Fetch a served piece. Never throws — an unreachable piece is a fallback, not a failure. */
export async function fetchWebPiece(url: string): Promise<WebPieceResult> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return { ok: false, error: `piece not served (${resp.status})` };
    return acceptWebPiece(await resp.json());
  } catch (err) {
    return { ok: false, error: `piece unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}
