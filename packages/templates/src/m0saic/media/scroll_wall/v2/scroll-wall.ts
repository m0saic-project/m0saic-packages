/**
 * Scroll Wall v1 — an endless scrolling wall of clips.
 *
 * A wall of video/image tiles (1–4 rows, optionally alternating direction)
 * that scrolls sideways forever. The pan is CONTENT motion, not camera
 * motion: each clip is a real `media` source in a real DSL cell sized to its
 * on-screen footprint, translated by an `overlay.xExpr` carrying its phase
 * plus the shared scroll (see `motion.ts`). Full native resolution, real
 * video playback, all geometry in the m0 string, and a mathematically
 * seamless loop at whole-number `motion.cycles`.
 *
 * # The geometry contract is a FOOTPRINT declaration here
 *
 * Each cell declares a tile's footprint and row band, not an instantaneous
 * position — the motion lives in `overlay.xExpr`, which the geometry
 * contract never reads. `withGeometryContract` still catches real size/drift
 * violations (house pattern), but a green contract is NOT positional
 * evidence; the motion is validated by the comb invariant in
 * `motion.test.ts`. `importance = floor(i / slots)` — the "wrap generation"
 * — gives slot-sharing tiles a deterministic paint order WITHOUT losing the
 * layer packing (per-clip importance would bucket every rect alone and blow
 * the layer count from 2 to 10; measured in the step-0 prototype).
 *
 * # RAM: `clipDurationMs` is load-bearing, not cosmetic
 *
 * The engine's tile chain runs `loop` BEFORE `scale`, so each looping
 * source's frame store holds `min(clipFrames, outputFrames)` frames at the
 * asset's NATIVE resolution — and that store is not counted by the buffer
 * guard, so overflowing it is a raw OOM, not a clean error. Every video
 * source therefore always sets `playback.clipDurationMs`, computed from a
 * loop-store budget (~800 MB; a ~1.2 GB fixed baseline sits on top) against
 * the probed asset dimensions. `tiles.clipWindowMs` (0 = auto) overrides
 * the window. Creatively this is also the right call — a wall of short
 * looping snippets is the format. (Engine follow-up filed separately: move
 * `loopFilters` after the scale; measured 3.6× less RAM.)
 *
 * # Hard cap: 24 tiles — and who pays for it
 *
 * Above 64 ffmpeg inputs the engine splits into band chunks with rebased
 * frames — which would silently break both the `baseX` our xExpr subtracts
 * and the framebuffer clipping the wrap relies on. `rows × slotCount` is
 * hard-capped at 24, well clear of the 64-input split and of the RAM
 * budget. (The engine's overlay-depth WARNING past 20 composites is
 * expected and harmless here — v1 emits no masks.)
 *
 * The cap couples two knobs the panel draws as independent sliders, so it is
 * paid by the LOOK knob, never by the content: `visibleCount` says how big
 * the tiles are, so it walks DOWN to the largest count that fits the cap at
 * the chosen `rows` (see {@link fitVisibleCount}) and the wall renders with
 * bigger tiles. `clips` is content — dropping one would silently lose a clip
 * the caller asked for — so a clip list that cannot fit at ANY `visibleCount`
 * (`rows × clips > 24`) is still a hard error, named as such. Before this
 * split, Rows=4 + Visible=6 — two slider drags off the defaults — rendered an
 * error card.
 *
 * # v1 non-goals (deferred)
 *
 * - Vertical scroll (the `yExpr` twin — `geometry.ts` is already
 *   axis-symmetric to leave the door open).
 * - Rounded corners / masks: the `svg` rasterizer's inline masks silently
 *   collapse to their bounding box past ~25 overlays, and `geq` is an
 *   interpreter filter (catastrophic at 12–24 tiles). v2 can wrap rows in
 *   nested-mosaic bands.
 * - Real horizontal margins: a scrolling layer bleeds past any horizontal
 *   margin (overlay does not clip to the dest rect; only the canvas
 *   framebuffer clips). `tiles.marginPx` is therefore VERTICAL ONLY; true
 *   side margins need one child render per row.
 * - Per-row speed (breaks the shared loop period); a soundtrack /
 *   single-unmuted-clip prop; per-clip labels.
 *
 * A truly flush zero-gap wall is also unsupported: the wrap handoff needs
 * `gapX ≥ 1` px of off-screen slack (see `geometry.ts`).
 */
