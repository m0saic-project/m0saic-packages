import { resolveThemeTokens } from "./resolveThemeTokens";
import { publishTheme } from "./theming";
import { registerTemplate } from "../template/templateRegistry";
import type { MosaicEngineContext, MosaicThemeTokens } from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";

const FALLBACK: MosaicThemeTokens = {
  surfaceApp: "#000000", surface: "#111111", surfaceRaised: "#222222", surfaceInset: "#0a0a0a",
  border: "#333333", borderStrong: "#444444", textPrimary: "#ffffff", textSecondary: "#cccccc",
  textMuted: "#999999", eyebrow: "#ff8800", accent: "#ff8800", accentSoft: "#ffaa00", accentGlow: "#ff880040",
  positive: "#00ff00", negative: "#ff0000", grid: "#333333", gridAlpha: 1, axis: "#444444", axisAlpha: 1,
  radius: 0, dataPalette: ["#ff8800"],
};

// A minimal producer that publishes a fixed partial token block under whatever
// alias the resolver forces on it.
const PRODUCER_TOKENS = { surface: "#abcabc", positive: "#00cc00" };
registerTemplate({
  id: asTemplateId("test/mock-theme-producer/v1"),
  label: "Mock Theme Producer", version: 1, capabilities: { tier: "core" }, description: "test fixture", tags: ["test"], propsSchema: {},
  defaultProps: {},
  render: async (props: { alias?: string }) => ({
    kind: "mosaic_document" as const,
    version: 1 as const,
    assets: {} as never,
    m0: toM0String("1", "theme"),
    sources: [publishTheme(PRODUCER_TOKENS as unknown as MosaicThemeTokens, { alias: props.alias ?? "theme" })],
  }),
});

function ctx(upstream?: Record<string, unknown>, alias = "theme"): MosaicEngineContext {
  const target = { width: 100, height: 100, fps: 30, durationMs: 1000 };
  return {
    mode: "render",
    target,
    output: { ...target, workspaceDir: "/tmp" },
    ...(upstream ? { upstreamData: { [alias]: upstream } } : {}),
  } as unknown as MosaicEngineContext;
}

describe("resolveThemeTokens", () => {
  it("no config, no upstream → returns the fallback unchanged (byte-identical)", async () => {
    expect(await resolveThemeTokens(FALLBACK, ctx())).toEqual(FALLBACK);
  });

  it("child: reads the default namespace off ctx and overlays per-key", async () => {
    const t = await resolveThemeTokens(FALLBACK, ctx({ surface: "#123456" }));
    expect(t.surface).toBe("#123456");
    expect(t.textPrimary).toBe(FALLBACK.textPrimary); // unpublished key stays local
  });

  it("head: self-seeds from the slug when nothing is upstream", async () => {
    const t = await resolveThemeTokens(FALLBACK, ctx(), { slug: "test/mock-theme-producer/v1" });
    expect(t.surface).toBe("#abcabc"); // producer surface
    expect(t.positive).toBe("#00cc00"); // producer positive
    expect(t.negative).toBe(FALLBACK.negative); // producer didn't publish it → local
  });

  it("no slug configured → never self-seeds (falls back to local)", async () => {
    const t = await resolveThemeTokens(FALLBACK, ctx(), { namespace: "theme" });
    expect(t).toEqual(FALLBACK);
  });

  it("ctx present wins over seeding unless forceFetch overrides", async () => {
    const noForce = await resolveThemeTokens(FALLBACK, ctx({ surface: "#eeeeee" }), { slug: "test/mock-theme-producer/v1" });
    expect(noForce.surface).toBe("#eeeeee"); // ctx wins; producer not invoked
    const forced = await resolveThemeTokens(FALLBACK, ctx({ surface: "#eeeeee" }), { slug: "test/mock-theme-producer/v1", forceFetch: true });
    expect(forced.surface).toBe("#abcabc"); // forced re-seed beats the ctx value
  });

  it("custom namespace: reads AND seeds under the configured alias", async () => {
    const read = await resolveThemeTokens(FALLBACK, ctx({ surface: "#777777" }, "brand"), { namespace: "brand" });
    expect(read.surface).toBe("#777777");
    const seed = await resolveThemeTokens(FALLBACK, ctx(), { slug: "test/mock-theme-producer/v1", namespace: "brand" });
    expect(seed.surface).toBe("#abcabc"); // producer publishes under "brand"; resolver reads "brand"
  });
});
