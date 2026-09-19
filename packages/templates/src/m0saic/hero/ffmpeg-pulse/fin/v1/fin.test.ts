import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete } from "@m0saic/dsl";
import { FfmpegPulseFin } from "./fin";
import "../../../../alpine/stat-card/v1"; // side-effect: register the nested KPI cards

const ASPECTS: [number, number, string][] = [
  [1920, 1080, "desktop"],
  [1080, 1080, "square"],
  [1080, 1920, "mobile"],
];

function makeCtx(W: number, H: number, durationMs = 6000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: W, height: H, fps: 30, durationMs },
    output: { width: W, height: H, fps: 30, durationMs, workspaceDir: "/tmp/fin" },
    media: {},
  } as unknown as MosaicEngineContext;
}
const render = (W: number, H: number, props: Record<string, unknown> = {}) =>
  FfmpegPulseFin.render({ ...(FfmpegPulseFin.defaultProps as object), ...props } as never, makeCtx(W, H)) as Promise<MosaicDocument>;

const srcs = (doc: MosaicDocument) => (doc.sources ?? []) as MosaicSource[];
const texts = (doc: MosaicDocument) =>
  srcs(doc)
    .filter((s) => (s as { type?: string }).type === "text")
    .flatMap((s) => ((s as { layers?: Array<{ content?: { text?: string } }> }).layers ?? []).map((l) => l.content?.text ?? ""));
const childKeys = (doc: MosaicDocument) => Object.keys((doc as { children?: Record<string, unknown> }).children ?? {}).sort();

describe("FfmpegPulseFin — metadata", () => {
  it("is the registered internal Fin closing card", () => {
    expect(FfmpegPulseFin.id).toBe("@m0saic/hero/ffmpeg-pulse/fin/v1");
    expect(FfmpegPulseFin.version).toBe(1);
    expect(FfmpegPulseFin.internal).toBe(true);
    expect((FfmpegPulseFin as { deprecated?: unknown }).deprecated).toBeUndefined();
    expect(FfmpegPulseFin.tags).toEqual(expect.arrayContaining(["hero", "ffmpeg-pulse", "fin"]));
  });
});

describe("FfmpegPulseFin — renders at every aspect", () => {
  for (const [W, H, label] of ASPECTS) {
    it(`${label} ${W}x${H}: valid m0, KPI strip cards, baked QR asset, headline + attribution`, async () => {
      const doc = await render(W, H);
      expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
      const parsed = parseM0StringComplete(doc.m0 as unknown as string, W, H);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe(srcs(doc).length);
      // KPI strip = 4 nested stat-cards; the QR is a BAKED media asset (not a child).
      expect(childKeys(doc)).toEqual(["kpi0", "kpi1", "kpi2", "kpi3"]);
      const assets = (doc as { assets?: Record<string, unknown> }).assets ?? {};
      expect(assets.qrFin).toBeTruthy();
      expect(assets.scatterBg).toBeTruthy();
      const t = texts(doc);
      expect(t).toEqual(expect.arrayContaining(["THANK YOU!", "Built with m0saic", "m0saic.io"]));
      expect(doc.backgroundColor).toBe("#0d1117");
    });
  }

  it("references the baked QR as a media source (not a live nested QR)", async () => {
    const doc = await render(1920, 1080);
    const media = srcs(doc).filter((s) => (s as { type?: string }).type === "media");
    expect(media.some((s) => (s as { assetId?: string }).assetId === "qrFin")).toBe(true);
  });

  it("static when reduceMotion (no fade alpha on chrome sources)", async () => {
    const doc = await render(1920, 1080, { anim: { introFrac: 0.7, reduceMotion: true } });
    expect(srcs(doc).filter((s) => (s as { overlay?: { alpha?: string } }).overlay?.alpha).length).toBe(0);
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

describe("FfmpegPulseFin — layout contract holds across resolutions", () => {
  const CANVASES: [number, number, string][] = [
    [1280, 720, "16:9 small"], [1920, 1080, "16:9"], [3840, 2160, "16:9 4K"],
    [540, 540, "1:1 small"], [1080, 1080, "1:1"],
    [720, 1280, "9:16 small"], [1080, 1920, "9:16"],
  ];
  for (const [W, H, label] of CANVASES) {
    it(`${label} ${W}x${H}: centered content panel + footer hold their canvas-fraction zones`, async () => {
      const doc = await render(W, H, { debugLayout: true });
      const stamp = layoutStamp(doc);
      expect(stamp).toBeTruthy();
      expect(stamp!.constraintCount).toBe(2); // content + footer (fin has no header cluster)
      expect(stamp!.violations.map((v) => v.detail)).toEqual([]);
      expect(stamp!.ok).toBe(true);
    });
  }
  it("the contract is a no-op unless debugLayout is set", async () => {
    expect(layoutStamp(await render(1920, 1080))).toBeUndefined();
  });
});
