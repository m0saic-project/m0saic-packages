import type { MosaicColor, MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String } from "@m0saic/dsl";
import { DonutV2 } from "./donut";

function makeCtx(durationMs = 2000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: 360, height: 360, fps: 30, durationMs },
    output: { width: 360, height: 360, fps: 30, durationMs, workspaceDir: "/tmp/donut-v2" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const twoSeg = (extra: Record<string, unknown> = {}) => ({
  segments: [
    { label: "Weekday Commits", value: 75 },
    { label: "Weekend Commits", value: 25 },
  ],
  // small grid keeps the built doc cheap for unit tests unless overridden
  resolution: 14,
  ...extra,
});

const render = async (props: Record<string, unknown>, ctx = makeCtx()) =>
  (await DonutV2.render(props as never, ctx)) as MosaicDocument;

const ringOf = (doc: MosaicDocument): MosaicDocument =>
  (doc as unknown as { children: { ring: MosaicDocument } }).children.ring;
const colorOf = (s: MosaicSource) => (s as { color?: MosaicColor }).color;
const alphaOf = (s: MosaicSource) => (s as { overlay?: { alpha?: string } }).overlay?.alpha;
const typeOf = (s: MosaicSource) => (s as { type?: string }).type;

describe("DonutV2 — two-layer composition", () => {
  it("root is an overlay stack: a ring child below, center text on top", async () => {
    const doc = await render(twoSeg({ centerValue: "247" }));
    expect(isValidM0String(String(doc.m0))).toBe(true);
    // sources[0] = the ring child ref; the rest are text overlays.
    expect(typeOf(doc.sources[0])).toBe("mosaic");
    expect((doc.sources[0] as { ref?: string }).ref).toBe("ring");
    expect(doc.sources.slice(1).every((s) => typeOf(s) === "text")).toBe(true);
    expect(ringOf(doc)).toBeDefined();
  });

  it("the ring child is a valid N×N grid of exactly N² unmasked lavfi tiles", async () => {
    const ring = ringOf(await render(twoSeg({ resolution: 14 })));
    expect(isValidM0String(String(ring.m0))).toBe(true);
    expect(ring.sources).toHaveLength(196); // 14²
    expect(ring.sources.every((s) => typeOf(s) === "lavfi")).toBe(true);
    const anyMasked = ring.sources.some((s) => (s as { mask?: unknown }).mask !== undefined);
    expect(anyMasked).toBe(false); // the whole point — no masks
  });

  it("defaults to a smooth 72×72 grid", async () => {
    const ring = ringOf(await render({ segments: twoSeg().segments })); // no resolution → default
    expect(ring.sources).toHaveLength(72 * 72);
  });

  it("clamps resolution into [6, 160]", async () => {
    expect(ringOf(await render(twoSeg({ resolution: 2 }))).sources).toHaveLength(36); // → 6²
    expect(ringOf(await render(twoSeg({ resolution: 999 }))).sources).toHaveLength(160 * 160); // → 160²
  });
});

describe("DonutV2 — ring rasterization", () => {
  it("paints ring cells with segment colors and the rest with the card background", async () => {
    const bg = "#161b22";
    const ring = ringOf(await render(twoSeg({ backgroundColor: bg })));
    const ringCells = ring.sources.filter((s) => colorOf(s) !== bg);
    const bgCells = ring.sources.filter((s) => colorOf(s) === bg);
    expect(ringCells.length).toBeGreaterThan(0);
    expect(bgCells.length).toBeGreaterThan(0);
    expect(new Set(ringCells.map(colorOf))).toEqual(new Set(["#588168", "#95c6a7"]));
  });

  it("places the 25% minority segment in the upper-left (clockwise from 12 o'clock)", async () => {
    const ring = ringOf(await render(twoSeg({ resolution: 14 })));
    // row 2, col 2 lies on the ring at ~315° (af≈0.875) — the minority arc.
    expect(colorOf(ring.sources[2 * 14 + 2])).toBe("#95c6a7");
  });
});

describe("DonutV2 — center text overlay", () => {
  it("renders the center value, and a count-up expr layer when animated", async () => {
    const doc = await render(twoSeg({ centerValue: "247" }));
    const value = doc.sources[1] as { layers?: { content?: { kind?: string } }[] };
    expect(value.layers?.[0]?.content?.kind).toBe("expr"); // count-up
  });

  it("adds a caption layer when centerLabel is set", async () => {
    const doc = await render(twoSeg({ centerValue: "247", centerLabel: "Total Commits" }));
    expect(doc.sources.filter((s) => typeOf(s) === "text")).toHaveLength(2);
  });

  it("derives the center value from the segment sum when omitted", async () => {
    const doc = await render(twoSeg({ anim: { countUp: false } }));
    const value = doc.sources[1] as { layers?: { content?: { kind?: string; text?: string } }[] };
    expect(value.layers?.[0]?.content?.text).toBe("100"); // 75 + 25
  });
});

describe("DonutV2 — sweep animation", () => {
  it("gives ring cells a clockwise alpha reveal; bg cells stay static", async () => {
    const bg = "#161b22";
    const ring = ringOf(await render(twoSeg({ backgroundColor: bg })));
    expect(ring.sources.filter((s) => colorOf(s) !== bg).every((s) => typeof alphaOf(s) === "string")).toBe(true);
    expect(ring.sources.filter((s) => colorOf(s) === bg).every((s) => alphaOf(s) === undefined)).toBe(true);
  });

  it("reduceMotion → static ring (no alpha) and a literal (non-expr) center value", async () => {
    const doc = await render(twoSeg({ centerValue: "247", anim: { reduceMotion: true } }));
    expect(ringOf(doc).sources.every((s) => alphaOf(s) === undefined)).toBe(true);
    const value = doc.sources[1] as { layers?: { content?: { kind?: string } }[] };
    expect(value.layers?.[0]?.content?.kind).toBe("literal");
  });

  it("is deterministic — identical props produce byte-identical docs", async () => {
    expect(JSON.stringify(await render(twoSeg()))).toBe(JSON.stringify(await render(twoSeg())));
  });
});

describe("DonutV2 — deprecation", () => {
  it("is marked deprecated, pointing at the canonical replacement", () => {
    expect(DonutV2.deprecated).toBeDefined();
    expect(DonutV2.deprecated?.replacement).toBe("@m0saic/charts/donut/v4");
    expect(DonutV2.deprecated?.since).toBe("2026-06-18");
  });
});

describe("DonutV2 — validation", () => {
  it("rejects empty segments", async () => {
    await expect(render({ segments: [] })).rejects.toThrow(/non-empty/);
  });
  it("rejects segments that sum to zero", async () => {
    await expect(render({ segments: [{ label: "a", value: 0 }] })).rejects.toThrow(/sum to/);
  });
  it("rejects out-of-range ring thickness", async () => {
    await expect(render(twoSeg({ ringThicknessFrac: 0.99 }))).rejects.toThrow(/ringThicknessFrac/);
  });
});
