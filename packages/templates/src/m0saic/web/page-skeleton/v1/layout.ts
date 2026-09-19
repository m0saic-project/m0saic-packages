import type {
  PageSkeletonCapture,
  PageSkeletonCaptureRect,
  PageSkeletonRectKind,
} from "./schema";

export type PageSkeletonScaleMode = "fit" | "fill" | "stretch";
export type PageSkeletonContainerMode = "keep" | "drop";

export type IndexedCaptureRect = PageSkeletonCaptureRect & {
  /** Stable index into the pasted capture's `rects` array. */
  i: number;
};

export type BucketedCaptureRect = IndexedCaptureRect & {
  zBucket: number;
  /** Large painted wrapper retained as real geometry but painted softly. */
  isSoftContainer?: boolean;
  /** The one retained block that covers the captured viewport. */
  isViewportBackdrop?: boolean;
};

export type CanvasSkeletonRect = BucketedCaptureRect & {
  /** Captured radius scaled into canvas pixels. */
  r: number;
};

export type ScaleTransform = {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
};

export type LayoutOptions = {
  canvasW: number;
  canvasH: number;
  /** Capture indices hidden by the P4 customization handshake. */
  hiddenIndices?: ReadonlySet<number>;
  maxRects?: number;
  showTextLines?: boolean;
  showImages?: boolean;
  showControls?: boolean;
  showDividers?: boolean;
  scaleMode?: PageSkeletonScaleMode;
  containerMode?: PageSkeletonContainerMode;
  maxDepthBuckets?: number;
};

export type LayoutStats = {
  input: number;
  filtered: number;
  capped: number;
  pruned: number;
  degenerate: number;
  output: number;
};

export type PageSkeletonLayout = {
  rects: CanvasSkeletonRect[];
  transform: ScaleTransform;
  stats: LayoutStats;
};

export const DEFAULT_MAX_RECTS = 220;
export const MAX_DEPTH_BUCKETS = 6;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const area = (rect: Pick<PageSkeletonCaptureRect, "w" | "h">): number =>
  rect.w * rect.h;

function kindEnabled(
  kind: PageSkeletonRectKind,
  options: Pick<
    LayoutOptions,
    "showTextLines" | "showImages" | "showControls" | "showDividers"
  >,
): boolean {
  if (kind === "text") return options.showTextLines !== false;
  if (kind === "image") return options.showImages !== false;
  if (kind === "control") return options.showControls !== false;
  if (kind === "divider") return options.showDividers !== false;
  return true;
}

/**
 * Apply the renderer-side deterministic cap. Ranking matches the browser
 * collector, with the capture index as the final stable tie-break.
 */
export function capCaptureRects(
  rects: IndexedCaptureRect[],
  maxRects: number = DEFAULT_MAX_RECTS,
): IndexedCaptureRect[] {
  const cap = Math.max(0, Math.floor(Number.isFinite(maxRects) ? maxRects : DEFAULT_MAX_RECTS));
  return [...rects]
    .sort(
      (a, b) =>
        a.d - b.d ||
        area(b) - area(a) ||
        a.y - b.y ||
        a.x - b.x ||
        b.w - a.w ||
        b.h - a.h ||
        a.i - b.i,
    )
    .slice(0, cap);
}

function contains(outer: IndexedCaptureRect, inner: IndexedCaptureRect): boolean {
  return (
    outer.i !== inner.i &&
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.w >= inner.x + inner.w &&
    outer.y + outer.h >= inner.y + inner.h
  );
}

/** Capture indices of genuinely large wrappers containing several descendants. */
export function findContainingBlockIds(
  rects: IndexedCaptureRect[],
  viewport: { w: number; h: number },
): Set<number> {
  const ids = new Set<number>();
  const viewportArea = viewport.w * viewport.h;
  for (const candidate of rects) {
    if (candidate.k !== "block" || area(candidate) < viewportArea * 0.35) continue;
    let containedCount = 0;
    for (const other of rects) {
      if (contains(candidate, other)) containedCount++;
      if (containedCount >= 2) {
        ids.add(candidate.i);
        break;
      }
    }
  }
  return ids;
}

/**
 * Drop only genuinely large painted wrappers: block rects covering at least
 * 35% of the viewport and containing two or more retained descendants.
 * Header/sidebar bands and leaf cards therefore survive the pruning knob.
 */
