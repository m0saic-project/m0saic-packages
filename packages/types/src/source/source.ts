import type { AssetId } from "../asset";
import { type MosaicColor } from "../colors/mosaicColor";
import type { MosaicBackgroundImage } from "../document/document";
import type { AliasId, FlattenedStableKey, TemplateId } from "../identifiers";
import { type MosaicEngineMeta, type MosaicSourceEditorMeta } from "../meta";
import type { MosaicAudioConfig } from "../output/audio-config";
import type { MosaicColorConfig } from "../output/color-config";
import type { MosaicContainerMetadata } from "../output/container-metadata";
import type { MosaicOutputFormat } from "../output/format";
import type { MosaicOutputTarget } from "../output/target";

export type LoopMode = "loop" | "cut" | "freeze";

// ── Source-level mask ────────────────────────────────────

/**
 * A clipping mask reference attached to a visual source.
 *
 * The engine resolves the mask at render time (when tile pixel dimensions
 * are known) and applies it via alphamerge.
 *
 * Variants:
 * - "alpha-image": a pre-rendered grayscale PNG mask file. The mask
 *   references a `kind: "file"` entry in the parent document's asset
 *   manifest by `assetId`. White = visible, black = clipped.
 * - "inline-mask": the mask shape carried inline on the source — an SVG
 *   path string `localPath` authored against a design-space `bounds`
 *   rect. Engine scales `bounds` to the tile's actual render size
 *   (`scaleX = tileW / bounds.width`, same for y) and rasterizes the
 *   scaled path into a binary alpha mask. The shape on disk matches the
 *   `MosaicMaskEntry` entries that `MosaicMaskSetFile.masks[]` holds —
 *   this is the canonical way to attach silhouettes to a source: it's
 *   self-contained (no out-of-band lookup), travels with the document,
 *   and matches what the SVG → Mosaic wizard's `masks.json` bakes per
 *   frame. Templates that consume dictionary entries with mask sets
 *   load those masks at template-execution time and emit them inline
 *   on their sources.
 */
export type MosaicSourceMask =
  | {
      kind: "alpha-image";
      assetId: AssetId;
    }
  | {
      kind: "inline-mask";
      /**
       * SVG path data in local coordinates (relative to `bounds`'s origin).
       * Same shape as `MosaicMaskEntry.localPath` from `@m0saic/types`'s
       * `MosaicMaskSetFile` — when baking a wizard `masks.json` (or a
       * dictionary mask set) onto frames, callers copy `localPath` +
       * `bounds` verbatim.
       */
      localPath: string;
      /**
       * Design-space bounding box the path was authored against. The
       * engine derives the scale factor at render time:
       *   `scaleX = tileRenderWidth / bounds.width`
       *   `scaleY = tileRenderHeight / bounds.height`
       */
      bounds: { x: number; y: number; width: number; height: number };
      /**
       * Body alpha for the area OUTSIDE the path, 0..1 (default 0 = fully
       * clipped / transparent body). When > 0 the whole `bounds` renders at
       * this alpha beneath the path (which stays fully opaque), so a single
       * colored tile can show a translucent fill PLUS opaque marks — e.g. a
       * wireframe's translucent rect wash with crisp opaque borders/labels.
       */
      matte?: number;
      /**
       * STROKED polylines added to the mask (white, round cap + join) —
       * the vector representation of a paint BRUSH: each stroke is the
       * brush path `d` at `width` = brush diameter, design-space px.
       * Rasterizes alongside the filled `localPath` (which may be `""`
       * when strokes/parts supply all the geometry).
       */
      strokes?: Array<{ d: string; width: number }>;
      /**
       * Placed sub-shapes composited into the same mask — each part's
       * own coordinate space is placed into the mask's design space via
       * `translate` (+ optional `scale`). Lets a composite mask carry
       * RECT-LOCAL shapes without host-side path rewriting (the
       * rasterizer emits an SVG `<g transform>`): e.g. Easy Blur's
       * "mask" geometry places each region's rect-local mask at the
       * region's canvas position.
       */
      parts?: Array<{
        /** Filled path in the part's own coordinate space. */
        d?: string;
        /** Stroked polylines in the part's own coordinate space. */
        strokes?: Array<{ d: string; width: number }>;
        translate: { x: number; y: number };
        /** Default 1,1 — parts scale when the authored space differs. */
        scale?: { x: number; y: number };
        /**
         * Clip rect in the MASK's design space (the parent `bounds`
         * coordinate system). Geometry that overflows it — e.g. a brush
         * stroke's width past its region rect — is cut, matching the
         * hard cell-edge clipping the real-geometry flavors get for free.
         */
        clip?: { x: number; y: number; width: number; height: number };
      }>;
      /**
       * Soft mask edges: gaussian sigma in DESIGN-space px applied to the
       * rasterized mask before alphamerge (scales with `bounds` → tile).
       * Default 0 = hard edges (today's behavior, byte-identical).
       */
      featherPx?: number;
    };

/** Horizontal alignment of the rendered content inside the tile */
export type HorizontalAlign = "left" | "center" | "right";
/** Vertical alignment of the rendered content inside the tile */
export type VerticalAlign = "top" | "middle" | "bottom";

export type MosaicPlacementFit = "contain" | "cover";

// -----------------------------------------------------------------------------
// Placement (PROD SHAPE)
// - All TILE-relative values are fractions of the tile size (0..1). No pixels.
// - `x` applies to left+right, `y` applies to top+bottom.
// - Per-side overrides win over axis overrides.
// - ONE deliberate exception: `sourceRect` addresses the SOURCE's own pixel
//   grid (source-native px) — its whole purpose is "exactly these source
//   bounds", which fractions would blur through rounding.
// -----------------------------------------------------------------------------

export type MosaicBoxFrac =
  | number
  | {
      /** symmetric on both sides */
      x?: number; // fraction of tile width applied to left AND right
      y?: number; // fraction of tile height applied to top AND bottom

      /** per-side overrides (win over x/y) */
      top?: number;    // fraction of tile height
      right?: number;  // fraction of tile width
      bottom?: number; // fraction of tile height
      left?: number;   // fraction of tile width
    };

type MosaicPlacementBase = {
  /**
   * Scaling behavior when the content aspect ratio differs from the tile.
   * (default: "contain")
   */
  fit?: MosaicPlacementFit;

  /**
   * Shrink the destination rect BEFORE applying fit math.
   * This changes the box that contain/cover operate within.
   *
   * Role: the SLOT-level gutter. Works for both fits and is typically
   * owned by the composing layer (corner-stamp composers reserve the
   * edge margin here), leaving content-level `padding` free to compose
   * with it instead of fighting over one field.
   *
   * Resolution-agnostic: fractions of TILE size.
   *
   * ⚠️ Applied before the per-tile effects chain — the content's buffer
   * IS the shrunk box, so effects that need headroom (`effects.rotate`)
   * clip against it. Rotation headroom must be real geometry instead: a
   * nested child whose declared `size` equals the padded box (see
   * watermark page-mode `buildPaddedInstanceChild`).
   *
   * Examples:
   *   inset: 0.02                  // 2% on all sides
   *   inset: { x: 0.03, y: 0.02 }  // 3% left/right, 2% top/bottom
   *   inset: { top:0.04, left:0.06, right:0.06, bottom:0.03 }
   */
  inset?: MosaicBoxFrac;

  /**
   * Source-rect windowing: crop the source to EXACTLY this sub-rect
   * FIRST — the cropped window then behaves as the source for
   * everything downstream (fit/align/focus into the content box,
   * effects, masks). Use it when you know the exact bounds you want
   * from the source (e.g. "show source pixels (64,48)–(304,208) in
   * this cell"); pairing a cell with a same-sized `sourceRect` under
   * `fit:"cover"` yields a 1:1 pixel window (the Easy Blur region
   * construction).
   *
   * Units: SOURCE-NATIVE PIXELS (the one absolute-px field in
   * placement — see the block comment above). Values are floored to
   * integers; the rect is clamped to the probed source bounds at plan
   * time, and a rect that collapses below 1×1 fails the render loudly
   * rather than showing the wrong pixels.
   *
   * Spatial, not temporal — the time-based sibling is
   * `overlay.window` ({@link MosaicOverlayWindow}).
   *
   * v1 scope: `media` sources only (validated). Not bakeable into m0
   * geometry (it selects source pixels, not canvas rects), and ignored
   * by `innerContentSize` on purpose — the DESTINATION box is
   * unchanged; only which source pixels fill it changes.
   */
  sourceRect?: { x: number; y: number; w: number; h: number };
};

type MosaicPlacementContain = MosaicPlacementBase & {
  fit?: "contain"; // default path
  hAlign?: HorizontalAlign; // default "center"
  vAlign?: VerticalAlign; // default "middle"

  /**
   * Optional extra "dead space" reserved INSIDE the inset box, before
   * alignment. Only meaningful for "contain" (`cover` forbids it —
   * cover + padding would create intentional dead space).
   *
   * Role: CONTENT-level breathing room — the content author's knob,
   * composing with (not overwriting) the slot's `inset` gutter.
   *
   * Resolution-agnostic: fractions of the INSET BOX — identical to
   * fractions of tile size when `inset` is unset (the engine resolves
   * `padLeft = insetBox.width * padding.left`).
   *
   * ⚠️ Like `inset`, applied before the per-tile effects chain — the
   * shrunk box is the buffer effects (e.g. `rotate`) operate in; see
   * the `inset` warning.
   */
  padding?: MosaicBoxFrac;

  // contain never crops, so a crop anchor is meaningless
  focusX?: never;
  focusY?: never;
};

