import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String } from "@m0saic/dsl";
import { Donut } from "./donut";
import { subdivideForSweep } from "./anim";
import { segmentsToAngles } from "./geometry";

function makeCtx(durationMs = 2000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: 360, height: 360, fps: 30, durationMs },
    output: { width: 360, height: 360, fps: 30, durationMs, workspaceDir: "/tmp/donut" },
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

// Async wrapper: the template fails fast with SYNC throws — wrapping
// converts them to rejections so `.rejects` assertions work uniformly.
const render = async (props: Record<string, unknown>, ctx = makeCtx()) =>
  (await Donut.render(props as never, ctx)) as MosaicDocument;

const maskOf = (s: MosaicSource) =>
  (s as { mask?: { kind?: string; localPath?: string } }).mask;
const overlayOf = (s: MosaicSource) =>
  (s as { overlay?: { startAtSec?: number; alpha?: string } }).overlay;
const isText = (s: MosaicSource) => (s as { type?: string }).type === "text";

describe("Donut — document shape", () => {
  it("emits ONE cell: a valid overlay stack matching the source count", async () => {
    const doc = await render(twoSeg());
    const m0 = String(doc.m0);
    expect(isValidM0String(m0)).toBe(true);
    // Sweep mode (default): slivers + 1 value text.
    const sliverCount = subdivideForSweep(segmentsToAngles([75, 25])).length;
    expect(doc.sources?.length).toBe(sliverCount + 1);
    // Overlay-stack: canonical "1{1{…}}" — nothing but tiles and braces.
    expect(m0).toMatch(/^[1{}]+$/);
  });

  it("every ring source is a full-canvas inline-masked color tile", async () => {
    const doc = await render(twoSeg());
    const ring = doc.sources!.filter((s) => !isText(s));
    expect(ring.length).toBeGreaterThan(0);
    for (const s of ring) {
      const m = maskOf(s);
      expect(m?.kind).toBe("inline-mask");
      expect(m?.localPath).toContain("A "); // arc commands
      expect((m as { bounds?: { width?: number } }).bounds?.width).toBe(360);
    }
  });

  it("derives the center value from the segment sum when absent", async () => {
    // reduceMotion → literal text (count-up would make it an expr layer).
    const doc = await render({
      segments: [{ label: "a", value: 30 }, { label: "b", value: 12 }],
      anim: { reduceMotion: true },
    });
    const text = doc.sources!.find(isText) as { layers?: Array<{ content?: { text?: string } }> };
    expect(text?.layers?.[0]?.content?.text).toBe("42");
  });

  it("renders a caption source only when centerLabel is set", async () => {
    const without = await render(twoSeg());
    const withCaption = await render({ ...twoSeg(), centerLabel: "Total Commits" });
    expect(withCaption.sources!.filter(isText).length).toBe(
      without.sources!.filter(isText).length + 1,
    );
  });
});

describe("Donut — animation modes", () => {
  it("sweep mode staggers sliver reveals on a monotonic schedule ending at the intro", async () => {
    const doc = await render(twoSeg());
    const starts = doc.sources!
      .filter((s) => !isText(s))
      .map((s) => overlayOf(s)?.startAtSec ?? -1);
    expect(starts[0]).toBe(0);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]).toBeGreaterThan(starts[i - 1]);
    }
    // introSec = 0.7 × 2s — the last sliver starts before the intro ends.
    expect(starts[starts.length - 1]).toBeLessThan(1.4);
  });

  it("fade mode emits one source per segment", async () => {
    const doc = await render({ ...twoSeg(), anim: { mode: "fade" } });
    expect(doc.sources!.filter((s) => !isText(s)).length).toBe(2);
    expect(overlayOf(doc.sources![1])?.alpha).toContain("t-");
  });

  it("reduceMotion renders static whole sectors with no overlay expressions", async () => {
    const doc = await render({ ...twoSeg(), anim: { reduceMotion: true } });
    const ring = doc.sources!.filter((s) => !isText(s));
    expect(ring.length).toBe(2);
    for (const s of ring) expect(overlayOf(s)).toBeUndefined();
  });

  it("intro scales with the output duration (ctx.target is the time source)", async () => {
    const short = await render(twoSeg(), makeCtx(1000));
    const long = await render(twoSeg(), makeCtx(4000));
    const lastStart = (doc: MosaicDocument) => {
      const ring = doc.sources!.filter((s) => !isText(s));
      return overlayOf(ring[ring.length - 1])?.startAtSec ?? 0;
    };
    expect(lastStart(long)).toBeCloseTo(lastStart(short) * 4, 5);
  });

  it("is deterministic — same props, same document", async () => {
    const a = await render({ ...twoSeg(), segmentLabels: "percent" });
    const b = await render({ ...twoSeg(), segmentLabels: "percent" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("Donut — segment labels", () => {
  it("percent mode adds one label per wide-enough segment", async () => {
    const base = await render(twoSeg());
    const labeled = await render({ ...twoSeg(), segmentLabels: "percent" });
    expect(labeled.sources!.length).toBe(base.sources!.length + 2);
    const texts = labeled.sources!.filter(isText) as Array<{
      layers?: Array<{ content?: { text?: string } }>;
    }>;
    const bodies = texts.map((t) => t.layers?.[0]?.content?.text);
    expect(bodies).toContain("75%");
    expect(bodies).toContain("25%");
  });

  it("skips slices thinner than the minimum sweep", async () => {
    // 2% of 360° = 7.2° < 14° threshold → no label for the sliver.
    const doc = await render({
      segments: [{ label: "big", value: 98 }, { label: "tiny", value: 2 }],
      segmentLabels: "percent",
    });
    const bodies = (doc.sources!.filter(isText) as Array<{
      layers?: Array<{ content?: { text?: string } }>;
    }>).map((t) => t.layers?.[0]?.content?.text);
    expect(bodies).toContain("98%");
    expect(bodies).not.toContain("2%");
  });
});

describe("Donut — fail-fast validation", () => {
  it("rejects empty / oversized / malformed segments", async () => {
    await expect(render({ segments: [] })).rejects.toThrow();
    await expect(
      render({ segments: Array(13).fill({ label: "x", value: 1 }) }),
    ).rejects.toThrow();
    await expect(
      render({ segments: [{ label: "a", value: -1 }] }),
    ).rejects.toThrow();
  });

  it("rejects out-of-range ringThicknessFrac", async () => {
    await expect(render({ ...twoSeg(), ringThicknessFrac: 0.01 })).rejects.toThrow();
    await expect(render({ ...twoSeg(), ringThicknessFrac: 0.95 })).rejects.toThrow();
  });
});
