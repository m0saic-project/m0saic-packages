/**
 * @m0saic/brand/business-card/v1 — template gate.
 *
 * Locks: the still-pipeline contract (two PNG steps, front + back, each at
 * the print canvas), the prop-driven canvas (`resolveOutputHints` agrees with
 * the static hints at defaults), every catalog back rendering live with a QR
 * child, determinism, the editor bindings, and node-cleanliness (the card
 * ships in the web build).
 */
import * as fs from "fs";
import * as path from "path";
import type { MosaicColor, MosaicDocument, MosaicDocumentPipeline, MosaicEngineContext, MosaicRenderableFile } from "@m0saic/types";
import { parseM0StringComplete, validateM0String } from "@m0saic/dsl";
import { assertLayout, resolvePropBindings } from "@m0saic/template-utils";
import "../../../index"; // registers every back the catalog nests
import { BACK_KEYS } from "./back-catalog";
import { BusinessCard, businessCardConstraints, pickQrVersion } from "./business-card";
import { cardCanvas, effectiveDpi, pickBleed, type Bleed } from "./layout";

const ID = "@m0saic/brand/business-card/v1";
const NATURAL = cardCanvas("moo", 300);

const ctxFor = (w: number, h: number): MosaicEngineContext => {
  const t = { width: w, height: h, fps: 30, durationMs: 1000 };
  return { mode: "render", target: t, output: { ...t, workspaceDir: "/tmp/business-card-test" }, media: {} } as unknown as MosaicEngineContext;
};

const isErrorMosaic = (doc: MosaicDocument): boolean =>
  (doc.sources?.[0] as { engine?: { renderStatus?: string } } | undefined)?.engine?.renderStatus === "error";

const labelsOf = (doc: MosaicDocument): string[] =>
  doc.sources.map((s) => (s as { editor?: { label?: string } }).editor?.label).filter((l): l is string => !!l);

const render = async (props: Record<string, unknown>, ctx = ctxFor(NATURAL.W, NATURAL.H)): Promise<MosaicRenderableFile> =>
  BusinessCard.render({ ...BusinessCard.defaultProps, ...props }, ctx);

const faces = (file: MosaicRenderableFile): { front: MosaicDocument; back: MosaicDocument } => {
  expect(file.kind).toBe("mosaic_pipeline");
  const p = file as MosaicDocumentPipeline;
  expect(p.emit).toBe("multi");
  expect(p.steps.map((s) => s.name)).toEqual(["front", "back"]);
  return { front: p.steps[0].file as MosaicDocument, back: p.steps[1].file as MosaicDocument };
};

const expectValidStill = (doc: MosaicDocument, W: number, H: number) => {
  expect(doc.kind).toBe("mosaic_document");
  expect(isErrorMosaic(doc)).toBe(false);
  expect(doc.size).toEqual({ width: W, height: H });
  expect(doc.format).toEqual({ kind: "image", container: "png" });
  expect(validateM0String(String(doc.m0)).ok).toBe(true);
  const parsed = parseM0StringComplete(String(doc.m0), W, H);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe(doc.sources.length);
};

