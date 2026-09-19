/**
 * @m0saic/hello-world/v1 — gate test.
 *
 * Locks the things the sprint plan makes load-bearing for the headline
 * command: zero inputs render, determinism, the defaults contract, the
 * layout contract at the 7-canvas set (text fits, marks keep their aspect),
 * the Home-field maths (cover-fit, portrait transpose, wipe), the M assembly
 * track, and node-cleanliness (the template ships in the web build).
 */
import * as fs from "fs";
import * as path from "path";
import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { parseM0StringComplete, validateM0String } from "@m0saic/dsl";
import { assertLayout, auditDefaultProps, resolvePropBindings } from "@m0saic/template-utils";
import {
  ASSEMBLE_BOXES_PER_TRACK,
  HELLO_MARK_REVEALS,
  HELLO_SWEEPS,
  HelloWorld,
  NAVY,
  NAVY_SOFT,
  buildHelloGeometry,
  coverFitField,
  fieldWipe,
  helloLayoutConstraints,
  helloTimeline,
  inverseSmoothstep,
  isPortraitField,
  markAssembly,
  markRectsIn,
  mixHex,
  sweepStripPx,
} from "./hello-world";
import {
  FIELD_NATIVE_H,
  FIELD_NATIVE_W,
  FIELD_RECTS,
  M_RECTS,
  WORDMARK_BOUNDS,
  WORDMARK_LETTER_PATHS,
  WORDMARK_ZERO_PATHS,
} from "@m0saic/template-utils";

const ID = "@m0saic/hello-world/v1";
const HINT_MS = 2600;

const ctxFor = (w: number, h: number, durationMs = HINT_MS, fps = 30): MosaicEngineContext => {
  const t = { width: w, height: h, fps, durationMs };
  return { mode: "render", target: t, output: { ...t, workspaceDir: "/tmp/hello-world-test" }, media: {} } as unknown as MosaicEngineContext;
};

/** The layout-contract sweep set (standalone-pack-authoring §0). */
const CANVASES: ReadonlyArray<readonly [number, number]> = [
  [1920, 1080],
  [1280, 720],
  [1080, 1920],
  [1080, 1080],
  [3840, 2160],
  [640, 360],
  [480, 270],
];

type AnySource = MosaicSource & { editor?: { label?: string }; overlay?: unknown; lavfi?: string; mask?: { localPath?: string } };

type Kids = { field: MosaicDocument; card: MosaicDocument };
const kids = (doc: MosaicDocument): Kids => (doc as unknown as { children: Kids }).children;
/** Root + both children, in paint order (field child, then card child). */
const sourcesOf = (doc: MosaicDocument): AnySource[] => [
  ...(doc.sources as AnySource[]),
  ...(kids(doc)?.field?.sources as AnySource[] ?? []),
  ...(kids(doc)?.card?.sources as AnySource[] ?? []),
];
const labelsOf = (doc: MosaicDocument): string[] => sourcesOf(doc).map((s) => s.editor?.label ?? "");
const byLabel = (doc: MosaicDocument, label: string): AnySource[] => sourcesOf(doc).filter((s) => s.editor?.label === label);
const framesMatchSources = (doc: MosaicDocument, w: number, h: number): void => {
  expect(validateM0String(String(doc.m0)).ok).toBe(true);
  const parsed = parseM0StringComplete(String(doc.m0), w, h);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe(doc.sources.length);
};
const isErrorMosaic = (doc: MosaicDocument): boolean =>
  (doc.sources?.[0] as { engine?: { renderStatus?: string } } | undefined)?.engine?.renderStatus === "error";

const render = async (props: Record<string, unknown>, ctx = ctxFor(1024, 1024)): Promise<MosaicDocument> =>
  (await HelloWorld.render({ ...HelloWorld.defaultProps, ...props }, ctx)) as MosaicDocument;

