import type { MosaicColor, MosaicDocument, MosaicDocumentPipeline, MosaicOverlayExpr, MosaicPipelineStep, MosaicPlacementProps, MosaicSource } from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { placeRect, toM0String, weightedSplit } from "@m0saic/dsl-stdlib";
import { NAVY_SOFT, bindProp, coverFitField, isPortraitField, keyframeExpr, makeColorTile, mixHex, placeInsetPieces, tag } from "@m0saic/template-utils";
import { autoZoomForTile, parkedCamera, zoomToTileCamera } from "./camera";
import { captionSource } from "./caption";
import { markGeometry, markSideFor } from "./geometry";
import { identityLine, type ProvenanceTarget } from "./target";
import { buildLogoDoc, buildMarkDoc, claimImageAsset, type ClaimImage, type MarkClaim } from "./mark";
import type { LoadedPiece } from "./piece";
import { popWrapperDoc } from "./piece";
import type { ResolvedProps } from "./props";
import { alignedPhotoRect, pieceBeatLayout, roundRect, zoomPartitionCap, type ImageSize, type PieceAxis, type Rect } from "./reveal";
import type { Timeline } from "./timing";
import { wordmarkRowDoc } from "./wordmark";

export type HarnessPlan = {
  frameW: number;
  frameH: number;
  fps: number;
  props: ResolvedProps;
  target: ProvenanceTarget;
  /** Every tile the M paints as claimed — real claims plus any preview stand-ins. */
  claims: ReadonlyMap<number, MarkClaim>;
  /** The tile the video is about (the resolved slot, or a preview override). */
  tileIndex: number;
  /** That tile's picture: its source, its dimensions (only the aspect matters) and its crop anchor. */
  photo: { image: ClaimImage; size: ImageSize; focus: { x: number; y: number } };
  /** Second caption line (the real slot line, or the preview stand-in line). */
  tileCaption: string;
  piece: LoadedPiece;
  timeline: Timeline;
  repo: string;
};

/** Slot ceiling for a frame split: past this the planner's px-per-weight floor bites. */
const MAX_SPLIT_SLOTS = 64;

function gcd(a: number, b: number): number {
  let x = Math.abs(a), y = Math.abs(b);
  while (y) { const t = x % y; x = y; y = t; }
  return x || 1;
}

/**
 * Caption-band height: ~4.5 % of the frame, nudged to the value in that
 * band that shares the LARGEST common factor with the frame height.
 *
 * Why not just round: the row split is expressed in slots, and feeding raw
 * pixel counts in makes every frame a 2160-slot split — far past the
 * planner's px-per-weight floor, where cells quantize and squash (the
 * `safeMinimumCanvas` convention). Sharing a factor lets the same pixel
 * boundaries be written as a couple of dozen slots instead.
 * `gcd(capH, stageH) === gcd(capH, frameH)` because `stageH = frameH − 2·capH`.
 */
