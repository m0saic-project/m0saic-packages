import type { MosaicDocument, MosaicEngineContext, MosaicMediaMetadata, MosaicSource } from "@m0saic/types";
import { parseM0StringComplete, validateM0String } from "@m0saic/dsl";
import { auditRenderedTemplate, getTemplate, getTemplateAsRegistered, resolvePropBindings } from "@m0saic/template-utils";
import { QuoteCard } from "../v1/quote-card";
import { QuoteCardV2 } from "./quote-card";

const ID = "@m0saic/social/quote-card/v2";

const ctxFor = (
  w: number,
  h: number,
  media: Record<string, Partial<MosaicMediaMetadata>> = {},
): MosaicEngineContext => {
  const t = { width: w, height: h, fps: 30, durationMs: 2000 };
  return {
    mode: "render",
    target: t,
    output: { ...t, workspaceDir: "/tmp/quote-card-v2-test" },
    media,
  } as unknown as MosaicEngineContext;
};

const statusOf = (doc: MosaicDocument): string | undefined =>
  (doc.sources?.[0] as { engine?: { renderStatus?: string } } | undefined)?.engine?.renderStatus;
const isErrorMosaic = (doc: MosaicDocument): boolean => statusOf(doc) === "error";

const IMG = (width: number, height: number): Partial<MosaicMediaMetadata> => ({ kind: "image", width, height });

const editorLabels = (doc: MosaicDocument): string[] =>
  doc.sources
    .map((s) => (s as { editor?: { label?: string } }).editor?.label)
    .filter((l): l is string => !!l);

const bySource = (doc: MosaicDocument, label: string): MosaicSource =>
  doc.sources[editorLabels(doc).indexOf(label)] as MosaicSource;

const render = async (props: Record<string, unknown>, ctx = ctxFor(1080, 1080)): Promise<MosaicDocument> =>
  (await QuoteCardV2.render(props, ctx)) as MosaicDocument;

/** Strip the editor handles: what the card PAINTS, for the v1 parity check. */
const painted = (doc: MosaicDocument): unknown =>
  JSON.parse(JSON.stringify(doc), (k, v) => (k === "binding" || k === "bindings" ? undefined : v));

/** v2 without its card handle: the root `1{…}` unwrapped, the card source dropped. */
const sansCard = (doc: MosaicDocument): MosaicDocument => {
  const m0 = String(doc.m0);
  expect(m0.startsWith("1{") && m0.endsWith("}")).toBe(true);
  return { ...doc, m0: m0.slice(2, -1), sources: doc.sources.slice(1) } as MosaicDocument;
};

