import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete } from "@m0saic/dsl";
import { resolvePropBindings } from "@m0saic/template-utils";
import { AlpineContributorTable } from "./contributor-table";

// Three aspects: the table holds in landscape/square; portrait reflows to stacked cards.
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
  AlpineContributorTable.render({ ...(AlpineContributorTable.defaultProps as object), ...props } as never, makeCtx(W, H)) as Promise<MosaicDocument>;

const srcs = (doc: MosaicDocument) => (doc.sources ?? []) as MosaicSource[];
const texts = (doc: MosaicDocument) =>
  srcs(doc)
    .filter((s) => (s as { type?: string }).type === "text")
    .flatMap((s) => ((s as { layers?: Array<{ content?: { text?: string; expr?: string } }> }).layers ?? []).map((l) => l.content?.text ?? l.content?.expr ?? ""));

describe("AlpineContributorTable — metadata", () => {
  it("is the registered hero contributor-table primitive", () => {
    expect(AlpineContributorTable.id).toBe("@m0saic/alpine/contributor-table/v1");
    expect(AlpineContributorTable.version).toBe(1);
    expect((AlpineContributorTable as { deprecated?: unknown }).deprecated).toBeUndefined();
    expect(AlpineContributorTable.primitive).toBe(true);
    expect(AlpineContributorTable.tags).toEqual(expect.arrayContaining(["alpine", "contributor-table", "ranking"]));
  });
});

describe("AlpineContributorTable — renders at every aspect", () => {
  for (const [W, H, label] of ASPECTS) {
    it(`${label} ${W}x${H}: valid m0, frames match sources, title + names present`, async () => {
      const doc = await render(W, H, { anim: { reduceMotion: true } });
      expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
      const parsed = parseM0StringComplete(doc.m0 as unknown as string, W, H);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe(srcs(doc).length);
      const t = texts(doc);
      expect(t).toEqual(expect.arrayContaining(["TOP CONTRIBUTORS", "This week", "Anton Khirnov", "Michael Niedermayer"]));
    });
  }

  it("portrait reflows to a distinct layout (per-card hero label; table uses one column header)", async () => {
    const land = await render(1280, 708, { anim: { reduceMotion: true } });
    const port = await render(720, 1280, { anim: { reduceMotion: true } });
    // distinct geometry
    expect(port.m0).not.toBe(land.m0);
    const count = (doc: MosaicDocument, s: string) => texts(doc).filter((t) => t === s).length;
    // landscape: "Commits" is one column header; portrait: a hero label on each card.
    expect(count(land, "Commits")).toBe(1);
    expect(count(port, "Commits")).toBe(5);
  });
});

describe("AlpineContributorTable — showHeader (composes under a chrome)", () => {
  it("showHeader:false drops the title/subtitle but keeps rows + valid m0", async () => {
    const withH = texts(await render(1280, 708, { anim: { reduceMotion: true } }));
    expect(withH).toEqual(expect.arrayContaining(["TOP CONTRIBUTORS", "This week"]));
    const doc = await render(1280, 708, { anim: { reduceMotion: true }, showHeader: false });
    const t = texts(doc);
    expect(t).not.toContain("TOP CONTRIBUTORS");
    expect(t).not.toContain("This week");
    expect(t).toEqual(expect.arrayContaining(["Anton Khirnov"])); // rows still present
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  });

  it("showHeader defaults true (standalone output unchanged)", async () => {
    const a = await render(1280, 708, { anim: { reduceMotion: true } });
    const b = await render(1280, 708, { anim: { reduceMotion: true }, showHeader: true });
    expect(a.m0).toBe(b.m0);
  });
});

