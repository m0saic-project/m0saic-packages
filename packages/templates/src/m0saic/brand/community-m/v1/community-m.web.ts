import type { MosaicEngineContext, MosaicRenderableFile } from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import { defineMosaicTemplate, makeErrorMosaic, registerTemplate } from "@m0saic/template-utils";
import { parseCommunityMManifest } from "@m0saic/platform";
import seedManifestJson from "@m0saic/community-m/index.json";
import type { ClaimImage } from "./mark";
import { buildProvenancePipeline, type HarnessPlan } from "./pipeline";
import { previewPiece, simulatedClaims } from "./preview";
import { DEFAULT_PROPS, propsSchema, resolveProps, type CommunityMProvenanceProps } from "./props";
import { buildTarget, harnessClaims, previewIsOn, subjectOf } from "./target";
import { resolveTimeline } from "./timing";
import { fetchWebPiece } from "./webPiece";

/**
 * `@m0saic/brand/community-m/v1` — BROWSER build.
 *
 * The same id and the same beats as the desktop template, assembled from
 * the same node-free modules (`target` / `pipeline` / `mark` / `preview`).
 * Only one of the two entries is ever bundled: `../../../../web.ts` imports
 * THIS one, `./community-m` is the node one.
 *
 * The web app SERVES the bundled seed's tile images (the copy step puts them
 * under `/community-m/…`), so the real claims paint their real pictures here
 * through `kind: "url"` assets — the founder's own provenance video is the
 * real thing in the browser, not an impression of it. Only what the browser
 * genuinely cannot reach falls back: a community-m folder of your own, and a
 * contributor's `.mosaic` canvas when it is not among the served files. Those
 * say so and point at Mosaic Desktop rather than quietly rendering something
 * else.
 */

const DESKTOP = "Mosaic Desktop renders this for real.";

/** Where the web app serves the bundled seed's tile images from. */
const SEED_TILE_BASE = "/community-m";

/**
 * A served tile's real pixel dimensions. Only the ASPECT matters (it decides
 * how the un-clipped original is sized over its tile crop), and the browser
 * is the only thing here that can read it — so decode the image the preview
 * is about to load anyway. Anything unreadable falls back to square, which
 * is right for the tiles the rules ask for.
 */
async function imageSizeOf(image: ClaimImage): Promise<{ width: number; height: number }> {
  try {
    if (image.kind !== "url" || typeof Image === "undefined") return { width: 1, height: 1 };
    const img = new Image();
    img.src = image.url;
    await img.decode();
    if (img.naturalWidth > 0 && img.naturalHeight > 0) return { width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    /* a 404 or a decode failure — the harness still runs, square-ish */
  }
  return { width: 1, height: 1 };
}

/**
 * Browser overrides for the dev levers — none. The seed's tiles AND pieces
 * are served, so the defaults render the real video here exactly as they do
 * on the desktop; the levers behave identically.
 */
const WEB_PREVIEW: Partial<NonNullable<CommunityMProvenanceProps["preview"]>> = {};

function webProps(props: CommunityMProvenanceProps): CommunityMProvenanceProps {
  const given = Object.fromEntries(Object.entries(props.preview ?? {}).filter(([, v]) => v !== undefined));
  return { ...props, preview: { ...WEB_PREVIEW, ...given } };
}

export const CommunityMV1Web = defineMosaicTemplate<CommunityMProvenanceProps>({
  id: asTemplateId("@m0saic/brand/community-m/v1"),
  label: "Community M — Provenance",
  version: 1,
  // BITMAP drafting mode (handbook §3c): the split counts ARE the m0saic M as a traced bitmap —
  // never live-composed, so the latticeSmooth convention does not apply.
  lattice: { mode: "bitmap" },
  description:
    "Your tile's provenance video: the Community M with its identity, a zoom into your tile, your original image, your own canvas, then back to the M. In the browser the pictures are stand-ins — Mosaic Desktop renders the real repo.",
  capabilities: { tier: "core" },
  tags: ["brand", "community-m", "provenance", "animated"],
  outputHints: {
    width: 3840,
    height: 2160,
    fps: 30,
    durationMs: 19100,
    note: "Official 4K canvas; the M renders at 7x (1904 px). In the browser every tile is a stand-in and the canvas is a generated card.",
    format: { kind: "video", container: "mp4" },
  },
  propsSchema,
  // The browser opens on a full, alive M with a generated canvas — the real
  // seed has one claim and no readable pictures here, so an empty M would be
  // a worse first impression than an honest simulated one.
  defaultProps: DEFAULT_PROPS,

  async render(props: CommunityMProvenanceProps, ctx: MosaicEngineContext): Promise<MosaicRenderableFile> {
    const frameW = ctx.output.width;
    const frameH = ctx.output.height;
    const fps = ctx.target.fps;
    const fail = (title: string, message: string) =>
      makeErrorMosaic(message, { title: `${this.id} ${title}`, width: frameW, height: frameH });

    const rp = resolveProps(webProps(props));
    if (!rp.ok) return fail("props", rp.errors.join(" | "));
    const p = rp.value;
    if (Math.min(frameW, frameH) < 340) return fail("canvas", `canvas too small: the short side must be at least 340 px (got ${frameW}x${frameH})`);

    // The two things the browser genuinely cannot do.
    if (p.communityDir.trim() !== "") {
      return fail("desktop only", `Reading a community-m folder needs the filesystem. ${DESKTOP} Here, leave the folder empty and use Dev preview.`);
    }

    const parsed = parseCommunityMManifest(seedManifestJson);
    if (!parsed.ok) return fail("seed", `bundled community-m seed is invalid: ${parsed.error}`);

    // The served seed: a claim's tile is a real URL the browser can load.
    const rt = buildTarget(parsed.manifest, {
      m: p.m,
      tile: p.tile,
      asOf: p.asOf,
      allowUnclaimed: previewIsOn(p.preview),
      pictureFor: (slot) => (slot.tile ? { kind: "url", url: `${SEED_TILE_BASE}/${slot.tile}` } : null),
    });
    if (!rt.ok) return fail("target", rt.error);
    const target = rt.target;

    const subject = subjectOf(target, p.preview);
    const claims = harnessClaims(target, p.preview, subject, simulatedClaims);
    const photo = subject.photo ?? {
      image: target.tileImage!,
      size: await imageSizeOf(target.tileImage!),
      focus: target.slot.focus ?? { x: 0.5, y: 0.5 },
    };
    // The contributor's own canvas when it is served and browser-safe;
    // otherwise the generated card (and `piece: "off"` says why).
    const card = () =>
      previewPiece({
        style: p.preview.piece === "off" ? "lorem" : p.preview.piece,
        aspect: p.preview.pieceAspect,
        fps,
        canvasColor: p.canvasColor,
        accentColor: p.accentColor,
        textColor: p.textColor,
      });
    let piece = card();
    if (p.preview.piece === "off") {
      if (target.synthetic || !target.slot.piece) {
        return fail("desktop only", `That tile has no canvas in the bundled seed. ${DESKTOP} Here, pick a generated canvas under Dev preview.`);
      }
      const served = await fetchWebPiece(`${SEED_TILE_BASE}/${target.slot.piece}`);
      if (!served.ok) {
        return fail("desktop only", `${served.error}. ${DESKTOP} Here, pick a generated canvas under Dev preview.`);
      }
      piece = served.piece;
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

registerTemplate(CommunityMV1Web);

export default CommunityMV1Web;
