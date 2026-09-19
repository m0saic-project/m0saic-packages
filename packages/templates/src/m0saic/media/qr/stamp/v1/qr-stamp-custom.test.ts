import * as fs from "fs";
import { isValidM0String } from "@m0saic/dsl";
import * as os from "os";
import * as path from "path";
import type {
  LuminanceBucket,
  MosaicDocument,
  MosaicEngineContext,
  MosaicMosaicSource,
  MosaicRenderableFile,
} from "@m0saic/types";
import { makeM0saicTempPrefix } from "@m0saic/platform/paths";
import { resolvePropBindings } from "@m0saic/template-utils";
import { QrStampCustom } from "./qr-stamp-custom";

const TEMPLATE_ID = "@m0saic/media/qr/stamp/v1";

function makeCtx(
  overrides?: Partial<MosaicEngineContext["target"]> & { workspaceDir?: string },
): MosaicEngineContext {
  const ws =
    overrides?.workspaceDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), makeM0saicTempPrefix("qr-stamp-custom-test")));
  return {
    mode: "render" as const,
    target: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 3000,
      ...overrides,
    },
    output: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 3000,
      workspaceDir: ws,
      ...overrides,
    },
    media: {},
  };
}

function asDocument(f: MosaicRenderableFile): MosaicDocument {
  expect(f.kind).toBe("mosaic_document");
  return f as MosaicDocument;
}

function isErrorDoc(doc: MosaicDocument): boolean {
  return (
    (doc.sources ?? []).length === 1 &&
    "engine" in (doc.sources ?? [])[0] &&
    ((doc.sources ?? [])[0] as { engine?: { renderStatus?: string } }).engine
      ?.renderStatus === "error"
  );
}

const IMAGE_BASE = "/tmp/qr-stamp-custom-base.png";
const VIDEO_BASE = "/tmp/qr-stamp-custom-base.mp4";

const BUCKETS: LuminanceBucket[] = [
  { startMs: 0, endMs: 1500, avgLuma: 50 },
  { startMs: 1500, endMs: 3000, avgLuma: 200 },
];

describe("QrStampCustom — metadata", () => {
  it("has the expected id, label, version", () => {
    expect(QrStampCustom.id).toBe(TEMPLATE_ID);
    expect(QrStampCustom.label).toBe("QR Stamp");
    expect(QrStampCustom.version).toBe(1);
  });

  it("is tagged for discovery, promoted tier", () => {
    expect(QrStampCustom.tags).toContain("brand");
    expect(QrStampCustom.tags).toContain("qr");
    expect(QrStampCustom.tags).toContain("stamp");
    expect(QrStampCustom.internal).toBeFalsy();
    expect(QrStampCustom.deprecated).toBeUndefined();
  });
});