import type {
  AssetId,
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicRenderableFile,
  MosaicSource,
  MosaicTemplate,
} from "@m0saic/types";
import { asAssetId, asTemplateId } from "@m0saic/types";
import {
  definePropsSchema,
  makeColorTile,
  makeErrorMosaic,
  bindProps,
  type PropBindingEntry,
  mulberry32,
  placeOptimizedPieces,
  registerTemplate,
  slugifyAssetKeyFromPath,
  uniqueAssetKey,
  withGeometryContract,
  type OptimizablePiece,
} from "@m0saic/template-utils";
// Shared field-entry helpers (the alpine shapes, hosted by screencap-grid v2).
import { bBool, bColor, bEnum, bNum } from "../../screencap_grid/v3/screencap-grid";
import { computeScrollWallGeometry, type ScrollWallGeometry } from "../v1/geometry";
import {
  buildScrollXExpr,
  resolveSpeedPxPerSec,
  rowDirectionSign,
  rowPhasePx,
  type ScrollMotionParams,
} from "../v1/motion";

const SCROLL_WALL_V2_ID = "@m0saic/media/scroll_wall/v2";

/** Hard tile cap — see the module docblock (chunk-split + RAM). */
export const SCROLL_WALL_MAX_TILES = 24;

/** Loop-STORE budget (bytes); the ~1.2 GB fixed pipeline baseline sits on top. */
const LOOP_STORE_BUDGET_BYTES = 0.8e9;
const CLIP_WINDOW_MIN_MS = 750;
const CLIP_WINDOW_MAX_MS = 8000;
/** Unprobed assets are budgeted as 1080p (conservative). */
const FALLBACK_FRAME_BYTES = 1920 * 1080 * 1.5;

/** Demo mode (no clips): six fixed hues cycle as lavfi tiles carrying the same xExpr. */
const DEMO_HUES: MosaicColor[] = [
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f97316",
  "#10b981",
  "#06b6d4",
];

// ---- PROPS ----

export type ScrollWallMotionConfig = {
  /** Flip travel direction on odd rows. Default true. */
  alternateRowDirection?: boolean;
  /** Per-row phase offset as a fraction of PITCH (not of the period). 0..1, default 0.5. */
  rowOffsetFrac?: number;
  /** How speed is specified. Default "cycles". */
  speedMode?: "cycles" | "pxPerSec";
  /** Strip cycles over the render. Whole numbers loop seamlessly. 0.25..8, default 1. */
  cycles?: number;
  /** Explicit speed when speedMode="pxPerSec". 10..2000, default 240. */
  pxPerSec?: number;
  /** Snap speed to integer px/frame (kills ±1px jitter, breaks exact loop). Default false. */
  snapVelocityToFrameGrid?: boolean;
};

export type ScrollWallTilesConfig = {
  /** Gap between tiles, px — snapped DOWN to the canvas lattice, min 1; thinned to fit a narrow canvas. Default 24. */
  gapPx?: number;
  /**
   * VERTICAL-ONLY outer margin, px (a scrolling layer would bleed past any
   * horizontal margin). Default 0; thinned to fit on a short canvas.
   */
  marginPx?: number;
  /** cover crops to fill the cell; contain letterboxes. Default "cover". */
  fit?: "cover" | "contain";
  /** Canvas background behind the gaps. Default "#0b0b0f". */
  backgroundColor?: MosaicColor;
  /** Per-clip loop window, ms. 0 = auto from the RAM budget. Default 0. */
  clipWindowMs?: number;
};

export type ScrollWallVariationConfig = {
  /** Shuffle the clip order (seeded). Default false. */
  shuffle?: boolean;
  /** Give repeated clips a seeded clipStartMs so repeats aren't frame-identical. Default true. */
  staggerRepeats?: boolean;
  /** Seed for shuffle + stagger. Default 1. */
  seed?: number;
};

