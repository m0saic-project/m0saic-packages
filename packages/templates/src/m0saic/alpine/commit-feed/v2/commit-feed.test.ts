import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete, getComplexityMetricsFast } from "@m0saic/dsl";
import { resolvePropBindings } from "@m0saic/template-utils";
import { AlpineCommitFeedV2 } from "./commit-feed";

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
  AlpineCommitFeedV2.render({ ...(AlpineCommitFeedV2.defaultProps as object), ...props } as never, makeCtx(W, H)) as Promise<MosaicDocument>;

const srcs = (doc: MosaicDocument) => (doc.sources ?? []) as MosaicSource[];
const texts = (doc: MosaicDocument) =>
  srcs(doc)
    .filter((s) => (s as { type?: string }).type === "text")
    .flatMap((s) => ((s as { layers?: Array<{ content?: { text?: string } }> }).layers ?? []).map((l) => l.content?.text ?? ""));

describe("AlpineCommitFeedV2 — metadata", () => {
  it("is the registered v2 primitive (not deprecated)", () => {
    expect(AlpineCommitFeedV2.id).toBe("@m0saic/alpine/commit-feed/v2");
    expect(AlpineCommitFeedV2.version).toBe(2);
    expect((AlpineCommitFeedV2 as { deprecated?: unknown }).deprecated).toBeUndefined();
    expect(AlpineCommitFeedV2.primitive).toBe(true);
    expect(AlpineCommitFeedV2.tags).toEqual(expect.arrayContaining(["alpine", "commit-feed", "feed"]));
  });
});

describe("AlpineCommitFeedV2 — renders at every aspect", () => {
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

describe("AlpineCommitFeedV2 — RATIO precision (the v2 win)", () => {
  // The whole point of the rebuild: precision is BOUNDED (by the split basis cap ~120)
  // and does NOT track the canvas the way v1's placeRects did (v1 pinned to ~canvas px).
  const precAt = async (W: number, H: number) => {
    const d = await render(W, H, { anim: { reduceMotion: true } });
    const m = getComplexityMetricsFast(d.m0 as unknown as string);
    return { x: m.precision.maxSplitX, y: m.precision.maxSplitY };
  };
  const BOUND = 160; // ~ the SPLIT_BASIS_CAP (120) with headroom

  it("precision stays bounded across a resolution sweep (never tracks the canvas)", async () => {
    for (const [W, H] of [[640, 360], [1280, 720], [2560, 1440]] as const) {
      const p = await precAt(W, H);
      expect(p.x).toBeLessThanOrEqual(BOUND);
      expect(p.y).toBeLessThanOrEqual(BOUND);
    }
  });

  it("precision does NOT scale with canvas (2× resolution ⇒ same precision, not 2×)", async () => {
    const lo = await precAt(1280, 720);
    const hi = await precAt(2560, 1440);
    expect(hi.x).toBe(lo.x); // absolute (placeRects) would roughly double; ratio holds flat
    expect(hi.y).toBe(lo.y);
  });
});

describe("AlpineCommitFeedV2 — composition + animation", () => {
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
    const doc = (await AlpineCommitFeedV2.render({ rows: [] } as never, makeCtx(1280, 708))) as MosaicDocument;
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
  });
});

