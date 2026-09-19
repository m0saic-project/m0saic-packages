/**
 * Gate-33 (v1 prod cut) locks for `@m0saic/dsl-tutorial/v1`:
 * the width-fitted type (no clipped text at any canvas — the founder's
 * heads-up), the `debugLayout` contract THROUGH the nested panels, the
 * userIntent-only duration law (the 12s hint is not a pin), the format /
 * audio stamps, the chrome unit on portrait/square canvases, the inspector
 * auto-hide floor (the 480×270 source-count crash), and the pill / metric /
 * caption degrade ladders.
 */
import type { M0String } from "@m0saic/dsl";
import { parseM0StringComplete } from "@m0saic/dsl";
import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicMosaicSource,
  MosaicRenderableFile,
  MosaicSource,
  MosaicTextSource,
} from "@m0saic/types";
import { assertLayout, checkLayout, textEmUnits, auditDefaultProps } from "@m0saic/template-utils";
import { DslTutorial, chromeUnitPx, dslTutorialLayoutConstraints } from "./dsl-tutorial";
import { fitStatusMetrics, fitHeaderPills, stepPillModelText } from "./panels/chrome/v1/dsl-chrome";
import { fitNarrationLines } from "./panels/dsl-string/v1/dsl-string";
import { inspectorTypeRamp } from "./panels/inspector/v1/dsl-inspector";
import { tileLabelType } from "./panels/canvas/v1/dsl-canvas";
import { PROSE_EM, DIGIT_EM, CAPS_EM, textWidthPx, m0GlyphEm, fitBudget } from "./_shared/text-fit";
import { buildSteps } from "./pipeline/buildSteps";
import { SLOTH_TARGET_MS, SUMMARIZE_TARGET_MS, autoSpeed, computeTiming, resolveTier, tierTiming } from "./pipeline/timing";

function makeCtx(W = 1920, H = 1080, opts: { durationMs?: number; pin?: number } = {}): MosaicEngineContext {
  const target = { width: W, height: H, fps: 30, durationMs: opts.durationMs ?? 12000 };
  return {
    mode: "render" as const,
    target,
    output: { ...target, workspaceDir: "/tmp" },
    media: {},
    ...(opts.pin ? { userIntent: { durationMs: opts.pin } } : {}),
    cache: { get: () => undefined, set: () => {}, getOrCompute: async (_k: string, fn: () => unknown) => fn() },
  } as unknown as MosaicEngineContext;
}

const m0 = (s: string) => s as M0String;
const asDoc = (f: MosaicRenderableFile): MosaicDocument => {
  expect(f.kind).toBe("mosaic_document");
  return f as MosaicDocument;
};
const render = (props: Partial<Parameters<typeof DslTutorial.render>[0]>, ctx = makeCtx()) =>
  DslTutorial.render({ ...DslTutorial.defaultProps!, ...props } as never, ctx).then(asDoc);
const child = (doc: MosaicDocument, ref: string): MosaicDocument => {
  const c = doc.children?.[ref] as MosaicDocument | undefined;
  if (!c) throw new Error(`no child ${ref}`);
  return c;
};
const refs = (doc: MosaicDocument): string[] =>
  doc.sources.filter((s) => (s as MosaicSource).type === "mosaic").map((s) => (s as MosaicMosaicSource).ref);
const textSources = (doc: MosaicDocument): MosaicTextSource[] =>
  doc.sources.filter((s) => (s as MosaicSource).type === "text") as MosaicTextSource[];
const labelled = (doc: MosaicDocument, label: string): MosaicTextSource[] =>
  textSources(doc).filter((s) => (s as { editor?: { label?: string } }).editor?.label === label);
const literal = (s: MosaicTextSource, i = 0): string => {
  const c = s.layers?.[i]?.content;
  return c?.kind === "literal" ? (c.text ?? "") : "";
};
const font = (s: MosaicTextSource, i = 0): number => s.layers?.[i]?.style?.fontSize ?? 0;
const frames = (doc: MosaicDocument, W: number, H: number) => {
  const p = parseM0StringComplete(String(doc.m0), W, H);
  if (!p.ok) throw new Error(p.error?.message);
  return p.ir.renderFrames.slice().sort((a, b) => a.logicalIndex - b.logicalIndex);
};
const DENSE = m0(`10(${Array(10).fill("10[F,F,F,F,F,F,F,F,F,F]").join(",")})`);
const DEFAULT_M0 = "4[4(F,F,F,F),4(>,F,>,F),3(2[F,F],3[F,F,F],2[F,F]),4(F,F,F,F)]";
const DEFAULT_STEPS = buildSteps(DEFAULT_M0, 1920, 1080).steps.length;
// The default lesson at 1× — and what it actually renders at: 61 steps sits above the
// 24-step auto-pacing unit, so unpinned it reads at √(61/24) ≈ 1.6× (teach cap 2×).
const NATURAL_DEFAULT_MS = computeTiming(DEFAULT_STEPS, 1).durationMs;
const AUTO_DEFAULT_MS = tierTiming({ tier: "teach", stepCount: DEFAULT_STEPS, fps: 30 }).durationMs;

