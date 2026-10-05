import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, handlesOf, keysOn, renderStatusOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { SubtitleBurn } from "../v1/subtitle-burn";
import { SubtitleBurnV2 } from "./subtitle-burn";

const D = SubtitleBurnV2.defaultProps as Record<string, unknown>;
const VIDEO = "/clips/clip.mkv";
const CUES = [{ startMs: 500, endMs: 2500, text: "Hello there." }, { startMs: 3000, endMs: 6000, text: "A second line, a little longer than the first." }];
const meta = (subtitles?: unknown) => ({ kind: "video", width: 1920, height: 1080, hasVideo: true, hasAudio: true, durationMs: 30000, fps: 30, originalFileName: "clip.mkv", ...(subtitles ? { subtitles } : {}) });
const WITH_CUES = { [VIDEO]: meta([{ stream: { streamIndex: 2, codecName: "mov_text", language: "eng" }, cues: CUES }]) };
const NO_TRACK = { [VIDEO]: meta() };
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await SubtitleBurnV2.render({ ...D, ...props } as never, ctxFor(SubtitleBurnV2, { w, h }))) as MosaicDocument;

vnextSuite({
  next: SubtitleBurnV2,
  prev: SubtitleBurn,
  // v1 showed a "missing source" card at defaults; v2 shows the stand-in slot.
  defaultsParity: false,
  // `placement` gained its closed set (v1 typed it as free text).
  schemaChanged: ["placement"],
  cases: [
    { name: "a track with cues", props: { sourceId: VIDEO }, media: WITH_CUES, durationMs: 30000 },
    { name: "top placement, styled, clip window", props: { sourceId: VIDEO, placement: "top", fontSize: 40, fontColor: "#ffee00", borderColor: "#101010", borderWidth: 3, clipStartMs: 1000, clipEndMs: 9000 }, media: WITH_CUES, durationMs: 30000 },
    { name: "no subtitle track (pass-through)", props: { sourceId: VIDEO }, media: NO_TRACK, durationMs: 30000 },
    { name: "cues emitted as data + sidecar", props: { sourceId: VIDEO, emitCues: true }, media: WITH_CUES, durationMs: 30000 },
  ],
  bound: ["borderColor", "borderWidth", "fontColor", "fontSize", "languageCode", "sourceId", "trackIndex"],
  unbound: {},
});

describe("@m0saic/media/subtitle-burn/v2 — handles", () => {
  it("no source: a drop slot (source + track) and a hint line set in the subtitle style (v1: an error card)", async () => {
    const doc = await render({ fontColor: "#ffee00" });
    expect(renderStatusOf(doc)).toBe("incomplete");
    expect(keysOn(doc, "stand-in-slot")).toEqual(["sourceId", "languageCode", "trackIndex"]);
    expect(keysOn(doc, "stand-in-hint")).toEqual(["fontColor", "fontSize", "borderColor", "borderWidth"]);
    const hint = doc.sources.find((x) => (x as { editor?: { label?: string } }).editor?.label === "stand-in-hint") as { layers: Array<{ style: { fontColor: string } }> };
    expect(hint.layers[0].style.fontColor).toBe("#ffee00");
  });

  it("with cues: the footage carries the source and the track, the burned text its style", async () => {
    const ctx = ctxFor(SubtitleBurnV2, { media: WITH_CUES, durationMs: 30000 });
    const doc = (await SubtitleBurnV2.render({ ...D, sourceId: VIDEO } as never, ctx)) as MosaicDocument;
    expect(keysOn(doc, "footage")).toEqual(["sourceId", "languageCode", "trackIndex"]);
    expect(keysOn(doc, "subtitles")).toEqual(["fontColor", "fontSize", "borderColor", "borderWidth"]);
    expect(handlesOf(doc, SubtitleBurnV2, ctx).rejected).toEqual([]);
  });

  it("no cue on screen: the footage carries the style too", async () => {
    const ctx = ctxFor(SubtitleBurnV2, { media: NO_TRACK, durationMs: 30000 });
    const doc = (await SubtitleBurnV2.render({ ...D, sourceId: VIDEO } as never, ctx)) as MosaicDocument;
    expect(keysOn(doc, "footage")).toEqual(["sourceId", "languageCode", "trackIndex", "fontColor", "fontSize", "borderColor", "borderWidth"]);
  });
});