describe(`${ID} — template shell`, () => {
  it("metadata: id, core tier, PNG still hints at MOO's exact bleed box (1098 x 648), resolver agrees at defaults", () => {
    expect(String(BusinessCard.id)).toBe(ID);
    expect(BusinessCard.version).toBe(1);
    expect(BusinessCard.capabilities).toEqual({ tier: "core" });
    expect(BusinessCard.outputHints?.format).toEqual({ kind: "image", container: "png" });
    expect([BusinessCard.outputHints?.width, BusinessCard.outputHints?.height]).toEqual([1098, 648]);
    expect([NATURAL.W, NATURAL.H]).toEqual([1098, 648]);
    expect(BusinessCard.resolveOutputHints!(BusinessCard.defaultProps!)).toEqual({ width: NATURAL.W, height: NATURAL.H });
    expect(BusinessCard.defaultProps?.back).toBe("hello-world");
    expect(BusinessCard.defaultProps?.bleed).toBe("moo");
  });

  it("defaults render two valid PNG steps (front, back), both at the print canvas; the back nests the poster + QR", async () => {
    const { front, back } = faces(await render({}));
    expectValidStill(front, NATURAL.W, NATURAL.H);
    expectValidStill(back, NATURAL.W, NATURAL.H);
    const fl = labelsOf(front);
    for (const l of ["field", "mark", "wordmark", "wordmark-zero", "name", "role", "email", "site", "handle"]) expect(fl).toContain(l);
    expect(fl).not.toContain("guide-trim");
    const bl = labelsOf(back);
    for (const l of ["poster-frame", "poster", "qr", "title", "url", "command"]) expect(bl).toContain(l);
    expect(Object.keys(back.children ?? {}).sort()).toEqual(["poster", "qr"]);
    const poster = back.children!.poster as MosaicDocument;
    expect(poster.sources.length).toBeGreaterThan(0);
    const qr = back.children!.qr as MosaicDocument;
    expect(qr.size!.width).toBe(qr.size!.height);
    expect(validateM0String(String(qr.m0)).ok).toBe(true);
    expect(Object.keys(front.assets ?? {})).toHaveLength(0);
  });

  it("determinism: double render is JSON-identical", async () => {
    const a = await render({});
    const b = await render({});
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it.each([
    ["none", 300, 1050, 600],
    ["sixteenth", 300, 1092, 642],
    ["eighth", 300, 1130, 678],
    ["eighth", 150, 560, 336],
  ] as const)("bleed %s @%i dpi → both faces at %ix%i, resolver agrees", async (bleed, dpi, W, H) => {
    expect(BusinessCard.resolveOutputHints!({ ...BusinessCard.defaultProps, bleed, dpi })).toEqual({ width: W, height: H });
    const { front, back } = faces(await render({ bleed, dpi }, ctxFor(W, H)));
    expectValidStill(front, W, H);
    expectValidStill(back, W, H);
  });

  it("a foreign canvas scales the card uniformly (aspect kept, fits inside)", async () => {
    const { front } = faces(await render({}, ctxFor(1920, 1080)));
    expect(front.size!.width).toBeLessThanOrEqual(1920);
    expect(front.size!.height).toBeLessThanOrEqual(1080);
    expect(Math.abs(front.size!.width / front.size!.height - NATURAL.W / NATURAL.H)).toBeLessThan(0.02);
    expect(front.size!.width).toBeGreaterThan(NATURAL.W);
  });

  it("guides add the eight trim + safe strokes on both faces; off by default", async () => {
    const { front, back } = faces(await render({ guides: true }));
    for (const doc of [front, back]) {
      const l = labelsOf(doc);
      expect(l.filter((x) => x === "guide-trim")).toHaveLength(4);
      expect(l.filter((x) => x === "guide-safe")).toHaveLength(4);
    }
  });

  it("empty role / handle drop their lines", async () => {
    const { front } = faces(await render({ role: "", handle: "" }));
    const l = labelsOf(front);
    expect(l).not.toContain("role");
    expect(l).not.toContain("handle");
    expect(l).toContain("email");
  });

  it("an unknown back / bleed falls back to the defaults instead of failing", async () => {
    const { back } = faces(await render({ back: "no-such-template", bleed: "lots" }));
    expectValidStill(back, NATURAL.W, NATURAL.H);
    expect(labelsOf(back)).toContain("poster");
  });
});

describe(`${ID} — QR version probe`, () => {
  it("picks the smallest carve-safe version: v6 for a short id, v7 for the longest catalog id", () => {
    expect(pickQrVersion("https://app.m0saic.io/make?t=@m0saic/charts/donut/v4", "#050314" as MosaicColor)).toBe(6);
    expect(pickQrVersion("https://app.m0saic.io/make?t=@m0saic/alpine/contributor-table/v1", "#050314" as MosaicColor)).toBe(7);
  });

  it.each(BACK_KEYS)("back=%s nests a real QR (no error card) with the M carved and the orange mark on top", async (back) => {
    const { back: doc } = faces(await render({ back }));
    const qr = doc.children!.qr as MosaicDocument;
    expect(isErrorMosaic(qr)).toBe(false);
    expect(qr.sources.length).toBeGreaterThan(50);
    expect(labelsOf(qr)).toContain("qr-mark");
    expect(qr.size!.width).toBe(qr.size!.height);
    // No grandchildren: the carve holds one masked tile, so the back flattens at card scale.
    expect(qr.children).toBeUndefined();
  });
});

describe(`${ID} — every catalog back renders live`, () => {
  it.each(BACK_KEYS)("back=%s → a non-empty poster child, a QR, no error mosaic", async (back) => {
    const { back: doc } = faces(await render({ back }));
    expectValidStill(doc, NATURAL.W, NATURAL.H);
    const poster = doc.children!.poster as MosaicDocument;
    expect(poster.kind).toBe("mosaic_document");
    expect(poster.sources.length).toBeGreaterThan(0);
    expect(isErrorMosaic(poster)).toBe(false);
    expect(poster.size!.width).toBeGreaterThan(0);
    expect(doc.children!.qr).toBeDefined();
  });
});

describe(`${ID} — editor bindings`, () => {
  const schema = BusinessCard.propsSchema!;

  it("binds name / role / email / site / handle to their text rects and accent to the M + zero; nothing rejected", async () => {
    const { front } = faces(await render({}));
    const r = resolvePropBindings(front, NATURAL.W, NATURAL.H, { propsSchema: schema });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["accent", "email", "handle", "name", "role", "site"]);
    for (const key of ["name", "role", "email", "site", "handle"] as const) {
      expect(r.byProp[key]).toHaveLength(1);
      const b = r.byProp[key][0];
      expect(labelsOf(front)[b.sourceIndex]).toBe(key);
    }
    expect(r.byProp.accent).toHaveLength(2);
  });

  it("the back's only binding is the accent on the QR's carved M (inside the qr child); the picker is a closed set", async () => {
    const { back } = faces(await render({}));
    const r = resolvePropBindings(back, NATURAL.W, NATURAL.H, { propsSchema: schema });
    // A nested template's own bindings (hello-world's greeting…) are unknown to
    // THIS schema by construction; only the card's root rects must be sound.
    expect(r.rejected.filter((b) => b.childPath.length === 0)).toEqual([]);
    expect(Object.keys(r.byProp)).toEqual(["accent"]);
    // The carved M binds the accent through the qr child (the hello-world
    // poster's own accent rects share the key and ride along).
    expect(r.byProp.accent.some((b) => b.childPath.length === 1 && b.childPath[0] === "qr")).toBe(true);
    const qr = back.children!.qr as MosaicDocument;
    expect(labelsOf(qr)).toContain("qr-mark");
  });
});

describe(`${ID} — ships in the web build`, () => {
  it("imports no node builtins and reads no files", () => {
    for (const f of ["business-card.ts", "back-catalog.ts", "layout.ts", "index.ts"]) {
      const src = fs.readFileSync(path.join(__dirname, f), "utf8");
      expect(src).not.toMatch(/from\s+["'](node:|fs["']|path["']|child_process|os["'])/);
      expect(src).not.toMatch(/__dirname/);
    }
  });
});

describe(`${ID} — layout contract (canvas sweep)`, () => {
  // Natural press canvases, a proof, a 600-DPI master, and three foreign
  // canvases Make would hand over (the card scales uniformly into them).
  const CANVASES: ReadonlyArray<readonly [number, number, Bleed]> = [
    [1098, 648, "moo"],
    [1130, 678, "eighth"],
    [1050, 600, "none"],
    [1092, 642, "sixteenth"],
    [560, 336, "eighth"],
    [2250, 1350, "eighth"],
    [1920, 1080, "eighth"],
    [1024, 1024, "eighth"],
    [1280, 720, "eighth"],
  ];
  const canvasFor = (w: number, h: number, bleed: Bleed) => cardCanvas(pickBleed(bleed), effectiveDpi(pickBleed(bleed), 300, { width: w, height: h }));

  it.each(CANVASES)("defaults hold at %d×%d (%s bleed): marks keep aspect, glyphs inside safe, poster keeps its template's aspect", async (w, h, bleed) => {
    const { front, back } = faces(await render({ bleed }, ctxFor(w, h)));
    const c = canvasFor(w, h, bleed);
    expect(front.size).toEqual({ width: c.W, height: c.H });
    const ctx = ctxFor(c.W, c.H);
    const frontLabels = labelsOf(front);
    expect(() =>
      assertLayout(front, ctx, ID, { constraints: businessCardConstraints("front", c, { labels: frontLabels }) }),
    ).not.toThrow();
    const poster = back.children!.poster as MosaicDocument;
    const posterAspect = poster.size!.width / poster.size!.height;
    expect(() =>
      assertLayout(back, ctx, ID, { constraints: businessCardConstraints("back", c, { labels: labelsOf(back), posterAspect }), flatten: false }),
    ).not.toThrow();
  });

  it.each(BACK_KEYS)("back=%s keeps the nested template's own aspect on the poster cell", async (back) => {
    const { back: doc } = faces(await render({ back }));
    const poster = doc.children!.poster as MosaicDocument;
    const posterAspect = poster.size!.width / poster.size!.height;
    expect(() =>
      assertLayout(doc, ctxFor(NATURAL.W, NATURAL.H), ID, { constraints: businessCardConstraints("back", NATURAL, { labels: labelsOf(doc), posterAspect }), flatten: false }),
    ).not.toThrow();
  });

  it("a wrong poster aspect IS a violation (the contract has teeth)", async () => {
    const { back } = faces(await render({ back: "donut" }));
    expect(() =>
      assertLayout(back, ctxFor(NATURAL.W, NATURAL.H), ID, { constraints: businessCardConstraints("back", NATURAL, { labels: labelsOf(back), posterAspect: 16 / 9 }), flatten: false }),
    ).toThrow(/aspect/);
  });

  it("debugLayout stamps a passing contract on both faces", async () => {
    const { front, back } = faces(await render({ debugLayout: true }));
    for (const doc of [front, back]) {
      const stamp = (doc.editor as { layoutContract?: { ok: boolean; violations: unknown[] } } | undefined)?.layoutContract;
      expect(stamp?.ok).toBe(true);
      expect(stamp?.violations).toEqual([]);
    }
  });
});
