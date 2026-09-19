import type { MosaicEngineContext, MosaicDocument } from "@m0saic/types";
import { isValidM0String } from "@m0saic/dsl";
import { StatCard } from "./stat-card";
import "../../../theming/v1/theming"; // side-effect: registers @m0saic/theming/v1 for the self-seed tests

function ctx(targetH: number): MosaicEngineContext {
  return {
    mode: "render",
    // ctx.output is the top-level envelope (here 1080); ctx.target is THIS
    // card's canvas. The card must size off target, not output.
    target: { width: Math.round((targetH * 1920) / 1080), height: targetH, fps: 30, durationMs: 4000 },
    output: { width: 1920, height: 1080, target: undefined, format: undefined, audio: undefined, color: undefined },
  } as unknown as MosaicEngineContext;
}

// Top-level ctx (target === output), optionally carrying a producer's published
// theme block on the upstream channel (what applyTheme reads via
// ctx.upstreamData["theme"]).
function topCtx(upstreamTheme?: Record<string, unknown>): MosaicEngineContext {
  const target = { width: 1920, height: 1080, fps: 30, durationMs: 3000 };
  return {
    mode: "render",
    target,
    output: target,
    ...(upstreamTheme ? { upstreamData: { theme: upstreamTheme } } : {}),
  } as unknown as MosaicEngineContext;
}

type TextSrc = { type?: string; layers?: { style?: { fontColor?: string } }[] };
// Font color of the i-th source's first text layer (source order is deterministic:
// 0 surface-tile · 1 label · 2 value · 3 arrow(lavfi) · 4 delta-text · 5 sublabel
// for a default up-with-delta card — the surface tile paints the card as a real
// source because template_invocation flattening drops doc.backgroundColor
// (candidate 2026-08-06).
function fontColorAt(doc: MosaicDocument, i: number): string | undefined {
  const s = (doc.sources ?? [])[i] as TextSrc | undefined;
  return s?.layers?.[0]?.style?.fontColor;
}

function maxFont(doc: MosaicDocument): number {
  let m = 0;
  for (const s of (doc.sources ?? []) as { type?: string; layers?: { style?: { fontSize?: number } }[] }[]) {
    if (s.type !== "text") continue;
    for (const l of s.layers ?? []) {
      if (typeof l.style?.fontSize === "number") m = Math.max(m, l.style.fontSize);
    }
  }
  return m;
}

describe("stat-card sizing", () => {
  it("sizes fonts off ctx.target, not ctx.output (nested-slot correctness)", async () => {
    const big = maxFont((await StatCard.render({ label: "Score", value: "86.8" }, ctx(1080))) as MosaicDocument);
    const small = maxFont((await StatCard.render({ label: "Score", value: "86.8" }, ctx(216))) as MosaicDocument);
    expect(big).toBeGreaterThan(0);
    // Same output (1080), smaller target (216) → fonts scale DOWN with target.
    expect(small).toBeLessThan(big);
    // Proportional to target height (216/1080 = 0.2), not pinned to output.
    expect(small / big).toBeCloseTo(216 / 1080, 1);
  });
});

describe("stat-card theming (first applyTheme consumer)", () => {
  it("un-themed render uses the LOCAL_THEME fallback hexes verbatim (byte-identity)", async () => {
    const doc = (await StatCard.render(StatCard.defaultProps, topCtx())) as MosaicDocument;
    // Card surface resolves to theme.surface with backgroundColor unset.
    expect(doc.backgroundColor).toBe("#161b22"); // surface
    expect(fontColorAt(doc, 1)).toBe("#8b949e"); // label → textSecondary
    expect(fontColorAt(doc, 2)).toBe("#e6edf3"); // value → textPrimary
    expect(fontColorAt(doc, 4)).toBe("#3fb950"); // up-delta text → positive
    expect(fontColorAt(doc, 5)).toBe("#6e7681"); // sublabel → textMuted
  });

  it("overlays a producer's published tokens per-key (ctx.upstreamData.theme)", async () => {
    const doc = (await StatCard.render(
      StatCard.defaultProps,
      topCtx({ surface: "#123456", positive: "#00ff00", negative: "#ff0000" }),
    )) as MosaicDocument;
    expect(doc.backgroundColor).toBe("#123456"); // surface overridden
    expect(fontColorAt(doc, 4)).toBe("#00ff00"); // up-delta → producer.positive
    // A key the producer did NOT publish stays on the local fallback.
    expect(fontColorAt(doc, 2)).toBe("#e6edf3"); // value → textPrimary (unchanged)
  });

  it("routes a down-delta to theme.negative", async () => {
    const doc = (await StatCard.render(
      { ...StatCard.defaultProps, direction: "down", delta: "-2 (-5.6%)" },
      topCtx({ negative: "#ff0000" }),
    )) as MosaicDocument;
    expect(fontColorAt(doc, 4)).toBe("#ff0000"); // down-delta → producer.negative
  });

  it("an explicit backgroundColor:'none' still wins over theme.surface (nested-under-chrome path)", async () => {
    const doc = (await StatCard.render(
      { ...StatCard.defaultProps, backgroundColor: "none" },
      topCtx({ surface: "#123456" }),
    )) as MosaicDocument;
    expect(doc.backgroundColor).toBe("none");
  });
});

