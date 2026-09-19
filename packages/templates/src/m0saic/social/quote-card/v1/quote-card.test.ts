import type { MosaicDocument, MosaicEngineContext, MosaicMediaMetadata, MosaicSource } from "@m0saic/types";
import { parseM0StringComplete, validateM0String } from "@m0saic/dsl";
import { resolvePropBindings } from "@m0saic/template-utils";
import { QuoteCard } from "./quote-card";

const ctxFor = (
  w: number,
  h: number,
  media: Record<string, Partial<MosaicMediaMetadata>> = {},
): MosaicEngineContext => {
  const t = { width: w, height: h, fps: 30, durationMs: 2000 };
  return {
    mode: "render",
    target: t,
    output: { ...t, workspaceDir: "/tmp/quote-card-test" },
    media,
  } as unknown as MosaicEngineContext;
};

const isErrorMosaic = (doc: MosaicDocument): boolean =>
  (doc.sources?.[0] as { engine?: { renderStatus?: string } } | undefined)?.engine?.renderStatus === "error";

const IMG = (width: number, height: number): Partial<MosaicMediaMetadata> => ({ kind: "image", width, height });

const editorLabels = (doc: MosaicDocument): string[] =>
  doc.sources
    .map((s) => (s as { editor?: { label?: string } }).editor?.label)
    .filter((l): l is string => !!l);

const bySource = (doc: MosaicDocument, label: string): MosaicSource =>
  doc.sources[editorLabels(doc).indexOf(label)] as MosaicSource;

const render = async (props: Record<string, unknown>, ctx = ctxFor(1080, 1080)): Promise<MosaicDocument> =>
  (await QuoteCard.render(props, ctx)) as MosaicDocument;

