import type { MosaicDocument, MosaicEngineContext } from "@m0saic/types";
import { parseM0StringComplete, validateM0String } from "@m0saic/dsl";
import { resolvePropBindings } from "@m0saic/template-utils";
import {
  baseFillForKind,
  blendHexColors,
  buildPageSkeletonMotionLavfi,
  effectiveRadiusPx,
  motionRankForRect,
  overriddenRadiusPx,
  parseRectOverrides,
  PageSkeleton,
  resolvePageSkeletonMotion,
  roundingForRect,
  shadedRectangleFill,
  type PageSkeletonV1Props,
} from "./page-skeleton";
import { PAGE_SKELETON_CAPTURE_SNIPPET } from "./capture/capture-snippet-source";
import { SAMPLE_CAPTURE } from "./sample-capture";

const ctxFor = (width = 1440, height = 900): MosaicEngineContext => {
  const target = { width, height, fps: 30, durationMs: 1000 };
  return {
    mode: "render",
    target,
    output: { ...target, workspaceDir: "/tmp/page-skeleton-test" },
    media: {},
  } as MosaicEngineContext;
};

const render = async (
  props: PageSkeletonV1Props = {
    ...(PageSkeleton.defaultProps as PageSkeletonV1Props),
  },
  ctx = ctxFor(),
): Promise<MosaicDocument> =>
  (await PageSkeleton.render(props, ctx)) as MosaicDocument;

const isErrorMosaic = (doc: MosaicDocument): boolean =>
  (doc.sources[0] as { engine?: { renderStatus?: string } } | undefined)?.engine
    ?.renderStatus === "error";

/** The capture index a painted rect carries in its editor label. */
const captureIndexOf = (source: unknown): number | undefined => {
  const m = /^Capture rect (\d+)/.exec(
    (source as { editor?: { label?: string } }).editor?.label ?? "",
  );
  return m ? Number(m[1]) : undefined;
};

