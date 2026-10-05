import type { MosaicDocument } from "@m0saic/types";
import { countBound, ctxFor, handlesOf, keysOn, renderStatusOf, sourcesOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { YearCardV1 } from "../v1/year-card";
import { YearCardV2 } from "./year-card";

const D = YearCardV2.defaultProps as Record<string, unknown>;
const BOUND = ["commits", "contributions", "handle", "preset", "pullRequests", "stars", "topLanguage", "year"];
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await YearCardV2.render({ ...D, ...props } as never, ctxFor(YearCardV2, { w, h }))) as MosaicDocument;

vnextSuite({
  next: YearCardV2,
  prev: YearCardV1,
  cases: [
    { name: "dark, premium fade, no KPIs", props: { preset: "dark", showKpis: false, anim: { renderMode: "premium" } } },
    { name: "no handle, a leap year, static", props: { handle: "", year: 2024, anim: { reduceMotion: true } } },
    { name: "a comma string of counts, portrait", props: { contributions: "1,2,3,0,0,9,4", commits: 1200, pullRequests: 80, stars: 5 }, w: 720, h: 1280 },
  ],
  bound: BOUND,
  unbound: { "anim.introFrac": "timing", theme: "theme source" },
});

describe("@m0saic/github/year-card/v2 — handles", () => {
  it("the header carries the handle AND the year (v1: the handle alone — the gate's standing warning)", async () => {
    expect(keysOn(await render({}), "card-header")).toEqual(["handle", "year"]);
  });

  it("no handle: the header offers one, and still carries the year (v1 bound nothing there)", async () => {
    expect(keysOn(await render({ handle: "" }), "card-header")).toEqual(["handle", "year"]);
  });

  it("a day's cell carries ITS count — the day index, not the paint order", async () => {
    const doc = await render({ year: 2026, anim: { reduceMotion: true } });
    const cells = sourcesOf(doc).filter((x) => x.editor?.label === "cell");
    expect(cells).toHaveLength(365);
    const days = cells.map((c) => ((c.editor?.binding as { path?: number[] } | undefined)?.path ?? [-1])[0]);
    expect([...days].sort((a, b) => a - b)).toEqual(Array.from({ length: 365 }, (_, i) => i));
  });

  it("a comma string has no elements to name — its cells stay unbound, nothing is rejected", async () => {
    const doc = await render({ contributions: "1,2,3" });
    expect(countBound(doc, "contributions")).toBe(0);
    expect(handlesOf(doc, YearCardV2, ctxFor(YearCardV2)).rejected).toEqual([]);
  });

  it("no counts is an input the card waits on, never an error", async () => {
    expect(renderStatusOf(await render({ contributions: "" }))).toBe("incomplete");
  });

  it("the sample year is v1's, as a list", () => {
    expect((YearCardV2.defaultProps as { contributions: number[] }).contributions.join(",")).toBe(YearCardV1.defaultProps!.contributions);
  });
});