export function captionBandHeight(frameH: number): number {
  const ideal = frameH * 0.045;
  const lo = Math.max(20, Math.floor(frameH * 0.03));
  const hi = Math.max(lo, Math.floor(frameH * 0.075));
  let best = -1;
  let bestDist = Infinity;
  for (let c = lo; c <= hi; c++) {
    if (frameH / gcd(c, frameH) > MAX_SPLIT_SLOTS) continue; // exact: g divides frameH
    const d = Math.abs(c - ideal);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  // Nothing shares a factor (a prime frame height): fall back to raw pixels.
  return best > 0 ? best : Math.max(20, Math.round(ideal));
}

/** Frame layout: the stage (the M, camera container) over two caption lines. */
export function frameLayout(frameW: number, frameH: number) {
  const capH = captionBandHeight(frameH);
  const stageH = frameH - 2 * capH;
  const side = markSideFor(frameW, stageH, 0.97); // 4K: 7× = 1904; 720p: 2×; ≤360p: 1×
  const markX = Math.floor((frameW - side) / 2);
  const markY = Math.floor((stageH - side) / 2);
  // Reduced weights: the same pixel boundaries in frameH/g slots, not frameH.
  const g = gcd(capH, frameH);
  const m0 = weightedSplit([stageH / g, capH / g, capH / g], "row", { precision: frameH / g });
  return { capH, stageH, side, markX, markY, m0 };
}
type Layout = ReturnType<typeof frameLayout>;

/** Where a tile sits inside the stage, in stage pixels. */
export function tileRectInStage(tileIndex: number, layout: Layout) {
  const geo = markGeometry();
  const r = geo.sourceRects[geo.tileToSource[tileIndex]];
  const k = layout.side / 272;
  return { x: layout.markX + r.x * k, y: layout.markY + r.y * k, width: r.width * k, height: r.height * k };
}

/** The community record: claimed tiles as their pictures with the orange edge, open tiles dormant. */
function communityMarkDoc(plan: HarnessPlan, layout: Layout, durationMs: number): MosaicDocument {
  return buildMarkDoc({
    side: layout.side,
    fps: plan.fps,
    durationMs,
    claims: plan.claims,
    dormantColor: plan.props.dormantColor,
    canvasColor: plan.props.canvasColor,
    accentColor: plan.props.accentColor,
    rootReserved: !plan.target.rootShown,
  });
}

/**
 * The stage: a frame-wide cell with an M (`mark`, side = `layout.side`)
 * centred in it (own size → never resized by the parent). The same cell
 * frames the community M in every beat and the brand logo in the closer, so
 * the two dissolve into each other tile for tile.
 */
function stageDoc(plan: HarnessPlan, layout: Layout, durationMs: number, mark: MosaicDocument): MosaicDocument {
  const placed = placeRect({ rootW: plan.frameW, rootH: layout.stageH, rectW: layout.side, rectH: layout.side });
  return {
    kind: "mosaic_document",
    version: 1,
    m0: placed.m0,
    size: { width: plan.frameW, height: layout.stageH },
    fps: plan.fps,
    durationMs,
    backgroundColor: plan.props.canvasColor as never,
    audio: { mode: "off" },
    assets: {},
    children: { mark },
    sources: [{ type: "mosaic", ref: "mark" }],
  };
}

/**
 * The brand field tint: the business card mixes NAVY → NAVY_SOFT at this
 * share (`fieldOpacity`); here it is mixed over the video's canvas colour so
 * a custom canvas keeps the same lift. Well under the dormant tile grey, so
 * the M still reads as the figure.
 */
const FIELD_MIX = 0.28;
/** The plate's hairline: the Home card's border, NAVY_SOFT mixed onto the surface at this share. */
const PLATE_BORDER_MIX = 0.35;
/** Plate air either side of the M, as a share of the M's side. */
const PLATE_PAD = 0.08;
/** Plate corner radius as a share of the frame's short side (the Home card's 2.8 %). */
const PLATE_RADIUS = 0.028;
/**
 * The intro fades the field and plate out over this many seconds, ENDING as
 * the dolly starts: a static ground under a zooming M reads as a mistake
 * (founder, 2026-09-16), so the camera only ever moves over the clean canvas.
 * Capped at half the hold so a short intro still shows the ground.
 */
const FIELD_FADE_SEC = 0.7;

/**
 * The brand field — the rect backdrop the Home screen and the business card
 * sit on (`coverFitField`, transposed on portrait) — as one transparent
 * child: every rect a tinted colour tile, nothing else painted. Under the
 * first and last beats (founder, 2026-09-16) so the video opens and closes
 * on the brand's own ground.
 */
function fieldDoc(plan: HarnessPlan, durationMs: number): MosaicDocument {
  const W = plan.frameW, H = plan.frameH;
  const tint = mixHex(plan.props.canvasColor, NAVY_SOFT, FIELD_MIX);
  const rects = coverFitField(W, H, isPortraitField(W, H));
  const placed = placeInsetPieces({
    rootW: W,
    rootH: H,
    pieces: rects.map((r) => ({ rect: { ...r, importance: 0 }, source: tag(makeColorTile(tint) as MosaicSource, "field") })),
  });
  return {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String(String(placed.m0), "CommunityMV1-field"),
    size: { width: W, height: H },
    fps: plan.fps,
    durationMs,
    audio: { mode: "off" },
    assets: {},
    sources: placed.sources,
  };
}

/**
 * The Home card's plate — the protective backdrop between the field and the
 * content (founder, 2026-09-16): canvas-coloured, the card's hairline, the
 * card's corner radius. A column the M's width plus air, the FULL frame
 * height: at 4K the M already stands at 97 % of the stage, so there is no
 * room for card air above it; a column reads the same at every size and
 * keeps the captions on the plate too. The corners round off the frame's
 * edges, so what shows is the two hairlines and calm ground.
 */
function plateRect(plan: HarnessPlan, layout: Layout): Rect {
  const pad = Math.round(layout.side * PLATE_PAD);
  const x = Math.max(0, layout.markX - pad);
  const right = Math.min(plan.frameW, layout.markX + layout.side + pad);
  return { x, y: 0, width: right - x, height: plan.frameH };
}

function plateSource(plan: HarnessPlan, layout: Layout, alpha?: string): MosaicSource {
  const r = plateRect(plan, layout);
  const at = layerAt(plan, r, alpha ? { alpha } : undefined);
  const cardMin = Math.max(1, Math.min(r.width, r.height));
  const radiusPx = Math.round(Math.min(plan.frameW, plan.frameH) * PLATE_RADIUS);
  return tag(
    makeColorTile(plan.props.canvasColor as MosaicColor, {
      placement: at.placement,
      overlay: at.overlay,
      effects: {
        rounding: { cornerStyle: "rounded", borderRadius: Math.min(1, (2 * radiusPx) / cardMin) },
        stroke: { width: 1.5 / cardMin, color: mixHex(plan.props.canvasColor, NAVY_SOFT, PLATE_BORDER_MIX) },
      },
    }) as MosaicSource,
    "plate",
  );
}

/**
 * A frame on the brand field: canvas colour, the field, the plate (both
 * optionally fading together), then the rows layout as the top layer.
 * Nested children paint no background (a plain `backgroundColor` on a child
 * is transparent in the overlay path — verified 2026-09-16), so the field
 * shows through the M's gaps and around the plate, exactly as the Home
 * card sits on its field.
 */
function fieldedDoc(plan: HarnessPlan, layout: Layout, durationMs: number, children: Record<string, MosaicDocument>, rowSources: MosaicSource[], field: { alpha?: string }): MosaicDocument {
  return {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String(`1{1{1{${layout.m0}}}}`, "CommunityMV1-fielded"),
    size: { width: plan.frameW, height: plan.frameH },
    fps: plan.fps,
    durationMs,
    backgroundColor: plan.props.canvasColor as never,
    audio: { mode: "off" },
    assets: {},
    children: { field: fieldDoc(plan, durationMs), ...children },
    sources: [
      { type: "lavfi", color: plan.props.canvasColor } as MosaicSource,
      { type: "mosaic", ref: "field", ...(field.alpha ? { overlay: { alpha: field.alpha } } : {}) },
      plateSource(plan, layout, field.alpha),
      ...rowSources,
    ],
  };
}

/** The framed M's row sources: the stage, then the two bound caption lines. */
function framedSources(plan: HarnessPlan, layout: Layout, stageSource: MosaicSource, line1: string, line2: string): MosaicSource[] {
  return [
    stageSource,
    // The identity line shows `m`, the tile line shows `tile` — bound so
    // Make can edit each in place (the `bindingsCover` convention).
    bindProp(captionSource(line1, plan.frameW, layout.capH, plan.props.textColor), "m"),
    bindProp(captionSource(line2, plan.frameW, layout.capH, plan.props.accentColor), "tile"),
  ];
}

/**
 * The framed M: stage row + two caption rows, at the full frame size. With
 * `field` the frame sits on the brand field (the intro); without it the
 * rows are the whole doc (reveal / return / outro — a clean canvas around
 * the tile).
 */
function framedDoc(plan: HarnessPlan, layout: Layout, durationMs: number, stageSource: MosaicSource, line1: string, line2: string, field?: { alpha?: string }): MosaicDocument {
  const children = { stage: stageDoc(plan, layout, durationMs, communityMarkDoc(plan, layout, durationMs)) };
  const sources = framedSources(plan, layout, stageSource, line1, line2);
  if (field) return fieldedDoc(plan, layout, durationMs, children, sources, field);
  return {
    kind: "mosaic_document",
    version: 1,
    m0: layout.m0,
    size: { width: plan.frameW, height: plan.frameH },
    fps: plan.fps,
    durationMs,
    backgroundColor: plan.props.canvasColor as never,
    audio: { mode: "off" },
    assets: {},
    children,
    sources,
  };
}

/** The framed M parked on the tile — the frame the reveal dissolves from and the return dissolves to. */
function parkedFrameDoc(plan: HarnessPlan, g: PhotoGeometry, durationMs: number): MosaicDocument {
  const camera = parkedCamera({ tile: g.tile, stageW: plan.frameW, stageH: g.layout.stageH, zoom: g.zoom });
  return framedDoc(plan, g.layout, durationMs, { type: "mosaic", ref: "stage", effects: { camera } }, identityLine(plan.target.entry), plan.tileCaption);
}

export type PhotoGeometry = {
  layout: Layout;
  tile: Rect;
  zoom: number;
  /** The original, un-clipped, exactly over its tile crop (frame px). */
  aligned: Rect;
  /** The original parked aside for the canvas (same size; moved on `axis` only). */
  parked: Rect;
  /** Which way it parks: "x" = left margin, piece to the right; "y" = top margin, piece below. */
  axis: PieceAxis;
  /** parked − aligned: the slide (the off-axis one is 0). */
  dx: number;
  dy: number;
  pieceRect: Rect;
};

/**
 * Zoom: the prop, else auto (the tile fills ~55 % of the tighter axis),
 * then CAPPED so the whole original fits inside the stage with air — the
 * reveal shows all of it without moving anything — AND so the piece beat
 * can partition the frame (`zoomPartitionCap`): the parked original and
 * the contributor canvas never share pixels. A `zoom` prop is a ceiling,
 * not an override; the contract wins.
 */
export function resolveZoom(plan: HarnessPlan, layout: Layout): number {
  const tile = tileRectInStage(plan.tileIndex, layout);
  const want = plan.props.zoom ?? autoZoomForTile(tile, plan.frameW, layout.stageH);
  const margin = Math.round(layout.stageH * 0.04);
  return zoomPartitionCap({ tile, stageW: plan.frameW, stageH: layout.stageH, frameW: plan.frameW, frameH: plan.frameH, image: plan.photo.size, focus: plan.photo.focus, maxZoom: want, margin });
}

/** All the reveal / slide / canvas geometry, computed once per render. */
export function photoGeometry(plan: HarnessPlan): PhotoGeometry {
  const layout = frameLayout(plan.frameW, plan.frameH);
  const tile = tileRectInStage(plan.tileIndex, layout);
  const zoom = resolveZoom(plan, layout);
  const aligned = roundRect(alignedPhotoRect({ tile, stageW: plan.frameW, stageH: layout.stageH, zoom, image: plan.photo.size, focus: plan.photo.focus }));
  const beat = pieceBeatLayout({ frameW: plan.frameW, frameH: plan.frameH, photo: aligned, piece: plan.piece.size });
  return { layout, tile, zoom, aligned, parked: beat.parked, axis: beat.axis, dx: beat.dx, dy: beat.dy, pieceRect: beat.pieceRect };
}

/**
 * A full-frame overlay layer holding `rect` exactly. The engine caps a
 * per-side inset at 0.49, so a rect is not an inset: the SIZE comes from a
 * symmetric inset (content box centred, rect-sized) and the POSITION from
 * the overlay's tile-local offset (unbounded — the same field that
 * animates the slide, so a moving layer is one keyframe expression).
 */
type Slide = { t: number; v: number }[];
type LayerAnim = { alpha?: string; xKeys?: Slide; yKeys?: Slide };

function layerAt(plan: HarnessPlan, r: Rect, anim?: LayerAnim): { placement: MosaicPlacementProps; overlay: MosaicOverlayExpr } {
  const W = plan.frameW, H = plan.frameH;
  const ix = (W - r.width) / 2 / W;
  const iy = (H - r.height) / 2 / H;
  const ox = r.x - Math.round(W * ix);
  const oy = r.y - Math.round(H * iy);
  const xExpr = anim?.xKeys ? keyframeExpr(anim.xKeys.map((k) => ({ t: k.t, v: k.v + ox }))) : String(ox);
  const yExpr = anim?.yKeys ? keyframeExpr(anim.yKeys.map((k) => ({ t: k.t, v: k.v + oy }))) : String(oy);
  return {
    placement: { fit: "contain", inset: { x: ix, y: iy } },
    overlay: { xExpr, yExpr, ...(anim?.alpha ? { alpha: anim.alpha } : {}) },
  };
}

/** The slide keyframes on the partition axis: `from`→`to` as a share of (dx, dy). */
function slideKeys(g: PhotoGeometry, t0: number, t1: number, from: 0 | 1, to: 0 | 1): Pick<LayerAnim, "xKeys" | "yKeys"> {
  const keys: Slide = [{ t: t0, v: from * (g.axis === "x" ? g.dx : g.dy) }, { t: t1, v: to * (g.axis === "x" ? g.dx : g.dy) }];
  return g.axis === "x" ? { xKeys: keys } : { yKeys: keys };
}

const PHOTO = asAssetId("original");

/** The tile's original, un-clipped, in a frame layer at `rect` (+ optional slide / fade). */
function photoSource(plan: HarnessPlan, rect: Rect, anim?: LayerAnim): MosaicSource {
  return { type: "media", mediaType: "image", assetId: PHOTO, ...layerAt(plan, rect, anim) } as MosaicSource;
}

/** A `1{1{1}}` frame: canvas colour, then two layers. */
function layeredDoc(plan: HarnessPlan, durationMs: number, children: Record<string, MosaicDocument>, layers: MosaicSource[], audio: MosaicDocument["audio"] = { mode: "off" }): MosaicDocument {
  return {
    kind: "mosaic_document",
    version: 1,
    m0: "1{1{1}}" as never,
    size: { width: plan.frameW, height: plan.frameH },
    fps: plan.fps,
    durationMs,
    backgroundColor: plan.props.canvasColor as never,
    audio,
    assets: { [PHOTO]: claimImageAsset(plan.photo.image) },
    children,
    sources: [{ type: "lavfi", color: plan.props.canvasColor } as MosaicSource, ...layers],
  };
}

/** The dissolve share of a reveal beat (the rest is a hold on the original). */
function dissolveSec(revealMs: number): number {
  return Math.max(0.4, Math.min(1.6, (revealMs / 1000) * 0.6));
}

/** Beat 1+2: the whole M with its identity, then the dolly into the tile. */
export function buildIntroDoc(plan: HarnessPlan, durationMs: number): MosaicDocument {
  const g = photoGeometry(plan);
  const t = plan.timeline;
  const s0 = t.introHoldMs / 1000, s1 = (t.introHoldMs + t.zoomMs) / 1000;
  const camera = zoomToTileCamera({ tile: g.tile, stageW: plan.frameW, stageH: g.layout.stageH, zoom: g.zoom, startSec: s0, endSec: s1 });
  // No per-tile spotlight: a per-cell alpha pushes all 33 tiles off ffmpeg's
  // grid sheet into a 33-deep overlay chain, past the depth where inline masks
  // silently degrade (OVERLAY_CHAIN_DEEP). The dolly isolates the tile on its own.
  // The brand field (and its plate) hold under the whole M, then fade out in
  // the last part of the hold — gone the moment the dolly begins, so the
  // camera moves over a clean canvas and the cut into the reveal is clean.
  const fade = Math.min(FIELD_FADE_SEC, s0 / 2);
  const field = { alpha: keyframeExpr([{ t: s0 - fade, v: 1 }, { t: s0, v: 0 }]) };
  return framedDoc(plan, g.layout, durationMs, { type: "mosaic", ref: "stage", effects: { camera } }, identityLine(plan.target.entry), plan.tileCaption, field);
}

/**
 * Beat 3: parked on the tile, the framed M dissolves while the un-clipped
 * original fades in EXACTLY over its crop (nothing moves), holds, then
 * slides aside — left, or up on a frame where that shows more of it — to
 * make room for the canvas (the partition contract in reveal.ts).
 */
export function buildRevealDoc(plan: HarnessPlan, durationMs: number): MosaicDocument {
  const g = photoGeometry(plan);
  const t = plan.timeline;
  const fade = dissolveSec(t.revealMs);
  const slide0 = t.revealMs / 1000, slide1 = (t.revealMs + t.slideMs) / 1000;
  return layeredDoc(plan, durationMs, { framed: parkedFrameDoc(plan, g, durationMs) }, [
    { type: "mosaic", ref: "framed", overlay: { alpha: keyframeExpr([{ t: 0, v: 1 }, { t: fade, v: 0 }]) } },
    photoSource(plan, g.aligned, {
      alpha: keyframeExpr([{ t: 0, v: 0 }, { t: fade, v: 1 }]),
      ...slideKeys(g, slide0, slide1, 0, 1),
    }),
  ]);
}

/**
 * Beat 4: the original parked aside; the contributor canvas pops into its
 * box (camera 1 → POP_SCALE on the padded wrapper) and plays at its own
 * declared size, fading out over the last crossfade.
 */
export function buildPieceDoc(plan: HarnessPlan, durationMs: number): MosaicDocument {
  const g = photoGeometry(plan);
  const t = plan.timeline;
  const pop = t.popMs / 1000;
  const x = t.xfadeMs / 1000;
  const end = durationMs / 1000;
  const wrapper = popWrapperDoc({ fitW: g.pieceRect.width, fitH: g.pieceRect.height, fps: plan.fps, durationMs, piece: plan.piece, canvasColor: plan.props.canvasColor });
  const zoom = keyframeExpr([{ t: 0, v: 1 }, { t: pop, v: wrapper.size!.width / g.pieceRect.width }]);
  const at = layerAt(plan, g.pieceRect, x > 0 ? { alpha: keyframeExpr([{ t: end - x, v: 1 }, { t: end, v: 0 }]) } : undefined);
  const canvas: MosaicSource = {
    type: "mosaic",
    ref: "canvas",
    placement: at.placement,
    effects: { camera: { zoom, focusX: 0.5, focusY: 0.5 } },
    overlay: at.overlay,
  };
  return layeredDoc(plan, durationMs, { canvas: wrapper }, [photoSource(plan, g.parked), canvas], { mode: "auto" } as MosaicDocument["audio"]);
}

/** Beat 5: the original slides back over its tile, then dissolves into the parked M. */
export function buildReturnDoc(plan: HarnessPlan, durationMs: number): MosaicDocument {
  const g = photoGeometry(plan);
  const t = plan.timeline;
  const slide1 = t.slideMs / 1000;
  const fade = dissolveSec(t.revealMs);
  return layeredDoc(plan, durationMs, { framed: parkedFrameDoc(plan, g, durationMs) }, [
    { type: "mosaic", ref: "framed", overlay: { alpha: keyframeExpr([{ t: slide1, v: 0 }, { t: slide1 + fade, v: 1 }]) } },
    photoSource(plan, g.aligned, {
      alpha: keyframeExpr([{ t: slide1, v: 1 }, { t: slide1 + fade, v: 0 }]),
      ...slideKeys(g, 0, slide1, 1, 0),
    }),
  ]);
}

/** Beat 6: back out from the tile to the whole M. */
export function buildOutroDoc(plan: HarnessPlan, durationMs: number): MosaicDocument {
  const g = photoGeometry(plan);
  const travel = Math.max(0.3, (plan.timeline.outroMs / 1000) * 0.75);
  const camera = zoomToTileCamera({ tile: g.tile, stageW: plan.frameW, stageH: g.layout.stageH, zoom: g.zoom, startSec: 0, endSec: travel, reverse: true });
  return framedDoc(plan, g.layout, durationMs, { type: "mosaic", ref: "stage", effects: { camera } }, identityLine(plan.target.entry), plan.tileCaption);
}

/**
 * Beat 7: the brand closer — the m0saic logo, the wordmark, where to claim a
 * tile. The SAME frame as the outro it dissolves from: the stage row with
 * the M at `layout.side` on the same pixels (the community M's tiles become
 * the logo's tiles in place), the identity line becomes the wordmark, the
 * tile line becomes the repo. Nothing jumps across the crossfade.
 */
export function buildCloserDoc(plan: HarnessPlan, durationMs: number): MosaicDocument {
  const layout = frameLayout(plan.frameW, plan.frameH);
  const logo = buildLogoDoc({ side: layout.side, fps: plan.fps, durationMs, color: plan.props.accentColor, canvasColor: plan.props.canvasColor });
  const wordmark = wordmarkRowDoc({ rowW: plan.frameW, rowH: layout.capH, fps: plan.fps, durationMs, ink: plan.props.textColor, accent: plan.props.accentColor, canvasColor: plan.props.canvasColor });
  // On the brand field, like the intro — the outro → closer crossfade fades it in.
  return fieldedDoc(plan, layout, durationMs, { stage: stageDoc(plan, layout, durationMs, logo), wordmark }, [
    { type: "mosaic", ref: "stage" },
    { type: "mosaic", ref: "wordmark" },
    captionSource(`github.com/${plan.repo}`, plan.frameW, layout.capH, plan.props.accentColor),
  ], {});
}

/**
 * The whole provenance video as an emit:single pipeline under the timing
 * law. Every join but the last is a CUT on an identical frame (the slide
 * and the dissolves live inside their steps, so nothing jumps); only the
 * outro → closer join is a crossfade, carried by the outgoing step.
 */
export function buildProvenancePipeline(plan: HarnessPlan): MosaicDocumentPipeline {
  const t = plan.timeline;
  const x = t.xfadeMs;
  const closer = t.closerMs > 0;
  const steps: MosaicPipelineStep[] = [];
  const revealMs = t.revealMs + t.slideMs;
  steps.push({ name: "intro", label: "The M", durationMs: t.introVisibleMs, file: buildIntroDoc(plan, t.introVisibleMs) });
  steps.push({ name: "reveal", label: "Your tile", durationMs: revealMs, file: buildRevealDoc(plan, revealMs) });
  steps.push({ name: "piece", label: "Your canvas", durationMs: t.pieceVisibleMs, file: buildPieceDoc(plan, t.pieceVisibleMs) });
  steps.push({ name: "return", label: "Back to your tile", durationMs: revealMs, file: buildReturnDoc(plan, revealMs) });
  const outroMs = t.outroMs + (closer ? x : 0);
  steps.push({ name: "outro", label: "Back to the M", durationMs: outroMs, file: buildOutroDoc(plan, outroMs), ...(closer && x > 0 ? { transitionToNext: { type: "fade", durationMs: x } } : {}) });
  if (closer) steps.push({ name: "closer", label: "m0saic", durationMs: t.closerMs, file: buildCloserDoc(plan, t.closerMs) });
  return {
    kind: "mosaic_pipeline",
    version: 1,
    emit: "single",
    size: { width: plan.frameW, height: plan.frameH },
    fps: plan.fps,
    durationMs: t.totalMs,
    durationFit: "cut",
    defaultTransition: { type: "cut" },
    backgroundColor: plan.props.canvasColor as never,
    steps,
  };
}
