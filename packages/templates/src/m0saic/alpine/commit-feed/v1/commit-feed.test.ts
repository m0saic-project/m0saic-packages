import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete } from "@m0saic/dsl";
import { AlpineCommitFeed } from "./commit-feed";

const ASPECTS: [number, number, string][] = [
  [1280, 708, "landscape"],
  [540, 540, "square"],
  [720, 1280, "portrait"],
];

function makeCtx(W: number, H: number, durationMs = 3000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: W, height: H, fps: 30, durationMs },
    output: { width: W, height: H, fps: 30, durationMs },
  } as unknown as MosaicEngineContext;
}
const render = (W: number, H: number, props: Record<string, unknown> = {}) =>
  AlpineCommitFeed.render({ ...(AlpineCommitFeed.defaultProps as object), ...props } as never, makeCtx(W, H)) as Promise<MosaicDocument>;

const srcs = (doc: MosaicDocument) => (doc.sources ?? []) as MosaicSource[];
const texts = (doc: MosaicDocument) =>
  srcs(doc)
    .filter((s) => (s as { type?: string }).type === "text")
    .flatMap((s) => ((s as { layers?: Array<{ content?: { text?: string } }> }).layers ?? []).map((l) => l.content?.text ?? ""));

describe("AlpineCommitFeed — metadata", () => {
  it("is the registered commit-feed primitive, deprecated in favor of v2", () => {
    expect(AlpineCommitFeed.id).toBe("@m0saic/alpine/commit-feed/v1");
    expect(AlpineCommitFeed.version).toBe(1);
    const dep = (AlpineCommitFeed as { deprecated?: { replacement?: string } }).deprecated;
    expect(dep).toBeDefined();
    expect(dep?.replacement).toBe("@m0saic/alpine/commit-feed/v2");
    expect(AlpineCommitFeed.primitive).toBe(true);
    expect(AlpineCommitFeed.tags).toEqual(expect.arrayContaining(["alpine", "commit-feed", "feed"]));
  });
});

describe("AlpineCommitFeed — renders at every aspect", () => {
  for (const [W, H, label] of ASPECTS) {
    it(`${label} ${W}x${H}: valid m0, frames match sources, title + commit titles present`, async () => {
      const doc = await render(W, H, { anim: { reduceMotion: true } });
      expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
      const parsed = parseM0StringComplete(doc.m0 as unknown as string, W, H);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe(srcs(doc).length);
      const t = texts(doc);
      expect(t).toEqual(expect.arrayContaining(["NOTABLE COMMITS", "avcodec: improve AV1 decode performance"]));
    });
  }

  it("landscape shows PR + reviewer discs; narrow/portrait drops them (de-cram)", async () => {
    const land = texts(await render(1280, 708, { anim: { reduceMotion: true } }));
    expect(land).toEqual(expect.arrayContaining(["#14201"])); // PR shown wide
    const landSrc = srcs(await render(1280, 708, { anim: { reduceMotion: true } })).length;
    const portSrc = srcs(await render(720, 1280, { anim: { reduceMotion: true } })).length;
    expect(portSrc).toBeLessThan(landSrc); // portrait drops PR + reviewer discs
    const port = texts(await render(720, 1280, { anim: { reduceMotion: true } }));
    expect(port).not.toContain("#14201");
  });
});

describe("AlpineCommitFeed — composition + animation", () => {
  it("showHeader:false drops the title; rows still present", async () => {
    const t = texts(await render(1280, 708, { anim: { reduceMotion: true }, showHeader: false }));
    expect(t).not.toContain("NOTABLE COMMITS");
    expect(t).toEqual(expect.arrayContaining(["avcodec: improve AV1 decode performance"]));
  });

  it("transparent surface (black@0) → no media source, valid m0", async () => {
    const doc = await render(1280, 708, { anim: { reduceMotion: true }, backgroundColor: "black@0", washColor: "#161b22" });
    expect(srcs(doc).every((s) => (s as { type?: string }).type !== "media")).toBe(true);
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  });

  it("static when reduceMotion (no fade alpha)", async () => {
    const doc = await render(1280, 708, { anim: { reduceMotion: true } });
    expect(srcs(doc).filter((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha).length).toBe(0);
  });

  it("is deterministic — identical output for identical inputs", async () => {
    const a = await render(1280, 708);
    const b = await render(1280, 708);
    expect(a.m0).toBe(b.m0);
    expect(srcs(a).length).toBe(srcs(b).length);
  });

  it("fail-fast: empty rows → error mosaic (not a throw)", async () => {
    const doc = (await AlpineCommitFeed.render({ rows: [] } as never, makeCtx(1280, 708))) as MosaicDocument;
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  });
});

describe("AlpineCommitFeed — two-mode reveal (F4 U-A5)", () => {
  const timeAlpha = (s: MosaicSource) => { const a = (s as { overlay?: { alpha?: string } }).overlay?.alpha; return a != null && /\bt\b/.test(String(a)); };
  const enableOf = (s: MosaicSource) => (s as { overlay?: { enable?: string } }).overlay?.enable;

  it("premium (default): every source ALPHA-fades (a geq) — no enable gates", async () => {
    const all = srcs(await render(1280, 708));
    expect(all.every(timeAlpha)).toBe(true);
    expect(all.some((s) => enableOf(s) != null)).toBe(false);
  });

  it("light: geq-free — zero time-alpha, every source enable-gated (cascade preserved)", async () => {
    const all = srcs(await render(1280, 708, { anim: { renderMode: "light" } }));
    expect(all.some(timeAlpha)).toBe(false);
    expect(all.every((s) => enableOf(s) != null)).toBe(true);
  });
});

describe("AlpineCommitFeed — local theming (F4 U-A5)", () => {
  const themedCtx = (tokens: Record<string, unknown>): MosaicEngineContext =>
    ({ mode: "render", target: { width: 1280, height: 708, fps: 30, durationMs: 3000 }, output: {}, media: {}, upstreamData: { theme: tokens } } as unknown as MosaicEngineContext);

  it("a producer theme recolors the card + titles; unthemed default does not carry those tokens", async () => {
    const plain = JSON.stringify(await render(1280, 708));
    expect(plain).not.toContain("#101820");
    const themed = JSON.stringify((await AlpineCommitFeed.render(AlpineCommitFeed.defaultProps as never, themedCtx({ surface: "#101820", textPrimary: "#00FFCC" }))) as MosaicDocument);
    expect(themed).toContain("#101820");
    expect(themed).toContain("#00FFCC");
  });

  it("an explicit accent still wins over a producer theme", async () => {
    const themed = JSON.stringify((await AlpineCommitFeed.render({ ...(AlpineCommitFeed.defaultProps as object), accent: "#123456" } as never, themedCtx({ accent: "#00FFCC" }))) as MosaicDocument);
    expect(themed).toContain("#123456");
  });
});