type MosaicPlacementCover = MosaicPlacementBase & {
  fit: "cover";
  // cover: no empty space, so align is meaningless
  hAlign?: never;
  vAlign?: never;

  // cover + padding creates intentional dead space, so forbid it
  padding?: never;

  /**
   * Cover-crop anchor, horizontal. 0..1 fraction of the overflow to crop
   * from the LEFT: `0` keeps the left edge, `0.5` centers (default), `1`
   * keeps the right edge. Crop offset = `(scaledW - contentW) * focusX`.
   *
   * Matches CSS `object-position` percentage semantics and the
   * {@link MosaicCamera} focus vocabulary. Static plan-time geometry —
   * for an animated reframe use `effects.camera` instead.
   */
  focusX?: number;

  /**
   * Cover-crop anchor, vertical. 0..1 fraction of the overflow to crop from
   * the TOP: `0` keeps the top edge (e.g. faces in portrait photos), `0.5`
   * centers (default), `1` keeps the bottom edge.
   * Crop offset = `(scaledH - contentH) * focusY`.
   */
  focusY?: number;
};

export type MosaicPlacementProps = MosaicPlacementContain | MosaicPlacementCover;

export type MosaicTextPlacementProps = MosaicPlacementProps & {
  /**
   * Optional explicit FFmpeg x-expression.
   * Overrides all hAlign/padding calculations when provided.
   *
   * Example: "w*0.05" or "(main_w-text_w)/2"
   */
  xExpr?: string;
  /**
   * Optional explicit FFmpeg y-expression.
   * Overrides all vAlign/padding calculations when provided.
   *
   * Example: "h-text_h-20" or "text_h*1.5"
   */
  yExpr?: string;
};

export type MosaicTextStyleProps = {
  /**
   * Width of the text border/outline.
   * Expressed as a pixel value (engine may scale with resolution).
   * Default is template-dependent.
   */
  borderWidth?: number;
  /**
   * Color of the border/outline.
   * Accepts hex or any FFmpeg-compatible color string.
   */
  borderColor?: MosaicColor;
  /**
   * Font size in pixels.
   * The engine may scale this to maintain consistency across tile sizes.
   */
  fontSize?: number;
  /**
   * The main text color.
   * Accepts hex or any FFmpeg-compatible color string.
   */
  fontColor?: MosaicColor;
  /**
   * Primary font family or fallback list.
   * Must resolve to a system-installed font or bundled font path.
   */
  fontFamily?: string;
  /**
   * Font weight, CSS-style. A number (100–900) or the keywords "normal" (400)
   * / "bold" (700). The svg rasterizer resolves this to the nearest available
   * variant FILE in the font registry; drawtext maps it best-effort. Default 400.
   */
  fontWeight?: number | "normal" | "bold";
  /**
   * Font slant. "normal" or "italic". The svg rasterizer resolves an italic
   * variant file when available (faux-italic synthesis is a later fallback for
   * fonts lacking one). Default "normal".
   */
  fontStyle?: "normal" | "italic";
  /**
   * Background fill drawn ONLY behind the rendered glyphs (a highlight/"box"),
   * sized to the text — NOT the whole text-source rect (that's
   * `visual.backgroundColor`). Maps to FFmpeg drawtext `box=1:boxcolor=…`.
   * Accepts hex or any FFmpeg-compatible color (incl. `name@alpha`).
   * Default `"none"` (no box).
   */
  boxColor?: MosaicColor;
  /**
   * Padding in pixels between the glyphs and the box edge — FFmpeg drawtext
   * `boxborderw`. Only meaningful when `boxColor` is set. Default 0.
   */
  boxBorderWidth?: number;
};

export type MosaicPlaybackProps = {
  /**
   * Playback speed multiplier.
   *   1   = realtime
   *   0.5 = half speed (slow motion)
   *   2   = double speed
   *
   * Re-times the selected clip window. `clipStartMs` / `clipDurationMs`
   * select SOURCE content first (they are source-time; changing speed never
   * moves the start point); the window then renders over
   * `clipDurationMs / playSpeed` of output time, and `loopMode` fills the
   * remainder of the slot as usual.
   *
   * Wired for `media` sources with mediaType "video" / "audio" (video via
   * setpts, audio via a deterministic chained atempo). A no-op on still
   * images.
   *
   * Also wired for `mosaic` sources (nested child documents): the speed
   * re-times the child's RENDERED deliverable — not its internal media —
   * so the child's own choreography slows/speeds as one unit. When
   * re-timed, the child's rendered length is stamped as `clipDurationMs`
   * (unless authored), making the whole deliverable the loop unit: the
   * default `loopMode` "loop" truly repeats it, "freeze"/"cut" apply to
   * the same window. The child render is also capped to the footage the
   * slot can show (`slotMs × playSpeed`, audio-free children only), so
   * slowed children render proportionally less. Caveats: `clipStartMs`
   * remains a no-op for child deliverables; pipeline-valued children
   * (no known deliverable length) re-time but freeze-extend instead of
   * looping; child audio plays once re-timed (the media caveat below).
   *
   * Remaining unwired kinds (text / ref / lavfi) warn
   * (`PLAY_SPEED_NOT_WIRED_FOR_SOURCE`) and render at 1×.
   *
   * Finite values clamp to [MIN_PLAY_SPEED, MAX_PLAY_SPEED] (0.1–10,
   * `PLAY_SPEED_CLAMPED`). Non-finite or ≤ 0 values fail document
   * validation (`INVALID_PLAY_SPEED`, an error — the plan bails); engine
   * paths that skip full validation defensively ignore them and render at
   * 1× (`PLAY_SPEED_INVALID_IGNORED`).
   *
   * Note the audio caveat: audio plays the source once, re-timed — it does
   * not follow `clipDurationMs` / `loopMode` cycles (pre-existing engine
   * behavior; the slot-length mix cap still applies).
   */
  playSpeed?: number;

  /**
   * Determines how the source behaves when its duration
   * does not match the parent tile’s duration.
   *
   * Default: "loop"
   *
   * Examples:
   *  - "loop": repeat the media seamlessly
   *  - "freeze": hold the final frame or pad silence for audio
   *  - "cut": play once and stop (remainder treated as transparent)
   */
  loopMode?: LoopMode;

  /**
   * Optional trim: starting offset within the source media (ms).
   * Example: 5000 starts 5 seconds into the video.
   */
  clipStartMs?: number;

  /**
   * Optional trim duration (ms), measured in SOURCE time.
   * Example: 2000 means “use 2 seconds starting at clipStartMs”.
   * With `playSpeed` set, the selected window renders over
   * `clipDurationMs / playSpeed` of output time.
   *
   * If omitted, the remaining duration (after start) is used,
   * subject to `loopMode`.
   */
  clipDurationMs?: number;
};

export type RoundingOptions = {
  /**
   * Geometric corner-radius fraction, from 0 to 1.
   *
   * Controls how much of the tile's short side is used as the corner arc:
   *   radiusPx = floor(borderRadius * min(w, h) / 2)
   *
   * The mask is a hard binary alpha:
   *   - Inside the rounded shape:  alpha = 255
   *   - Outside the rounded shape: alpha = 0 (fully transparent)
   *
   * borderRadius = 0   → square (no rounding)
   * borderRadius = 1   → maximum rounding (radius = min(w,h)/2)
   * borderRadius = 0.5 → half of maximum radius
   *
   * Ignored when cornerStyle is "pill" (pill always uses full radius).
   */
  borderRadius?: number;

  /**
   * Shape to use:
   *   - "rounded": rounded rectangle, radius controlled by borderRadius
   *   - "pill": stadium/pill (radius = floor(min(w,h)/2), ignores borderRadius)
   */
  cornerStyle?: "rounded" | "pill";

  /**
   * Which mechanism produces the corner mask.
   *   - "geq": procedural per-pixel `geq` alpha computed once and reused via
   *     `loop`. Self-contained (no rasterization), but adds a `geq` filter NODE
   *     to the filtergraph per rounded tile — a dense composite of many rounded
   *     tiles builds a large graph that ffmpeg allocates in full at init (heavy
   *     on Windows, which eager-commits).
   *   - "svg": bake the rounded rectangle as an `inline-mask` silhouette,
   *     rasterized to a PNG once and applied via `alphamerge` (no `geq`). One
   *     cheap mask input per tile instead of a per-pixel filter node → a much
   *     smaller graph for many-tile composites.
   *
   * Visually identical (both are hard binary corner masks). Default resolved by
   * the engine (`DEFAULT_ROUNDING_RASTERIZER`).
   */
  rasterizer?: "geq" | "svg";
};

/**
 * Camera crop — show a zoomed, optionally-panning sub-window of the source.
 *
 * The engine scales the source up by `zoom`, then crops a content-box-sized
 * window whose top-left tracks `focusX`/`focusY`. Because it is a single
 * scale+crop on one composite, it is depth-independent (no per-tile overlay
 * stacking) and the output stays exactly content-box sized — it never bleeds
 * past the source's cell.
 *
 *   - `zoom`   magnification. 1 = full frame (no crop), 2 = 2× (show a quarter).
 *   - `focusX` horizontal crop center, 0..1 (0 = left edge, 0.5 = centered,
 *              1 = right edge). Default 0.5.
 *   - `focusY` vertical crop center, 0..1. Default 0.5.
 *
 * Each field is a **number** (static) OR a **string** (an ffmpeg expression
 * over `t`, evaluated per frame) — so the camera can ease a pan/zoom to follow
 * a moving target. Absent / `zoom <= 1` with centered focus = no-op.
 *
 * For a static cover-crop anchor with NO magnification (e.g. keep the top of
 * a portrait in a `fit:"cover"` tile), use `placement.focusX`/`focusY` on the
 * cover placement instead — that steers the fit crop itself; the camera
 * operates downstream on the already-cropped content box.
 */
export type MosaicCamera = {
  zoom?: number | string;
  focusX?: number | string;
  focusY?: number | string;
};

