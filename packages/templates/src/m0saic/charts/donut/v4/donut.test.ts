import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, getComplexityMetricsFast } from "@m0saic/dsl";
import { resolvePropBindings } from "@m0saic/template-utils";
import { DonutV4 } from "./donut";
import { subdivideForSweep } from "../v3/anim";
import { segmentsToAngles } from "../v3/geometry";

const W = 360;
const H = 360;

function makeCtx(width = W, height = H, durationMs = 2000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width, height, fps: 30, durationMs },
    output: { width, height, fps: 30, durationMs, workspaceDir: "/tmp/donut-v4" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const twoSeg = () => ({
  segments: [{ label: "Weekday Commits", value: 75 }, { label: "Weekend Commits", value: 25 }],
  centerValue: "247",
});

const render = async (props: Record<string, unknown>, ctx = makeCtx()) =>
  (await DonutV4.render(props as never, ctx)) as MosaicDocument;

const isText = (s: MosaicSource) => (s as { type?: string }).type === "text";
const maskOf = (s: MosaicSource) => (s as { mask?: { kind?: string; localPath?: string; bounds?: { width?: number; height?: number } } }).mask;
const boundsArea = (s: MosaicSource) => { const b = maskOf(s)?.bounds; return b ? (b.width ?? 0) * (b.height ?? 0) : 0; };

describe("DonutV4 — metadata", () => {
  it("is the registered v4 primitive (not deprecated)", () => {
    expect(DonutV4.id).toBe("@m0saic/charts/donut/v4");
    expect(DonutV4.version).toBe(4);
    expect((DonutV4 as { deprecated?: unknown }).deprecated).toBeUndefined();
    expect(DonutV4.tags).toEqual(expect.arrayContaining(["data-viz", "donut", "animated"]));
  });
});

describe("DonutV4 — document shape", () => {
  it("renders a valid m0 with one source per placed cell", async () => {
    const doc = await render(twoSeg());
    expect(isValidM0String(String(doc.m0))).toBe(true);
    const sliverCount = subdivideForSweep(segmentsToAngles([75, 25])).length;
    // base canvas tile + slivers + value text (letterbox adds no sources). The
    // tile paints the surface color as a real source: template_invocation
    // flattening drops doc.backgroundColor (candidate 2026-08-06).
    expect(doc.sources?.length).toBe(sliverCount + 2);
  });

  it("fails fast on empty segments", async () => {
    await expect(render({ segments: [] })).rejects.toThrow();
  });
});

describe("DonutV4 — RATIO precision (the v4 win: self-framed coarse-quantize)", () => {
  const precAt = async (w: number, h: number) => {
    const d = await render(twoSeg(), makeCtx(w, h));
    const m = getComplexityMetricsFast(String(d.m0));
    return { x: m.precision.maxSplitX, y: m.precision.maxSplitY };
  };
  it("premium sweep precision stays bounded on any canvas — even coprime dims", async () => {
    const BOUND = 160; // ~ SWEEP_DIVISIONS (48) for the ring + ≤100 for the letterbox
    for (const [w, h] of [[360, 360], [720, 720], [1280, 800], [1001, 733], [2560, 1600]] as const) {
      const p = await precAt(w, h);
      expect(p.x).toBeLessThanOrEqual(BOUND);
      expect(p.y).toBeLessThanOrEqual(BOUND);
    }
  });
  it("precision does NOT scale with canvas (2× resolution ⇒ not 2× precision)", async () => {
    const lo = await precAt(360, 360);
    const hi = await precAt(720, 720);
    expect(hi.x).toBeLessThanOrEqual(lo.x + 8); // flat, not doubled (v3 doubled: 360→720)
    expect(hi.y).toBeLessThanOrEqual(lo.y + 8);
  });
});

describe("DonutV4 — tight bbox masks (kept from v3)", () => {
  it("ring tiles are inline-masked AND bounded smaller than the full frame", async () => {
    const doc = await render(twoSeg());
    // sources[0] is the base canvas tile (unmasked by design) — ring starts after it.
    const ring = doc.sources!.slice(1).filter((s) => !isText(s));
    expect(ring.length).toBeGreaterThan(0);
    for (const s of ring) {
      const m = maskOf(s);
      expect(m?.kind).toBe("inline-mask");
      expect(m?.localPath).toContain("A "); // arc commands
    }
    const full = W * H;
    expect(ring.every((s) => boundsArea(s) < full)).toBe(true);
    const areas = ring.map(boundsArea).sort((a, b) => a - b);
    expect(areas[Math.floor(areas.length / 2)]).toBeLessThan(full * 0.5); // slivers stay tight-ish
  });

  it("the smaller segment gets the smaller cell (static)", async () => {
    const doc = await render({ ...twoSeg(), anim: { reduceMotion: true, countUp: false } });
    const ring = doc.sources!.slice(1).filter((s) => !isText(s));
    expect(ring.length).toBe(2);
    const areas = ring.map(boundsArea);
    expect(Math.min(...areas)).toBeLessThan(Math.max(...areas));
  });
});

describe("DonutV4 — content", () => {
  it("derives the center value from the sum when absent (static)", async () => {
    const doc = await render({ segments: [{ label: "a", value: 30 }, { label: "b", value: 70 }], anim: { reduceMotion: true, countUp: false } });
    expect(JSON.stringify(doc.sources!.filter(isText))).toContain("100");
  });

  it("percent labels + caption add their own tight cells", async () => {
    const base = await render({ ...twoSeg(), anim: { reduceMotion: true, countUp: false } });
    const withExtras = await render({ ...twoSeg(), segmentLabels: "percent", centerLabel: "Total Commits", anim: { reduceMotion: true, countUp: false } });
    expect((withExtras.sources?.length ?? 0)).toBeGreaterThan(base.sources?.length ?? 0);
  });
});

describe("DonutV4 — light mode (composable; unchanged from v3)", () => {
  const light = () => ({ ...twoSeg(), renderMode: "light" });

  it("light m0 is a RATIO overlay stack (no placeRects split)", async () => {
    const m0 = String((await render(light())).m0);
    expect(isValidM0String(m0)).toBe(true);
    expect(m0.includes("[")).toBe(false);
    expect(/^[0-9{}]+$/.test(m0)).toBe(true);
  });

  it("light stays shallow (≤ MAX_SEGMENTS + text)", async () => {
    expect(((await render(light())).sources ?? []).length).toBeLessThanOrEqual(12);
  });

  it("light reveals via a slight overlay.alpha fade (no enable gates)", async () => {
    const doc = await render(light());
    expect((doc.sources ?? []).filter((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha).length).toBeGreaterThan(0);
    expect((doc.sources ?? []).some((s) => (s as { overlay?: { enable?: string } }).overlay?.enable)).toBe(false);
  });
});

describe("DonutV4 — theming (resolveThemeTokens consumer; unchanged)", () => {
  const PROD = {
    surfaceApp: "#101820", surface: "#182430", surfaceRaised: "#202c3a", surfaceInset: "#0a0f14",
    border: "#334455", borderStrong: "#556677", textPrimary: "#ffffff", textSecondary: "#c0c0c0", textMuted: "#8899aa", eyebrow: "#c0c0c0",
    accent: "#ff8800", accentSoft: "#ffaa33", accentGlow: "#ff8800", positive: "#00cc66", negative: "#ff3355",
    grid: "#ff00ff", gridAlpha: 1, axis: "#00ffcc", axisAlpha: 1, radius: 0.04,
    dataPalette: ["#aa11bb", "#00cc66", "#cc00ff", "#ffcc00", "#00ccff", "#ff0066"],
  };
  const withUpstream = (tokens: unknown) => { const c = makeCtx() as unknown as { upstreamData?: unknown }; c.upstreamData = { theme: tokens }; return c as unknown as MosaicEngineContext; };
  const uncolored = () => ({ segments: [{ label: "A", value: 60 }, { label: "B", value: 40 }], centerValue: "100", centerLabel: "Total" });

  it("determinism: two unthemed renders deep-equal", async () => {
    expect(JSON.stringify(await render(uncolored()))).toBe(JSON.stringify(await render(uncolored())));
  });

  it("byte-identity: unthemed uses the local palette + colors", async () => {
    const doc = await render(uncolored());
    const paint = JSON.stringify(doc.sources);
    expect(doc.backgroundColor).toBe("#161b22");
    expect(paint.includes("#f97316")).toBe(true);
    expect(paint.includes("#f5f5f4")).toBe(true);
    expect(paint.includes("#a8a29e")).toBe(true);
  });

  it("producer override flips surface / palette / text", async () => {
    const doc = await render(uncolored(), withUpstream(PROD));
    const paint = JSON.stringify(doc.sources);
    expect(doc.backgroundColor).toBe(PROD.surface);
    expect(paint.includes(PROD.dataPalette[0])).toBe(true);
    expect(paint.includes(PROD.textPrimary)).toBe(true);
  });

  it("explicit props still win over the producer theme", async () => {
    const doc = await render({ segments: [{ label: "A", value: 60, color: "#123abc" }, { label: "B", value: 40 }], centerValue: "100", backgroundColor: "#fedcba" }, withUpstream(PROD));
    expect(JSON.stringify(doc.sources).includes("#123abc")).toBe(true);
    expect(doc.backgroundColor).toBe("#fedcba");
  });
});

describe("DonutV4 — first-open cover (mosaic-branding theme)", () => {
  const coverCtx = {
    mode: "render" as const,
    target: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    output: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    media: {},
  } as unknown as MosaicEngineContext;

  it("branded pane + the template's own default render INLINED as hero", async () => {
    expect(typeof DonutV4.renderCover).toBe("function");
    const doc = (await DonutV4.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    const s = JSON.stringify(doc.sources);
    // Copy word-wraps across text sources — wrap-safe fragments only.
    expect(s).toContain("Donut");
    // Band variant: no conversation pane, just brand + title.
    expect(s).not.toContain("START HERE");
    expect(s).not.toContain('"type":"mosaic","ref":"cover');
  });

  it("cover is deterministic", async () => {
    const a = (await DonutV4.renderCover!({} as never, coverCtx)) as MosaicDocument;
    const b = (await DonutV4.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(a.m0).toBe(b.m0);
  });
});

describe("DonutV4 — prop bindings (Make inline edit)", () => {
  const schema = DonutV4.propsSchema;
  type Binding = ReturnType<typeof resolvePropBindings>["byProp"][string][number];
  type Resolved = { doc: MosaicDocument; byProp: Record<string, Binding[]> };
  const bindingsOf = async (props: Record<string, unknown>, c: MosaicEngineContext = makeCtx()) => {
    const doc = await render(props, c);
    return { doc, ...resolvePropBindings(doc, c.target.width, c.target.height, { propsSchema: schema }) };
  };
  const labelOf = (doc: MosaicDocument, b: Binding) => ((doc.sources ?? [])[b.sourceIndex] as { editor?: { label?: string } }).editor?.label;
  const colorOf = (doc: MosaicDocument, b: Binding) => ((doc.sources ?? [])[b.sourceIndex] as { color?: string }).color;
  const hasBinding = (s: MosaicSource) => !!(s as { editor?: { binding?: unknown } }).editor?.binding;
  const valueLeaves = (r: Resolved) => (r.byProp.segments ?? []).filter((b) => b.path?.[1] === "value");
  const colorLeaves = (r: Resolved) => (r.byProp.segments ?? []).filter((b) => b.path?.[1] === "color");
  // Exactly one root-doc rect, no index, tagged as expected (when a label is given).
  const one = (r: Resolved, key: string, label?: string) => {
    expect(r.byProp[key]).toHaveLength(1);
    const b = r.byProp[key][0];
    expect("index" in b).toBe(false);
    expect(b.childPath).toEqual([]);
    if (label !== undefined) expect(labelOf(r.doc, b)).toBe(label);
    return b;
  };
  const STATIC = { reduceMotion: true, countUp: false };

  for (const renderMode of ["premium", "light"] as const) {
    it(`${renderMode}: centerValue → center-value rect, centerLabel → center-label rect (root doc)`, async () => {
      const r = await bindingsOf({ ...twoSeg(), centerLabel: "Total Commits", renderMode, segmentLabels: "percent" });
      expect(r.rejected).toEqual([]);
      expect(Object.keys(r.byProp).sort()).toEqual(["backgroundColor", "centerLabel", "centerValue", "segments"]);
      one(r, "centerValue", "center-value");
      one(r, "centerLabel", "center-label");
      // TEXT rects bound: the two center rects plus one % label per wide-enough
      // slice (→ segments[i].value). COLOR tiles bound: the base canvas tile
      // (→ backgroundColor) and EVERY masked slice piece (→ segments[i].color —
      // one per segment in light / fade / static, several slivers each in the
      // premium sweep; 1:N is fine).
      const bound = (r.doc.sources ?? []).filter(hasBinding);
      const segLabels = (r.doc.sources ?? []).filter((s) => (s as { editor?: { label?: string } }).editor?.label === "seg-label");
      const masked = (r.doc.sources ?? []).filter((s) => !!maskOf(s));
      const boundText = bound.filter(isText);
      expect(boundText).toHaveLength(2 + segLabels.length);
      expect(boundText.every((s) => !maskOf(s))).toBe(true);
      expect(bound.length - boundText.length).toBe(1 + masked.length);
    });

    it(`${renderMode}: no caption → centerLabel unbound (no rect); value stays bound even when derived from the sum`, async () => {
      const r = await bindingsOf({ segments: [{ label: "a", value: 30 }, { label: "b", value: 70 }], renderMode, anim: STATIC });
      expect(r.rejected).toEqual([]);
      expect(r.byProp.centerLabel).toBeUndefined();
      // The derived "100" rect IS centerValue's rect — the double-click handle to set one.
      one(r, "centerValue", "center-value");
    });

    it(`${renderMode}: backgroundColor → the base canvas tile (kind color, source 0); theme fallback still binds (ADD); "none" → no tile → no binding`, async () => {
      const themed = await bindingsOf({ ...twoSeg(), renderMode, anim: STATIC });
      expect(themed.rejected).toEqual([]);
      const bg = one(themed, "backgroundColor");
      expect(bg.kind).toBe("color");
      expect(bg.sourceIndex).toBe(0);
      expect(colorOf(themed.doc, bg)).toBe("#161b22"); // LOCAL_THEME.surface — the tile Make would recolor
      // an explicit color paints (and binds) the same tile
      const explicit = await bindingsOf({ ...twoSeg(), renderMode, anim: STATIC, backgroundColor: "#fedcba" });
      expect(explicit.rejected).toEqual([]);
      expect(colorOf(explicit.doc, one(explicit, "backgroundColor"))).toBe("#fedcba");
      // "none" keeps the doc paint-free → no rect exists → no binding (never add a rect)
      const none = await bindingsOf({ ...twoSeg(), renderMode, anim: STATIC, backgroundColor: "none" });
      expect(none.rejected).toEqual([]);
      expect(none.byProp.backgroundColor).toBeUndefined();
      expect((none.doc.sources ?? []).some((s) => !isText(s) && !maskOf(s))).toBe(false);
    });
  }

  it("count-up (expr) value rect keeps its binding; the binding survives the letterbox on a coprime canvas", async () => {
    const r = await bindingsOf({ ...twoSeg(), centerLabel: "Total" }); // animated by default
    expect(r.rejected).toEqual([]);
    const v = one(r, "centerValue", "center-value");
    const src = (r.doc.sources ?? [])[v.sourceIndex] as { layers?: { content?: { kind?: string } }[] };
    expect(src.layers?.[0]?.content?.kind).toBe("expr");
    const odd = await bindingsOf({ ...twoSeg(), centerLabel: "Total" }, makeCtx(1001, 733));
    expect(odd.rejected).toEqual([]);
    one(odd, "centerValue", "center-value");
    one(odd, "centerLabel", "center-label");
  });

  it("segments[i].value → each % seg-label (the value's rendering on the ring); no legend in v4", async () => {
    for (const renderMode of ["premium", "light"] as const) {
      const r = await bindingsOf({ ...twoSeg(), renderMode, segmentLabels: "percent", centerLabel: "Total" });
      expect(r.rejected).toEqual([]);
      const segLabels = (r.doc.sources ?? []).filter((s) => (s as { editor?: { label?: string } }).editor?.label === "seg-label");
      expect(segLabels.length).toBeGreaterThan(0);
      // one `value` leaf per drawn % label (thin slices skip theirs), all numbers,
      // each addressing a real segment index
      const values = valueLeaves(r);
      expect(values).toHaveLength(segLabels.length);
      for (const b of values) {
        expect(b.kind).toBe("number");
        expect(typeof b.path![0]).toBe("number");
        expect((b.path![0] as number) < twoSeg().segments.length).toBe(true);
      }
      expect(new Set(values.map((b) => b.path![0])).size).toBe(segLabels.length);
      expect(segLabels.every(hasBinding)).toBe(true);
      // labels off → no % rect → no `value` leaf (never add a rect)
      const off = await bindingsOf({ ...twoSeg(), renderMode, segmentLabels: "none", centerLabel: "Total" });
      expect(off.rejected).toEqual([]);
      expect(valueLeaves(off)).toHaveLength(0);
    }
  });

  it("segments[i].color → every slice piece: one per segment (light; premium fade / static), each sliver in the premium sweep", async () => {
    const segments = [{ label: "A", value: 60, color: "#123abc" }, { label: "B", value: 40 }]; // B: palette fallback → still bound (ADD)
    const expectOneSlicePerSegment = (r: Resolved) => {
      const colors = colorLeaves(r);
      expect(colors.map((b) => ({ path: b.path, kind: b.kind, childPath: b.childPath }))).toEqual([
        { path: [0, "color"], kind: "color", childPath: [] },
        { path: [1, "color"], kind: "color", childPath: [] },
      ]);
      expect(colors.every((b) => b.index === undefined)).toBe(true);
      const masked = (r.doc.sources ?? []).filter((s) => !!maskOf(s));
      expect(masked).toHaveLength(2); // one masked tile per segment...
      expect(masked.every(hasBinding)).toBe(true); // ...each the handle for its segment's color
      expect(colorOf(r.doc, colors[0])).toBe("#123abc"); // explicit prop color
      expect(colorOf(r.doc, colors[1])).toBe("#fdba74"); // theme.dataPalette[1] fallback — bound all the same
    };
    // light: one masked tile per segment, animated or static
    const lightAnim = await bindingsOf({ segments, renderMode: "light" });
    expect(lightAnim.rejected).toEqual([]);
    expectOneSlicePerSegment(lightAnim);
    expectOneSlicePerSegment(await bindingsOf({ segments, renderMode: "light", anim: STATIC }));
    // premium static + per-segment fade: one piece per segment
    const premStatic = await bindingsOf({ segments, anim: STATIC });
    expect(premStatic.rejected).toEqual([]);
    expectOneSlicePerSegment(premStatic);
    expectOneSlicePerSegment(await bindingsOf({ segments, anim: { mode: "fade" } }));
    // premium sweep (Make's default): several slivers per segment — all painted
    // with that segment's color, so every sliver is its handle (1:N)
    const sweep = await bindingsOf({ segments });
    expect(sweep.rejected).toEqual([]);
    const slivers = (sweep.doc.sources ?? []).filter((s) => !!maskOf(s));
    expect(slivers.length).toBeGreaterThan(2);
    expect(slivers.every(hasBinding)).toBe(true);
    const leaves = colorLeaves(sweep);
    expect(leaves).toHaveLength(slivers.length);
    expect(new Set(leaves.map((b) => b.path![0]))).toEqual(new Set([0, 1])); // both segments reachable
    expect(leaves.every((b) => b.kind === "color" && b.childPath.length === 0)).toBe(true);
  });
});
