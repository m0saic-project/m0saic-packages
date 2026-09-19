import type {
  MosaicTemplate,
  MosaicTemplateOutputHints,
  MosaicTemplateProps,
} from "@m0saic/types";

/**
 * The ONE place hosts turn a template + the current props into the output
 * hints they seed a render from: the static `outputHints`, with whatever the
 * template's `resolveOutputHints(props)` returns for THESE props merged over
 * it. CLI `make`, the desktop preview / cover / render handlers, the web
 * design preview and Make's Device anchor all go through here, so a
 * prop-driven canvas (a creator template's `platform`) reaches every host
 * the same way — before the render, not by reading the doc back afterwards.
 *
 * Tolerant by design: a hint must never kill a render. A resolver that
 * throws, returns a non-object, or returns junk fields is treated as
 * returning nothing (the static hints stand), and only well-formed values
 * survive the merge — finite positive numbers for width / height / fps /
 * durationMs / posterTimeMs, an object for format, a string for note.
 * Width and height are rounded to even pixels (the encoder's own floor).
 */
export function resolveTemplateOutputHints<P extends MosaicTemplateProps>(
  template: Pick<MosaicTemplate<P>, "outputHints" | "resolveOutputHints" | "defaultProps">,
  props: Partial<P> | undefined,
): MosaicTemplateOutputHints {
  const base: MosaicTemplateOutputHints = { ...(template.outputHints ?? {}) };
  const resolver = template.resolveOutputHints;
  if (typeof resolver !== "function") return base;

  let resolved: unknown;
  try {
    resolved = resolver({ ...(template.defaultProps ?? {}), ...(props ?? {}) } as P);
  } catch {
    return base;
  }
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) return base;
  const r = resolved as Record<string, unknown>;

  const dim = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.max(2, 2 * Math.round(v / 2)) : undefined;
  const pos = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;

  const width = dim(r.width);
  const height = dim(r.height);
  const fps = pos(r.fps);
  const durationMs = pos(r.durationMs);
  const posterTimeMs =
    typeof r.posterTimeMs === "number" && Number.isFinite(r.posterTimeMs) && r.posterTimeMs >= 0
      ? r.posterTimeMs
      : undefined;
  const format =
    r.format && typeof r.format === "object" && !Array.isArray(r.format)
      ? (r.format as MosaicTemplateOutputHints["format"])
      : undefined;
  const note = typeof r.note === "string" ? r.note : undefined;

  return {
    ...base,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(fps !== undefined ? { fps } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(posterTimeMs !== undefined ? { posterTimeMs } : {}),
    ...(format !== undefined ? { format } : {}),
    ...(note !== undefined ? { note } : {}),
  };
}

/** `{ w, h }` of the resolved hints, or null when the template has no size opinion. */
export function resolveTemplateHintDims<P extends MosaicTemplateProps>(
  template: Pick<MosaicTemplate<P>, "outputHints" | "resolveOutputHints" | "defaultProps">,
  props: Partial<P> | undefined,
): { w: number; h: number } | null {
  const hints = resolveTemplateOutputHints(template, props);
  const w = hints.width;
  const h = hints.height;
  return typeof w === "number" && w > 0 && typeof h === "number" && h > 0 ? { w, h } : null;
}