export type MosaicEffectProps = {
  /**
   * Geometric rounded / pill masking.
   * Applied before stroke and dropShadow.
   */
  rounding?: RoundingOptions;

  /**
   * Inner stroke that follows the rounded/pill silhouette.
   *
   * Rendered as an inset border inside the masked shape.
   * Deterministic, alpha-aware, and resolution-stable.
   *
   * Typical chart frame usage:
   *   width: 0.0015
   *   color: "#FFFFFF"
   *   alpha: 0.06
   *
   * Only "inner" is supported in v1 to avoid layout ambiguity.
   */
  stroke?: {
    /**
     * Stroke thickness as a fraction of min(w, h).
     *
     * Layout-agnostic: templates never specify pixels.
     * The engine maps to pixels at render time:
     *   widthPx = clamp(floor(width * min(w, h)), 1, floor(min(w, h) / 4))
     *
     * 0.0015 → ~1 px at most sizes
     * 0.01   → ~2 px at 180 h, ~11 px at 1080 h
     *
     * Default: 0.0015
     */
    width?: number;

    /**
     * Stroke color.
     * Accepts hex or any FFmpeg-compatible color string.
     */
    color?: MosaicColor;

    /**
     * Opacity multiplier (0–1).
     * Multiplies stroke color alpha.
     * Default: 1
     */
    alpha?: number;

    /**
     * Stroke position.
     * v1 supports only "inner".
     */
    position?: "inner";

    /**
     * Which mechanism rasterizes the stroke ring (mirrors
     * `RoundingOptions.rasterizer`):
     *
     *   - "geq": procedural per-pixel ring rendered by a frozen-frame `geq`
     *     node (hard-binary edges; the byte-exact legacy path).
     *   - "svg": the ring is baked once to a colored RGBA PNG sidecar and
     *     composited by the same overlay — no `geq` node in the graph
     *     (smaller graphs / faster init for dense stroked composites;
     *     anti-aliased edges).
     *
     * Visually identical. Default resolved by the engine
     * (`DEFAULT_STROKE_RASTERIZER`).
     */
    rasterizer?: "geq" | "svg";
  };

  /**
   * Drop shadow behind the visual source.
   * Requires alpha-aware blur + offset + composite.
   * Applied after rounding and stroke.
   */
  dropShadow?: {
    dx?: number; // offset X in px
    dy?: number; // offset Y in px
    blur?: number; // blur radius in px
    color?: string; // shadow color
  };

  /**
   * Content rotation in degrees (clockwise; negative = counter-clockwise).
   *
   * In-place: the tile canvas keeps its exact w×h — the content rotates
   * inside it, uncovered corners fill transparent, and content corners that
   * leave the canvas clip. The tile never bleeds past its cell.
   *
   * Content effect (content-then-shape): applied after `camera`, before
   * `rounding`/`stroke`/`mask` — the tile's silhouette stays axis-aligned
   * while the content rotates inside it.
   */
  rotate?: number;

  /**
   * Camera crop — zoomed, optionally-panning sub-window of the source. A
   * steerable, per-frame-animatable zoom + pan that follows a focus point.
   * This is the WIRED camera primitive (see {@link MosaicCamera}) — the one
   * zoom/pan surface on a tile.
   */
  camera?: MosaicCamera;

  /**
   * Color grade / adjust — the ONE color surface for tiles.
   *
   * Four scalar adjustments (ffmpeg `eq` for video; a host-raster bake is a
   * future perf path for stills). Absent field = that adjustment off; a
   * grade whose every field is at its default is a no-op and emits nothing.
   *
   * Content effect (content-then-shape): applied after `camera`/`rotate`,
   * before `rounding`/`stroke`/`mask` — it grades the content, never the
   * stroke ring or anything outside the silhouette.
   *
   * A LUT slot (`.cube` / Hald-CLUT sidecar asset) is the planned extension
   * of this same bag — one grade surface, no per-filter color-knob zoo.
   */
  grade?: {
    /** -1..1, default 0 (0 = unchanged) */
    brightness?: number;
    /** 0..2, default 1 (1 = unchanged) */
    contrast?: number;
    /** 0..3, default 1 (1 = unchanged; 0 = grayscale) */
    saturation?: number;
    /** 0.1..10, default 1 (1 = unchanged) */
    gamma?: number;
  };

  /**
   * Gaussian blur — two distinct mechanisms on one knob:
   *
   * - **Bare number** (or object without `backdrop`): blurs the tile's OWN
   *   content (`gblur` sigma, px; 0 = off). Content effect
   *   (content-then-shape): applied after `camera`/`rotate`, before
   *   `rounding`/`stroke`/`mask` — never bleeds past the silhouette.
   * - **`{ sigma, backdrop: true }`**: glassmorphism — frosts what is
   *   BEHIND the tile (crop the composited base at the tile's cell →
   *   ¼-downscale → gblur → upscale → maskedmerge back under the tile).
   *   The frost is clipped to the tile's own alpha silhouette (rounded
   *   corners, masks, keying all clip it automatically), center-padded to
   *   the cell — so it assumes centered/cover placement; a non-center
   *   contain alignment mis-registers the clip. The frosted patch anchors
   *   to the CELL rect (an overlay-expr-animated tile slides over a static
   *   frost). Region composite at the overlay layer, NOT a step in the
   *   content chain.
   */
  blur?:
    | number
    | {
        /** Gaussian sigma (px). Required in object form. */
        sigma: number;
        /** true = frost the base behind the tile instead of the tile content. */
        backdrop?: boolean;
      };

  /**
   * Film-grain / noise stylize (`noise` filter, temporal).
   *
   * `seed` is REQUIRED — determinism is non-negotiable; identical seeds
   * produce identical grain. `amount` is the strength (0..100; 0 = off).
   *
   * Content effect (content-then-shape): applied after `blur`, before
   * `pixelize`/`chromaKey` and the shape steps.
   */
  noise?: {
    /** Grain strength, 0..100 (0 = off). Required. */
    amount: number;
    /** PRNG seed — REQUIRED; same seed = same grain every render. */
    seed: number;
  };

  /**
   * Censor / mosaic-reveal pixelation (`pixelize` filter).
   * Block size in px; 0 or absent = off.
   *
   * Content effect (content-then-shape): applied after `noise`, before
   * `chromaKey` and the shape steps.
   */
  pixelize?: number;

  /**
   * Green-screen keying (`chromakey`, optionally paired with `despill`).
   *
   * Turns pixels near `color` transparent, revealing whatever is behind the
   * tile. Meaningful on video-like content — the validator REJECTS it on
   * `mediaType: "image"` / `"audio"` media sources (lavfi / video / nested
   * mosaic are fine).
   *
   * `despill` (default true) removes key-color contamination from the kept
   * foreground; it auto-selects the green or blue despill pass from the
   * dominant channel of `color`, and is skipped for keys that are neither
   * green- nor blue-dominant.
   *
   * Last content effect (content-then-shape): applied after `pixelize`,
   * before `rounding`/`stroke`/`mask` — the keyed silhouette still gets
   * rounded corners / stroke like any other content.
   */
  chromaKey?: {
    /** Key color to turn transparent (e.g. "#00ff00"). Required. */
    color: MosaicColor;
    /** Match tolerance, 0..1. Default 0.1. */
    similarity?: number;
    /** Edge softness, 0..1 (0 = hard binary key). Default 0. */
    blend?: number;
    /** Run the paired despill pass. Default true. */
    despill?: boolean;
  };

  /** Gentle zoom over the clip/band lifetime (e.g. 0.03 = +3%). time-based scale */
  zoomInPercent?: number;

  /**
   * Entrance / exit alpha ramps (milliseconds; 0 = off).
   *
   * Operates on the tile's ALPHA plane (the base behind the tile shows
   * through during the ramp — content is never faded to black). Applied to
   * the FINISHED tile, after `rounding`/`stroke`/`mask`, so the whole
   * silhouette fades as one. Fade-in ramps from t=0; fade-out ends at the
   * clip's end (a fade-out longer than the clip clamps to start at t=0).
   */
  fadeInMs?: number;
  fadeOutMs?: number;
};

export type MosaicAudioProps = {
  /**
   * Enables or disables audio playback for this source.
   * Default: true
   *
   * When false, the audio stream is completely muted/removed.
   */
  enabled?: boolean;
  /**
   * Linear volume multiplier applied to the source’s audio.
   *   1   = original volume
   *   0.5 = half volume
   *   2   = double volume
   *
   * Applied after trimming/speed changes and before the final mix.
   */
  volume?: number;
};

export type MosaicVisualProps = {
  /**
   * Sources render to transparent by default
   * Background color for this source's tile region when you want an explicit base fill behind this source render.
   * Used when the source does not fully cover its tile
   * (e.g., `fit: "contain"` letterboxing, transparent media, or padding).
   *
   * Accepts hex or any FFmpeg-compatible color string.
   * Default: none / transparent (engine does not create a base unless specified)
   */
  backgroundColor?: MosaicColor;

  /**
   * Constant opacity multiplier (0–1).
   * Applied to the *entire* rendered source, including text, media,
   * borders, and effects.
   *
   * 1 = fully opaque
   * 0 = fully transparent
   */
  opacity?: number;

  // Time-varying opacity (ffmpeg expression, 0..1).
  // Multiplies with overlay.alpha and opacity.
  // Evaluated per-frame (t-aware).
  opacityExpr?: string;  // ffmpeg expr 0..1 over time
};

/**
 * A nested mosaic used as the content for a tile.
 *
 * This source represents the rendered output of another MosaicDocument.
 * Templates may produce nested mosaics by placing entries in their
 * `children` map; each child is rendered first (post-order), then
 * inserted into the parent as a `mosaic` source.
 *
 * The `ref` field must match a key in the parent MosaicDocument's `children`
 * map. The renderer resolves this reference by first rendering the child
 * MosaicDocument into a media buffer, then placing that buffer into the tile
 * defined in the parent's m0saic DSL.
 *
 * Mosaic sources allow arbitrary recursive composition: templates may
 * contain other templates, forming a mosaic tree that the renderer
 * collapses bottom-up.
 */