export type ScrollWallV2Props = {
  /** Clips for the wall — video AND image, up to `24 / rows`. Empty → demo hues. */
  clips?: string[];
  /** Number of rows. 1..4, default 2. */
  rows?: number;
  /**
   * Tiles visible across the canvas. 1..12, default 4 — walked DOWN when the
   * row count would push the wall past the 24-tile cap (see
   * {@link fitVisibleCount}).
   */
  visibleCount?: number;
  /** Base travel direction. Default "left". */
  direction?: "left" | "right";
  motion?: ScrollWallMotionConfig;
  tiles?: ScrollWallTilesConfig;
  variation?: ScrollWallVariationConfig;
  /**
   * Dev-only geometry contract: assert every tile's footprint survived to
   * the pixels (and surface the achieved precision floors / basis in the
   * `editor.geometryContract` stamp). Deterministic default false.
   */
  debugGeometry?: boolean;
};

const propsSchema = definePropsSchema<ScrollWallV2Props>({
  clips: {
    type: "media[]",
    required: false,
    meta: {
      control: { multiple: true, picker: "folder", accept: ["video", "image"] },
    },
  },
  rows: {
    type: "number",
    required: false,
    meta: { constraints: { min: 1, max: 4 } },
  },
  visibleCount: {
    type: "number",
    required: false,
    meta: { constraints: { min: 1, max: 12 } },
  },
  direction: {
    type: "string",
    required: false,
    meta: { constraints: { oneOf: ["left", "right"] } },
  },
  motion: {
    type: "group" as never,
    required: false,
    fields: {
      alternateRowDirection: bBool(),
      rowOffsetFrac: bNum({ flavor: "slider", step: 0.05 }, { min: 0, max: 1 }),
      speedMode: bEnum(["cycles", "pxPerSec"]),
      cycles: bNum({ flavor: "slider", step: 0.25 }, { min: 0.25, max: 8 }),
      pxPerSec: bNum({ flavor: "slider", step: 10, unit: "px/s" }, { min: 10, max: 2000 }),
      snapVelocityToFrameGrid: bBool(),
    },
  } as never,
  tiles: {
    type: "group" as never,
    required: false,
    fields: {
      gapPx: bNum({ flavor: "slider", step: 1, unit: "px" }, { min: 1, max: 96 }),
      marginPx: bNum({ flavor: "slider", step: 1, unit: "px" }, { min: 0, max: 200 }),
      fit: bEnum(["cover", "contain"]),
      backgroundColor: bColor(),
      clipWindowMs: bNum({ flavor: "slider", step: 250, unit: "ms" }, { min: 0, max: 8000 }),
    },
  } as never,
  variation: {
    type: "group" as never,
    required: false,
    fields: {
      shuffle: bBool(),
      staggerRepeats: bBool(),
      seed: bNum({ flavor: "slider", step: 1 }, { min: 0, max: 9999 }),
    },
  } as never,
  debugGeometry: {
    type: "boolean",
    required: false,
  },
});

// ---- RESOLUTION ----

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

type ResolvedKnobs = {
  rows: number;
  visibleCount: number;
  direction: "left" | "right";
  alternateRowDirection: boolean;
  rowOffsetFrac: number;
  speedMode: "cycles" | "pxPerSec";
  cycles: number;
  pxPerSec: number;
  snapVelocityToFrameGrid: boolean;
  gapPx: number;
  marginPx: number;
  fit: "cover" | "contain";
  backgroundColor: MosaicColor;
  clipWindowMs: number;
  shuffle: boolean;
  staggerRepeats: boolean;
  seed: number;
};

