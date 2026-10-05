import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, entriesOn, handlesOf, keysOn, renderStatusOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { TraceTimelineV1 } from "../v1/trace-timeline";
import { TraceTimelineV2 } from "./trace-timeline";

const D = TraceTimelineV2.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await TraceTimelineV2.render({ ...D, ...props } as never, ctxFor(TraceTimelineV2, { w, h }))) as MosaicDocument;

vnextSuite({
  next: TraceTimelineV2,
  prev: TraceTimelineV1,
  cases: [
    { name: "dark, no title, static, no tokens", props: { preset: "dark", title: "", showTokens: false, anim: { renderMode: "premium", introFrac: 0.7, reduceMotion: true } } },
    { name: "two spans, custom colours, light mode", props: { spans: [{ tool: "Read", startMs: 0, durMs: 400 }, { tool: "Bash", target: "npm test", startMs: 500, durMs: 2500, tokens: 1200, status: "error" }], accent: "#22cc88", errorColor: "#aa33ff", anim: { renderMode: "light", introFrac: 0.5, reduceMotion: false } } },
    { name: "portrait", w: 900, h: 1200 },
  ],
  bound: ["accent", "cachedColor", "errorColor", "preset", "retryColor", "spans", "subtitle", "title"],
  unbound: { "anim.introFrac": "timing", theme: "theme source" },
});

describe("@m0saic/agents/trace-timeline/v2 — handles", () => {
  it("v1 bound nothing in a lane; v2 binds every leaf a lane shows, at the span's ORIGINAL index", async () => {
    // [0] is filtered out (no tool); [1] is short, so its token label fits beside the bar; [2] sets the scale.
    const doc = await render({ spans: [{ tool: "", startMs: 0, durMs: 1 }, { tool: "Bash", target: "npm test", startMs: 0, durMs: 500, tokens: 1200, status: "error" }, { tool: "Read", startMs: 0, durMs: 5000 }], anim: { reduceMotion: true } });
    expect(entriesOn(doc, "span-tool")).toEqual([{ propKey: "spans", path: [1, "tool"], kind: "string" }]);
    expect(entriesOn(doc, "span-target")).toEqual([{ propKey: "spans", path: [1, "target"], kind: "string" }]);
    expect(entriesOn(doc, "span-bar-error")).toEqual([
      { propKey: "spans", path: [1, "durMs"], kind: "number" },
      { propKey: "spans", path: [1, "startMs"], kind: "number" },
      { propKey: "errorColor" },
    ]);
    expect(entriesOn(doc, "span-tokens")).toEqual([{ propKey: "spans", path: [1, "tokens"], kind: "number" }]);
    expect(handlesOf(doc, TraceTimelineV2, ctxFor(TraceTimelineV2)).rejected).toEqual([]);
  });

  it("a lane with no target / no token label offers them on its tool name / its bar", async () => {
    const doc = await render({ spans: [{ tool: "Read", startMs: 0, durMs: 400 }], anim: { reduceMotion: true } });
    expect(entriesOn(doc, "span-tool").map((e) => (e.path as unknown[])[1])).toEqual(["tool", "target"]);
    expect(entriesOn(doc, "span-bar-ok").map((e) => (e.path as unknown[] | undefined)?.[1] ?? e.propKey)).toEqual(["durMs", "startMs", "accent", "tokens"]);
  });

  it("no title: the header (its derived line) offers one", async () => {
    expect(keysOn(await render({ title: "" }), "card-header")).toEqual(["subtitle", "title"]);
  });

  it("no spans is an input the card waits on, never an error", async () => {
    expect(renderStatusOf(await render({ spans: [] }))).toBe("incomplete");
  });
});