describe("QrStampCustom — render", () => {
  jest.setTimeout(20_000);

  it("returns an error mosaic when mediaPath is missing", async () => {
    const doc = asDocument(await QrStampCustom.render({}, makeCtx()));
    expect(isErrorDoc(doc)).toBe(true);
  });

  it("composes image base + adaptive QR stamps via stampQrOnMedia", async () => {
    const doc = asDocument(
      await QrStampCustom.render(
        {
          mediaPath: IMAGE_BASE,
          text: "https://m0saic.io",
          mode: "auto",
          luminanceBuckets: BUCKETS,
          animation: "none",
        },
        makeCtx(),
      ),
    );
    // Base media + 2 mosaic refs (light + dark).
    const sources = doc.sources ?? [];
    expect(sources[0]!.type).toBe("media");
    const stamps = sources.filter(
      (s): s is MosaicMosaicSource => s.type === "mosaic",
    );
    expect(stamps).toHaveLength(2);
    expect(doc.children?.qr_stamp_light).toBeDefined();
    expect(doc.children?.qr_stamp_dark).toBeDefined();
  });

  it("draws the QR Code template's look by default: circle modules, rounded eyes, the brand M carved in (founder, 2026-09-16)", async () => {
    const doc = asDocument(
      await QrStampCustom.render({ mediaPath: IMAGE_BASE, mode: "light", animation: "none" }, makeCtx()),
    );
    const kid = doc.children?.qr_stamp_light as MosaicDocument;
    const src = kid.sources as Array<{ type: string; ref?: string; effects?: { rounding?: { borderRadius?: number } } }>;
    expect(src[0].effects?.rounding?.borderRadius).toBe(1); // circle dots
    expect(src[src.length - 1]).toMatchObject({ type: "mosaic", ref: "center" });
    const center = kid.children?.center as MosaicDocument;
    expect(center).toBeDefined();
    expect(center.sources.length).toBe(33); // the brand M's 33 tiles
    expect(String(center.m0).length).toBeGreaterThan(100);
    expect(String(center.backgroundColor)).toMatch(/^#ffffff/i); // tones with the light card
  });

  it("moduleStyle square + centre off → the classic matrix, no centre", async () => {
    const doc = asDocument(
      await QrStampCustom.render({ mediaPath: IMAGE_BASE, mode: "dark", animation: "none", moduleStyle: "square", center: "off" }, makeCtx()),
    );
    const kid = doc.children?.qr_stamp_dark as MosaicDocument;
    const src = kid.sources as Array<{ type: string; effects?: { rounding?: { borderRadius?: number } } }>;
    expect(src[0].effects?.rounding?.borderRadius).toBe(0);
    expect(src.every((t) => t.type === "lavfi")).toBe(true);
    expect(kid.children).toBeUndefined();
  });

  it("centre asset carves the caller's own image in, contain-fit, in its own manifest — and refuses to run without one", async () => {
    const doc = asDocument(
      await QrStampCustom.render({ mediaPath: IMAGE_BASE, mode: "light", animation: "none", center: "asset", centerAsset: IMAGE_BASE }, makeCtx()),
    );
    const kid = doc.children?.qr_stamp_light as MosaicDocument;
    const center = kid.children?.center as MosaicDocument;
    expect(center).toBeDefined();
    expect(["F", "1"]).toContain(String(center.m0)); // one cell (canonical form is "1")
    const src = center.sources[0] as { type: string; mediaType?: string; placement?: { fit?: string } };
    expect(src.type).toBe("media");
    expect(src.mediaType).toBe("image");
    expect(src.placement?.fit).toBe("contain");
    expect(Object.values(center.assets ?? {}).some((a) => (a as { path?: string }).path === IMAGE_BASE)).toBe(true);
    expect(String(center.backgroundColor)).toMatch(/^#ffffff/i);
    // no asset picked → an error card that names the fix, not a silent plain code
    const missing = asDocument(await QrStampCustom.render({ mediaPath: IMAGE_BASE, mode: "light", animation: "none", center: "asset" }, makeCtx()));
    expect(isErrorDoc(missing)).toBe(true);
  });

  it("auto-detects video base assets via file extension", async () => {
    const doc = asDocument(
      await QrStampCustom.render(
        {
          mediaPath: VIDEO_BASE,
          mode: "light",
          animation: "none",
        },
        makeCtx(),
      ),
    );
    const baseSrc = (doc.sources ?? [])[0] as {
      type?: string;
      mediaType?: string;
    };
    expect(baseSrc.type).toBe("media");
    expect(baseSrc.mediaType).toBe("video");
  });

  it("mode=transparent gives the variant child no backgroundColor", async () => {
    const doc = asDocument(
      await QrStampCustom.render(
        {
          mediaPath: IMAGE_BASE,
          mode: "transparent",
          animation: "none",
        },
        makeCtx(),
      ),
    );
    const child = doc.children?.qr_stamp_transparent as MosaicDocument;
    expect(child).toBeDefined();
    expect(child.backgroundColor).toBeUndefined();
  });

  it("sizePct + marginPct propagate to the placement inset", async () => {
    const doc = asDocument(
      await QrStampCustom.render(
        {
          mediaPath: IMAGE_BASE,
          mode: "light",
          sizePct: 20,
          marginPct: 4,
          animation: "none",
        },
        makeCtx({ width: 1000, height: 1000 }),
      ),
    );
    const stamp = (doc.sources ?? []).find(
      (s): s is MosaicMosaicSource => s.type === "mosaic",
    )!;
    const inset = stamp.placement?.inset as
      | { right?: number; bottom?: number }
      | undefined;
    expect(inset?.right).toBeGreaterThan(0);
    expect(inset?.bottom).toBeGreaterThan(0);
  });

  it("deterministic — identical props produce identical m0 + alpha", async () => {
    const propsA = {
      mediaPath: IMAGE_BASE,
      text: "https://m0saic.io",
      mode: "auto" as const,
      luminanceBuckets: BUCKETS,
      animation: "none" as const,
    };
    const a = asDocument(await QrStampCustom.render(propsA, makeCtx()));
    const b = asDocument(await QrStampCustom.render(propsA, makeCtx()));
    expect(String(a.m0)).toBe(String(b.m0));
    const al = (a.sources ?? []).find(
      (s): s is MosaicMosaicSource =>
        s.type === "mosaic" && s.ref === "qr_stamp_light",
    )!;
    const bl = (b.sources ?? []).find(
      (s): s is MosaicMosaicSource =>
        s.type === "mosaic" && s.ref === "qr_stamp_light",
    )!;
    expect(al.overlay?.alpha).toBe(bl.overlay?.alpha);
  });
});

describe("QrStampCustom — auto mode probes its own luma (gate-23)", () => {
  jest.setTimeout(20_000);

  /** ctx with a probed 1920x1080 video base + a mock analysis surface. */
  function makeProbeCtx(result?: {
    buckets: LuminanceBucket[];
  }): MosaicEngineContext & { probe: jest.Mock } {
    const probe = jest.fn(async () => ({
      buckets: result?.buckets ?? BUCKETS,
      overallAvgLuma: 128,
      durationMs: 3000,
    }));
    const ctx = makeCtx() as MosaicEngineContext & { probe: jest.Mock };
    ctx.media = {
      [VIDEO_BASE]: {
        kind: "video",
        width: 1920,
        height: 1080,
        durationMs: 3000,
      },
    } as unknown as MosaicEngineContext["media"];
    ctx.analysis = { regionLuminance: probe };
    ctx.probe = probe;
    return ctx;
  }

  /** What composeAlpha emits for the empty-buckets dark variant. */
  const DARK_OFF = "min(1,max(0,0.000))";

  function darkAlpha(doc: MosaicDocument): string | undefined {
    const dark = (doc.sources ?? []).find(
      (s): s is MosaicMosaicSource =>
        s.type === "mosaic" && s.ref === "qr_stamp_dark",
    );
    return dark?.overlay?.alpha;
  }

  it("auto + no buckets prop → probes the stamp corner and the dark variant becomes time-varying", async () => {
    const ctx = makeProbeCtx();
    const doc = asDocument(
      await QrStampCustom.render(
        { mediaPath: VIDEO_BASE, mode: "auto", animation: "none" },
        ctx,
      ),
    );
    expect(ctx.probe).toHaveBeenCalledTimes(1);
    const [mediaPath, region] = ctx.probe.mock.calls[0] as [
      string,
      { xPct: number; yPct: number; wPct: number; hPct: number },
    ];
    expect(mediaPath).toBe(VIDEO_BASE);
    // Default position br on a 1920x1080 canvas → region hugs the
    // bottom-right of the frame.
    expect(region.xPct + region.wPct).toBeGreaterThan(0.9);
    expect(region.yPct + region.hPct).toBeGreaterThan(0.9);
    expect(region.xPct).toBeGreaterThan(0.5);
    expect(region.yPct).toBeGreaterThan(0.5);
    // BUCKETS disagree (dark scene then light scene) → the dark card's
    // alpha is a real crossfade expr, not the constant-0 degenerate.
    expect(darkAlpha(doc)).toBeDefined();
    expect(darkAlpha(doc)).not.toBe(DARK_OFF);
    expect(darkAlpha(doc)).toContain("t-");
  });

  it("tl position probes the top-left corner", async () => {
    const ctx = makeProbeCtx();
    await QrStampCustom.render(
      { mediaPath: VIDEO_BASE, mode: "auto", position: "tl", animation: "none" },
      ctx,
    );
    const [, region] = ctx.probe.mock.calls[0] as [
      string,
      { xPct: number; yPct: number; wPct: number; hPct: number },
    ];
    expect(region.xPct).toBeLessThan(0.1);
    expect(region.yPct).toBeLessThan(0.1);
    expect(region.xPct + region.wPct).toBeLessThan(0.5);
    expect(region.yPct + region.hPct).toBeLessThan(0.5);
  });

  it("explicit luminanceBuckets prop wins — no probe", async () => {
    const ctx = makeProbeCtx();
    const doc = asDocument(
      await QrStampCustom.render(
        {
          mediaPath: VIDEO_BASE,
          mode: "auto",
          luminanceBuckets: BUCKETS,
          animation: "none",
        },
        ctx,
      ),
    );
    expect(ctx.probe).not.toHaveBeenCalled();
    expect(darkAlpha(doc)).not.toBe(DARK_OFF);
  });

  it("non-auto modes never probe (laziness guarantee)", async () => {
    for (const mode of ["light", "dark", "transparent"] as const) {
      const ctx = makeProbeCtx();
      await QrStampCustom.render(
        { mediaPath: VIDEO_BASE, mode, animation: "none" },
        ctx,
      );
      expect(ctx.probe).not.toHaveBeenCalled();
    }
  });

  it("no analysis surface → degrades to the light-pinned constant (pre-probe behavior)", async () => {
    const ctx = makeProbeCtx();
    delete ctx.analysis;
    const doc = asDocument(
      await QrStampCustom.render(
        { mediaPath: VIDEO_BASE, mode: "auto", animation: "none" },
        ctx,
      ),
    );
    expect(darkAlpha(doc)).toBe(DARK_OFF);
  });

  it("a throwing probe never kills the render", async () => {
    const ctx = makeProbeCtx();
    ctx.probe.mockRejectedValueOnce(new Error("ffmpeg exploded"));
    const doc = asDocument(
      await QrStampCustom.render(
        { mediaPath: VIDEO_BASE, mode: "auto", animation: "none" },
        ctx,
      ),
    );
    expect(isErrorDoc(doc)).toBe(false);
    expect(darkAlpha(doc)).toBe(DARK_OFF);
  });
});

describe("QrStampCustom — first-open cover (mosaic-branding band)", () => {
  const coverCtx = {
    mode: "render" as const,
    target: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    output: { width: 1920, height: 1080, fps: 30, durationMs: 3000 },
    media: {},
  } as unknown as MosaicEngineContext;

  it("brand band + real-material hero, valid and deterministic", async () => {
    expect(typeof QrStampCustom.renderCover).toBe("function");
    const a = (await QrStampCustom.renderCover!({} as never, coverCtx)) as MosaicDocument;
    const b = (await QrStampCustom.renderCover!({} as never, coverCtx)) as MosaicDocument;
    expect(isValidM0String(String(a.m0))).toBe(true);
    const s = JSON.stringify(a.sources);
    expect(s).toContain("QR Stamp");
    expect(s).not.toContain("START HERE");
    expect(a.m0).toBe(b.m0);
    // First cover ever — the default open must NOT be the error card.
    expect(s).not.toContain("mediaPath prop is required");
  });
});

describe("QrStampCustom — prop bindings (Make inline edit)", () => {
  jest.setTimeout(20_000);
  const schema = QrStampCustom.propsSchema;
  const bindingsOf = (doc: MosaicDocument) => resolvePropBindings(doc, 1920, 1080, { propsSchema: schema });

  it("light mode: the ONE parent QR rect (mosaic ref) binds `text`; the module tiles inside stay unbound", async () => {
    const doc = asDocument(
      await QrStampCustom.render({ mediaPath: IMAGE_BASE, mode: "light", animation: "none" }, makeCtx()),
    );
    const r = bindingsOf(doc);
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.byProp)).toEqual(["text"]);
    expect(r.byProp.text).toHaveLength(1);
    const b = r.byProp.text[0];
    expect("index" in b).toBe(false);
    expect(b.childPath).toEqual([]);
    expect((doc.sources[b.sourceIndex] as MosaicMosaicSource).ref).toBe("qr_stamp_light");
    // the child's module grid carries no bindings (only the parent rect resolved)
    expect(r.byProp.text.every((x) => x.childPath.length === 0)).toBe(true);
  });

  it("auto mode: one binding per variant rect (light + dark), both on the root", async () => {
    const doc = asDocument(
      await QrStampCustom.render(
        { mediaPath: IMAGE_BASE, text: "https://m0saic.io", mode: "auto", luminanceBuckets: BUCKETS, animation: "none" },
        makeCtx(),
      ),
    );
    const r = bindingsOf(doc);
    expect(r.rejected).toEqual([]);
    expect(r.byProp.text.map((b) => (doc.sources[b.sourceIndex] as MosaicMosaicSource).ref)).toEqual([
      "qr_stamp_light",
      "qr_stamp_dark",
    ]);
    for (const b of r.byProp.text) expect(b.childPath).toEqual([]);
  });

  it("the first-open cover is not bound", async () => {
    const cover = (await QrStampCustom.renderCover!({} as never, makeCtx())) as MosaicDocument;
    expect(resolvePropBindings(cover, 1920, 1080, { propsSchema: schema }).byProp).toEqual({});
  });
});
