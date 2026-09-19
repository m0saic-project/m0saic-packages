import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete } from "@m0saic/dsl";
import { AlpineLineChart } from "./line-chart";
import { ALPINE_PRESETS } from "../../_shared/alpine-theme";

const W = 1280;
const H = 800;

function makeCtx(durationMs = 2000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: W, height: H, fps: 30, durationMs },
    output: { width: W, height: H, fps: 30, durationMs, workspaceDir: "/tmp/alpine-line-chart" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const render = async (props: Record<string, unknown>, durationMs?: number) =>
  (await AlpineLineChart.render(props as never, makeCtx(durationMs))) as MosaicDocument;

const D = AlpineLineChart.defaultProps as Record<string, unknown>;

const srcs = (doc: MosaicDocument) => (doc.sources ?? []) as MosaicSource[];
const isText = (s: MosaicSource) => (s as { type?: string }).type === "text";
const isLabelText = (s: MosaicSource) => isText(s) && ((s as { layers?: unknown[] }).layers?.length ?? 0) === 1;
const isMask = (s: MosaicSource) => !!(s as { mask?: unknown }).mask;
const isCurtain = (s: MosaicSource) => (s as { overlay?: { xExpr?: string } }).overlay?.xExpr != null;

/** The line chart places every mark full-canvas (no child docs), so the m0's
 *  paint-frame count must equal the top-level source count. */
function expectFramesMatchSources(doc: MosaicDocument): void {
  expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  const parsed = parseM0StringComplete(doc.m0 as unknown as string, W, H);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe((doc.sources ?? []).length);
  expect((doc as { children?: unknown }).children).toBeUndefined();
}

describe("AlpineLineChart — metadata", () => {
  it("is the registered v1 primitive, deprecated in favor of v2", () => {
    expect(AlpineLineChart.id).toBe("@m0saic/alpine/line-chart/v1");
    expect(AlpineLineChart.version).toBe(1);
    expect(AlpineLineChart.primitive).toBe(true);
    const dep = (AlpineLineChart as { deprecated?: { replacement?: string } }).deprecated;
    expect(dep).toBeDefined();
    expect(dep?.replacement).toBe("@m0saic/alpine/line-chart/v2");
    expect(AlpineLineChart.tags).toEqual(expect.arrayContaining(["alpine", "line-chart", "data-viz"]));
  });

  it("no pinned lineColor default → falls through to the theme primary (themeable, still concrete)", async () => {
    expect(D.lineColor).toBeUndefined(); // unset so a preset/producer theme can recolor the line
    const doc = await render({ ...D });
    // unthemed light → the resolved line is the alpine light primary, a concrete hex.
    expect(JSON.stringify(doc)).toContain(ALPINE_PRESETS.light.primary);
  });
});

describe("AlpineLineChart — theming (F4 U-A1)", () => {
  const themedCtx = (tokens: Record<string, unknown>): MosaicEngineContext =>
    ({ mode: "render", target: { width: W, height: H, fps: 30, durationMs: 2000 }, output: { width: W, height: H, fps: 30, durationMs: 2000 }, media: {}, upstreamData: { theme: tokens } } as unknown as MosaicEngineContext);

  it("a producer theme recolors the card + line; unthemed default does not carry those tokens", async () => {
    const plain = JSON.stringify(await render({ ...D }));
    expect(plain).not.toContain("#101820");
    const themed = JSON.stringify((await AlpineLineChart.render(D as never, themedCtx({ surface: "#101820", accent: "#00FFCC" }))) as MosaicDocument);
    expect(themed).toContain("#101820"); // producer card
    expect(themed).toContain("#00FFCC"); // producer accent reaches the line
  });

  it("an explicit lineColor still wins over the producer accent", async () => {
    const themed = JSON.stringify((await AlpineLineChart.render({ ...D, lineColor: "#123456" } as never, themedCtx({ accent: "#00FFCC" }))) as MosaicDocument);
    expect(themed).toContain("#123456");
    expect(themed).not.toContain("#00FFCC");
  });
});

describe("AlpineLineChart — render shape", () => {
  it("renders a valid m0 document; frames match sources (full-canvas, no children)", async () => {
    const doc = await render({ ...D });
    expectFramesMatchSources(doc);
    expect(doc.backgroundColor).toBeDefined();
    expect(srcs(doc).some(isMask)).toBe(true); // line/area/markers are masked tiles
    expect(srcs(doc).some(isLabelText)).toBe(true); // value + category labels
  });

  for (const curve of ["smooth", "linear", "stepped"] as const) {
    it(`renders a valid document for curve=${curve}`, async () => {
      expectFramesMatchSources(await render({ ...D, curve }));
    });
  }

  it("animated default carries the curtain wipe (overlay.xExpr); reduceMotion has none", async () => {
    const animated = await render({ ...D });
    expect(srcs(animated).some(isCurtain)).toBe(true);

    const still = await render({ ...D, anim: { introFrac: 0.7, ease: "easeOut", reduceMotion: true } });
    expect(srcs(still).some(isCurtain)).toBe(false);
    expectFramesMatchSources(still);
  });

  it("is deterministic — identical inputs yield byte-identical m0", async () => {
    const a = await render({ ...D });
    const b = await render({ ...D });
    expect(a.m0).toBe(b.m0);
  });
});

describe("AlpineLineChart — tile efficiency (marks combined into single masks)", () => {
  it("tile count stays roughly FLAT as point count grows (N points add ~0 tiles)", async () => {
    const few = srcs(await render({ values: [1, 2, 3, 4, 5] })).length;
    const many = srcs(await render({ values: Array.from({ length: 40 }, (_, i) => i + 1) })).length;
    // Without combining, 40 points would add ~70 marker tiles; combined, the delta
    // is tiny (just the extra gridline/axis math, never per-point).
    expect(many - few).toBeLessThanOrEqual(4);
  });
});

describe("AlpineLineChart — labels", () => {
  it("decimates x-labels so dense labels never overlap (kept < provided)", async () => {
    const N = 24;
    const doc = await render({
      values: Array.from({ length: N }, (_, i) => i + 1),
      labels: Array.from({ length: N }, (_, i) => `Month${i}`),
      grid: { show: true, count: 4 },
    });
    expectFramesMatchSources(doc);
    const labelTexts = srcs(doc).filter(isLabelText).length;
    // 5 y-ticks + the kept x-labels; with 24 wide labels, far fewer than 24 are kept.
    expect(labelTexts).toBeLessThan(N);
  });

  it("shows every label when they comfortably fit", async () => {
    const doc = await render({ values: [3, 6, 4, 8], labels: ["A", "B", "C", "D"], grid: { show: false, count: 4 } });
    // no ticks (grid off) → all label texts are the 4 x-labels
    expect(srcs(doc).filter(isLabelText).length).toBe(4);
  });
});

describe("AlpineLineChart — edge cases", () => {
  it("clamps the smooth-curve overshoot for a run of zeros (valid, no crash)", async () => {
    expectFramesMatchSources(await render({ values: [12, 19, 15, 25, 22, 30, 28, 36, 0, 0, 0, 0, 0, 0, 0, 0] }));
  });

  it("handles all-zero, negatives, flat, single, and 2-point series", async () => {
    for (const v of [[0, 0, 0, 0], [-3, 4, -1, 6], [5, 5, 5, 5], [7], [4, 9]]) {
      expectFramesMatchSources(await render({ values: v }));
    }
  });

  it("toggling area / points / grid / labels stays valid", async () => {
    expectFramesMatchSources(await render({ ...D, area: { show: false } }));
    expectFramesMatchSources(await render({ ...D, points: { show: false } }));
    expectFramesMatchSources(await render({ ...D, grid: { show: false, count: 4 } }));
    expectFramesMatchSources(await render({ values: [3, 6, 4, 8] })); // no labels
  });

  it("explicit domain group (min/max) overrides the auto axis", async () => {
    // domain moved from flat minValue/maxValue → the `domain` group (F4 U-A1 prop-UX reorg).
    const auto = await render({ ...D });
    const fixed = await render({ ...D, domain: { minValue: 0, maxValue: 100 } });
    expectFramesMatchSources(fixed);
    // a wildly different explicit domain reshapes the plot → different m0.
    expect(fixed.m0).not.toBe(auto.m0);
  });

  it("rejects empty values with an error mosaic, not a throw", async () => {
    const doc = await render({ values: [] });
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  });
});
