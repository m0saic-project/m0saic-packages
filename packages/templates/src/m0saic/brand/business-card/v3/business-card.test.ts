/**
 * @m0saic/brand/business-card/v3 — template gate. v3 is v2's card with a
 * theme and a choice of back, so the core lock is PAINT PARITY with v2 on the
 * dark theme (both faces, handles stripped) but for the two print inks; the
 * rest locks what is new: the print contrast, the light palette, the solutions
 * back (big QR, or a picture beside a smaller one), the handles, the catalog
 * sidecar, the audit as new work.
 */
import type { MosaicDocument, MosaicDocumentPipeline, MosaicEngineContext, MosaicRenderableFile } from "@m0saic/types";
import { NAVY, NAVY_SOFT, auditRenderedTemplate, getTemplate, getTemplateAsRegistered, mixHex, resolvePropBindings } from "@m0saic/template-utils";
import "../../../index"; // registers every back the catalog nests
import { BusinessCardV2 } from "../v2/business-card";
import { cardCanvas, rectInside } from "../v1/layout";
import { BACK_MODES, BusinessCardV3, TEMPLATE_BACK_KEYS, cardPalette, pickBackMode, pickTemplateBack, pickTheme, printedUrl } from "./business-card";

const ID = "@m0saic/brand/business-card/v3";
const NATURAL = cardCanvas("moo", 300);

const ctxFor = (w: number, h: number): MosaicEngineContext => {
  const t = { width: w, height: h, fps: 30, durationMs: 1000 };
  return { mode: "render", target: t, output: { ...t, workspaceDir: "/tmp/business-card-v3-test" }, media: {} } as unknown as MosaicEngineContext;
};

const render = async (props: Record<string, unknown>, ctx = ctxFor(NATURAL.W, NATURAL.H)): Promise<MosaicRenderableFile> =>
  BusinessCardV3.render({ ...BusinessCardV3.defaultProps, ...props }, ctx);

const faces = (file: MosaicRenderableFile): { front: MosaicDocument; back: MosaicDocument } => {
  const p = file as MosaicDocumentPipeline;
  expect(p.steps.map((s) => s.name)).toEqual(["front", "back"]);
  return { front: p.steps[0].file as MosaicDocument, back: p.steps[1].file as MosaicDocument };
};

/** Strip the editor handles: what the card PAINTS, for the v2 parity check. */
const painted = (file: MosaicRenderableFile): unknown =>
  JSON.parse(JSON.stringify(file), (k, v) => (k === "binding" || k === "bindings" ? undefined : v));

/** CIELAB L* and LCh chroma / hue (D65) of an sRGB hex, and the WCAG contrast ratio of two. */
const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * linear((n >> 16) / 255) + 0.7152 * linear(((n >> 8) & 255) / 255) + 0.0722 * linear((n & 255) / 255);
};
const lightness = (hex: string): number => {
  const y = luminance(hex);
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const chromaHue = (hex: string): { chroma: number; hue: number } => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => linear(v / 255));
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  const [a, bb] = [500 * (fx - fy), 200 * (fy - fz)];
  return { chroma: Math.hypot(a, bb), hue: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 };
};

const labels = (doc: MosaicDocument): string[] => doc.sources.map((s) => (s as { editor?: { label?: string } }).editor?.label ?? "");

const keysOn = (doc: MosaicDocument, label: string): string[] => {
  const s = doc.sources.find((x) => (x as { editor?: { label?: string } }).editor?.label === label) as
    | { editor?: { binding?: { propKey: string }; bindings?: Array<{ propKey: string }> } }
    | undefined;
  return (s?.editor?.bindings ?? (s?.editor?.binding ? [s.editor.binding] : [])).map((b) => b.propKey);
};

