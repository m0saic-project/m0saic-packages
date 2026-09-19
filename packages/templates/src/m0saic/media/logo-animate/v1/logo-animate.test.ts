import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicLavfiSource,
  MosaicRenderableFile,
  MosaicSource,
} from "@m0saic/types";
import { validateM0String } from "@m0saic/dsl";
import { queryFrames } from "@m0saic/dsl-stdlib";
import { makeM0saicTempPrefix } from "@m0saic/platform/paths";
import { LogoAnimateV1 } from "./logo-animate";
import { DEFAULT_LOGO_SVG } from "./default-logo";

const TEMPLATE_ID = "@m0saic/media/logo-animate/v1";

// Hand-authored mini SVG: 4 rects in a 2×2 pattern — hermetic, rectilinear.
const MINI_SVG = `<svg viewBox="0 0 10 10"><rect x="0" y="0" width="4" height="4"/><rect x="6" y="0" width="4" height="4"/><rect x="0" y="6" width="4" height="4"/><rect x="6" y="6" width="4" height="4"/></svg>`;

function makeCtx(
  overrides?: Partial<MosaicEngineContext["target"]> & {
    workspaceDir?: string;
  },
): MosaicEngineContext {
  const ws =
    overrides?.workspaceDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), makeM0saicTempPrefix("logo-animate-v1-test")));
  return {
    mode: "render" as const,
    target: {
      width: 1080,
      height: 1080,
      fps: 30,
      durationMs: 2520,
      ...overrides,
    },
    output: {
      width: 1080,
      height: 1080,
      fps: 30,
      durationMs: 2520,
      workspaceDir: ws,
      ...overrides,
    },
    media: {},
  };
}

/**
 * `doc.size === undefined` used to imply "this is the error/guidance path",
 * but `makeErrorMosaic` now stamps an explicit size, so the proxy is dead.
 * Assert the engine's own deterministic marker instead — the same one the UI
 * reads to disable Make.
 */
function isErrorMosaic(doc: MosaicDocument): boolean {
  return (doc.sources ?? []).some(
    (s) => (s as { engine?: { renderStatus?: string } }).engine?.renderStatus === "error",
  );
}

function asDocument(file: MosaicRenderableFile): MosaicDocument {
  expect(file.kind).toBe("mosaic_document");
  return file as MosaicDocument;
}

function getSources(doc: MosaicDocument): MosaicSource[] {
  return doc.sources ?? [];
}