describe("DslTutorial — gate 33 stamps + duration law", () => {
  it("declares the video/mp4 format and audio off (gate-26 convention)", async () => {
    const doc = await render({});
    expect(doc.format).toEqual({ kind: "video", container: "mp4" });
    expect(doc.audio).toEqual({ mode: "off" });
    expect(DslTutorial.outputHints?.format).toEqual({ kind: "video", container: "mp4" });
  });

  it("authors the walk's NATURAL length; the 12s output hint is not a pin (Q1 law)", async () => {
    const doc = await render({});
    expect(DEFAULT_STEPS).toBe(61);
    expect(NATURAL_DEFAULT_MS).toBe(56300); // 0.5 + 61 steps × 0.9 + 0.9
    expect(AUTO_DEFAULT_MS).toBe(35867); // auto-paced at ≈1.6×
    expect(doc.durationMs).toBe(AUTO_DEFAULT_MS);
    // A different host-seeded target still isn't a pin.
    expect((await render({}, makeCtx(1920, 1080, { durationMs: 7000 }))).durationMs).toBe(AUTO_DEFAULT_MS);
  });

  it("SUMMARIZE tier (≤ 8,000 chars): the whole walk fits 30 s with an absolute closing hold, the camera stays on the full layout, the scaffolding is light", async () => {
    const GRID20 = m0(`20(${Array(20).fill(`20[${Array(20).fill("F").join(",")}]`).join(",")})`);
    expect(String(GRID20).length).toBeGreaterThan(400);
    expect(resolveTier(String(GRID20).length)).toBe("summarize");
    const doc = await render({ M0String: GRID20 });
    expect(doc.durationMs).toBe(SUMMARIZE_TARGET_MS);
    const canvasSrc = doc.sources.find((s) => (s as { ref?: string }).ref === "canvas") as { effects?: { camera?: unknown } } | undefined;
    expect(canvasSrc?.effects?.camera).toBeUndefined(); // fit-to-panel: no chase
    const canvas = child(doc, "canvas");
    const graphs = canvas.sources.map((s) => (s as { lavfi?: string }).lavfi ?? "");
    expect(graphs.some((g) => g.includes("@0.35"))).toBe(true); // light dividers
    expect(graphs.some((g) => g.includes("@0.9:t=fill"))).toBe(false);
    // An explicit speed or a pin still wins over the tier.
    expect((await render({ M0String: GRID20, speedMultiplier: 1 })).durationMs).toBe(computeTiming(883, 1).durationMs);
    expect((await render({ M0String: GRID20 }, makeCtx(1920, 1080, { pin: 12000 }))).durationMs).toBe(12000);
  });

  it("SLOTH tier: ~20 s, no split scaffolding — labels stay size-driven (the frame number is the smallest useful signal) — and `tier` forces it on any layout", async () => {
    const doc = await render({ M0String: DENSE, tier: "sloth" });
    expect(doc.durationMs).toBe(SLOTH_TARGET_MS);
    const canvas = child(doc, "canvas");
    const graphs = canvas.sources.map((s) => (s as { lavfi?: string }).lavfi ?? "");
    expect(graphs.some((g) => g.includes("@0.35") || g.includes("@0.9:t=fill"))).toBe(false); // no dividers
    expect(canvas.sources.some((s) => s.type === "text")).toBe(true); // 192×108 tiles: numbers (+ dims) still fit
    expect((doc.sources.find((s) => (s as { ref?: string }).ref === "canvas") as { effects?: unknown })?.effects).toBeUndefined();
    // …and forcing teach on the same layout restores the scaffolding + camera follow.
    const teach = await render({ M0String: DENSE, tier: "teach" });
    expect(child(teach, "canvas").sources.map((s) => (s as { lavfi?: string }).lavfi ?? "").some((g) => g.includes("@0.9:t=fill"))).toBe(true);
  });

  it("every nested panel carries the walk's authored length, not the 12s hint (unpinned children looped under the parent, 09-05)", async () => {
    for (const props of [{}, { M0String: DENSE }]) {
      const doc = await render(props);
      expect(doc.durationMs).not.toBe(12000);
      const kids = Object.entries(doc.children ?? {});
      expect(kids.length).toBeGreaterThanOrEqual(5);
      for (const [name, child] of kids) expect({ name, durationMs: child.durationMs }).toEqual({ name, durationMs: doc.durationMs });
    }
  });

  it("an explicit user ask (ctx.userIntent.durationMs) pins the walk exactly", async () => {
    const doc = await render({}, makeCtx(1920, 1080, { pin: 30000 }));
    expect(doc.durationMs).toBe(30000);
    // The pill reads the EFFECTIVE speed: natural ÷ pinned (56.3 s → 30 s ≈ 1.9×).
    const effective = Math.round((NATURAL_DEFAULT_MS / 30000) * 10) / 10;
    expect(child(doc, "chrome-header").sources.some((s) => JSON.stringify(s).includes(`Speed  ${effective.toFixed(1)}x`))).toBe(true);
  });

  it("speedMultiplier scales the natural length; the pill reads the EFFECTIVE auto speed unpinned", async () => {
    expect((await render({ speedMultiplier: 2 })).durationMs).toBe(computeTiming(DEFAULT_STEPS, 2).durationMs);
    const effective = NATURAL_DEFAULT_MS / AUTO_DEFAULT_MS;
    expect(effective).toBeGreaterThan(1.5);
    expect(child(await render({}), "chrome-header").sources.some((s) => JSON.stringify(s).includes(`Speed  ${(Math.round(effective * 10) / 10).toFixed(1)}x`))).toBe(true);
    expect(child(await render({ speedMultiplier: 1 }), "chrome-header").sources.some((s) => JSON.stringify(s).includes("Speed  1.0x"))).toBe(true);
  });

  it("TEACH tier (≤ 400 chars): auto pacing by step count, capped at 2× — the 100-tile grid reads at 2×, the 61-step default at ≈1.6× (founder direction 09-05)", async () => {
    const steps = buildSteps(DENSE, 1920, 1080).steps.length;
    expect(steps).toBe(243);
    expect(resolveTier(String(DENSE).length)).toBe("teach");
    expect(autoSpeed(steps)).toBeGreaterThan(2); // √(243/24) ≈ 3.2 — but teach is for READING…
    const auto = 2; // …so it caps at 2×
    const doc = await render({ M0String: DENSE });
    expect(doc.durationMs).toBe(computeTiming(steps, auto).durationMs);
    // The pill shows the EFFECTIVE speed (baseline ÷ actual; lead/trail are not sped up), so ~2.0x here.
    const effective = computeTiming(steps, 1).durationMs / (doc.durationMs ?? 1);
    expect(effective).toBeGreaterThan(1.9);
    expect(child(doc, "chrome-header").sources.some((s) => JSON.stringify(s).includes(`Speed  ${(Math.round(effective * 10) / 10).toFixed(1)}x`))).toBe(true);
    // An explicit speed is ABSOLUTE (bypasses auto) — on the default lesson too.
    expect((await render({ M0String: DENSE, speedMultiplier: 1 })).durationMs).toBe(computeTiming(steps, 1).durationMs);
    expect((await render({})).durationMs).toBe(AUTO_DEFAULT_MS);
    expect((await render({ speedMultiplier: 1 })).durationMs).toBe(NATURAL_DEFAULT_MS);
  });

  it("defaultProps are COMPLETE: every optional knob shows its effective default (founder ruling 09-05)", async () => {
    expect(auditDefaultProps(DslTutorial)).toEqual([]);
    expect(DslTutorial.defaultProps).toEqual({
      M0String: DEFAULT_M0,
      tier: "auto",
      preset: "light",
      title: "DSL Tutorial",
      stepEvents: "enter+leaf",
      canvasWidth: 1920,
      canvasHeight: 1080,
      showCanvas: true,
      showInspector: true,
      showDslString: true,
      showChrome: true,
      debugLayout: false,
    });
    // cameraZoom is the one deliberate unset (AUTO) — its placeholder says so.
    expect(DslTutorial.propsSchema?.cameraZoom?.meta?.control?.placeholder).toBe("auto");
    // The explicit defaults render byte-identical to the render()-side fallbacks.
    const explicit = await DslTutorial.render({ ...DslTutorial.defaultProps! } as never, makeCtx()).then(asDoc);
    const implicit = await DslTutorial.render({ M0String: m0(DEFAULT_M0) } as never, makeCtx()).then(asDoc);
    expect(JSON.stringify(explicit)).toBe(JSON.stringify(implicit));
  });

  it("header title defaults to the template's own name, not the deprecated sibling's", async () => {
    const header = child(await render({}), "chrome-header");
    expect(literal(labelled(header, "header-title")[0])).toBe("DSL Tutorial");
  });
});

