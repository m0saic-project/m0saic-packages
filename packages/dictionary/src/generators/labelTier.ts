/**
 * Shared label-tier knob for dictionary generators.
 *
 * Generators that can emit named structural anchors (and optionally per-cell
 * enumeration) expose this via a `labels` param. Three tiers, log-level-ish
 * but evocative — the caller decides how much identity the generator carves
 * into the output, and the format follows:
 *
 *   - `silent`    → no labels emitted, generator returns plain `.m0`.
 *   - `signposts` → only named structural regions (e.g. "hero", "feature",
 *                   "safe-area", "letterbox-top"). Returns `.m0c`.
 *   - `atlas`     → signposts + per-cell / per-level enumeration (e.g.
 *                   "cell-r0c0", "rank-0", "level-1"). Returns `.m0c`.
 *
 * `off` is accepted as a spelling alias for `silent` in JSDoc / docs but the
 * canonical wire value is `silent` — the type below is the source of truth.
 *
 * Convention: when a generator's `labels` tier is non-silent OR the generator
 * emits masks, it returns its result with a populated `GeneratorResult.m0c`
 * field (serialized via `serializeM0cFile`). The DictionaryPanel's
 * `.m0`/`.m0c` badge reflects the active tier automatically.
 */

import { computeFeasibility, parseM0StringComplete } from "@m0saic/dsl";
import { serializeM0cFile, type M0Label } from "@m0saic/dsl-file-formats";

import type { GeneratorParamDescriptor } from "./types";

export type LabelTier = "silent" | "signposts" | "atlas";

export const LABEL_TIER_VALUES: readonly LabelTier[] = ["silent", "signposts", "atlas"] as const;

export function isLabelTier(v: unknown): v is LabelTier {
  return v === "silent" || v === "signposts" || v === "atlas";
}

/**
 * Build a `labels` enum param descriptor for a generator. Generators reuse
 * this so the tier semantics — and the tooltip — stay consistent everywhere.
 *
 * @param opts.defaultTier  The tier the generator defaults to. Most
 *   generators default `"silent"` (preserve existing plain-m0 behavior);
 *   QR defaults `"signposts"` (preserves its always-on label set).
 * @param opts.description  Optional generator-specific description appended
 *   to the shared tooltip. Use to call out what each tier emits in this
 *   generator (e.g. "signposts: hero + supporting; atlas: per-cell").
 */
/**
 * Resolve a generator's `labels` param value (anything coming back from
 * the descriptor schema) into a strict {@link LabelTier}. Anything that
 * isn't a canonical tier value falls back to `fallback` (default
 * `"silent"`) — matches each generator's per-descriptor default.
 *
 * The fallback param matters for generators called outside the UI (tests
 * / programmatic callers) where descriptor defaults aren't auto-applied.
 * QR for instance preserves its always-on label channel by passing
 * `resolveLabelTier(params.labels, "signposts")`; other generators that
 * default to `silent` can omit the second arg.
 */
export function resolveLabelTier(raw: unknown, fallback: LabelTier = "silent"): LabelTier {
  if (isLabelTier(raw)) return raw;
  return fallback;
}

/**
 * Build the optional `.m0c` blob a generator returns when its `labels`
 * tier is non-silent. Walks the generated m0 string to recover
 * source-ordered stableKeys, then maps each source-index from the
 * generator's `labelsBySourceIndex` table into a structural-key label
 * entry. Generators that want richer label keys (per-leaf groups,
 * overlays, logical owners) can drop in `keyedLabels` directly — they're
 * merged on top of the source-indexed translation.
 *
 * Returns `undefined` for the `silent` tier or when the generated m0
 * fails to parse — in those cases the caller's `GeneratorResult` skips
 * its `m0c` field and the editor falls back to plain `.m0` rendering.
 *
 * The split between `labelsBySourceIndex` (positional) and `keyedLabels`
 * (already-by-stableKey) lets generators reuse this helper whether they
 * think in source order (most do) or directly in stableKeys (QR, future
 * channel-aware generators).
 */
export function emitLabeledM0c(opts: {
  m0: string;
  size: { width: number; height: number };
  app: string;
  tier: LabelTier;
  /** Source-ordered label texts. Index 0 = first logical leaf. */
  labelsBySourceIndex?: Record<number, string>;
  /** Already-keyed labels (e.g. from generator-internal stableKey lookups). */
  keyedLabels?: Record<string, string>;
}): string | undefined {
  if (opts.tier === "silent") return undefined;

  const labels: Record<string, M0Label> = {};

  if (opts.labelsBySourceIndex && Object.keys(opts.labelsBySourceIndex).length > 0) {
    // StableKeys are purely structural — they don't depend on the
    // canvas dimensions — but `parseM0StringComplete` rejects dims that
    // would produce 0-size frames after rounding (the SPLIT_EXCEEDS_AXIS
    // guard). The caller's `size` may be a generic probe canvas that
    // doesn't meet the m0's feasibility floor (e.g. a gridded layout
    // with 152-precision splits won't parse at 1920×1080). Bump the
    // probe to max(declared-size, feasibility-min) so the parse always
    // succeeds for any well-formed m0 — labels are pure structure so
    // the inflated dims don't affect the result.
    const feas = (() => { try { return computeFeasibility(opts.m0); } catch { return null; } })();
    const probeW = Math.max(opts.size.width, feas?.minWidthPx ?? 1);
    const probeH = Math.max(opts.size.height, feas?.minHeightPx ?? 1);
    const result = parseM0StringComplete(opts.m0, probeW, probeH);
    if (!result.ok) return undefined;
    const sourceKeys = result.ir.renderFrames
      .slice()
      .sort((a, b) => a.logicalIndex - b.logicalIndex)
      .map((f) => String(f.meta.stableKey));
    for (const [idxStr, text] of Object.entries(opts.labelsBySourceIndex)) {
      const idx = Number(idxStr);
      const key = sourceKeys[idx];
      if (!key || !text) continue;
      labels[key] = { text };
    }
  }
  if (opts.keyedLabels) {
    for (const [k, text] of Object.entries(opts.keyedLabels)) {
      if (!text) continue;
      labels[k] = { text };
    }
  }

  if (Object.keys(labels).length === 0) return undefined;

  return serializeM0cFile({
    m0: opts.m0,
    size: opts.size,
    app: opts.app,
    labels,
  });
}

export function labelTierParam(opts: {
  defaultTier: LabelTier;
  description?: string;
}): GeneratorParamDescriptor {
  const base =
    "How much named identity to carve into the output. silent: plain m0, no labels. signposts: named regions only. atlas: signposts + per-cell.";
  return {
    key: "labels",
    title: "Labels",
    type: "enum",
    default: opts.defaultTier,
    description: opts.description ? `${base} ${opts.description}` : base,
    options: [
      { value: "silent", label: "Silent", description: "No labels. Returns plain m0." },
      // m0c emission is conditional — a generator that has no named
      // landmarks (e.g. a uniform grid) produces no labels at signposts
      // and still returns plain m0. Generators that have landmarks
      // (spotlight 'hero', magazine 'feature', etc.) flip to m0c.
      { value: "signposts", label: "Signposts", description: "Named landmarks only (e.g. hero, feature). Returns m0c if the generator has any; plain m0 otherwise." },
      { value: "atlas", label: "Atlas", description: "Landmarks + per-cell enumeration. Returns m0c." },
    ],
  };
}