describe(`${TEMPLATE_ID} — defaults (baked placeholder logo)`, () => {
  it("renders the placeholder mark standalone: one source per visible frame, valid branded m0", async () => {
    const doc = asDocument(await LogoAnimateV1.render({ ...LogoAnimateV1.defaultProps }, makeCtx()));
    expect(validateM0String(String(doc.m0)).ok).toBe(true);

    const frames = queryFrames(String(doc.m0), { width: 1080, height: 1080 }).logical();
    const sources = getSources(doc);
    // The placeholder M has 33 shapes → 33 visible tiles → 33 sources.
    expect(frames.length).toBe(33);
    expect(sources.length).toBe(frames.length);
    expect(sources.every((s) => s.type === "lavfi")).toBe(true);
  });

  it("joins silhouette masks by StableKey — the 8 non-rect shapes get inline masks", async () => {
    const doc = asDocument(await LogoAnimateV1.render({ ...LogoAnimateV1.defaultProps }, makeCtx()));
    const masked = getSources(doc).filter(
      (s) => (s as MosaicLavfiSource).mask?.kind === "inline-mask",
    );
    // mlogo_v2 fixture facts: 33 shapes, 25 pure rects (no mask needed),
    // 8 non-rectilinear silhouettes. A broken key-join yields 0 here.
    expect(masked.length).toBe(8);
    for (const s of masked) {
      const mask = (s as MosaicLavfiSource).mask!;
      if (mask.kind !== "inline-mask") continue;
      expect(mask.localPath.length).toBeGreaterThan(0);
      expect(mask.bounds.width).toBeGreaterThan(0);
      expect(mask.bounds.height).toBeGreaterThan(0);
    }
  });

  it("stamps resolved output values into the doc (size / fps / durationMs / background)", async () => {
    const doc = asDocument(
      await LogoAnimateV1.render({ ...LogoAnimateV1.defaultProps }, makeCtx({ durationMs: 4000 })),
    );
    expect(doc.size).toEqual({ width: 1080, height: 1080 });
    expect(doc.fps).toBe(30);
    expect(doc.durationMs).toBe(4000);
    expect(doc.backgroundColor).toBe("#ffffff"); // light preset
  });

  it("is deterministic — double render is JSON-identical", async () => {
    const a = await LogoAnimateV1.render({ svg: DEFAULT_LOGO_SVG, animation: "assemble" }, makeCtx());
    const b = await LogoAnimateV1.render({ svg: DEFAULT_LOGO_SVG, animation: "assemble" }, makeCtx());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe(`${TEMPLATE_ID} — sources`, () => {
  it("inline svg renders its rects as animated tiles", async () => {
    const doc = asDocument(await LogoAnimateV1.render({ svg: MINI_SVG }, makeCtx()));
    const sources = getSources(doc);
    expect(sources.length).toBe(4);
    const alphas = sources.map((s) => (s as MosaicLavfiSource).overlay?.alpha ?? "");
    expect(alphas.every((a) => typeof a === "string" && a.length > 0)).toBe(true);
  });

  it("rejects svg + svgPath together with an error mosaic", async () => {
    const doc = asDocument(
      await LogoAnimateV1.render({ svg: MINI_SVG, svgPath: "/tmp/nope.svg" }, makeCtx()),
    );
    expect(getSources(doc).length).toBeGreaterThan(0); // error card still renders
    expect(isErrorMosaic(doc)).toBe(true); // error path, not the logo path
  });

  it("unreadable svgPath returns an error mosaic (not a throw)", async () => {
    const doc = asDocument(
      await LogoAnimateV1.render(
        { svgPath: path.join(os.tmpdir(), "logo-animate-missing-fixture.svg") },
        makeCtx(),
      ),
    );
    expect(doc.kind).toBe("mosaic_document");
    expect(isErrorMosaic(doc)).toBe(true);
  });

  it("reads an SVG from disk when svgPath is provided", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), makeM0saicTempPrefix("logo-animate-svg")));
    const file = path.join(dir, "logo.svg");
    fs.writeFileSync(file, MINI_SVG, "utf8");
    const doc = asDocument(await LogoAnimateV1.render({ svgPath: file }, makeCtx()));
    expect(getSources(doc).length).toBe(4);
    expect(doc.size).toEqual({ width: 1080, height: 1080 });
  });

  it("shape-free svg returns an error mosaic with flatten guidance", async () => {
    const doc = asDocument(
      await LogoAnimateV1.render({ svg: `<svg viewBox="0 0 10 10"></svg>` }, makeCtx()),
    );
    expect(doc.kind).toBe("mosaic_document");
    expect(isErrorMosaic(doc)).toBe(true);
  });

  it("rejects out-of-range knobs", async () => {
    const bad = await LogoAnimateV1.render(
      { svg: MINI_SVG, driftPercent: 99, spawnDurMs: 1 },
      makeCtx(),
    );
    const doc = asDocument(bad);
    expect(isErrorMosaic(doc)).toBe(true);
  });
});

describe(`${TEMPLATE_ID} — animation modes`, () => {
  it.each([
    ["assemble", "alpha"],
    ["breathing", "alpha"],
    ["logo_loop", "enable"],
    ["progress_fill", "enable"],
    ["shimmer", "enable"],
  ] as const)("%s mode drives tiles via overlay.%s", async (animation, field) => {
    const doc = asDocument(await LogoAnimateV1.render({ svg: MINI_SVG, animation }, makeCtx()));
    const sources = getSources(doc) as MosaicLavfiSource[];
    expect(sources.length).toBe(4);
    for (const s of sources) {
      const value = s.overlay?.[field];
      expect(typeof value).toBe("string");
      expect((value as string).includes("t")).toBe(true);
    }
  });

  it("static progress renders a t-independent gate at frame 0", async () => {
    const doc = asDocument(
      await LogoAnimateV1.render(
        { svg: MINI_SVG, animation: "progress_fill", progress: 0.5 },
        makeCtx(),
      ),
    );
    const sources = getSources(doc) as MosaicLavfiSource[];
    // Static fill: no frame-0 wait gate (renders in single-image output).
    expect(sources.every((s) => !String(s.overlay?.enable).startsWith("gte(t,"))).toBe(true);
  });

  it.each(["scatter", "diag", "cascade", "radial"] as const)(
    "rankSet %s produces per-tile staggered expressions",
    async (rankSet) => {
      const doc = asDocument(await LogoAnimateV1.render({ svg: MINI_SVG, rankSet }, makeCtx()));
      const sources = getSources(doc) as MosaicLavfiSource[];
      expect(sources.length).toBe(4);
      const alphas = new Set(sources.map((s) => s.overlay?.alpha));
      // 4 distinct ranks → 4 distinct spawn expressions.
      expect(alphas.size).toBe(4);
    },
  );
});

