import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { MosaicDocument, MosaicDocumentPipeline, MosaicEngineContext } from "@m0saic/types";
import { isValidM0String, parseM0StringToLogicalFrames } from "@m0saic/dsl";
import { requireTemplate } from "@m0saic/template-utils";
import "../../../index";
import { resolvePages, STAND_IN_PAGES } from "./pages";
import { tiltFor } from "./page";
import { validateCommunityPiece, COMMUNITY_PIECE_DEFAULT_LIMITS } from "@m0saic/platform/communityM/node";
import { nestedOverlays } from "./document";
import { DEFAULT_PROPS, resolveProps } from "./props";

const T = requireTemplate("@m0saic/story/scrapbook/v1");
const ctx = (w = 1280, h = 720, pinned?: number): MosaicEngineContext =>
  ({
    mode: "render",
    target: { width: w, height: h, fps: 30, durationMs: 10000 },
    output: { width: w, height: h, fps: 30, durationMs: 10000, workspaceDir: "/tmp/scrapbook-test" },
    media: {},
    ...(pinned ? { userIntent: { durationMs: pinned } } : {}),
  }) as unknown as MosaicEngineContext;

/** Every document in the film, root and nested alike. */
function allDocs(d: MosaicDocument): MosaicDocument[] {
  return [d, ...Object.values(d.children ?? {}).flatMap((c) => allDocs(c as MosaicDocument))];
}

describe("scrapbook pages", () => {
  it("lays out stand-in pages until real photos arrive, then follows them", () => {
    const base = resolveProps({});
    if (!base.ok) throw new Error(base.errors.join());
    const blank = resolvePages(base.value);
    expect(blank.length).toBe(STAND_IN_PAGES);
    expect(blank.every((p) => p.standIn)).toBe(true);
    expect(blank.every((p) => p.note.length > 0)).toBe(true); // judged with words in it

    const withPhotos = resolveProps({ photos: ["/a.jpg", "/b.jpg", "/c.jpg"], notes: ["one", "", "three"] });
    if (!withPhotos.ok) throw new Error(withPhotos.errors.join());
    const pages = resolvePages(withPhotos.value);
    expect(pages.length).toBe(3);
    expect(pages.every((p) => !p.standIn)).toBe(true);
    // A missing note is a wordless page, never an error.
    expect(pages.map((p) => p.note)).toEqual(["one", "", "three"]);
    expect(pages[0].image).toEqual({ kind: "file", path: "/a.jpg" });
  });

  it("leans consecutive pages opposite ways, and not at all when tilt is 0", () => {
    expect(Math.sign(tiltFor(0, 2.2))).toBe(1);
    expect(Math.sign(tiltFor(1, 2.2))).toBe(-1);
    expect(Math.abs(tiltFor(0, 2.2))).toBeLessThanOrEqual(2.2);
    expect(tiltFor(3, 0)).toBe(0);
  });
});

describe("@m0saic/story/scrapbook/v1 (registered)", () => {
  it("renders at defaults: opening, a page each, closing — stitched to its authored length", async () => {
    const out = (await T.render({}, ctx())) as MosaicDocumentPipeline;
    expect(out.kind).toBe("mosaic_pipeline");
    expect(out.steps.map((s) => s.name)).toEqual(["open", "page-1", "page-2", "page-3", "page-4", "close"]);
    // No split may be expressed in pixel weights — that is one slot per
    // pixel, far past the planner's px-per-weight floor.
    for (const step of out.steps) {
      for (const d of allDocs(step.file as MosaicDocument)) {
        const slots = Number(/^(\d+)[[(]/.exec(String(d.m0))?.[1] ?? "1");
        expect(slots).toBeLessThanOrEqual(64);
      }
    }
    const overlaps = out.steps.reduce((n, s) => n + (s.transitionToNext?.type === "fade" ? s.transitionToNext.durationMs : 0), 0);
    expect(out.steps.reduce((n, s) => n + s.durationMs, 0) - overlaps).toBe(out.durationMs);
    expect(out.durationMs).toBe(2200 + 3600 * 4 + 2600);
    // Every document's m0 must emit exactly as many frames as it has sources.
    for (const step of out.steps) {
      for (const d of allDocs(step.file as MosaicDocument)) {
        expect(isValidM0String(d.m0)).toBe(true);
        expect(parseM0StringToLogicalFrames(d.m0, d.size!.width, d.size!.height).length).toBe(d.sources.length);
      }
    }
  });

  it("an empty closing subtitle drops its row rather than painting an empty box", async () => {
    const out = (await T.render({}, ctx())) as MosaicDocumentPipeline;
    const open = out.steps[0].file as MosaicDocument;
    const close = out.steps[out.steps.length - 1].file as MosaicDocument;
    expect(open.sources.length).toBe(3); // paper, headline, subtitle
    expect(close.sources.length).toBe(2); // paper, headline — no blank row
  });

  it("the print is nested twice: a white mount, inside a paper band that can turn", async () => {
    const out = (await T.render({}, ctx())) as MosaicDocumentPipeline;
    const page = out.steps[1].file as MosaicDocument;
    const band = page.children?.band as MosaicDocument;
    const print = band.children?.print as MosaicDocument;
    expect(band.backgroundColor).toBe(DEFAULT_PROPS.paperColor); // invisible when it turns
    expect(print.backgroundColor).toBe("#FBF8F1");
    expect(print.size?.width).toBe(print.size?.height); // a square mount takes either orientation
    const effects = (page.sources[0] as { effects?: { rotate?: number; camera?: unknown } }).effects;
    expect(typeof effects?.rotate).toBe("number");
    expect(effects?.camera).toBeDefined();
  });

  it("a music bed rides every step and picks up where the film has got to", async () => {
    const out = (await T.render({ music: "/bed.mp3" }, ctx())) as MosaicDocumentPipeline;
    const starts = out.steps.map((s) => {
      const doc = s.file as MosaicDocument;
      const audio = doc.sources.find((x) => (x as { mediaType?: string }).mediaType === "audio") as { playback?: { clipStartMs?: number } };
      return audio?.playback?.clipStartMs;
    });
    expect(starts).toEqual([0, 2200, 5800, 9400, 13000, 16600]);
    for (const step of out.steps) {
      const d = step.file as MosaicDocument;
      expect(parseM0StringToLogicalFrames(d.m0, d.size!.width, d.size!.height).length).toBe(d.sources.length);
    }
  });

  it("a pinned duration re-paces the pages instead of cutting the film off", async () => {
    const out = (await T.render({}, ctx(1280, 720, 12000))) as MosaicDocumentPipeline;
    expect(out.durationMs).toBe(12000);
    const card = (await T.render({}, ctx(1280, 720, 3000))) as MosaicDocument;
    expect(card.kind).toBe("mosaic_document"); // too short for four pages → an error card
  });

  it("nests one frame per source", () => {
    expect(nestedOverlays(1)).toBe("1");
    expect(nestedOverlays(3)).toBe("1{1{1}}");
    for (const n of [1, 2, 5, 13]) expect(parseM0StringToLogicalFrames(nestedOverlays(n), 100, 100).length).toBe(n);
  });

  it("refuses a canvas it cannot lay out, and bad props", async () => {
    expect(((await T.render({}, ctx(200, 200))) as MosaicDocument).kind).toBe("mosaic_document");
    const bad = resolveProps({ tilt: 99, paperColor: "cream" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join("\n")).toMatch(/tilt|paperColor/);
  });
});
