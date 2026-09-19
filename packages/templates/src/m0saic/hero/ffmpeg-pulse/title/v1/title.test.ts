import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete } from "@m0saic/dsl";
import { FfmpegPulseTitle } from "./title";
import { MOCK_FFMPEG_PULSE } from "../../_shared/pulse-data";

const ASPECTS: [number, number, string][] = [
  [1920, 1080, "landscape"],
  [1080, 1080, "square"],
  [1080, 1920, "portrait"],
];

function makeCtx(W: number, H: number, durationMs = 3000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: W, height: H, fps: 30, durationMs },
    output: { width: W, height: H, fps: 30, durationMs, workspaceDir: "/tmp/pulse-title" },
    media: {},
  } as unknown as MosaicEngineContext;
}
const render = async (W: number, H: number, props: Record<string, unknown> = {}, durationMs?: number) =>
  (await FfmpegPulseTitle.render({ ...(FfmpegPulseTitle.defaultProps as object), ...props } as never, makeCtx(W, H, durationMs))) as MosaicDocument;

const srcs = (doc: MosaicDocument) => (doc.sources ?? []) as MosaicSource[];
const isText = (s: MosaicSource) => (s as { type?: string }).type === "text";
const isTile = (s: MosaicSource) => (s as { type?: string }).type === "lavfi";
const texts = (doc: MosaicDocument) =>
  srcs(doc).filter(isText).flatMap((s) => ((s as { layers?: Array<{ content?: { text?: string } }> }).layers ?? []).map((l) => l.content?.text ?? ""));

describe("FfmpegPulseTitle — upstream weeklyPulse wins (F5 Seam D)", () => {
  it("renders the upstream repo + week when ctx.upstreamData.weeklyPulse is present", async () => {
    const upstreamPulse = {
      ...MOCK_FFMPEG_PULSE,
      repo: { ...MOCK_FFMPEG_PULSE.repo, name: "UpstreamRepo" },
      period: { ...MOCK_FFMPEG_PULSE.period, weekNumber: 99 },
    };
    const ctx = { ...makeCtx(1920, 1080), upstreamData: { weeklyPulse: upstreamPulse } } as MosaicEngineContext;
    const doc = (await FfmpegPulseTitle.render(FfmpegPulseTitle.defaultProps as never, ctx)) as MosaicDocument;
    const t = texts(doc);
    expect(t.some((s) => s.includes("WEEK 99"))).toBe(true); // week pill from upstream, not the mock's WEEK 20
    expect(t.join(" ").toLowerCase()).toContain("upstreamrepo"); // wordmark from upstream, not "FFmpeg"
  });
});

describe("FfmpegPulseTitle — metadata", () => {
  it("is the registered internal v1 beat", () => {
    expect(FfmpegPulseTitle.id).toBe("@m0saic/hero/ffmpeg-pulse/title/v1");
    expect(FfmpegPulseTitle.version).toBe(1);
    expect(FfmpegPulseTitle.internal).toBe(true);
    expect((FfmpegPulseTitle as { deprecated?: unknown }).deprecated).toBeUndefined();
    expect(FfmpegPulseTitle.tags).toEqual(expect.arrayContaining(["hero", "ffmpeg-pulse", "title"]));
  });
});

describe("FfmpegPulseTitle — renders at every aspect", () => {
  for (const [W, H, label] of ASPECTS) {
    describe(`${label} ${W}x${H}`, () => {
      it("renders valid m0; frames match sources; scatter pushed to a nested child", async () => {
        const doc = await render(W, H);
        expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
        const parsed = parseM0StringComplete(doc.m0 as unknown as string, W, H);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe(srcs(doc).length);
        // Baked scatter: the bg is a single flat video asset (not a nested tile
        // field), so the parent m0 is tiny and there are NO children.
        const children = (doc as { children?: Record<string, MosaicDocument> }).children;
        expect(children).toBeUndefined();
        const assets = (doc as { assets?: Record<string, unknown> }).assets ?? {};
        expect(assets.mHero).toBeTruthy();      // m0saic-M brand asset
        expect(assets.ffmpegLogo).toBeTruthy(); // FFmpeg logo asset
        expect(assets.scatterBg).toBeTruthy();  // baked per-aspect scatter video
        expect(srcs(doc).length).toBeLessThan(40);
        expect(doc.backgroundColor).toBe("#0d1117");
      });

      it("references a baked scatter video + carries the title copy", async () => {
        const doc = await render(W, H);
        const sc = (doc as { assets?: Record<string, { path?: string; mediaType?: string }> }).assets?.scatterBg;
        expect(sc?.mediaType).toBe("video");
        expect(String(sc?.path ?? "")).toMatch(/scatter-(desktop|square|mobile)\.mp4$/);
        const t = texts(doc);
        expect(t).toEqual(expect.arrayContaining(["WEEKLY PULSE", "FFmpeg", "m0saic.io", "WEEK 20"]));
        expect(t.some((s) => /May 12/.test(s))).toBe(true); // period label
      });

      it("static when reduceMotion (no fade alpha on any source)", async () => {
        const doc = await render(W, H, { anim: { introFrac: 0.55, reduceMotion: true } });
        const faded = srcs(doc).filter((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha);
        expect(faded.length).toBe(0);
      });
    });
  }

  it("is deterministic — identical output for identical inputs", async () => {
    const a = await render(1920, 1080);
    const b = await render(1920, 1080);
    expect(a.m0).toBe(b.m0);
    expect(srcs(a).length).toBe(srcs(b).length);
  });
});

type LayoutStamp = { ok: boolean; violations: Array<{ detail: string }>; constraintCount: number };
const layoutStamp = (doc: unknown): LayoutStamp | undefined =>
  (doc as { editor?: { layoutContract?: LayoutStamp } }).editor?.layoutContract;

describe("FfmpegPulseTitle — layout contract holds across resolutions", () => {
  const CANVASES: [number, number, string][] = [
    [1280, 720, "16:9 small"], [1920, 1080, "16:9"], [3840, 2160, "16:9 4K"],
    [540, 540, "1:1 small"], [1080, 1080, "1:1"],
    [720, 1280, "9:16 small"], [1080, 1920, "9:16"],
  ];
  for (const [W, H, label] of CANVASES) {
    it(`${label} ${W}x${H}: content column stays on-canvas`, async () => {
      const doc = await render(W, H, { debugLayout: true });
      const stamp = layoutStamp(doc);
      expect(stamp).toBeTruthy();
      expect(stamp!.constraintCount).toBe(1); // content-panel on-canvas (bespoke layout)
      expect(stamp!.violations.map((v) => v.detail)).toEqual([]);
      expect(stamp!.ok).toBe(true);
    });
  }
  it("the contract is a no-op unless debugLayout is set", async () => {
    expect(layoutStamp(await render(1920, 1080))).toBeUndefined();
  });
});
