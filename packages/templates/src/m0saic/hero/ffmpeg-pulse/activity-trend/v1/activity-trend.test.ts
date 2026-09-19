import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete } from "@m0saic/dsl";
import { FfmpegPulseActivityTrend } from "./activity-trend";
import "../../../../alpine/line-chart/v1"; // side-effect: register the nested chart
import "../../../../alpine/stat-card/v1"; //  side-effect: register the nested rail cards

const ASPECTS: [number, number, string][] = [
  [1920, 1080, "desktop"],
  [1080, 1080, "square"],
  [1080, 1920, "mobile"],
];

function makeCtx(W: number, H: number, durationMs = 9000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: W, height: H, fps: 30, durationMs },
    output: { width: W, height: H, fps: 30, durationMs, workspaceDir: "/tmp/activity-trend" },
    media: {},
  } as unknown as MosaicEngineContext;
}
const render = (W: number, H: number, props: Record<string, unknown> = {}) =>
  FfmpegPulseActivityTrend.render({ ...(FfmpegPulseActivityTrend.defaultProps as object), ...props } as never, makeCtx(W, H)) as Promise<MosaicDocument>;

const srcs = (doc: MosaicDocument) => (doc.sources ?? []) as MosaicSource[];
const texts = (doc: MosaicDocument) =>
  srcs(doc)
    .filter((s) => (s as { type?: string }).type === "text")
    .flatMap((s) => ((s as { layers?: Array<{ content?: { text?: string } }> }).layers ?? []).map((l) => l.content?.text ?? ""));
const childKeys = (doc: MosaicDocument) => Object.keys((doc as { children?: Record<string, unknown> }).children ?? {}).sort();

describe("FfmpegPulseActivityTrend — metadata", () => {
  it("is the registered internal Activity Trend beat", () => {
    expect(FfmpegPulseActivityTrend.id).toBe("@m0saic/hero/ffmpeg-pulse/activity-trend/v1");
    expect(FfmpegPulseActivityTrend.version).toBe(1);
    expect(FfmpegPulseActivityTrend.internal).toBe(true);
    expect((FfmpegPulseActivityTrend as { deprecated?: unknown }).deprecated).toBeUndefined();
    expect(FfmpegPulseActivityTrend.tags).toEqual(expect.arrayContaining(["hero", "ffmpeg-pulse", "activity-trend"]));
  });
});

describe("FfmpegPulseActivityTrend — renders at every aspect", () => {
  for (const [W, H, label] of ASPECTS) {
    it(`${label} ${W}x${H}: valid m0, nested chart + 4 rail tiles, header + footer copy`, async () => {
      const doc = await render(W, H);
      expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
      const parsed = parseM0StringComplete(doc.m0 as unknown as string, W, H);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe(srcs(doc).length);
      // One line chart + one stat card per derived rail tile (4).
      expect(childKeys(doc)).toEqual(["chart", "rail0", "rail1", "rail2", "rail3"]);
      const assets = (doc as { assets?: Record<string, unknown> }).assets ?? {};
      expect(assets.scatterBg).toBeTruthy();
      expect(assets.ffmpegLogo).toBeTruthy();
      const t = texts(doc);
      expect(t).toEqual(expect.arrayContaining(["ACTIVITY TREND", "BEAT 2"]));
      expect(t.some((s) => /WEEK 20/.test(s))).toBe(true);
      expect(doc.backgroundColor).toBe("#0d1117");
    });
  }

  it("static when reduceMotion (no fade alpha on chrome sources)", async () => {
    const doc = await render(1920, 1080, { anim: { introFrac: 0.7, reduceMotion: true } });
    const faded = srcs(doc).filter((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha);
    expect(faded.length).toBe(0);
  });

  it("is deterministic — identical m0 + children for identical inputs", async () => {
    const a = await render(1920, 1080);
    const b = await render(1920, 1080);
    expect(a.m0).toBe(b.m0);
    expect(childKeys(a)).toEqual(childKeys(b));
  });
});

type LayoutStamp = { ok: boolean; violations: Array<{ detail: string }>; constraintCount: number };
const layoutStamp = (doc: MosaicDocument): LayoutStamp | undefined =>
  (doc as { editor?: { layoutContract?: LayoutStamp } }).editor?.layoutContract;

describe("FfmpegPulseActivityTrend — layout contract holds across resolutions", () => {
  // Same three aspect families the envelope sweep uses, small→4K, so a chrome
  // regression (header/footer escaping its band, a panel drifting) trips CI.
  const CANVASES: [number, number, string][] = [
    [1280, 720, "16:9 small"],
    [1920, 1080, "16:9"],
    [3840, 2160, "16:9 4K"],
    [540, 540, "1:1 small"],
    [1080, 1080, "1:1"],
    [720, 1280, "9:16 small"],
    [1080, 1920, "9:16"],
  ];
  for (const [W, H, label] of CANVASES) {
    it(`${label} ${W}x${H}: chrome + chart/rail panels hold their canvas-fraction zones`, async () => {
      // debugLayout:true runs the contract and stamps editor.layoutContract; on a
      // violation the wrap swaps in a LAYOUT_CONTRACT error mosaic (stamp.ok=false).
      const doc = await render(W, H, { debugLayout: true });
      const stamp = layoutStamp(doc);
      expect(stamp).toBeTruthy();
      expect(stamp!.constraintCount).toBe(7); // 5 shared chrome + chart + rail
      expect(stamp!.violations.map((v) => v.detail)).toEqual([]);
      expect(stamp!.ok).toBe(true);
    });
  }

  it("the contract is a no-op unless debugLayout is set (production render untouched)", async () => {
    const doc = await render(1920, 1080);
    expect(layoutStamp(doc)).toBeUndefined();
  });
});
