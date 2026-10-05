import type { MosaicDocument, MosaicDocumentPipeline } from "@m0saic/types";
import { ctxFor, entriesOn, handlesOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { ScrapbookV1 } from "../v1/scrapbook";
import { ScrapbookV2 } from "./scrapbook";

const D = ScrapbookV2.defaultProps as Record<string, unknown>;
const P1 = "/photos/one.jpg";
const P2 = "/photos/two.jpg";
const P3 = "/photos/three.jpg";
const MEDIA = { [P1]: { kind: "image", width: 1600, height: 1200 }, [P2]: { kind: "image", width: 1200, height: 1600 }, [P3]: { kind: "image", width: 1000, height: 1000 } };

vnextSuite({
  next: ScrapbookV2,
  prev: ScrapbookV1,
  cases: [
    { name: "three photos with notes", props: { photos: [P1, P2, P3], notes: ["one", "", "three"] }, media: MEDIA },
    { name: "still and square: no drift, no tilt, no page turn, music", props: { photos: [P1, P2], drift: 0, tilt: 0, xfadeMs: 0, music: "/audio/bed.mp3", inkColor: "#102030", accentColor: "#22aa66", paperColor: "#FFFFFF" }, media: MEDIA },
    { name: "no opening, no closing, portrait", props: { introMs: 0, outroMs: 0 }, w: 1080, h: 1920 },
  ],
  bound: ["accentColor", "closing", "drift", "inkColor", "notes", "photos", "subtitle", "tilt", "title"],
  unbound: { music: "audio", perPageMs: "timing", introMs: "timing", outroMs: "timing", xfadeMs: "timing" },
});

describe("@m0saic/story/scrapbook/v2 — handles", () => {
  const pagesOf = async (props: Record<string, unknown>, media?: Record<string, unknown>) => {
    const film = (await ScrapbookV2.render({ ...D, ...props } as never, ctxFor(ScrapbookV2, { media }))) as MosaicDocumentPipeline;
    return film.steps.filter((st) => /^page-/.test(st.name ?? "")).map((st) => st.file as MosaicDocument);
  };

  it("stand-in pages: every print is the ADD handle for the first photo, and shows tilt + drift (v1 bound no picture)", async () => {
    const pages = await pagesOf({});
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(entriesOn(page, "print")).toEqual([{ propKey: "photos", index: 0 }, { propKey: "tilt" }, { propKey: "drift" }]);
  });

  it("real photos: page i's print replaces photos[i]; its note carries the ink", async () => {
    const pages = await pagesOf({ photos: [P1, P2, P3], notes: ["one", "two", "three"] }, MEDIA);
    expect(pages.map((pg) => (entriesOn(pg, "print")[0] as { index: number }).index)).toEqual([0, 1, 2]);
    const note = pages[1].sources[1] as { editor?: { bindings?: unknown } };
    expect(note.editor?.bindings).toEqual([{ propKey: "notes", index: 1 }, { propKey: "inkColor" }]);
  });

  it("the opening and closing cards carry their ink and accent; nothing is rejected", async () => {
    const ctx = ctxFor(ScrapbookV2);
    const film = (await ScrapbookV2.render({ ...D } as never, ctx)) as MosaicDocumentPipeline;
    const open = film.steps[0].file as MosaicDocument;
    expect((open.sources as Array<{ editor?: { bindings?: Array<{ propKey: string }> } }>).map((x) => x.editor?.bindings?.map((b) => b.propKey)).filter(Boolean)).toEqual([["title", "inkColor"], ["subtitle", "accentColor"]]);
    expect(handlesOf(film, ScrapbookV2, ctx).rejected).toEqual([]);
  });
});