export function pruneContainingRects(
  rects: IndexedCaptureRect[],
  viewport: { w: number; h: number },
  mode: PageSkeletonContainerMode,
): IndexedCaptureRect[] {
  if (mode !== "drop") return rects;
  const containerIds = findContainingBlockIds(rects, viewport);
  return rects.filter((candidate) => !containerIds.has(candidate.i));
}

function viewportBackdropId(
  rects: IndexedCaptureRect[],
  viewport: { w: number; h: number },
): number | null {
  const candidates = rects
    .filter(
      (rect) =>
        rect.k === "block" &&
        rect.x <= 0 &&
        rect.y <= 0 &&
        rect.x + rect.w >= viewport.w &&
        rect.y + rect.h >= viewport.h,
    )
    .sort(
      (a, b) =>
        a.d - b.d ||
        area(b) - area(a) ||
        a.i - b.i,
    );
  return candidates[0]?.i ?? null;
}

/** Map arbitrary captured depths into at most `maxBuckets` stable z buckets. */
export function quantizeDepthBuckets(
  rects: IndexedCaptureRect[],
  maxBuckets: number = MAX_DEPTH_BUCKETS,
): BucketedCaptureRect[] {
  if (rects.length === 0) return [];
  const bucketCount = Math.max(1, Math.floor(maxBuckets));
  const depths = [...new Set(rects.map((rect) => rect.d))].sort((a, b) => a - b);
  const rank = new Map(depths.map((depth, index) => [depth, index]));

  return rects.map((rect) => ({
    ...rect,
    zBucket: Math.min(
      bucketCount - 1,
      Math.floor(((rank.get(rect.d) ?? 0) * bucketCount) / depths.length),
    ),
  }));
}

/** Compute capture-viewport → target-canvas scaling and centering. */
export function computeScaleTransform(
  viewport: { w: number; h: number },
  canvas: { w: number; h: number },
  mode: PageSkeletonScaleMode,
): ScaleTransform {
  const scaleX = canvas.w / viewport.w;
  const scaleY = canvas.h / viewport.h;
  if (mode === "stretch") {
    return { scaleX, scaleY, offsetX: 0, offsetY: 0 };
  }

  const scale = mode === "fill" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  return {
    scaleX: scale,
    scaleY: scale,
    offsetX: (canvas.w - viewport.w * scale) / 2,
    offsetY: (canvas.h - viewport.h * scale) / 2,
  };
}

function forceOnePixel(
  start: number,
  end: number,
  rawStart: number,
  rawEnd: number,
  axisLength: number,
): [number, number] {
  if (end > start) return [start, end];
  const center = clamp(Math.round((rawStart + rawEnd) / 2), 0, axisLength - 1);
  return [center, center + 1];
}

/**
 * Scale with independently-rounded edges, then clip to the canvas. Dividers
 * alone may recover a collapsed thin axis to one pixel; every other
 * degenerate rect is dropped.
 */
export function scaleRectToCanvas(
  rect: BucketedCaptureRect,
  transform: ScaleTransform,
  canvas: { w: number; h: number },
): CanvasSkeletonRect | null {
  const rawX0 = transform.offsetX + rect.x * transform.scaleX;
  const rawY0 = transform.offsetY + rect.y * transform.scaleY;
  const rawX1 = transform.offsetX + (rect.x + rect.w) * transform.scaleX;
  const rawY1 = transform.offsetY + (rect.y + rect.h) * transform.scaleY;

  if (rawX1 <= 0 || rawY1 <= 0 || rawX0 >= canvas.w || rawY0 >= canvas.h) {
    return null;
  }

  let x0 = clamp(Math.round(rawX0), 0, canvas.w);
  let y0 = clamp(Math.round(rawY0), 0, canvas.h);
  let x1 = clamp(Math.round(rawX1), 0, canvas.w);
  let y1 = clamp(Math.round(rawY1), 0, canvas.h);

  if (rect.k === "divider") {
    const horizontal = rect.w >= rect.h;
    if (horizontal && x1 > x0) {
      [y0, y1] = forceOnePixel(y0, y1, rawY0, rawY1, canvas.h);
    } else if (!horizontal && y1 > y0) {
      [x0, x1] = forceOnePixel(x0, x1, rawX0, rawX1, canvas.w);
    }
  }

  if (x1 <= x0 || y1 <= y0) return null;
  const scaledRadius = Math.round(rect.r * Math.min(transform.scaleX, transform.scaleY));

  return {
    ...rect,
    x: x0,
    y: y0,
    w: x1 - x0,
    h: y1 - y0,
    r: clamp(scaledRadius, 0, Math.floor(Math.min(x1 - x0, y1 - y0) / 2)),
  };
}