function resolveKnobs(props: ScrollWallV2Props): ResolvedKnobs {
  return {
    rows: clamp(Math.round(props.rows ?? 2), 1, 4),
    visibleCount: clamp(Math.round(props.visibleCount ?? 4), 1, 12),
    direction: props.direction === "right" ? "right" : "left",
    alternateRowDirection: props.motion?.alternateRowDirection ?? true,
    rowOffsetFrac: clamp(props.motion?.rowOffsetFrac ?? 0.5, 0, 1),
    speedMode: props.motion?.speedMode === "pxPerSec" ? "pxPerSec" : "cycles",
    cycles: clamp(props.motion?.cycles ?? 1, 0.25, 8),
    pxPerSec: clamp(props.motion?.pxPerSec ?? 240, 10, 2000),
    snapVelocityToFrameGrid: props.motion?.snapVelocityToFrameGrid ?? false,
    gapPx: clamp(Math.round(props.tiles?.gapPx ?? 24), 1, 96),
    marginPx: clamp(Math.round(props.tiles?.marginPx ?? 0), 0, 200),
    fit: props.tiles?.fit === "contain" ? "contain" : "cover",
    backgroundColor: props.tiles?.backgroundColor ?? "#0b0b0f",
    clipWindowMs: clamp(Math.round(props.tiles?.clipWindowMs ?? 0), 0, CLIP_WINDOW_MAX_MS),
    shuffle: props.variation?.shuffle ?? false,
    staggerRepeats: props.variation?.staggerRepeats ?? true,
    seed: Math.round(props.variation?.seed ?? 1),
  };
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x;
}

/**
 * Deterministic row rotation stride, coprime with the clip count so no row
 * repeats another row's sequence verbatim (row r shows `order[(i + r·stride)
 * mod L]`). Smallest coprime ≥ 2 when one exists.
 */
export function coprimeStride(clipCount: number): number {
  if (clipCount <= 2) return 1;
  for (let s = 2; s < clipCount; s++) {
    if (gcd(s, clipCount) === 1) return s;
  }
  return 1;
}

export type FitVisibleCountResult =
  | {
      ok: true;
      /** The count actually laid out — `≤ requested`. */
      visibleCount: number;
      geometry: ScrollWallGeometry;
      /** Slots per row at `visibleCount` (`max(clipCount, minSlotCount)`). */
      slotCount: number;
    }
  | { ok: false; error: string };

/**
 * The widest tile layout that fits the {@link SCROLL_WALL_MAX_TILES} cap.
 *
 * `visibleCount` is a LOOK knob, so the cap is paid here: walk down from the
 * requested count and take the first one whose `rows × slotCount` fits. Bigger
 * tiles are a legible answer to "that many tiles don't fit"; an error card is
 * not — and Rows=4 + Visible=6 (two slider drags off the defaults) used to hit
 * one. Walking down also rescues a canvas too narrow for the requested count
 * at all (`320px × 12 visible`), for the same reason.
 *
 * The clip list is NOT walked: callers must pre-check `rows × clipCount`
 * against the cap and fail with a clips-specific message, because
 * `slotCount ≥ clipCount` is what makes every clip appear. With that check
 * done, `visibleCount: 1` always fits (`slotCount = max(clipCount, 2)` and
 * `rows ≤ 4`), so this only reports geometry errors that hold at every count
 * (a cross-axis `rows`/`margin` overflow).
 */
export function fitVisibleCount(args: {
  canvasW: number;
  canvasH: number;
  rows: number;
  gapPx: number;
  marginPx: number;
  requestedVisibleCount: number;
  clipCount: number;
}): FitVisibleCountResult {
  const { canvasW, canvasH, rows, gapPx, marginPx, requestedVisibleCount, clipCount } = args;
  // Keep the LAST error, not the first: the walk ends at one tile per slot, so
  // whatever still fails there is the blocker no tile size can move (usually
  // the row count). Reporting the v=12 message instead would tell a caller to
  // fix `visibleCount` when the canvas is really too short for their rows.
  let lastError: string | null = null;
  for (let v = requestedVisibleCount; v >= 1; v--) {
    const geo = computeScrollWallGeometry({ canvasW, canvasH, visibleCount: v, rows, gapPx, marginPx });
    if (!geo.ok) {
      lastError = geo.error;
      continue;
    }
    const slotCount = Math.max(clipCount, geo.geometry.minSlotCount);
    if (rows * slotCount <= SCROLL_WALL_MAX_TILES) {
      return { ok: true, visibleCount: v, geometry: geo.geometry, slotCount };
    }
  }
  return {
    ok: false,
    error:
      lastError ??
      // Unreachable with the caller's clip pre-check in place; kept so a future
      // caller that forgets it gets a sentence rather than a crash.
      `${clipCount} clip(s) x ${rows} row(s) needs more than the ${SCROLL_WALL_MAX_TILES}-tile cap at every tile size.`,
  };
}

