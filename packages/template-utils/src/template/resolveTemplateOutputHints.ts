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
 *
 * ⭐ The reserved `outputFormat` KNOB wins over the static `format` hint
 * (0.3.1). A template whose deliverable is per-render — trickplay's
 * png / jpeg / mp4, screencap-grid's png / mp4, highlights' mp4 / webm —
 * carries a prop named `outputFormat` holding a container name, AND a static
 * `outputHints.format` equal to that knob's default (so a share link at
 * defaults carries no format ask). The knob is the more specific statement:
 * with it set to `mp4`, the deliverable IS a video, whatever the browse-time
 * hint says. The CLI has applied that order since the knob existed; hosts
 * that read only these hints (the desktop render handler, Make's Output
 * Type) did not, so a knob off its default was refused at render — "Output
 * extension implies container "mp4" but resolved container is "png""
 * (founder, 2026-10-01, Trickplay). It lives HERE so every host gets it,
 * frozen templates included. Precedence: static hint < the knob < a `format`
 * the template's own `resolveOutputHints` returns.
 */
export function resolveTemplateOutputHints<P extends MosaicTemplateProps>(
  template: Pick<MosaicTemplate<P>, "outputHints" | "resolveOutputHints" | "defaultProps">,
  props: Partial<P> | undefined,
): MosaicTemplateOutputHints {
  const merged = { ...(template.defaultProps ?? {}), ...(props ?? {}) } as P;
  const staticHints: MosaicTemplateOutputHints = { ...(template.outputHints ?? {}) };
  const knobFormat = formatFromOutputFormatKnob((merged as Record<string, unknown>).outputFormat, staticHints.format);
  const base: MosaicTemplateOutputHints = knobFormat ? { ...staticHints, format: knobFormat } : staticHints;
  const resolver = template.resolveOutputHints;
  if (typeof resolver !== "function") return base;

  let resolved: unknown;
  try {
    resolved = resolver(merged);
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

const IMAGE_CONTAINERS = new Set(["png", "jpeg", "webp"]);
const VIDEO_CONTAINERS = new Set(["mp4", "mov", "webm", "mkv"]);

/**
 * The format a reserved `outputFormat` knob asks for, or undefined when the
 * value names no container the hosts know (the static hint then stands) or
 * already equals the static hint (which is kept whole — its `pixelFormat`,
 * codec and the rest). A knob that MOVES the container yields the bare
 * `{ kind, container }`: the static hint's other fields described the other
 * container (an `rgba` pixel format means nothing to a jpeg).
 */
export function formatFromOutputFormatKnob(
  raw: unknown,
  staticFormat: MosaicTemplateOutputHints["format"] | undefined,
): MosaicTemplateOutputHints["format"] | undefined {
  if (typeof raw !== "string") return undefined;
  const lower = raw.trim().toLowerCase();
  const container = lower === "jpg" ? "jpeg" : lower;
  const kind = IMAGE_CONTAINERS.has(container) ? "image" : VIDEO_CONTAINERS.has(container) ? "video" : null;
  if (!kind) return undefined;
  if (staticFormat && staticFormat.container === container && (staticFormat.kind ?? kind) === kind) return undefined;
  return { kind, container } as MosaicTemplateOutputHints["format"];
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