describe("AlpineContributorTable — colored signed value columns", () => {
  it("default props apply + additions / - deletions (diff treatment)", async () => {
    const doc = await render(1280, 708, { anim: { reduceMotion: true } });
    const t = texts(doc);
    expect(t).toEqual(expect.arrayContaining(["+4,512", "-2,103"]));
    // Commits (column 0) carries no sign.
    expect(t).toEqual(expect.arrayContaining(["23"]));
  });

  it("portrait shows the same signed diff line", async () => {
    const t = texts(await render(720, 1280, { anim: { reduceMotion: true } }));
    expect(t).toEqual(expect.arrayContaining(["+3,204", "-1,034"]));
  });
});

describe("AlpineContributorTable — avatar + icon are lavfi (never media)", () => {
  it("no assets; avatars + chip are color tiles, not media", async () => {
    const doc = await render(1280, 708, { anim: { reduceMotion: true } });
    expect(Object.keys((doc as { assets?: Record<string, unknown> }).assets ?? {}).length).toBe(0);
    expect(srcs(doc).every((s) => (s as { type?: string }).type !== "media")).toBe(true);
  });

  it("iconPath → a masked glyph source (inline-mask), still no media asset", async () => {
    // Defaults now ship a glyph (iconPath: ALPINE_GLYPHS.contributors) — clear both knobs for the baseline.
    const noGlyph = srcs(await render(1280, 708, { anim: { reduceMotion: true }, icon: undefined, iconPath: undefined })).length;
    const doc = await render(1280, 708, { anim: { reduceMotion: true }, iconPath: "M1 1h10v10H1Z" });
    expect(srcs(doc).length).toBe(noGlyph + 1);
    expect(srcs(doc).some((s) => JSON.stringify(s).includes("inline-mask"))).toBe(true);
    expect(srcs(doc).every((s) => (s as { type?: string }).type !== "media")).toBe(true);
  });
});