describe("DslTutorial — width-fitted type (no clipped text)", () => {
  const CANVASES: [number, number][] = [[1920, 1080], [1280, 720], [1080, 1920], [1080, 1080], [3840, 2160], [640, 360], [480, 270]];

  it.each(CANVASES)("the layout contract holds through the nested panels at %i×%i", async (W, H) => {
    const ctx = makeCtx(W, H);
    const doc = await render({}, ctx);
    const show = { chrome: true, dslString: true, inspector: refs(doc).includes("inspector") };
    expect(() => assertLayout(doc, ctx, String(DslTutorial.id), { constraints: dslTutorialLayoutConstraints(show) })).not.toThrow();
  });

  it.each([[1920, 1080], [1080, 1920], [640, 360]])("holds on a passthrough + overlay layout at %i×%i", async (W, H) => {
    const ctx = makeCtx(W, H);
    const doc = await render({ M0String: m0("4[4(F,F,F,F),4(>,F,>,F),3(2[F,F],3[F,F,F],2[F,F]),4(F,F,F,F)]{F}") }, ctx);
    const show = { chrome: true, dslString: true, inspector: refs(doc).includes("inspector") };
    expect(() => assertLayout(doc, ctx, String(DslTutorial.id), { constraints: dslTutorialLayoutConstraints(show) })).not.toThrow();
  });

  it("holds on the 100-tile grid (paged strip, 5-digit-free values, long narrations)", async () => {
    const ctx = makeCtx(1920, 1080);
    const doc = await render({ M0String: DENSE }, ctx);
    expect(() => assertLayout(doc, ctx, String(DslTutorial.id), { constraints: dslTutorialLayoutConstraints({ chrome: true, dslString: true, inspector: true }) })).not.toThrow();
  });

  it("debugLayout renders the contract wireframe with a passing stamp", async () => {
    const doc = await render({ debugLayout: true });
    const stamp = (doc.editor as { layoutContract?: { ok: boolean; constraintCount: number; violations: unknown[] } })?.layoutContract;
    expect(stamp?.ok).toBe(true);
    expect(stamp?.constraintCount).toBe(11);
    expect(doc.children).toBeUndefined(); // the wireframe, not the tutorial
  });

  it("a long header title shrinks to the cell, then ellipsizes at the floor — never clips", async () => {
    const long = "The m0 DSL geometry walk, a step-by-step tutorial for absolute beginners";
    const header = child(await render({ title: long }), "chrome-header");
    const title = labelled(header, "header-title")[0];
    const titleW = (26 / 113) * 1920;
    expect(font(title)).toBeLessThan(29);
    expect(font(title)).toBeGreaterThanOrEqual(Math.round(29 * 0.7)); // never below 70% of the design size…
    expect(literal(title).endsWith("…")).toBe(true); // …it ellipsizes instead
    expect(textWidthPx(literal(title), font(title), PROSE_EM)).toBeLessThanOrEqual(titleW);
    const tiny = labelled(child(await render({ title: long }, makeCtx(480, 270)), "chrome-header"), "header-title")[0];
    expect(literal(tiny).endsWith("…")).toBe(true);
  });

  it("portrait inspector values ('1080') fit their cell instead of clipping to '80'", async () => {
    const insp = child(await render({}, makeCtx(1080, 1920)), "inspector");
    const values = labelled(insp, "field-value");
    expect(values.length).toBe(8);
    const valueW = (24 / 64) * 216 * (10 / 12);
    for (const v of values) for (let i = 0; i < (v.layers?.length ?? 0); i++) {
      expect(textWidthPx(literal(v, i), font(v, i), DIGIT_EM)).toBeLessThanOrEqual(valueW);
    }
  });

  it("DSL strip: every glyph's modelled ink stays inside its column (no edge clip / overlap)", async () => {
    for (const s of ["2(2[F,F],2[F,F])", "4(>,F,>,F)", "3(F,F,F){F}"]) {
      const strip = child(await render({ M0String: m0(s) }), "dsl-string");
      const glyphs = textSources(strip).find((t) => (t.layers?.length ?? 0) === s.length && literal(t, 0) === s[0])!;
      const cellW = 1920 / s.length;
      for (let i = 0; i < s.length; i++) expect(m0GlyphEm(s[i]) * font(glyphs, i)).toBeLessThanOrEqual(cellW);
    }
  });

  it("narration: one font fits the longest line; lines still overflowing at the floor ellipsize", () => {
    const lines = ["Read split count — 2 rows.", "Emit tile 16 — 480×270 at (960, 810). Absorbs 480px donated by a passthrough. Claims 1 leftover remainder px (one of the fat tiles)."];
    const wide = fitNarrationLines(lines, 1920, 65);
    expect(wide.fontSize).toBeLessThanOrEqual(22); // the band's height-driven size…
    expect(wide.fontSize).toBeGreaterThanOrEqual(18); // …shrunk only as far as the longest line needs
    expect(textWidthPx(lines[1], wide.fontSize, PROSE_EM)).toBeLessThanOrEqual(fitBudget(1920 * 0.94));
    expect(wide.texts).toEqual(lines);
    const narrow = fitNarrationLines(lines, 480, 14);
    expect(narrow.fontSize).toBe(10);
    expect(narrow.texts[0]).toBe(lines[0]);
    expect(narrow.texts[1].endsWith("…")).toBe(true);
    expect(textWidthPx(narrow.texts[1], 10, PROSE_EM)).toBeLessThanOrEqual(fitBudget(480 * 0.94));
  });

  it("status strip: keeps all 8 metrics at 1080p, drops trailing metrics on a narrow strip", () => {
    const items = [
      { label: "canvas", value: "1920×1080" }, { label: "chars", value: "16" }, { label: "frames", value: "4" },
      { label: "passthroughs", value: "0" }, { label: "nulls", value: "0" }, { label: "groups", value: "3" },
      { label: "precision", value: "2×2" }, { label: "min feasible", value: "2×2 px" },
    ];
    expect(fitStatusMetrics(items, 1920, 13).items).toHaveLength(8);
    const narrow = fitStatusMetrics(items, 480, 9);
    expect(narrow.items.length).toBeLessThan(8);
    expect(narrow.items.map((i) => i.label)).toEqual(items.slice(0, narrow.items.length).map((i) => i.label));
    expect(narrow.font).toBeGreaterThanOrEqual(9);
  });

  it("header pills: full wording at 1080p, compact wording (`1.0x` · `N / N`) on a tiny canvas", () => {
    expect(fitHeaderPills("1.0x", 16, 1920, 16)).toEqual({ font: 16, compact: false });
    const tiny = fitHeaderPills("1.0x", 16, 480, 10);
    expect(tiny.compact).toBe(true);
    expect(stepPillModelText(16, true)).toBe("16 / 16");
    expect(stepPillModelText(16)).toBe("Step  16 / 16");
  });

  it("inspector type ramp caps every size by its cell (chip by the longest label)", () => {
    const fields = [{ name: "X" as const, valueVariants: [{ label: "16384", enableExpr: "1" }], changeEnable: "0" }];
    const chips = [{ label: "Overlay", enableExpr: "1" }];
    const ramp = inspectorTypeRamp(216, 65, fields, chips);
    expect(textWidthPx("Overlay", ramp.chipFont, PROSE_EM)).toBeLessThanOrEqual(fitBudget((16 / 72) * 216 * 0.8));
    expect(textWidthPx("16384", ramp.valueFont, DIGIT_EM)).toBeLessThanOrEqual(fitBudget((24 / 64) * 216 * (10 / 12)));
    expect(textWidthPx("INSPECTOR", ramp.titleFont, CAPS_EM)).toBeLessThanOrEqual(fitBudget((26 / 72) * 216) + 1);
    const wide = inspectorTypeRamp(384, 63, fields, chips);
    expect(wide.valueFont).toBe(29); // the height-driven size when the cell is wide enough
  });

  it("tile labels: number + dims fit the tile width; dims drop when they can't fit at the floor", () => {
    expect(tileLabelType(1, "960×540", 664, 378)).toEqual({ numFont: 84, dimFont: 34 });
    const thin = tileLabelType(40, "48×1080", 33, 756);
    expect(thin.dimFont).toBeNull();
    expect(textWidthPx("40", thin.numFont, DIGIT_EM)).toBeLessThanOrEqual(fitBudget(33 * 0.96));
  });
});

