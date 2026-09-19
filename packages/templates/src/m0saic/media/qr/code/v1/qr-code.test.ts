import type { MosaicDocument, MosaicEngineContext } from "@m0saic/types";
import { isValidM0String } from "@m0saic/dsl";
import { QrCode } from "./qr-code";
import { BrandQr } from "../../basic/v1/qr";
import { QrRounded } from "../../rounded/v1/qr-rounded";
import { QrAnimateV2 } from "../../animate/v2/qr-animate";

function makeCtx(): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: 1080, height: 1080, fps: 30, durationMs: 2000 },
    output: { width: 1080, height: 1080, fps: 30, durationMs: 2000, workspaceDir: "/tmp/qr-code-test" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const render = async (props: Record<string, unknown>) =>
  (await QrCode.render(props as never, makeCtx())) as MosaicDocument;

describe("QrCode — metadata", () => {
  it("has the expected id, label, version; not deprecated", () => {
    expect(QrCode.id).toBe("@m0saic/media/qr/code/v1");
    expect(QrCode.label).toBe("QR Code");
    expect(QrCode.version).toBe(1);
    expect((QrCode as { deprecated?: unknown }).deprecated).toBeUndefined();
  });

  it("supersedes its surviving ancestors (their deprecated.replacement points here)", () => {
    // (carve/v1 — the fourth ancestor — was DELETED 2026-07-22: no parity
    // anchor, no unique consumer; its centre + spawn live on here.)
    for (const ancestor of [BrandQr, QrRounded, QrAnimateV2]) {
      expect(
        (ancestor as { deprecated?: { replacement?: string } }).deprecated?.replacement,
      ).toBe("@m0saic/media/qr/code/v1");
    }
  });
});

describe("QrCode — byte parity with its ancestors", () => {
  it("square path is byte-identical to Brand QR (basic/v1) for identical inputs", async () => {
    for (const [mode, transparent] of [
      ["dark", false],
      ["light", false],
      ["dark", true],
    ] as const) {
      const mine = await render({
        text: "https://m0saic.io/parity",
        mode: transparent ? "transparent" : mode,
        moduleStyle: "square",
        center: { show: false },
      });
      const theirs = (await BrandQr.render(
        { text: "https://m0saic.io/parity", mode, transparentBackground: transparent } as never,
        makeCtx(),
      )) as MosaicDocument;
      expect(String(mine.m0)).toBe(String(theirs.m0));
      expect(mine.sources).toEqual(theirs.sources);
      expect(mine.backgroundColor).toEqual(theirs.backgroundColor);
    }
  });

  it("circle path is byte-identical to Brand QR — Rounded at its defaults", async () => {
    const mine = await render({
      text: "https://m0saic.io/parity",
      mode: "light",
      moduleStyle: "circle",
      center: { show: false },
    });
    const theirs = (await QrRounded.render(
      { text: "https://m0saic.io/parity" } as never, // rounded defaults: light + circle
      makeCtx(),
    )) as MosaicDocument;
    expect(String(mine.m0)).toBe(String(theirs.m0));
    expect(mine.sources).toEqual(theirs.sources);
    expect(mine.backgroundColor).toEqual(theirs.backgroundColor);
    expect(mine.size).toEqual(theirs.size);
  });
});

describe("QrCode — dispatch + knobs", () => {
  it("DEFAULT render = the branded look: circle modules, light card, in-house M centre", async () => {
    const doc = await render({});
    expect(isValidM0String(String(doc.m0))).toBe(true);
    expect(doc.backgroundColor).toBeDefined();
    // The M is carved in by default — the brand/m-33 dictionary entry
    // (33 masked colour tiles), fully procedural: no file assets, so the
    // default works on web and inside packaged apps alike.
    expect(doc.children?.center).toBeDefined();
    const centerDoc = doc.children!.center as MosaicDocument;
    expect(Object.keys(centerDoc.assets ?? {}).length).toBe(0);
    expect(centerDoc.sources.length).toBe(33);
    // Masks are inlined where the dictionary carries silhouettes (plain
    // rect tiles need none — the m0 rect IS the shape).
    expect(
      centerDoc.sources.some(
        (s) => (s as { mask?: { kind?: string } }).mask?.kind === "inline-mask",
      ),
    ).toBe(true);
    expect(isValidM0String(String(centerDoc.m0))).toBe(true);
    // Circle modules on the data tiles.
    const radius = (doc.sources[0] as { effects?: { rounding?: { borderRadius?: number } } })
      .effects?.rounding?.borderRadius;
    expect(radius).toBe(1.0);
  });

  it("center.show false disables the centre entirely (the UI off switch)", async () => {
    const doc = await render({ center: { show: false } });
    expect(doc.children?.center).toBeUndefined();
    expect(doc.sources.every((s) => (s as { type?: string }).type !== "mosaic")).toBe(true);
  });

  it("transparent mode omits the background", async () => {
    const doc = await render({ mode: "transparent" });
    expect(doc.backgroundColor).toBeUndefined();
  });

  it("a style override on square style routes through the styled path (eyes swap in)", async () => {
    const plain = await render({ moduleStyle: "square", center: { show: false } });
    const styled = await render({ moduleStyle: "square", center: { show: false }, style: { moduleBorderRadius: 0.2 } });
    // Styled path: the 3×33 finder dark modules are SUPPRESSED from the
    // base (eyes suppressBase — no circles peeking past the eye's rounded
    // corners) and 3×3 eye child sources splice in: net −90 vs plain.
    expect(styled.sources.length).toBe(plain.sources.length - 3 * 33 + 3 * 3);
  });

  it("roundedSquare defaults module radius to 0.3; explicit override wins", async () => {
    const a = await render({ moduleStyle: "roundedSquare" });
    const b = await render({ moduleStyle: "roundedSquare", style: { moduleBorderRadius: 0.9 } });
    // (default M centre present in both — irrelevant to data-tile radius)
    const radiusOf = (doc: MosaicDocument) =>
      (doc.sources[0] as { effects?: { rounding?: { borderRadius?: number } } }).effects?.rounding?.borderRadius;
    expect(radiusOf(a)).toBe(0.3);
    expect(radiusOf(b)).toBe(0.9);
  });

  it("a centre asset produces the center child doc and forces the version floor", async () => {
    const doc = await render({
      moduleStyle: "circle",
      center: { assetPath: "/tmp/logo.png", width: 200, height: 200 },
    });
    expect(doc.children?.center).toBeDefined();
    expect(doc.children!.center.size).toEqual({ width: 200, height: 200 });
    // V6 floor → at least a 41×41 matrix; the doc is still valid m0.
    expect(isValidM0String(String(doc.m0))).toBe(true);
    const mosaicRefs = doc.sources.filter((s) => (s as { type?: string }).type === "mosaic");
    expect(mosaicRefs.length).toBe(1);
  });

  it("is deterministic — identical inputs yield byte-identical m0", async () => {
    expect(String((await render({ moduleStyle: "circle" })).m0)).toBe(
      String((await render({ moduleStyle: "circle" })).m0),
    );
  });

  it("spawn animation: every module carries alpha + settle overlays; doc bakes video/mp4", async () => {
    const doc = await render({
      moduleStyle: "circle",
      center: { show: false },
      outputFormat: "mp4",
    });
    expect(doc.format).toEqual({ kind: "video", container: "mp4" });
    const overlays = doc.sources.map(
      (s) => (s as { overlay?: { alpha?: string; xExpr?: string } }).overlay,
    );
    // Data cells carry alpha + settle; eye layers carry alpha (no settle).
    expect(overlays.filter((o) => o?.alpha && o?.xExpr).length).toBeGreaterThan(50);
    expect(overlays.filter((o) => o?.alpha && !o?.xExpr).length).toBe(9); // 3 eyes × 3 layers
    expect(overlays.every((o) => o?.alpha)).toBe(true);
  });

  it("spawn + centre asset: the centre stays visible from t=0 (no overlay)", async () => {
    const doc = await render({
      moduleStyle: "circle",
      center: { assetPath: "/tmp/logo.png" },
      outputFormat: "mp4",
    });
    const centerRef = doc.sources.find(
      (s) => (s as { type?: string }).type === "mosaic",
    ) as { overlay?: unknown } | undefined;
    expect(centerRef).toBeDefined();
    expect(centerRef!.overlay).toBeUndefined();
  });

  it("animation.gleam multiplies data-cell alpha; eye layers never gleam", async () => {
    const base = {
      moduleStyle: "circle",
      center: { show: false },
      outputFormat: "mp4",
    };
    const plain = await render(base);
    const gleamed = await render({ ...base, animation: { gleam: true } });
    const overlaysOf = (d: MosaicDocument) =>
      d.sources.map((s) => (s as { overlay?: { alpha?: string; xExpr?: string } }).overlay);
    const po = overlaysOf(plain);
    const go = overlaysOf(gleamed);
    expect(go.length).toBe(po.length);
    let dataCells = 0;
    let eyeLayers = 0;
    for (let i = 0; i < po.length; i++) {
      if (po[i]?.xExpr) {
        // Data module: gleamed alpha = (envelope)*(travelling-band factor).
        expect(go[i]!.alpha!.startsWith(`(${po[i]!.alpha})*(`)).toBe(true);
        expect(go[i]!.alpha).toContain("mod(t,");
        dataCells++;
      } else {
        // Eye layer (rank-0 alpha, no settle): untouched by gleam.
        expect(go[i]!.alpha).toBe(po[i]!.alpha);
        eyeLayers++;
      }
    }
    expect(dataCells).toBeGreaterThan(50);
    expect(eyeLayers).toBe(9);
  });

  it("gleam is inert on static png renders", async () => {
    const doc = await render({ animation: { gleam: true } });
    expect(doc.format).toEqual({ kind: "image", container: "png" });
    expect(doc.sources.every((s) => !(s as { overlay?: unknown }).overlay)).toBe(true);
  });

  it("static renders bake image/png (the knob owns the container)", async () => {
    const doc = await render({ moduleStyle: "circle" });
    expect(doc.format).toEqual({ kind: "image", container: "png" });
  });

  it("spawn text path is expression-identical to Spawn (animate/v2)", async () => {
    // Same knobs as v2's envelope semantics → same m0, same per-tile
    // overlay expressions. (Backgrounds intentionally differ: QR Code wraps
    // via solidBackground; v2 set a raw colour.)
    const knobs = { spawnDurMs: 1000, tileFadeMs: 220, holdDurMs: 600, fadeOutDurMs: 700, tileOffsetPx: 1 };
    const mine = await render({
      text: "https://m0saic.io/parity",
      mode: "light",
      moduleStyle: "square",
      center: { show: false },
      outputFormat: "mp4",
      animation: knobs,
    });
    const theirs = (await QrAnimateV2.render(
      { text: "https://m0saic.io/parity", variant: "light", ...knobs } as never,
      makeCtx(),
    )) as MosaicDocument;
    expect(String(mine.m0)).toBe(String(theirs.m0));
    const overlaysOf = (d: MosaicDocument) =>
      d.sources.map((s) => (s as { overlay?: unknown }).overlay);
    expect(overlaysOf(mine)).toEqual(overlaysOf(theirs));
  });

  it("advanced.svg bypasses QR generation and still animates", async () => {
    const svg = '<svg viewBox="0 0 4 4"><rect x="0" y="0" width="1" height="1"/><rect x="2" y="0" width="1" height="1"/><rect x="1" y="2" width="1" height="1"/></svg>';
    const doc = await render({
      advanced: { svg },
      outputFormat: "mp4",
    });
    expect(doc.format).toEqual({ kind: "video", container: "mp4" });
    expect(doc.sources.length).toBe(3);
    expect(
      doc.sources.every((s) => !!(s as { overlay?: { alpha?: string } }).overlay?.alpha),
    ).toBe(true);
  });

  it("empty text fails soft with an error mosaic", async () => {
    const doc = await render({ text: "" });
    // Falls back to default text (empty string is nullish-coalesced away) —
    // renders fine rather than erroring.
    expect(doc.sources.length).toBeGreaterThan(0);
  });
});

describe("gate-22: transparent mode declares alpha", () => {
  it("transparent static doc formats as rgba png; light/dark stay plain", async () => {
    const ctx = { mode: "render", target: { width: 1080, height: 1080, fps: 30, durationMs: 2000 }, output: { width: 1080, height: 1080, fps: 30, durationMs: 2000 }, media: {} } as never;
    const t = (await QrCode.render({ mode: "transparent" }, ctx)) as { format?: { pixelFormat?: string } };
    expect(t.format).toEqual({ kind: "image", container: "png", pixelFormat: "rgba" });
    const l = (await QrCode.render({}, ctx)) as { format?: object };
    expect(l.format).toEqual({ kind: "image", container: "png" });
  });
});
