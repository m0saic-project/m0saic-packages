import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, entriesOn, keysOn, renderStatusOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { AlpineCommitFeedV2 } from "../v2/commit-feed";
import { AlpineCommitFeedV3 } from "./commit-feed";

const D = AlpineCommitFeedV3.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await AlpineCommitFeedV3.render({ ...D, ...props } as never, ctxFor(AlpineCommitFeedV3, { w, h }))) as MosaicDocument;

vnextSuite({
  next: AlpineCommitFeedV3,
  prev: AlpineCommitFeedV2,
  catalog: { primitive: true },
  cases: [
    { name: "dark, no header band, static", props: { preset: "dark", showHeader: false, anim: { reduceMotion: true } } },
    { name: "sparse rows, light mode", props: { rows: [{ title: "Only a title" }, { title: "With a PR", pr: 42, author: "ada" }], anim: { renderMode: "light" } } },
    { name: "portrait, accent, transparent surface", props: { accent: "#22cc88", backgroundColor: "black@0", washColor: "#101820" }, w: 720, h: 1280 },
  ],
  bound: ["accent", "backgroundColor", "preset", "rows", "subtitle", "title", "washColor"],
  unbound: { "theme.slug": "theme source", "theme.preset": "theme source", "theme.namespace": "theme source", "anim.introFrac": "timing", iconPath: "agent value" },
});

describe("@m0saic/alpine/commit-feed/v3 — handles", () => {
  it("a row's empty fields ride its title (add an author, date, area or PR from the canvas)", async () => {
    const doc = await render({ rows: [{ title: "Only a title" }] });
    expect(entriesOn(doc, "row-title")).toEqual([
      { propKey: "rows", path: [0, "title"], kind: "string" },
      { propKey: "rows", path: [0, "author"], kind: "string" },
      { propKey: "rows", path: [0, "date"], kind: "string" },
      { propKey: "rows", path: [0, "area"], kind: "string" },
      { propKey: "rows", path: [0, "pr"], kind: "number" },
    ]);
  });

  it("a field with a value keeps its own rect and leaves the title", async () => {
    const doc = await render({ rows: [{ title: "T", author: "ada", date: "Mon", area: "core", pr: 7 }] });
    expect(entriesOn(doc, "row-title")).toEqual([{ propKey: "rows", path: [0, "title"], kind: "string" }]);
    expect(keysOn(doc, "row-author")).toEqual(["rows"]);
  });

  it("no rows is an input the feed waits on, never an error", async () => {
    expect(renderStatusOf(await render({ rows: [] }))).toBe("incomplete");
  });
});
