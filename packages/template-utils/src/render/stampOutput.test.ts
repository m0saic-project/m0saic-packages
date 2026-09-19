import { stampRenderableOutput, type StampSource } from "./stampOutput";
import type {
    MosaicDocument,
    MosaicDocumentPipeline,
} from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";

describe("stampRenderableOutput", () => {
    const src: StampSource = {
        width: 1920,
        height: 1080,
        fps: 60,
        durationMs: 5000,
        target: "web-mp4",
    };

    test("stamps full output onto mosaic_document", () => {
        const doc: MosaicDocument = {
            kind: "mosaic_document",
            version: 1,
            assets: {} as any,
            m0: toM0String("F", "test"),
            sources: [] as any,
            fps: 24,
            durationMs: 1000,
        };

        const out = stampRenderableOutput(doc, src);

        expect(out.kind).toBe("mosaic_document");
        if (out.kind !== "mosaic_document") throw new Error("expected document");

        expect(out.size).toEqual({ width: 1920, height: 1080 });
        expect(out.fps).toBe(60);
        // Gate 26: an AUTHORED doc durationMs is deliberate (source-follow)
        // and survives the stamp — the pipeline precedent extended to
        // documents. Size/fps/target still stamp from the resolved output.
        expect(out.durationMs).toBe(1000);
        expect(out.target).toBe("web-mp4");
    });

    test("stamps pipeline-level fields and stamps inline step docs with step duration", () => {
        // emit:multi heterogeneous-output pipelines (e.g. aspect-safe-
        // grid landscape + portrait variants) carry per-step canvases
        // and fps. The step-aware stamp preserves whatever the
        // template authored on step.file.{size,fps} and ALWAYS stamps
        // step.durationMs from the step (the file's own durationMs is
        // a stale-from-render-time artifact that gets overwritten).
        // When the template DIDN'T set size/fps on step.file, the src
        // values fill in (back-compat with screencap_grid where the
        // step.file inherits ctx.target).
        const pipe: MosaicDocumentPipeline = {
            kind: "mosaic_pipeline",
            version: 1,
            fps: 24,
            steps: [
                { durationMs: 1000, ref: "a" },
                {
                    // Step authors explicit size + fps — preserved.
                    durationMs: 2000,
                    file: {
                        kind: "mosaic_document",
                        version: 1,
                        assets: {} as any,
                        m0: toM0String("F", "test"),
                        sources: [] as any,
                        size: { width: 1080, height: 1920 },
                        fps: 24,
                        durationMs: 999,
                    },
                },
                {
                    // Step authors no size/fps — src fills in (back-
                    // compat with the screencap_grid flow).
                    durationMs: 2000,
                    file: {
                        kind: "mosaic_document",
                        version: 1,
                        assets: {} as any,
                        m0: toM0String("F", "test"),
                        sources: [] as any,
                    },
                },
            ],
        };

        const out = stampRenderableOutput(pipe, src);

        expect(out.kind).toBe("mosaic_pipeline");
        if (out.kind !== "mosaic_pipeline") throw new Error("expected pipeline");

        // Pipeline-level size/target stamped from src; fps follows the
        // authored-intent rule (resolveStampedPipelineFps) — this pipe
        // authored 24, so 24 survives the stamp.
        expect(out.size).toEqual({ width: 1920, height: 1080 });
        expect(out.fps).toBe(24);
        expect(out.target).toBe("web-mp4");

        // step[0] is ref-only: unchanged aside from being present
        expect(out.steps[0].durationMs).toBe(1000);

        // step[1] authored size + fps → PRESERVED. durationMs ALWAYS
        // comes from the step (overwrites the file's stale 999).
        const s1 = out.steps[1];
        if (!("file" in s1) || s1.file === undefined) {
            throw new Error("expected inline step");
        }
        expect(s1.file.fps).toBe(24);
        expect(s1.file.durationMs).toBe(2000);
        expect(s1.file.size).toEqual({ width: 1080, height: 1920 });

        // step[2] no authored size/fps → src fills in.
        const s2 = out.steps[2];
        if (!("file" in s2) || s2.file === undefined) {
            throw new Error("expected inline step");
        }
        expect(s2.file.fps).toBe(60);
        expect(s2.file.durationMs).toBe(2000);
        expect(s2.file.size).toEqual({ width: 1920, height: 1080 });
    });

    test("preserves a step's authored format; stamps the global onto format-silent steps", () => {
        // emit:multi MIXED deliverables: a template authors a PNG format on
        // its cover step while the render target (src.format) is video/mp4.
        // The stamp must NOT clobber the step's own format — the planner
        // needs it to plan an IMAGE graph for that step. Steps without an
        // authored format keep inheriting the global (back-compat).
        const mkFile = (format?: any): MosaicDocument =>
            ({
                kind: "mosaic_document",
                version: 1,
                assets: {} as any,
                m0: toM0String("F", "fmt"),
                sources: [] as any,
                fps: 30,
                durationMs: 1000,
                ...(format ? { format } : {}),
            }) as any;

        const pipe: MosaicDocumentPipeline = {
            kind: "mosaic_pipeline",
            version: 1,
            emit: "multi",
            steps: [
                { name: "cover", durationMs: 1, file: mkFile({ kind: "image", container: "png" }) },
                { name: "summary", durationMs: 1500, file: mkFile() },
            ],
        } as any;

        const out = stampRenderableOutput(pipe, {
            ...src,
            format: { kind: "video", container: "mp4" } as any,
        });
        if (out.kind !== "mosaic_pipeline") throw new Error("expected pipeline");

        const cover = (out.steps[0] as any).file;
        const summary = (out.steps[1] as any).file;
        expect(cover.format).toEqual({ kind: "image", container: "png" });
        expect(summary.format).toEqual({ kind: "video", container: "mp4" });
    });

    test("preserves step authoring fields (name, label, intermediate) when stamping", () => {
        // emit:multi pipelines rely on step.name + step.label to drive
        // per-file naming via --output-pattern. Earlier the stamp helper
        // returned `{durationMs, transitionToNext, file}` only and silently
        // dropped name/label/intermediate. Guard against that regression.
        const pipe: MosaicDocumentPipeline = {
            kind: "mosaic_pipeline",
            version: 1,
            emit: "multi",
            fps: 60,
            steps: [
                {
                    name: "step_one",
                    label: "vacation",
                    durationMs: 2000,
                    file: {
                        kind: "mosaic_document",
                        version: 1,
                        assets: {} as any,
                        m0: toM0String("F", "t"),
                        sources: [] as any,
                        fps: 60,
                        durationMs: 2000,
                    },
                },
                {
                    name: "header",
                    intermediate: true,
                    durationMs: 500,
                    file: {
                        kind: "mosaic_document",
                        version: 1,
                        assets: {} as any,
                        m0: toM0String("F", "h"),
                        sources: [] as any,
                        fps: 60,
                        durationMs: 500,
                    },
                },
            ],
        };

        const out = stampRenderableOutput(pipe, src);
        if (out.kind !== "mosaic_pipeline") throw new Error("expected pipeline");

        const s0 = out.steps[0] as any;
        expect(s0.name).toBe("step_one");
        expect(s0.label).toBe("vacation");

        const s1 = out.steps[1] as any;
        expect(s1.name).toBe("header");
        expect(s1.intermediate).toBe(true);
    });

    describe("pipeline durationMs", () => {
        const mkDoc = (): MosaicDocument => ({
            kind: "mosaic_document",
            version: 1,
            assets: {} as any,
            m0: toM0String("F", "test"),
            sources: [] as any,
        });

        const stampPipe = (
            pipe: MosaicDocumentPipeline,
            over: Partial<StampSource> = {},
        ): MosaicDocumentPipeline => {
            const out = stampRenderableOutput(pipe, { ...src, ...over });
            if (out.kind !== "mosaic_pipeline") throw new Error("expected pipeline");
            return out;
        };

        test("stamps the NATURAL duration, not the render target", () => {
            // 5000 target, but the pipeline only stitches to 3000.
            const out = stampPipe({
                kind: "mosaic_pipeline",
                version: 1,
                steps: [
                    { durationMs: 1500, file: mkDoc() },
                    { durationMs: 1500, file: mkDoc() },
                ],
            });
            expect(out.durationMs).toBe(3000);
        });

        test("subtracts transition overlap — the ffmpeg-pulse drift", () => {
            // Two 1500ms steps joined by a 500ms crossfade render 2500ms.
            // Stamping the target (5000) or the plain sum (3000) would
            // both be a lie about the file's own length.
            const out = stampPipe({
                kind: "mosaic_pipeline",
                version: 1,
                steps: [
                    {
                        durationMs: 1500,
                        file: mkDoc(),
                        transitionToNext: { type: "fade", durationMs: 500 },
                    },
                    { durationMs: 1500, file: mkDoc() },
                ],
            });
            expect(out.durationMs).toBe(2500);
        });

        test("preserves a duration the template declared itself (authoring intent)", () => {
            const out = stampPipe({
                kind: "mosaic_pipeline",
                version: 1,
                durationMs: 4000,
                steps: [
                    { durationMs: 1500, file: mkDoc() },
                    { durationMs: 1500, file: mkDoc() },
                ],
            });
            expect(out.durationMs).toBe(4000);
        });

        test("ignores a structurally invalid declared duration", () => {
            const out = stampPipe({
                kind: "mosaic_pipeline",
                version: 1,
                durationMs: Infinity,
                steps: [{ durationMs: 3000, file: mkDoc() }],
            });
            expect(out.durationMs).toBe(3000);
        });

        test("preserves a pipeline fps the template declared itself (source-follow)", () => {
            // The gate-20 fps bug: highlights authors pipeline.fps from the
            // probed source (60fps footage); stamping ctx.target.fps (30)
            // over it silently resampled every cut. Same authored-intent
            // rule as durationMs above.
            const out = stampPipe({
                kind: "mosaic_pipeline",
                version: 1,
                emit: "multi",
                fps: 60,
                steps: [{ durationMs: 1500, file: mkDoc() }],
            });
            expect(out.fps).toBe(60);
        });

        test("stamps the resolved target fps when the template declared none", () => {
            const out = stampPipe({
                kind: "mosaic_pipeline",
                version: 1,
                steps: [{ durationMs: 1500, file: mkDoc() }],
            });
            expect(out.fps).toBe(src.fps);
        });

        test("keeps the resolved target under emit:multi (inert, but must be present)", () => {
            // A fan-out emits one file per step; the pipeline-level field
            // means nothing, yet a serialized pipeline must still carry
            // one (SERIALIZED_DOC_MISSING_DURATIONMS).
            const out = stampPipe({
                kind: "mosaic_pipeline",
                version: 1,
                emit: "multi",
                steps: [
                    { durationMs: 1500, file: mkDoc() },
                    { durationMs: 1500, file: mkDoc() },
                ],
            });
            expect(out.durationMs).toBe(5000);
        });

        test("degrades a size-mismatched boundary to a cut, like the planner", () => {
            // xfade needs equal dimensions; the boundary drops to a cut,
            // so no overlap is subtracted.
            const portrait: MosaicDocument = { ...mkDoc(), size: { width: 1080, height: 1920 } };
            const out = stampPipe({
                kind: "mosaic_pipeline",
                version: 1,
                steps: [
                    {
                        durationMs: 1500,
                        file: portrait,
                        transitionToNext: { type: "fade", durationMs: 500 },
                    },
                    { durationMs: 1500, file: mkDoc() },
                ],
            });
            expect(out.durationMs).toBe(3000);
        });
    });
});