export type MosaicMosaicSource = {
  type: "mosaic";
  ref: string;

  placement?: MosaicPlacementProps;
  playback?: MosaicPlaybackProps;
  effects?: MosaicEffectProps;
  mask?: MosaicSourceMask;
  visual?: MosaicVisualProps;
  audio?: MosaicAudioProps;
  overlay?: MosaicOverlayExpr;

  /** Editor-only metadata. Ignored by engine/rendering. */
  editor?: MosaicSourceEditorMeta;

  /** Engine-only metadata */
  engine?: MosaicEngineMeta;
};

export type MosaicMediaKind = "video" | "audio" | "image";

/**
 * A direct media source (image, video, or audio) used as tile content.
 *
 * This source corresponds to a media asset registered in the document's
 * asset manifest. It is rendered directly by ffmpeg and does not involve
 * nested mosaics.
 *
 * `mediaType` determines how the renderer treats the source:
 *   - "image" → treated as an infinite-duration still frame
 *   - "video" → played with optional trimming, speed, and audio
 *   - "audio" → included in the audio mix, no visual component
 *
 * `assetId` is an opaque reference into the parent {@link MosaicDocument}'s
 * `assets` map. The asset manifest owns the concrete representation
 * (filesystem path, URL, etc.); callers must go through `resolveAsset`
 * (in `@m0saic/core`) rather than peek inside the manifest entry directly.
 */
export type MosaicMediaSource = {
  type: "media";
  mediaType: MosaicMediaKind;
  assetId: AssetId; // required — references doc.assets[assetId]
  placement?: MosaicPlacementProps; // ignored when audio
  playback?: MosaicPlaybackProps;
  effects?: MosaicEffectProps; // ignored when audio
  mask?: MosaicSourceMask; // ignored when audio
  visual?: MosaicVisualProps; // ignored when audio
  audio?: MosaicAudioProps;
  overlay?: MosaicOverlayExpr;

  /** Editor-only metadata. Ignored by engine/rendering. */
  editor?: MosaicSourceEditorMeta;

  /** Engine-only metadata */
  engine?: MosaicEngineMeta;
};

export type MosaicTextEval = "once" | "frame";

export type MosaicTextContent =
  | { kind: "literal"; text: string }
  | { kind: "expr"; expr: string; eval?: MosaicTextEval };

export type MosaicTextRenderMode =
  | { kind: "image" } // single-frame RGBA image
  | { kind: "video" }; // RGBA video, default = ctx.target.durationMs

export type MosaicTextLayer = {
  content: MosaicTextContent;

  style?: MosaicTextStyleProps;
  placement?: MosaicTextPlacementProps;
  effects?: MosaicEffectProps;
  visual?: MosaicVisualProps;
  overlay?: MosaicOverlayExpr;
};

/**
 * A text label rendered into the tile as visual content.
 *
 * Text sources allow templates to generate captions, titles, timestamps,
 * lower-thirds, labels, or dynamic overlays entirely through the mosaic
 * system. The renderer converts this text into an image or video buffer
 * before inserting it into the tile.
 *
 * `style` controls the visual appearance of the text (font size, color,
 * opacity, etc.) while `loopMode` controls playback behavior when the
 * text is animated or time-varying. Most text automatically takes on the
 * duration of its parent tile unless `loopMode` specifies otherwise.
 */
export type MosaicTextSource = {
  type: "text";

  /** Required: one or more layers */
  layers: MosaicTextLayer[];

  /** Determines whether this source is still or time-varying */
  renderMode?: MosaicTextRenderMode;

  /**
   * Glyph rasterizer (which mechanism turns the text into pixels).
   *
   *   "drawtext" (default) — spawn ffmpeg `drawtext` into a separate media
   *      file, then composite that file. Supports per-frame `expr` text and
   *      drawtext-specific styling (box, border).
   *   "svg" — convert the text to SVG glyph OUTLINES and show a flat color
   *      tile through them via an `inline-mask` (no intermediate media file,
   *      no drawtext spawn; bundled deterministic font). v1 is single-color:
   *      `expr` text with per-frame eval and drawtext-only styling
   *      (box/border) are not supported and fall back to drawtext.
   *
   * Absent = "drawtext" (no behavior change for existing documents).
   */
  rasterizer?: "drawtext" | "svg";

  /** Base props applied then overridden by each layer */
  style?: MosaicTextStyleProps;
  placement?: MosaicTextPlacementProps;
  playback?: MosaicPlaybackProps;
  effects?: MosaicEffectProps;
  mask?: MosaicSourceMask;
  visual?: MosaicVisualProps;
  overlay?: MosaicOverlayExpr;
  /** Engine-only metadata */
  engine?: MosaicEngineMeta;
  /** Editor-only metadata. Ignored by engine/rendering. */
  editor?: MosaicSourceEditorMeta;
};

/**
 * Base type for lavfi sources containing common properties.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * ⚠️ PROD SEMANTICS: LAVFI IS TILE-RELATIVE BY DEFAULT
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * A MosaicLavfiSource is *not* a normal media file. It is a procedural generator.
 * In production we treat it as a **tile primitive** unless the author explicitly
 * opts out.
 *
 * Why:
 * - Templates should NOT need to embed width/height/fps/duration inside lavfi
 *   strings ("...:s=1920x1080:r=30:d=1.0"). Those values already exist in the
 *   render context (tile rect + fps + duration).
 * - Allowing arbitrary "s=...,r=...,d=..." in user strings creates non-deterministic
 *   and surprising behavior when layouts change (resizes, nesting, chunking).
 * - The engine must own the boring-but-critical wiring: exact sizing, fps, duration,
 *   and RGBA/alpha correctness.
 *
 * Design rule:
 * - Default behavior MUST produce a buffer that is exactly TW×TH at the node fps,
 *   with deterministic duration, and with an alpha channel.
 *
 * Escape hatch:
 * - Some advanced filter graphs want a "native" generation size/aspect, then use
 *   placement (contain/cover) like a normal media source. That's what fitMode="content"
 *   is for.
 *
 * The "tile" default is a **deliberate constraint**, not a convenience.
 * It keeps z-order and composition intuitive:
 *   lavfi (base fill) -> text (transparent bg) -> nested mosaics -> overlays
 */
export type MosaicLavfiBase = {
  type: "lavfi";

  /**
   * Controls how the lavfi source fills its tile.
   *
   * - "tile" (default): the engine forces the lavfi output to EXACT tile dimensions.
   *   No aspect preservation. No letterboxing. This is the correct default for
   *   backgrounds, bar fills, wipes, masks, and procedural layers intended to be
   *   tile primitives.
   *
   * - "content": the engine does NOT force a tile-sized output. The generator may
   *   have its own intrinsic size, and then `placement.fit` ("contain"/"cover")
   *   is applied like normal media.
   *
   * ⚠️ Important: Most templates should NEVER need "content".
   * Use it only when the generator's internal aspect/size is meaningful.
   */
  fitMode?: "tile" | "content";

  /**
   * Optional generator size override.
   *
   * Defaults:
   * - In fitMode="tile": the engine should treat the generator as TW×TH (tile rect).
   * - In fitMode="content": size may be used as the generator's intrinsic dimensions
   *   before placement math.
   *
   * ⚠️ Warning:
   * - This is an ADVANCED escape hatch. Widespread use in templates is a smell.
   * - Templates should not be shipping hard-coded "1920x1080" here.
   *   If you see that, the template is fighting the engine.
   *
   * Expressions use tile-local macros:
   *   TW = tile width, TH = tile height
   */
  size?: {
    wExpr?: string;
    hExpr?: string;
  };

  overlay?: MosaicOverlayExpr;

  placement?: MosaicPlacementProps;
  playback?: MosaicLavfiPlaybackProps;
  effects?: MosaicEffectProps;
  mask?: MosaicSourceMask;
  visual?: MosaicVisualProps;

  editor?: MosaicSourceEditorMeta;
  engine?: MosaicEngineMeta;
};
/**
 * A procedural video source backed by FFmpeg's libavfilter ("lavfi").
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * ⚠️ PROD CONTRACT: ENGINE OWNS fps/duration/rgba + (usually) size
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * - Do NOT require templates to include:
 *     - frame rate (r=)
 *     - duration (d=)
 *     - tile sizing (s=)
 *     - alpha format (format=rgba)
 *
 * The engine will inject/normalize these to guarantee:
 * - deterministic timing across nested mosaics + chunking
 * - correct alpha compositing
 * - stable behavior when tile rect changes
 *
 * Allowed author inputs:
 * - Either:
 *    (A) `color` convenience for common base fills
 *    (B) `lavfi` filter graph snippet for custom generation
 *
 * Type-level mutual exclusivity is intentional to keep templates readable and to
 * prevent "half color half graph" ambiguity.
 */
export type MosaicLavfiSource =
  | (MosaicLavfiBase & {
      lavfi: string;
      color?: never;
    })
  | (MosaicLavfiBase & {
      color: MosaicColor;
      lavfi?: never;
    });

/**
 * Lavfi-specific playback props.
 *
 * Note: Lavfi does not support clipStartMs (there is no underlying file timeline).
 * clipDurationMs MAY be used as a time window, but the engine still owns final
 * duration semantics and must keep output durations deterministic across nesting.
 *
 * `playSpeed` is accepted here but NOT yet wired for lavfi — the engine warns
 * (`PLAY_SPEED_NOT_WIRED_FOR_SOURCE`) and generates at 1×. Wiring lavfi time
 * progression is a filed follow-up.
 */