describe("@m0saic/web/page-skeleton/v1", () => {
  it("declares the public shell and deterministic capture default", () => {
    expect(String(PageSkeleton.id)).toBe("@m0saic/web/page-skeleton/v1");
    expect(PageSkeleton.version).toBe(1);
    expect(PageSkeleton.capabilities).toEqual({ tier: "core" });
    expect(PageSkeleton.aspectRatio).toEqual({
      ideal: 1.6,
      label: "16:10",
      mode: "none",
    });
    expect(PageSkeleton.outputHints).toMatchObject({
      width: 1440,
      height: 900,
      fps: 30,
      durationMs: 2400,
    });
    // The static hint mirrors the outputFormat knob default (animated mp4,
    // the skeleton breathing) so a share link at defaults carries no `f=`;
    // flipping the knob to Still PNG still wins.
    expect(PageSkeleton.outputHints?.format).toEqual({ kind: "video", container: "mp4" });
    expect(PageSkeleton.defaultProps?.outputFormat).toBe("mp4");
    expect(PageSkeleton.defaultProps?.motion).toMatchObject({
      mode: "pulse",
      direction: "diagonal",
    });
    expect(PageSkeleton.defaultProps?.capture).toBe(SAMPLE_CAPTURE);
    expect(PageSkeleton.defaultProps?.captureSnippet).toEqual({
      language: "javascript",
      code: PAGE_SKELETON_CAPTURE_SNIPPET,
    });
    expect(
      (PageSkeleton.defaultProps?.appearance as { radiusMode?: string }).radiusMode,
    ).toBe("captured");
    expect(
      (PageSkeleton.defaultProps?.behavior as { pureRects?: boolean }).pureRects,
    ).toBe(false);
    expect(PageSkeleton.propsSchema.capture).toMatchObject({
      type: "json",
      required: true,
      meta: {
        control: { flavor: "jsonModal" },
        ui: { primary: true },
      },
    });
    expect(PageSkeleton.propsSchema.captureSnippet).toMatchObject({
      type: "code",
      required: false,
      meta: {
        ui: { label: "Browser capture snippet", primary: true },
      },
    });
    expect(PageSkeleton.propsSchema.outputFormat).toMatchObject({
      type: "string",
      meta: {
        constraints: { oneOf: ["png", "mp4"] },
        ui: { label: "Output", primary: true },
      },
    });
    expect(
      (
        PageSkeleton.propsSchema.motion as {
          fields?: {
            mode?: { type?: string };
            direction?: { type?: string };
            bandWidth?: { type?: string };
          };
        }
      ).fields,
    ).toMatchObject({
      mode: { type: "string" },
      direction: { type: "string" },
      bandWidth: { type: "number" },
    });
    expect(
      (
        PageSkeleton.propsSchema.appearance as {
          fields?: { radiusMode?: { meta?: { ui?: { hidden?: boolean } } } };
        }
      ).fields?.radiusMode?.meta?.ui?.hidden,
    ).not.toBe(true);
    expect(PageSkeleton.propsSchema.overrides?.meta?.ui?.hidden).not.toBe(true);
    expect(PageSkeleton.propsSchema.debugIndices?.meta?.ui?.hidden).toBe(true);
    expect(
      (
        PageSkeleton.propsSchema.behavior as {
          fields?: {
            maxRects?: { description?: string };
            pureRects?: { type?: string };
          };
        }
      ).fields?.pureRects,
    ).toMatchObject({ type: "boolean" });
    expect(
      (
        PageSkeleton.propsSchema.behavior as {
          fields?: { maxRects?: { description?: string } };
        }
      ).fields?.maxRects?.description,
    ).toContain("independently placed skeleton sources");
  });

  it("renders every retained rect as an independent selectable rounded tile", async () => {
    // The STILL: defaults are the breathing mp4, so ask for the PNG here —
    // this test pins the editable still's structure (one color tile per rect).
    const doc = await render({
      ...(PageSkeleton.defaultProps as PageSkeletonV1Props),
      outputFormat: "png",
    });
    expect(isErrorMosaic(doc)).toBe(false);
    expect(validateM0String(String(doc.m0)).ok).toBe(true);
    const parsed = parseM0StringComplete(String(doc.m0), 1440, 900);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.ir.renderFrames).toHaveLength(64);
    expect(doc.sources).toHaveLength(64);
    expect(doc.sources.every((source) => source.type === "lavfi")).toBe(true);
    const rounded = doc.sources.filter(
      (source) => (source as { effects?: { rounding?: unknown } }).effects?.rounding,
    );
    const atlases = doc.sources.filter(
      (source) => (source as { mask?: { kind?: string } }).mask?.kind === "inline-mask",
    );
    expect(rounded).toHaveLength(64);
    expect(
      rounded.every(
        (source) =>
          (source as { effects?: { rounding?: { rasterizer?: string } } }).effects
            ?.rounding?.rasterizer === "svg",
      ),
    ).toBe(true);
    expect(
      rounded.some(
        (source) =>
          (source as { effects?: { rounding?: { cornerStyle?: string } } }).effects
            ?.rounding?.cornerStyle === "pill",
      ),
    ).toBe(true);
    expect(
      rounded.every(
        (source) =>
          (source as { editor?: { owner?: string } }).editor?.owner === "user",
      ),
    ).toBe(true);
    expect(rounded.every((source) => captureIndexOf(source) !== undefined)).toBe(true);
    expect(atlases).toHaveLength(0);
    const captureIndices = doc.sources.map(captureIndexOf);
    expect(captureIndices.every((index) => index !== undefined)).toBe(true);
    expect(new Set(captureIndices).size).toBe(64);
    expect(new Set(doc.sources.map((source) => (source as { color?: string }).color)).size).toBe(6);
    expect(doc.backgroundColor).toBe("#ffffff");
    expect(doc.format).toEqual({ kind: "image", container: "png" });
    expect(doc.size).toEqual({ width: 1440, height: 900 });
  });

  it("builds deterministic canvas-ranked shimmer and pulse fade programs", () => {
    expect(
      motionRankForRect(
        { x: 20, y: 10, w: 20, h: 20 },
        { w: 100, h: 100 },
        "horizontal",
      ),
    ).toBe(0.3);
    expect(
      motionRankForRect(
        { x: 20, y: 10, w: 20, h: 20 },
        { w: 100, h: 100 },
        "vertical",
      ),
    ).toBe(0.2);
    expect(
      motionRankForRect(
        { x: 20, y: 10, w: 20, h: 20 },
        { w: 100, h: 100 },
        "diagonal",
      ),
    ).toBe(0.25);

    const shimmer = resolvePageSkeletonMotion({
      mode: "shimmer",
      direction: "horizontal",
      bandWidth: 0.2,
      minOpacity: 0.6,
    });
    const shimmerLavfi = buildPageSkeletonMotionLavfi(
      "#d0d0d0",
      "#ffffff",
      0.25,
      shimmer,
      2,
    );
    expect(shimmerLavfi).toContain("color=c=0xd0d0d0");
    expect(shimmerLavfi).toContain(
      "fade=t=in:st=0.375:d=0.15:color=0xe3e3e3",
    );
    expect(shimmerLavfi).toContain(
      "fade=t=out:st=0.525:d=0.15:color=0xe3e3e3",
    );
    expect(
      buildPageSkeletonMotionLavfi(
        "#d0d0d0",
        "#ffffff",
        1,
        shimmer,
        2,
      ),
    ).toContain("fade=t=out:st=1.65:d=0.15:color=0xe3e3e3");

    const pulse = resolvePageSkeletonMotion({
      mode: "pulse",
      minOpacity: 0.6,
    });
    expect(
      buildPageSkeletonMotionLavfi(
        "#d0d0d0",
        "#ffffff",
        0.25,
        pulse,
        2,
      ),
    ).toBe(
      "color=c=0xd0d0d0,fade=t=in:st=0:d=0.9:color=0xe3e3e3,fade=t=out:st=0.9:d=0.9:color=0xe3e3e3",
    );
  });

  it("turns the same m0 and source set into an animated MP4 shimmer", async () => {
    const still = await render({
      ...(PageSkeleton.defaultProps as PageSkeletonV1Props),
      outputFormat: "png",
    });
    const animated = await render({
      ...(PageSkeleton.defaultProps as PageSkeletonV1Props),
      outputFormat: "mp4",
      motion: {
        mode: "shimmer",
        direction: "horizontal",
        bandWidth: 0.2,
        minOpacity: 0.6,
      },
    });

    expect(isErrorMosaic(animated)).toBe(false);
    expect(animated.format).toEqual({ kind: "video", container: "mp4" });
    expect(animated.audio).toEqual({ mode: "off" });
    expect(animated.m0).toBe(still.m0);
    expect(animated.sources).toHaveLength(still.sources.length);
    const animatedLavfi = animated.sources
      .map(
        (source) =>
          (source as { lavfi?: string }).lavfi,
      )
      .filter((lavfi): lavfi is string => typeof lavfi === "string");
    expect(animatedLavfi.length).toBeGreaterThan(0);
    expect(new Set(animatedLavfi).size).toBeGreaterThan(1);
    expect(animatedLavfi.every((lavfi) => lavfi.includes(",fade=t=in:"))).toBe(
      true,
    );
    expect(
      animated.sources.every(
        (source) =>
          (source as { overlay?: { alpha?: string } }).overlay?.alpha == null,
      ),
    ).toBe(true);
  });

  it.each([false, true])(
    "keeps a viewport-sized captured block on the bottom layer (pureRects=%s)",
    async (pureRects) => {
      const capture = {
        format: "m0saic-page-skeleton" as const,
        version: 1 as const,
        viewport: { w: 100, h: 100 },
        rects: [
          { x: 10, y: 10, w: 30, h: 20, k: "image" as const, r: 4, d: 1 },
          { x: 0, y: 0, w: 100, h: 100, k: "block" as const, r: 0, d: 9 },
          { x: 55, y: 10, w: 30, h: 12, k: "control" as const, r: 6, d: 2 },
          { x: 0, y: 0, w: 10, h: 8, k: "text" as const, r: 0, d: 3 },
          { x: 90, y: 92, w: 10, h: 8, k: "text" as const, r: 0, d: 3 },
        ],
      };
      const doc = await render(
        {
          capture,
          behavior: { pureRects },
        },
        ctxFor(100, 100),
      );
      expect(isErrorMosaic(doc)).toBe(false);
      expect(captureIndexOf(doc.sources[0])).toBe(1);

      const parsed = parseM0StringComplete(String(doc.m0), 100, 100);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.ir.renderFrames[0]).toMatchObject({
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          paintOrder: 0,
        });
        const renderedEditorFrames = parsed.ir.renderFrames.map((frame) =>
          parsed.ir.editorFrames.find(
            (editor) => editor.meta.stableKey === frame.meta.stableKey,
          ),
        );
        expect(renderedEditorFrames[0]?.overlayDepth).toBe(0);
        expect(
          renderedEditorFrames
            .slice(1)
            .every((frame) => (frame?.overlayDepth ?? 0) > 0),
        ).toBe(true);
        expect(
          parsed.ir.renderFrames
            .map((frame, index) => ({ frame, index }))
            .filter(
              ({ frame }) =>
                frame.x === 0 &&
                frame.y === 0 &&
                frame.width === 100 &&
                frame.height === 100,
            )
            .map(({ index }) => index),
        ).toEqual([0]);
      }
    },
  );

  it("keeps backdrop containers static while pulsing content in sync", async () => {
    const capture = {
      format: "m0saic-page-skeleton" as const,
      version: 1 as const,
      viewport: { w: 100, h: 100 },
      rects: [
        { x: 0, y: 0, w: 100, h: 100, k: "block" as const, r: 0, d: 0 },
        { x: 10, y: 10, w: 30, h: 20, k: "image" as const, r: 4, d: 1 },
        { x: 55, y: 10, w: 30, h: 12, k: "control" as const, r: 6, d: 2 },
      ],
    };
    const doc = await render(
      {
        capture,
        outputFormat: "mp4",
        motion: {
          mode: "pulse",
          minOpacity: 0.5,
        },
      },
      ctxFor(100, 100),
    );
    const sourceForCaptureIndex = (index: number) =>
      doc.sources.find((source) => captureIndexOf(source) === index) as
        | { lavfi?: string }
        | undefined;

    expect(doc.format).toEqual({ kind: "video", container: "mp4" });
    expect(sourceForCaptureIndex(0)?.lavfi).toBeUndefined();
    expect(sourceForCaptureIndex(1)?.lavfi).toContain(
      ",fade=t=in:st=0:d=0.45:",
    );
    expect(sourceForCaptureIndex(1)?.lavfi).toContain(
      ",fade=t=out:st=0.45:d=0.45:",
    );
    expect(sourceForCaptureIndex(2)?.lavfi).toContain(
      ",fade=t=in:st=0:d=0.45:",
    );
    expect(sourceForCaptureIndex(2)?.lavfi).toContain(
      ",fade=t=out:st=0.45:d=0.45:",
    );
  });

  it("maps captured and uniform pixel radii to rounded and pill effects", () => {
    const rect = { w: 40, h: 20, r: 4 };
    expect(
      effectiveRadiusPx(rect, { radiusMode: "captured", uniformRadiusPx: 8 }),
    ).toBe(4);
    expect(
      effectiveRadiusPx(rect, { radiusMode: "uniform", uniformRadiusPx: 99 }),
    ).toBe(10);
    expect(
      effectiveRadiusPx(rect, { radiusMode: "none", uniformRadiusPx: 8 }),
    ).toBe(0);
    expect(roundingForRect(rect, 4)).toEqual({
      cornerStyle: "rounded",
      borderRadius: 0.4,
      rasterizer: "svg",
    });
    expect(roundingForRect(rect, 9)).toEqual({
      cornerStyle: "pill",
      rasterizer: "svg",
    });
    expect(
      overriddenRadiusPx(
        rect,
        { radiusMode: "captured", uniformRadiusPx: 8 },
        { i: 0, shape: "rect", radiusPx: 99 },
      ),
    ).toBe(0);
    expect(
      overriddenRadiusPx(
        rect,
        { radiusMode: "none", uniformRadiusPx: 0 },
        { i: 0, shape: "pill" },
      ),
    ).toBe(10);
  });

  it("parses object or JSON-string overrides and rejects ambiguous indices", () => {
    expect(
      [...parseRectOverrides('[{"i":2,"shape":"circle","fill":"#f00"}]', 3).values()],
    ).toEqual([{ i: 2, shape: "circle", fill: "#f00" }]);
    expect(parseRectOverrides([], 3)).toEqual(new Map());
    expect(() => parseRectOverrides([{ i: 3 }], 3)).toThrow(
      /outside capture\.rects/,
    );
    expect(() => parseRectOverrides([{ i: 1 }, { i: 1 }], 3)).toThrow(
      /duplicated/,
    );
    expect(() => parseRectOverrides([{ i: 0, radiusPx: -1 }], 3)).toThrow(
      /radiusPx/,
    );
  });

  it("uses distinct authored bases for text, image/control, and structural kinds", () => {
    const appearance = {
      bg: "#ffffff",
      fill: "#111111",
      textFill: "#222222",
      imageFill: "#333333",
      radiusMode: "captured" as const,
      uniformRadiusPx: 8,
    };
    expect(baseFillForKind("block", appearance)).toBe("#111111");
    expect(baseFillForKind("divider", appearance)).toBe("#111111");
    expect(baseFillForKind("text", appearance)).toBe("#222222");
    expect(baseFillForKind("image", appearance)).toBe("#333333");
    expect(baseFillForKind("control", appearance)).toBe("#333333");
  });

  it("softens containing blocks and shades deeper buckets deterministically", () => {
    expect(blendHexColors("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(
      shadedRectangleFill(
        { zBucket: 0, isSoftContainer: true },
        "#e2e2e2",
        "#ffffff",
      ),
    ).toBe("#fafafa");
    expect(shadedRectangleFill({ zBucket: 0 }, "#e2e2e2", "#ffffff")).toBe(
      "#f0f0f0",
    );
    expect(shadedRectangleFill({ zBucket: 5 }, "#e2e2e2", "#ffffff")).toBe(
      "#d0d0d0",
    );
  });

  it("accepts the JSON-string paste shape and applies appearance colors", async () => {
    const doc = await render({
      capture: JSON.stringify(SAMPLE_CAPTURE),
      appearance: { bg: "#101010", fill: "#555555" },
    });
    expect(isErrorMosaic(doc)).toBe(false);
    expect(doc.backgroundColor).toBe("#101010");
    expect(new Set(doc.sources.map((source) => (source as { color?: string }).color)).size).toBe(6);
  });

  it("filters kinds before the renderer-side cap", async () => {
    const doc = await render({
      capture: SAMPLE_CAPTURE,
      behavior: { showTextLines: false, maxRects: 12 },
    });
    expect(isErrorMosaic(doc)).toBe(false);
    expect(doc.sources).toHaveLength(12);
  });

  it("applies hide, exact fill, shape, and radius overrides by stable capture index", async () => {
    const capture = {
      format: "m0saic-page-skeleton" as const,
      version: 1 as const,
      viewport: { w: 100, h: 100 },
      rects: [
        { x: 0, y: 0, w: 40, h: 20, k: "block" as const, r: 0, d: 0 },
        { x: 50, y: 0, w: 40, h: 20, k: "image" as const, r: 0, d: 0 },
        { x: 0, y: 30, w: 40, h: 20, k: "control" as const, r: 0, d: 0 },
        { x: 0, y: 60, w: 60, h: 10, k: "text" as const, r: 0, d: 0 },
      ],
    };
    const doc = await render(
      {
        capture,
        overrides: JSON.stringify([
          { i: 0, fill: "#ff0000", shape: "pill" },
          { i: 1, hide: true },
          { i: 2, fill: "#00ff00", shape: "circle" },
          { i: 3, fill: "#0000ff", shape: "rounded", radiusPx: 4 },
        ]),
      },
      ctxFor(100, 100),
    );
    expect(isErrorMosaic(doc)).toBe(false);
    expect(doc.sources).toHaveLength(3);

    const sourceForCaptureIndex = (i: number) =>
      doc.sources.find((source) => captureIndexOf(source) === i);
    const pill = sourceForCaptureIndex(0) as {
      color?: string;
      effects?: { rounding?: { cornerStyle?: string } };
    };
    const circle = sourceForCaptureIndex(2) as {
      color?: string;
      effects?: { rounding?: { cornerStyle?: string } };
    };
    expect(pill.color).toBe("#ff0000");
    expect(pill.effects?.rounding?.cornerStyle).toBe("pill");
    expect(circle.color).toBe("#00ff00");
    expect(circle.effects?.rounding?.cornerStyle).toBe("pill");
    expect(sourceForCaptureIndex(1)).toBeUndefined();

    const text = sourceForCaptureIndex(3) as {
      color?: string;
      effects?: { rounding?: { cornerStyle?: string } };
      mask?: unknown;
    };
    expect(text.color).toBe("#0000ff");
    expect(text.effects?.rounding?.cornerStyle).toBe("pill");
    expect(text.mask).toBeUndefined();

    const parsed = parseM0StringComplete(String(doc.m0), 100, 100);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const circleSourceIndex = doc.sources.findIndex((source) => captureIndexOf(source) === 2);
      expect(parsed.ir.renderFrames[circleSourceIndex]).toMatchObject({
        x: 10,
        y: 30,
        width: 20,
        height: 20,
      });
    }
  });

  it("adds one tight top-layer vector label per rect when debugIndices is enabled", async () => {
    const doc = await render({
      ...(PageSkeleton.defaultProps as PageSkeletonV1Props),
      debugIndices: true,
    });
    expect(isErrorMosaic(doc)).toBe(false);
    expect(doc.sources).toHaveLength(128);
    const labelSources = doc.sources.filter(
      (source) =>
        (source as { mask?: { kind?: string } }).mask?.kind === "inline-mask",
    ) as {
      mask?: {
        bounds?: { width?: number; height?: number };
        localPath?: string;
      };
    }[];
    expect(labelSources).toHaveLength(64);
    expect(
      labelSources.every(
        (source) =>
          (source.mask?.localPath?.length ?? 0) > 0 &&
          (source.mask?.bounds?.width ?? 0) < 100 &&
          (source.mask?.bounds?.height ?? 0) < 100,
      ),
    ).toBe(true);
    const parsed = parseM0StringComplete(String(doc.m0), 1440, 900);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(
        parsed.ir.renderFrames.some(
          (frame) =>
            frame.x === 0 &&
            frame.y === 0 &&
            frame.width === 1440 &&
            frame.height === 900,
        ),
      ).toBe(false);
    }
  });

  it("runs the zero-drift geometry contract at an awkward target size", async () => {
    // ⭐ Two renders, one question each. With `debug: true` a PASSING contract
    // returns the wireframe VISUALISATION rather than the doc it checked
    // (withGeometryContract, 2026-08-20), so the wireframe carries the stamp
    // but NOT the original doc's own `editor.label`.
    const debugDoc = await render(
      { ...PageSkeleton.defaultProps, debug: true },
      ctxFor(1000, 700),
    );
    expect(isErrorMosaic(debugDoc)).toBe(false);
    expect(debugDoc.editor?.geometryContract).toMatchObject({
      ok: true,
      templateId: "@m0saic/web/page-skeleton/v1",
      canvas: { w: 1000, h: 700 },
      expectationCount: 64,
    });

    // `editor.label` is itself gated on `debug`, and withGeometryContract now
    // carries it onto the wireframe — so the debug render is the ONLY place it
    // can be asserted.
    expect(debugDoc.editor?.label).toContain("64 rects");
    expect(debugDoc.editor?.label).toContain("64 independent sources");
    expect(debugDoc.editor?.label).toContain("0 debug labels");
  });

  it("emits exact pure DSL cells with no placement insets when opted in", async () => {
    const common: PageSkeletonV1Props = {
      ...(PageSkeleton.defaultProps as PageSkeletonV1Props),
      behavior: {
        ...((PageSkeleton.defaultProps?.behavior ?? {}) as PageSkeletonV1Props["behavior"]),
        showTextLines: false,
      },
    };
    const insetDoc = await render(common);
    const pureProps: PageSkeletonV1Props = {
      ...common,
      behavior: { ...common.behavior, pureRects: true },
    };
    // Real doc for the source/m0/label assertions below; a separate debug twin
    // for the contract stamp, since debug returns the wireframe on a PASS.
    const pureDoc = await render(pureProps);
    const pureDebug = await render({ ...pureProps, debug: true });
    expect(isErrorMosaic(pureDoc)).toBe(false);
    expect(
      insetDoc.sources.some(
        (source) =>
          (
            source as {
              placement?: { inset?: unknown };
            }
          ).placement?.inset != null,
      ),
    ).toBe(true);
    expect(
      pureDoc.sources.every(
        (source) =>
          (
            source as {
              placement?: { inset?: unknown };
            }
          ).placement?.inset == null,
      ),
    ).toBe(true);
    expect(String(pureDoc.m0).length).toBeGreaterThan(String(insetDoc.m0).length);
    expect(pureDebug.editor?.geometryContract).toMatchObject({
      ok: true,
      expectationCount: 40,
    });
    expect(pureDebug.editor?.label).toContain("pure DSL rects");

    const parsed = parseM0StringComplete(String(pureDoc.m0), 1440, 900);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      pureDoc.sources.forEach((source, sourceIndex) => {
        const captureIndex = captureIndexOf(source);
        if (captureIndex === undefined) return;
        const captured = SAMPLE_CAPTURE.rects[captureIndex];
        expect(parsed.ir.renderFrames[sourceIndex]).toMatchObject({
          x: captured.x,
          y: captured.y,
          width: captured.w,
          height: captured.h,
        });
      });
    }
  });

  it("makes maxRects a literal cap on independently placed sources", async () => {
    const capture = {
      format: "m0saic-page-skeleton" as const,
      version: 1 as const,
      viewport: { w: 100, h: 100 },
      rects: Array.from({ length: 220 }, (_, i) => ({
        x: i % 7,
        y: (i * 3) % 5,
        w: 92,
        h: 92,
        k: i % 2 === 0 ? ("block" as const) : ("text" as const),
        r: i % 2 === 0 ? 12 : 6,
        d: i % 6,
      })),
    };
    // No `debug` here: every assertion below is about the REAL doc (its 30
    // sources, capture bindings, label and m0), and debug would swap in the
    // contract wireframe.
    const doc = await render(
      { capture, behavior: { maxRects: 30 } },
      ctxFor(100, 100),
    );
    expect(isErrorMosaic(doc)).toBe(false);
    expect(doc.sources).toHaveLength(30);
    const atlasSources = doc.sources.filter(
      (source) =>
        (source as { mask?: { kind?: string } }).mask?.kind === "inline-mask",
    );
    expect(atlasSources).toHaveLength(0);
    // Capture-index BINDINGS were deliberately dropped (page-skeleton.ts:727 —
    // "rejected by every host as kind-required"); bindings now name a leaf by
    // path. The per-rect identity lives in `editor.label`, which is what
    // `captureIndexOf` reads.
    const captureIndices = doc.sources.map(captureIndexOf);
    expect(new Set(captureIndices).size).toBe(30);

    // Label is debug-gated, and debug swaps in the contract wireframe (34
    // sources), so it cannot answer the source questions above. Separate twin.
    const debugDoc = await render(
      { capture, behavior: { maxRects: 30 }, debug: true },
      ctxFor(100, 100),
    );
    expect(debugDoc.editor?.label).toContain("30 rects");
    expect(debugDoc.editor?.label).toContain("30 independent sources");
    expect(debugDoc.editor?.label).toContain("0 debug labels");
    const parsed = parseM0StringComplete(String(doc.m0), 100, 100);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.ir.renderFrames).toHaveLength(30);
  });

  it("returns a renderable error mosaic for malformed capture JSON", async () => {
    const doc = await render({ capture: "{" });
    expect(isErrorMosaic(doc)).toBe(true);
    expect(
      (doc.sources[0] as { engine?: { renderError?: { code?: string } } }).engine
        ?.renderError?.code,
    ).toBe("PAGE_SKELETON_CAPTURE");
    expect(validateM0String(String(doc.m0)).ok).toBe(true);
  });

  it("validates video motion but ignores dormant motion for PNG output", async () => {
    const invalidMotion = {
      mode: "shimmer" as const,
      bandWidth: 0.01,
    };
    const video = await render({
      capture: SAMPLE_CAPTURE,
      outputFormat: "mp4",
      motion: invalidMotion,
    });
    expect(isErrorMosaic(video)).toBe(true);
    expect(
      (video.sources[0] as { engine?: { renderError?: { message?: string } } }).engine
        ?.renderError?.message,
    ).toMatch(/motion\.bandWidth/);

    const still = await render({
      capture: SAMPLE_CAPTURE,
      outputFormat: "png",
      motion: invalidMotion,
    });
    expect(isErrorMosaic(still)).toBe(false);
    expect(still.format).toEqual({ kind: "image", container: "png" });
  });

  it("returns a renderable error mosaic for an override outside the capture", async () => {
    const doc = await render({
      capture: SAMPLE_CAPTURE,
      overrides: [{ i: SAMPLE_CAPTURE.rects.length }],
    });
    expect(isErrorMosaic(doc)).toBe(true);
    expect(
      (doc.sources[0] as { engine?: { renderError?: { message?: string } } }).engine
        ?.renderError?.message,
    ).toMatch(/outside capture\.rects/);
  });

  it("fails fast with a renderable error mosaic when no visible rect remains", async () => {
    const doc = await render({
      capture: {
        format: "m0saic-page-skeleton",
        version: 1,
        viewport: { w: 100, h: 100 },
        rects: [],
      },
    });
    expect(isErrorMosaic(doc)).toBe(true);
    expect(validateM0String(String(doc.m0)).ok).toBe(true);
  });

  it("is JSON-identical for identical props and context", async () => {
    expect(JSON.stringify(await render())).toBe(JSON.stringify(await render()));
  });
});

