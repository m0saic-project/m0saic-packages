import type { MosaicDocument } from "@m0saic/types";
import { parseM0StringToLogicalFrames } from "@m0saic/dsl";
import { buildScrapbookDocument, DOCUMENT_MAX_PAGES, nestedOverlays } from "./document";
import { resolvePages } from "./pages";
import { resolveProps } from "./props";

/**
 * The single-document form is NOT offered by the template — it is blocked on
 * an engine defect (see `document.ts`). These tests keep it honest so it can
 * be switched on the day that is fixed, rather than rotting quietly.
 */
const plan = (photos: string[] = []) => {
  const r = resolveProps({ photos });
  if (!r.ok) throw new Error(r.errors.join());
  return { width: 1280, height: 720, fps: 30, props: r.value, pages: resolvePages(r.value) };
};

describe("buildScrapbookDocument (written, not shipped)", () => {
  it("is one document: paper, then a layer per beat, one frame each", () => {
    const doc = buildScrapbookDocument(plan());
    expect(doc.kind).toBe("mosaic_document");
    expect(doc.durationMs).toBe(2200 + 3600 * 4 + 2600);
    expect(doc.sources.length).toBe(7); // paper + opening + 4 pages + closing
    expect(Object.keys(doc.children ?? {})).toEqual(["layer0", "layer1", "layer2", "layer3", "layer4", "layer5"]);
    expect(parseM0StringToLogicalFrames(doc.m0, doc.size!.width, doc.size!.height).length).toBe(doc.sources.length);
  });

  it("every layer runs the whole film and is told when its own time starts", () => {
    const doc = buildScrapbookDocument(plan());
    for (const c of Object.values(doc.children ?? {})) expect((c as MosaicDocument).durationMs).toBe(doc.durationMs);
    // Page 2 begins after the opening and one page: 2.2 + 3.6 = 5.8s.
    const page2 = doc.children?.layer2 as MosaicDocument;
    const zoom = (page2.sources[0] as { effects?: { camera?: { zoom?: string } } }).effects?.camera?.zoom ?? "";
    expect(zoom).toContain("5.80000");
  });

  it("hands over with alpha alone — a window here corrupts the nested text", () => {
    const doc = buildScrapbookDocument(plan());
    const overlays = doc.sources.slice(1).map((s) => (s as { overlay?: Record<string, unknown> }).overlay ?? {});
    expect(overlays.every((o) => typeof o.alpha === "string")).toBe(true);
    expect(overlays.some((o) => "window" in o)).toBe(false);
    expect(new Set(overlays.map((o) => o.alpha)).size).toBe(6);
  });

  it("nests one frame per source", () => {
    expect(nestedOverlays(1)).toBe("1");
    expect(nestedOverlays(4)).toBe("1{1{1{1}}}");
    for (const n of [1, 2, 7]) expect(parseM0StringToLogicalFrames(nestedOverlays(n), 100, 100).length).toBe(n);
  });

  it("caps the page count, because every page is a layer alive throughout", () => {
    expect(DOCUMENT_MAX_PAGES).toBeGreaterThan(0);
    const many = plan(Array.from({ length: DOCUMENT_MAX_PAGES + 1 }, (_, i) => `/p${i}.jpg`));
    expect(many.pages.length).toBeGreaterThan(DOCUMENT_MAX_PAGES);
  });
});
