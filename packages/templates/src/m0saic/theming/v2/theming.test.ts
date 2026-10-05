import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, vnextSuite } from "../../../__tests__/vnextSuite";
import { Theming } from "../v1/theming";
import { ThemingV2 } from "./theming";

const D = ThemingV2.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await ThemingV2.render({ ...D, ...props } as never, ctxFor(ThemingV2, { w, h }))) as MosaicDocument;

vnextSuite({
  next: ThemingV2,
  prev: Theming,
  cases: [
    { name: "light sheet", props: { preset: "light" } },
    { name: "high-contrast, portrait", props: { preset: "high-contrast" }, w: 1080, h: 1920 },
    { name: "data-only (no preview)", props: { preview: false, alias: "brand" } },
  ],
  bound: [],
  unbound: { alias: "data key" },
});

describe("@m0saic/theming/v2", () => {
  it("publishes the same token block v1 does, under the alias asked for", async () => {
    const doc = await render({ preview: false, alias: "brand" });
    expect((doc.sources[0] as { type?: string; alias?: string }).type).toBe("data");
    expect((doc.sources[0] as { alias?: string }).alias).toBe("brand");
    expect(doc.sidecars).toEqual(((await Theming.render({ preset: "dark", alias: "brand", preview: false }, ctxFor(Theming))) as MosaicDocument).sidecars);
  });

  it("an invalid alias still throws (fail fast)", async () => {
    await expect(render({ alias: "9 bad" })).rejects.toThrow(/not a valid AliasId/);
  });
});
