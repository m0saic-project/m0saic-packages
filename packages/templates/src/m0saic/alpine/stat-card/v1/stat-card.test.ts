import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { getComplexityMetricsFast, isValidM0String, parseM0StringComplete } from "@m0saic/dsl";
import { AlpineStatCard } from "./stat-card";
import { resolvePropBindings, type PropBindingResolution } from "@m0saic/template-utils";

const ASPECTS: [number, number, string][] = [
  [480, 480, "square"],
  [386, 277, "landscape-cell"],
  [464, 141, "wide-short-cell"],
];

function makeCtx(W: number, H: number, durationMs = 3000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: W, height: H, fps: 30, durationMs },
    output: { width: W, height: H, fps: 30, durationMs },
  } as unknown as MosaicEngineContext;
}
const render = (W: number, H: number, props: Record<string, unknown> = {}) =>
  AlpineStatCard.render({ ...(AlpineStatCard.defaultProps as object), ...props } as never, makeCtx(W, H)) as Promise<MosaicDocument>;

const srcs = (doc: MosaicDocument) => (doc.sources ?? []) as MosaicSource[];
const texts = (doc: MosaicDocument) =>
  srcs(doc)
    .filter((s) => (s as { type?: string }).type === "text")
    .flatMap((s) => ((s as { layers?: Array<{ content?: { text?: string } }> }).layers ?? []).map((l) => l.content?.text ?? ""));

describe("AlpineStatCard — metadata", () => {
  it("is the registered hero stat-card", () => {
    expect(AlpineStatCard.id).toBe("@m0saic/alpine/stat-card/v1");
    expect(AlpineStatCard.version).toBe(1);
    expect((AlpineStatCard as { deprecated?: unknown }).deprecated).toBeUndefined();
    expect(AlpineStatCard.tags).toEqual(expect.arrayContaining(["alpine", "stat-card", "kpi"]));
    // Default output is landscape 16:10, matching the Alpine pack siblings. The
    // band stack still composes at any aspect (see the render matrices below);
    // this only sets the standalone/preview shape.
    expect(AlpineStatCard.outputHints?.width).toBe(1280);
    expect(AlpineStatCard.outputHints?.height).toBe(800);
  });
});

describe("AlpineStatCard — renders at every cell aspect", () => {
  for (const [W, H, label] of ASPECTS) {
    it(`${label} ${W}x${H}: valid m0, frames match sources, copy present`, async () => {
      const doc = await render(W, H, { anim: { reduceMotion: true } });
      expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
      const parsed = parseM0StringComplete(doc.m0 as unknown as string, W, H);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe(srcs(doc).length);
      const t = texts(doc);
      expect(t).toEqual(expect.arrayContaining(["COMMITS", "1,243", "+12.4%", "vs last week"])); // label is upper-cased
    });
  }
});

describe("AlpineStatCard — icon slot (SVG-mask glyph on the chip; never a media asset)", () => {
  it("no icon → colored accent chip, no assets", async () => {
    const doc = await render(480, 480);
    expect(Object.keys((doc as { assets?: Record<string, unknown> }).assets ?? {}).length).toBe(0);
    // chip is a color tile (lavfi), never media.
    expect(srcs(doc).some((s) => (s as { type?: string }).type === "lavfi")).toBe(true);
    expect(srcs(doc).every((s) => (s as { type?: string }).type !== "media")).toBe(true);
  });

  it("iconPath → one extra masked glyph source (lavfi), still no media asset", async () => {
    // Baseline must clear the icon explicitly: defaults now ship the
    // "commits" glyph (founder ruling, gate 10).
    const noGlyph = srcs(await render(480, 480, { icon: undefined })).length;
    const doc = await render(480, 480, { icon: undefined, iconPath: "M1 1h10v10H1Z" });
    expect(Object.keys((doc as { assets?: Record<string, unknown> }).assets ?? {}).length).toBe(0);
    expect(srcs(doc).length).toBe(noGlyph + 1); // the masked glyph
    expect(srcs(doc).some((s) => JSON.stringify(s).includes("inline-mask"))).toBe(true);
    expect(srcs(doc).every((s) => (s as { type?: string }).type !== "media")).toBe(true);
  });
});