describe("DslTutorial — trail hold", () => {
  it("chips + narration hold their final state through the closing trail (no blank hold)", async () => {
    const doc = await render({});
    const endT = (doc.durationMs ?? 0) / 1000;
    const insp = child(doc, "inspector");
    const chipEnds = labelled(insp, "chip").map((s) => (s as { overlay?: { enable?: string } }).overlay?.enable ?? "");
    expect(chipEnds.some((e) => e.includes(`lt(t,${endT.toFixed(3)})`))).toBe(true);
    // Layers are DISTINCT lines in first-appearance order (the closing "Close
    // split" line first appears mid-walk), so look for the window, not the slot.
    const narration = labelled(child(doc, "dsl-narration"), "narration")[0];
    const narrationEnds = (narration.layers as Array<{ overlay?: { enable?: string } }>).map((l) => l.overlay?.enable ?? "");
    expect(narrationEnds.some((e) => e.includes(`lt(t,${endT.toFixed(3)})`))).toBe(true);
  });

  it("the axis (cols/rows) tag stays BLANK once the walk is back at the root — the hold never stretches a filtered window", async () => {
    const doc = await render({});
    const endT = (doc.durationMs ?? 0) / 1000;
    const insp = child(doc, "inspector");
    const axisChips = labelled(insp, "chip").filter((s) => ["cols", "rows"].includes(literal(s)));
    expect(axisChips.length).toBeGreaterThan(0);
    for (const c of axisChips) {
      expect((c as { overlay?: { enable?: string } }).overlay?.enable ?? "").not.toContain(`lt(t,${endT.toFixed(3)})`);
    }
  });
});