describe("AlpineContributorTable — animation", () => {
  it("static when reduceMotion (no fade alpha on any source)", async () => {
    const doc = await render(1280, 708, { anim: { reduceMotion: true } });
    const faded = srcs(doc).filter((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha);
    expect(faded.length).toBe(0);
  });

  it("animated → every source fades in (nothing visible at t=0)", async () => {
    const doc = await render(1280, 708);
    // each source carries a fade alpha so the surface/rows/washes all cascade in.
    expect(srcs(doc).every((s) => !!(s as { overlay?: { alpha?: string } }).overlay?.alpha)).toBe(true);
  });

  it("count-up values render as frame exprs when animated", async () => {
    const doc = await render(1280, 708);
    const exprCount = srcs(doc)
      .filter((s) => (s as { type?: string }).type === "text")
      .flatMap((s) => ((s as { layers?: Array<{ content?: { kind?: string } }> }).layers ?? []))
      .filter((l) => l.content?.kind === "expr").length;
    expect(exprCount).toBeGreaterThan(0);
  });

  it("is deterministic — identical output for identical inputs", async () => {
    const a = await render(1280, 708);
    const b = await render(1280, 708);
    expect(a.m0).toBe(b.m0);
    expect(srcs(a).length).toBe(srcs(b).length);
  });
});

describe("AlpineContributorTable — two-mode reveal (F4 U-A4)", () => {
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

describe("AlpineContributorTable — local theming (F4 U-A4)", () => {
  const themedCtx = (tokens: Record<string, unknown>): MosaicEngineContext =>
    ({ mode: "render", target: { width: 1280, height: 708, fps: 30, durationMs: 3000 }, output: {}, media: {}, upstreamData: { theme: tokens } } as unknown as MosaicEngineContext);

  it("a producer theme recolors the card + names; unthemed default does not carry those tokens", async () => {
    const plain = JSON.stringify(await render(1280, 708));
    expect(plain).not.toContain("#101820");
    const themed = JSON.stringify((await AlpineContributorTable.render(AlpineContributorTable.defaultProps as never, themedCtx({ surface: "#101820", textPrimary: "#00FFCC" }))) as MosaicDocument);
    expect(themed).toContain("#101820"); // card surface
    expect(themed).toContain("#00FFCC"); // name text
  });

  it("an explicit accent still wins over a producer theme", async () => {
    const themed = JSON.stringify((await AlpineContributorTable.render({ ...(AlpineContributorTable.defaultProps as object), accent: "#123456" } as never, themedCtx({ accent: "#00FFCC" }))) as MosaicDocument);
    expect(themed).toContain("#123456");
  });
});

describe("AlpineContributorTable — fail-fast", () => {
  it("empty rows/columns → error mosaic (not a throw)", async () => {
    const doc = (await AlpineContributorTable.render({ rows: [], columns: [] } as never, makeCtx(1280, 708))) as MosaicDocument;
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  });
});

describe("AlpineContributorTable — equal row/card size (the interleaved-band quantization fix)", () => {
  // Same class as bar-graph (gate 1) and commit-feed (gate 2): interleaved
  // [row, gap, ...] weights let the engine's OUTSIDE-IN remainder distribution
  // starve the CENTER band under ancestor drift — measured 75/72/72/72/74
  // landscape at 1001×733 and 195/187/187/187/194 portrait at 720×1280. The
  // fix is one EQUAL band per row/card with the half-gap carved inside it, so
  // bands can never differ by more than ~1px at any canvas.
  const HOSTILE_CANVASES: Array<[number, number, string]> = [
    [1280, 800, "landscape"],
    [1001, 733, "landscape repro"],
    [640, 400, "small"],
    [720, 1280, "portrait repro"],
    [607, 401, "prime-ish"],
    [733, 977, "portrait header-chip repro (was 108×80)"],
  ];

  async function rowHeights(w: number, h: number): Promise<number[]> {
    const doc = await render(w, h, { anim: { reduceMotion: true } });
    const parsed = parseM0StringComplete(doc.m0 as unknown as string, w, h);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return [];
    const frames = parsed.ir.renderFrames;
    return srcs(doc).flatMap((s, i) =>
      (s as { editor?: { label?: string } }).editor?.label === "row" ? [frames[i].height] : [],
    );
  }

  it("every row/card band within 1px of the others at every canvas", async () => {
    for (const [w, h] of HOSTILE_CANVASES) {
      const heights = await rowHeights(w, h);
      expect(heights).toHaveLength(5);
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
    }
  });

  it("debugLayout contract passes at every canvas (rows equal + header chip square)", async () => {
    for (const [w, h] of HOSTILE_CANVASES) {
      const doc = await render(w, h, { anim: { reduceMotion: true }, debugLayout: true });
      const stamp = (doc as { editor?: { layoutContract?: { ok?: boolean } } }).editor?.layoutContract;
      expect(stamp?.ok).toBe(true);
    }
  });

  it("debugLayout off (default) leaves the doc unstamped — zero-cost path", async () => {
    const doc = await render(1280, 708);
    expect((doc as { editor?: { layoutContract?: unknown } }).editor?.layoutContract).toBeUndefined();
  });
});

describe("AlpineContributorTable — friendly `icon` knob + first-open cover (gate 3)", () => {
  it("icon name renders the same doc as the equivalent raw iconPath", async () => {
    const { ALPINE_GLYPHS } = await import("../../_shared/alpine-glyphs");
    const viaName = await render(1280, 708, { icon: "stars", iconPath: undefined, anim: { reduceMotion: true } });
    const viaRaw = await render(1280, 708, { iconPath: ALPINE_GLYPHS.stars, anim: { reduceMotion: true } });
    expect(viaName.m0).toBe(viaRaw.m0);
    expect(JSON.stringify(viaName.sources)).toBe(JSON.stringify(viaRaw.sources));
  });

  it("defaults to the contributors glyph; unknown icon name fails fast (raw cleared)", async () => {
    const { ALPINE_GLYPHS } = await import("../../_shared/alpine-glyphs");
    expect((AlpineContributorTable.defaultProps as { iconPath?: string }).iconPath).toBe(ALPINE_GLYPHS.contributors);
    await expect(render(1280, 708, { icon: "sparkles", iconPath: undefined })).rejects.toThrow(/unknown icon "sparkles"/);
  });

  it("declares a branded cover: pane + inlined default render, self-contained", async () => {
    expect(typeof AlpineContributorTable.renderCover).toBe("function");
    const doc = (await AlpineContributorTable.renderCover!({} as never, makeCtx(1280, 708))) as MosaicDocument;
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    const s = JSON.stringify(doc.sources);
    expect(s).toContain("Contributor Table");
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
    const a = (await AlpineContributorTable.renderCover!({} as never, makeCtx(1280, 708))) as MosaicDocument;
    const b = (await AlpineContributorTable.renderCover!({} as never, makeCtx(1280, 708))) as MosaicDocument;
    expect(a.m0).toBe(b.m0);
  });
});

describe("AlpineContributorTable — engine feasibility at hostile portrait dims (SPLIT_EXCEEDS_AXIS regression)", () => {
  // 733×977 killed the whole doc before the card-interior grain-collapse: the
  // pixel-weight cardInset summed to cardH units inside a cell the ancestor
  // ratio splits had drifted 1px short, flooring an edge cell to 0.
  it.each([
    [733, 977],
    [733, 978],
    [731, 975],
    [735, 979],
    [977, 733],
  ])("defaults parse engine-feasible at %ix%i", async (w, h) => {
    const doc = await render(w, h, { anim: { reduceMotion: true } });
    const parsed = parseM0StringComplete(doc.m0 as unknown as string, w, h);
    expect(parsed.ok).toBe(true);
  });
});

describe("AlpineContributorTable — avatar disc stays headshot-shaped (stress-06 finding)", () => {
  // The disc is the future profile-picture slot. Its CELL aspect swings wildly
  // (wide at 1920×480, tall at N=1 on a square canvas) — the paint must not.
  const oneRow = [{ rank: 1, name: "Anton Khirnov", values: [23] }];

  it("contract (incl. avatar aspect 1 ± 0.2) passes at the two pill-stretch repros + portrait", async () => {
    const cases: Array<[number, number, Record<string, unknown>]> = [
      [900, 900, { rows: oneRow, columns: ["Commits"], topTint: 1 }], // tall-pill repro
      [1920, 480, {}], // wide-pill repro
      [720, 1280, {}], // portrait cards (square by construction)
      [1280, 708, {}],
    ];
    for (const [w, h, extra] of cases) {
      const doc = await render(w, h, { anim: { reduceMotion: true }, debugLayout: true, ...extra });
      const stamp = (doc as { editor?: { layoutContract?: { ok?: boolean } } }).editor?.layoutContract;
      expect(stamp?.ok).toBe(true);
    }
  });

  it("every avatar tile carries the contract tag + a placement inset in landscape", async () => {
    const doc = await render(1920, 480, { anim: { reduceMotion: true } });
    const tiles = srcs(doc).filter((s) => (s as { editor?: { label?: string } }).editor?.label === "avatar");
    expect(tiles.length).toBe(5);
    for (const t of tiles) {
      const inset = (t as { placement?: { inset?: { x?: number; y?: number } } }).placement?.inset;
      expect(inset).toBeDefined();
      expect((inset!.y ?? 0)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("AlpineContributorTable — prop bindings (Make inline edit)", () => {
  const schema = AlpineContributorTable.propsSchema;
  const bindingsOf = async (W: number, H: number, props: Record<string, unknown> = {}) => {
    const doc = await render(W, H, { anim: { reduceMotion: true }, ...props });
    return { doc, ...resolvePropBindings(doc, W, H, { propsSchema: schema }) };
  };
  type ByProp = ReturnType<typeof resolvePropBindings>["byProp"];
  const labelAt = (doc: MosaicDocument, i: number) => (srcs(doc)[i] as { editor?: { label?: string } }).editor?.label;
  const textAt = (doc: MosaicDocument, i: number) =>
    ((srcs(doc)[i] as { layers?: Array<{ content?: { text?: string } }> }).layers ?? [])[0]?.content?.text;
  const isTile = (s: MosaicSource) => (s as { type?: string }).type === "lavfi";
  const colorOf = (s: MosaicSource) => (s as { color?: string }).color;
  /** propKeys bound on each source index (a tile may carry one or several). */
  const keysBySource = (byProp: ByProp) => {
    const m = new Map<number, string[]>();
    for (const [k, arr] of Object.entries(byProp)) for (const b of arr) m.set(b.sourceIndex, [...(m.get(b.sourceIndex) ?? []), k]);
    return m;
  };
  const COLUMNS = ["Commits", "Additions", "Deletions"];
  /** rows[] leaves as `{ path, kind, label }` — what the test asserts against. */
  const leavesOf = (doc: MosaicDocument, byProp: ByProp) =>
    (byProp.rows ?? []).map((b) => ({ path: b.path, kind: b.kind, label: labelAt(doc, b.sourceIndex) }));
  const leafAt = (byProp: ByProp, path: Array<string | number>) =>
    (byProp.rows ?? []).find((b) => JSON.stringify(b.path) === JSON.stringify(path));

  it("landscape: columns[i] → the value-column header cells (index-aligned, root); title / subtitle → the self-drawn header; rows → leaves", async () => {
    const r = await bindingsOf(1280, 708);
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["accent", "backgroundColor", "columns", "rows", "subtitle", "title", "washColor"]);
    expect(r.byProp.columns.map((b) => b.index)).toEqual([0, 1, 2]);
    r.byProp.columns.forEach((b, i) => {
      expect(b.childPath).toEqual([]);
      expect(labelAt(r.doc, b.sourceIndex)).toBe("col-header");
      expect(textAt(r.doc, b.sourceIndex)).toBe(COLUMNS[i]);
    });
    // This template draws its own header (no alpineCard) — the title / subtitle
    // rects are bound here, one each, in the root doc.
    expect(r.byProp.title).toHaveLength(1);
    expect("index" in r.byProp.title[0]).toBe(false);
    expect(r.byProp.title[0].childPath).toEqual([]);
    expect(labelAt(r.doc, r.byProp.title[0].sourceIndex)).toBe("table-title");
    expect(textAt(r.doc, r.byProp.title[0].sourceIndex)).toBe("TOP CONTRIBUTORS");
    expect(r.byProp.subtitle).toHaveLength(1);
    expect(labelAt(r.doc, r.byProp.subtitle[0].sourceIndex)).toBe("table-subtitle");
    expect(textAt(r.doc, r.byProp.subtitle[0].sourceIndex)).toBe("This week");
  });

  it("static chrome ('#', 'Contributor') + the avatar disc stay unbound; row tiles carry ONLY washColor, the header chip ONLY accent", async () => {
    const r = await bindingsOf(1280, 708);
    const bound = new Set(Object.values(r.byProp).flat().map((b) => b.sourceIndex));
    const keys = keysBySource(r.byProp);
    srcs(r.doc).forEach((s, i) => {
      const lbl = (s as { editor?: { label?: string } }).editor?.label ?? "";
      if (lbl === "avatar") expect(bound.has(i)).toBe(false); // fixed hue cycle, no prop
      if (lbl === "row") expect(keys.get(i)).toEqual(["washColor"]);
      if (lbl === "header-icon") expect(keys.get(i)).toEqual(["accent"]);
    });
    const boundHeaders = r.byProp.columns.map((b) => textAt(r.doc, b.sourceIndex));
    expect(boundHeaders).not.toContain("#");
    expect(boundHeaders).not.toContain("Contributor");
    // the avatar initial ("A" for Anton) is a derived glyph inside the media slot — never a handle
    const initials = srcs(r.doc).flatMap((s, i) => (textAt(r.doc, i) === "A" ? [i] : []));
    expect(initials.length).toBeGreaterThan(0);
    for (const i of initials) expect(bound.has(i)).toBe(false);
  });

  it("landscape: rows[i].{rank,name,values[c]} → one leaf binding per cell at the ORIGINAL row index", async () => {
    const r = await bindingsOf(1280, 708);
    expect(r.rejected).toEqual([]);
    const leaves = leavesOf(r.doc, r.byProp);
    // 5 default rows × (rank, name, 3 value cells), all in the root doc, path-addressed (no basic index)
    expect(r.byProp.rows).toHaveLength(5 * (2 + COLUMNS.length));
    expect(r.byProp.rows.every((b) => b.childPath.length === 0 && b.index === undefined)).toBe(true);
    for (let i = 0; i < 5; i++) {
      expect(leaves).toContainEqual({ path: [i, "rank"], kind: "number", label: "rank" });
      expect(leaves).toContainEqual({ path: [i, "name"], kind: "string", label: "row-name" });
      for (let c = 0; c < COLUMNS.length; c++) {
        expect(leaves).toContainEqual({ path: [i, "values", c], kind: "number", label: "row-value" });
      }
    }
    // the bound rects really show that row's leaf — raw, formatted, or sign-prefixed
    expect(textAt(r.doc, leafAt(r.byProp, [0, "rank"])!.sourceIndex)).toBe("1");
    expect(textAt(r.doc, leafAt(r.byProp, [0, "name"])!.sourceIndex)).toBe("Anton Khirnov");
    expect(textAt(r.doc, leafAt(r.byProp, [0, "values", 0])!.sourceIndex)).toBe("23");
    expect(textAt(r.doc, leafAt(r.byProp, [0, "values", 1])!.sourceIndex)).toBe("+4,512");
    expect(textAt(r.doc, leafAt(r.byProp, [1, "values", 2])!.sourceIndex)).toBe("-1,034");
    expect(textAt(r.doc, leafAt(r.byProp, [4, "name"])!.sourceIndex)).toBe("Limin Wang");
  });

  it("portrait: rank + name + the hero metric (values[0]) bind; the secondary sign / label composites stay unbound", async () => {
    const r = await bindingsOf(720, 1280);
    expect(r.rejected).toEqual([]);
    const leaves = leavesOf(r.doc, r.byProp);
    expect(r.byProp.rows).toHaveLength(5 * 3);
    for (let i = 0; i < 5; i++) {
      expect(leaves).toContainEqual({ path: [i, "rank"], kind: "number", label: "rank" });
      expect(leaves).toContainEqual({ path: [i, "name"], kind: "string", label: "row-name" });
      expect(leaves).toContainEqual({ path: [i, "values", 0], kind: "number", label: "row-value" });
    }
    expect(leaves.some((l) => l.path![1] === "values" && (l.path![2] as number) > 0)).toBe(false);
    expect(textAt(r.doc, leafAt(r.byProp, [1, "values", 0])!.sourceIndex)).toBe("18");
    // the "+3,204" secondary line exists but merges sign + value → not a handle
    const bound = new Set(r.byProp.rows.map((b) => b.sourceIndex));
    const secondary = srcs(r.doc).findIndex((_, i) => textAt(r.doc, i) === "+3,204");
    expect(secondary).toBeGreaterThanOrEqual(0);
    expect(bound.has(secondary)).toBe(false);
    // same without the diff treatment: "Additions  3,204" (label + value) stays unbound too
    const plain = await bindingsOf(720, 1280, { columnColors: undefined, columnSigns: undefined });
    expect(plain.rejected).toEqual([]);
    expect(plain.byProp.rows).toHaveLength(5 * 3);
    const plainBound = new Set(plain.byProp.rows.map((b) => b.sourceIndex));
    const labelled = srcs(plain.doc).findIndex((_, i) => textAt(plain.doc, i) === "Additions  3,204");
    expect(labelled).toBeGreaterThanOrEqual(0);
    expect(plainBound.has(labelled)).toBe(false);
  });

  it("filtered-out + truncated rows keep the surviving rows at their ORIGINAL indices (both layouts)", async () => {
    // row 1 has no name → filtered out; rows 9.. fall past MAX_ROWS (8) → truncated
    const rows = Array.from({ length: 10 }, (_, i) =>
      i === 1 ? { values: [9] } : { rank: i + 1, name: `person ${i}`, values: [i, i * 2, i * 3] },
    );
    for (const [W, H] of [[1280, 708], [720, 1280]] as const) {
      const r = await bindingsOf(W, H, { rows });
      expect(r.rejected).toEqual([]);
      const names = r.byProp.rows.filter((b) => b.path![1] === "name").map((b) => b.path![0]);
      expect(names).toEqual([0, 2, 3, 4, 5, 6, 7, 8]);
      expect(textAt(r.doc, leafAt(r.byProp, [2, "name"])!.sourceIndex)).toBe("person 2");
      expect(textAt(r.doc, leafAt(r.byProp, [8, "values", 0])!.sourceIndex)).toBe("8");
      expect(leafAt(r.byProp, [1, "name"])).toBeUndefined();
      expect(leafAt(r.byProp, [9, "name"])).toBeUndefined();
    }
  });

  it("empty leaves stay bound as ADD handles (no rank → positional fallback text; a short values[])", async () => {
    const r = await bindingsOf(1280, 708, { rows: [{ name: "solo", values: [23] }] });
    expect(r.rejected).toEqual([]);
    const rank = leafAt(r.byProp, [0, "rank"])!;
    expect(rank.kind).toBe("number");
    expect(textAt(r.doc, rank.sourceIndex)).toBe("1"); // fallback text; the leaf itself is empty → ADD
    for (const c of [1, 2]) {
      const v = leafAt(r.byProp, [0, "values", c])!;
      expect(v).toBeDefined(); // the cell exists (blank / bare sign) → still a handle
      expect(v.kind).toBe("number");
      expect(textAt(r.doc, v.sourceIndex)).not.toMatch(/\d/);
    }
  });

  it("portrait: title / subtitle once; every card's hero label displays columns[0] (index 0 on each)", async () => {
    const r = await bindingsOf(720, 1280);
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["accent", "backgroundColor", "columns", "rows", "subtitle", "title", "washColor"]);
    expect(r.byProp.title).toHaveLength(1);
    expect(labelAt(r.doc, r.byProp.title[0].sourceIndex)).toBe("table-title");
    expect(r.byProp.subtitle).toHaveLength(1);
    expect(labelAt(r.doc, r.byProp.subtitle[0].sourceIndex)).toBe("table-subtitle");
    // 5 default rows → 5 hero labels; the secondary "+4,512" lines are composites (unbound).
    expect(r.byProp.columns).toHaveLength(5);
    for (const b of r.byProp.columns) {
      expect(b.index).toBe(0);
      expect(b.childPath).toEqual([]);
      expect(labelAt(r.doc, b.sourceIndex)).toBe("col-header");
      expect(textAt(r.doc, b.sourceIndex)).toBe("Commits");
    }
  });

  it("header rects stay bound on the fallback copy (double-click to ADD); showHeader:false drops them, columns + rows stay", async () => {
    const fallback = await bindingsOf(1280, 708, { title: undefined, subtitle: undefined });
    expect(fallback.rejected).toEqual([]);
    expect(fallback.byProp.title).toHaveLength(1);
    expect(fallback.byProp.subtitle).toHaveLength(1);
    const none = await bindingsOf(1280, 708, { showHeader: false });
    expect(none.rejected).toEqual([]);
    // no header → no chip → no accent handle; the surface + row washes remain
    expect(Object.keys(none.byProp).sort()).toEqual(["backgroundColor", "columns", "rows", "washColor"]);
    expect(none.byProp.accent).toBeUndefined();
    expect(none.byProp.columns.map((b) => b.index)).toEqual([0, 1, 2]);
    expect(none.byProp.rows).toHaveLength(5 * (2 + COLUMNS.length));
  });

  it("bindings ride the animated sources in both reveal modes (premium fade + count-up expr / light gate)", async () => {
    for (const anim of [{ reduceMotion: false }, { renderMode: "light" }]) {
      const r = await bindingsOf(1280, 708, { anim });
      expect(r.rejected).toEqual([]);
      expect(r.byProp.columns.map((b) => b.index)).toEqual([0, 1, 2]);
      expect(r.byProp.title).toHaveLength(1);
      expect(r.byProp.subtitle).toHaveLength(1);
      expect(r.byProp.rows).toHaveLength(5 * (2 + COLUMNS.length)); // the count-up expr cells carry the binding too
      expect(r.byProp.accent).toHaveLength(1);
      expect(r.byProp.backgroundColor).toHaveLength(1);
      expect(r.byProp.washColor).toHaveLength(5);
    }
  });

  it("colors: accent → the header chip (kind color), backgroundColor → the card surface, washColor → EVERY row wash (1:N) — landscape AND portrait", async () => {
    for (const [W, H] of [[1280, 708], [720, 1280]] as const) {
      const r = await bindingsOf(W, H, { accent: "#123456", backgroundColor: "#FAFAFA", washColor: "#EEEEEE" });
      expect(r.rejected).toEqual([]);
      // accent: exactly one rect, the chip tile painted with the literal accent (the glyph on top is unbound)
      expect(r.byProp.accent).toHaveLength(1);
      expect(r.byProp.accent[0]).toMatchObject({ kind: "color", childPath: [] });
      expect("index" in r.byProp.accent[0]).toBe(false);
      const chip = srcs(r.doc)[r.byProp.accent[0].sourceIndex];
      expect(isTile(chip)).toBe(true);
      expect(labelAt(r.doc, r.byProp.accent[0].sourceIndex)).toBe("header-icon");
      expect(colorOf(chip)).toBe("#123456");
      // backgroundColor: the one card-surface tile, painted with the literal color
      expect(r.byProp.backgroundColor).toHaveLength(1);
      expect(r.byProp.backgroundColor[0].kind).toBe("color");
      const surface = srcs(r.doc)[r.byProp.backgroundColor[0].sourceIndex];
      expect(isTile(surface)).toBe(true);
      expect(colorOf(surface)).toBe("#FAFAFA");
      // washColor: one per drawn row (5 defaults), every one the "row" wash tile
      expect(r.byProp.washColor).toHaveLength(5);
      for (const b of r.byProp.washColor) {
        expect(b.kind).toBe("color");
        expect(labelAt(r.doc, b.sourceIndex)).toBe("row");
        expect(isTile(srcs(r.doc)[b.sourceIndex])).toBe(true);
      }
      // no other tile carries a binding (avatar discs, glyph mask)
      const colorBound = new Set([...r.byProp.accent, ...r.byProp.backgroundColor, ...r.byProp.washColor].map((b) => b.sourceIndex));
      const bound = new Set(Object.values(r.byProp).flat().map((b) => b.sourceIndex));
      srcs(r.doc).forEach((s, i) => { if (isTile(s) && !colorBound.has(i)) expect(bound.has(i)).toBe(false); });
    }
  });

  it("unset colors still bind their rects (double-click to SET); a transparent surface paints no card tile → no backgroundColor handle", async () => {
    const r = await bindingsOf(1280, 708); // defaults: accent / backgroundColor / washColor all unset
    expect(r.rejected).toEqual([]);
    expect(r.byProp.accent).toHaveLength(1);
    expect(r.byProp.backgroundColor).toHaveLength(1);
    expect(r.byProp.washColor).toHaveLength(5);
    const clear = await bindingsOf(1280, 708, { backgroundColor: "black@0" });
    expect(clear.rejected).toEqual([]);
    expect(clear.byProp.backgroundColor).toBeUndefined(); // never adds a rect
    expect(clear.byProp.accent).toHaveLength(1);
    expect(clear.byProp.washColor).toHaveLength(5);
  });
});