describe("gate-26: document authored durationMs precedence", () => {
  const SRC = { width: 1280, height: 720, fps: 30, durationMs: 10000 };
  const baseDoc = {
    kind: "mosaic_document" as const,
    version: 1 as const,
    m0: "F" as never,
    assets: {} as never,
    sources: [],
  };

  it("a doc that authors durationMs keeps it (source-follow)", () => {
    const out = stampRenderableOutput({ ...baseDoc, durationMs: 596000 }, SRC);
    expect((out as { durationMs?: number }).durationMs).toBe(596000);
    expect((out as { fps?: number }).fps).toBe(30);
  });

  it("a doc with no authored duration stamps from the resolved target", () => {
    const out = stampRenderableOutput({ ...baseDoc }, SRC);
    expect((out as { durationMs?: number }).durationMs).toBe(10000);
  });
});

describe("gate-28 canvas law: authored size survives the stamp", () => {
  const SRC = { width: 1280, height: 720, fps: 30, durationMs: 10000 };
  const baseDoc = {
    kind: "mosaic_document" as const,
    version: 1 as const,
    m0: "F" as never,
    assets: {} as never,
    sources: [],
  };

  it("a doc that authors size keeps it (the HOST decides plan dims)", () => {
    const out = stampRenderableOutput(
      { ...baseDoc, size: { width: 544, height: 544 } },
      SRC,
    );
    expect((out as { size?: object }).size).toEqual({ width: 544, height: 544 });
  });

  it("a doc authoring nothing gets the resolved target (every root doc carries size)", () => {
    const out = stampRenderableOutput({ ...baseDoc }, SRC);
    expect((out as { size?: object }).size).toEqual({ width: 1280, height: 720 });
  });
});