describe("stat-card theme self-seed (head — invokes the producer slug)", () => {
  it("self-seeds the m0saic dark preset when a slug is configured and nothing is upstream", async () => {
    const doc = (await StatCard.render(
      { ...StatCard.defaultProps, theme: { slug: "@m0saic/theming/v1", props: { preset: "dark" } } },
      topCtx(),
    )) as MosaicDocument;
    expect(doc.backgroundColor).toBe("#12111F"); // m0saic brand surface (≠ local #161b22)
    expect(fontColorAt(doc, 2)).toBe("#F5F5F7"); // m0saic textHi
  });

  it("self-seeds the light preset (light surface, dark text)", async () => {
    const doc = (await StatCard.render(
      { ...StatCard.defaultProps, theme: { slug: "@m0saic/theming/v1", props: { preset: "light" } } },
      topCtx(),
    )) as MosaicDocument;
    expect(doc.backgroundColor).toBe("#FFFFFF");
    expect(fontColorAt(doc, 2)).toBe("#12111F");
  });

  it("an upstream theme wins over self-seeding (child path, no producer invoked)", async () => {
    const doc = (await StatCard.render(
      { ...StatCard.defaultProps, theme: { slug: "@m0saic/theming/v1", props: { preset: "dark" } } },
      topCtx({ surface: "#abcdef" }),
    )) as MosaicDocument;
    expect(doc.backgroundColor).toBe("#abcdef"); // ctx present → seed skipped
  });
});

