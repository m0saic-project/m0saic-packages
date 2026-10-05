import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, entriesOn, keysOn, renderStatusOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { AlpineTimelineV2 } from "../v2/timeline";
import { AlpineTimelineV3 } from "./timeline";

const D = AlpineTimelineV3.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await AlpineTimelineV3.render({ ...D, ...props } as never, ctxFor(AlpineTimelineV3, { w, h }))) as MosaicDocument;

vnextSuite({
  next: AlpineTimelineV3,
  prev: AlpineTimelineV2,
  catalog: { primitive: true },
  cases: [
    { name: "dark, vertical, no header, static", props: { preset: "dark", orientation: "vertical", title: "", subtitle: "", anim: { reduceMotion: true } } },
    { name: "horizontal, no descriptions, light mode", props: { orientation: "horizontal", showDescription: false, anim: { renderMode: "light" } } },
    { name: "portrait, sparse events, own colours", props: { color: "#22cc88", events: [{ title: "Only a title" }, { title: "Dated", date: "Mar", color: "#aa33ff" }, { title: "Full", date: "Apr", description: "All three" }] }, w: 720, h: 1280 },
  ],
  bound: ["color", "events", "preset", "subtitle", "title"],
  unbound: { "theme.slug": "theme source", "theme.preset": "theme source", "theme.namespace": "theme source", "anim.introFrac": "timing" },
});

describe("@m0saic/alpine/timeline/v3 — handles", () => {
  it("an event's empty date / description ride its title", async () => {
    const doc = await render({ events: [{ title: "Only a title" }] });
    expect(entriesOn(doc, "event-title")).toEqual([
      { propKey: "events", path: [0, "title"], kind: "string" },
      { propKey: "events", path: [0, "date"], kind: "string" },
      { propKey: "events", path: [0, "description"], kind: "string" },
    ]);
  });

  it("descriptions switched off are not offered (nothing would show)", async () => {
    const doc = await render({ showDescription: false, events: [{ title: "T", date: "Mar" }] });
    expect(entriesOn(doc, "event-title")).toEqual([{ propKey: "events", path: [0, "title"], kind: "string" }]);
  });

  it("a dot on the shared accent also offers its own colour; one with its own colour binds only that", async () => {
    const doc = await render({ events: [{ title: "A" }, { title: "B", color: "#aa33ff" }] });
    const dots = (doc.sources as Array<{ editor?: { label?: string; binding?: unknown; bindings?: unknown[] } }>).filter((s) => s.editor?.label === "dot");
    expect(dots[0].editor?.bindings).toEqual([{ propKey: "color" }, { propKey: "events", path: [0, "color"], kind: "color" }]);
    expect(dots[1].editor?.binding).toEqual({ propKey: "events", path: [1, "color"], kind: "color" });
  });

  it("no header: title + subtitle ride the first event's title", async () => {
    expect(keysOn(await render({ title: "", subtitle: "" }), "event-title").slice(-2)).toEqual(["title", "subtitle"]);
  });

  it("no events is an input the timeline waits on, never an error", async () => {
    expect(renderStatusOf(await render({ events: [] }))).toBe("incomplete");
  });
});