describe(`${ID} — template shell`, () => {
  it("metadata: id, core tier, wide 1920×1080 hint, 2.6s @ 30fps, no required props", () => {
    expect(String(HelloWorld.id)).toBe(ID);
    expect(HelloWorld.version).toBe(1);
    expect(HelloWorld.capabilities).toEqual({ tier: "core" });
    // 16:9 by default (2026-09-14) — the site hero's ratio; square stays a knob away.
    expect(HelloWorld.outputHints).toMatchObject({ width: 1920, height: 1080, fps: 30, durationMs: HINT_MS });
    expect(HelloWorld.aspectRatio).toMatchObject({ ideal: 16 / 9, mode: "warn" });
    // The format hint: "video" is the template's own default, not an explicit
    // ask — so a share link / render command at the defaults carries no format.
    expect(HelloWorld.outputHints?.format).toEqual({ kind: "video", container: "mp4" });
    const required = Object.entries(HelloWorld.propsSchema ?? {}).filter(([, d]) => (d as { required?: boolean }).required);
    expect(required).toEqual([]);
  });

  it("defaults are the contract: every optional knob shows its value", () => {
    expect(auditDefaultProps(HelloWorld)).toEqual([]);
    expect(HelloWorld.defaultProps).toMatchObject({ greeting: "Hello, world.", sweep: "left", markReveal: "assemble", animate: true });
  });

  it("renders standalone at its hint: two named children, frames == sources per document, the Home card stack, no assets", async () => {
    const doc = await render({});
    expect(isErrorMosaic(doc)).toBe(false);
    // Root: the two named parents Make's structure tree shows.
    expect((doc.sources as AnySource[]).map((s) => [(s as { type: string }).type, (s as { ref?: string }).ref, s.editor?.label])).toEqual([
      ["mosaic", "field", "field"],
      ["mosaic", "card", "card"],
    ]);
    framesMatchSources(doc, 1024, 1024);
    const k = kids(doc);
    expect(k.field.size).toEqual({ width: 1024, height: 1024 });
    framesMatchSources(k.field, 1024, 1024);
    framesMatchSources(k.card, k.card.size!.width, k.card.size!.height);
    // The card child's frame is lattice-snapped OUTWARD around the card, so the parent places it exactly (no inset).
    const g = buildHelloGeometry({ W: 1024, H: 1024, greeting: "Hello, world.", caption: "" });
    expect(k.card.size!.width).toBeGreaterThanOrEqual(g.card.w);
    expect(k.card.size!.height).toBeGreaterThanOrEqual(g.card.h);
    // The parent goes through inset recovery (2026-09-13): the full-canvas
    // field is lattice-aligned and carries no inset; the card lands in a coarse
    // cell and its inset paints it back on the exact rect — which is also the
    // child's declared size, so it is never rescaled.
    const parentByRef = Object.fromEntries(
      (doc.sources as Array<{ ref?: string; placement?: { inset?: { top: number; right: number; bottom: number; left: number } } }>).map((src) => [src.ref, src]),
    );
    expect(parentByRef.field?.placement?.inset).toBeUndefined();
    const cardInset = parentByRef.card?.placement?.inset;
    expect(cardInset).toBeDefined();
    for (const side of ["top", "right", "bottom", "left"] as const) {
      expect(cardInset![side]).toBeGreaterThanOrEqual(0);
      expect(cardInset![side]).toBeLessThan(0.5);
    }
    const labels = labelsOf(doc);
    expect(byLabel(doc, "field").length).toBeGreaterThan(30);
    expect(byLabel(doc, "field-wipe")).toHaveLength(1);
    expect(byLabel(doc, "mark-rects")).toHaveLength(1);
    for (const l of ["card", "mark", "wordmark", "wordmark-zero", "greeting"]) expect(byLabel(doc, l)).toHaveLength(1);
    expect(labels).not.toContain("caption");
    // Paint order: root = field child, then card child; field child = tiles then the
    // wipe; card child = the M rects track, then the silhouette / wordmark / text.
    expect(labels.indexOf("card")).toBeGreaterThan(labels.indexOf("field"));
    expect(labels.indexOf("field-wipe")).toBeGreaterThan(labels.lastIndexOf("field"));
    expect(labels.indexOf("mark-rects")).toBeGreaterThan(labels.indexOf("field-wipe"));
    expect(labels.indexOf("mark")).toBeGreaterThan(labels.indexOf("mark-rects"));
    // The card's surface is the child's own background; its rounding, hairline and
    // rise ride the parent's `card` source (so the child never needs alpha).
    const cardRef = (doc.sources as AnySource[])[1] as AnySource & { effects?: { rounding?: unknown; stroke?: unknown } };
    expect(cardRef.effects?.rounding).toBeDefined();
    expect(cardRef.effects?.stroke).toBeDefined();
    expect(k.card.backgroundColor).toBe(NAVY);
    // Children carry no assets either.
    expect(Object.keys(k.field.assets ?? {}).length + Object.keys(k.card.assets ?? {}).length).toBe(0);
    expect(doc.backgroundColor).toBe(NAVY);
    expect(doc.fps).toBe(30);
    expect(doc.durationMs).toBe(HINT_MS);
    expect(Object.keys(doc.assets ?? {}).length).toBe(0);
  });

  it("determinism: two renders are JSON-identical", async () => {
    const a = await render({});
    const b = await render({});
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("animate:false renders the poster: no overlay expressions, no tracks", async () => {
    const doc = await render({ animate: false });
    expect(byLabel(doc, "field-wipe")).toHaveLength(0);
    expect(byLabel(doc, "mark-rects")).toHaveLength(0);
    expect(sourcesOf(doc).some((s) => s.overlay != null)).toBe(false);
  });

  it("markReveal:fade has no assembly track and rises the silhouette in", async () => {
    const doc = await render({ markReveal: "fade" });
    expect(byLabel(doc, "mark-rects")).toHaveLength(0);
    const o = byLabel(doc, "mark")[0].overlay as { yExpr?: string; alpha?: string };
    expect(o.yExpr).toBeDefined();
    expect(o.alpha).toBeDefined();
  });

  it("animated sources carry a window and scale with the clip duration", async () => {
    const short = await render({}, ctxFor(1024, 1024, HINT_MS));
    const long = await render({}, ctxFor(1024, 1024, HINT_MS * 2));
    const cardOverlay = (doc: MosaicDocument) => byLabel(doc, "card")[0].overlay as { startAtSec: number; window: { startSec: number } };
    const tlShort = helloTimeline(HINT_MS / 1000, "assemble");
    const tlLong = helloTimeline((HINT_MS * 2) / 1000, "assemble");
    expect(cardOverlay(short).window.startSec).toBeCloseTo(tlShort.card, 3);
    expect(cardOverlay(long).window.startSec).toBeCloseTo(tlLong.card, 3);
    expect(cardOverlay(short).startAtSec).toBe(cardOverlay(short).window.startSec);
    // The silhouette fades in place over the assembled rects (no y offset — it must stay registered).
    const mark = byLabel(short, "mark")[0].overlay as { yExpr?: string; alpha?: string; window: { startSec: number } };
    expect(mark.yExpr).toBeUndefined();
    expect(mark.window.startSec).toBeCloseTo(tlShort.mark, 3);
  });

  it("the V-legs RESOLVE as a fade that starts while the last rects are still landing — deliberate, not a bug", () => {
    // Founder verdict 2026-09-16: a 2-frame "snap" the instant the assembly
    // ended was rendered side by side and REJECTED; the overlapping ~8-frame
    // fade is the canonical reveal. Locked so it is not "fixed" again.
    const tl = helloTimeline(HINT_MS / 1000, "assemble");
    const assembleEnd = tl.assembleStart + tl.assembleDur;
    expect(tl.mark).toBeLessThan(assembleEnd); // overlaps the eased tail
    expect(tl.mark + tl.markDur).toBeGreaterThan(assembleEnd); // and outlasts it
    expect(tl.markDur * 30).toBeGreaterThanOrEqual(6); // a fade, not a click
  });

  it("bindings: greeting / caption / accent bind their rects; nothing rejected", async () => {
    const doc = await render({ caption: "npx m0saic hello-world" });
    expect(byLabel(doc, "caption")).toHaveLength(1);
    const r = resolvePropBindings(doc, 1024, 1024, { propsSchema: HelloWorld.propsSchema });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp).sort()).toEqual(["accent", "caption", "greeting"]);
    expect(r.byProp.accent.length).toBe(2); // the M and the wordmark's 0
    // They live in the card child (Make edits them through the child path).
    for (const b of r.byProp.greeting) expect(b.childPath).toEqual(["card"]);
  });

  it("the brand marks are the official paths, painted in the accent", async () => {
    const doc = await render({ accent: "#123456" });
    expect(byLabel(doc, "mark")[0].mask?.localPath).toContain("M19.7296 0.010376");
    expect(byLabel(doc, "wordmark-zero")[0].mask?.localPath).toBe(WORDMARK_ZERO_PATHS.join(" "));
    expect(byLabel(doc, "wordmark")[0].mask?.localPath).toBe(WORDMARK_LETTER_PATHS.join(" "));
    expect((byLabel(doc, "mark")[0] as { color?: string }).color).toBe("#123456");
    // The assembled rects end on the same accent.
    expect(byLabel(doc, "mark-rects")[0].lavfi).toContain("color=#123456");
    // A cleared colour picker falls back to the brand orange.
    const fallback = await render({ accent: "" });
    expect((byLabel(fallback, "mark")[0] as { color?: string }).color).toBe("#EF7525");
  });

  it("the greeting is an svg-rasterized JetBrains Mono line the layout contract can measure", async () => {
    const doc = await render({});
    const g = byLabel(doc, "greeting")[0] as { rasterizer?: string; layers?: Array<{ style?: { fontFamily?: string; fontSize?: number } }> };
    expect(g.rasterizer).toBe("svg");
    expect(g.layers?.[0].style?.fontFamily).toBe("JetBrains Mono");
    expect(g.layers?.[0].style?.fontSize).toBeGreaterThan(20);
  });
});