describe("@m0saic/social/quote-card/v1 — template shell", () => {
  it("metadata: id, core tier, lossless PNG output hints", () => {
    expect(String(QuoteCard.id)).toBe("@m0saic/social/quote-card/v1");
    expect(QuoteCard.version).toBe(1);
    expect(QuoteCard.capabilities).toEqual({ tier: "core" });
    expect(QuoteCard.outputHints?.format).toEqual({ kind: "image", container: "png" });
  });

  it("defaults render standalone: mark + wrapped quote + accent + attribution, m0 valid, frames == sources", async () => {
    const doc = await render({ ...QuoteCard.defaultProps });
    expect(isErrorMosaic(doc)).toBe(false);
    expect(validateM0String(String(doc.m0)).ok).toBe(true);
    const labels = editorLabels(doc);
    expect(labels).toEqual(["mark", "quote", "accent", "name"]);
    const parsed = parseM0StringComplete(String(doc.m0), 1080, 1080);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe(doc.sources.length);
    expect(doc.size).toEqual({ width: 1080, height: 1080 });
    expect(doc.backgroundColor).toBe("#faf9f7");
    expect(doc.fps).toBe(30);
    expect(Object.keys(doc.assets ?? {}).length).toBe(0);
  });

  it("determinism: double render is JSON-identical", async () => {
    const a = await render({ ...QuoteCard.defaultProps });
    const b = await render({ ...QuoteCard.defaultProps });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("the quote wraps into a multi-line svg text source (template-side wrap, \\n-joined)", async () => {
    const doc = await render({
      quote:
        "A frame tree of hundreds of real cells — even thousands — is the success mode, even when the string is enormous.",
    });
    const quote = bySource(doc, "quote") as { layers: Array<{ content: { text: string } }> };
    expect(quote.layers[0].content.text).toContain("\n");
  });

  it("all text cells use the deterministic svg rasterizer as single-frame stills", async () => {
    const doc = await render({ ...QuoteCard.defaultProps, role: "A role" });
    const texts = doc.sources.filter((s) => (s as MosaicSource).type === "text") as Array<{
      rasterizer?: string;
      renderMode?: { kind?: string };
    }>;
    expect(texts.length).toBe(4); // mark, quote, name, role
    expect(texts.every((t) => t.rasterizer === "svg")).toBe(true);
    expect(texts.every((t) => t.renderMode?.kind === "image")).toBe(true);
  });

  it("presets: dark duo pinned; explicit overrides win; role uses the subtle ink", async () => {
    const dark = await render({ ...QuoteCard.defaultProps, preset: "dark", role: "Role" });
    expect(dark.backgroundColor).toBe("#101014");
    const roleSrc = bySource(dark, "role") as { layers: Array<{ style: { fontColor: string } }> };
    expect(roleSrc.layers[0].style.fontColor).toBe("#a3a7b0");
    const over = await render({ ...QuoteCard.defaultProps, background: "#123456", ink: "#abcdef" });
    expect(over.backgroundColor).toBe("#123456");
    const q = bySource(over, "quote") as { layers: Array<{ style: { fontColor: string } }> };
    expect(q.layers[0].style.fontColor).toBe("#abcdef");
  });

  it("accent colors the mark and the bar; blank accent falls back to the default", async () => {
    const doc = await render({ ...QuoteCard.defaultProps, accent: "#22cc88" });
    const bar = bySource(doc, "accent") as { type: string; color?: string };
    expect(bar.type).toBe("lavfi");
    expect(bar.color).toBe("#22cc88");
    const mark = bySource(doc, "mark") as { layers: Array<{ style: { fontColor: string } }> };
    expect(mark.layers[0].style.fontColor).toBe("#22cc88");
    const blank = await render({ ...QuoteCard.defaultProps, accent: "  " });
    expect((bySource(blank, "accent") as { color?: string }).color).toBe("#f97316");
  });

  it("avatar: probed image becomes a cover-fit media source with a pill clip + a manifest entry", async () => {
    const id = "/people/ada.png";
    const doc = await render(
      { ...QuoteCard.defaultProps, avatar: id, role: "Mathematician" },
      ctxFor(1080, 1080, { [id]: IMG(512, 512) }),
    );
    expect(isErrorMosaic(doc)).toBe(false);
    const avatar = bySource(doc, "avatar") as {
      type: string;
      assetId: string;
      placement?: { fit?: string };
      effects?: { rounding?: { cornerStyle?: string } };
    };
    expect(avatar.type).toBe("media");
    expect(avatar.placement?.fit).toBe("cover");
    expect(avatar.effects?.rounding?.cornerStyle).toBe("pill");
    const assets = doc.assets as Record<string, { path?: string }>;
    expect(assets[avatar.assetId]?.path).toBe(id);
  });

  it("quoteMark false removes the mark; empty attribution removes the name", async () => {
    const doc = await render({ quote: "Just the words.", quoteMark: false, attribution: "" });
    expect(editorLabels(doc)).toEqual(["quote", "accent"]);
  });

  it("fail-fast error mosaics: empty quote, unprobed avatar, non-image avatar, hopeless canvas", async () => {
    expect(isErrorMosaic(await render({ quote: "   " }))).toBe(true);
    expect(isErrorMosaic(await render({ quote: "Q", avatar: "/missing.png" }))).toBe(true);
    expect(
      isErrorMosaic(
        await render(
          { quote: "Q", avatar: "/clip.mp4" },
          ctxFor(1080, 1080, { "/clip.mp4": { kind: "video", width: 640, height: 360 } }),
        ),
      ),
    ).toBe(true);
    expect(isErrorMosaic(await render({ ...QuoteCard.defaultProps }, ctxFor(64, 64)))).toBe(true);
  });

  it("aspect-safe: portrait and landscape both render without error", async () => {
    for (const [w, h] of [[1080, 1920], [1920, 1080], [1080, 1350]] as const) {
      const doc = await render({ ...QuoteCard.defaultProps, role: "Role" }, ctxFor(w, h));
      expect(isErrorMosaic(doc)).toBe(false);
      expect(doc.size).toEqual({ width: w, height: h });
    }
  });

  it("margin clamps to its slider range", async () => {
    const doc = await render({ ...QuoteCard.defaultProps, margin: 5 });
    expect(isErrorMosaic(doc)).toBe(false);
    const parsed = parseM0StringComplete(String(doc.m0), 1080, 1080);
    expect(parsed.ok).toBe(true);
  });
});

describe("@m0saic/social/quote-card/v1 — prop bindings (Make inline edit)", () => {
  const schema = QuoteCard.propsSchema;
  const bindingsOf = async (props: Record<string, unknown>, c: MosaicEngineContext = ctxFor(1080, 1080)) => {
    const doc = await render(props, c);
    return { doc, ...resolvePropBindings(doc, c.target.width, c.target.height, { propsSchema: schema }) };
  };
  const labelAt = (doc: MosaicDocument, i: number): string | undefined =>
    (doc.sources[i] as { editor?: { label?: string } }).editor?.label;

  it("binds quote / attribution / role, each to exactly one root text rect", async () => {
    const r = await bindingsOf({ ...QuoteCard.defaultProps, role: "Founder" });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["accent", "attribution", "ink", "quote", "role"]);
    for (const [key, label] of [
      ["quote", "quote"],
      ["attribution", "name"],
      ["role", "role"],
    ] as const) {
      expect(schema[key]).toBeDefined();
      expect(r.byProp[key]).toHaveLength(1);
      const b = r.byProp[key][0];
      expect("index" in b).toBe(false);
      expect(b.childPath).toEqual([]);
      expect(labelAt(r.doc, b.sourceIndex)).toBe(label);
    }
    // decoration (mark, accent bar) binds no TEXT prop — only its `accent` colour (below)
    const textBound = new Set(["quote", "attribution", "role"].flatMap((k) => r.byProp[k].map((b) => b.sourceIndex)));
    const markIdx = r.doc.sources.findIndex((_s, i) => labelAt(r.doc, i) === "mark");
    expect(markIdx).toBeGreaterThanOrEqual(0);
    expect(textBound.has(markIdx)).toBe(false);
  });

  it("empty attribution / role drop their cells (no rect → no binding); the quote stays bound", async () => {
    const r = await bindingsOf({ quote: "Just the words.", attribution: "" });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["accent", "ink", "quote"]);
  });

  it("same set at portrait, with an avatar and the dark preset", async () => {
    const id = "/people/ada.png";
    const r = await bindingsOf(
      { ...QuoteCard.defaultProps, role: "Mathematician", avatar: id, preset: "dark" },
      ctxFor(1080, 1920, { [id]: IMG(512, 512) }),
    );
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["accent", "attribution", "ink", "quote", "role"]);
  });

  it("colours: `accent` paints the mark + bar (kind color); `ink` stacks beside quote + attribution", async () => {
    const r = await bindingsOf({ ...QuoteCard.defaultProps, role: "Founder" });
    expect(r.rejected).toEqual([]);

    // accent → the two rects it paints (1:N), both colour-kind, root doc, scalar
    expect(r.byProp.accent.map((b) => labelAt(r.doc, b.sourceIndex)).sort()).toEqual(["accent", "mark"]);
    for (const b of r.byProp.accent) {
      expect(b.kind).toBe("color");
      expect(b.childPath).toEqual([]);
      expect("index" in b).toBe(false);
    }

    // ink → a SECOND entry on the quote + name rects (same source as their text binding)
    expect(r.byProp.ink).toHaveLength(2);
    for (const b of r.byProp.ink) expect(b.kind).toBe("color");
    const asc = (a: number, b: number) => a - b;
    expect(r.byProp.ink.map((b) => b.sourceIndex).sort(asc)).toEqual(
      [r.byProp.quote[0].sourceIndex, r.byProp.attribution[0].sourceIndex].sort(asc),
    );
    expect(r.byProp.quote[0].kind).toBe("string");
    // the role line is inked by the preset's `subtle`, not by `ink` → no colour entry there
    expect(r.byProp.ink.map((b) => b.sourceIndex)).not.toContain(r.byProp.role[0].sourceIndex);
    // `background` is doc.backgroundColor — no rect exists, so nothing binds it
    expect(r.byProp.background).toBeUndefined();
  });

  it("quoteMark off drops the mark cell → `accent` binds the bar alone; stacked entries keep the text primary", async () => {
    const r = await bindingsOf({ ...QuoteCard.defaultProps, quoteMark: false });
    expect(r.rejected).toEqual([]);
    expect(r.byProp.accent.map((b) => labelAt(r.doc, b.sourceIndex))).toEqual(["accent"]);
    const quoteSrc = r.doc.sources[r.byProp.quote[0].sourceIndex] as {
      editor?: { bindings?: Array<{ propKey: string }> };
    };
    expect(quoteSrc.editor?.bindings?.map((e) => e.propKey)).toEqual(["quote", "ink"]);
  });
});
