import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String } from "@m0saic/dsl";
import { DonutV3 } from "./donut";
import { subdivideForSweep } from "./anim";
import { segmentsToAngles } from "./geometry";

const W = 360;
const H = 360;

function makeCtx(durationMs = 2000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: W, height: H, fps: 30, durationMs },
    output: { width: W, height: H, fps: 30, durationMs, workspaceDir: "/tmp/donut-v3" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const twoSeg = () => ({
  segments: [
    { label: "Weekday Commits", value: 75 },
    { label: "Weekend Commits", value: 25 },
  ],
  centerValue: "247",
});

const render = async (props: Record<string, unknown>, ctx = makeCtx()) =>
  (await DonutV3.render(props as never, ctx)) as MosaicDocument;

const isText = (s: MosaicSource) => (s as { type?: string }).type === "text";
const maskOf = (s: MosaicSource) => (s as { mask?: { kind?: string; localPath?: string; bounds?: { width?: number; height?: number } } }).mask;
const boundsArea = (s: MosaicSource) => {
  const b = maskOf(s)?.bounds;
  return b ? (b.width ?? 0) * (b.height ?? 0) : 0;
};

describe("DonutV3 — document shape", () => {
  it("renders a valid m0 with one source per placed cell", async () => {
    const doc = await render(twoSeg());
    expect(isValidM0String(String(doc.m0))).toBe(true);
    const sliverCount = subdivideForSweep(segmentsToAngles([75, 25])).length;
    // slivers + 1 value text
    expect(doc.sources?.length).toBe(sliverCount + 1);
  });

  it("is marked v3, deprecated in favor of v4", () => {
    expect(DonutV3.version).toBe(3);
    const dep = (DonutV3 as { deprecated?: { replacement?: string } }).deprecated;
    expect(dep).toBeDefined();
    expect(dep?.replacement).toBe("@m0saic/charts/donut/v4");
  });
});

describe("DonutV3 — tight bbox masks (the v1 fix)", () => {
  it("ring tiles are inline-masked AND bounded smaller than the full canvas", async () => {
    const doc = await render(twoSeg());
    const ring = doc.sources!.filter((s) => !isText(s));
    expect(ring.length).toBeGreaterThan(0);
    for (const s of ring) {
      const m = maskOf(s);
      expect(m?.kind).toBe("inline-mask");
      expect(m?.localPath).toContain("A "); // arc commands
    }
    // The defining win: no ring tile rasterizes the full 360×360 frame.
    const full = W * H;
    expect(ring.every((s) => boundsArea(s) < full)).toBe(true);
    // Sweep slivers are genuinely small — the median ring cell is a fraction
    // of the canvas (v1 had every cell at full frame).
    const areas = ring.map(boundsArea).sort((a, b) => a - b);
    const median = areas[Math.floor(areas.length / 2)];
    expect(median).toBeLessThan(full * 0.5);
  });

  it("a single 100% segment legitimately fills the frame (static)", async () => {
    const doc = await render({
      segments: [{ label: "All", value: 1 }],
      anim: { reduceMotion: true, countUp: false },
    });
    const ring = doc.sources!.filter((s) => !isText(s));
    expect(ring.length).toBe(1);
    // A full ring's bbox IS ~the canvas (ring diameter = 0.92×canvas) — that's
    // correct, not waste — vs a thin sliver which is a small fraction.
    expect(boundsArea(ring[0])).toBeGreaterThan(W * H * 0.8);
  });

  it("the smaller segment gets the smaller cell (static)", async () => {
    const doc = await render({ ...twoSeg(), anim: { reduceMotion: true, countUp: false } });
    const ring = doc.sources!.filter((s) => !isText(s));
    expect(ring.length).toBe(2);
    const areas = ring.map(boundsArea);
    expect(Math.min(...areas)).toBeLessThan(Math.max(...areas));
  });
});

describe("DonutV3 — content", () => {
  it("derives the center value from the sum when absent (static)", async () => {
    const doc = await render({
      segments: [{ label: "a", value: 30 }, { label: "b", value: 70 }],
      anim: { reduceMotion: true, countUp: false },
    });
    const texts = doc.sources!.filter(isText);
    const joined = JSON.stringify(texts);
    expect(joined).toContain("100");
  });

  it("percent labels + caption add their own tight cells", async () => {
    const base = await render({ ...twoSeg(), anim: { reduceMotion: true, countUp: false } });
    const withExtras = await render({
      ...twoSeg(),
      segmentLabels: "percent",
      centerLabel: "Total Commits",
      anim: { reduceMotion: true, countUp: false },
    });
    expect((withExtras.sources?.length ?? 0)).toBeGreaterThan(base.sources?.length ?? 0);
  });

  it("fails fast on empty segments", async () => {
    await expect(render({ segments: [] })).rejects.toThrow();
  });
});

describe("DonutV3 — light mode (composable)", () => {
  const light = () => ({ ...twoSeg(), renderMode: "light" });

  it("premium is the default (renderMode omitted → placeRects split)", async () => {
    const doc = await render(twoSeg());
    expect(String(doc.m0).includes("[")).toBe(true); // placeRects claimant split = ABSOLUTE
  });

  it("light m0 is a RATIO overlay stack (no placeRects split → composes)", async () => {
    const doc = await render(light());
    const m0 = String(doc.m0);
    expect(isValidM0String(m0)).toBe(true);
    expect(m0.includes("[")).toBe(false); // no canvas-scale basis → RATIO
    expect(/^[0-9{}]+$/.test(m0)).toBe(true); // only weight cells + overlay braces
  });

  it("light stays shallow (segments + text, well under the W3 ~25 cliff)", async () => {
    const doc = await render(light());
    expect((doc.sources ?? []).length).toBeLessThanOrEqual(12); // ≤ MAX_SEGMENTS + text
  });

  it("light reveals via a slight overlay.alpha fade (premium, not a hard pop)", async () => {
    const doc = await render(light());
    const faded = (doc.sources ?? []).filter((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha);
    expect(faded.length).toBeGreaterThan(0);
    expect((doc.sources ?? []).some((s) => (s as { overlay?: { enable?: string } }).overlay?.enable)).toBe(false);
  });

  it("light reduceMotion → static, no fades", async () => {
    const doc = await render({ ...light(), anim: { reduceMotion: true } });
    const faded = (doc.sources ?? []).filter((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha);
    expect(faded.length).toBe(0);
  });
});

describe("DonutV3 — theming (resolveThemeTokens consumer)", () => {
  const PROD = {
    surfaceApp: "#101820", surface: "#182430", surfaceRaised: "#202c3a", surfaceInset: "#0a0f14",
    border: "#334455", borderStrong: "#556677",
    textPrimary: "#ffffff", textSecondary: "#c0c0c0", textMuted: "#8899aa", eyebrow: "#c0c0c0",
    accent: "#ff8800", accentSoft: "#ffaa33", accentGlow: "#ff8800",
    positive: "#00cc66", negative: "#ff3355",
    grid: "#ff00ff", gridAlpha: 1, axis: "#00ffcc", axisAlpha: 1, radius: 0.04,
    dataPalette: ["#aa11bb", "#00cc66", "#cc00ff", "#ffcc00", "#00ccff", "#ff0066"],
  };
  const withUpstream = (tokens: unknown) => {
    const c = makeCtx() as unknown as { upstreamData?: unknown };
    c.upstreamData = { theme: tokens };
    return c as unknown as MosaicEngineContext;
  };
  // Uncolored segments so the theme's dataPalette actually applies.
  const uncolored = () => ({
    segments: [{ label: "A", value: 60 }, { label: "B", value: 40 }],
    centerValue: "100", centerLabel: "Total",
  });

  it("determinism: two unthemed renders deep-equal", async () => {
    const a = await render(uncolored());
    const b = await render(uncolored());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("byte-identity: unthemed uses the local palette + colors", async () => {
    const doc = await render(uncolored());
    const paint = JSON.stringify(doc.sources);
    expect(doc.backgroundColor).toBe("#161b22"); // CARD_BG == theme.surface un-themed
    expect(paint.includes("#f97316")).toBe(true); // segment 0 = PALETTE[0]
    expect(paint.includes("#f5f5f4")).toBe(true); // value = VALUE_COLOR (textPrimary)
    expect(paint.includes("#a8a29e")).toBe(true); // caption = CAPTION_COLOR (textSecondary)
  });

  it("producer override: ctx.upstreamData.theme flips surface / segment palette / text", async () => {
    const doc = await render(uncolored(), withUpstream(PROD));
    const paint = JSON.stringify(doc.sources);
    expect(doc.backgroundColor).toBe(PROD.surface); // card ← surface
    expect(paint.includes(PROD.dataPalette[0])).toBe(true); // segment 0 ← dataPalette[0]
    expect(paint.includes(PROD.textPrimary)).toBe(true); //   value ← textPrimary
    expect(paint.includes(PROD.textSecondary)).toBe(true); // caption ← textSecondary
  });

  it("explicit props still win over the producer theme", async () => {
    const doc = await render(
      { segments: [{ label: "A", value: 60, color: "#123abc" }, { label: "B", value: 40 }], centerValue: "100", backgroundColor: "#fedcba" },
      withUpstream(PROD),
    );
    expect(JSON.stringify(doc.sources).includes("#123abc")).toBe(true); // explicit seg color wins
    expect(doc.backgroundColor).toBe("#fedcba"); // explicit bg wins
  });

  it("theming applies to light mode too", async () => {
    const doc = await render({ ...uncolored(), renderMode: "light" }, withUpstream(PROD));
    expect(doc.backgroundColor).toBe(PROD.surface);
    expect(JSON.stringify(doc.sources).includes(PROD.dataPalette[0])).toBe(true);
  });
});
