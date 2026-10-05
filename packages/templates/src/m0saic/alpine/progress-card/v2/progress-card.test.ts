import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, entriesOn, keysOn, renderStatusOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { AlpineProgressCard } from "../v1/progress-card";
import { AlpineProgressCardV2 } from "./progress-card";

const D = AlpineProgressCardV2.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>) =>
  (await AlpineProgressCardV2.render({ ...D, ...props } as never, ctxFor(AlpineProgressCardV2))) as MosaicDocument;

vnextSuite({
  next: AlpineProgressCardV2,
  prev: AlpineProgressCard,
  catalog: { primitive: true },
  cases: [
    { name: "dark, no header, static", props: { preset: "dark", title: "", subtitle: "", anim: { reduceMotion: true } } },
    { name: "value/max rows + item colours", props: { items: [{ label: "Seats", value: 620, max: 1000 }, { label: "Beta", value: 40, color: "#22cc88" }, { label: "Shown", value: 3, valueLabel: "3 of 9" }] } },
    { name: "values hidden, portrait", props: { showValue: false, barColor: "#aa33ff" }, w: 720, h: 1280 },
  ],
  bound: ["barColor", "bars.cornerRadius", "items", "preset", "subtitle", "title", "trackColor"],
  unbound: { "theme.slug": "theme source", "theme.preset": "theme source", "theme.namespace": "theme source", "anim.introFrac": "timing" },
});

describe("@m0saic/alpine/progress-card/v2 — handles", () => {
  it("no header: title + subtitle ride the first row's label", async () => {
    expect(keysOn(await render({ title: "", subtitle: "" }), "row-label")).toEqual(["items", "title", "subtitle"]);
  });

  it("a title-only header carries the subtitle; the rows keep their own handle", async () => {
    const doc = await render({ subtitle: "" });
    expect(keysOn(doc, "card-header")).toEqual(["title", "subtitle"]);
    expect(keysOn(doc, "row-label")).toEqual(["items"]);
  });

  it("a value/max percentage carries BOTH leaves (v1 bound neither)", async () => {
    const doc = await render({ items: [{ label: "Seats", value: 620, max: 1000 }], anim: { reduceMotion: true } });
    expect(entriesOn(doc, "row-value")).toEqual([
      { propKey: "items", path: [0, "value"], kind: "number" },
      { propKey: "items", path: [0, "max"], kind: "number" },
    ]);
  });

  it("the track carries its colour and the rounding it shows", async () => {
    expect(keysOn(await render({}), "track")).toEqual(["trackColor", "bars.cornerRadius"]);
  });

  it("no rows is an input the card waits on, never an error", async () => {
    expect(renderStatusOf(await render({ items: [] }))).toBe("incomplete");
  });
});