describe(`${TEMPLATE_ID} — aspect (fit)`, () => {
  it("contain on a wide canvas nests the logo as a size-declared child in a placeRect fit rect", async () => {
    const doc = asDocument(
      await LogoAnimateV1.render(
        { ...LogoAnimateV1.defaultProps, fit: "contain" },
        makeCtx({ width: 1920, height: 1080 }),
      ),
    );
    expect(validateM0String(String(doc.m0)).ok).toBe(true);
    // Parent: exactly one rendered frame (the centered square fit rect).
    const frames = queryFrames(String(doc.m0), { width: 1920, height: 1080 }).logical();
    expect(frames.length).toBe(1);
    expect(frames[0]!.width).toBe(1080);
    expect(frames[0]!.x).toBe(420);
    // One mosaic-ref source pointing at the child logo doc.
    expect(doc.sources).toHaveLength(1);
    expect(doc.sources![0]).toMatchObject({ type: "mosaic", ref: "logo" });
    const child = (doc.children as Record<string, MosaicDocument>).logo;
    expect(child.kind).toBe("mosaic_document");
    // Child MUST declare its size (the fit rect) or it stretches.
    expect(child.size).toEqual({ width: 1080, height: 1080 });
    expect(child.sources).toHaveLength(33);
    expect(doc.size).toEqual({ width: 1920, height: 1080 });
  });

  it("contain on an exact-fit canvas skips nesting (flat doc)", async () => {
    const doc = asDocument(
      await LogoAnimateV1.render({ ...LogoAnimateV1.defaultProps, fit: "contain" }, makeCtx()),
    );
    expect(doc.children).toBeUndefined();
    expect(doc.sources).toHaveLength(33);
  });

  it("fill stretches across any canvas without nesting", async () => {
    const doc = asDocument(
      await LogoAnimateV1.render(
        { ...LogoAnimateV1.defaultProps, fit: "fill" },
        makeCtx({ width: 1920, height: 1080 }),
      ),
    );
    expect(doc.children).toBeUndefined();
    expect(doc.sources).toHaveLength(33);
  });
});

describe(`${TEMPLATE_ID} — theming`, () => {
  it("dark preset retunes both ink and background", async () => {
    const light = asDocument(await LogoAnimateV1.render({ svg: MINI_SVG, preset: "light" }, makeCtx()));
    const dark = asDocument(await LogoAnimateV1.render({ svg: MINI_SVG, preset: "dark" }, makeCtx()));
    expect(light.backgroundColor).toBe("#ffffff");
    expect(dark.backgroundColor).toBe("#0b0b0f");
    const lightInk = (getSources(light)[0] as MosaicLavfiSource).color;
    const darkInk = (getSources(dark)[0] as MosaicLavfiSource).color;
    expect(lightInk).toBe("#f97316");
    expect(darkInk).toBe("#fb923c");
    expect(lightInk).not.toBe(darkInk);
  });

  it("explicit color/backgroundColor override the preset; blank strings fall back", async () => {
    const doc = asDocument(
      await LogoAnimateV1.render(
        { svg: MINI_SVG, preset: "dark", color: "#123456", backgroundColor: "#654321" },
        makeCtx(),
      ),
    );
    expect(doc.backgroundColor).toBe("#654321");
    expect((getSources(doc)[0] as MosaicLavfiSource).color).toBe("#123456");

    const blank = asDocument(
      await LogoAnimateV1.render(
        {
          svg: MINI_SVG,
          preset: "dark",
          color: "" as MosaicColor,
          backgroundColor: "" as MosaicColor,
        },
        makeCtx(),
      ),
    );
    expect(blank.backgroundColor).toBe("#0b0b0f");
    expect((getSources(blank)[0] as MosaicLavfiSource).color).toBe("#fb923c");
  });
});