describe(`${ID} — template shell`, () => {
  it("id, version 3, core tier, PNG still hints at MOO's exact bleed box", () => {
    expect(String(BusinessCardV3.id)).toBe(ID);
    expect(BusinessCardV3.version).toBe(3);
    expect(BusinessCardV3.outputHints).toMatchObject({ width: 1098, height: 648, format: { kind: "image", container: "png" } });
  });

  it("describes itself in its catalog sidecar only; the registry applies it", () => {
    const code = getTemplateAsRegistered(ID)!;
    for (const field of ["label", "description", "tags"]) expect((code as unknown as Record<string, unknown>)[field]).toBeUndefined();
    const registered = getTemplate(ID)!;
    expect(registered.label).toBe("Business Card");
    expect(registered.propsSchema?.back?.meta?.ui).toMatchObject({ label: "Back", primary: true });
  });

  it("supersedes v2: the v2 sidecar deprecates it in favour of v3", () => {
    expect(getTemplate(String(BusinessCardV2.id))!.deprecated).toMatchObject({ replacement: ID });
  });

  it("meets every 0.3.1 convention as new work", async () => {
    const audit = await auditRenderedTemplate(getTemplate(ID)!, { record: false });
    const errors = audit.findings.filter((f) => f.severity === "error");
    expect(errors.map((f) => `${f.convention}: ${f.violations.map((v) => v.detail).join(" | ")}`)).toEqual([]);
    expect(audit.lagging).toEqual([]);
  });

  it("defaults: the light theme, the solutions back", () => {
    expect(BusinessCardV3.defaultProps).toMatchObject({ theme: "light", back: "solutions", qrUrl: "https://m0saic.io/solutions" });
    expect(pickTheme(undefined)).toBe("light");
    expect(pickTheme("dark")).toBe("dark");
    expect(pickBackMode("nope")).toBe("solutions");
    expect(BACK_MODES).toEqual(["solutions", "hello-world", "template"]);
    // hello-world is its own back, so the template list leaves it out.
    expect(TEMPLATE_BACK_KEYS).not.toContain("hello-world");
    expect(pickTemplateBack("donut")).toBe("donut");
    expect(pickTemplateBack("hello-world")).toBe(TEMPLATE_BACK_KEYS[0]);
  });

  it("the back's knobs only show for the back they belong to", () => {
    const ui = (key: string) => (BusinessCardV3.propsSchema as Record<string, { meta?: { ui?: { visibleWhen?: unknown } } }>)[key]?.meta?.ui?.visibleWhen;
    expect(ui("backTemplate")).toEqual({ prop: "back", equals: "template" });
    for (const key of ["qrUrl", "backTitle", "backLine", "backImage"]) expect(ui(key)).toEqual({ prop: "back", equals: "solutions" });
  });
});

describe(`${ID} — the OG card (dark, a template back) paints v2's card with the print inks`, () => {
  // The only differences from v2: the field tile and the secondary grey.
  const DARK = cardPalette("dark", 0.5);
  const asV2 = (file: MosaicRenderableFile): unknown =>
    JSON.parse(JSON.stringify(painted(file)).split(DARK.tile).join(mixHex(NAVY, NAVY_SOFT, 0.28)).split(DARK.muted).join("#8A89A3"));

  it("defaults, a sparse front, another back with guides, a smaller canvas", async () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>, MosaicEngineContext]> = [
      [{}, { theme: "dark", back: "hello-world" }, ctxFor(NATURAL.W, NATURAL.H)],
      [{ role: "", email: "", handle: "" }, { theme: "dark", back: "hello-world", role: "", email: "", handle: "" }, ctxFor(NATURAL.W, NATURAL.H)],
      [{ back: "donut", guides: true, accent: "#22cc88" }, { theme: "dark", back: "template", backTemplate: "donut", guides: true, accent: "#22cc88" }, ctxFor(NATURAL.W, NATURAL.H)],
      [{ bleed: "none" }, { theme: "dark", back: "hello-world", bleed: "none" }, ctxFor(525, 300)],
    ];
    for (const [v2Props, v3Props, ctx] of cases) {
      const v2 = await BusinessCardV2.render({ ...BusinessCardV2.defaultProps, ...v2Props }, ctx);
      const v3 = await render(v3Props, ctx);
      expect(JSON.stringify(v3)).toContain(DARK.tile);
      expect(asV2(v3)).toEqual(painted(v2));
    }
  });
});