describe("@m0saic/social/quote-card/v2 — template shell", () => {
  it("metadata: id, version 2, core tier, lossless PNG output hints", () => {
    expect(String(QuoteCardV2.id)).toBe(ID);
    expect(QuoteCardV2.version).toBe(2);
    expect(QuoteCardV2.capabilities).toEqual({ tier: "core" });
    expect(QuoteCardV2.outputHints?.format).toEqual({ kind: "image", container: "png" });
  });

  it("describes itself in its catalog sidecar only: the code carries no label / copy, the registry applies the sidecar", () => {
    // The CODE's own view — what the file declares (what the freeze pins hash).
    const code = getTemplateAsRegistered(ID)!;
    for (const field of ["label", "description", "tags"]) expect((code as unknown as Record<string, unknown>)[field]).toBeUndefined();
    for (const def of Object.values(code.propsSchema ?? {})) {
      expect((def as { description?: string }).description).toBeUndefined();
      expect((def as { meta?: { ui?: unknown } }).meta?.ui).toBeUndefined();
    }
    const registered = getTemplate(ID)!;
    expect(registered.label).toBe("Quote Card");
    expect(registered.tags).toContain("quote");
    expect(registered.propsSchema?.quote?.meta?.ui).toMatchObject({ label: "Quote", order: 1, primary: true });
    expect(registered.propsSchema?.role?.meta?.control?.placeholder).toBe("none");
  });

  it("supersedes v1: the v1 sidecar deprecates it in favour of v2", () => {
    const v1 = getTemplate(String(QuoteCard.id))!;
    expect(v1.deprecated).toMatchObject({ replacement: ID });
    expect(getTemplate(ID)!.deprecated).toBeUndefined();
  });

  it("paints exactly what v1 paints — defaults, the full attribution path, dark, portrait (the card handle is the background's own colour)", async () => {
    const id = "/people/ada.png";
    const cases: Array<[Record<string, unknown>, MosaicEngineContext]> = [
      [{ ...QuoteCardV2.defaultProps }, ctxFor(1080, 1080)],
      [{ ...QuoteCardV2.defaultProps, role: "Mathematician", avatar: id, preset: "dark", align: "left" }, ctxFor(1080, 1350, { [id]: IMG(512, 512) })],
      [{ quote: "Just the words.", quoteMark: false, attribution: "" }, ctxFor(1080, 1920)],
    ];
    for (const [props, ctx] of cases) {
      const v1 = (await QuoteCard.render(props, ctx)) as MosaicDocument;
      const v2 = await render(props, ctx);
      expect(painted(sansCard(v2))).toEqual(painted(v1));
      // The card under the layout is an opaque fill in exactly the document's
      // background colour: over the background it paints nothing new.
      expect(v2.sources[0]).toMatchObject({ type: "lavfi", color: v1.backgroundColor });
      expect(v2.backgroundColor).toBe(v1.backgroundColor);
    }
  });

  it("defaults render standalone: mark + wrapped quote + accent + attribution, m0 valid, frames == sources", async () => {
    const doc = await render({ ...QuoteCardV2.defaultProps });
    expect(statusOf(doc)).not.toBe("error");
    expect(validateM0String(String(doc.m0)).ok).toBe(true);
    expect(editorLabels(doc)).toEqual(["card", "mark", "quote", "accent", "name"]);
    const parsed = parseM0StringComplete(String(doc.m0), 1080, 1080);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe(doc.sources.length);
    expect(doc.backgroundColor).toBe("#faf9f7");
  });

  it("determinism: double render is JSON-identical", async () => {
    const a = await render({ ...QuoteCardV2.defaultProps });
    const b = await render({ ...QuoteCardV2.defaultProps });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("an empty quote is an input the card waits on (incomplete), never an error", async () => {
    const doc = await render({ quote: "   " });
    expect(statusOf(doc)).toBe("incomplete");
  });

  it("fail-fast error mosaics: unprobed avatar, non-image avatar, hopeless canvas", async () => {
    expect(isErrorMosaic(await render({ quote: "Q", avatar: "/missing.png" }))).toBe(true);
    expect(
      isErrorMosaic(
        await render(
          { quote: "Q", avatar: "/clip.mp4" },
          ctxFor(1080, 1080, { "/clip.mp4": { kind: "video", width: 640, height: 360 } }),
        ),
      ),
    ).toBe(true);
    expect(isErrorMosaic(await render({ ...QuoteCardV2.defaultProps }, ctxFor(64, 64)))).toBe(true);
  });

  it("meets every 0.3.1 convention as new work (the build gate's render audit, no lag allowed)", async () => {
    const audit = await auditRenderedTemplate(getTemplate(ID)!, { record: false });
    expect(audit.findings.map((f) => `${f.convention}: ${f.violations.map((v) => v.detail).join(" | ")}`)).toEqual([]);
    expect(audit.lagging).toEqual([]);
  });
});

describe("@m0saic/social/quote-card/v2 — prop bindings (Make canvas handles)", () => {
  const schema = QuoteCardV2.propsSchema;
  const bindingsOf = async (props: Record<string, unknown>, c: MosaicEngineContext = ctxFor(1080, 1080)) => {
    const doc = await render(props, c);
    return { doc, ...resolvePropBindings(doc, c.target.width, c.target.height, { propsSchema: schema }) };
  };
  const labelAt = (doc: MosaicDocument, i: number): string | undefined =>
    (doc.sources[i] as { editor?: { label?: string } }).editor?.label;
  const keysOn = (doc: MosaicDocument, label: string): string[] =>
    ((bySource(doc, label) as { editor?: { bindings?: Array<{ propKey: string }> } }).editor?.bindings ?? []).map(
      (b) => b.propKey,
    );

  it("defaults: role and avatar ride the name rect as ADD handles; nothing is rejected", async () => {
    const r = await bindingsOf({ ...QuoteCardV2.defaultProps });
    expect(r.rejected).toEqual([]);
    expect(keysOn(r.doc, "name")).toEqual(["attribution", "ink", "role", "avatar"]);
    expect(keysOn(r.doc, "quote")).toEqual(["quote", "ink"]);
    expect(r.byProp.avatar.map((b) => b.kind)).toEqual(["media"]);
    expect(r.byProp.role.map((b) => labelAt(r.doc, b.sourceIndex))).toEqual(["name"]);
  });

  it("once a value exists it binds its own rect, and the add handle leaves the name", async () => {
    const id = "/people/ada.png";
    const r = await bindingsOf(
      { ...QuoteCardV2.defaultProps, role: "Mathematician", avatar: id },
      ctxFor(1080, 1080, { [id]: IMG(512, 512) }),
    );
    expect(r.rejected).toEqual([]);
    expect(keysOn(r.doc, "name")).toEqual(["attribution", "ink"]);
    expect(r.byProp.role.map((b) => labelAt(r.doc, b.sourceIndex))).toEqual(["role"]);
    expect(r.byProp.avatar.map((b) => labelAt(r.doc, b.sourceIndex))).toEqual(["avatar"]);
  });

  it("no attribution: attribution, role and avatar ride the quote rect", async () => {
    const r = await bindingsOf({ quote: "Just the words.", attribution: "" });
    expect(r.rejected).toEqual([]);
    expect(keysOn(r.doc, "quote")).toEqual(["quote", "ink", "attribution", "role", "avatar"]);
    expect(Object.keys(r.byProp).sort()).toEqual([
      "accent", "attribution", "avatar", "background", "ink", "margin", "preset", "quote", "role",
    ]);
  });

  it("colours: `accent` paints the mark + bar; `ink` stacks on the quote + name; `background` rides the card", async () => {
    const r = await bindingsOf({ ...QuoteCardV2.defaultProps });
    expect(r.byProp.accent.map((b) => labelAt(r.doc, b.sourceIndex)).sort()).toEqual(["accent", "mark"]);
    for (const b of [...r.byProp.accent, ...r.byProp.ink]) expect(b.kind).toBe("color");
    expect(r.byProp.ink.map((b) => labelAt(r.doc, b.sourceIndex)).sort()).toEqual(["name", "quote"]);
    expect(r.byProp.background.map((b) => [labelAt(r.doc, b.sourceIndex), b.kind])).toEqual([["card", "color"]]);
    expect(QuoteCardV2.bindings?.unbound).toBeUndefined();
  });

  it("the card is a handle: an empty spot on it offers light / dark, the background colour and the margin", async () => {
    const r = await bindingsOf({ ...QuoteCardV2.defaultProps });
    expect(labelAt(r.doc, 0)).toBe("card");
    expect(keysOn(r.doc, "card")).toEqual(["preset", "background", "margin"]);
    expect(r.byProp.preset.map((b) => [labelAt(r.doc, b.sourceIndex), b.kind])).toEqual([["card", "choice"]]);
    expect(r.byProp.margin.map((b) => labelAt(r.doc, b.sourceIndex))).toEqual(["card"]);
    // Every other rect sits on top of it (its overlay), so the text keeps its own click.
    const parsed = parseM0StringComplete(String(r.doc.m0), 1080, 1080);
    expect(parsed.ok).toBe(true);
    // The card paints what the document background is — preset, then override.
    const dark = await render({ ...QuoteCardV2.defaultProps, preset: "dark" });
    expect(dark.sources[0]).toMatchObject({ color: "#101014" });
    const custom = await render({ ...QuoteCardV2.defaultProps, preset: "dark", background: "#224466" });
    expect(custom.sources[0]).toMatchObject({ color: "#224466" });
    expect(custom.backgroundColor).toBe("#224466");
  });
});
