import * as fs from "fs";
import * as path from "path";
import type { MosaicDocument, MosaicRenderableFile, MosaicSource } from "@m0saic/types";

export type CommunityPieceLimits = {
  /** Directory the piece lives in; every file asset must resolve inside it. */
  pieceDir: string;
  /** Declared `durationMs` cap. */
  maxDurationMs: number;
  /** Sum of all referenced asset bytes. */
  maxAssetBytes: number;
  /** Any single referenced asset. */
  maxAssetFileBytes: number;
  /** Per-axis canvas cap for the piece and every nested child. */
  maxCanvas: number;
};

export const COMMUNITY_PIECE_DEFAULT_LIMITS: Omit<CommunityPieceLimits, "pieceDir"> = {
  maxDurationMs: 30_000,
  maxAssetBytes: 25 * 1024 * 1024,
  maxAssetFileBytes: 10 * 1024 * 1024,
  maxCanvas: 1920,
};

export type ValidateCommunityPieceResult =
  | { ok: true; assetBytes: number }
  | { ok: false; errors: string[] };

/** Source types a community piece may use. Data only — nothing that fetches or runs. */
const ALLOWED_SOURCE_TYPES: ReadonlySet<string> = new Set(["media", "lavfi", "text", "mosaic"]);

/**
 * Validate a contributor's `.mosaic` piece after `loadMosaicDocument` has
 * re-rooted its relative asset paths. Enforces the D8 contract: a piece is
 * **data only** — local media, colour, text and inline nested documents;
 * no refs, no data fetchers, no template invocations, no remote or inline
 * URIs, nothing outside its own folder, bounded size and duration.
 *
 * Pure given the filesystem (stat only, no reads beyond size).
 */
export function validateCommunityPiece(
  doc: MosaicRenderableFile,
  limits: CommunityPieceLimits,
): ValidateCommunityPieceResult {
  const errors: string[] = [];
  const pieceDir = path.resolve(limits.pieceDir);
  let assetBytes = 0;

  const visit = (node: unknown, where: string): void => {
    if (node == null || typeof node !== "object") {
      errors.push(`${where}: not a document`);
      return;
    }
    const kind = (node as { kind?: unknown }).kind;
    if (kind !== "mosaic_document") {
      errors.push(`${where}: kind must be "mosaic_document" (got ${String(kind)})`);
      return;
    }
    const d = node as MosaicDocument;

    if (where === "piece") {
      if (typeof d.durationMs !== "number" || !Number.isFinite(d.durationMs) || d.durationMs <= 0) {
        errors.push("piece: durationMs must be a positive number");
      } else if (d.durationMs > limits.maxDurationMs) {
        errors.push(`piece: durationMs ${d.durationMs} exceeds cap ${limits.maxDurationMs}`);
      }
      if (!d.size) errors.push("piece: size {width, height} is required");
    }
    if (d.size) {
      if (
        !Number.isInteger(d.size.width) ||
        !Number.isInteger(d.size.height) ||
        d.size.width <= 0 ||
        d.size.height <= 0
      ) {
        errors.push(`${where}: size must be positive integers`);
      } else if (d.size.width > limits.maxCanvas || d.size.height > limits.maxCanvas) {
        errors.push(`${where}: size ${d.size.width}×${d.size.height} exceeds ${limits.maxCanvas} per axis`);
      }
    }

    const sources: MosaicSource[] = Array.isArray(d.sources) ? d.sources : [];
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i] as { type?: string };
      if (!ALLOWED_SOURCE_TYPES.has(String(s.type))) {
        errors.push(`${where}.sources[${i}]: source type "${String(s.type)}" is not allowed in a community piece`);
      }
    }

    const assets = (d as { assets?: unknown }).assets;
    if (assets != null && typeof assets === "object" && !Array.isArray(assets)) {
      for (const [id, entry] of Object.entries(assets as Record<string, unknown>)) {
        const e = entry as { kind?: string; path?: unknown };
        if (e?.kind !== "file") {
          errors.push(`${where}.assets[${id}]: only kind "file" is allowed (got ${String(e?.kind)})`);
          continue;
        }
        if (typeof e.path !== "string" || e.path.length === 0) {
          errors.push(`${where}.assets[${id}]: missing path`);
          continue;
        }
        const abs = path.resolve(e.path);
        const rel = path.relative(pieceDir, abs);
        if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
          errors.push(`${where}.assets[${id}]: ${e.path} is outside the piece folder`);
          continue;
        }
        let st: fs.Stats;
        try {
          st = fs.statSync(abs);
        } catch {
          errors.push(`${where}.assets[${id}]: file not found: ${e.path}`);
          continue;
        }
        if (!st.isFile()) {
          errors.push(`${where}.assets[${id}]: not a file: ${e.path}`);
          continue;
        }
        if (st.size > limits.maxAssetFileBytes) {
          errors.push(`${where}.assets[${id}]: ${st.size} bytes exceeds per-file cap ${limits.maxAssetFileBytes}`);
        }
        assetBytes += st.size;
      }
    }

    const children = (d as { children?: unknown }).children;
    if (children != null && typeof children === "object" && !Array.isArray(children)) {
      for (const [name, child] of Object.entries(children as Record<string, unknown>)) {
        visit(child, `${where}.children.${name}`);
      }
    }
  };

  visit(doc, "piece");
  if (assetBytes > limits.maxAssetBytes) {
    errors.push(`piece: total asset bytes ${assetBytes} exceed cap ${limits.maxAssetBytes}`);
  }
  return errors.length === 0 ? { ok: true, assetBytes } : { ok: false, errors };
}
