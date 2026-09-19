import type { MosaicDocument, MosaicDocumentPipeline, MosaicEngineContext } from "@m0saic/types";
import { isValidM0String, parseM0StringToLogicalFrames } from "@m0saic/dsl";
import { requireTemplate } from "@m0saic/template-utils";
import "../../../index";
import { captionBandHeight, frameLayout, tileRectInStage } from "./pipeline";

const T = requireTemplate("@m0saic/brand/community-m/v1");
const makeCtx = (w = 1280, h = 720, pinned?: number): MosaicEngineContext =>
  ({ mode: "render", target: { width: w, height: h, fps: 30, durationMs: 10000 }, output: { width: w, height: h, fps: 30, durationMs: 10000, workspaceDir: "/tmp/community-m-test" }, media: {}, ...(pinned ? { userIntent: { durationMs: pinned } } : {}) }) as unknown as MosaicEngineContext;

describe("frame layout", () => {
  it("carves the stage over two caption rows, pixel-exact, and places the tile", () => {
    const l = frameLayout(3840, 2160);
    expect(isValidM0String(l.m0)).toBe(true);
    expect(l.stageH + 2 * l.capH).toBe(2160);
    expect(l.side).toBe(1904);
    // ~4.5 % of the frame, nudged to share a factor with it: the split is 45
    // slots, not 2160 (the planner's px-per-weight floor), and still exact.
    expect(captionBandHeight(2160)).toBe(96);
    expect(captionBandHeight(720)).toBe(32);
    expect(l.capH).toBe(96);
    expect(parseM0StringToLogicalFrames(l.m0, 3840, 2160).map((f) => f.height)).toEqual([1968, 96, 96]);
    const tip = tileRectInStage(32, l);
    expect(tip.width).toBeCloseTo(350);
    expect(tip.height).toBeCloseTo(238);
    expect(tip.x).toBeGreaterThan(1500); expect(tip.x).toBeLessThan(2000);
  });
});

