// covers: @m0saic/meta/hot-reload-smoke/v1 — the hot-reload canary. Pins the
// property the whole instrument rests on: the fill comes from the module
// CONSTANT, not from defaultProps, so a stale prop bag can never mask a
// rebuilt template.
import type { MosaicDocument, MosaicEngineContext, MosaicTextSource } from "@m0saic/types";
import {
  HotReloadSmoke,
  HOT_RELOAD_SMOKE_COLOR,
  SMOKE_BLUE,
  SMOKE_RED,
  smokeColorLabel,
} from "./hot-reload-smoke";

function makeCtx(): MosaicEngineContext {
  return {
    mode: "render",
    output: { width: 720, height: 720, fps: 30, durationMs: 1000, workspaceDir: "/tmp" },
    target: { width: 720, height: 720, fps: 30, durationMs: 1000 },
    media: {},
  } as MosaicEngineContext;
}

function textSourceOf(doc: MosaicDocument): MosaicTextSource {
  const src = doc.sources?.[0] as MosaicTextSource;
  expect(src?.type).toBe("text");
  return src;
}

function layerTexts(src: MosaicTextSource): string[] {
  return (src.layers ?? []).map((l) =>
    l.content?.kind === "literal" ? l.content.text : "",
  );
}

describe("@m0saic/meta/hot-reload-smoke/v1", () => {
  it("fills from the module constant when no color prop is set", async () => {
    const doc = (await HotReloadSmoke.render(
      { ...HotReloadSmoke.defaultProps },
      makeCtx(),
    )) as MosaicDocument;

    // solidBackground() appends the opaque-alpha suffix.
    expect(textSourceOf(doc).visual?.backgroundColor).toBe(`${HOT_RELOAD_SMOKE_COLOR}@1.0`);
  });

  // The canary's load-bearing invariant. If `color` ever gains a default here,
  // the editor's prop bag starts carrying the color and a rebuilt template can
  // be masked by stale props — which is exactly the failure this template is
  // supposed to detect.
  it("does NOT bake the color into defaultProps", () => {
    expect(HotReloadSmoke.defaultProps).not.toHaveProperty("color");
    expect(HotReloadSmoke.defaultProps.showLabel).toBe(true);
  });

  it("ships red — flipping the constant to blue is the verification step", () => {
    expect(HOT_RELOAD_SMOKE_COLOR).toBe(SMOKE_RED);
    expect(SMOKE_RED).not.toBe(SMOKE_BLUE);
  });

  it("labels both canary colors by name", () => {
    expect(smokeColorLabel(SMOKE_RED)).toBe("RED");
    expect(smokeColorLabel(SMOKE_BLUE)).toBe("BLUE");
    expect(smokeColorLabel("#abcdef")).toBe("#ABCDEF");
  });

  it("prints the color name and template id when showLabel is on", async () => {
    const doc = (await HotReloadSmoke.render({ showLabel: true }, makeCtx())) as MosaicDocument;
    expect(layerTexts(textSourceOf(doc))).toEqual(["RED", "hot-reload-smoke/v1"]);
  });

  // A text source with an empty layers[] fails document validation
  // (TEXT_LAYERS_EMPTY), so the label-off path must be a lavfi color tile —
  // not a text source stripped of its layers.
  it("emits a lavfi color tile (not an empty text source) when showLabel is off", async () => {
    const doc = (await HotReloadSmoke.render({ showLabel: false }, makeCtx())) as MosaicDocument;
    const src = doc.sources?.[0] as { type?: string; color?: string };
    expect(src?.type).toBe("lavfi");
    expect(src?.color).toBe(`${HOT_RELOAD_SMOKE_COLOR}@1.0`);
  });

  it("honors an explicit color override", async () => {
    const doc = (await HotReloadSmoke.render({ color: SMOKE_BLUE }, makeCtx())) as MosaicDocument;
    expect(textSourceOf(doc).visual?.backgroundColor).toBe(`${SMOKE_BLUE}@1.0`);
    expect(layerTexts(textSourceOf(doc))[0]).toBe("BLUE");
  });

  it("fails fast on a malformed color", async () => {
    await expect(HotReloadSmoke.render({ color: "blue" }, makeCtx())).rejects.toThrow(
      /must be a #rrggbb hex color/,
    );
  });

  it("is registered as internal", () => {
    expect(HotReloadSmoke.id).toBe("@m0saic/meta/hot-reload-smoke/v1");
    expect(HotReloadSmoke.internal).toBe(true);
  });
});