export type MosaicLavfiPlaybackProps = Pick<
  MosaicPlaybackProps,
  "playSpeed" | "loopMode" | "clipDurationMs"
>;

export type MosaicOverlayBlendMode =
  | "normal"    // current behavior: alpha-over
  | "add"       // light emission / glow
  | "screen"    // photographic lightening (best for glow)
  | "multiply"; // shadow / darkening


/**
 * The source's active visibility window on the OUTPUT timeline, in absolute
 * seconds of global `t` (NOT `startAtSec`-relative). Omitted bound = open on
 * that side.
 *
 * This is the structured twin of the `enable` string: when both are present
 * they must describe the same window — the engine prefers this field and
 * falls back to statically parsing `enable` (`parseEnableWindow` in
 * `@m0saic/platform` ffexpr). The engine uses it to give the source a
 * *lifetime*: heavy per-pixel work (the geq alpha fold) is gated to the
 * window and the upstream chain is trimmed to it, so off-window frames cost
 * nothing. A window alone (no `enable`) also gates the composite.
 */
export type MosaicOverlayWindow = {
  /** Window opens (seconds on the output timeline). Omitted = from 0. */
  startSec?: number;
  /** Window closes (seconds on the output timeline). Omitted = to stream end. */
  endSec?: number;
};

export type MosaicOverlayExpr = {
  // tile-local offset expressions
  // available symbols: t, lt, W, H
  // These are offsets, not absolute positions
  xExpr?: string; // e.g. "0" or "(W-w)/2"
  yExpr?: string; // e.g. "H-(t/3)*H*0.8"

  /** enable expression for the overlay operation */
  enable?: string; // e.g. "between(t,0,3)"

  /** Structured active window; see {@link MosaicOverlayWindow}. */
  window?: MosaicOverlayWindow;

  alpha?: string; // 0..1 expression over time

  // How this overlay is composited onto the base layer.
  // Defaults to "normal" to preserve existing behavior.
  blendMode?: MosaicOverlayBlendMode;

  /**
   * local animation start
   * if overlay.startAtSec is present, 'lt' (local time) is available for expressions
   * lt assumes startAtSec is 0 when not provided. ie. enable=(0,t) passed to ffmpeg
   */
  startAtSec?: number;
};

/**
 * A single tile's content.
 *
 * Each tile references one `MosaicSource` as its primary content, and the engine
 * composites all rendered sources for the tile in `paintOrder` to determine
 * z-order (back-to-front).
 *
 * Source kinds:
 *
 *   1. `media`  — A file-based source: image, video, or audio.
 *                Images/video render to a visual buffer; audio participates only
 *                in the audio mix.
 *
 *   2. `text`   — A text label rendered into a visual buffer.
 *                Used for captions, titles, labels, etc.
 *
 *   3. `mosaic` — The rendered output of a nested MosaicDocument referenced by `ref`.
 *                Child mosaics are rendered first (post-order) and then inserted
 *                into the parent as a normal visual layer.
 *
 *   4. `lavfi`  — A procedural video source backed by FFmpeg's libavfilter ("lavfi").
 *                In v1 this is a solid-color generator (no input file required),
 *                useful for backgrounds, bars, wipes, and other animated overlays.
 *
 *   5. `ref`    — An intra-job back-edge mirror — see {@link MosaicRefSource}.
 *
 *   6. `data`   — A "variables-only" cell — see {@link MosaicDataSource}.
 *                Carries a structured-data payload for back-edge consumers;
 *                the engine renders a minimal carrier (1s × 16×16 black by
 *                default) so the cell exists uniformly in the render plan.
 *
 *   7. `template_invocation` — An UNRESOLVED template call — see
 *                {@link MosaicTemplateInvocationSource}. Lives only in
 *                `.mosaicx` (MosaicXDocument) source files; the resolver
 *                erases these into normal `mosaic` sources before the
 *                engine ever sees the doc. Engine code paths must treat
 *                this kind as a programmer error.
 *
 * Rendering model:
 * - Visual sources render to transparent buffers by default.
 * - The engine composites those buffers in `paintOrder`.
 * - The final output is flattened onto the root/background at the end.
 */
export type MosaicSource =
  | MosaicMosaicSource
  | MosaicMediaSource
  | MosaicTextSource
  | MosaicLavfiSource
  | MosaicRefSource
  | MosaicDataSource
  | MosaicTemplateInvocationSource;

