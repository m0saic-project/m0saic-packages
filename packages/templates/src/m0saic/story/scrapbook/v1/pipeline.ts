import type { AssetId, MosaicDocument, MosaicDocumentPipeline, MosaicPipelineStep, MosaicSource } from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { toM0String, weightedSplit } from "@m0saic/dsl-stdlib";
import { bindProp, entrance, svgLabel } from "@m0saic/template-utils";
import { buildPageDoc } from "./page";
import type { Page } from "./pages";
import type { ResolvedProps } from "./props";

/**
 * The film: an opening card, a page per picture, a closing line — every
 * join a cross-fade, because a scrapbook turns pages, it does not cut.
 *
 * Timing law (the same one the rest of the house keeps): a fade rides on
 * the OUTGOING step, so the stitched length equals the authored
 * `durationMs` exactly.
 */

export type ScrapbookPlan = {
  width: number;
  height: number;
  fps: number;
  props: ResolvedProps;
  pages: Page[];
};

/**
 * A card: a big line, and a small one under it when there is one.
 *
 * The rows are built from the text that EXISTS. An empty line is not an
 * empty row — a blank svg text source still paints its box, which is how
 * the closing card grew a grey bar the first time.
 */
export function cardDoc(o: {
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  props: ResolvedProps;
  headline: string;
  sub: string;
  /** Which prop the headline IS, so Make can edit it where it is drawn. */
  headlineProp: string;
  /** When this card's own time starts, on the PARENT clock (see buildPageDoc). */
  originSec?: number;
  /** See `buildPageDoc` — false as one layer of a single document. */
  entrances?: boolean;
}): MosaicDocument {
  const { width: W, height: H, fps, durationMs, props: p } = o;
  const t0 = o.originSec ?? 0;
  const hasSub = o.sub.trim() !== "";
  // Rows in UNITS, not pixels. Pixel weights would make this a split with
  // one slot per pixel of canvas — far past the planner's px-per-weight
  // floor, where cells quantize and squash.
  const units = hasSub ? [10, 11, 4] : [12, 13];
  const total = units.reduce((a, b) => a + b, 0);
  const headH = Math.round((H * units[1]) / total);
  const subH = hasSub ? Math.round((H * units[2]) / total) : 0;
  const sources: MosaicSource[] = [
    { type: "lavfi", color: p.paperColor } as MosaicSource,
    bindProp(
      {
        ...svgLabel(o.headline, W, headH, { color: p.inkColor as never, maxPx: Math.round(headH * 0.46), maxLines: 2 }),
        ...(o.entrances === false ? {} : { overlay: entrance({ kind: "rise", durationMs: 700, atSec: t0 + 0.15, ease: "easeOut" }) }),
      } as MosaicSource,
      o.headlineProp,
    ),
  ];
  if (hasSub) {
    sources.push(
      bindProp(
        {
          ...svgLabel(o.sub, W, subH, { color: p.accentColor as never, maxPx: Math.round(subH * 0.5), maxLines: 1 }),
          ...(o.entrances === false ? {} : { overlay: entrance({ kind: "fade", durationMs: 700, atSec: t0 + 0.55, ease: "easeOut" }) }),
        } as MosaicSource,
        "subtitle",
      ),
    );
  }
  return {
    kind: "mosaic_document",
    version: 1,
    m0: weightedSplit(units, "row", { precision: total }),
    size: { width: W, height: H },
    fps,
    durationMs,
    backgroundColor: p.paperColor as never,
    audio: { mode: "off" },
    assets: {},
    sources,
  };
}

/**
 * Put the music bed under one step. An audio-only source still holds a
 * frame, so it arrives as a nested leaf on the document's m0 — and it
 * starts `atMs` INTO the track, so the bed runs continuously across the
 * film instead of restarting on every page.
 */
function withMusic(doc: MosaicDocument, music: string, id: AssetId, atMs: number): MosaicDocument {
  if (!music) return doc;
  return {
    ...doc,
    m0: toM0String(`${String(doc.m0)}{F}`, "Scrapbook-audio"),
    audio: { mode: "auto" },
    assets: { ...(doc.assets ?? {}), [id]: { kind: "file", path: music, mediaType: "audio" } },
    sources: [
      ...doc.sources,
      { type: "media", mediaType: "audio", assetId: id, playback: { clipStartMs: Math.max(0, Math.round(atMs)) } } as MosaicSource,
    ],
  };
}

/** The whole film, as an `emit:"single"` pipeline. */
export function buildScrapbookPipeline(plan: ScrapbookPlan): MosaicDocumentPipeline {
  const { width: W, height: H, fps, props: p, pages } = plan;
  const x = Math.round(p.xfadeMs);
  const steps: MosaicPipelineStep[] = [];
  const fade = x > 0 ? ({ transitionToNext: { type: "fade" as const, durationMs: x } }) : {};

  const openMs = Math.round(p.introMs);
  const pageMs = Math.round(p.perPageMs);
  const closeMs = Math.round(p.outroMs);
  const music = p.music.trim();
  const musicId = asAssetId("music_bed");
  // Where the film has got to — the bed picks up from here on each step.
  let atMs = 0;

  if (openMs > 0) {
    const d = openMs + x;
    const doc = cardDoc({ width: W, height: H, fps, durationMs: d, props: p, headline: p.title, sub: p.subtitle, headlineProp: "title" });
    steps.push({ name: "open", label: "Opening", durationMs: d, file: withMusic(doc, music, musicId, atMs), ...fade });
    atMs += openMs;
  }
  pages.forEach((page, i) => {
    const last = i === pages.length - 1 && closeMs <= 0;
    const d = pageMs + (last ? 0 : x);
    const doc = buildPageDoc({ page, width: W, height: H, fps, durationMs: d, props: p });
    steps.push({
      name: `page-${page.index + 1}`,
      label: `Page ${page.index + 1}`,
      durationMs: d,
      file: withMusic(doc, music, musicId, atMs),
      ...(last ? {} : fade),
    });
    atMs += pageMs;
  });
  if (closeMs > 0) {
    const doc = cardDoc({ width: W, height: H, fps, durationMs: closeMs, props: p, headline: p.closing, sub: "", headlineProp: "closing" });
    steps.push({ name: "close", label: "Closing", durationMs: closeMs, file: withMusic(doc, music, musicId, atMs) });
  }

  // Fades ride on the outgoing step, so the stitched total is exactly this.
  const totalMs = openMs + pageMs * pages.length + closeMs;

  return {
    kind: "mosaic_pipeline",
    version: 1,
    emit: "single",
    size: { width: W, height: H },
    fps,
    durationMs: totalMs,
    durationFit: "cut",
    defaultTransition: { type: "cut" },
    backgroundColor: p.paperColor as never,
    steps,
  };
}

/** The film's natural length, for the output hint and the timing gate. */
export function naturalDurationMs(p: ResolvedProps, pageCount: number): number {
  return Math.round(p.introMs) + Math.round(p.perPageMs) * pageCount + Math.round(p.outroMs);
}
