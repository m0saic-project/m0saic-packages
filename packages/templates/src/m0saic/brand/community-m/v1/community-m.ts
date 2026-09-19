import type { MosaicEngineContext, MosaicRenderableFile } from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import { defineMosaicTemplate, makeErrorMosaic, registerTemplate } from "@m0saic/template-utils";
import type { LoadedPiece } from "./piece";
import { loadPiece } from "./loadPiece.node";
import { previewPiece, simulatedClaims } from "./preview";
import { readImageSize } from "./imageSize.node";
import { harnessClaims, previewIsOn, subjectOf } from "./target";
import { buildProvenancePipeline, type HarnessPlan } from "./pipeline";
import { DEFAULT_PROPS, propsSchema, resolveProps, type CommunityMProvenanceProps } from "./props";
import { pieceAbsFor, resolveTarget } from "./manifest";
import { resolveTimeline } from "./timing";

/**
 * `@m0saic/brand/community-m/v1` — the provenance video for one tile of the
 * Community M.
 *
 * Beats (founder shot list, 2026-09-06):
 *   1. The M with its identity (which M, opened / completed), claimed tiles
 *      as their images with the orange edge, open tiles dormant.
 *   2. A dolly into the chosen tile.
 *   3. The M dissolves while the tile's un-clipped original fades in EXACTLY
 *      over its crop (nothing moves), then slides aside.
 *   4. The contributor's canvas pops into its box beside the original and
 *      plays at its own declared size (vertical allowed).
 *   5. The original slides back and dissolves into the M; the camera backs
 *      out to the whole M; then the brand closer — the same frame, the M's
 *      tiles turning into the logo in place, the wordmark and the repo in
 *      the caption rows.
 *
 * m0saic owns the harness; the piece is the contributor's (data only,
 * validated). Everything is read from a community-m folder — the bundled
 * seed by default, the app / CLI cache when the host pre-fills it. No
 * network, no randomness; the same folder renders the same bytes.
 */
export const CommunityMV1 = defineMosaicTemplate<CommunityMProvenanceProps>({
  id: asTemplateId("@m0saic/brand/community-m/v1"),
  label: "Community M — Provenance",
  version: 1,
  // BITMAP drafting mode (handbook §3c): the split counts ARE the m0saic M as a traced bitmap —
  // never live-composed, so the latticeSmooth convention does not apply.
  lattice: { mode: "bitmap" },
  description:
    "Your tile's provenance video: the Community M with its identity, a zoom into your tile, your original image, your own canvas, then back to the M. Renders from the community-m repo — no app release needed for new claims.",
  capabilities: { tier: "core" },
  tags: ["brand", "community-m", "provenance", "animated", "designers", "developers", "community", "open-source"],
  outputHints: {
    width: 3840,
    height: 2160,
    fps: 30,
    durationMs: 19100,
    note: "Official 4K canvas; the M renders at 7× (1904 px). The natural length is the harness plus the piece's declared duration (capped by pieceMaxMs).",
    format: { kind: "video", container: "mp4" },
  },
  propsSchema,
  defaultProps: DEFAULT_PROPS,

  async render(props: CommunityMProvenanceProps, ctx: MosaicEngineContext): Promise<MosaicRenderableFile> {
    const frameW = ctx.output.width;
    const frameH = ctx.output.height;
    const fps = ctx.target.fps;
    const fail = (title: string, message: string) => makeErrorMosaic(message, { title: `${this.id} ${title}`, width: frameW, height: frameH });

    const rp = resolveProps(props);
    if (!rp.ok) return fail("props", rp.errors.join(" | "));
    const p = rp.value;
    if (Math.min(frameW, frameH) < 340) return fail("canvas", `canvas too small: the short side must be at least 340 px (got ${frameW}×${frameH})`);

    // ── Dev levers (preview.ts): stand-in claims, a stand-in subject tile,
    //    a generated canvas. All off by default — the defaults render the
    //    real seed exactly as they always did. With any lever on, an
    //    UNCLAIMED tile stands up as a stand-in instead of erroring: that is
    //    how you design the zoom and framing for tiles nobody holds yet.
    const pv = p.preview;
    const rt = resolveTarget({ communityDir: p.communityDir, m: p.m, tile: p.tile, asOf: p.asOf, allowUnclaimed: previewIsOn(pv) });
    if (!rt.ok) return fail("target", rt.error);
    const target = rt.target;

    const subject = subjectOf(target, pv);
    const claims = harnessClaims(target, pv, subject, simulatedClaims);
    const photo = subject.photo ?? {
      image: target.tileImage!,
      size: readImageSize((target.tileImage as { kind: "file"; path: string }).path),
      focus: target.slot.focus ?? { x: 0.5, y: 0.5 },
    };

    let piece: LoadedPiece;
    if (pv.piece !== "off" || target.synthetic) {
      // A stood-up slot has no piece on disk, so it always gets a card.
      piece = previewPiece({ style: pv.piece === "off" ? "lorem" : pv.piece, aspect: pv.pieceAspect, fps, canvasColor: p.canvasColor, accentColor: p.accentColor, textColor: p.textColor });
    } else {
      const lp = loadPiece(pieceAbsFor(rt.dir!, target.slot));
      if (!lp.ok) return fail("piece", lp.error);
      piece = lp.piece;
    }

    const tl = resolveTimeline(p, piece.declaredMs, ctx);
    if (!tl.ok) return fail("duration", tl.error);

    const plan: HarnessPlan = {
      frameW,
      frameH,
      fps,
      props: p,
      target,
      claims,
      tileIndex: subject.tileIndex,
      photo,
      tileCaption: subject.caption,
      piece,
      timeline: tl.timeline,
      repo: target.manifest.repo ?? "m0saic-project/community-m",
    };
    return buildProvenancePipeline(plan);
  },
});

registerTemplate(CommunityMV1);

export default CommunityMV1;