describe("DslTutorial — shell geometry", () => {
  it("chrome unit: landscape keeps 9/9/6/70/6 of the height; portrait sizes chrome off 3/4 of the width", async () => {
    expect(chromeUnitPx(1920, 1080)).toBe(1080);
    expect(chromeUnitPx(1080, 1920)).toBe(810);
    const land = frames(await render({}), 1920, 1080);
    expect(Math.round(land[0].height)).toBeGreaterThanOrEqual(97); // header ≈ 9% of 1080
    expect(Math.round(land[0].height)).toBeLessThanOrEqual(99);
    const port = frames(await render({}, makeCtx(1080, 1920)), 1080, 1920);
    expect(port[0].height).toBeLessThan(90); // ≈ 9% of 810, not of 1920
    expect(port[0].height).toBeGreaterThan(65);
  });

  it("auto-hides the inspector below a 140px slot (the 480×270 crash zone); the canvas takes the body", async () => {
    const tiny = await render({}, makeCtx(480, 270));
    expect(refs(tiny)).toEqual(["chrome-header", "dsl-string", "dsl-narration", "canvas", "chrome-status"]);
    expect(tiny.children?.inspector).toBeUndefined();
    const ok = await render({}, makeCtx(700, 394));
    expect(refs(ok)).toContain("inspector");
  });

  it("every child parses to exactly its source count at tiny canvases (no 0-size frames)", async () => {
    for (const [W, H] of [[480, 270], [320, 180], [640, 360], [1920, 200]] as [number, number][]) {
      const doc = await render({}, makeCtx(W, H));
      const fr = frames(doc, W, H);
      doc.sources.forEach((s, i) => {
        if ((s as MosaicSource).type !== "mosaic") return;
        const c = child(doc, (s as MosaicMosaicSource).ref);
        const p = parseM0StringComplete(String(c.m0), Math.round(fr[i].width), Math.round(fr[i].height));
        expect(p.ok).toBe(true);
        if (p.ok) expect(p.ir.renderFrames.length).toBe(c.sources.length);
      });
    }
  });

  it("checkLayout reports a real violation when a fitted string is forced past its cell", async () => {
    const doc = await render({});
    const header = child(doc, "chrome-header");
    const title = labelled(header, "header-title")[0];
    title.layers![0].style!.fontSize = 400; // sabotage: 18 chars × .62 × 400 ≫ the title cell
    const r = checkLayout(doc, { canvasW: 1920, canvasH: 1080, constraints: dslTutorialLayoutConstraints({ chrome: true, dslString: true, inspector: true }) });
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.label === "header-title" && v.rule === "text-fit")).toBe(true);
    expect(textEmUnits(literal(title))).toBe(12);
  });
});