describe(`${ID} — print contrast (paper is not a backlit screen)`, () => {
  it("dark: the tiles clear the deepest black paper prints, by a gap you can see", () => {
    const P = cardPalette("dark", 0.5);
    // v2's tiles: L* 6.5 on 1.3 — both under paper's black floor, printed as one black.
    expect(lightness(mixHex(NAVY, NAVY_SOFT, 0.28))).toBeLessThan(10);
    expect(lightness(P.tile)).toBeGreaterThan(28);
    expect(lightness(P.tile) - lightness(P.page)).toBeGreaterThan(25);
  });

  it("dark: the lifted tiles stay the brand's blue — the navy's hue, with chroma — across the ladder", () => {
    // "The brand is blue on orange and tan on orange" (the founder). Lifting the navy's
    // old grey to print lightness read as slate (chroma 14), and print takes up to a
    // third of the chroma (uncoated): 30 in the file is what still reads blue on paper.
    const navy = chromaHue(NAVY);
    for (const t of [0.4, 0.5, 0.6]) {
      const tile = chromaHue(cardPalette("dark", t).tile);
      expect(Math.abs(tile.hue - navy.hue)).toBeLessThan(10);
      expect(tile.chroma).toBeGreaterThan(25);
    }
  });

  it("dark: every ink still reads on the lighter tiles (secondary grey at least 4:1)", () => {
    const P = cardPalette("dark", 0.5);
    expect(contrast(P.muted, P.tile)).toBeGreaterThanOrEqual(4);
    for (const ink of [P.name, P.mono, P.letters]) expect(contrast(ink, P.tile)).toBeGreaterThanOrEqual(7);
  });

  it("light: the banner's proven gap, about 9 L* under the ivory", () => {
    const P = cardPalette("light", 0.7);
    expect(lightness(P.page) - lightness(P.tile)).toBeGreaterThan(8);
  });

  it("dark defaults to the print field; an explicit opacity still wins", async () => {
    const { front } = faces(await render({ theme: "dark" }));
    expect(JSON.stringify(front)).toContain(cardPalette("dark", 0.5).tile);
    expect(JSON.stringify(faces(await render({ theme: "dark", fieldOpacity: 0.4 })).front)).toContain(cardPalette("dark", 0.4).tile);
  });
});

describe(`${ID} — the light theme`, () => {
  it("paints the solutions look: ivory page, warm tiles at 0.7, ink letters, the code on ivory", async () => {
    const { front, back } = faces(await render({}));
    expect(front.backgroundColor).toBe("#FAF7F2");
    expect(back.backgroundColor).toBe("#FAF7F2");
    expect(back.children?.qr?.backgroundColor).toBe("#FAF7F2");
    const P = cardPalette("light", 0.7);
    expect(P).toMatchObject({ page: "#FAF7F2", letters: "#14112A", name: "#14112A" });
    expect(JSON.stringify(front)).toContain(P.tile);
  });

  it("an explicit field opacity wins over the theme's", async () => {
    const { front } = faces(await render({ fieldOpacity: 0.3 }));
    expect(JSON.stringify(front)).toContain(cardPalette("light", 0.3).tile);
  });

  it("a template back renders on the light page too", async () => {
    const { back } = faces(await render({ back: "hello-world" }));
    expect(back.backgroundColor).toBe("#FAF7F2");
    expect(Object.keys(back.children ?? {}).sort()).toEqual(["poster", "qr"]);
  });
});

