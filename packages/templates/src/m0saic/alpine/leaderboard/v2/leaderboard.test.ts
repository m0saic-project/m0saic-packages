import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, entriesOn, keysOn, renderStatusOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { AlpineLeaderboard } from "../v1/leaderboard";
import { AlpineLeaderboardV2 } from "./leaderboard";

const D = AlpineLeaderboardV2.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>) =>
  (await AlpineLeaderboardV2.render({ ...D, ...props } as never, ctxFor(AlpineLeaderboardV2))) as MosaicDocument;

vnextSuite({
  next: AlpineLeaderboardV2,
  prev: AlpineLeaderboard,
  catalog: { primitive: true },
  cases: [
    { name: "dark, no header, static", props: { preset: "dark", title: "", subtitle: "", anim: { reduceMotion: true } } },
    { name: "prefix + suffix, display strings, row colours", props: { valuePrefix: "$", valueSuffix: "k", items: [{ name: "A", value: 3, color: "#22cc88" }, { name: "B", value: 9, valueLabel: "nine" }] } },
    { name: "values hidden, portrait, light mode", props: { showValue: false, anim: { renderMode: "light" } }, w: 720, h: 1280 },
  ],
  bound: ["items", "preset", "subtitle", "title", "valuePrefix", "valueSuffix"],
  unbound: { "theme.slug": "theme source", "theme.preset": "theme source", "theme.namespace": "theme source", "anim.introFrac": "timing" },
});

describe("@m0saic/alpine/leaderboard/v2 — handles", () => {
  it("the value rect carries the number, then the prefix / suffix it shows around it", async () => {
    expect(entriesOn(await render({}), "row-value")).toEqual([
      { propKey: "items", path: [0, "value"], kind: "number" },
      { propKey: "valuePrefix" },
      { propKey: "valueSuffix" },
    ]);
  });

  it("a row with a Display string carries that leaf instead", async () => {
    const doc = await render({ items: [{ name: "B", value: 9, valueLabel: "nine" }] });
    expect(entriesOn(doc, "row-value")).toEqual([
      { propKey: "items", path: [0, "value"], kind: "number" },
      { propKey: "items", path: [0, "valueLabel"], kind: "string" },
    ]);
  });

  it("the badge is a colour handle for its row (original index, not rank)", async () => {
    const doc = await render({ items: [{ name: "low", value: 1 }, { name: "high", value: 9 }] });
    expect(entriesOn(doc, "badge")).toEqual([{ propKey: "items", path: [1, "color"], kind: "color" }]);
  });

  it("no header: title + subtitle ride the first row's name", async () => {
    expect(keysOn(await render({ title: "", subtitle: "" }), "row-name")).toEqual(["items", "title", "subtitle"]);
  });

  it("no rows is an input the card waits on, never an error", async () => {
    expect(renderStatusOf(await render({ items: [] }))).toBe("incomplete");
  });
});
