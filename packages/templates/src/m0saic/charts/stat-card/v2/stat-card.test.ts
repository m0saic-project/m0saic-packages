import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, vnextSuite } from "../../../../__tests__/vnextSuite";
import { StatCard } from "../v1/stat-card";
import { StatCardV2 } from "./stat-card";

const D = StatCardV2.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await StatCardV2.render({ ...D, ...props } as never, ctxFor(StatCardV2, { w, h }))) as MosaicDocument;

vnextSuite({
  next: StatCardV2,
  prev: StatCard,
  catalog: { primitive: true },
  // v1 painted its surface as a full-canvas tile; v2 paints it as the document
  // background, and a nesting parent asks for the tile back — which is v1's paint.
  parityNextProps: { useNestedBackgroundColor: true },
  cases: [
    { name: "down, static", props: { direction: "down", delta: "-4 (-1.2%)", anim: { reduceMotion: true } } },
    { name: "no delta, no sublabel, custom surface", props: { delta: "", sublabel: "", backgroundColor: "#203040" } },
    { name: "transparent (none), portrait", props: { backgroundColor: "none" }, w: 720, h: 1280 },
  ],
  bound: ["delta", "label", "sublabel", "value"],
  unbound: {
    backgroundColor: "document background",
    "theme.slug": "theme source",
    "theme.preset": "theme source",
    "theme.namespace": "theme source",
    "anim.introFrac": "timing",
    "anim.introMs": "timing",
  },
});

describe("@m0saic/charts/stat-card/v2 — the surface", () => {
  it("standalone: the surface is document.backgroundColor — no full-canvas tile", async () => {
    const doc = await render({});
    expect(doc.backgroundColor).toBe("#161b22");
    expect(String(doc.m0).startsWith("1{")).toBe(false);
    expect((doc.sources as Array<{ type?: string; color?: string }>).some((s) => s.type === "lavfi" && s.color === "#161b22")).toBe(false);
  });

  it("nested: the hidden flag restores the base tile, bound to the colour it paints", async () => {
    const doc = await render({ useNestedBackgroundColor: true });
    expect(String(doc.m0).startsWith("1{")).toBe(true);
    expect((doc.sources[0] as { color?: string; editor?: { binding?: unknown } }).color).toBe("#161b22");
    expect((doc.sources[0] as { editor?: { binding?: unknown } }).editor?.binding).toEqual({ propKey: "backgroundColor" });
  });

  it("the empty sublabel rect stays bound (a handle to add one)", async () => {
    const doc = await render({ sublabel: "" });
    expect((doc.sources as Array<{ editor?: { binding?: { propKey: string } } }>).some((s) => s.editor?.binding?.propKey === "sublabel")).toBe(true);
  });
});
