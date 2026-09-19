import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete } from "@m0saic/dsl";
import { resolvePropBindings } from "@m0saic/template-utils";
import { AlpineHeatmapV2 } from "./heatmap";

const W = 1280;
const H = 800;

function makeCtx(durationMs = 2000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: W, height: H, fps: 30, durationMs },
    output: { width: W, height: H, fps: 30, durationMs, workspaceDir: "/tmp/alpine-heatmap" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const render = async (props: Record<string, unknown>, durationMs?: number) =>
  (await AlpineHeatmapV2.render(props as never, makeCtx(durationMs))) as MosaicDocument;

const D = AlpineHeatmapV2.defaultProps as Record<string, unknown>;
const srcs = (doc: MosaicDocument) => (doc.sources ?? []) as MosaicSource[];
const colorOf = (s: MosaicSource) => (s as { color?: string }).color;
const effectsOf = (s: MosaicSource) => (s as { effects?: { rounding?: { borderRadius?: number } } }).effects;
const isText = (s: MosaicSource) => (s as { type?: string }).type === "text";
const textOf = (s: MosaicSource) => ((s as { layers?: Array<{ content?: { text?: string } }> }).layers ?? [])[0]?.content?.text;
const isTile = (s: MosaicSource) => (s as { type?: string }).type === "lavfi";
/** Heatmap cells are rounded lavfi tiles with importance 0 (the back layer). The
 *  legend swatches are also rounded tiles but carry importance 1 (front). We count
 *  tiles by the radius the call sites use; cells share the run's cellRadius. */
const tiles = (doc: MosaicDocument) => srcs(doc).filter(isTile);
const texts = (doc: MosaicDocument) => srcs(doc).filter(isText).map(textOf);

function expectFramesMatchSources(doc: MosaicDocument): void {
  expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  const parsed = parseM0StringComplete(doc.m0 as unknown as string, W, H);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe((doc.sources ?? []).length);
  expect((doc as { children?: unknown }).children).toBeUndefined();
}

/** Distinct cell-frame widths in the resolved m0 — the quantization regression guard.
 *  A correct grid renders every cell at one uniform width. */
function cellWidthHistogram(doc: MosaicDocument): Record<number, number> {
  const parsed = parseM0StringComplete(doc.m0 as unknown as string, W, H);
  if (!parsed.ok) return {};
  const counts: Record<number, number> = {};
  for (const f of parsed.ir.renderFrames) {
    const w = Math.round((f as { width: number }).width);
    counts[w] = (counts[w] ?? 0) + 1;
  }
  return counts;
}

describe("AlpineHeatmapV2 — metadata", () => {
  it("is the registered v1 primitive, not deprecated", () => {
    expect(AlpineHeatmapV2.id).toBe("@m0saic/alpine/heatmap/v2");
    expect(AlpineHeatmapV2.version).toBe(2);
    expect(AlpineHeatmapV2.primitive).toBe(true);
    expect((AlpineHeatmapV2 as { deprecated?: unknown }).deprecated).toBeUndefined();
    expect(AlpineHeatmapV2.tags).toEqual(expect.arrayContaining(["alpine", "heatmap", "data-viz"]));
  });
});

describe("AlpineHeatmapV2 — render shape", () => {
  it("renders valid m0; frames match sources; no children", async () => {
    const doc = await render({ ...D });
    expectFramesMatchSources(doc);
    expect(doc.backgroundColor).toBeDefined();
  });

  it("is deterministic — identical inputs yield byte-identical m0", async () => {
    expect((await render({ ...D })).m0).toBe((await render({ ...D })).m0);
  });

  it("emits one cell per rows×cols, including ragged-row empty cells", async () => {
    // 2 rows × 3 cols (the 2nd row is ragged → padded with empty cells).
    const doc = await render({ rows: [{ label: "a", values: [1, 2, 3] }, { label: "b", values: [4] }], showLegend: false, anim: { reduceMotion: true } });
    // 6 cells (+ 2 row labels). At least the 6 cell tiles are present.
    expect(tiles(doc).length).toBeGreaterThanOrEqual(6);
  });
});

describe("AlpineHeatmapV2 — grid geometry (quantization guard)", () => {
  it("renders every cell within one pixel of one width (the raw split's jitter, nothing more)", async () => {
    const doc = await render({ ...D });
    const hist = cellWidthHistogram(doc);
    // The 7×8 grid's 56 cells sit in the two most populous width buckets, and
    // those buckets are adjacent: the gutterless grid inherits the outer
    // split's ±1 px quantization jitter (latticeCellInset retargets the
    // painted cells onto an exact lattice — the "gaps are EXACT" test below is
    // what guards the picture). A wider spread would be real quantization.
    const buckets = Object.entries(hist)
      .map(([w, n]) => ({ w: Number(w), n }))
      .sort((a, b) => b.n - a.n);
    const top = buckets.slice(0, 2);
    expect(top.reduce((a, b) => a + b.n, 0)).toBeGreaterThanOrEqual(56);
    if (top.length === 2 && top[1].n > 0) expect(Math.abs(top[0].w - top[1].w)).toBeLessThanOrEqual(1);
  });

  it("inter-cell gaps are EXACT — every adjacent painted pair identical (lattice retargeting)", async () => {
    // Replays the engine's floor over each cell's placement.inset to get the
    // PAINTED rects (deprecated gridCellInset wobbled these ±1px per edge).
    const nRows = 7;
    const nCols = 8;
    for (const [cw, ch] of [
      [W, H],
      [1000, 700], // awkward dims — the wobble case for ideal-cell fractions
    ] as const) {
      const ctx = {
        mode: "render",
        target: { width: cw, height: ch, fps: 30, durationMs: 2000 },
        output: { width: cw, height: ch, fps: 30, durationMs: 2000, workspaceDir: "/tmp/alpine-heatmap" },
        media: {},
      } as unknown as MosaicEngineContext;
      const doc = (await AlpineHeatmapV2.render({ ...D } as never, ctx)) as MosaicDocument;
      const parsed = parseM0StringComplete(doc.m0 as unknown as string, cw, ch);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const frames = [...parsed.ir.renderFrames].sort(
        (a, b) => (a as { logicalIndex: number }).logicalIndex - (b as { logicalIndex: number }).logicalIndex,
      ) as Array<{ x: number; y: number; width: number; height: number }>;

      // The 56 cell tiles are the LONGEST consecutive run of rounded lavfi
      // sources (the card surface is 1, the legend swatches are `levels`).
      const sources = srcs(doc);
      const isRounded = (s: MosaicSource) => isTile(s) && !!effectsOf(s)?.rounding;
      let iCells = -1;
      let bestLen = 0;
      for (let i = 0; i < sources.length; i++) {
        if (!isRounded(sources[i])) continue;
        let j = i;
        while (j < sources.length && isRounded(sources[j])) j++;
        if (j - i > bestLen) {
          bestLen = j - i;
          iCells = i;
        }
        i = j;
      }
      expect(bestLen).toBe(nRows * nCols);

      type Side = { top: number; right: number; bottom: number; left: number };
      const painted = Array.from({ length: nRows * nCols }, (_, k) => {
        const f = frames[iCells + k];
        const inset = (sources[iCells + k] as { placement?: { inset?: Side } }).placement?.inset;
        const l = inset ? Math.floor(inset.left * f.width) : 0;
        const r = inset ? Math.floor(inset.right * f.width) : 0;
        const t = inset ? Math.floor(inset.top * f.height) : 0;
        const b = inset ? Math.floor(inset.bottom * f.height) : 0;
        return { x: f.x + l, y: f.y + t, w: f.width - l - r, h: f.height - t - b };
      });

      const xGaps = new Set<number>();
      const yGaps = new Set<number>();
      for (let r = 0; r < nRows; r++) {
        for (let c = 0; c + 1 < nCols; c++) {
          const a = painted[r * nCols + c];
          const b = painted[r * nCols + c + 1];
          xGaps.add(b.x - (a.x + a.w));
        }
      }
      for (let r = 0; r + 1 < nRows; r++) {
        for (let c = 0; c < nCols; c++) {
          const a = painted[r * nCols + c];
          const b = painted[(r + 1) * nCols + c];
          yGaps.add(b.y - (a.y + a.h));
        }
      }
      // Exactness = zero wobble: ONE gap value per axis, and it's a real gap.
      expect(xGaps.size).toBe(1);
      expect(yGaps.size).toBe(1);
      expect([...xGaps][0]).toBeGreaterThan(0);
      expect([...yGaps][0]).toBeGreaterThan(0);
      // Equal cells within the lattice's independent-rounding jitter.
      const widths = painted.map((p) => p.w);
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    }
  });
});

describe("AlpineHeatmapV2 — color scale", () => {
  it("buckets values: a zero/min cell uses the empty color, the max cell the full color", async () => {
    const doc = await render({ rows: [{ label: "", values: [0, 10] }], color: "#2563EB", emptyColor: "#EBEEF2", levels: 5, min: 0, max: 10, showLegend: false, anim: { reduceMotion: true } });
    const cols = tiles(doc).map((s) => (colorOf(s) ?? "").toUpperCase());
    expect(cols).toContain("#EBEEF2"); // the 0 cell
    expect(cols).toContain("#2563EB"); // the max cell at full intensity (scale round-trips to lowercase hex)
  });

  it("levels controls the legend swatch count (legend on → levels swatches present)", async () => {
    const off = await render({ ...D, showLegend: false });
    const on = await render({ ...D, showLegend: true, levels: 7 });
    expect(tiles(on).length).toBeGreaterThan(tiles(off).length);
  });
});

describe("AlpineHeatmapV2 — labels & legend", () => {
  it("row + column labels render; legend shows Less/More", async () => {
    const t = texts(await render({ ...D, anim: { reduceMotion: true } }));
    expect(t).toContain("Mon");
    expect(t).toContain("W1");
    expect(t).toContain("Less");
    expect(t).toContain("More");
  });

  it("showLegend:false drops the Less/More legend", async () => {
    const t = texts(await render({ ...D, showLegend: false, anim: { reduceMotion: true } }));
    expect(t).not.toContain("Less");
    expect(t).not.toContain("More");
  });
});

describe("AlpineHeatmapV2 — in-cell values", () => {
  it("showValues prints compact values; big numbers never render long-form", async () => {
    const t = texts(await render({ rows: [{ label: "", values: [4500, 38000, 1200000] }], showValues: true, showLegend: false, min: 0, anim: { reduceMotion: true } }));
    expect(t).toContain("4.5K");
    expect(t).toContain("38K");
    expect(t).toContain("1.2M");
    expect(t).not.toContain("1200000");
  });

  it("showValues:false prints no in-cell numbers", async () => {
    const t = texts(await render({ rows: [{ label: "", values: [5, 9] }], showValues: false, showLegend: false, anim: { reduceMotion: true } }));
    expect(t.filter((x) => x === "5" || x === "9")).toHaveLength(0);
  });
});

describe("AlpineHeatmapV2 — animation", () => {
  it("animated cells carry a fade overlay; reduceMotion cells are static", async () => {
    const animated = tiles(await render({ ...D }));
    const hasFade = animated.some((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha);
    expect(hasFade).toBe(true);
    const still = tiles(await render({ ...D, anim: { reduceMotion: true } }));
    const anyFade = still.some((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha);
    expect(anyFade).toBe(false);
  });
});

describe("AlpineHeatmapV2 — two-mode reveal (F4 U-A3)", () => {
  const timeAlpha = (s: MosaicSource) => { const a = (s as { overlay?: { alpha?: string } }).overlay?.alpha; return a != null && /\bt\b/.test(String(a)); };
  const enableOf = (s: MosaicSource) => (s as { overlay?: { enable?: string } }).overlay?.enable;

  it("premium (default): diagonal ALPHA-fade cascade (a geq per cell) — no enable gates", async () => {
    const cells = tiles(await render({ ...D }));
    expect(cells.some(timeAlpha)).toBe(true);
    expect(cells.some((s) => enableOf(s) != null)).toBe(false);
  });

  it("light: diagonal ENABLE-gate cascade — geq-free (zero time-alpha), one gate per cell", async () => {
    const all = srcs(await render({ ...D, anim: { ...(D.anim as object), renderMode: "light" } }));
    expect(all.some(timeAlpha)).toBe(false);              // no geq anywhere
    // the staggered enable gates carry the diagonal cascade order (one per cell)
    expect(all.filter((s) => enableOf(s) != null).length).toBeGreaterThanOrEqual(40);
  });

  it("light reveal keeps the render valid (frames match sources)", async () => {
    expectFramesMatchSources(await render({ ...D, anim: { ...(D.anim as object), renderMode: "light" } }));
  });
});

describe("AlpineHeatmapV2 — theming + scale group (F4 U-A3)", () => {
  const themedCtx = (tokens: Record<string, unknown>): MosaicEngineContext =>
    ({ mode: "render", target: { width: W, height: H, fps: 30, durationMs: 2000 }, output: { width: W, height: H, fps: 30, durationMs: 2000 }, media: {}, upstreamData: { theme: tokens } } as unknown as MosaicEngineContext);

  it("a producer theme recolors the card; unthemed default does not carry the token", async () => {
    const plain = JSON.stringify(await render({ ...D }));
    expect(plain).not.toContain("#101820");
    const themed = JSON.stringify((await AlpineHeatmapV2.render(D as never, themedCtx({ surface: "#101820" }))) as MosaicDocument);
    expect(themed).toContain("#101820");
  });

  it("an explicit scale color still wins over a producer theme", async () => {
    const themed = JSON.stringify((await AlpineHeatmapV2.render({ ...D, color: "#123456" } as never, themedCtx({ accent: "#00FFCC" }))) as MosaicDocument);
    expect(themed).toContain("#123456");
  });

  it("scale group (min/max/cellRadius) drives the buckets & rounding", async () => {
    // moved from flat min/max/cellRadius → the `scale` group (F4 U-A3 prop-UX reorg).
    // Geometry (m0) is domain-independent; the bucket FILLS (source colors) are not.
    const fills = (d: MosaicDocument) => tiles(d).map(colorOf).join(",");
    const wide = await render({ ...D, scale: { min: 0, max: 1000 } });
    const narrow = await render({ ...D, scale: { min: 0, max: 5 } });
    expect(fills(wide)).not.toBe(fills(narrow)); // different domain → different bucket fills
    expectFramesMatchSources(await render({ ...D, scale: { cellRadius: 0.5 } }));
  });
});

describe("AlpineHeatmapV2 — inputs & edge cases", () => {
  it("accepts CSV-string row values (the objectRows editor shape)", async () => {
    const doc = await render({ rows: [{ label: "x", values: "1, 2, 3, 4" }], showLegend: false, anim: { reduceMotion: true } });
    expectFramesMatchSources(doc);
    expect(tiles(doc).length).toBeGreaterThanOrEqual(4);
  });

  it("dark preset + a large grid render valid", async () => {
    expectFramesMatchSources(await render({ ...D, preset: "dark" }));
    const big = { rows: Array.from({ length: 7 }, (_, r) => ({ label: `r${r}`, values: Array.from({ length: 16 }, (_, c) => (r + c) % 11) })), colLabels: Array.from({ length: 16 }, (_, i) => `W${i + 1}`), anim: { reduceMotion: true } };
    expectFramesMatchSources(await render(big));
  });

  it("rejects empty rows with an error mosaic, not a throw", async () => {
    const doc = await render({ rows: [] });
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  });
});

describe("AlpineHeatmapV2 — layout contract + rail attachment (gate 5)", () => {
  const STILL = { renderMode: "premium", introFrac: 0.7, easing: "easeOut", reduceMotion: true } as const;
  const HOSTILE: Array<[number, number]> = [
    [1280, 708],
    [720, 1280], // col labels detached ~240px above the grid before the fix
    [1920, 480], // row labels detached ~750px left of their rows before the fix
    [640, 360],
    [733, 977],
    [1920, 1080], // legend swatches spread 46% before the equal-band strip
  ];

  const ctxAt = (w: number, h: number): MosaicEngineContext =>
    ({
      mode: "render" as const,
      target: { width: w, height: h, fps: 30, durationMs: 2000 },
      output: { width: w, height: h, fps: 30, durationMs: 2000, workspaceDir: "/tmp/alpine-heatmap" },
      media: {},
    }) as unknown as MosaicEngineContext;

  it("contract (cells + legend swatches equal-size, 2% + 1px) passes at every hostile canvas", async () => {
    for (const [w, h] of HOSTILE) {
      const doc = (await AlpineHeatmapV2.render({ ...D, anim: STILL, debugLayout: true } as never, ctxAt(w, h))) as MosaicDocument;
      const stamp = (doc as { editor?: { layoutContract?: { ok?: boolean } } }).editor?.layoutContract;
      expect(stamp?.ok).toBe(true);
    }
  });

  it("all 56 cell tiles + 5 swatches carry contract tags", async () => {
    const doc = await render({ ...D, anim: STILL });
    const tags = ((doc.sources ?? []) as MosaicSource[]).map((s) => (s as { editor?: { label?: string } }).editor?.label);
    expect(tags.filter((t) => t === "cell").length).toBe(56);
    expect(tags.filter((t) => t === "legend-swatch").length).toBe(5);
  });

  it("debugLayout off (default) leaves the doc unstamped — zero-cost path", async () => {
    const doc = await render({ ...D, anim: STILL });
    expect((doc as { editor?: { layoutContract?: unknown } }).editor?.layoutContract).toBeUndefined();
  });
});

describe("AlpineHeatmapV2 — first-open cover", () => {
  it("declares a branded cover: pane + inlined default render, self-contained", async () => {
    expect(typeof AlpineHeatmapV2.renderCover).toBe("function");
    const doc = (await AlpineHeatmapV2.renderCover!({} as never, makeCtx())) as MosaicDocument;
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    const s = JSON.stringify(doc.sources);
    expect(s).toContain("Heatmap");
    // Band variant: no conversation pane, just brand + title.
    expect(s).not.toContain("START HERE");
    // Inline-flat hero (gate-15/21 keeper): no nested cover child refs; the
    // brand M is the only media source and rides THIS doc's manifest.
    expect(s).not.toContain('"type":"mosaic","ref":"cover');
    const assetIds = new Set(Object.keys(doc.assets ?? {}));
    const media = ((doc.sources ?? []) as Array<{ type?: string; assetId?: string }>).filter(
      (x) => x.type === "media",
    );
    expect(media.every((x) => assetIds.has(String(x.assetId)))).toBe(true);
  });

  it("cover is deterministic", async () => {
    const a = (await AlpineHeatmapV2.renderCover!({} as never, makeCtx())) as MosaicDocument;
    const b = (await AlpineHeatmapV2.renderCover!({} as never, makeCtx())) as MosaicDocument;
    expect(a.m0).toBe(b.m0);
  });
});

describe("AlpineHeatmapV2 — prop bindings (Make inline edit)", () => {
  const schema = AlpineHeatmapV2.propsSchema;
  const bindingsOf = async (props: Record<string, unknown>) => {
    const doc = await render(props);
    return { doc, ...resolvePropBindings(doc, W, H, { propsSchema: schema }) };
  };
  const labelAt = (doc: MosaicDocument, i: number) => (srcs(doc)[i] as { editor?: { label?: string } }).editor?.label;
  /** rows[] leaf bindings as { path, kind, label } triples (label = the bound source's tag). */
  const leavesOf = (r: Awaited<ReturnType<typeof bindingsOf>>) =>
    (r.byProp.rows ?? []).map((b) => ({ path: b.path, kind: b.kind, label: labelAt(r.doc, b.sourceIndex) }));
  const STILL = { anim: { reduceMotion: true } };
  /** How many default cells are empty (v ≤ min 0) — each is painted with emptyColor literally. */
  const ZERO_CELLS = (D.rows as Array<{ values: number[] }>).flatMap((row) => row.values.filter((v) => v <= 0)).length;

  it("colLabels[i] → the column-label cells (index-aligned, root); title → the card header's primary layer; rows → leaf bindings", async () => {
    const r = await bindingsOf({ ...D, ...STILL });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["colLabels", "color", "rows", "scale.emptyColor", "subtitle", "title"]);
    const labels = D.colLabels as string[];
    expect(r.byProp.colLabels.map((b) => b.index)).toEqual(labels.map((_, i) => i));
    r.byProp.colLabels.forEach((b, i) => {
      expect(b.childPath).toEqual([]);
      expect(labelAt(r.doc, b.sourceIndex)).toBe("col-label");
      expect(textOf(srcs(r.doc)[b.sourceIndex])).toBe(labels[i]);
    });
    expect(r.byProp.title).toHaveLength(1);
    expect("index" in r.byProp.title[0]).toBe(false);
    expect(r.byProp.title[0].childPath).toEqual([]);
    expect(labelAt(r.doc, r.byProp.title[0].sourceIndex)).toBe("card-header");
    expect(r.byProp.subtitle).toHaveLength(1); // second header layer binds too (stacked Title / Subtitle form)
    expect(r.byProp.subtitle[0].layer).toBe(1);
    expect(r.byProp.subtitle[0].sourceIndex).toBe(r.byProp.title[0].sourceIndex);
  });

  it("rows[r].label → the row-label rect; rows[r].values[c] → EVERY cell tile (its color IS the value), at the ORIGINAL r / c", async () => {
    const r = await bindingsOf({ ...D, ...STILL });
    expect(r.rejected).toEqual([]);
    expect(r.byProp.rows.every((b) => b.childPath.length === 0 && b.index === undefined)).toBe(true);
    const leaves = leavesOf(r);
    const rows = D.rows as Array<{ label: string; values: number[] }>;
    for (let ri = 0; ri < rows.length; ri++) {
      expect(leaves).toContainEqual({ path: [ri, "label"], kind: "string", label: "row-label" });
      for (let c = 0; c < rows[ri].values.length; c++) {
        expect(leaves).toContainEqual({ path: [ri, "values", c], kind: "number", label: "cell" });
      }
    }
    // 7 labels + 7×8 cells, nothing else (showValues off → no value text)
    expect(leaves.filter((l) => l.label === "row-label")).toHaveLength(7);
    expect(leaves.filter((l) => l.label === "cell")).toHaveLength(56);
    expect(leaves).toHaveLength(63);
    // the bound label rect really shows that row's label
    const wed = r.byProp.rows.find((b) => b.path![0] === 2 && b.path![1] === "label")!;
    expect(textOf(srcs(r.doc)[wed.sourceIndex])).toBe("Wed");
    // the bound tile really is that cell: Mon/W1 = 0 paints the empty bucket, Fri/W8 = 10 (the max) does not
    const monW1 = r.byProp.rows.find((b) => b.path![0] === 0 && b.path![1] === "values" && b.path![2] === 0)!;
    const friW8 = r.byProp.rows.find((b) => b.path![0] === 4 && b.path![1] === "values" && b.path![2] === 7)!;
    expect(isTile(srcs(r.doc)[monW1.sourceIndex])).toBe(true);
    expect((colorOf(srcs(r.doc)[monW1.sourceIndex]) ?? "").toUpperCase()).toBe("#EBEEF2");
    expect((colorOf(srcs(r.doc)[friW8.sourceIndex]) ?? "").toUpperCase()).not.toBe("#EBEEF2");
  });

  it("derived chrome stays unbound: legend captions, the computed-tint swatches, and the blank value placeholders over empty cells (Make looks through them to the tile)", async () => {
    const r = await bindingsOf({ ...D, showValues: true, ...STILL });
    expect(r.rejected).toEqual([]);
    const bound = new Set(Object.values(r.byProp).flat().map((b) => b.sourceIndex));
    // the two prop-painted swatches (empty + full-intensity) are color handles; the tints between are not
    const colorBound = new Set([...(r.byProp.color ?? []), ...(r.byProp["scale.emptyColor"] ?? [])].map((b) => b.sourceIndex));
    let sawChrome = 0;
    let sawPlaceholder = 0;
    srcs(r.doc).forEach((s, i) => {
      const lbl = (s as { editor?: { label?: string } }).editor?.label ?? "";
      if (lbl === "legend-caption" || lbl === "legend-swatch") {
        sawChrome++;
        if (!colorBound.has(i)) expect(bound.has(i)).toBe(false);
      }
      // the only untagged text is the " " spacer over a v ≤ min cell — not a display of the leaf
      if (isText(s) && !lbl) {
        sawPlaceholder++;
        expect(textOf(s)).toBe(" ");
        expect(bound.has(i)).toBe(false);
      }
    });
    expect(sawChrome).toBe(2 + 5); // Less / More + 5 swatches
    expect([...colorBound].filter((i) => labelAt(r.doc, i) === "legend-swatch")).toHaveLength(2); // empty + More
    expect(sawPlaceholder).toBeGreaterThan(0); // the default data has zero cells
  });

  it("color → ONLY the legend's full-intensity swatch (kind color; cells are computed tints); scale.emptyColor → the empty swatch + every v ≤ min cell as a SECOND entry beside its value leaf", async () => {
    const r = await bindingsOf({ ...D, color: "#123456", scale: { cellRadius: 0.25, emptyColor: "#ABCDEF" }, ...STILL });
    expect(r.rejected).toEqual([]);
    // `color`: exactly one rect — the last swatch, painted with the literal hue
    expect(r.byProp.color).toHaveLength(1);
    expect(r.byProp.color[0]).toMatchObject({ kind: "color", childPath: [] });
    expect("index" in r.byProp.color[0]).toBe(false);
    expect(labelAt(r.doc, r.byProp.color[0].sourceIndex)).toBe("legend-swatch");
    expect((colorOf(srcs(r.doc)[r.byProp.color[0].sourceIndex]) ?? "").toLowerCase()).toBe("#123456");
    // `scale.emptyColor`: the empty swatch + one entry per zero cell, all painted with the literal color
    const empties = r.byProp["scale.emptyColor"];
    const swatches = empties.filter((b) => labelAt(r.doc, b.sourceIndex) === "legend-swatch");
    const cells = empties.filter((b) => labelAt(r.doc, b.sourceIndex) === "cell");
    expect(swatches).toHaveLength(1);
    expect(cells).toHaveLength(ZERO_CELLS);
    expect(empties).toHaveLength(ZERO_CELLS + 1);
    for (const b of empties) {
      expect(b.kind).toBe("color");
      expect(isTile(srcs(r.doc)[b.sourceIndex])).toBe(true);
      expect((colorOf(srcs(r.doc)[b.sourceIndex]) ?? "").toUpperCase()).toBe("#ABCDEF");
    }
    // an empty cell keeps its value leaf FIRST (the primary) and the color SECOND, on the same source
    const monW1 = r.byProp.rows.find((b) => b.path![0] === 0 && b.path![1] === "values" && b.path![2] === 0)!;
    expect(cells.map((b) => b.sourceIndex)).toContain(monW1.sourceIndex);
    const stacked = srcs(r.doc)[monW1.sourceIndex] as { editor?: { bindings?: Array<{ propKey: string; kind?: string }> } };
    expect(stacked.editor?.bindings?.map((e) => e.propKey)).toEqual(["rows", "scale.emptyColor"]);
    // a non-empty cell carries only its value leaf — never a color handle
    const friW8 = r.byProp.rows.find((b) => b.path![0] === 4 && b.path![1] === "values" && b.path![2] === 7)!;
    expect(cells.map((b) => b.sourceIndex)).not.toContain(friW8.sourceIndex);
    expect(r.byProp.color.map((b) => b.sourceIndex)).not.toContain(friW8.sourceIndex);
    // the value-leaf count is untouched by the color entries (7 labels + 56 cells)
    expect(r.byProp.rows).toHaveLength(63);
  });

  it("showLegend:false drops both swatch handles (empty cells keep scale.emptyColor); no zero cells + no legend → no color handles; unset colors still bind (double-click to SET)", async () => {
    const r = await bindingsOf({ ...D, showLegend: false, ...STILL });
    expect(r.rejected).toEqual([]);
    expect(r.byProp.color).toBeUndefined();
    expect(r.byProp["scale.emptyColor"]).toHaveLength(ZERO_CELLS);
    for (const b of r.byProp["scale.emptyColor"]) expect(labelAt(r.doc, b.sourceIndex)).toBe("cell");
    const hot = await bindingsOf({ rows: [{ label: "a", values: [1, 2] }], showLegend: false, ...STILL });
    expect(hot.rejected).toEqual([]);
    expect(hot.byProp.color).toBeUndefined();
    expect(hot.byProp["scale.emptyColor"]).toBeUndefined();
    // defaults leave `color` / `scale.emptyColor` unset — the swatches are still handles
    const def = await bindingsOf({ ...D, ...STILL });
    expect(def.rejected).toEqual([]);
    expect(def.byProp.color).toHaveLength(1);
    expect(def.byProp["scale.emptyColor"]).toHaveLength(ZERO_CELLS + 1);
    // a CSV-string zero cell has no value leaf but its fill IS emptyColor → a lone color handle
    const csv = await bindingsOf({ rows: [{ label: "csv", values: "0, 3" }], showLegend: false, ...STILL });
    expect(csv.rejected).toEqual([]);
    expect(csv.byProp["scale.emptyColor"]).toHaveLength(1);
    expect(csv.byProp.rows.some((b) => b.path![1] === "values")).toBe(false);
  });

  it("showValues: the in-cell value text binds the SAME leaf as its tile (a derived rendering of the raw value)", async () => {
    const r = await bindingsOf({ rows: [{ label: "", values: [0, 4500] }], showValues: true, showLegend: false, ...STILL });
    expect(r.rejected).toEqual([]);
    const leaves = leavesOf(r);
    // cell 0 (v = min → no value text): the tile only
    expect(leaves.filter((l) => l.path![1] === "values" && l.path![2] === 0)).toEqual([{ path: [0, "values", 0], kind: "number", label: "cell" }]);
    // cell 1: the tile + the compacted "4.5K" text, both → rows[0].values[1]
    const c1 = r.byProp.rows.filter((b) => b.path![1] === "values" && b.path![2] === 1);
    expect(c1.map((b) => labelAt(r.doc, b.sourceIndex)).sort()).toEqual(["cell", "cell-value"]);
    const txt = c1.find((b) => labelAt(r.doc, b.sourceIndex) === "cell-value")!;
    expect(textOf(srcs(r.doc)[txt.sourceIndex])).toBe("4.5K");
    // a blank label paints no row-label rect → no label binding (never adds a rect)
    expect(leaves.some((l) => l.path![1] === "label")).toBe(false);
  });

  it("a CSV-string row (the objectRows editor shape) has no per-cell leaf: its label binds, its cells stay unbound; array rows keep theirs", async () => {
    const r = await bindingsOf({ rows: [{ label: "csv", values: "1, 2, 3" }, { label: "arr", values: [4, 5, 6] }], showLegend: false, ...STILL });
    expect(r.rejected).toEqual([]);
    const leaves = leavesOf(r);
    expect(leaves).toContainEqual({ path: [0, "label"], kind: "string", label: "row-label" });
    expect(leaves.some((l) => l.path![0] === 0 && l.path![1] === "values")).toBe(false);
    expect(leaves.filter((l) => l.path![0] === 1 && l.path![1] === "values").map((l) => l.path![2])).toEqual([0, 1, 2]);
    // the CSV row's 3 tiles still exist — they are just not editable per cell
    expect(srcs(r.doc).filter((s) => (s as { editor?: { label?: string } }).editor?.label === "cell")).toHaveLength(6);
  });

  it("filtered (no values) and truncated (MAX_ROWS 14) rows keep the survivors at their ORIGINAL indices", async () => {
    const rows = [
      { label: "keep 0", values: [1, 2] },
      { label: "gone", values: [] }, // no values → filtered out
      { label: "gone too", values: "" }, // blank CSV → filtered out
      ...Array.from({ length: 14 }, (_, k) => ({ label: `r${k + 3}`, values: [k, k + 1] })),
    ];
    // 17 in, 15 survive the filter, 14 are drawn: 0, 3..15 (16 is truncated)
    const r = await bindingsOf({ rows, showLegend: false, ...STILL });
    expect(r.rejected).toEqual([]);
    const labelIdx = r.byProp.rows.filter((b) => b.path![1] === "label").map((b) => b.path![0]);
    expect(labelIdx).toEqual([0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(r.byProp.rows.some((b) => b.path![0] === 1 || b.path![0] === 2 || b.path![0] === 16)).toBe(false);
    expect(textOf(srcs(r.doc)[r.byProp.rows.find((b) => b.path![0] === 3 && b.path![1] === "label")!.sourceIndex])).toBe("r3");
    expect(r.byProp.rows.filter((b) => b.path![1] === "values")).toHaveLength(14 * 2);
  });

  it("a ragged row's padded empty cell still carries its values[c] leaf — an ADD handle (Make pads the array on write)", async () => {
    const r = await bindingsOf({ rows: [{ label: "a", values: [1, 2, 3] }, { label: "b", values: [4] }], showLegend: false, ...STILL });
    expect(r.rejected).toEqual([]);
    expect(r.byProp.rows.filter((b) => b.path![0] === 1 && b.path![1] === "values").map((b) => b.path![2])).toEqual([0, 1, 2]);
  });

  it("a blank column label paints no cell, so that index has no binding (never adds a rect)", async () => {
    const r = await bindingsOf({ ...D, colLabels: ["W1", "", "W3"], ...STILL });
    expect(r.rejected).toEqual([]);
    expect(r.byProp.colLabels.map((b) => b.index)).toEqual([0, 2]);
    const noCols = await bindingsOf({ ...D, colLabels: undefined, ...STILL });
    expect(noCols.rejected).toEqual([]);
    expect(noCols.byProp.colLabels).toBeUndefined();
  });

  it("subtitle-only header binds subtitle; no header → no title / subtitle binding (rows + colLabels remain)", async () => {
    const sub = await bindingsOf({ ...D, title: undefined, ...STILL });
    expect(sub.rejected).toEqual([]);
    expect(sub.byProp.subtitle).toHaveLength(1);
    expect(labelAt(sub.doc, sub.byProp.subtitle[0].sourceIndex)).toBe("card-header");
    expect(sub.byProp.title).toBeUndefined();
    const none = await bindingsOf({ ...D, title: undefined, subtitle: undefined, ...STILL });
    expect(none.rejected).toEqual([]);
    expect(Object.keys(none.byProp).sort()).toEqual(["colLabels", "color", "rows", "scale.emptyColor"]);
  });

  it("bindings ride the animated sources in both reveal modes (premium fade / light gate)", async () => {
    for (const anim of [{ reduceMotion: false }, { renderMode: "light" }]) {
      const r = await bindingsOf({ ...D, anim });
      expect(r.rejected).toEqual([]);
      expect(r.byProp.colLabels).toHaveLength((D.colLabels as string[]).length);
      expect(r.byProp.title).toHaveLength(1);
      expect(r.byProp.rows).toHaveLength(63); // 7 labels + 56 cells
      expect(r.byProp.color).toHaveLength(1);
      expect(r.byProp["scale.emptyColor"]).toHaveLength(ZERO_CELLS + 1);
    }
  });
});
