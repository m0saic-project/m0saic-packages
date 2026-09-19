import type { MosaicDocument, MosaicSource } from "@m0saic/types";
import { keyframeExpr } from "@m0saic/template-utils";
import { toM0String } from "@m0saic/dsl-stdlib";
import { buildPageDoc } from "./page";
import { cardDoc, type ScrapbookPlan } from "./pipeline";

/**
 * The whole film as ONE `mosaic_document` instead of a pipeline.
 *
 * NOT SHIPPED — blocked on an engine defect. Kept because it is correct
 * apart from that, and becomes viable the moment the defect is fixed.
 *
 * THE BLOCKER. Stacking layers is only affordable if the engine can skip a
 * layer's work while it is off screen, which is what `overlay.window` is
 * for. But a `window` on a nested child that holds an svg TEXT source
 * renders that text as a solid block of the font colour — repro and full
 * findings in `.scratch/claude/repro-overlay-window-text.mosaic`. Without
 * the window the text is correct and the render is unusable: six layers of
 * a 19-second film did not finish in ten minutes at 640 square, because
 * every layer renders the whole film. So the optimisation that makes this
 * form affordable is the one that corrupts it.
 *
 * Why anyone would want this: a document keeps its geometry. It opens in
 * Layout, so the tilt, the pacing and the words stay inspectable and
 * re-editable long after the render — and a Community M piece must be a
 * single document, so this is the form that can BE someone's canvas rather
 * than a film of one.
 *
 * What it costs: a pipeline renders one step at a time, so a hundred pages
 * cost the same per frame as two. Here every page is a layer that is alive
 * for the whole runtime, gated by a time window, so cost grows with the
 * page count and eventually the engine starts degrading rather than
 * failing. Hence {@link DOCUMENT_MAX_PAGES} — the bad case is loud.
 *
 * Every layer shares the parent's clock, so each is told when its own time
 * begins (`originSec`) and its internal drift and arrivals are offset to
 * match. Cross-fades become overlapping alpha ramps: a layer holds until
 * its span ends, then fades out across exactly the window the next one
 * fades in.
 */

/** Past this the layer stack stops being worth it — use the pipeline. */
export const DOCUMENT_MAX_PAGES = 12;

type Layer = { doc: MosaicDocument; startMs: number; visibleMs: number };

export function buildScrapbookDocument(plan: ScrapbookPlan): MosaicDocument {
  const { width: W, height: H, fps, props: p, pages } = plan;
  const x = Math.round(p.xfadeMs);
  const openMs = Math.round(p.introMs);
  const pageMs = Math.round(p.perPageMs);
  const closeMs = Math.round(p.outroMs);
  const totalMs = openMs + pageMs * pages.length + closeMs;
  const sec = (ms: number) => ms / 1000;

  // Children run the parent's full length: their animation is written in
  // absolute time, and the alpha window is what decides when they are seen.
  const layers: Layer[] = [];
  let at = 0;
  if (openMs > 0) {
    layers.push({
      doc: cardDoc({ width: W, height: H, fps, durationMs: totalMs, props: p, headline: p.title, sub: p.subtitle, headlineProp: "title", originSec: sec(at), entrances: false }),
      startMs: at,
      visibleMs: openMs,
    });
    at += openMs;
  }
  for (const page of pages) {
    layers.push({
      doc: buildPageDoc({ page, width: W, height: H, fps, durationMs: totalMs, props: p, originSec: sec(at), entrances: false }),
      startMs: at,
      visibleMs: pageMs,
    });
    at += pageMs;
  }
  if (closeMs > 0) {
    layers.push({
      doc: cardDoc({ width: W, height: H, fps, durationMs: totalMs, props: p, headline: p.closing, sub: "", headlineProp: "closing", originSec: sec(at), entrances: false }),
      startMs: at,
      visibleMs: closeMs,
    });
  }

  const children: Record<string, MosaicDocument> = {};
  const sources: MosaicSource[] = [{ type: "lavfi", color: p.paperColor } as MosaicSource];
  layers.forEach((layer, i) => {
    const ref = `layer${i}`;
    children[ref] = layer.doc;
    const s = sec(layer.startMs);
    const e = sec(layer.startMs + layer.visibleMs);
    const f = sec(x);
    const first = i === 0;
    const last = i === layers.length - 1;
    // Hold, then hand over across exactly the window the next one arrives in.
    const keys = [
      ...(first ? [] : [{ t: s, v: 0 }, { t: s + f, v: 1 }]),
      ...(last ? [{ t: e, v: 1 }] : [{ t: e, v: 1 }, { t: e + f, v: 0 }]),
    ];
    // Alpha ONLY. A structured `overlay.window` here would let the engine
    // skip each layer off-window, but a window on a nested child that holds
    // an svg TEXT source renders that text as a solid block of the font
    // colour (repro: `.scratch/claude/repro-overlay-window-text.mosaic`).
    // So every layer runs the whole film — which is exactly the cost
    // DOCUMENT_MAX_PAGES exists to bound.
    sources.push({ type: "mosaic", ref, overlay: { alpha: keyframeExpr(keys) } } as MosaicSource);
  });

  return {
    kind: "mosaic_document",
    version: 1,
    // One base plus a layer each, nested — the depth IS the layer count.
    m0: toM0String(nestedOverlays(sources.length), "Scrapbook-document"),
    size: { width: W, height: H },
    fps,
    durationMs: totalMs,
    backgroundColor: p.paperColor as never,
    audio: { mode: "off" },
    assets: {},
    children,
    sources,
  };
}

/** `1`, `1{1}`, `1{1{1}}` … — one frame per source, nested as overlays. */
export function nestedOverlays(count: number): string {
  if (count <= 1) return "1";
  return `1{${nestedOverlays(count - 1)}}`;
}
