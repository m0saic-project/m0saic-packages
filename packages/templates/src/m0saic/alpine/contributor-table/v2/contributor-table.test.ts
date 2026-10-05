import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, entriesOn, keysOn, renderStatusOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import { AlpineContributorTable } from "../v1/contributor-table";
import { AlpineContributorTableV2 } from "./contributor-table";

const D = AlpineContributorTableV2.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await AlpineContributorTableV2.render({ ...D, ...props } as never, ctxFor(AlpineContributorTableV2, { w, h }))) as MosaicDocument;

vnextSuite({
  next: AlpineContributorTableV2,
  prev: AlpineContributorTable,
  catalog: { primitive: true },
  cases: [
    { name: "dark, no header band, static", props: { preset: "dark", showHeader: false, anim: { reduceMotion: true } } },
    { name: "portrait cards", w: 720, h: 1280 },
    { name: "portrait, plain columns, light mode", props: { columnSigns: [], columnColors: [], anim: { renderMode: "light" } }, w: 720, h: 1280 },
    { name: "accent + transparent surface", props: { accent: "#22cc88", backgroundColor: "black@0", washColor: "#101820" } },
  ],
  bound: ["accent", "backgroundColor", "columnColors", "columnSigns", "columns", "preset", "rows", "subtitle", "title", "topTint", "washColor"],
  unbound: { "theme.slug": "theme source", "theme.preset": "theme source", "theme.namespace": "theme source", "anim.introFrac": "timing", iconPath: "agent value" },
});

describe("@m0saic/alpine/contributor-table/v2 — handles", () => {
  it("a value cell carries its number, then its column's sign and ink", async () => {
    const doc = await render({ anim: { reduceMotion: true } });
    expect(entriesOn(doc, "row-value")).toEqual([
      { propKey: "rows", path: [0, "values", 0], kind: "number" },
      { propKey: "columnSigns", index: 0 },
      { propKey: "columnColors", path: [0], kind: "color" },
    ]);
  });

  it("never binds a column attribute past the end of its list (a list has no holes)", async () => {
    const doc = await render({ columnSigns: [], columnColors: undefined, columns: ["A", "B"], rows: [{ name: "x", values: [1, 2] }] });
    const all = (doc.sources as Array<{ editor?: { bindings?: Array<{ propKey: string; index?: number }> } }>).flatMap((s) => s.editor?.bindings ?? []);
    expect(all.filter((b) => b.propKey === "columnSigns").map((b) => b.index)).toEqual([0]);
  });

  it("the row bands carry the wash colour and how many rows get it", async () => {
    expect(keysOn(await render({}), "row")).toEqual(["washColor", "topTint"]);
  });

  it("portrait: the secondary metrics are bound too (v1 left them bare)", async () => {
    const doc = await render({ anim: { reduceMotion: true } }, 720, 1280);
    const bound = (doc.sources as Array<{ editor?: { label?: string; bindings?: unknown[]; binding?: unknown } }>).filter((s) => s.editor?.label === "row-value");
    expect(bound.length).toBeGreaterThan(5);
    expect(bound.every((s) => (s.editor?.bindings?.length ?? 0) > 0 || !!s.editor?.binding)).toBe(true);
  });

  it("the rank is template-owned: no handle in either layout (editing it would not move the row)", async () => {
    for (const [w, h] of [[undefined, undefined], [720, 1280]] as const) {
      const doc = await render({ anim: { reduceMotion: true } }, w, h);
      const ranks = (doc.sources as Array<{ editor?: { label?: string; bindings?: unknown[]; binding?: unknown } }>).filter((s) => s.editor?.label === "rank");
      expect(ranks.length).toBe(5);
      expect(ranks.every((s) => !s.editor?.bindings?.length && !s.editor?.binding)).toBe(true);
    }
  });

  it("no rows or no columns is an input the table waits on, never an error", async () => {
    expect(renderStatusOf(await render({ rows: [] }))).toBe("incomplete");
  });
});