describe("AlpineStatCard — animation", () => {
  it("static when reduceMotion (no fade alpha on any source)", async () => {
    const doc = await render(480, 480, { anim: { reduceMotion: true } });
    const faded = srcs(doc).filter((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha);
    expect(faded.length).toBe(0);
  });

  it("down direction renders a red delta + sublabel without clipping the copy", async () => {
    const doc = await render(480, 480, { anim: { reduceMotion: true }, label: "Open Issues", value: "18,463", delta: "-4.3%", direction: "down" });
    const t = texts(doc);
    expect(t).toEqual(expect.arrayContaining(["OPEN ISSUES", "18,463", "-4.3%", "vs last week"]));
  });

  it("is deterministic — identical output for identical inputs", async () => {
    const a = await render(480, 480);
    const b = await render(480, 480);
    expect(a.m0).toBe(b.m0);
    expect(srcs(a).length).toBe(srcs(b).length);
  });

  it("inset-laundered placement escapes the coprime-pixel precision blowup with zero drift", async () => {
    // Exact placeRects pinned this card to 480×480 precision (100%, ~5.8K chars).
    // placeInsetPieces quantizes cells to a divisor lattice and recovers each
    // element's EXACT rect via placement.inset — the floor bounds at ~120
    // (previously: placeOptimizedPieces at the same bound but with ≈1–2px of
    // visual drift; now the painted geometry is byte-exact).
    const doc = await render(480, 480, { anim: { reduceMotion: true } });
    const { maxSplitX, maxSplitY } = getComplexityMetricsFast(doc.m0 as unknown as string).precision;
    expect(maxSplitX).toBeLessThanOrEqual(120);
    expect(maxSplitY).toBeLessThanOrEqual(120);
    // The recovery insets ride the sources (at 480² pitch 4, most rects are
    // off-lattice → at least one source carries placement.inset).
    const withInset = srcs(doc).filter(
      (s) => (s as { placement?: { inset?: unknown } }).placement?.inset != null,
    );
    expect(withInset.length).toBeGreaterThan(0);
  });
});

describe("AlpineStatCard — alpine-family conversion (F4 U-A0)", () => {
  const overlayA = (s: MosaicSource) => (s as { overlay?: { alpha?: string; enable?: string; yExpr?: string } }).overlay;
  it("light by default — alpine white card, no dark hero palette", async () => {
    const s = JSON.stringify(await render(480, 480));
    expect(s).toContain("#FFFFFF");    // alpine light card
    expect(s).not.toContain("#161b22"); // no dark hero card by default
  });
  it("premium (default): soft alpha fade reveal (the geq, best look)", async () => {
    const all = srcs(await render(480, 480));
    expect(all.some((s) => overlayA(s)?.alpha != null)).toBe(true);   // fade
    expect(all.some((s) => overlayA(s)?.yExpr != null)).toBe(false);  // no slide
  });
  it("light: geq-free slide-in — NO overlay.alpha; enable + yExpr (slide) present", async () => {
    const all = srcs(await render(480, 480, { renderMode: "light" }));
    expect(all.some((s) => overlayA(s)?.alpha != null)).toBe(false);
    expect(all.some((s) => overlayA(s)?.enable != null)).toBe(true);
    expect(all.some((s) => overlayA(s)?.yExpr != null)).toBe(true);
  });
  it("preset:dark + overrides reproduce the hero dark look (the beats pass these)", async () => {
    const s = JSON.stringify(await render(480, 480, { preset: "dark", backgroundColor: "#161b22", accent: "#3fb950" }));
    expect(s).toContain("#161b22"); // exact hero card
    expect(s).toContain("#3fb950"); // green accent
  });
  it("a producer theme overrides the card + value colors", async () => {
    const ctx = { mode: "render", target: { width: 480, height: 480, fps: 30, durationMs: 3000 }, output: {}, upstreamData: { theme: { surface: "#654321", textPrimary: "#abcdef" } } } as unknown as MosaicEngineContext;
    const s = JSON.stringify(await (AlpineStatCard.render(AlpineStatCard.defaultProps as never, ctx) as Promise<MosaicDocument>));
    expect(s).toContain("#654321");
    expect(s).toContain("#abcdef");
  });
});

describe("AlpineStatCard — geometry contract (debugGeometry)", () => {
  const stampOf = (doc: MosaicDocument) => (doc as { editor?: { geometryContract?: { ok: boolean; violations: unknown[]; canvas: { w: number; h: number } } } }).editor?.geometryContract;
  const errored = (doc: MosaicDocument) => srcs(doc).some((s) => (s as { engine?: { renderStatus?: string } }).engine?.renderStatus === "error");

  // Design square, the landscape cell that bit the audit (277 prime), and a
  // near-square BOTH-axes-prime canvas (hostile → placeInsetPieces degrades to
  // exact placement; the contract must still hold — degradation is exact intent).
  const CANVASES: [number, number, string][] = [
    [480, 480, "design square"],
    [386, 277, "landscape cell — the audit aspect that bit (277 prime)"],
    [383, 379, "near-square, both axes prime (hostile → exact)"],
  ];
  for (const [W, H, label] of CANVASES) {
    it(`holds at ${W}x${H} — ${label}`, async () => {
      const doc = await render(W, H, { anim: { reduceMotion: true }, debugGeometry: true });
      const stamp = stampOf(doc);
      expect(stamp).toBeDefined();
      expect(stamp!.ok).toBe(true);
      expect(stamp!.violations).toEqual([]);
      expect(stamp!.canvas).toEqual({ w: W, h: H });
      // NOT replaced by an error mosaic.
      expect(errored(doc)).toBe(false);
    });
  }

  it("holds with a masked icon glyph at the audit aspect (mask-scale guard exercised)", async () => {
    const doc = await render(386, 277, { anim: { reduceMotion: true }, debugGeometry: true, iconPath: "M1 1h22v22H1Z" });
    expect(stampOf(doc)?.ok).toBe(true);
    expect(errored(doc)).toBe(false);
  });

  it("off by default — no contract stamp, production path byte-identical", async () => {
    const doc = await render(480, 480, { anim: { reduceMotion: true } });
    expect(stampOf(doc)).toBeUndefined();
    const doc2 = await render(480, 480, { anim: { reduceMotion: true } });
    expect(doc.m0).toBe(doc2.m0); // determinism preserved; the wrapper is a no-op when off
  });
});

describe("AlpineStatCard — friendly `icon` knob over the raw iconPath agent prop", () => {
  // The agent-prop pattern (2026-08-20): the raw prop stores the code-friendly
  // SVG path and stays agent-scoped; the named knob drives the SAME value
  // through the shared alpine catalog. Raw wins when both are set.
  it("icon name renders the same doc as the equivalent raw iconPath", async () => {
    const { ALPINE_GLYPHS } = await import("../../_shared/alpine-glyphs");
    const viaName = await render(480, 480, { icon: "commits" });
    const viaRaw = await render(480, 480, { iconPath: ALPINE_GLYPHS.commits });
    expect(viaName.m0).toBe(viaRaw.m0);
    expect(JSON.stringify(viaName.sources)).toBe(JSON.stringify(viaRaw.sources));
  });

  it("raw iconPath WINS over the friendly name", async () => {
    const doc = await render(480, 480, { icon: "stars", iconPath: "M0 0h24v24H0Z" });
    expect(JSON.stringify(doc.sources)).toContain("M0 0h24v24H0Z");
  });

  it("an unknown icon name fails fast, naming the options", async () => {
    await expect(render(480, 480, { icon: "sparkles" })).rejects.toThrow(/unknown icon "sparkles".*commits/);
  });
});

describe("AlpineStatCard — first-open cover (mosaic-branding theme)", () => {
  const coverCtx = {
    mode: "render" as const,
    target: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    output: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    media: {},
  } as unknown as MosaicEngineContext;

  it("branded pane + the template's own default render INLINED as hero", async () => {
    expect(typeof AlpineStatCard.renderCover).toBe("function");
    const doc = (await AlpineStatCard.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    const s = JSON.stringify(doc.sources);
    expect(s).toContain("Stat Card");
    // Band variant: no conversation pane, just brand + title.
    expect(s).not.toContain("START HERE");
    expect(s).not.toContain('"type":"mosaic","ref":"cover');
  });

  it("cover is deterministic", async () => {
    const a = (await AlpineStatCard.renderCover!({} as never, coverCtx)) as MosaicDocument;
    const b = (await AlpineStatCard.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(a.m0).toBe(b.m0);
  });
});

describe("AlpineStatCard — prop bindings (Make inline edit)", () => {
  const schema = AlpineStatCard.propsSchema;
  const bindingsOf = async (props: Record<string, unknown> = {}, w = 480, h = 480) => {
    const doc = await render(w, h, props);
    return { doc, ...resolvePropBindings(doc, w, h, { propsSchema: schema }) };
  };
  const labelAt = (doc: MosaicDocument, i: number) => (srcs(doc)[i] as { editor?: { label?: string } }).editor?.label;
  const contentAt = (doc: MosaicDocument, i: number) =>
    (srcs(doc)[i] as { layers?: Array<{ content?: { kind?: string; text?: string } }> }).layers?.[0]?.content;
  const one = (r: PropBindingResolution, key: string) => {
    expect(r.byProp[key]).toHaveLength(1);
    const b = r.byProp[key][0];
    expect("index" in b).toBe(false);
    expect(b.childPath).toEqual([]);
    return b;
  };

  it("binds label / value / delta / sublabel, each to exactly one tagged root rect", async () => {
    const r = await bindingsOf();
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["accent", "backgroundColor", "delta", "label", "sublabel", "value"]);
    for (const k of ["label", "value", "delta", "sublabel"]) {
      expect(schema[k as keyof typeof schema]).toBeDefined();
      expect(labelAt(r.doc, one(r, k).sourceIndex)).toBe(`stat-${k}`);
    }
    // the binding survived the placement launderer (placeInsetPieces clones the source)
    expect(contentAt(r.doc, one(r, "label").sourceIndex)?.text).toBe("COMMITS");
  });

  it("keeps delta and sublabel bound on an empty card (double-click to ADD — the bands are always allocated)", async () => {
    const r = await bindingsOf({ delta: undefined, sublabel: undefined, direction: "flat" });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["accent", "backgroundColor", "delta", "label", "sublabel", "value"]);
    expect(contentAt(r.doc, one(r, "delta").sourceIndex)?.text).toBe(" ");
    expect(contentAt(r.doc, one(r, "sublabel").sourceIndex)?.text).toBe(" ");
  });

  it("count-up value binds the expr-text rect; reduceMotion binds the static one; every aspect × mode agrees", async () => {
    const anim = await bindingsOf();
    expect(contentAt(anim.doc, one(anim, "value").sourceIndex)?.kind).toBe("expr");
    const still = await bindingsOf({ anim: { reduceMotion: true } });
    const v = one(still, "value");
    expect(contentAt(still.doc, v.sourceIndex)?.kind).toBe("literal");
    expect(contentAt(still.doc, v.sourceIndex)?.text).toBe("1,243");
    for (const [w, h] of ASPECTS) {
      for (const renderMode of ["premium", "light"]) {
        const r = await bindingsOf({ renderMode, direction: "down" }, w, h);
        expect(r.rejected).toEqual([]);
        expect(Object.keys(r.byProp).sort()).toEqual(["accent", "backgroundColor", "delta", "label", "sublabel", "value"]);
      }
    }
  });

  it("accent → the chip tile; backgroundColor → the card surface (kind \"color\" — Make's picker); the text props stay kind \"string\"", async () => {
    const tileAt = (doc: MosaicDocument, i: number) => srcs(doc)[i] as { type?: string; color?: string; mask?: unknown };
    const r = await bindingsOf({ accent: "#ff0000", backgroundColor: "#000000" });
    expect(r.rejected).toEqual([]);
    const chip = one(r, "accent");
    expect(chip.kind).toBe("color");
    expect(tileAt(r.doc, chip.sourceIndex).type).toBe("lavfi");
    expect(tileAt(r.doc, chip.sourceIndex).color).toBe("#ff0000");
    expect(tileAt(r.doc, chip.sourceIndex).mask).toBeUndefined(); // the chip, not the glyph cut into it
    const surface = one(r, "backgroundColor");
    expect(surface.kind).toBe("color");
    expect(surface.sourceIndex).not.toBe(chip.sourceIndex);
    expect(tileAt(r.doc, surface.sourceIndex).type).toBe("lavfi");
    expect(tileAt(r.doc, surface.sourceIndex).color).toBe("#000000");
    for (const k of ["label", "value", "delta", "sublabel"]) expect(one(r, k).kind).toBe("string");
    // unset → still bound (the theme paints; double-click is the handle to SET a color)
    const d = await bindingsOf();
    expect(d.rejected).toEqual([]);
    expect(one(d, "accent").kind).toBe("color");
    expect(tileAt(d.doc, one(d, "accent").sourceIndex).color).toBe("#2563EB"); // alpine primary
    expect(one(d, "backgroundColor").kind).toBe("color");
  });

  it("never binds icon / iconPath (an SVG path blob), the enums, the glyph cut into the chip or the delta triangle (theme-derived)", async () => {
    const r = await bindingsOf({ iconPath: "M0 0h24v24H0z", accent: "#ff0000", backgroundColor: "#000000" });
    expect(r.rejected).toEqual([]);
    for (const k of ["icon", "iconPath", "direction", "renderMode", "preset"]) expect(r.byProp[k]).toBeUndefined();
    const bound = new Set(Object.values(r.byProp).flat().map((b) => b.sourceIndex));
    const unbound = srcs(r.doc).filter((s, i) => (s as { type?: string }).type === "lavfi" && !bound.has(i));
    expect(unbound).toHaveLength(2); // the glyph (GLYPH_COLOR) + the up-arrow (theme.positive) — both SVG-masked
    expect(unbound.every((s) => !!(s as { mask?: unknown }).mask)).toBe(true);
  });
});
