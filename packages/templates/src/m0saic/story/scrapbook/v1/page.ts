import type { MosaicDocument, MosaicSource } from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { toM0String, weightedSplit } from "@m0saic/dsl-stdlib";
import { bindProp, entrance, keyframeExpr, svgLabel } from "@m0saic/template-utils";
import type { Page } from "./pages";
import type { ResolvedProps } from "./props";

/**
 * One page of the scrapbook: a picture pinned slightly off square on paper,
 * with its line underneath.
 *
 * Two engine facts shape this:
 *
 *  - `effects.rotate` turns the content-fitted BUFFER, so a rotated source
 *    clips against its own box. The headroom has to be real geometry, so the
 *    picture lives in a child sized to the whole cell with the picture inset
 *    inside it — the empty margin is what the corners swing into. The child's
 *    ground is the SAME paper as the page, so the rotated rectangle is
 *    invisible and only the picture reads as tilted.
 *  - The drift is a camera on that child (zoom easing outward over the hold),
 *    not a resize: the picture keeps its native pixels and the move is
 *    resolution-independent.
 */

/** The picture's share of the page's height; the rest is the note. */
const PICTURE_ROWS = 7;
const NOTE_ROWS = 2;
/** The print's side, as a share of the picture band — the rest is paper. */
const PRINT_SHARE = 0.9;
/** The white mount around the picture, as a share of the print. */
const MOUNT = 0.055;

/** Alternating tilt, so consecutive pages do not lean the same way. */
export function tiltFor(index: number, tilt: number): number {
  if (tilt <= 0) return 0;
  const lean = index % 2 === 0 ? 1 : -1;
  // A third of a degree of variation so it never looks mechanical.
  const jitter = ((index * 37) % 7) / 7 - 0.5;
  return Number((lean * tilt * (0.75 + jitter * 0.5)).toFixed(3));
}

export function buildPageDoc(o: {
  page: Page;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  props: ResolvedProps;
  /**
   * When the page's own time starts, in seconds of the PARENT clock.
   *
   * As a pipeline step a page owns its clock and this is 0. As one layer of
   * a single document every layer shares the parent's clock, so the drift
   * and the arriving note have to be told when their page begins — or every
   * page animates at once, at the top of the film.
   */
  originSec?: number;
  /**
   * Whether the text arrives with its own entrance.
   *
   * FALSE as one layer of a single document. An svg text source carries its
   * own alpha (the box around the glyphs is transparent), and an entrance
   * overlay on top of that INSIDE a nested child replaces that alpha with
   * the ramp — the box goes opaque and the line renders as a solid slab of
   * the font colour. As a pipeline step, where the document owns its own
   * clock, the same source is fine. In document mode the layer's own fade
   * carries the arrival instead.
   */
  entrances?: boolean;
}): MosaicDocument {
  const { page, width: W, height: H, fps, durationMs, props: p } = o;
  const t0 = o.originSec ?? 0;
  const rows = PICTURE_ROWS + NOTE_ROWS;
  const bandH = Math.round((H * PICTURE_ROWS) / rows);
  const noteH = H - bandH;
  const sec = durationMs / 1000;
  const photoId = asAssetId(`photo_${page.index}`);
  const printSide = Math.max(2, Math.round((bandH * PRINT_SHARE) / 2) * 2);

  // The print: the picture on a white mount, the way a photograph is
  // actually stuck into a book. A square mount takes portrait and landscape
  // alike without either one dictating the page.
  const print: MosaicDocument = {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String("1", `Scrapbook-print-${page.index}`),
    size: { width: printSide, height: printSide },
    fps,
    durationMs,
    backgroundColor: "#FBF8F1" as never,
    audio: { mode: "off" },
    assets: {
      [photoId]: page.image.kind === "file"
        ? { kind: "file", path: page.image.path, mediaType: "image" }
        : { kind: "data-uri", uri: page.image.uri, mediaType: "image" },
    },
    sources: [
      { type: "media", mediaType: "image", assetId: photoId, placement: { fit: "contain", inset: MOUNT } } as MosaicSource,
    ],
  };

  // The band the print is pinned to. `effects.rotate` turns the content
  // BUFFER, so a rotated print would clip its own corners — the headroom
  // has to be real geometry. This band is cell-sized with the print inset
  // inside it, and its ground is the SAME paper as the page, so the band's
  // own rotation is invisible and only the print reads as tilted.
  const band: MosaicDocument = {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String("1", `Scrapbook-band-${page.index}`),
    size: { width: W, height: bandH },
    fps,
    durationMs,
    backgroundColor: p.paperColor as never,
    audio: { mode: "off" },
    assets: {},
    children: { print },
    sources: [{ type: "mosaic", ref: "print", placement: { fit: "contain" } } as MosaicSource],
  };

  // The drift: the camera eases outward across the hold. Small on purpose —
  // a scrapbook breathes, it does not zoom.
  const camera = p.drift > 0
    ? { zoom: keyframeExpr([{ t: t0, v: 1 + p.drift * 0.1 }, { t: t0 + sec, v: 1 }]), focusX: 0.5, focusY: 0.45 }
    : undefined;
  const rotate = tiltFor(page.index, p.tilt);
  const effects = { ...(rotate !== 0 ? { rotate } : {}), ...(camera ? { camera } : {}) };

  return {
    kind: "mosaic_document",
    version: 1,
    m0: weightedSplit([PICTURE_ROWS, NOTE_ROWS], "row", { precision: rows }),
    size: { width: W, height: H },
    fps,
    durationMs,
    backgroundColor: p.paperColor as never,
    audio: { mode: "off" },
    assets: {},
    children: { band },
    sources: [
      { type: "mosaic", ref: "band", ...(Object.keys(effects).length ? { effects } : {}) } as MosaicSource,
      // The line lands after the picture has settled — and it IS `notes[i]`,
      // so it can be written straight onto the page it belongs to.
      bindProp(
        {
          ...svgLabel(page.note, W, noteH, {
            color: p.inkColor as never,
            maxPx: Math.round(noteH * 0.3),
            maxLines: 2,
          }),
          ...(o.entrances === false ? {} : { overlay: entrance({ kind: "rise", durationMs: 620, atSec: t0 + 0.35, ease: "easeOut" }) }),
        } as MosaicSource,
        "notes",
        page.index,
      ),
    ],
  };
}
