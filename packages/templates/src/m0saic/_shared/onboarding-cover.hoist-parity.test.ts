/**
 * Parity lock for the hoisted mosaic-branding cover kit: the copy in
 * `@m0saic/template-utils` (brand/onboarding-cover) must build the SAME
 * documents as this `_shared/onboarding-cover` original — the first-party
 * templates keep importing the original (frozen), community templates the
 * copy, and the two must never drift. Deep equality over every layout
 * branch: landscape pane, portrait stacked, compact, tiny-canvas band
 * fallback, explicit band variant, nested children, and the hero box.
 */
import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicSource,
} from "@m0saic/types";
import {
  ONBOARDING_THEME as hoistedTheme,
  buildBrandedCover as hoistedBuild,
  brandedCoverHeroBox as hoistedHeroBox,
  coverTypeRamp as hoistedRamp,
  onboardingLeaf as hoistedLeaf,
  onboardingSolid as hoistedSolid,
  onboardingBrandAssets as hoistedBrandAssets,
  type BrandedCoverCopy,
} from "@m0saic/template-utils";
import {
  ONBOARDING_THEME,
  buildBrandedCover,
  brandedCoverHeroBox,
  coverTypeRamp,
  onboardingBrandAssets,
  onboardingLeaf,
  onboardingSolid,
} from "./onboarding-cover";

function makeCtx(W: number, H: number): MosaicEngineContext {
  return {
    mode: "design",
    target: { width: W, height: H, fps: 30, durationMs: 1000 },
    output: { width: W, height: H, fps: 30, durationMs: 1000, workspaceDir: "" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const COPY: BrandedCoverCopy = {
  productName: "Parity",
  title: "Same bytes, two homes",
  overview: "The hoisted kit and the original must agree on every document.",
  overviewCompact: "Hoisted and original agree.",
  messages: [
    { label: "ONE", body: "First step of the mental model", bodyCompact: "First" },
    { label: "TWO", body: "Second step of the mental model", bodyCompact: "Second" },
    { label: "THREE", body: "Third step of the mental model", bodyCompact: "Third" },
  ],
  tip: "Set the props and render.",
};

const child = {
  kind: "mosaic_document",
  version: 1,
  assets: {},
  size: { width: 640, height: 360 },
  ...onboardingSolid("#000000" as never),
} as unknown as MosaicDocument;

const SIZES: Array<[number, number]> = [
  [1920, 1080], // landscape pane
  [1080, 1920], // portrait stacked
  [640, 400], // compact (min-dim < 480) + landscape
  [800, 300], // tiny canvas → band fallback
  [3840, 2160], // stage-scaled ramp
  [480, 700], // compact portrait stacked
];

describe("onboarding-cover hoist parity (templates/_shared vs template-utils)", () => {
  it("shares the theme and the type ramp", () => {
    expect(hoistedTheme).toEqual(ONBOARDING_THEME);
    for (const [W, H] of SIZES) {
      expect(hoistedRamp(W, H)).toEqual(coverTypeRamp(W, H));
    }
  });

  it("filters the brand assets to the same data-uri entries", () => {
    const dataUris = (m: Record<string, { kind?: string }>) =>
      Object.entries(m).filter(([, e]) => e?.kind === "data-uri");
    expect(dataUris(hoistedBrandAssets() as never)).toEqual(
      dataUris(onboardingBrandAssets() as never),
    );
  });

  it.each(SIZES)("builds an identical pane document at %ix%i", (W, H) => {
    const ctx = makeCtx(W, H);
    const heroA = (theme: { accent: string }) =>
      onboardingLeaf(onboardingSolid(theme.accent as never).sources[0]);
    const heroB = (theme: { accent: string }) =>
      hoistedLeaf(hoistedSolid(theme.accent as never).sources[0]);
    const a = buildBrandedCover({ ctx, copy: COPY, hero: heroA as never });
    const b = hoistedBuild({ ctx, copy: COPY, hero: heroB as never });
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(hoistedHeroBox(ctx)).toEqual(brandedCoverHeroBox(ctx));
  });

  it.each(SIZES)("builds an identical band document with children at %ix%i", (W, H) => {
    const ctx = makeCtx(W, H);
    const hero = () =>
      onboardingLeaf({ type: "mosaic", ref: "child" } as unknown as MosaicSource);
    const heroHoisted = () =>
      hoistedLeaf({ type: "mosaic", ref: "child" } as unknown as MosaicSource);
    const a = buildBrandedCover({
      ctx,
      copy: COPY,
      hero,
      variant: "band",
      children: { child },
      heroAssets: {} as never,
    });
    const b = hoistedBuild({
      ctx,
      copy: COPY,
      hero: heroHoisted,
      variant: "band",
      children: { child },
      heroAssets: {} as never,
    });
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(hoistedHeroBox(ctx, "band")).toEqual(brandedCoverHeroBox(ctx, "band"));
  });
});
