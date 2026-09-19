/**
 * Font registry — resolves a CSS-style font request (family stack + weight +
 * style) to a concrete font FILE on disk. The svg text rasterizer needs a file
 * to hand opentype.js (`textToPath(fontPath)`); the engine's drawtext path can
 * use the same file for a deterministic `fontfile=`.
 *
 * Variants are registered by `registerFont` — the bundled pack self-registers
 * (see `./bundledFonts`), and later the host font scanner / downloaded pack
 * (see the internal font-sprint notes) register into the same store.
 *
 * Pure data — no disk I/O here; callers load the returned `path`.
 */

export type FontStyle = "normal" | "italic";

export interface FontVariant {
  /** Canonical family name, matched case-insensitively (e.g. "Roboto"). */
  family: string;
  /** CSS numeric weight, 100..900. */
  weight: number;
  style: FontStyle;
  /** Absolute path to the .ttf/.otf file. */
  path: string;
}

export interface ResolvedFont {
  path: string;
  /**
   * Set when the resolver had to substitute because the exact variant was
   * missing — a hint for faux synthesis (a later phase) and diagnostics.
   *   italic: requested italic but the family has no italic variant.
   *   bold:   requested a bold-ish weight (≥600) but the family tops out lighter.
   * Nearest-weight picks within the available range are NOT flagged (a real
   * neighbouring weight is "real enough").
   */
  faux: { bold: boolean; italic: boolean };
}

/** family(lowercased) → variants. */
const registry = new Map<string, FontVariant[]>();

/** CSS generic families — skipped during stack resolution (they have no file). */
const GENERIC = new Set([
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
]);

function normalizeWeight(w: number | "normal" | "bold" | undefined): number {
  if (w == null || w === "normal") return 400;
  if (w === "bold") return 700;
  return w;
}

function splitStack(family: string | undefined): string[] {
  if (!family) return [];
  return family
    .split(",")
    .map((s) => s.trim().replace(/^['"]+|['"]+$/g, ""))
    .filter(Boolean);
}

function nearestByWeight(list: FontVariant[], w: number): FontVariant {
  return list.reduce((best, e) =>
    Math.abs(e.weight - w) < Math.abs(best.weight - w) ? e : best,
  );
}

/** Register (or replace) a variant. Idempotent by (family, weight, style). */
export function registerFont(v: FontVariant): void {
  const key = v.family.trim().toLowerCase();
  const list = registry.get(key) ?? [];
  const i = list.findIndex((e) => e.weight === v.weight && e.style === v.style);
  if (i >= 0) list[i] = v;
  else list.push(v);
  registry.set(key, list);
}

function pickVariant(
  list: FontVariant[],
  wantWeight: number,
  wantStyle: FontStyle,
): ResolvedFont {
  // 1) exact weight + style
  const exact = list.find(
    (e) => e.weight === wantWeight && e.style === wantStyle,
  );
  if (exact) return { path: exact.path, faux: { bold: false, italic: false } };

  // 2) same style, nearest weight
  const sameStyle = list.filter((e) => e.style === wantStyle);
  if (sameStyle.length) {
    return {
      path: nearestByWeight(sameStyle, wantWeight).path,
      faux: { bold: false, italic: false },
    };
  }

  // 3) style unavailable → nearest weight at the other style; flag faux.
  const chosen = nearestByWeight(list, wantWeight);
  const hasBoldish = list.some((e) => e.weight >= 600);
  return {
    path: chosen.path,
    faux: {
      italic: wantStyle === "italic",
      bold: wantWeight >= 600 && !hasBoldish,
    },
  };
}

/**
 * Resolve a font request to a file. Walks the `family` stack (first registered,
 * non-generic family wins), else falls back to the bundled default family
 * ("Roboto"). Returns null only if the registry is empty (defensive — the
 * bundled pack self-registers on import).
 */
export function resolveFontFile(req: {
  family?: string;
  weight?: number | "normal" | "bold";
  style?: FontStyle;
}): ResolvedFont | null {
  const wantWeight = normalizeWeight(req.weight);
  const wantStyle: FontStyle = req.style === "italic" ? "italic" : "normal";

  for (const name of splitStack(req.family)) {
    if (GENERIC.has(name.toLowerCase())) continue;
    const list = registry.get(name.toLowerCase());
    if (list && list.length) return pickVariant(list, wantWeight, wantStyle);
  }

  const fallback = registry.get("roboto");
  if (fallback && fallback.length) {
    return pickVariant(fallback, wantWeight, wantStyle);
  }
  return null;
}

/** Registered families and the weights/styles available for each. */
export function listFontFamilies(): {
  family: string;
  weights: number[];
  styles: FontStyle[];
}[] {
  const out: { family: string; weights: number[]; styles: FontStyle[] }[] = [];
  for (const list of registry.values()) {
    if (!list.length) continue;
    out.push({
      family: list[0].family,
      weights: [...new Set(list.map((e) => e.weight))].sort((a, b) => a - b),
      styles: [...new Set(list.map((e) => e.style))],
    });
  }
  return out;
}