describe("AlpineCommitFeedV2 — two-mode reveal", () => {
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

describe("AlpineCommitFeedV2 — local theming", () => {
  const themedCtx = (tokens: Record<string, unknown>): MosaicEngineContext =>
    ({ mode: "render", target: { width: 1280, height: 708, fps: 30, durationMs: 3000 }, output: {}, media: {}, upstreamData: { theme: tokens } } as unknown as MosaicEngineContext);

  it("a producer theme recolors the card + titles; unthemed default does not carry those tokens", async () => {
    const plain = JSON.stringify(await render(1280, 708));
    expect(plain).not.toContain("#101820");
    const themed = JSON.stringify((await AlpineCommitFeedV2.render(AlpineCommitFeedV2.defaultProps as never, themedCtx({ surface: "#101820", textPrimary: "#00FFCC" }))) as MosaicDocument);
    expect(themed).toContain("#101820");
    expect(themed).toContain("#00FFCC");
  });

  it("an explicit accent still wins over a producer theme", async () => {
    const themed = JSON.stringify((await AlpineCommitFeedV2.render({ ...(AlpineCommitFeedV2.defaultProps as object), accent: "#123456" } as never, themedCtx({ accent: "#00FFCC" }))) as MosaicDocument);
    expect(themed).toContain("#123456");
  });
});

describe("AlpineCommitFeedV2 — equal row size (the 96/94/90/93/96 quantization fix)", () => {
  // Same class as bar-graph's squashed middle bar (gate 1, 2026-08-20): the
  // old interleaved [row, gap, ...] weights let the engine's OUTSIDE-IN
  // remainder distribution starve the CENTER row under ancestor drift —
  // measured 96/94/90/93/96 at 1001×733. The fix is one EQUAL band per row
  // with the half-gap carved inside it by a tiny [1, K, 1] split, so rows can
  // never differ by more than ~1px at any canvas.
  const HOSTILE_CANVASES: Array<[number, number]> = [
    [1280, 800],
    [1001, 733], // the measured repro
    [640, 400],
    [1920, 1080],
    [607, 401],
    [640, 360], // kind-chip inset repro: 100-grain insetNode was infeasible here
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

  it("every row band within 1px of the others at every canvas", async () => {
    for (const [w, h] of HOSTILE_CANVASES) {
      const heights = await rowHeights(w, h);
      expect(heights).toHaveLength(5);
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
    }
  });

  it("debugLayout contract passes at every canvas", async () => {
    for (const [w, h] of HOSTILE_CANVASES) {
      const doc = await AlpineCommitFeedV2.render(
        { ...(AlpineCommitFeedV2.defaultProps as object), debugLayout: true } as never,
        makeCtx(w, h),
      ) as MosaicDocument;
      const stamp = (doc as { editor?: { layoutContract?: { ok?: boolean } } }).editor?.layoutContract;
      expect(stamp?.ok).toBe(true);
    }
  });

  it("debugLayout off (default) leaves the doc unstamped — zero-cost path", async () => {
    const doc = await render(1280, 708);
    expect((doc as { editor?: { layoutContract?: unknown } }).editor?.layoutContract).toBeUndefined();
  });
});

describe("AlpineCommitFeedV2 — friendly `icon` knob over the raw iconPath agent prop", () => {
  it("icon name drives the header glyph exactly like the equivalent raw iconPath", async () => {
    const { ALPINE_GLYPHS } = await import("../../_shared/alpine-glyphs");
    const viaName = await render(1280, 708, { icon: "commits", anim: { reduceMotion: true } });
    const viaRaw = await render(1280, 708, { iconPath: ALPINE_GLYPHS.commits, anim: { reduceMotion: true } });
    expect(viaName.m0).toBe(viaRaw.m0);
    expect(JSON.stringify(viaName.sources)).toBe(JSON.stringify(viaRaw.sources));
  });

  it("an unknown icon name fails fast (raw default cleared so the name resolves)", async () => {
    // Defaults now carry iconPath (= commits, the canonical raw) — clear it so
    // the friendly name is what resolves, then the bad name must throw.
    await expect(render(1280, 708, { icon: "sparkles", iconPath: undefined })).rejects.toThrow(/unknown icon "sparkles"/);
  });

  it("defaults to the commits glyph — the dropdown's inverse-lookup shows the name", async () => {
    const { ALPINE_GLYPHS } = await import("../../_shared/alpine-glyphs");
    expect((AlpineCommitFeedV2.defaultProps as { iconPath?: string }).iconPath).toBe(ALPINE_GLYPHS.commits);
  });
});

describe("AlpineCommitFeedV2 — first-open cover (mosaic-branding theme)", () => {
  const coverCtx = {
    mode: "render" as const,
    target: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    output: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    media: {},
  } as unknown as MosaicEngineContext;

  it("branded pane + the template's own default render INLINED as hero", async () => {
    expect(typeof AlpineCommitFeedV2.renderCover).toBe("function");
    const doc = (await AlpineCommitFeedV2.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    const s = JSON.stringify(doc.sources);
    expect(s).toContain("Commit Feed");
    // Band variant: no conversation pane, just brand + title.
    expect(s).not.toContain("START HERE");
    // Inline-flat hero (gate-15/21 keeper): no nested cover child refs.
    expect(s).not.toContain('"type":"mosaic","ref":"cover');
  });

  it("cover is deterministic", async () => {
    const a = (await AlpineCommitFeedV2.renderCover!({} as never, coverCtx)) as MosaicDocument;
    const b = (await AlpineCommitFeedV2.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(a.m0).toBe(b.m0);
  });
});

describe("AlpineCommitFeedV2 — kind styling: widened built-ins + named marks", () => {
  const { KIND_MARKS } = require("./commit-feed");
  const rowsOf = (kind: string) => [{ kind, title: `${kind}: something`, author: "a", date: "May 1" }];

  it("new built-in kinds render with their own chip color + mark (no override map needed)", async () => {
    const doc = await render(1280, 708, { rows: rowsOf("security"), anim: { reduceMotion: true } });
    const json = JSON.stringify(doc.sources);
    expect(json).toContain("#f0883e"); // security chip color
    expect(json).toContain(KIND_MARKS.shield); // security mark
  });

  it("kindGlyphs override accepts a mark NAME — the friendly value domain", async () => {
    const doc = await render(1280, 708, { rows: rowsOf("hotfix"), kindGlyphs: { hotfix: "shield" }, anim: { reduceMotion: true } });
    expect(JSON.stringify(doc.sources)).toContain(KIND_MARKS.shield);
  });

  it("kindGlyphs override still accepts a raw SVG path", async () => {
    const doc = await render(1280, 708, { rows: rowsOf("hotfix"), kindGlyphs: { hotfix: "M1 1h22v22H1Z" }, anim: { reduceMotion: true } });
    expect(JSON.stringify(doc.sources)).toContain("M1 1h22v22H1Z");
  });

  it("an unknown mark name fails fast, naming the vocabulary", async () => {
    await expect(
      render(1280, 708, { rows: rowsOf("hotfix"), kindGlyphs: { hotfix: "sparkles" }, anim: { reduceMotion: true } }),
    ).rejects.toThrow(/unknown kind mark "sparkles".*shield/);
  });

  it("an unstyled CUSTOM kind still degrades gracefully (muted, no glyph)", async () => {
    const doc = await render(1280, 708, { rows: rowsOf("mystery"), anim: { reduceMotion: true } });
    expect(JSON.stringify(doc.sources)).not.toContain(KIND_MARKS.shield);
  });
});

describe("AlpineCommitFeedV2 — prop bindings (Make inline edit)", () => {
  const schema = AlpineCommitFeedV2.propsSchema;
  const bindingsOf = async (W: number, H: number, props: Record<string, unknown> = {}) => {
    const doc = await render(W, H, { anim: { reduceMotion: true }, ...props });
    return { doc, ...resolvePropBindings(doc, W, H, { propsSchema: schema }) };
  };
  const labelAt = (doc: MosaicDocument, i: number) => (srcs(doc)[i] as { editor?: { label?: string } }).editor?.label;
  const textAt = (doc: MosaicDocument, i: number) =>
    ((srcs(doc)[i] as { layers?: Array<{ content?: { text?: string } }> }).layers ?? [])[0]?.content?.text;
  const isTile = (s: MosaicSource) => (s as { type?: string }).type === "lavfi";
  const colorOf = (s: MosaicSource) => (s as { color?: string }).color;

  // This template draws its own header (no alpineCard): title and subtitle are
  // two separate text rects, each bound to its prop. rows[] is object data.
  for (const [W, H, label] of ASPECTS) {
    it(`${label} ${W}x${H}: title / subtitle → the self-drawn header rects (one each, root); rows → leaf bindings`, async () => {
      const r = await bindingsOf(W, H);
      expect(r.rejected).toEqual([]);
      expect(Object.keys(r.byProp).sort()).toEqual(["accent", "backgroundColor", "rows", "subtitle", "title", "washColor"]);
      expect(r.byProp.title).toHaveLength(1);
      expect("index" in r.byProp.title[0]).toBe(false);
      expect(r.byProp.title[0].childPath).toEqual([]);
      expect(labelAt(r.doc, r.byProp.title[0].sourceIndex)).toBe("feed-title");
      expect(textAt(r.doc, r.byProp.title[0].sourceIndex)).toBe("NOTABLE COMMITS");
      expect(r.byProp.subtitle).toHaveLength(1);
      expect(r.byProp.subtitle[0].childPath).toEqual([]);
      expect(labelAt(r.doc, r.byProp.subtitle[0].sourceIndex)).toBe("feed-subtitle");
    });
  }

  it("both header rects always exist (fallback copy) and stay bound so double-click can ADD; showHeader:false drops them", async () => {
    for (const p of [{ title: undefined }, { subtitle: undefined }, { title: undefined, subtitle: undefined }]) {
      const r = await bindingsOf(1280, 708, p);
      expect(r.rejected).toEqual([]);
      expect(r.byProp.title).toHaveLength(1);
      expect(r.byProp.subtitle).toHaveLength(1);
    }
    const none = await bindingsOf(1280, 708, { showHeader: false });
    expect(none.rejected).toEqual([]);
    // no header → no chip → no accent handle; the surface + row washes remain
    expect(Object.keys(none.byProp).sort()).toEqual(["backgroundColor", "rows", "washColor"]);
  });

  it("colors: accent → the header chip (kind color), backgroundColor → the card surface, washColor → EVERY row wash (1:N); kind chips / signal bars / area chips / reviewer discs stay unbound", async () => {
    for (const [W, H] of [[1280, 708], [720, 1280]] as const) {
      const r = await bindingsOf(W, H, { accent: "#123456", backgroundColor: "#FAFAFA", washColor: "#EEEEEE" });
      expect(r.rejected).toEqual([]);
      expect(r.byProp.accent).toHaveLength(1);
      expect(r.byProp.accent[0]).toMatchObject({ kind: "color", childPath: [] });
      expect("index" in r.byProp.accent[0]).toBe(false);
      const chip = srcs(r.doc)[r.byProp.accent[0].sourceIndex];
      expect(isTile(chip)).toBe(true);
      expect(labelAt(r.doc, r.byProp.accent[0].sourceIndex)).toBe("header-icon");
      expect(colorOf(chip)).toBe("#123456");
      expect(r.byProp.backgroundColor).toHaveLength(1);
      expect(r.byProp.backgroundColor[0].kind).toBe("color");
      const surface = srcs(r.doc)[r.byProp.backgroundColor[0].sourceIndex];
      expect(isTile(surface)).toBe(true);
      expect(colorOf(surface)).toBe("#FAFAFA");
      expect(r.byProp.washColor).toHaveLength(5); // one per drawn row
      for (const b of r.byProp.washColor) {
        expect(b.kind).toBe("color");
        expect(labelAt(r.doc, b.sourceIndex)).toBe("row");
        expect(isTile(srcs(r.doc)[b.sourceIndex])).toBe(true);
      }
      // every other tile — signal bar (enum), kind chip (kindColors map), glyph masks,
      // area chip (kind-tinted blend), reviewer discs (fixed hues) — is NOT a handle
      const colorBound = new Set([...r.byProp.accent, ...r.byProp.backgroundColor, ...r.byProp.washColor].map((b) => b.sourceIndex));
      const bound = new Set(Object.values(r.byProp).flat().map((b) => b.sourceIndex));
      let otherTiles = 0;
      srcs(r.doc).forEach((s, i) => { if (isTile(s) && !colorBound.has(i)) { otherTiles++; expect(bound.has(i)).toBe(false); } });
      expect(otherTiles).toBeGreaterThan(5); // the signal bars + kind chips at least
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

  it("rows[i].{title,pr,area,author,date,reviewers[k]} → leaf bindings at the ORIGINAL row index", async () => {
    const r = await bindingsOf(1280, 708);
    const leaves = r.byProp.rows.map((b) => ({ path: b.path, kind: b.kind, label: labelAt(r.doc, b.sourceIndex) }));
    // five default rows, all in the root doc
    expect(r.byProp.rows.every((b) => b.childPath.length === 0 && b.index === undefined)).toBe(true);
    for (let i = 0; i < 5; i++) {
      expect(leaves).toContainEqual({ path: [i, "title"], kind: "string", label: "row-title" });
      expect(leaves).toContainEqual({ path: [i, "pr"], kind: "number", label: "row-pr" });
      expect(leaves).toContainEqual({ path: [i, "author"], kind: "string", label: "row-author" });
      expect(leaves).toContainEqual({ path: [i, "date"], kind: "string", label: "row-date" });
      expect(leaves).toContainEqual({ path: [i, "area"], kind: "string", label: "chip-text" });
    }
    // reviewer discs: row 0 has two reviewers → [0,"reviewers",0] and [0,"reviewers",1]
    expect(leaves.filter((l) => l.path![1] === "reviewers" && l.path![0] === 0).map((l) => l.path![2])).toEqual([0, 1]);
    expect(leaves.filter((l) => l.path![1] === "reviewers" && l.path![0] === 1).map((l) => l.path![2])).toEqual([0]);
    // the bound title rect really shows that row's title
    const t0 = r.byProp.rows.find((b) => b.path![0] === 0 && b.path![1] === "title")!;
    expect(textAt(r.doc, t0.sourceIndex)).toContain("avcodec");
  });

  it("filtered-out and truncated rows keep the surviving rows at their ORIGINAL indices", async () => {
    const rows = [
      { title: "keep 0", pr: 1 },
      { kind: "fix" } as unknown as { title: string }, // no title → filtered out
      { title: "keep 2", pr: 3 },
    ];
    const r = await bindingsOf(1280, 708, { rows });
    expect(r.rejected).toEqual([]);
    const titles = r.byProp.rows.filter((b) => b.path![1] === "title").map((b) => b.path![0]);
    expect(titles).toEqual([0, 2]);
    expect(textAt(r.doc, r.byProp.rows.find((b) => b.path![0] === 2 && b.path![1] === "title")!.sourceIndex)).toBe("keep 2");
    // no author/date/area rows → those rects still exist (empty text) and stay bound as ADD handles
    expect(r.byProp.rows.some((b) => b.path![0] === 2 && b.path![1] === "author")).toBe(true);
    expect(r.byProp.rows.some((b) => b.path![0] === 2 && b.path![1] === "area")).toBe(false); // area chip only when set
  });

  it("bindings ride the animated sources in both reveal modes (premium fade / light gate)", async () => {
    for (const anim of [{ reduceMotion: false }, { renderMode: "light" }]) {
      const r = await bindingsOf(1280, 708, { anim });
      expect(r.rejected).toEqual([]);
      expect(Object.keys(r.byProp).sort()).toEqual(["accent", "backgroundColor", "rows", "subtitle", "title", "washColor"]);
      expect(r.byProp.rows.length).toBeGreaterThanOrEqual(25); // 5 rows × (title, pr, author, date, area)
      expect(r.byProp.accent).toHaveLength(1);
      expect(r.byProp.backgroundColor).toHaveLength(1);
      expect(r.byProp.washColor).toHaveLength(5);
    }
  });
});
