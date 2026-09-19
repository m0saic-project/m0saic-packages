import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete } from "@m0saic/dsl";
import { FfmpegPulseKpiOverview } from "./kpi-overview";
import "../../../../alpine/stat-card/v1"; // side-effect: register the nested stat-card

const ASPECTS: [number, number, string][] = [
  [1920, 1080, "desktop"],
  [1080, 1080, "square"],
  [1080, 1920, "mobile"],
];

function makeCtx(W: number, H: number, durationMs = 9000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: W, height: H, fps: 30, durationMs },
    output: { width: W, height: H, fps: 30, durationMs, workspaceDir: "/tmp/kpi-overview" },
    media: {},
  } as unknown as MosaicEngineContext;
}
const render = (W: number, H: number, props: Record<string, unknown> = {}) =>
  FfmpegPulseKpiOverview.render({ ...(FfmpegPulseKpiOverview.defaultProps as object), ...props } as never, makeCtx(W, H)) as Promise<MosaicDocument>;

const srcs = (doc: MosaicDocument) => (doc.sources ?? []) as MosaicSource[];
const texts = (doc: MosaicDocument) =>
  srcs(doc)
    .filter((s) => (s as { type?: string }).type === "text")
    .flatMap((s) => ((s as { layers?: Array<{ content?: { text?: string } }> }).layers ?? []).map((l) => l.content?.text ?? ""));
const childKeys = (doc: MosaicDocument) => Object.keys((doc as { children?: Record<string, unknown> }).children ?? {}).sort();

describe("FfmpegPulseKpiOverview — metadata", () => {
  it("is the registered internal KPI Overview beat", () => {
    expect(FfmpegPulseKpiOverview.id).toBe("@m0saic/hero/ffmpeg-pulse/kpi-overview/v1");
    expect(FfmpegPulseKpiOverview.version).toBe(1);
    expect(FfmpegPulseKpiOverview.internal).toBe(true);
    expect((FfmpegPulseKpiOverview as { deprecated?: unknown }).deprecated).toBeUndefined();
    expect(FfmpegPulseKpiOverview.tags).toEqual(expect.arrayContaining(["hero", "ffmpeg-pulse", "kpi-overview"]));
  });
});

describe("FfmpegPulseKpiOverview — renders at every aspect", () => {
  for (const [W, H, label] of ASPECTS) {
    it(`${label} ${W}x${H}: valid m0, 8 nested KPI cards, header + footer copy`, async () => {
      const doc = await render(W, H);
      expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
      const parsed = parseM0StringComplete(doc.m0 as unknown as string, W, H);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe(srcs(doc).length);
      // One nested stat-card per KPI (mock ships 8).
      expect(childKeys(doc)).toEqual(["kpi0", "kpi1", "kpi2", "kpi3", "kpi4", "kpi5", "kpi6", "kpi7"]);
      // The scatter video + ffmpeg logo are beat-level assets.
      const assets = (doc as { assets?: Record<string, unknown> }).assets ?? {};
      expect(assets.scatterBg).toBeTruthy();
      expect(assets.ffmpegLogo).toBeTruthy();
      const t = texts(doc);
      expect(t).toEqual(expect.arrayContaining(["KPI OVERVIEW", "BEAT 1"]));
      expect(t.some((s) => /WEEK 20/.test(s))).toBe(true);
      expect(t.some((s) => /May 12/.test(s))).toBe(true);
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
const layoutStamp = (doc: unknown): LayoutStamp | undefined =>
  (doc as { editor?: { layoutContract?: LayoutStamp } }).editor?.layoutContract;

describe("FfmpegPulseKpiOverview — layout contract holds across resolutions", () => {
  const CANVASES: [number, number, string][] = [
    [1280, 720, "16:9 small"], [1920, 1080, "16:9"], [3840, 2160, "16:9 4K"],
    [540, 540, "1:1 small"], [1080, 1080, "1:1"],
    [720, 1280, "9:16 small"], [1080, 1920, "9:16"],
  ];
  for (const [W, H, label] of CANVASES) {
    it(`${label} ${W}x${H}: chrome + KPI grid panel hold their canvas-fraction zones`, async () => {
      const doc = await render(W, H, { debugLayout: true });
      const stamp = layoutStamp(doc);
      expect(stamp).toBeTruthy();
      expect(stamp!.constraintCount).toBe(6); // 5 shared chrome + grid
      expect(stamp!.violations.map((v) => v.detail)).toEqual([]);
      expect(stamp!.ok).toBe(true);
    });
  }
  it("the contract is a no-op unless debugLayout is set", async () => {
    expect(layoutStamp(await render(1920, 1080))).toBeUndefined();
  });
});