describe(`${TEMPLATE_ID} — bitmap mode + single-frame guard`, () => {
  // A single full-bleed shape → one cell → nothing to stagger.
  const SINGLE_SVG = `<svg viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10"/></svg>`;

  it("a single-shape SVG returns the guidance card (won't animate) in vector mode", async () => {
    const doc = asDocument(await LogoAnimateV1.render({ svg: SINGLE_SVG }, makeCtx()));
    expect(isErrorMosaic(doc)).toBe(true); // guidance card, not the animation path
  });

  it("bitmap mode rasterizes that same logo into many animatable pixel cells", async () => {
    const doc = asDocument(
      await LogoAnimateV1.render(
        { svg: SINGLE_SVG, bitmap: true, bitmapPrecision: "draft" },
        makeCtx(),
      ),
    );
    expect(doc.size).toEqual({ width: 1080, height: 1080 }); // real render, not the card
    expect(validateM0String(String(doc.m0)).ok).toBe(true);
    // The filled rect covers the whole grid → many solid tiles to animate.
    expect(getSources(doc).length).toBeGreaterThan(50);
  });

  it("bitmap mode is deterministic — double render is JSON-identical", async () => {
    const a = await LogoAnimateV1.render({ svg: MINI_SVG, bitmap: true, bitmapPrecision: "draft" }, makeCtx());
    const b = await LogoAnimateV1.render({ svg: MINI_SVG, bitmap: true, bitmapPrecision: "draft" }, makeCtx());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("rejects an invalid bitmapPrecision with an error card", async () => {
    const doc = asDocument(
      await LogoAnimateV1.render({ svg: MINI_SVG, bitmapPrecision: "mega" as never }, makeCtx()),
    );
    expect(isErrorMosaic(doc)).toBe(true);
  });
});

describe(`${TEMPLATE_ID} — preview faithfulness`, () => {
  // No renderLite stand-in: the geometry render is cheap and reads the SVG
  // (inline OR from disk) directly, so the design-mode preview is faithful —
  // it shows the real logo, not a stub — matching media/watermark/v1. Do NOT
  // re-add a file-stubbing renderLite; it breaks "pick your logo → see it".
  it("exposes no renderLite stand-in (design preview uses the real render)", () => {
    expect(LogoAnimateV1.renderLite).toBeUndefined();
  });
});

describe(`${TEMPLATE_ID} — editor metadata`, () => {
  it("declares a poster time inside the hold phase (settled logo for the scrubber)", () => {
    const hints = LogoAnimateV1.outputHints!;
    const poster = hints.posterTimeMs!;
    const spawnEnd =
      LogoAnimateV1.defaultProps!.spawnDurMs! + LogoAnimateV1.defaultProps!.tileFadeMs!;
    const fadeOutStart = spawnEnd + LogoAnimateV1.defaultProps!.holdDurMs!;
    expect(poster).toBeGreaterThanOrEqual(spawnEnd);
    expect(poster).toBeLessThanOrEqual(fadeOutStart);
  });

  it("declares the fs.read capability (svgPath) and nothing broader", () => {
    expect(LogoAnimateV1.capabilities).toEqual({
      tier: "capability",
      caps: { fs: { read: true } },
    });
  });
});

describe("gate-21 additions: diag default, cover", () => {
  it("defaults: rankSet is diag; no mark prop (Brand Marks v3 owns the brand set)", () => {
    expect(LogoAnimateV1.defaultProps?.rankSet).toBe("diag");
    expect((LogoAnimateV1.defaultProps as Record<string, unknown>).mark).toBeUndefined();
    expect((LogoAnimateV1.propsSchema as Record<string, unknown>).mark).toBeUndefined();
  });

  it("cover: assembled static M INLINED FLAT (no children), deterministic, valid", async () => {
    const ctx = makeCtx();
    const a = (await LogoAnimateV1.renderCover!({}, ctx)) as MosaicDocument;
    const b = (await LogoAnimateV1.renderCover!({}, ctx)) as MosaicDocument;
    expect(a).toEqual(b);
    expect(validateM0String(String(a.m0)).ok).toBe(true);
    expect(a.children).toBeUndefined();
    // Mosaic-branding band (08-30): brand row + title, no conversation pane.
    const blob = JSON.stringify(a.sources);
    expect(blob).toContain("Logo Animate");
    expect(blob).not.toContain("START HERE");
    // Static: no source carries an overlay expression (t=0 blankness is the
    // whole reason the cover exists).
    for (const s of a.sources) {
      expect((s as { overlay?: unknown }).overlay).toBeUndefined();
    }
  });
});