/**
 * Intra-job back-edge mirror.
 *
 * Points at another cell in the **same render job** that was **already
 * evaluated** in graph-construction order. The engine renders the target
 * cell once and mirrors its rendered output into every cell that
 * references it.
 *
 * # Core invariant: back-edge only ("look backwards")
 *
 * A ref can only point at a node that came **before** it in the graph's
 * evaluation order — never at a sibling, cousin, or pipeline step that
 * hasn't been processed yet. Phrased as the user puts it:
 *
 * > "Find my source from someone that came before me."
 *
 * Consequences:
 *
 * - **Cycles are structurally impossible.** A node can never reference
 *   itself or any descendant — the descendant doesn't exist at the
 *   moment the ref is authored.
 * - **Authoring direction matches reading direction.** Templates build
 *   from the top down (root layout → inner cells → leaves); refs
 *   point upstream in that traversal.
 * - **Forward references are an error.** The engine emits
 *   `MOSAIC_REF_FORWARD_REFERENCE` when a ref points at a node that
 *   hasn't been evaluated yet (e.g., a later sibling, a later
 *   pipeline step, or a deeper child).
 *
 * For pipelines specifically, evaluation order is the step order:
 * step 2 may reference step 1; step 1 may not reference step 2.
 *
 * # Why back-edge only (and not bidirectional)
 *
 * This is a deliberate design choice — the alternative (allowing
 * forward refs and resolving them in a second pass) was considered
 * and rejected. The reasoning:
 *
 * - **Matches the DSL's own resolution model.** The m0 DSL string is
 *   parsed left-to-right in one pass; cells render in the order they
 *   appear. Refs continue that pattern. Every ref is resolvable the
 *   moment it's encountered, with no backtracking, no two-pass plan
 *   build, no forward-decl ambiguity.
 * - **First-encountered wins.** Whichever cell encounters the source
 *   first defines its render context (canvas, fps, format). Later
 *   cells that ref it inherit that already-rendered output. This
 *   makes the "who drives the initial render?" question trivial to
 *   answer: it's always the first cell in DSL / pipeline order.
 * - **Simpler engine, simpler debugger.** One traversal, no graph
 *   coloring, no "what if both ends ref each other in different
 *   orders" edge cases. The whole machinery stays linear.
 *
 * # Working around the "I want a later cell to drive the source"
 * # case
 *
 * Sometimes the cell that *initiates* a source isn't where you'd
 * naturally place it — you might want a later, larger, or more
 * specifically-sized cell to be the canonical render. Two patterns
 * handle this without forward refs:
 *
 * 1. **Editor reordering.** When a user wires cell A → cell B where
 *    B comes first in DSL order, the editor flips the wiring: B
 *    becomes the source-of-truth carrying the actual source, and A
 *    becomes the ref. UI-level concern; the on-disk doc always has
 *    the back-edge invariant satisfied.
 * 2. **Pipeline first-step shim.** If a specific canvas or render
 *    context must drive the source, make that render its own
 *    pipeline step zero. Subsequent steps then ref it backwards, and
 *    you've expressed "this is the canonical render, everything else
 *    mirrors it" without needing forward refs.
 *
 * The trade is one extra pipeline step (or one editor-side swap) in
 * the rare case where author intent runs counter to DSL order, in
 * exchange for keeping every ref single-pass-resolvable across the
 * whole render plan. We took the trade.
 *
 * # Ref chains are fine
 *
 * A ref may point at another cell that is *itself* a `MosaicRefSource`
 * — the engine resolves the chain transitively until it hits a
 * renderable (non-ref) source. The chain is **guaranteed to terminate**:
 * every hop walks strictly earlier in evaluation order, and there is a
 * finite floor (the first node, which has nothing before it and
 * therefore cannot itself be a ref). So chains can be arbitrarily long
 * but always bottom out.
 *
 * # Scope is firm: this render job, not other files
 *
 * `MosaicRefSource` does **not** reach across `.mosaic` files. A
 * `.mosaic` artifact is a self-contained intermediate description of a
 * single video — its job is to be parsed by the m0saic engine and
 * reduced to actual frames. Cross-file mirroring would defeat that
 * self-contained intent. If you want to reuse content from another
 * `.mosaic`, render it to a video file and use that as a regular
 * `MosaicMediaSource`.
 *
 * Distinct from {@link MosaicMosaicSource}, which **inlines** a nested
 * document (re-rendering it each place it appears). `MosaicRefSource`
 * is **deduplication**: render once, mirror many times.
 *
 * # Use case
 *
 * Multi-pane layouts where the same rendered tile appears in several
 * cells as an exact mirror — picture-in-picture, mirrored corner
 * reflections, repeated decals, or showing the same source clip in
 * multiple framings within one composition. Also: dashboard templates
 * that repeat an earlier-rendered cell (e.g., a header strip) into
 * later pipeline steps.
 *
 * # Mismatch resolution
 *
 * Refs reuse the same source-decoration props as every other
 * `MosaicSource`. There are five cases — all five reuse the target
 * source's already-rendered precursor (no re-render, no re-encode);
 * `placement` / `playback` props on the ref handle the deltas:
 *
 * | # | Locality | Size | Duration | Mechanism |
 * |---|---|---|---|---|
 * | 1  | Same doc       | match  | match (implicit) | Precursor reuse; ref's `placement` applies. |
 * | 2  | Same doc       | differ | match (implicit) | Precursor reuse + `placement.fit` + offset. |
 * | 3a | Cross-step     | match  | match  | Precursor reuse; `stepIndex` disambiguates earlier step. |
 * | 3b | Cross-step     | differ | match  | Precursor reuse + `placement.fit`; target lives in earlier step. |
 * | 3c | Cross-step     | (either) | differ | `playback.loopMode` + `playback.clipStartMs` / `clipDurationMs`; composes with 3a/3b spatial behavior. |
 *
 * **Per-cell decoration is independent of the target.** Ref's own
 * `placement` / `playback` / `effects` / `mask` / `visual` / `audio`
 * / `overlay` apply to the *mirror copy* in the parent filtergraph,
 * not to the target's canonical render. The target renders once with
 * its own decoration; each ref runs the mirrored pixel stream
 * through its own decoration chain. Canonical example: N refs over
 * one target, each with a different `overlay.enable` expression,
 * produce N differently-animated outputs from a single decode /
 * rasterization / nested render.
 *
 * Per-prop detail:
 *
 * - **Duration mismatch** — `playback.loopMode`:
 *   - `"loop"`     repeat the target's output for the full referencing duration.
 *   - `"freeze"`   hold the target's final frame after it ends.
 *   - `"cut"`      play once, then transparent for the remainder.
 *   When the referencing cell is *shorter* than the target, playback
 *   is naturally truncated; `playback.clipStartMs` / `clipDurationMs`
 *   pick the window.
 * - **Size / aspect mismatch** — `placement.fit` (`"contain"` /
 *   `"cover"`) and `placement.inset` / `padding` / alignment.
 * - **Cross-pipeline-step format negotiation** (pixel format, fps,
 *   alpha) — engine-internal. The ref consumer's own filter chain
 *   inserts `scale=` / `fps=` / `setpts=` / `format=` as needed to
 *   bridge a target's matrix to its own slot's matrix.
 *
 * # Selection
 *
 * Identifiers refer to the **flattened** DSL — not any per-template
 * pre-flatten DSL.
 *
 * Each `MosaicDocument` reduces, at plan-build time, to **one global
 * m0 string** via `flattenMosaicDocument` (see
 * `@m0saic/platform/mosaic/flatten`). Nested children are spliced into
 * the parent's DSL with namespaced asset prefixes (`c0_`, `c1_`, …) and
 * the children's own stableKeys get rewritten into the parent's
 * keyspace. The flattened form is what the engine actually renders —
 * the render hero, ffmpeg invocations, and every downstream consumer
 * operate on this single global DSL.
 *
 * So:
 *
 * - {@link flattenedStableKey} (required) — a DSL stableKey resolved
 *   against **the post-flatten root DSL** of the containing document
 *   (or pipeline step). Within one flattened root, stableKey identity
 *   is unique. When a template author wants to mirror a cell that
 *   lives inside a nested child, they must use the **namespaced** key
 *   that flattening produces — not the child template's local key.
 *   Helpers in `@m0saic/template-utils` resolve local → flattened keys.
 *   The field is named `flattenedStableKey` (not just `stableKey`) to
 *   keep this distinction visible at every call site.
 * - {@link stepIndex} (optional, pipelines only) — which earlier
 *   pipeline step contains the target cell. 0-based; must be strictly
 *   less than the current step's index. Each step has its own
 *   flattened root DSL, so a single key can legally appear in
 *   multiple steps — `stepIndex` disambiguates. Ignored when the
 *   render job is a non-pipeline document.
 *
 * Authoring tip: if you're not sure what value to use, dump the
 * flattened DSL (`flattenMosaicDocument(doc).m0`) and pick the key
 * from there. The flatten step is deterministic, so the key is stable
 * across renders.
 *
 * # Engine support (v1, shipped)
 *
 * - Target source kinds: `media`, `text`, `mosaic`, `lavfi`.
 * - Locality: same-document AND cross-step (`stepIndex`).
 * - Depth: top-level cells AND nested-mosaic inner cells (at any
 *   depth, along either axis — horizontal `gcolc` or vertical
 *   `growc` splits).
 * - Overlay-frame targets (`r/.../ovNcN`) are supported.
 * - Matrix normalization (size / fps / duration / pixfmt) is handled
 *   inline by the ref consumer's own filter chain — the ref's own
 *   `placement` / `playback` / `effects` / `mask` then apply on top.
 *
 * # Engine support — known gaps
 *
 * - **Cross-step lavfi refs**: not supported in v1. A ref whose target
 *   is a `lavfi` source in an *earlier pipeline step* falls back to a
 *   black placeholder and emits `MOSAIC_REF_TARGET_NOT_SUPPORTED`.
 *   Same-doc lavfi refs (the common case — mirroring a generated
 *   pattern or `movie=` tile within one document) are fully supported.
 *   Promote out of deferred if a use case appears; the fix is a small
 *   addition to the cross-step intermediate registry.
 * - **Inner-cell lavfi refs**: same as above. Same-doc top-level lavfi
 *   only.
 * - **Ref-of-ref**: rejected with `MOSAIC_REF_TARGET_NOT_SUPPORTED`.
 *   The editor flattens chains by re-pointing at the ultimate
 *   producer; the engine never expects to see one ref targeting
 *   another.
 *
 * # Determinism
 *
 * Same render job + same `flattenedStableKey` (+ same `stepIndex` for
 * pipelines) → byte-identical mirrored output. Determinism follows
 * for free from the back-edge invariant — there is no resolution
 * ambiguity once the target node exists.
 */
export type MosaicRefSource = {
  type: "ref";

  /**
   * StableKey of the target cell, resolved against the
   * **post-flatten root DSL** of the current render job.
   *
   * Each `MosaicDocument` reduces to one global m0 string at flatten
   * time; nested children are spliced in with namespaced keys. This
   * field selects a cell in *that* flattened keyspace — not in any
   * pre-flatten child template's local DSL. For pipelines, use
   * {@link stepIndex} to pick which step's flattened root contains
   * the target.
   *
   * The field name uses `flattenedStableKey` (not `stableKey`) on
   * purpose — to keep the post-flatten keyspace visible at every call
   * site. Templates frequently work with pre-flatten local stableKeys
   * via the DSL builders; this field is the bridge between those
   * local namespaces and the merged form the engine renders.
   *
   * See class JSDoc for authoring tips on resolving local → flattened
   * stableKeys.
   *
   * # Targets must produce pixels
   *
   * `MosaicRefSource` mirrors **rendered output**, so the target
   * cell must contribute real pixels. Pointing a ref at a
   * {@link MosaicDataSource} is **structurally impossible**: data
   * sources are filtered out of the planner's source iteration before
   * frames / cells are assigned (`buildMosaicNode.ts`), so a ref whose
   * `flattenedStableKey` would have pointed at a data source's slot
   * simply doesn't resolve — it surfaces as `MOSAIC_REF_NOT_FOUND`
   * rather than the historical `MOSAIC_DATA_SOURCE_VISIBLE_USE`
   * (the latter code is still registered in `@m0saic/types` for ABI
   * stability but no longer emitted from any code path). Aliases on
   * data sources are exclusively for the data read channel
   * (`ctx.upstreamData[alias]`) — not for visual mirrors.
   *
   * # Cross-step authorship — getting the key across the boundary
   *
   * Inside a single MosaicDocument, the template author knows every
   * cell's stableKey (it builds the m0 geometry directly) and can
   * write `flattenedStableKey` literally.
   *
   * Across pipeline steps, the *consumer* template can't know the
   * *producer* template's stableKeys at author time. The canonical
   * handoff is via {@link MosaicDocument.variables}, with the
   * producer self-stamping both the `stepIndex` and the key so the
   * consumer doesn't depend on an out-of-band assembly contract:
   *
   *   // Step 0 — real render, publishes a self-describing handoff:
   *   return {
   *     kind: "mosaic_document",
   *     // ...m0, assets, sources (with stableKey "intro_hero")...
   *     variables: {
   *       introHero: {
   *         stepIndex: ctx.pipelineStep!.index,
   *         flattenedStableKey: "intro_hero",
   *       },
   *     },
   *   };
   *
   *   // Step 1 — reads and spreads, no assembly contract required:
   *   sources: [{
   *     type: "ref",
   *     ...ctx.upstreamVariables!.introHero,
   *   }]
   *
   * The producer template owns the geometry so the key is correct
   * by construction; the engine surfaces the step index via
   * {@link MosaicEngineContext.pipelineStep} so the producer can
   * self-stamp it.
   *
   * Two equivalent channels for publishing the handle:
   *
   * 1. **Doc-level `variables`** (shown above) — flat, simple, no
   *    alias namespace. Last-write-wins on collision. Right for
   *    single-producer flows or where collision risk is low.
   *
   * 2. **`MosaicDataSource` with `alias`** — namespace-safe; the
   *    handle appears under `ctx.upstreamData[alias]` instead of in
   *    `ctx.upstreamVariables`. Right when multiple producers in
   *    the same pipeline might publish under conflicting keys, or
   *    for plugin composability across packs. A data source
   *    occupies a cell that renders the degenerate carrier (1s ×
   *    16×16 black) — analogous to an audio-only media source
   *    occupying a cell with an empty visual buffer.
   *
   * Pick the channel based on collision risk. Both compose with the
   * spread-into-ref consumer pattern.
   *
   * # Namespacing for child-doc keys
   *
   * The flattener prefixes nested children's keys (`c0_`, `c1_`, …).
   * When publishing a key for a cell inside a `children` entry, the
   * producer must publish the prefixed form. A `template-utils`
   * helper for computing the prefix is on the engine-wiring
   * follow-up; for v1 the contract is "publish whatever
   * `flattenedStableKey` the consumer should pass into a ref."
   *
   * Branded as {@link FlattenedStableKey} — values must match
   * {@link FLATTENED_STABLE_KEY_PATTERN}. Construct via the
   * platform-layer helpers or {@link asFlattenedStableKey} at JSON
   * parse boundaries.
   */
  flattenedStableKey: FlattenedStableKey;

  /**
   * Pipeline-only: which earlier step contains the target cell.
   *
   * 0-based index into `MosaicDocumentPipeline.steps[]`. **Must be
   * strictly less than the current step's index** — refs are
   * back-edges only; forward references emit
   * `MOSAIC_REF_FORWARD_REFERENCE`.
   *
   * When omitted in a pipeline context, the engine resolves against
   * the current step first (intra-step mirror), then walks backwards.
   * Ignored when the render job is a non-pipeline document.
   *
   * Cross-step mirrors with mismatched step durations are resolved
   * via {@link playback}.`loopMode` (`"loop"` / `"freeze"` / `"cut"`)
   * and `playback.clipStartMs` / `clipDurationMs`. Cross-step
   * pixel-format / fps / alpha negotiation is engine-internal —
   * the rule map is deferred to a focused follow-up PR.
   */
  stepIndex?: number;

  /**
   * Standard source decoration applied to the mirrored output.
   *
   * The target cell renders once with its own placement/effects in
   * its native location. The decoration here applies to the **mirror
   * copy** at this cell — e.g., the corner reflection at a different
   * scale, with a different rounding, or rotated. The mirrored pixels
   * are the same.
   */
  placement?: MosaicPlacementProps;
  playback?: MosaicPlaybackProps;
  effects?: MosaicEffectProps;
  mask?: MosaicSourceMask;
  visual?: MosaicVisualProps;
  /**
   * Per-mirror audio (volume / enabled), applied to the mirrored copy.
   *
   * **Needs-wiring (F3 audit 2026-07-06; targeted at the pipeline phase).**
   * The defensible case is a **cross-step** ref: a ref can mirror a target
   * cell from an EARLIER pipeline step, so the mirror plays at a DIFFERENT
   * position in the concatenated timeline than its source. There you legit-
   * imately want BOTH occurrences audible — the source's audio at step N and
   * the mirror's audio at step M — each at its own time, each with its own
   * `volume`. (A same-step / same-time mirror is the degenerate case: the
   * target's audio already mixes once at that position, so a second copy
   * would just double it.)
   *
   * The prop already flows onto the resolved mirror media source
   * (`buildMosaicNode` ref decorations), and the media tap `.mov` even
   * carries an `[outa]`. Two things block wiring, both surfaced during F3:
   *   1. **Gate stamp.** The ref's minted `node-output` asset is created
   *      WITHOUT `hasAudio:true`, so the parent audio gate drops it. That
   *      part is a one-liner (stamp it, cross-step only, so same-time
   *      mirrors don't double the target's track).
   *   2. **Slot-length negotiation (the real blocker).** The tap's audio is
   *      the TARGET step's length, which may be shorter than the consuming
   *      slot. The flat mix doesn't pad it, so `-shortest` truncates the
   *      whole step (proven: a 1.0s cross-step "echo" slot mirroring a 0.5s
   *      target truncated to 0.5s). Wiring must apad the mirror audio to the
   *      slot (loopMode-aware) before the stamp is safe.
   * Deferred until that negotiation lands. See the F3 audio candidate note.
   */
  audio?: MosaicAudioProps;
  overlay?: MosaicOverlayExpr;

  /** Editor-only metadata. Ignored by engine/rendering. */
  editor?: MosaicSourceEditorMeta;

  /** Engine-only metadata. */
  engine?: MosaicEngineMeta;
};

