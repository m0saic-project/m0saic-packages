import type { MosaicEngineContext, MosaicRenderableFile } from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import { defineMosaicTemplate, makeErrorMosaic, registerTemplate, resolvePinnedDurationMs } from "@m0saic/template-utils";
import { resolvePages, STAND_IN_PAGES } from "./pages";
import { buildScrapbookPipeline, naturalDurationMs } from "./pipeline";
import { DEFAULT_PROPS, propsSchema, resolveProps, type ScrapbookProps } from "./props";

/**
 * `@m0saic/story/scrapbook/v1` — a short personal film.
 *
 * A handful of pictures, each with a line in the author's own words, laid
 * down like the pages of a scrapbook: pinned slightly askew on paper,
 * drifting gently, handing over with soft cross-fades, optionally over
 * music. Warm and unhurried.
 *
 * The content arrives later on purpose. With no photos it lays out
 * generated stand-in pages, so the pacing, the tilt, the drift and the
 * words can all be judged before a single real picture exists — then real
 * files replace the stand-ins one for one.
 *
 * It renders as a PIPELINE — a step per page, the same cost whatever the
 * length. A single-document form (which would keep its geometry and could
 * BE a Community M piece) is written and tested in `document.ts` but is NOT
 * offered: it is blocked on an engine defect. See that file.
 *
 * See `props.ts` for the contract this keeps.
 */
export const ScrapbookV1 = defineMosaicTemplate<ScrapbookProps>({
  id: asTemplateId("@m0saic/story/scrapbook/v1"),
  label: "Scrapbook",
  version: 1,
  description:
    "A short personal film: a few pictures, a line each, pinned askew on paper and drifting past to music. Lays itself out with stand-in pages until your own photos arrive.",
  capabilities: { tier: "core" },
  tags: ["story", "personal", "photos", "animated", "creators", "social", "memories", "photo-album"],
  outputHints: {
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: naturalDurationMs(DEFAULT_PROPS, STAND_IN_PAGES),
    note: "Length follows the page count: opening + per-page × pictures + closing.",
    format: { kind: "video", container: "mp4" },
  },
  propsSchema,
  defaultProps: DEFAULT_PROPS,

  render(props: ScrapbookProps, ctx: MosaicEngineContext): Promise<MosaicRenderableFile> {
    const width = ctx.output.width;
    const height = ctx.output.height;
    const fps = ctx.target.fps;
    const fail = (title: string, message: string) =>
      Promise.resolve(makeErrorMosaic(message, { title: `${this.id} ${title}`, width, height }));

    const rp = resolveProps(props);
    if (!rp.ok) return fail("props", rp.errors.join(" | "));
    const p = rp.value;
    if (Math.min(width, height) < 320) return fail("canvas", `canvas too small: the short side must be at least 320 px (got ${width}×${height})`);

    const pages = resolvePages(p);
    if (pages.length === 0) return fail("pages", "no pages to show");

    // A pinned length re-paces the film rather than cutting it off: the
    // pages share whatever is left after the two cards.
    const pinned = resolvePinnedDurationMs(ctx);
    const paced = { ...p };
    if (pinned !== undefined) {
      const forPages = Math.round(pinned) - Math.round(p.introMs) - Math.round(p.outroMs);
      const perPage = Math.floor(forPages / pages.length);
      if (perPage < 400) return fail("duration", `pinned duration ${Math.round(pinned)} ms leaves under 400 ms a page for ${pages.length} pages`);
      paced.perPageMs = perPage;
      // Absorb the rounding into the closing card so the total is exact.
      paced.outroMs = Math.round(pinned) - Math.round(p.introMs) - perPage * pages.length;
    }

    return Promise.resolve(buildScrapbookPipeline({ width, height, fps, props: paced, pages }));
  },
});

registerTemplate(ScrapbookV1);

export default ScrapbookV1;