/** One entry per input clip (unique by raw path), probed + manifest-minted. */
type ClipInfo = {
  assetId: AssetId;
  mediaType: "video" | "image";
  isVideo: boolean;
  /** Probed asset duration (ms) when known. */
  durationMs: number | null;
  /** Native frame footprint for the loop-store budget. */
  frameBytes: number;
  /** Resolved loop window (ms); filled by the budget pass, video only. */
  windowMs: number;
};

// ---- RENDER ----

/** What every tile of the wall shows besides its clip (v2 handles). */
const WALL_HANDLES: PropBindingEntry[] = [
  { propKey: "rows" },
  { propKey: "visibleCount" },
  { propKey: "tiles.gapPx" },
  { propKey: "tiles.marginPx" },
  { propKey: "tiles.clipWindowMs" },
  { propKey: "motion.cycles" },
  { propKey: "motion.pxPerSec" },
  { propKey: "motion.rowOffsetFrac" },
  { propKey: "variation.seed" },
];

export function renderScrollWallV2(
  props: ScrollWallV2Props,
  ctx: MosaicEngineContext,
): MosaicDocument {
  const canvasW = ctx.target.width;
  const canvasH = ctx.target.height;
  const fps = ctx.target.fps ?? 30;
  const durationMs = ctx.target.durationMs ?? 4000;
  const k = resolveKnobs(props);

  const fail = (msg: string) =>
    makeErrorMosaic(msg, { title: "Scroll Wall", width: canvasW, height: canvasH });

  // ── Inputs: real clips, or the demo hues when none are given ──
  const rawClips = (props.clips ?? []).filter((c) => typeof c === "string" && c.length > 0);
  const demo = rawClips.length === 0;
  const clipCount = demo ? DEMO_HUES.length : rawClips.length;

  // The one ask the cap cannot absorb: every clip needs its own slot in every
  // row, so a list this long would have to DROP clips (see fitVisibleCount).
  if (k.rows * clipCount > SCROLL_WALL_MAX_TILES) {
    const maxClips = Math.floor(SCROLL_WALL_MAX_TILES / k.rows);
    return fail(
      `${clipCount} clips x ${k.rows} rows = ${k.rows * clipCount} tiles exceeds the ${SCROLL_WALL_MAX_TILES}-tile cap ` +
        `(each tile is one ffmpeg input; above the cap the engine's chunk split would silently break the scroll). ` +
        `At ${k.rows} row${k.rows === 1 ? "" : "s"} the wall takes up to ${maxClips} clips — pass fewer clips, or use fewer rows.`,
    );
  }

  // `visibleCount` pays the rest of the cap by walking down to bigger tiles.
  const fit = fitVisibleCount({
    canvasW,
    canvasH,
    rows: k.rows,
    gapPx: k.gapPx,
    marginPx: k.marginPx,
    requestedVisibleCount: k.visibleCount,
    clipCount,
  });
  if (!fit.ok) return fail(fit.error);
  const g = fit.geometry;
  const slotCount = fit.slotCount;

  const assets: MosaicAssetManifest = {};
  const clips: ClipInfo[] = [];
  if (!demo) {
    const problems: string[] = [];
    for (const rawPath of rawClips) {
      // ctx.media is keyed by the RAW caller string; the manifest key must
      // be a safe unique slug (screencap-grid convention).
      const meta = ctx.media[asAssetId(rawPath)];
      if (meta?.kind === "audio") {
        problems.push(`"${rawPath}" is audio — the wall takes video and image clips`);
        continue;
      }
      const isVideo = meta?.kind === "video";
      const assetId = uniqueAssetKey(slugifyAssetKeyFromPath(rawPath), assets);
      assets[assetId] = {
        kind: "file",
        path: rawPath,
        mediaType: isVideo ? "video" : "image",
      };
      clips.push({
        assetId,
        mediaType: isVideo ? "video" : "image",
        isVideo,
        durationMs: isVideo && meta.durationMs != null && meta.durationMs > 0 ? meta.durationMs : null,
        frameBytes:
          meta && meta.width > 0 && meta.height > 0
            ? meta.width * meta.height * 1.5
            : FALLBACK_FRAME_BYTES,
        windowMs: 0,
      });
    }
    if (problems.length > 0) return fail(problems.join("; "));
  }

  // ── Seeded ordering: one stream, fixed consumption order (shuffle first,
  //    then one draw per tile row-major — so which tiles USE their draw never
  //    shifts the stream) ──
  const rng = mulberry32(k.seed >>> 0);
  const order = Array.from({ length: clipCount }, (_, i) => i);
  if (k.shuffle) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  const stride = coprimeStride(clipCount);
  const clipIndexAt = (row: number, i: number) => order[(i + row * stride) % clipCount];

  // ── RAM budget → per-clip loop window (video only). The loop store holds
  //    min(clipFrames, outputFrames) NATIVE-res frames per video tile. ──
  if (!demo) {
    let totalFrameBytes = 0;
    for (let r = 0; r < k.rows; r++) {
      for (let i = 0; i < slotCount; i++) {
        const clip = clips[clipIndexAt(r, i)];
        if (clip.isVideo) totalFrameBytes += clip.frameBytes;
      }
    }
    const budgetFrames =
      totalFrameBytes > 0 ? Math.floor(LOOP_STORE_BUDGET_BYTES / totalFrameBytes) : 0;
    const autoWindowMs = Math.round((budgetFrames / fps) * 1000);
    for (const clip of clips) {
      if (!clip.isVideo) continue;
      const upperMs = Math.max(1, Math.min(clip.durationMs ?? CLIP_WINDOW_MAX_MS, CLIP_WINDOW_MAX_MS));
      clip.windowMs =
        k.clipWindowMs > 0
          ? clamp(k.clipWindowMs, 1, upperMs)
          : clamp(autoWindowMs, Math.min(CLIP_WINDOW_MIN_MS, upperMs), upperMs);
    }
  }

  // ── Motion + pieces ──
  const period = slotCount * g.pitch;
  const pxPerSec = resolveSpeedPxPerSec({
    speedMode: k.speedMode,
    cycles: k.cycles,
    pxPerSec: k.pxPerSec,
    period,
    fps,
    durationMs,
    snapVelocityToFrameGrid: k.snapVelocityToFrameGrid,
  });
  const durationSec = durationMs / 1000;

  const pieces: OptimizablePiece[] = [];
  /** Clip indices already given their own (replace) handle — see the binding below. */
  const boundClips = new Set<number>();
  for (let r = 0; r < k.rows; r++) {
    const motion: ScrollMotionParams = {
      slots: g.slots,
      pitch: g.pitch,
      period,
      phasePx: rowPhasePx(k.rowOffsetFrac, r, g.pitch),
      sign: rowDirectionSign(k.direction, r, k.alternateRowDirection),
      pxPerSec,
      durationSec,
    };
    for (let i = 0; i < slotCount; i++) {
      const draw = rng();
      const xExpr = buildScrollXExpr(motion, i);
      const editor = { owner: "template" as const, label: `clip:r${r}:i${i}` };
      let source: MosaicSource;
      if (demo) {
        source = {
          ...makeColorTile(DEMO_HUES[clipIndexAt(r, i)], { overlay: { xExpr } }),
          editor,
        };
      } else {
        const clip = clips[clipIndexAt(r, i)];
        // A repeat (the conveyor wrapped past the clip list) gets a seeded
        // demuxer start so it isn't frame-identical to its first showing.
        const isRepeat = Math.floor(i / clipCount) > 0;
        const stagger =
          k.staggerRepeats && isRepeat && clip.isVideo && clip.durationMs != null
            ? Math.floor(draw * Math.max(0, clip.durationMs - clip.windowMs))
            : null;
        source = {
          type: "media",
          mediaType: clip.mediaType,
          assetId: clip.assetId,
          placement: { fit: k.fit },
          ...(clip.isVideo
            ? {
                playback: {
                  loopMode: "loop" as const,
                  clipDurationMs: clip.windowMs,
                  ...(stagger != null ? { clipStartMs: stagger } : {}),
                },
                audio: { enabled: false },
              }
            : {}),
          overlay: { xExpr },
          editor,
        };
      }
      // v2: every tile is a HANDLE. It shows a clip → it takes a dropped file;
      // and the wall's shape and motion are what the tiles are and do, so
      // they carry those knobs too. WHICH element a tile edits (founder
      // 2026-10-01, "dragging one video into one cell sets it for ALL cells"):
      // the wall cycles its clip list, so one clip fills every slot, and
      // binding every showing of it to the same element meant a second drop
      // could only REPLACE it — there was no way to add a second clip. Now
      // the FIRST tile (in draw order) showing a clip edits that clip; every
      // repeat is the ADD handle (`clips[clipCount]`), so a drop there grows
      // the list and the wall cycles through more. The demo wall's tiles are
      // all the first one to add.
      const clipIndex = clipIndexAt(r, i);
      const ownShowing = !demo && !boundClips.has(clipIndex);
      if (ownShowing) boundClips.add(clipIndex);
      source = bindProps(source, [
        { propKey: "clips", index: demo ? 0 : ownShowing ? clipIndex : clipCount },
        ...WALL_HANDLES,
      ]);
      pieces.push({
        rect: {
          x: (i % g.slots) * g.pitch,
          y: g.rowYs[r],
          w: g.cellW,
          h: g.rowH,
          importance: Math.floor(i / g.slots),
        },
        source,
        drift: "exact",
      });
    }
  }

  const placed = placeOptimizedPieces({ rootW: canvasW, rootH: canvasH, pieces });

  const doc: MosaicDocument = {
    kind: "mosaic_document",
    version: 1,
    m0: placed.m0,
    sources: placed.sources,
    assets,
    backgroundColor: k.backgroundColor,
    // A wall of clips playing their own audio at once is noise, so v1 is
    // silent by design (a soundtrack prop is a listed non-goal) and every video
    // source is muted individually. Saying it once at the document says WHY:
    // the silence is the design, not six flags that happen to agree.
    audio: { mode: "off" },
  };

  return withGeometryContract(doc, ctx, {
    templateId: SCROLL_WALL_V2_ID,
    expectations: placed.expectations,
    debug: props.debugGeometry === true,
  });
}