describe(`${ID} — layout contract (7-canvas sweep)`, () => {
  it.each(CANVASES)("defaults hold at %d×%d", async (w, h) => {
    const ctx = ctxFor(w, h);
    const doc = await render({}, ctx);
    expect(isErrorMosaic(doc)).toBe(false);
    expect(() => assertLayout(doc, ctx, ID, { constraints: helloLayoutConstraints(false) })).not.toThrow();
  });

  it.each(CANVASES)("a long greeting + caption still fit at %d×%d (shrink, then ellipsis)", async (w, h) => {
    const ctx = ctxFor(w, h);
    const doc = await render(
      { greeting: "Hello, world — from a very long greeting that cannot possibly fit on one card line.", caption: "https://m0saic.io/hello" },
      ctx,
    );
    expect(isErrorMosaic(doc)).toBe(false);
    expect(() => assertLayout(doc, ctx, ID, { constraints: helloLayoutConstraints(true) })).not.toThrow();
  });

  it("debugLayout renders the contract without tripping it at the hint canvas", async () => {
    const doc = await render({ debugLayout: true });
    expect(isErrorMosaic(doc)).toBe(false);
    expect((doc as { editor?: { layoutContract?: { ok?: boolean } } }).editor?.layoutContract?.ok).toBe(true);
  });
});

