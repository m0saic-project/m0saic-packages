import { Theming } from "./theming";
import { THEME_PRESETS, resolveTheme, DEFAULT_THEME_PRESET } from "./theme-tokens";
import type { MosaicDocument } from "@m0saic/types";

const dims = { width: 1920, height: 1080, fps: 30, durationMs: 3000 };
const ctx = { target: dims, output: dims } as never;

async function render(props: Record<string, unknown> = {}): Promise<MosaicDocument> {
  return (await Theming.render({ ...Theming.defaultProps, ...props }, ctx)) as MosaicDocument;
}

function dataSource(doc: MosaicDocument): { alias?: string; variables: Record<string, unknown> } {
  const s = (doc.sources as Array<Record<string, unknown>>).find((x) => x.type === "data");
  if (!s) throw new Error("no data source");
  return s as never;
}

describe("theme-tokens (layered system)", () => {
  it("every mode has the full semantic vocabulary + a ≥6 data palette", () => {
    const keys = Object.keys(THEME_PRESETS.dark).sort();
    for (const mode of ["dark", "light", "high-contrast"] as const) {
      expect(Object.keys(THEME_PRESETS[mode]).sort()).toEqual(keys);
      expect(THEME_PRESETS[mode].dataPalette.length).toBeGreaterThanOrEqual(6);
    }
  });

  it("modes share ONE brand: accent is m0saic orange in dark AND light", () => {
    // Unified identity — dark/light differ in luminance, not hue.
    expect(THEME_PRESETS.dark.accent).toBe("#EF7525");
    expect(THEME_PRESETS.light.accent).toBe("#EF7525");
    // dark == the app: navy surface, orange accent (from App.css :root).
    expect(THEME_PRESETS.dark.surfaceApp).toBe("#050314");
    // light flips the surface to warm-white but keeps the orange.
    expect(THEME_PRESETS.light.surfaceApp).toBe("#F7F6FB");
  });

  it("resolveTheme defaults to dark and falls back on garbage", () => {
    expect(resolveTheme()).toBe(THEME_PRESETS[DEFAULT_THEME_PRESET]);
    expect(resolveTheme("nope" as never)).toBe(THEME_PRESETS.dark);
  });
});

describe("@m0saic/theming/v1 producer", () => {
  it("publishes the resolved tokens on a data source + mirrors them to sidecars", async () => {
    const doc = await render({ preset: "light", alias: "theme" });
    const ds = dataSource(doc);
    expect(ds.alias).toBe("theme");
    expect(ds.variables).toEqual(resolveTheme("light"));
    expect((doc as { sidecars?: Record<string, unknown> }).sidecars?.theme).toEqual(
      resolveTheme("light"),
    );
  });

  it("mode drives surfaces but the accent stays the brand orange", async () => {
    expect(dataSource(await render({ preset: "dark" })).variables.accent).toBe("#EF7525");
    expect(dataSource(await render({ preset: "light" })).variables.accent).toBe("#EF7525");
    expect(dataSource(await render({ preset: "high-contrast" })).variables.accent).toBe("#FF8A3D");
    expect(dataSource(await render({ preset: "dark" })).variables.surfaceApp).toBe("#050314");
    expect(dataSource(await render({ preset: "light" })).variables.surfaceApp).toBe("#F7F6FB");
  });

  it("preview:true — token sheet on surfaceApp + exactly one data source", async () => {
    const doc = await render({ preset: "dark" });
    expect((doc as { backgroundColor?: string }).backgroundColor).toBe("#050314");
    const srcs = doc.sources as Array<{ type: string }>;
    // The sheet is many color + text cells; exactly one side-channel data source.
    expect(srcs.filter((s) => s.type === "data")).toHaveLength(1);
    expect(srcs.filter((s) => s.type !== "data").length).toBeGreaterThan(13);
    // Every data-palette + semantic hex appears as a color tile.
    const colors = new Set(srcs.filter((s: any) => s.type === "lavfi").map((s: any) => String(s.color)));
    expect(colors.has("#EF7525")).toBe(true);
    expect(colors.has("#4ADE80")).toBe(true);
  });

  it("preview:false — a data-only doc: just the token block, no cells", async () => {
    const doc = await render({ preset: "dark", preview: false });
    // Only the data source — every source is a MosaicDataSource → the plan
    // builder skips this step when it's marked intermediate:true.
    expect(doc.sources).toHaveLength(1);
    expect((doc.sources as Array<{ type: string }>).every((s) => s.type === "data")).toBe(true);
    expect(dataSource(doc).variables).toEqual(resolveTheme("dark"));
    // No canvas needed — nothing renders.
    expect((doc as { backgroundColor?: string }).backgroundColor).toBeUndefined();
  });

  it("rejects an invalid alias", async () => {
    await expect(render({ alias: "1bad alias" })).rejects.toThrow(/AliasId/);
  });

  it("is deterministic (same props → identical doc)", async () => {
    expect(await render({ preset: "light" })).toEqual(await render({ preset: "light" }));
  });
});