/**
 * Maybe implement someday
 * flipH / Flip Y: Easy to implement, high value
 * brightness / contrast / saturation / hueRotation: color adjustments
 * noise / grain: may be useful
 */

/**
 * Pipeline-boundary shortcut: a non-rendering step that just
 * publishes `variables`.
 *
 * # What it is
 *
 * `MosaicDataSource` is shorthand for the canonical
 * "non-rendering intermediate that sets `doc.variables`" shape.
 * It bundles three commitments into a single source kind:
 *
 *  1. **No render contribution, no cell.** Data sources are **skipped
 *     from m0 layout entirely** — they don't occupy a cell, the planner
 *     emits no ffmpeg command for them, and they contribute nothing to
 *     the rendered output. They sit in `doc.sources[]` purely as a
 *     side-channel for their `variables` payload. `doc.sources.length`
 *     therefore does NOT have to equal the m0 cell count; only the
 *     renderable subset of `sources[]` is matched against m0 cells.
 *  2. **Intermediate status enforced for data-only steps.** A pipeline
 *     step whose `sources[]` contains ONLY data sources (no renderables)
 *     must be marked `intermediate: true`. The engine errors
 *     (`PIPELINE_DATA_ONLY_STEP_NOT_INTERMEDIATE`) if it isn't.
 *  3. **Data published via {@link variables}** for downstream
 *     pipeline steps to read via
 *     {@link MosaicEngineContext.upstreamVariables} (flat) or
 *     {@link MosaicEngineContext.upstreamData} (namespaced by
 *     {@link alias}). Same back-edge invariant as
 *     {@link MosaicRefSource}.
 *
 * # Multiple data sources per step are allowed
 *
 * `doc.sources` may contain **any number** of `MosaicDataSource`s
 * — typically one per logical data block, each with its own
 * {@link alias}. This is the recommended pattern when a step
 * publishes several independent named payloads (e.g. one for
 * `templateContext`, one for `designTokens`, one for
 * `seasonData`). They contribute to back-edge collection
 * independently; aliased ones each surface their own
 * `ctx.upstreamData[alias]` entry.
 *
 * # Coexistence with renderable sources
 *
 * A `MosaicDataSource` may sit alongside renderable sources
 * (`media` / `text` / `mosaic` / `lavfi` / `ref`) in the same
 * `doc.sources` array. It is **skipped from m0 layout** — the engine
 * walks `doc.sources[]` and consumes one m0 cell per renderable
 * source, passing over data entries. So the m0 string only needs to
 * describe cells for the renderable subset; data sources don't
 * shift cell indices or require a slot in the geometry. The author
 * can place data entries anywhere in `sources[]` (start / middle /
 * end) — the engine's planner filters them out before frame/cell
 * assignment.
 *
 * # When to use it (vs. alternatives)
 *
 * | Goal                                            | Pattern                                                                                       |
 * |-------------------------------------------------|-----------------------------------------------------------------------------------------------|
 * | Render pixels *and* publish namespaced data     | Real source(s) + `MosaicDataSource` with `alias` in the same `doc.sources`. Step is **not** intermediate. |
 * | Render pixels *and* publish flat data           | Real source(s) in `doc.sources` + `doc.variables` on the doc. Step is **not** intermediate.   |
 * | Publish data only, no visible render            | Only `MosaicDataSource`s (no renderables) in `doc.sources`. Step **must** be `intermediate:true`. |
 * | Data flow *within* one MosaicDocument           | `renderNestedTemplate` from `@m0saic/template-utils` + pass values in TypeScript. No engine channel needed. |
 *
 * # Scope: pipeline boundaries only
 *
 * `MosaicDataSource` only makes sense when there are downstream
 * pipeline steps that need the data. Within a single doc, the
 * parent template already holds nested-render results in its
 * TypeScript scope — there's no boundary to cross. A
 * `MosaicDataSource` in a top-level non-pipeline doc has no
 * consumer; the engine emits
 * `MOSAIC_DATA_SOURCE_OUTSIDE_PIPELINE` (warning).
 *
 * # Optional alias
 *
 * Setting {@link alias} surfaces this source's `variables` under
 * `ctx.upstreamData[alias]` in addition to the flat
 * `ctx.upstreamVariables` union. Aliases are **exclusively a data
 * read channel** — they have no role in visual references.
 * `MosaicRefSource` mirrors only sources that produce real pixels;
 * a ref pointing at a `MosaicDataSource`'s former slot is structurally
 * impossible (data sources are filtered from layout — no cell exists
 * for a ref to target) and surfaces as `MOSAIC_REF_NOT_FOUND`.
 *
 * # Engine diagnostics
 *
 * - `PIPELINE_DATA_ONLY_STEP_NOT_INTERMEDIATE` *(error)* — fires
 *   only when **every** source in the step is a `MosaicDataSource`
 *   and the step lacks `intermediate:true`. Mixed steps don't
 *   trigger it.
 * - `MOSAIC_DATA_SOURCE_VISIBLE_USE` *(error, code registered but not
 *   emitted)* — historically fired when a `MosaicRefSource` targeted
 *   a data source. After Phase 3b's "data sources skipped from
 *   layout" pivot the scenario is unreachable; the code remains
 *   registered in `@m0saic/types` for ABI stability.
 * - `MOSAIC_DATA_SOURCE_OUTSIDE_PIPELINE` *(warning)*
 * - `MOSAIC_ALIAS_COLLISION` *(warning)* — two data sources in the
 *   same job declare the same alias; last-write-wins.
 *
 * Engine wiring landing across Phase 3b/3c.
 */