// ---- TEMPLATE ----

export const ScrollWallV2: MosaicTemplate<ScrollWallV2Props> = {
  id: asTemplateId(SCROLL_WALL_V2_ID),
  version: 2,
  capabilities: { tier: "core" },
  propsSchema,

  outputHints: {

    format: { kind: "video", container: "mp4" },
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 4000,
    // The footage is the picture from its first frame — nothing animates in.
    posterTimeMs: 0,
  },

  defaultProps: {
    debugGeometry: false,
    rows: 2,
    visibleCount: 4,
    direction: "left",
    motion: {
      alternateRowDirection: true,
      rowOffsetFrac: 0.5,
      speedMode: "cycles",
      cycles: 1,
      pxPerSec: 240,
      snapVelocityToFrameGrid: false,
    },
    tiles: {
      gapPx: 24,
      marginPx: 0,
      fit: "cover",
      backgroundColor: "#0b0b0f",
      clipWindowMs: 0,
    },
    variation: { shuffle: false, staggerRepeats: true, seed: 1 },
  },

  render(props: ScrollWallV2Props, ctx: MosaicEngineContext): Promise<MosaicRenderableFile> {
    return Promise.resolve(renderScrollWallV2(props, ctx));
  },
};

registerTemplate(ScrollWallV2);
