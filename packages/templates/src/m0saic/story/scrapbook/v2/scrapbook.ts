import type { MosaicDocument, MosaicEngineContext, MosaicRenderableFile, MosaicSource } from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import { bindProps, defineMosaicTemplate, makeErrorMosaic, registerTemplate, resolvePinnedDurationMs, tag } from "@m0saic/template-utils";
import { withAddHandles } from "../../../_shared/canvas-handles";
import { resolvePages, STAND_IN_PAGES } from "../v1/pages";
import { buildScrapbookPipeline, naturalDurationMs } from "../v1/pipeline";
import { DEFAULT_PROPS, propsSchema, resolveProps, type ScrapbookV2Props } from "./props";

/**
 * `@m0saic/story/scrapbook/v2` — a short personal film.
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
export const ScrapbookV2 = defineMosaicTemplate<ScrapbookV2Props>({
  id: asTemplateId("@m0saic/story/scrapbook/v2"),
  version: 2,
  capabilities: { tier: "core" },
  outputHints: {
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: naturalDurationMs(DEFAULT_PROPS, STAND_IN_PAGES),
    // The opening card, once its title and subtitle have arrived.
    posterTimeMs: 1800,
    note: "Length follows the page count: opening + per-page × pictures + closing.",
    format: { kind: "video", container: "mp4" },
  },
  propsSchema,
  bindings: {
    unbound: {
      // Sound, not picture: no rect shows it.
      music: "audio",
      perPageMs: "timing",
      introMs: "timing",
      outroMs: "timing",
      xfadeMs: "timing",
    },
  },
  defaultProps: DEFAULT_PROPS,

  render(props: ScrapbookV2Props, ctx: MosaicEngineContext): Promise<MosaicRenderableFile> {
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

    const film = buildScrapbookPipeline({ width, height, fps, props: paced, pages });

    // ── v2: handles, on the rects v1's pipeline builds. v1 bound the words
    //    (title, subtitle, each note, the closing line); the pictures and the
    //    colours had none. A page's print takes a dropped photo — its own, or
    //    (on a stand-in page) the first one — and shows the tilt and drift; the
    //    lines carry the ink that writes them. ──
    const realPhotos = p.photos.filter((x) => typeof x === "string" && x.trim() !== "").length;
    for (const step of film.steps) {
      const doc = step.file as MosaicDocument;
      const sources = (doc.sources ?? []) as MosaicSource[];
      const pageNo = /^page-(\d+)$/.exec(step.name ?? "");
      if (pageNo) {
        const print = sources.find((x) => (x as { type?: string; ref?: string }).type === "mosaic" && (x as { ref?: string }).ref === "band");
        if (print) {
          const index = realPhotos > 0 ? Number(pageNo[1]) - 1 : 0;
          bindProps(tag(print, "print"), [{ propKey: "photos", index }, { propKey: "tilt" }, { propKey: "drift" }]);
        }
      }
      for (const src of sources) {
        const bound = (src as { editor?: { binding?: { propKey?: string } } }).editor?.binding?.propKey;
        if (bound === "subtitle") withAddHandles(src, [{ propKey: "accentColor" }]);
        else if (bound === "title" || bound === "closing" || bound === "notes") withAddHandles(src, [{ propKey: "inkColor" }]);
      }
    }
    return Promise.resolve(film);
  },
});

registerTemplate(ScrapbookV2);

export default ScrapbookV2;
