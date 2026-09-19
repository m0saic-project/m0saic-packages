import {
  capCaptureRects,
  computeScaleTransform,
  findContainingBlockIds,
  layoutCapture,
  projectOverlayLayerCount,
  pruneContainingRects,
  quantizeDepthBuckets,
  scaleRectToCanvas,
  type BucketedCaptureRect,
  type IndexedCaptureRect,
} from "./layout";
import { SAMPLE_CAPTURE } from "./sample-capture";

const indexedRect = (
  i: number,
  overrides: Partial<IndexedCaptureRect> = {},
): IndexedCaptureRect => ({
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  k: "block",
  r: 0,
  d: 0,
  i,
  ...overrides,
});

const bucketedRect = (
  i: number,
  overrides: Partial<BucketedCaptureRect> = {},
): BucketedCaptureRect => ({
  ...indexedRect(i),
  zBucket: 0,
  ...overrides,
});

describe("page-skeleton layout scaling", () => {
  it("computes exact fit, fill, and stretch transforms", () => {
    const viewport = { w: 100, h: 50 };
    const canvas = { w: 200, h: 200 };
    expect(computeScaleTransform(viewport, canvas, "fit")).toEqual({
      scaleX: 2,
      scaleY: 2,
      offsetX: 0,
      offsetY: 50,
    });
    expect(computeScaleTransform(viewport, canvas, "fill")).toEqual({
      scaleX: 4,
      scaleY: 4,
      offsetX: -100,
      offsetY: 0,
    });
    expect(computeScaleTransform(viewport, canvas, "stretch")).toEqual({
      scaleX: 2,
      scaleY: 4,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it("rounds independent edges instead of summing rounded widths", () => {
    const scaled = scaleRectToCanvas(
      bucketedRect(0, { x: 1, y: 0, w: 1, h: 1 }),
      { scaleX: 10 / 3, scaleY: 10, offsetX: 0, offsetY: 0 },
      { w: 10, h: 10 },
    );
    expect(scaled).toMatchObject({ x: 3, y: 0, w: 4, h: 10 });
  });

  it("clips fill-mode overflow to the canvas", () => {
    const transform = computeScaleTransform(
      { w: 100, h: 50 },
      { w: 200, h: 200 },
      "fill",
    );
    expect(
      scaleRectToCanvas(
        bucketedRect(0, { x: 0, y: 0, w: 40, h: 50 }),
        transform,
        { w: 200, h: 200 },
      ),
    ).toMatchObject({ x: 0, y: 0, w: 60, h: 200 });
  });

  it("drops degenerate blocks but preserves a divider at one pixel", () => {
    const transform = { scaleX: 0.1, scaleY: 0.1, offsetX: 0, offsetY: 0 };
    expect(
      scaleRectToCanvas(
        bucketedRect(0, { x: 5, y: 5, w: 1, h: 1 }),
        transform,
        { w: 10, h: 10 },
      ),
    ).toBeNull();
    expect(
      scaleRectToCanvas(
        bucketedRect(1, { x: 5, y: 5, w: 50, h: 1, k: "divider" }),
        transform,
        { w: 10, h: 10 },
      ),
    ).toMatchObject({ x: 1, y: 1, w: 5, h: 1 });
  });
});

describe("page-skeleton layout selection", () => {
  it("caps with the capture's deterministic ranking", () => {
    const selected = capCaptureRects(
      [
        indexedRect(0, { x: 10, y: 0, d: 1 }),
        indexedRect(1, { x: 20, y: 5, w: 20, h: 20 }),
        indexedRect(2, { x: 0, y: 5, w: 20, h: 20 }),
        indexedRect(3, { x: 5, y: 0, w: 50, h: 20 }),
      ],
      3,
    );
    expect(selected.map((rect) => rect.i)).toEqual([3, 2, 1]);
  });

  it("drops only large containing blocks in container drop mode", () => {
    const rects = [
      indexedRect(0, { w: 100, h: 100 }),
      indexedRect(1, { x: 10, y: 10, w: 20, h: 20 }),
      indexedRect(2, { x: 40, y: 40, w: 20, h: 20 }),
      indexedRect(3, { x: 70, y: 0, w: 30, h: 100 }),
    ];
    expect(findContainingBlockIds(rects, { w: 100, h: 100 })).toEqual(new Set([0]));
    expect(pruneContainingRects(rects, { w: 100, h: 100 }, "keep")).toHaveLength(4);
    expect(
      pruneContainingRects(rects, { w: 100, h: 100 }, "drop").map((rect) => rect.i),
    ).toEqual([1, 2, 3]);
  });

  it("retains a containing block as softly-painted real geometry in keep mode", () => {
    const capture = {
      format: "m0saic-page-skeleton" as const,
      version: 1 as const,
      viewport: { w: 100, h: 100 },
      rects: [
        { x: 0, y: 0, w: 100, h: 100, k: "block" as const, r: 0, d: 0 },
        { x: 10, y: 10, w: 20, h: 20, k: "image" as const, r: 0, d: 1 },
        { x: 40, y: 40, w: 20, h: 10, k: "text" as const, r: 0, d: 1 },
      ],
    };
    const layout = layoutCapture(capture, {
      canvasW: 100,
      canvasH: 100,
      containerMode: "keep",
    });
    expect(layout.rects.find((rect) => rect.i === 0)?.isSoftContainer).toBe(true);
    expect(layout.rects).toHaveLength(3);
  });

  it("marks exactly one retained viewport-sized block as the semantic backdrop", () => {
    const capture = {
      format: "m0saic-page-skeleton" as const,
      version: 1 as const,
      viewport: { w: 100, h: 80 },
      rects: [
        { x: 0, y: 0, w: 100, h: 80, k: "block" as const, r: 0, d: 4 },
        { x: 0, y: 0, w: 100, h: 80, k: "block" as const, r: 0, d: 1 },
        { x: 10, y: 10, w: 20, h: 20, k: "image" as const, r: 4, d: 2 },
      ],
    };
    const layout = layoutCapture(capture, {
      canvasW: 100,
      canvasH: 80,
      containerMode: "keep",
    });

    expect(
      layout.rects
        .filter((rect) => rect.isViewportBackdrop)
        .map((rect) => rect.i),
    ).toEqual([1]);
  });

  it("quantizes arbitrary depth into at most six ordered buckets", () => {
    const bucketed = quantizeDepthBuckets(
      Array.from({ length: 20 }, (_, d) => indexedRect(d, { d })),
      6,
    );
    expect(new Set(bucketed.map((rect) => rect.zBucket)).size).toBe(6);
    expect(Math.min(...bucketed.map((rect) => rect.zBucket))).toBe(0);
    expect(Math.max(...bucketed.map((rect) => rect.zBucket))).toBe(5);
    expect(bucketed.map((rect) => rect.zBucket)).toEqual(
      [...bucketed].sort((a, b) => a.d - b.d).map((rect) => rect.zBucket),
    );
  });

  it("lays out the complete sample and composes kind filtering with the cap", () => {
    const complete = layoutCapture(SAMPLE_CAPTURE, {
      canvasW: 1440,
      canvasH: 900,
    });
    expect(complete.rects).toHaveLength(64);
    expect(complete.stats).toEqual({
      input: 64,
      filtered: 0,
      capped: 0,
      pruned: 0,
      degenerate: 0,
      output: 64,
    });

    const filtered = layoutCapture(SAMPLE_CAPTURE, {
      canvasW: 1440,
      canvasH: 900,
      showTextLines: false,
      maxRects: 10,
    });
    expect(filtered.rects).toHaveLength(10);
    expect(filtered.stats.filtered).toBe(24);
    expect(filtered.stats.capped).toBe(30);
  });

  it("hides override indices without renumbering retained capture indices", () => {
    const layout = layoutCapture(
      {
        format: "m0saic-page-skeleton",
        version: 1,
        viewport: { w: 100, h: 100 },
        rects: [
          { x: 0, y: 0, w: 10, h: 10, k: "block", r: 0, d: 0 },
          { x: 20, y: 0, w: 10, h: 10, k: "block", r: 0, d: 0 },
          { x: 40, y: 0, w: 10, h: 10, k: "block", r: 0, d: 0 },
        ],
      },
      {
        canvasW: 100,
        canvasH: 100,
        hiddenIndices: new Set([1]),
      },
    );
    expect(layout.rects.map((rect) => rect.i)).toEqual([0, 2]);
    expect(layout.stats.filtered).toBe(1);
  });

  it("is JSON-identical for identical inputs", () => {
    const options = {
      canvasW: 1000,
      canvasH: 700,
      scaleMode: "fit" as const,
      containerMode: "drop" as const,
    };
    expect(JSON.stringify(layoutCapture(SAMPLE_CAPTURE, options))).toBe(
      JSON.stringify(layoutCapture(SAMPLE_CAPTURE, options)),
    );
  });
});

describe("page-skeleton layer projection", () => {
  it("projects the same importance-tier and conflict layering used by placement", () => {
    expect(
      projectOverlayLayerCount([
        { x: 0, y: 0, w: 100, h: 100, zBucket: 0 },
        { x: 0, y: 0, w: 20, h: 20, zBucket: 0 },
        { x: 80, y: 80, w: 20, h: 20, zBucket: 0 },
        { x: 0, y: 0, w: 10, h: 10, zBucket: 1 },
      ]),
    ).toBe(3);
  });
});