describe("@m0saic/brand/community-m/v1 (registered)", () => {
  it("renders the seed at defaults as an emit:single pipeline whose stitched length equals its authored duration", async () => {
    const out = (await T.render({} as never, makeCtx())) as MosaicDocumentPipeline;
    expect(out.kind).toBe("mosaic_pipeline");
    expect(out.emit).toBe("single");
    expect(out.steps.map((s) => s.name)).toEqual(["intro", "reveal", "piece", "return", "outro", "closer"]);
    const overlaps = out.steps.reduce((n, s) => n + (s.transitionToNext?.type === "fade" ? s.transitionToNext.durationMs : 0), 0);
    const stitched = out.steps.reduce((n, s) => n + s.durationMs, 0) - overlaps;
    expect(stitched).toBe(out.durationMs);
    expect(out.durationMs).toBe(2400 + 1800 + 600 + 2 * (2000 + 900) + 4000 + 2000 + 2500); // seed piece = 4000 ms
    for (const s of out.steps) {
      const d = s.file as MosaicDocument;
      expect(d.size).toEqual({ width: 1280, height: 720 });
      expect(d.fps).toBe(30);
      expect(d.durationMs).toBe(s.durationMs);
      expect(isValidM0String(d.m0)).toBe(true);
    }
    // The intro sits on the brand field with the Home plate over it: canvas,
    // the field and the plate (both fading out over the dolly, so the cut into
    // the reveal is clean), then the rows — the stage with the camera and the
    // two identity captions.
    const intro = out.steps[0].file as MosaicDocument;
    expect(intro.m0.startsWith("1{1{1{")).toBe(true);
    expect(intro.sources.length).toBe(6);
    expect((intro.sources[0] as { type: string }).type).toBe("lavfi");
    const fieldLayer = intro.sources[1] as { type: string; ref?: string; overlay?: { alpha?: string } };
    expect(fieldLayer.ref).toBe("field");
    // Gone by the time the dolly starts (2.4 s): the fade runs over the last 0.7 s of the hold.
    expect(fieldLayer.overlay?.alpha).toContain("1.70000");
    expect(fieldLayer.overlay?.alpha).toContain("2.40000");
    expect(fieldLayer.overlay?.alpha).not.toContain("4.20000");
    const field = intro.children?.field as MosaicDocument;
    expect(field.size).toEqual({ width: 1280, height: 720 });
    expect(field.backgroundColor).toBeUndefined(); // transparent: only the rects paint
    expect(field.sources.length).toBeGreaterThan(20);
    expect(new Set(field.sources.map((f) => (f as { color?: string }).color)).size).toBe(1); // one tint
    const plate = intro.sources[2] as { type: string; color?: string; placement?: { inset?: { x: number; y: number } }; overlay?: { alpha?: string; xExpr?: string; yExpr?: string }; effects?: { rounding?: unknown; stroke?: unknown } };
    expect(plate.type).toBe("lavfi");
    expect(plate.color).toBe("#0E1220"); // the canvas colour — the plate is where the field is absent
    expect(plate.effects?.rounding).toBeDefined();
    expect(plate.effects?.stroke).toBeDefined();
    expect(plate.placement?.inset?.y).toBe(0); // full frame height: a column around the M
    expect(plate.placement?.inset?.x).toBeGreaterThan(0.1);
    expect(plate.overlay?.alpha).toBe(fieldLayer.overlay?.alpha); // fades with the field
    expect((intro.sources[3] as { effects?: { camera?: unknown } }).effects?.camera).toBeDefined();
    const stage = intro.children?.stage as MosaicDocument;
    expect(stage.size?.width).toBe(1280);
    const mark = stage.children?.mark as MosaicDocument;
    expect(mark.size).toEqual({ width: 544, height: 544 });
    expect(mark.sources.length).toBe(2); // tiles + the claimed-edge layer
    expect((mark.children?.tiles as MosaicDocument).sources.length).toBe(33);
    // The reveal dissolves the parked frame into the original (which then slides aside).
    const reveal = out.steps[1].file as MosaicDocument;
    expect(reveal.m0).toBe("1{1{1}}");
    const photo = reveal.sources[2] as { placement?: { inset?: { left: number } }; overlay?: { alpha?: string; xExpr?: string } };
    expect(photo.overlay?.alpha).toContain("1.00000");
    expect(photo.overlay?.xExpr).toContain("gte(t,2.00000)");
    expect((reveal.children?.framed as MosaicDocument).size).toEqual({ width: 1280, height: 720 });
    // The piece step parks the original and pops the contributor doc (own size) via a camera on the padded wrapper.
    const piece = out.steps[2].file as MosaicDocument;
    const wrapper = piece.children?.canvas as MosaicDocument;
    expect((wrapper.children?.piece as MosaicDocument).size).toEqual({ width: 1080, height: 1080 }); // the seed piece's own canvas
    expect((piece.sources[2] as { effects?: { camera?: { zoom?: string } } }).effects?.camera?.zoom).toContain("gte(t,0.00000)");
    // The return slides back and dissolves into the parked frame.
    const ret = out.steps[3].file as MosaicDocument;
    expect((ret.sources[2] as { overlay?: { xExpr?: string } }).overlay?.xExpr).toContain("lt(t,0.00000)");
    // The closer is the outro's frame ON the brand field: the same row split
    // as the top layer (the logo M in the same stage cell at the same side, so
    // the tiles dissolve in place), the wordmark where the identity line was,
    // the repo where the tile line was — and the field under it, brought in
    // by the outro → closer crossfade.
    const outro = out.steps[4].file as MosaicDocument;
    const closer = out.steps[5].file as MosaicDocument;
    expect(closer.m0).toBe(`1{1{1{${outro.m0}}}}`);
    expect(closer.sources.length).toBe(6);
    expect((closer.sources[1] as { ref?: string }).ref).toBe("field");
    expect((closer.sources[1] as { overlay?: unknown }).overlay).toBeUndefined(); // full on, no fade of its own
    expect((closer.sources[2] as { overlay?: { alpha?: string } }).overlay?.alpha).toBeUndefined(); // the plate too
    expect((closer.children?.field as MosaicDocument).sources.length).toBe((intro.children?.field as MosaicDocument).sources.length);
    const closerStage = closer.children?.stage as MosaicDocument;
    expect(closerStage.m0).toBe((outro.children?.stage as MosaicDocument).m0);
    expect(closerStage.size).toEqual((outro.children?.stage as MosaicDocument).size);
    const logo = closerStage.children?.mark as MosaicDocument;
    expect(logo.size).toEqual({ width: 544, height: 544 });
    expect(logo.sources.length).toBe(33); // every tile the accent, no claims, no edge layer
    expect(new Set(logo.sources.map((s) => (s as { color?: string }).color))).toEqual(new Set(["#f97316"]));
    const wordmark = closer.children?.wordmark as MosaicDocument;
    expect(wordmark.size).toEqual({ width: 1280, height: 32 });
    expect(wordmark.sources.length).toBe(2);
    expect(JSON.stringify(closer.sources[5])).toContain("github.com/");
  });

  it("honours a pinned duration and refuses an impossible one with an error card", async () => {
    const pinned = (await T.render({} as never, makeCtx(1280, 720, 8000))) as MosaicDocumentPipeline;
    expect(pinned.durationMs).toBe(8000);
    const card = (await T.render({} as never, makeCtx(1280, 720, 700))) as MosaicDocument;
    expect(card.kind).toBe("mosaic_document");
  });

  it("renders on a small canvas — the closer shares the framed stage, so the mark's 272 floor is met once for every beat", async () => {
    const out = (await T.render({} as never, makeCtx(640, 360))) as MosaicDocumentPipeline;
    expect(out.kind).toBe("mosaic_pipeline");
    for (const s of out.steps) expect(isValidM0String((s.file as MosaicDocument).m0)).toBe(true);
  });

  it("dev preview levers fill the M, retarget the tile and swap the canvas", async () => {
    const out = (await T.render({ preview: { claims: 33, tile: 12, piece: "bars", aspect: "9:16" } } as never, makeCtx())) as MosaicDocumentPipeline;
    const intro = out.steps[0].file as MosaicDocument;
    const tiles = ((intro.children?.stage as MosaicDocument).children?.mark as MosaicDocument).children?.tiles as MosaicDocument;
    // Every tile is now a picture, and the stand-ins are inline (no files on disk).
    expect(tiles.sources.filter((s) => (s as { type: string }).type === "media").length).toBe(33);
    expect(Object.values(tiles.assets ?? {}).filter((a) => (a as { kind: string }).kind === "data-uri").length).toBe(32);
    // The subject lever is a CLAIM NUMBER in award order (what the Community page
    // lists), not a geometry index: claim 12 of M #001 is geometry tile 21
    // (claimOrder[11]), and the caption says both. The generated canvas is portrait.
    const piece = ((out.steps[2].file as MosaicDocument).children?.canvas as MosaicDocument).children?.piece as MosaicDocument;
    expect(piece.size).toEqual({ width: 1080, height: 1920 });
    expect(JSON.stringify(intro.sources)).toContain("tile 21 - claim 12 of 32 - preview stand-in");
  });

  it("error cards for a bad target and a tiny canvas", async () => {
    const unclaimed = (await T.render({ tile: "1" } as never, makeCtx())) as MosaicDocument;
    expect(unclaimed.kind).toBe("mosaic_document");
    const tiny = (await T.render({} as never, makeCtx(300, 200))) as MosaicDocument;
    expect(tiny.kind).toBe("mosaic_document");
  });
});