export type MosaicDataSource = {
  type: "data";

  /**
   * The data payload this source carries.
   *
   * Opaque `Record<string, unknown>` at the file-format level — the
   * file format treats values as opaque JSON. The producing
   * template's typed contract lives at
   * {@link MosaicTemplate.outputsSchema}; consumer templates declare
   * their needs at {@link MosaicTemplate.upstreamVariablesSchema} or
   * {@link MosaicTemplate.upstreamDataSchema}.
   */
  variables: Record<string, unknown>;

  /**
   * Author-facing alias for namespaced downstream reads.
   *
   * When set, downstream pipeline steps can read its variables
   * via `ctx.upstreamData[alias]` in addition to the flat
   * `ctx.upstreamVariables` union.
   *
   * Aliases are purely a data read channel. They are **not**
   * addressable by {@link MosaicRefSource} — refs mirror real
   * pixels, not data carriers.
   *
   * Convention: short camelCase identifiers — `"templateContext"`,
   * `"seasonData"`, `"designTokens"`. Optional; without an alias the
   * source's variables still merge into the flat union but no
   * namespaced view is published.
   *
   * Branded as {@link AliasId} — values must match
   * {@link STRICT_IDENTIFIER_PATTERN}. Construct via the
   * platform-layer helpers or {@link asAliasId} at JSON parse
   * boundaries.
   */
  alias?: AliasId;

  /** Editor-only metadata. Ignored by engine/rendering. */
  editor?: MosaicSourceEditorMeta;

  /** Engine-only metadata. */
  engine?: MosaicEngineMeta;
};

/**
 * Type guard for {@link MosaicDataSource}.
 *
 * Use this everywhere the planner / validator / data-fetcher tooling
 * needs to branch on "is this source a data carrier?" — it keeps the
 * `"data"` discriminant pinned in one place so a future rename can't
 * silently miss a call site.
 *
 * Accepts `null` / `undefined` and returns `false` for them, because
 * call sites sometimes filter sparse arrays before classifying the
 * remaining entries.
 */
export const isMosaicDataSource = (
  s: MosaicSource | null | undefined,
): s is MosaicDataSource => s != null && s.type === "data";

/**
 * Type guard for {@link MosaicRefSource}.
 *
 * Use this everywhere the planner / validator / ref-target tooling
 * needs to branch on "is this source a back-edge mirror?" — keeps the
 * `"ref"` discriminant pinned in one place. Mirrors the
 * {@link isMosaicDataSource} contract: accepts `null` / `undefined`
 * and returns `false` for them so sparse-array call sites stay clean.
 */
export const isMosaicRefSource = (
  s: MosaicSource | null | undefined,
): s is MosaicRefSource => s != null && s.type === "ref";

// ─────────────────────────────────────────────────────────────
// Template invocation source — `.mosaicx`-only
// ─────────────────────────────────────────────────────────────

/**
 * An UNRESOLVED template invocation slotted into a cell.
 *
 * Lives only in `.mosaicx` (MosaicXDocument) source files. The resolver
 * (`resolveMosaicx` in `@m0saic/core/runtime`) walks every
 * `template_invocation` source, calls the named template with the given
 * props (validated against the template's propsSchema), and replaces
 * the invocation with a `mosaic` source whose `ref` points at the
 * rendered child doc. By the time a flat `.mosaic` reaches the engine,
 * no `template_invocation` sources remain.
 *
 * # Why this kind exists
 *
 * Pipeline-producing templates emit a
 * `MosaicDocumentPipeline` — a chain of clip steps that must be
 * rendered and concatenated. Embedding a pipeline directly in a parent
 * doc isn't possible (children carry one renderable each). 
 * With template_invocation, the parent .mosaicx stays small, 
 * the user can edit props/duration in Compose without
 * round-tripping through ffmpeg, and the engine handles pipeline
 * materialization at render time.
 *
 * # Field semantics
 *
 * - `templateId` is the fully-qualified id (e.g.
 *   `"@m0saic/media/screencap_grid/v2"`).
 * - `templateVersion` is optional; when set, the resolver errors if
 *   the registry version differs (pin behavior).
 * - `props` is unvalidated at author time — validation happens at
 *   resolve time against `MosaicTemplate.propsSchema`. This lets
 *   Compose save partially-edited `.mosaicx` files without rejecting
 *   them.
 * - `output` is a full output-format bundle (size / fps / durationMs /
 *   target / format / audio / color / metadata / backgroundColor) —
 *   the same knobs `MosaicDocument` exposes at the doc level. Lets
 *   the source dictate exactly what file shape the resolver bakes.
 *   Each subfield falls back to the template's own `outputHints`,
 *   then engine defaults.
 * - Receiver decoration (`placement`, `playback`, `effects`, `mask`,
 *   `visual`, `audio`, `overlay`) controls how the rendered file
 *   paints into its cell of the parent doc. Resolver copies these
 *   straight through onto the produced `mosaic` source.
 *
 * # Editor metadata
 *
 * Mirrors `MosaicMosaicSource` — same `editor` / `engine` slots so the
 * Compose source editor can attach owner/label/binding metadata to a
 * `template_invocation` exactly like any other source.
 */
/**
 * Output-format bundle for a {@link MosaicTemplateInvocationSource}.
 *
 * A template invocation always resolves down to ONE file (the resolver
 * materializes pipelines via concat; the engine sees a single rendered
 * unit per invocation). That means the source can fully specify what
 * that file looks like — same output knobs that {@link MosaicDocument}
 * carries at the doc level, just namespaced under `output` to keep
 * them visually distinct from receiver decoration (placement, playback,
 * effects, …) that lives flat on the source itself.
 *
 * Field semantics mirror `MosaicDocument` exactly. The resolver hands
 * these to `engineCtx.output.*` when invoking the template, so the
 * template renders at the requested size / fps / format / etc.
 *
 * All fields optional. Anything left undefined falls back to the
 * template's own `outputHints`, then engine defaults.
 */
export type MosaicTemplateInvocationOutput = {
  /** Output canvas in pixels. */
  size?: { width: number; height: number };

  /** Output frame rate (frames per second). */
  fps?: number;

  /** Output duration in milliseconds. */
  durationMs?: number;

  /** High-level named target preset (web-mp4, alpha-mov, image-png, …). */
  target?: MosaicOutputTarget;

  /** Container / codec / pixel-format / encoder-tuning knobs. */
  format?: MosaicOutputFormat;

  /** Audio-stream codec knobs (codec, bitrate, sample rate, channels). */
  audio?: MosaicAudioConfig;

  /** Color tagging (space, range, primaries, transfer). */
  color?: MosaicColorConfig;

  /** Container metadata atoms (title, author, copyright, …). */
  metadata?: MosaicContainerMetadata;

  /** Canvas background fill when content doesn't cover the full frame. */
  backgroundColor?: MosaicColor;

  /** Baked background image, painted beneath all sources. */
  backgroundImage?: MosaicBackgroundImage;
};

export type MosaicTemplateInvocationSource = {
  type: "template_invocation";

  /** Fully-qualified template id — same shape `MosaicTemplate.id` uses. */
  templateId: TemplateId;

  /**
   * @deprecated since 2026-09-06 — pins the deprecated
   * `MosaicTemplate.version`; the id's `vN` is the version. The resolver
   * only WARNS on a mismatch (`MOSAICX_TEMPLATE_VERSION_MISMATCH` progress
   * event, never a failure). Ignored by the share link. Removed in the
   * pre-launch deprecation sweep.
   */
  templateVersion?: number;

  /**
   * Raw, unvalidated props blob. Validated against the template's
   * `propsSchema` at resolve time, not at file-load time, so partially-
   * edited `.mosaicx` files round-trip cleanly through Compose.
   */
  props: unknown;

  /**
   * Output-format bundle — controls what the baked file from this
   * invocation looks like (size, fps, durationMs, codec, color, …).
   * Each field falls back to the template's own `outputHints`, then
   * engine defaults, when undefined. See
   * {@link MosaicTemplateInvocationOutput}.
   *
   * Distinct from the receiver-decoration props (`placement`,
   * `playback`, `effects`, …) below: `output` controls what FILE the
   * resolver bakes; the decoration props control how that file paints
   * INTO its cell of the parent doc.
   */
  output?: MosaicTemplateInvocationOutput;

  /**
   * Optional EDITOR-ONLY preview reference — key into the parent
   * document's `children` map pointing at a cached preview render of
   * this invocation. Stamped by Compose's source editor when it
   * runs the template for canvas + structure-dock preview; lets
   * those surfaces walk the rendered child's geometry the same way
   * they do for a fully-inlined {@link MosaicMosaicSource}.
   *
   * **The resolver IGNORES this field.** At render time
   * `resolveMosaicx` runs the template fresh against the live
   * registry / data — `previewRef` is purely a Compose-editor cache.
   * Persisting it round-trips a "what the editor last saw" snapshot
   * so users get a familiar canvas / structure-dock view when they
   * reopen the file, without needing to re-render before edit.
   *
   * Engine entry points may safely strip `previewRef` along with
   * the orphan child after resolve completes.
   */
  previewRef?: string;

  // ── Receiver decoration ─────────────────────────────────────────
  // How the resolved render of this invocation paints INTO ITS CELL
  // of the parent doc. Mirrors {@link MosaicMosaicSource} so the
  // resolver can copy these straight through onto the produced
  // `mosaic` source without losing user intent.

  placement?: MosaicPlacementProps;
  playback?: MosaicPlaybackProps;
  effects?: MosaicEffectProps;
  mask?: MosaicSourceMask;
  visual?: MosaicVisualProps;
  audio?: MosaicAudioProps;
  overlay?: MosaicOverlayExpr;

  /** Editor-only metadata. Ignored by engine/resolver semantics. */
  editor?: MosaicSourceEditorMeta;

  /** Engine-only metadata. */
  engine?: MosaicEngineMeta;
};

/**
 * Type guard for {@link MosaicTemplateInvocationSource}.
 *
 * Use this wherever the resolver / Compose source editor / validator
 * needs to branch on "is this an unresolved invocation?" — keeps the
 * `"template_invocation"` discriminant pinned in one place so a rename
 * can't silently miss a call site. Mirrors the
 * {@link isMosaicRefSource} contract: accepts `null` / `undefined` and
 * returns `false` for them so sparse-array call sites stay clean.
 */
export const isMosaicTemplateInvocationSource = (
  s: MosaicSource | null | undefined,
): s is MosaicTemplateInvocationSource =>
  s != null && s.type === "template_invocation";
