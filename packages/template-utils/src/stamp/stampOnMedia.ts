/**
 * `stampOnMedia` — reusable composer that places one or more stamp
 * layers (a watermark: logo, wordmark, lockup — any self-contained
 * child document) onto a base source at an exact canvas rect.
 *
 * Generalizes `stampQrOnMedia` (codes/stampQr.ts): where that helper
 * is QR-specific and bottom-right-only, this one takes a pre-resolved
 * {@link StampRectPx} (from `resolveStampRect`'s nine positions or a
 * caller-parsed m0 escape hatch) and arbitrary child documents. The QR
 * composer stays untouched — its callers are not migrated.
 *
 * Layer alpha semantics (one of, per layer):
 *   - `alphaExpr` — a composed time-varying `overlay.alpha` expression
 *     (adaptive crossfade × windows × entrance × opacity).
 *   - `opacity`  — constant fast path, emitted as `visual.opacity` so
 *     the engine lowers it to `colorchannelmixer=aa=` (no geq).
 *
 * Pure: composes objects only; no I/O.
 */

import type {
  MosaicAssetManifest,
  MosaicDocument,
  MosaicSource,
} from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import { buildStampM0, type StampRectPx } from "./stampLayout";

// ── Types ─────────────────────────────────────────────────────

/** One stamp overlay layer. */
export type StampLayer = {
  /**
   * Self-contained child document (logo / text / lockup). Must declare
   * `size` — a nested child with no intrinsic media otherwise renders
   * at parent tile size and stretches.
   */
  child: MosaicDocument;
  /**
   * Composed `overlay.alpha` expression (time-varying). Omit for the
   * constant `opacity` fast path.
   */
  alphaExpr?: string;
  /** Constant opacity, emitted as `visual.opacity` when `alphaExpr` is absent. */
  opacity?: number;
  /** Children-map key suffix + editor label suffix (e.g. "light", "dark", "wm"). */
  key: string;
};

/** Options for {@link stampOnMedia}. */
export type StampOnMediaOptions = {
  /** Pre-built base tile source (typically media at `fit: "cover"`). */
  baseSource: MosaicSource;
  /** Asset manifest entries the base source references. */
  baseAssets: MosaicAssetManifest;
  canvasW: number;
  canvasH: number;
  /** Exact stamp cell (margins already baked into x/y). */
  rect: StampRectPx;
  /** Stamp layers, painted in order (1 for a single variant, 2 for light/dark). */
  layers: StampLayer[];
};

// ── Main ──────────────────────────────────────────────────────

/**
 * Compose stamp layers onto a base source. Returns a new
 * `MosaicDocument`; inputs are not mutated.
 *
 * Source order in the returned doc:
 *   [0]    = `baseSource` (fills the canvas via the outer `F`)
 *   [1..N] = one `type: "mosaic"` source per layer, each referencing a
 *            child registered under `wm_<key>` in `doc.children`,
 *            labeled `wm:<key>`.
 */
export function stampOnMedia(opts: StampOnMediaOptions): MosaicDocument {
  const { baseSource, baseAssets, canvasW, canvasH, rect, layers } = opts;
  if (!baseSource) {
    throw new Error("stampOnMedia: `baseSource` is required");
  }
  if (!layers || layers.length === 0) {
    throw new Error("stampOnMedia: `layers` must be non-empty");
  }
  if (rect.w < 1 || rect.h < 1) {
    throw new Error(
      `stampOnMedia: rect must have positive dimensions, got ${rect.w}x${rect.h}`,
    );
  }
  const keys = new Set<string>();
  for (const layer of layers) {
    if (!layer.key || keys.has(layer.key)) {
      throw new Error(
        `stampOnMedia: layer keys must be unique and non-empty, got ${JSON.stringify(layer.key)}`,
      );
    }
    keys.add(layer.key);
    if (!layer.child.size) {
      throw new Error(
        `stampOnMedia: layer "${layer.key}" child must declare \`size\` (a size-less nested child stretches to the cell)`,
      );
    }
  }

  const layout = buildStampM0({ canvasW, canvasH, rect, overlayCount: layers.length });

  const sources: MosaicSource[] = [baseSource];
  const children: Record<string, MosaicDocument> = {};
  for (const layer of layers) {
    const childKey = `wm_${layer.key}`;
    children[childKey] = layer.child;
    sources.push({
      type: "mosaic",
      ref: childKey,
      // The cell IS the stamp rect, so contain centers the exact-aspect
      // content; ±1px integer rounding is absorbed by the letterbox.
      placement: { fit: "contain" },
      ...(layer.alphaExpr
        ? { overlay: { alpha: layer.alphaExpr } }
        : layer.opacity != null
          ? { visual: { opacity: layer.opacity } }
          : {}),
      editor: { owner: "template", label: `wm:${layer.key}` },
    });
  }

  return {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String(String(layout.m0), "stampOnMedia"),
    sources,
    assets: { ...baseAssets },
    children,
    size: { width: canvasW, height: canvasH },
  };
}
