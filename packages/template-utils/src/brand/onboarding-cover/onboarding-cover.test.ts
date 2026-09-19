/**
 * Locks for the hoisted mosaic-branding cover kit — ported beside the
 * template-utils copy from `packages/templates/src/m0saic/_shared/
 * onboarding-cover.test.ts` (import paths only).
 *
 * The theme contract is the mosaic-branding-covers ruling; these specs pin the assembler's shape: chat pane copy lands in sources,
 * the brand asset rides every cover, bubble weights generalize over count
 * (three reproduces the gate-26 conversation exactly), portrait stacks, and
 * nested-child heroes attach.
 */
import { isValidM0String } from "@m0saic/dsl";
import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicSource,
} from "@m0saic/types";
import {
  buildBrandedCover,
  brandedCoverHeroBox,
  inlineHeroDoc,
  onboardingLeaf,
  onboardingSolid,
  type BrandedCoverCopy,
} from "./onboarding-cover";

function makeCtx(W: number, H: number): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: W, height: H, fps: 30, durationMs: 3000 },
    output: { width: W, height: H, fps: 30, durationMs: 3000 },
    media: {},
  } as unknown as MosaicEngineContext;
}

const COPY: BrandedCoverCopy = {
  productName: "Test Product",
  title: "A headline.",
  overview: "The long overview sentence.",
  overviewCompact: "Short overview.",
  messages: [
    { label: "STEP ONE", body: "First body.", bodyCompact: "First short." },
    { label: "STEP TWO", body: "Second body." },
    { label: "STEP THREE", body: "Third body." },
  ],
  tip: "Do the one thing.",
};

const build = (W: number, H: number, copy: BrandedCoverCopy = COPY) =>
  buildBrandedCover({
    ctx: makeCtx(W, H),
    copy,
    hero: (theme) => onboardingSolid(theme.surfaceRaised),
  });

const blob = (doc: MosaicDocument) => JSON.stringify(doc.sources);

describe("buildBrandedCover", () => {
  it("assembles a valid doc with the full theme contract in sources", () => {
    const doc = build(1920, 1080);
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    const s = blob(doc);
    for (const t of [
      "Test Product",
      "A headline.",
      "The long overview sentence.",
      "STEP ONE",
      "STEP TWO",
      "STEP THREE",
      "START HERE",
      "Do the one thing.",
    ]) {
      expect(s).toContain(t);
    }
    // The brand M asset rides every branded cover.
    expect(Object.keys(doc.assets ?? {}).length).toBeGreaterThan(0);
    expect(doc.size).toEqual({ width: 1920, height: 1080 });
  });

  it("compact copy swaps in under 480px min-dim", () => {
    const doc = build(840, 472);
    const s = blob(doc);
    expect(s).toContain("Short overview.");
    expect(s).toContain("First short.");
    expect(s).not.toContain("The long overview sentence.");
    // A message without a compact variant falls back to its full body.
    expect(s).toContain("Second body.");
  });

  it("portrait stacks and stays valid; bubble count generalizes", () => {
    const stacked = build(1080, 1920);
    expect(isValidM0String(stacked.m0 as unknown as string)).toBe(true);
    const two = build(1920, 1080, { ...COPY, messages: (COPY.messages ?? []).slice(0, 2) });
    expect(isValidM0String(two.m0 as unknown as string)).toBe(true);
    expect(blob(two)).not.toContain("STEP THREE");
  });

  it("is deterministic and self-contained (media sources only from the manifest)", () => {
    const a = build(1920, 1080);
    const b = build(1920, 1080);
    expect(a.m0).toBe(b.m0);
    expect(blob(a)).toBe(blob(b));
    // The brand M rides as a media source backed by the bundled asset —
    // self-contained means every media source's assetId is in THIS manifest.
    const assetIds = new Set(Object.keys(a.assets ?? {}));
    const media = ((a.sources ?? []) as MosaicSource[]).filter(
      (s) => (s as { type?: string }).type === "media",
    );
    expect(media.length).toBeGreaterThan(0);
    expect(
      media.every((s) => assetIds.has(String((s as { assetId?: string }).assetId))),
    ).toBe(true);
  });

  it("attaches nested-child heroes and honors tipLabel override", () => {
    const child: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      assets: {} as never,
      m0: "F" as never,
      sources: [],
    } as unknown as MosaicDocument;
    const doc = buildBrandedCover({
      ctx: makeCtx(1920, 1080),
      copy: { ...COPY, tipLabel: "GO" },
      hero: () =>
        onboardingLeaf({ type: "mosaic", ref: "coverChart" } as unknown as MosaicSource),
      children: { coverChart: child },
    });
    expect(
      (doc as { children?: Record<string, MosaicDocument> }).children?.coverChart,
    ).toBe(child);
    expect(blob(doc)).toContain("GO");
    expect(blob(doc)).not.toContain("START HERE");
  });
});

describe("brandedCoverHeroBox", () => {
  it("tracks the landscape hero column and the stacked lower half", () => {
    const land = brandedCoverHeroBox(makeCtx(1920, 1080));
    expect(land).toEqual({ width: Math.round(1920 * 0.59), height: Math.round(1080 * 0.9) });
    const port = brandedCoverHeroBox(makeCtx(1080, 1920));
    expect(port.width).toBe(Math.round(1080 * 0.88));
    expect(port.height).toBeLessThan(port.width);
  });
});

describe("buildBrandedCover — tiny-canvas band fallback (gate-17 keeper)", () => {
  it("below the pane floor it degrades to hero + px-clamped brand band, never a cullable pane", () => {
    const doc = build(760, 290);
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    const s = blob(doc);
    // Brand + title survive; the conversation (bubbles/tip) bows out.
    expect(s).toContain("Test Product");
    expect(s).toContain("A headline.");
    expect(s).not.toContain("STEP ONE");
    expect(s).not.toContain("START HERE");
  });

  it("hero box hands the band-mode hero the full width above the band", () => {
    const box = brandedCoverHeroBox(makeCtx(760, 290));
    expect(box.width).toBe(760);
    const bandPx = Math.max(34, Math.min(120, Math.round(290 * 0.12)));
    expect(box.height).toBe(290 - bandPx);
  });
});

describe("inlineHeroDoc", () => {
  it("inlines a rendered doc flat — m0 + sources, no child ref", () => {
    const doc = build(1920, 1080);
    const inline = inlineHeroDoc(doc);
    expect(inline.m0).toBe(doc.m0);
    expect(inline.sources.length).toBe((doc.sources ?? []).length);
  });
});

describe("buildBrandedCover — band variant (basic viz ruling)", () => {
  it('variant:"band" uses the simple brand view at EVERY canvas — no pane', () => {
    const doc = buildBrandedCover({
      ctx: makeCtx(1920, 1080),
      copy: { productName: "Test Product", title: "A test chart." },
      hero: (theme) => onboardingSolid(theme.surfaceRaised),
      variant: "band",
    });
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    const s = blob(doc);
    expect(s).toContain("Test Product");
    expect(s).toContain("A test chart.");
    expect(s).not.toContain("START HERE");
  });

  it("band hero box spans full width above the clamped band", () => {
    const box = brandedCoverHeroBox(makeCtx(1920, 1080), "band");
    expect(box.width).toBe(1920);
    expect(box.height).toBe(1080 - Math.max(34, Math.min(120, Math.round(1080 * 0.12))));
  });
});