describe("@m0saic/web/page-skeleton/v1 — prop bindings (bindingsSound convention)", () => {
  const capture = {
    format: "m0saic-page-skeleton" as const,
    version: 1 as const,
    viewport: { w: 100, h: 100 },
    rects: [
      { x: 10, y: 10, w: 30, h: 20, k: "image" as const, r: 4, d: 1 },
      { x: 0, y: 0, w: 100, h: 100, k: "block" as const, r: 0, d: 9 },
      { x: 55, y: 10, w: 30, h: 12, k: "control" as const, r: 6, d: 2 },
    ],
  };
  const bindingOf = (doc: MosaicDocument, i: number) =>
    (doc.sources.find((s) => captureIndexOf(s) === i) as { editor?: { binding?: unknown } } | undefined)
      ?.editor?.binding;

  it("binds an overridden rect's fill to ITS overrides row; a rect without a row carries no binding", async () => {
    const doc = await render(
      { capture, overrides: [{ i: 2, fill: "#ff0000" }, { i: 0, shape: "pill" }] },
      ctxFor(100, 100),
    );
    expect(isErrorMosaic(doc)).toBe(false);
    expect(bindingOf(doc, 2)).toEqual({ propKey: "overrides", path: [0, "fill"], kind: "color" });
    // Row exists (shape only) → its `fill` leaf is the "add" handle.
    expect(bindingOf(doc, 0)).toEqual({ propKey: "overrides", path: [1, "fill"], kind: "color" });
    expect(bindingOf(doc, 1)).toBeUndefined();

    const resolved = resolvePropBindings(doc, 100, 100, { propsSchema: PageSkeleton.propsSchema });
    expect(resolved.rejected).toEqual([]);
    expect(resolved.byProp.overrides).toHaveLength(2);
  });

  it("at the defaults (no override rows) nothing is bound and nothing is rejected", async () => {
    const doc = await render({ capture }, ctxFor(100, 100));
    const resolved = resolvePropBindings(doc, 100, 100, { propsSchema: PageSkeleton.propsSchema });
    expect(resolved.rejected).toEqual([]);
    expect(resolved.byProp).toEqual({});
  });
});
