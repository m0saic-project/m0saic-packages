/**
 * ============================================================================
 * The slot before the footage — a media template's stand-in (0.3.1, NEW file)
 * ============================================================================
 *
 * A template whose SUBJECT is a dropped file used to answer "no source yet"
 * with a fail-fast error card: no rect, so nothing on the Make canvas could
 * take the file, and nothing could be edited until one arrived. The 0.3.1
 * generation answers with a STAND-IN instead — a document that shows where
 * the footage goes and takes it:
 *
 *   - one rounded SLOT tile, carrying the template's handles (the media prop
 *     first: in Make a media-bound rect is a drop target with a dashed
 *     outline and an "Add …" glyph) and the `incomplete` marker;
 *   - a title line ("Drop a video here") and a hint line (what happens next).
 *
 * `engine.renderStatus: "incomplete"` on the slot is what hosts read: Make
 * gates MAKE on it without blaming the last edit (`renderableNeedsInput`
 * scans the root document's sources) and the CLI exits 3 with the message.
 * So nothing is written as if it were a deliverable — but the template is on
 * screen, and its knobs are live, before the footage exists.
 *
 * Node-free on purpose (colour tiles + text; no asset): web-registered
 * templates can use it. A template with a richer layout builds its OWN
 * stand-in from its real geometry (screencap grid's placeholder tiles) and
 * stamps the same marker — see {@link markIncomplete}.
 * ============================================================================
 */

import type { MosaicColor, MosaicDocument, MosaicSource, MosaicTextSource } from "@m0saic/types";
import { weightedSplit } from "@m0saic/dsl-stdlib";
import { bindProps, makeColorTile, tag, type PropBindingEntry } from "@m0saic/template-utils";

/** Canvas behind the slot. */
export const STAND_IN_CANVAS = "#11141a" as MosaicColor;
/** The slot (and a richer stand-in's placeholder tiles). */
export const STAND_IN_TILE = "#1c212b" as MosaicColor;
/** The second tone of a placeholder check. */
export const STAND_IN_TILE_ALT = "#232a36" as MosaicColor;
const STAND_IN_EDGE = "#3a4352" as MosaicColor;
const STAND_IN_INK = "#e6e9ef" as MosaicColor;
const STAND_IN_INK_SOFT = "#9aa3b2" as MosaicColor;

/**
 * Stamp a source as "waiting on an input" (in place; returns it). Exactly one
 * source of the ROOT document needs it. `message` is what the CLI prints and
 * Make shows — say what is missing: "Easy Blur: drop a video or image".
 */
export function markIncomplete<T extends MosaicSource>(src: T, message: string): T {
  (src as MosaicSource & { engine?: unknown }).engine = { renderStatus: "incomplete", renderError: { message } };
  return src;
}

/** Is this renderable's root document a stand-in (some source marked incomplete)? */
export function isStandIn(doc: { sources?: ReadonlyArray<unknown> } | null | undefined): boolean {
  return (doc?.sources ?? []).some((s) => (s as { engine?: { renderStatus?: string } } | null)?.engine?.renderStatus === "incomplete");
}

export type MediaStandInOptions = {
  width: number;
  height: number;
  /** The template's name, for the marker's message ("Easy Blur"). */
  name: string;
  /** What to drop, on the slot: "Drop a video or image here". */
  title: string;
  /** One more line — what happens once it is there. */
  hint?: string;
  /** The slot's handles, the MEDIA prop first (it is what a dropped file writes). */
  handles: ReadonlyArray<PropBindingEntry>;
  fps?: number;
  durationMs?: number;
  /**
   * The stand-in is a CHILD of the document that is returned (the slot sits
   * under a stamp, say): leave its slot unmarked — hosts read the marker off
   * the ROOT document's sources, so the parent marks the source that refs it.
   */
  nested?: boolean;
};

const line = (text: string, fontSize: number, color: MosaicColor, label: string): MosaicSource =>
  tag(
    {
      type: "text",
      visual: { backgroundColor: "black@0" },
      layers: [{ content: { kind: "literal", text }, style: { fontSize, fontColor: color }, placement: { fit: "contain", hAlign: "center", vAlign: "middle" } as never }],
    } as MosaicTextSource as MosaicSource,
    label,
  );

/**
 * The stand-in document: a rounded slot on a quiet canvas, a title and a hint.
 * Sources (m0 paint order): `stand-in-slot`, `stand-in-title`, [`stand-in-hint`].
 */
export function mediaStandInDocument(o: MediaStandInOptions): MosaicDocument {
  const W = Math.max(1, Math.round(o.width));
  const H = Math.max(1, Math.round(o.height));
  const S = Math.min(W, H);
  const titleFont = Math.max(14, Math.round(S * 0.055));
  const hintFont = Math.max(11, Math.round(S * 0.028));

  const slotTile = bindProps(
    tag(
      makeColorTile(STAND_IN_TILE, {
        effects: {
          rounding: { cornerStyle: "rounded", borderRadius: 0.06 },
          stroke: { position: "inner", width: 0.004, color: STAND_IN_EDGE, alpha: 1 },
        },
      }) as MosaicSource,
      "stand-in-slot",
    ),
    o.handles,
  );
  const slot = o.nested ? slotTile : markIncomplete(slotTile, `${o.name}: ${o.title}`);

  const hasHint = !!(o.hint && o.hint.trim());
  // Text band inside the slot: [pad · title · (hint) · pad], in tenths of its height.
  const text = hasHint
    ? String(weightedSplit([40, 12, 8, 40], "row", { claimants: ["-", "1", "1", "-"] }))
    : String(weightedSplit([44, 12, 44], "row", { claimants: ["-", "1", "-"] }));
  const slotCell = `1{${text}}`;
  const col = String(weightedSplit([7, 86, 7], "col", { claimants: ["-", slotCell, "-"] }));
  const m0 = String(weightedSplit([9, 82, 9], "row", { claimants: ["-", col, "-"] }));

  return {
    kind: "mosaic_document",
    version: 1,
    assets: {} as never,
    m0: m0 as never,
    sources: [slot, line(o.title, titleFont, STAND_IN_INK, "stand-in-title"), ...(hasHint ? [line(o.hint!, hintFont, STAND_IN_INK_SOFT, "stand-in-hint")] : [])],
    backgroundColor: STAND_IN_CANVAS,
    size: { width: W, height: H },
    ...(o.fps != null ? { fps: o.fps } : {}),
    ...(o.durationMs != null ? { durationMs: o.durationMs } : {}),
    // A card has no soundtrack (the error-mosaic rule: no silent placeholder track).
    audio: { mode: "off" },
  } as MosaicDocument;
}