describe("stat-card determinism", () => {
  it("same props + ctx → byte-identical doc across two renders", async () => {
    const a = (await StatCard.render(StatCard.defaultProps, topCtx())) as MosaicDocument;
    const b = (await StatCard.render(StatCard.defaultProps, topCtx())) as MosaicDocument;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("the slide reveal emits enable-gated overlays, never an animated alpha (R4-clean)", async () => {
    const doc = (await StatCard.render(StatCard.defaultProps, topCtx())) as MosaicDocument;
    const overlays = (doc.sources ?? []).map((s) => (s as { overlay?: Record<string, unknown> }).overlay ?? {});
    // No source carries a time-animated overlay.alpha (the R4 per-frame geq fold).
    expect(overlays.every((o) => o.alpha === undefined)).toBe(true);
    // The revealed elements use a slide (yExpr) + native enable gate.
    const revealed = overlays.filter((o) => o.enable !== undefined);
    expect(revealed.length).toBeGreaterThan(0);
    expect(revealed.every((o) => typeof o.yExpr === "string")).toBe(true);
  });
});

describe("StatCard — first-open cover (mosaic-branding theme)", () => {
  const coverCtx = {
    mode: "render" as const,
    target: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    output: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    media: {},
  } as unknown as MosaicEngineContext;

  it("branded pane + the template's own default render INLINED as hero", async () => {
    expect(typeof StatCard.renderCover).toBe("function");
    const doc = (await StatCard.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    const s = JSON.stringify(doc.sources);
    expect(s).toContain("KPI Stat Card");
    // Band variant: no conversation pane, just brand + title.
    expect(s).not.toContain("START HERE");
    expect(s).not.toContain('"type":"mosaic","ref":"cover');
  });

  it("cover is deterministic", async () => {
    const a = (await StatCard.renderCover!({} as never, coverCtx)) as MosaicDocument;
    const b = (await StatCard.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(a.m0).toBe(b.m0);
  });
});

describe("StatCard — cover at the 290px native hint canvas (gate-17 keeper)", () => {
  it("tiny canvas degrades to hero + px-clamped brand band — never a blank cull", async () => {
    const tiny = {
      mode: "render" as const,
      target: { width: 760, height: 290, fps: 30, durationMs: 3000 },
      output: { width: 760, height: 290, fps: 30, durationMs: 3000 },
      media: {},
    } as unknown as MosaicEngineContext;
    const doc = (await StatCard.renderCover!({} as never, tiny)) as MosaicDocument;
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    const s = JSON.stringify(doc.sources);
    expect(s).toContain("KPI Stat Card");
    // The conversation pane bows out below the floor.
    expect(s).not.toContain("START HERE");
  });
});

// ── Prop bindings — each text rect is bound to the prop it displays ────────
import { resolvePropBindings, type PropBindingResolution } from "@m0saic/template-utils";

describe("stat-card prop bindings (Make inline edit)", () => {
  const schema = StatCard.propsSchema;
  const bindingsOf = async (props: Record<string, unknown>, c: MosaicEngineContext = topCtx()) => {
    const doc = (await StatCard.render(props as never, c)) as MosaicDocument;
    const r = resolvePropBindings(doc, c.target.width, c.target.height, { propsSchema: schema });
    return { doc, ...r };
  };
  const one = (r: PropBindingResolution, key: string) => {
    expect(r.byProp[key]).toHaveLength(1);
    const b = r.byProp[key][0];
    expect("index" in b).toBe(false);
    expect(b.childPath).toEqual([]);
    return b;
  };

  it("binds label / value / delta / sublabel, each to exactly one root rect", async () => {
    const r = await bindingsOf({ label: "Revenue", value: "$1.2M", delta: "+4.3%", sublabel: "vs last week" });
    expect(r.rejected).toEqual([]);
    // + backgroundColor: the surface tile (theme fallback) is bound too — see below
    expect(Object.keys(r.byProp).sort()).toEqual(["backgroundColor", "delta", "label", "sublabel", "value"]);
    for (const k of ["label", "value", "delta", "sublabel"]) {
      const b = one(r, k);
      // every propKey names a schema prop, and the binding rides the tagged source
      expect(schema[k as keyof typeof schema]).toBeDefined();
      const src = (r.doc.sources ?? [])[b.sourceIndex] as { editor?: { label?: string } };
      expect(src.editor?.label).toBe(`kpi-${k}`);
    }
  });

  it("keeps delta and sublabel bound on an empty card (double-click to ADD)", async () => {
    const r = await bindingsOf({ label: "Score", value: "86" });
    expect(r.rejected).toEqual([]);
    one(r, "delta");
    one(r, "sublabel");
    // no tag on the empty rects (the layout-contract join stays conditional)
    const dSrc = (r.doc.sources ?? [])[r.byProp.delta[0].sourceIndex] as { editor?: { label?: string } };
    expect(dSrc.editor?.label).toBeUndefined();
  });

  it("binds the same set for every direction and at a nested target", async () => {
    for (const direction of ["up", "down", "flat"]) {
      const r = await bindingsOf({ label: "L", value: "1", delta: "2%", direction });
      expect(r.rejected).toEqual([]);
      expect(Object.keys(r.byProp).sort()).toEqual(["backgroundColor", "delta", "label", "sublabel", "value"]);
    }
    const nested = await bindingsOf({ label: "L", value: "1", delta: "2%" }, ctx(216));
    expect(nested.rejected).toEqual([]);
    expect(Object.keys(nested.byProp).sort()).toEqual(["backgroundColor", "delta", "label", "sublabel", "value"]);
  });

  it("backgroundColor → the surface tile (kind color, source 0); theme fallback still binds (ADD); 'none' → no tile → no binding", async () => {
    const colorAt = (doc: MosaicDocument, i: number) => ((doc.sources ?? [])[i] as { color?: string }).color;
    // prop unset → the tile paints theme.surface and is STILL bound: the handle to ADD an explicit color
    const themed = await bindingsOf({ label: "L", value: "1" });
    expect(themed.rejected).toEqual([]);
    const bg = one(themed, "backgroundColor");
    expect(bg.kind).toBe("color");
    expect(bg.sourceIndex).toBe(0);
    expect(colorAt(themed.doc, 0)).toBe("#161b22"); // LOCAL_THEME.surface
    // an explicit color paints (and binds) the same tile; the picker seeds from it
    const explicit = await bindingsOf({ label: "L", value: "1", backgroundColor: "#fedcba" });
    expect(explicit.rejected).toEqual([]);
    expect(colorAt(explicit.doc, one(explicit, "backgroundColor").sourceIndex)).toBe("#fedcba");
    // "none" (transparent under card-chrome) → no surface tile → no rect → no binding (never add a rect)
    const none = await bindingsOf({ label: "L", value: "1", backgroundColor: "none" });
    expect(none.rejected).toEqual([]);
    expect(none.byProp.backgroundColor).toBeUndefined();
    expect(Object.keys(none.byProp).sort()).toEqual(["delta", "label", "sublabel", "value"]);
    expect(((none.doc.sources ?? [])[0] as { type?: string }).type).toBe("text"); // the label leads: no surface tile
    // the text bindings are untouched by the surface tile's presence
    expect(none.byProp.label[0].sourceIndex).toBe(themed.byProp.label[0].sourceIndex - 1);
  });
});