describe(`${ID} — geometry`, () => {
  it("the card is centred and its stack reads M → wordmark → greeting, all inside the card", () => {
    const g = buildHelloGeometry({ W: 1024, H: 1024, greeting: "Hello, world.", caption: "" });
    expect(Math.abs(g.card.x + g.card.w / 2 - 512)).toBeLessThanOrEqual(1);
    expect(Math.abs(g.card.y + g.card.h / 2 - 512)).toBeLessThanOrEqual(1);
    expect(g.mark.w).toBe(g.mark.h);
    // Mask bounds scale per axis: the cell aspect must match the wordmark's to well under 1%.
    const wmAspect = WORDMARK_BOUNDS.width / WORDMARK_BOUNDS.height;
    expect(Math.abs(g.wordmark.w / g.wordmark.h / wmAspect - 1)).toBeLessThan(0.006);
    expect(g.mark.y).toBeLessThan(g.wordmark.y);
    expect(g.wordmark.y + g.wordmark.h).toBeLessThanOrEqual(g.greeting.rect.y);
    for (const r of [g.mark, g.wordmark, g.greeting.rect]) {
      expect(r.x).toBeGreaterThanOrEqual(g.card.x);
      expect(r.y).toBeGreaterThanOrEqual(g.card.y);
      expect(r.x + r.w).toBeLessThanOrEqual(g.card.x + g.card.w);
      expect(r.y + r.h).toBeLessThanOrEqual(g.card.y + g.card.h);
    }
    expect(g.caption).toBeNull();
    // The field is complete under the card too — no hole while the card fades in.
    expect(g.fieldTransposed).toBe(false);
    expect(g.field).toEqual(coverFitField(1024, 1024));
  });

  it("cover-fit reproduces the Home field: identity at the native canvas, clipped + inside everywhere else", () => {
    const native = coverFitField(FIELD_NATIVE_W, FIELD_NATIVE_H);
    expect(native.map((r) => [r.x, r.y, r.w, r.h])).toEqual(FIELD_RECTS.map((r) => [...r]));
    for (const [w, h] of [...CANVASES, [1024, 1024] as const]) {
      const rects = coverFitField(w, h, isPortraitField(w, h));
      expect(rects.length).toBeGreaterThan(10);
      for (const r of rects) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(w);
        expect(r.y + r.h).toBeLessThanOrEqual(h);
        expect(r.w).toBeGreaterThanOrEqual(4);
        expect(r.h).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("portrait canvases transpose the field (rows become columns) — topology follows the canvas", () => {
    expect(isPortraitField(1080, 1920)).toBe(true);
    expect(isPortraitField(1920, 1080)).toBe(false);
    expect(isPortraitField(1080, 1080)).toBe(false);
    const portrait = buildHelloGeometry({ W: 1080, H: 1920, greeting: "Hi", caption: "" });
    expect(portrait.fieldTransposed).toBe(true);
    // Transposed identity: the native layout on its side.
    const t = coverFitField(FIELD_NATIVE_H, FIELD_NATIVE_W, true);
    expect(t.map((r) => [r.x, r.y, r.w, r.h])).toEqual(FIELD_RECTS.map(([x, y, w, h]) => [y, x, h, w]));
    // A portrait canvas keeps far more of the pattern than the cropped native layout would.
    expect(coverFitField(1080, 1920, true).length).toBeGreaterThan(coverFitField(1080, 1920, false).length * 1.5);
  });

  it("the wipe is one drawbox track whose strips reveal in sweep order, under the box budget", () => {
    for (const sweep of HELLO_SWEEPS) {
      const src = fieldWipe(1024, 1024, sweep, 0, 1.08) as { lavfi?: string; overlay?: { window?: { endSec?: number } } } | null;
      expect(src).not.toBeNull();
      const ops = src!.lavfi!.split(",drawbox=").slice(1);
      expect(ops.length).toBe(Math.ceil(1024 / sweepStripPx(1024)));
      expect(ops.length).toBeLessThanOrEqual(500);
      expect(src!.lavfi).toContain("replace=1");
      const times = ops.map((o) => Number(/lt\(t\\,([0-9.]+)\)/.exec(o)![1]));
      const along = sweep === "left" || sweep === "right" ? ops.map((o) => Number(/x=(\d+)/.exec(o)![1])) : ops.map((o) => Number(/y=(\d+)/.exec(o)![1]));
      for (let i = 1; i < ops.length; i++) {
        expect(along[i]).toBeGreaterThan(along[i - 1]);
        if (sweep === "left" || sweep === "top") expect(times[i]).toBeGreaterThan(times[i - 1]);
        else expect(times[i]).toBeLessThan(times[i - 1]);
      }
      expect(src!.overlay?.window?.endSec).toBeCloseTo(1.08, 2);
    }
    // 4K stays under budget too.
    expect(Math.ceil(3840 / sweepStripPx(3840))).toBeLessThanOrEqual(500);
  });

  it("the M assembles as ONE drawbox track at the hint: 26 rects × frames, landing exactly on the mark's rects in the accent", () => {
    const g = buildHelloGeometry({ W: 1024, H: 1024, greeting: "Hello, world.", caption: "" });
    const tl = helloTimeline(HINT_MS / 1000, "assemble");
    const asm = markAssembly({
      W: 1024, H: 1024, S: g.S, mark: g.mark, startSec: tl.assembleStart, durSec: tl.assembleDur, fps: 30,
      fromColor: mixHex(NAVY, NAVY_SOFT, 0.55), toColor: "#EF7525" as never,
    });
    expect(asm.frames).toBe(Math.round(tl.assembleDur * 30));
    expect(asm.boxes.length).toBe(M_RECTS.length * asm.frames);
    expect(asm.boxes.length).toBeLessThanOrEqual(ASSEMBLE_BOXES_PER_TRACK);
    const finals = markRectsIn(g.mark);
    expect(finals).toHaveLength(26);
    // Every final rect sits inside the mark cell.
    for (const f of finals) {
      expect(f.x).toBeGreaterThanOrEqual(g.mark.x);
      expect(f.y).toBeGreaterThanOrEqual(g.mark.y);
      expect(f.x + f.w).toBeLessThanOrEqual(g.mark.x + g.mark.w + 1);
      expect(f.y + f.h).toBeLessThanOrEqual(g.mark.y + g.mark.h + 1);
    }
    // The last box of each rect persists (no toSec), lands on its final rect, in the accent.
    const lasts = asm.boxes.filter((b) => b.toSec == null);
    expect(lasts).toHaveLength(26);
    lasts.forEach((b, i) => {
      expect([b.x, b.y, b.w, b.h]).toEqual([finals[i].x, finals[i].y, finals[i].w, finals[i].h]);
      expect(b.color).toBe("#EF7525");
      expect(b.fromSec).toBeCloseTo(tl.assembleStart + (asm.frames - 1) / 30, 3);
    });
    // The first box of each rect starts displaced from its final rect, at the field tint.
    const firsts = asm.boxes.filter((b) => b.fromSec === Number(tl.assembleStart.toFixed(3)));
    expect(firsts).toHaveLength(26);
    expect(firsts.some((b, i) => b.x !== finals[i].x || b.y !== finals[i].y)).toBe(true);
  });

  it("a long clip splits the assembly across tracks under the per-track budget", async () => {
    const doc = await render({}, ctxFor(1024, 1024, HINT_MS * 3));
    const tracks = byLabel(doc, "mark-rects");
    expect(tracks.length).toBeGreaterThan(1);
    for (const t of tracks) expect(t.lavfi!.split(",drawbox=").length - 1).toBeLessThanOrEqual(ASSEMBLE_BOXES_PER_TRACK);
  });

  it("inverseSmoothstep inverts smoothstep; mixHex blends the brand tokens; reveal options are closed", () => {
    for (const u of [0, 0.1, 0.25, 0.5, 0.8, 1]) {
      const t = inverseSmoothstep(u);
      expect(t * t * (3 - 2 * t)).toBeCloseTo(u, 6);
    }
    expect(inverseSmoothstep(0.3)).toBeLessThan(inverseSmoothstep(0.7));
    expect(mixHex(NAVY, NAVY_SOFT, 0)).toBe("#050314");
    expect(mixHex(NAVY, NAVY_SOFT, 1)).toBe("#3A394F");
    expect(mixHex(NAVY, NAVY_SOFT, 0.16)).toBe("#0D0C1D");
    expect([...HELLO_MARK_REVEALS]).toEqual(["assemble", "fade"]);
  });
});

describe(`${ID} — ships in the web build`, () => {
  it("the template and its data modules import no node builtins", () => {
    // Since 2026-09-14 the card lives in template-utils (`brand/hello-world/`)
    // and this folder is the core call — check BOTH halves, since both ship in
    // the web bundle.
    const factoryDir = path.resolve(__dirname, "../../../../../template-utils/src/brand/hello-world");
    const files = [
      path.join(__dirname, "hello-world.ts"),
      path.join(__dirname, "index.ts"),
      ...["helloWorld.ts", "field-data.ts", "wordmark.ts", "m-rects.ts", "index.ts"].map((f) => path.join(factoryDir, f)),
    ];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      expect(src).not.toMatch(/from\s+["'](node:|fs["']|path["']|child_process|os["'])/);
      expect(src).not.toMatch(/require\(["'](node:|fs["']|path["']|child_process)/);
    }
  });
});