describe(`${ID} — the solutions back`, () => {
  it("is the big QR alone: to m0saic.io/solutions, printed as typed, no picture", async () => {
    const { back } = faces(await render({}));
    expect(Object.keys(back.children ?? {})).toEqual(["qr"]);
    expect(labels(back)).toEqual(expect.arrayContaining(["qr", "title", "url"]));
    expect(labels(back)).not.toContain("poster");
    expect(labels(back)).not.toContain("line");
    expect(JSON.stringify(back)).toContain("m0saic.io/solutions");
    expect(printedUrl("https://m0saic.io/solutions/")).toBe("m0saic.io/solutions");
  });

  it("a picture moves the code beside it; a last line prints under the link", async () => {
    const { back } = faces(await render({ backImage: ["/ads/window-card.png"], backLine: "Booth 1234" }));
    expect(Object.keys(back.children ?? {})).toEqual(["qr"]);
    expect(Object.values(back.assets ?? {})).toEqual([{ kind: "file", path: "/ads/window-card.png", mediaType: "image" }]);
    expect(labels(back)).toEqual(expect.arrayContaining(["poster", "qr", "title", "url", "line"]));
  });

  it("refuses an empty link with a readable card, and renders the same twice", async () => {
    const bad = (await render({ qrUrl: " " })) as MosaicDocument;
    expect(bad.kind).toBe("mosaic_document");
    expect(JSON.stringify(bad)).toMatch(/qrUrl/);
    expect(await render({})).toEqual(await render({}));
    expect(rectInside(NATURAL.safe, NATURAL.trim)).toBe(true);
  });
});

describe(`${ID} — prop bindings (Make canvas handles)`, () => {
  it("solutions back: the code carries the link, the mode and the picture to add; the title the line to add", async () => {
    const { back } = faces(await render({}));
    expect(keysOn(back, "qr")).toEqual(["qrUrl", "back", "backImage"]);
    expect(keysOn(back, "title")).toEqual(["backTitle", "backLine"]);
    expect(keysOn(back, "url")).toEqual(["qrUrl"]);
    const r = resolvePropBindings(back, NATURAL.W, NATURAL.H, { propsSchema: BusinessCardV3.propsSchema });
    expect(r.rejected).toEqual([]);
    for (const key of ["qrUrl", "back", "backImage", "backTitle", "backLine"]) expect(r.byProp[key]?.length).toBeGreaterThan(0);
  });

  it("with a picture and a line, each is its own handle", async () => {
    const { back } = faces(await render({ backImage: ["/ads/window-card.png"], backLine: "Booth 1234" }));
    expect(keysOn(back, "poster")).toEqual(["backImage"]);
    expect(keysOn(back, "qr")).toEqual(["qrUrl", "back"]);
    expect(keysOn(back, "title")).toEqual(["backTitle"]);
    expect(keysOn(back, "line")).toEqual(["backLine"]);
    const r = resolvePropBindings(back, NATURAL.W, NATURAL.H, { propsSchema: BusinessCardV3.propsSchema });
    expect(r.rejected).toEqual([]);
  });

  it("a template back: the picture offers the back (and which template)", async () => {
    expect(keysOn(faces(await render({ back: "hello-world" })).back, "poster")).toEqual(["back"]);
    const { back } = faces(await render({ back: "template", backTemplate: "donut" }));
    expect(keysOn(back, "poster")).toEqual(["back", "backTemplate"]);
    const r = resolvePropBindings(back, NATURAL.W, NATURAL.H, { propsSchema: BusinessCardV3.propsSchema });
    expect(r.rejected).toEqual([]);
  });

  it("the front is v2's: every contact line bound, empty ones ride the name", async () => {
    const { front } = faces(await render({ role: "", email: "" }));
    expect(keysOn(front, "name")).toEqual(["name", "role", "email"]);
    const r = resolvePropBindings(front, NATURAL.W, NATURAL.H, { propsSchema: BusinessCardV3.propsSchema });
    expect(r.rejected).toEqual([]);
  });

  it("declares the two props no rect shows: the print resolution and the field's tint", () => {
    expect(BusinessCardV3.bindings?.unbound).toEqual({ dpi: "print resolution", fieldOpacity: "texture" });
  });
});