/** Full pure layout pipeline used by the renderer. */
export function layoutCapture(
  capture: PageSkeletonCapture,
  options: LayoutOptions,
): PageSkeletonLayout {
  const canvasW = Math.max(1, Math.round(options.canvasW));
  const canvasH = Math.max(1, Math.round(options.canvasH));
  const indexed: IndexedCaptureRect[] = capture.rects.map((rect, i) => ({ ...rect, i }));
  const visible = indexed.filter(
    (rect) =>
      !options.hiddenIndices?.has(rect.i) &&
      kindEnabled(rect.k, options),
  );
  const capped = capCaptureRects(visible, options.maxRects ?? DEFAULT_MAX_RECTS);
  const containerIds = findContainingBlockIds(capped, capture.viewport);
  const pruned = pruneContainingRects(
    capped,
    capture.viewport,
    options.containerMode ?? "keep",
  );
  const backdropId = viewportBackdropId(pruned, capture.viewport);
  const bucketed = quantizeDepthBuckets(
    pruned,
    options.maxDepthBuckets ?? MAX_DEPTH_BUCKETS,
  ).map((rect) => ({
    ...rect,
    ...(containerIds.has(rect.i) ? { isSoftContainer: true } : {}),
    ...(rect.i === backdropId ? { isViewportBackdrop: true } : {}),
  }));
  const transform = computeScaleTransform(
    capture.viewport,
    { w: canvasW, h: canvasH },
    options.scaleMode ?? "fit",
  );
  const scaled = bucketed
    .map((rect) => scaleRectToCanvas(rect, transform, { w: canvasW, h: canvasH }))
    .filter((rect): rect is CanvasSkeletonRect => rect !== null);

  return {
    rects: scaled,
    transform,
    stats: {
      input: indexed.length,
      filtered: indexed.length - visible.length,
      capped: visible.length - capped.length,
      pruned: capped.length - pruned.length,
      degenerate: bucketed.length - scaled.length,
      output: scaled.length,
    },
  };
}

export type LayerProjectionRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  zBucket: number;
};

const projectionOverlaps = (
  a: LayerProjectionRect,
  b: LayerProjectionRect,
): boolean =>
  a.x < b.x + b.w &&
  b.x < a.x + a.w &&
  a.y < b.y + b.h &&
  b.y < a.y + a.h;

const yBoundarySubdivides = (
  divider: LayerProjectionRect,
  divided: LayerProjectionRect,
): boolean => {
  const top = divider.y;
  const bottom = divider.y + divider.h;
  const dividedTop = divided.y;
  const dividedBottom = divided.y + divided.h;
  return (
    (top > dividedTop && top < dividedBottom) ||
    (bottom > dividedTop && bottom < dividedBottom)
  );
};

const projectionConflicts = (
  a: LayerProjectionRect,
  b: LayerProjectionRect,
): boolean =>
  projectionOverlaps(a, b) ||
  yBoundarySubdivides(a, b) ||
  yBoundarySubdivides(b, a);

/**
 * Mirror placeRects' importance-bucket + greedy first-fit layer packing.
 * This is a conservative pre-placement signal; the final composed m0 remains
 * the source of truth in render tests because inset quantization can add a
 * collision at a cell boundary.
 */
export function projectOverlayLayerCount(rects: LayerProjectionRect[]): number {
  const buckets = new Map<number, LayerProjectionRect[]>();
  for (const rect of rects) {
    const bucket = buckets.get(rect.zBucket) ?? [];
    bucket.push(rect);
    buckets.set(rect.zBucket, bucket);
  }

  let count = 0;
  for (const zBucket of [...buckets.keys()].sort((a, b) => a - b)) {
    const layers: LayerProjectionRect[][] = [];
    for (const rect of buckets.get(zBucket) ?? []) {
      const layer = layers.find((candidate) =>
        candidate.every((other) => !projectionConflicts(rect, other)),
      );
      if (layer) layer.push(rect);
      else layers.push([rect]);
    }
    count += layers.length;
  }
  return count;
}
