import { validateM0String } from "@m0saic/dsl";
import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicLavfiSource,
  MosaicMosaicSource,
  MosaicRenderableFile,
  MosaicSource,
} from "@m0saic/types";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { makeM0saicTempPrefix } from "@m0saic/platform/paths";
import { QrRounded } from "./qr-rounded";

const QR_ROUNDED_ID = "@m0saic/media/qr/rounded/v1";

function makeCtx(
  overrides?: Partial<MosaicEngineContext["target"]> & { workspaceDir?: string },
): MosaicEngineContext & { cache?: any } {
  const ws =
    overrides?.workspaceDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), makeM0saicTempPrefix("qr-rounded-test")));
  return {
    mode: "render" as const,
    target: {
      width: 1080,
      height: 1080,
      fps: 30,
      durationMs: 2000,
      ...overrides,
    },
    output: {
      width: 1080,
      height: 1080,
      fps: 30,
      durationMs: 2000,
      workspaceDir: ws,
      ...overrides,
    },
    media: {},
    cache: {
      get: () => undefined,
      set: () => {},
      getOrCompute: async (_k: string, fn: () => any) => fn(),
    } as any,
  };
}

function asDocument(file: MosaicRenderableFile): MosaicDocument {
  expect(file.kind).toBe("mosaic_document");
  return file as MosaicDocument;
}

function asLavfi(src: MosaicSource): MosaicLavfiSource {
  expect(src.type).toBe("lavfi");
  return src as MosaicLavfiSource;
}

function asMosaicRef(src: MosaicSource): MosaicMosaicSource {
  expect(src.type).toBe("mosaic");
  return src as MosaicMosaicSource;
}

describe("QrRounded — template metadata", () => {
  it("has expected id, label, version", () => {
    expect(QrRounded.id).toBe(QR_ROUNDED_ID);
    expect(QrRounded.label).toBe("Brand QR — Rounded (v1, deprecated)");
    expect(QrRounded.version).toBe(1);
  });

  it("declares image output with rgba alpha", () => {
    expect(QrRounded.outputHints?.format).toEqual({
      kind: "image",
      container: "png",
      pixelFormat: "rgba",
    });
  });

  it("has propsSchema + defaults that cover the URL/colour/mode/shape knobs", () => {
    expect(QrRounded.propsSchema).toBeDefined();
    const D = QrRounded.defaultProps!;
    expect(D.text).toBe("https://www.m0saic.io");
    expect(D.mode).toBe("light");
    expect(D.moduleStyle).toBe("circle");
    expect(D.eyeOuterBorderRadius).toBe(0.3);
    expect(D.eyeInnerDotBorderRadius).toBe(0.5);
  });

  it("tagged brand + qr + rounded", () => {
    expect(QrRounded.tags).toContain("brand");
    expect(QrRounded.tags).toContain("qr");
    expect(QrRounded.tags).toContain("rounded");
  });
});

describe("QrRounded — render (no centre cutout)", () => {
  it("produces a valid mosaic document", async () => {
    const doc = asDocument(await QrRounded.render({}, makeCtx()));
    expect(validateM0String(String(doc.m0)).ok).toBe(true);
    expect((doc.sources ?? []).length).toBeGreaterThan(0);
  });

  it("bakes the 3-layer eye visual inline (9 color tiles for 3 eyes)", async () => {
    const doc = asDocument(await QrRounded.render({}, makeCtx()));
    // No mosaic refs to a qr-eye child in the new model — eye visuals
    // are spliced inline by qrToRenderable's `eyes: { ... }` option.
    const sources = doc.sources ?? [];
    const eyeRefs = sources.filter(
      (s) => s.type === "mosaic" && (s as MosaicMosaicSource).ref === "qr-eye",
    );
    expect(eyeRefs).toHaveLength(0);

    // The eye block lives in the final 9 sources (3 per finder pattern):
    // [outer dark rounded, inner light ring, centre dot circle] × 3.
    const eyeBlock = sources.slice(-9) as MosaicLavfiSource[];
    expect(eyeBlock).toHaveLength(9);
    for (let i = 0; i < 3; i++) {
      const outer = asLavfi(eyeBlock[i * 3 + 0]);
      const inner = asLavfi(eyeBlock[i * 3 + 1]);
      const dot = asLavfi(eyeBlock[i * 3 + 2]);
      expect(outer.color).toBe("#f97316"); // brand orange (dark colour)
      expect(inner.color).toBe("#ffffff"); // background colour for the ring
      expect(dot.color).toBe("#f97316");
      // Outer + dot get the configured radii from the template props.
      expect(outer.effects?.rounding?.borderRadius).toBe(0.3);
      expect(dot.effects?.rounding?.borderRadius).toBe(0.5);
    }
  });

  it("no qr-eye child in children — eye visual is inlined", async () => {
    const doc = asDocument(await QrRounded.render({}, makeCtx()));
    expect(doc.children?.["qr-eye"]).toBeUndefined();
  });

  it("every data-cell source (excluding eye block) is a lavfi tile with rounding applied", async () => {
    const doc = asDocument(await QrRounded.render({}, makeCtx()));
    // Last 9 are the inlined eye block; everything before is data cells.
    const dataSources = (doc.sources ?? []).slice(0, -9) as MosaicLavfiSource[];
    expect(dataSources.length).toBeGreaterThan(100);
    for (const s of dataSources) {
      const tile = asLavfi(s);
      expect(tile.color).toBe("#f97316");
      expect(tile.effects?.rounding?.borderRadius).toBe(1.0);
      expect(tile.effects?.rounding?.cornerStyle).toBe("rounded");
    }
  });

  it("moduleStyle='roundedSquare' uses borderRadius 0.3 instead of 1.0", async () => {
    const doc = asDocument(
      await QrRounded.render({ moduleStyle: "roundedSquare" }, makeCtx()),
    );
    const dataSources = (doc.sources ?? []).slice(0, -9) as MosaicLavfiSource[];
    for (const s of dataSources) {
      expect(asLavfi(s).effects?.rounding?.borderRadius).toBe(0.3);
    }
  });

  it("moduleBorderRadius override wins over the moduleStyle default", async () => {
    const doc = asDocument(
      await QrRounded.render(
        { moduleStyle: "circle", moduleBorderRadius: 0.5 },
        makeCtx(),
      ),
    );
    const dataSources = (doc.sources ?? []).slice(0, -9) as MosaicLavfiSource[];
    for (const s of dataSources) {
      expect(asLavfi(s).effects?.rounding?.borderRadius).toBe(0.5);
    }
  });

  // `@1.0` suffix is applied by `solidBackground` so the bg stays opaque
  // on rgba PNG output (see solidBackground docs for the engine branch).
  it("mode=light sets a white backgroundColor with opaque-alpha suffix", async () => {
    const doc = asDocument(
      await QrRounded.render({ mode: "light" }, makeCtx()),
    );
    expect(doc.backgroundColor).toBe("#ffffff@1.0");
  });

  it("mode=dark sets a black backgroundColor with opaque-alpha suffix", async () => {
    const doc = asDocument(
      await QrRounded.render({ mode: "dark" }, makeCtx()),
    );
    expect(doc.backgroundColor).toBe("#000000@1.0");
  });

  it("mode=transparent omits backgroundColor", async () => {
    const doc = asDocument(
      await QrRounded.render({ mode: "transparent" }, makeCtx()),
    );
    expect(doc.backgroundColor).toBeUndefined();
  });

  it("backgroundColor prop override also carries the opaque-alpha suffix", async () => {
    const doc = asDocument(
      await QrRounded.render(
        { mode: "light", backgroundColor: "#abcdef" },
        makeCtx(),
      ),
    );
    expect(doc.backgroundColor).toBe("#abcdef@1.0");
  });
});

describe("QrRounded — render (with centre cutout)", () => {
  // Use a real path that exists; the test only checks structure, not file IO.
  const IMAGE_PATH = "/tmp/qr-rounded-test-image.png";

  beforeAll(() => {
    // Touch a placeholder file so determineMediaType doesn't choke on a
    // missing path — we don't actually render the asset in this test.
    if (!fs.existsSync(IMAGE_PATH)) fs.writeFileSync(IMAGE_PATH, "");
  });

  it("emits a centre child doc and a mosaic ref to it", async () => {
    const doc = asDocument(
      await QrRounded.render({ centerAssetPath: IMAGE_PATH }, makeCtx()),
    );
    expect(doc.children!.center).toBeDefined();
    const refs = (doc.sources ?? []).filter((s) => s.type === "mosaic") as MosaicMosaicSource[];
    // Eye visual is inlined now — only the centre ref is a mosaic source.
    expect(refs).toHaveLength(1);
    expect(refs[0].ref).toBe("center");
  });

  it("centre child carries the user-supplied media", async () => {
    const doc = asDocument(
      await QrRounded.render({ centerAssetPath: IMAGE_PATH }, makeCtx()),
    );
    const centerChild = doc.children!.center as MosaicDocument;
    expect(centerChild.assets).toBeDefined();
    expect(Object.keys(centerChild.assets!).length).toBe(1);
  });

  // Helper: the m0 base layer always starts with `N[...]` where N is the
  // total matrix size (data matrix + 2×quietZone). For QZ=4: V1 → 29,
  // V6 → 49, V10 → 65. Reading the prefix tells us the version that the
  // QR encoder picked.
  function matrixSizeFromM0(m0: string): number {
    const match = m0.match(/^(\d+)\[/);
    if (!match) throw new Error(`m0 doesn't start with a row container: ${m0.slice(0, 60)}`);
    return Number(match[1]);
  }

  it("cutout forces minimum QR version ≥6 for scannability headroom", async () => {
    // Short URL would auto-pick V1 without the floor.
    const withCutout = asDocument(
      await QrRounded.render({ centerAssetPath: IMAGE_PATH, text: "hi" }, makeCtx()),
    );
    const noCutout = asDocument(
      await QrRounded.render({ text: "hi" }, makeCtx()),
    );
    // V6 + QZ 4 = 49 cells. V1 + QZ 4 = 29 cells.
    expect(matrixSizeFromM0(String(withCutout.m0))).toBe(49);
    expect(matrixSizeFromM0(String(noCutout.m0))).toBe(29);
  });

  it("caller-supplied version overrides the cutout floor", async () => {
    const v10 = asDocument(
      await QrRounded.render(
        { centerAssetPath: IMAGE_PATH, version: 10 },
        makeCtx(),
      ),
    );
    // V10 + QZ 4 = 65 cells (4*10+17 + 2*4).
    expect(matrixSizeFromM0(String(v10.m0))).toBe(65);
  });
});

describe("QrRounded — inline eye visual", () => {
  it("eye block sources reflect the configured corner radii (per finder)", async () => {
    const doc = asDocument(
      await QrRounded.render(
        { eyeOuterBorderRadius: 0.4, eyeInnerDotBorderRadius: 0.8 },
        makeCtx(),
      ),
    );
    // The last 9 sources are the inlined eye block (3 layers × 3 eyes).
    const eyeBlock = (doc.sources ?? []).slice(-9) as MosaicLavfiSource[];
    expect(eyeBlock).toHaveLength(9);
    for (let i = 0; i < 3; i++) {
      const outer = eyeBlock[i * 3 + 0];
      const inner = eyeBlock[i * 3 + 1];
      const dot = eyeBlock[i * 3 + 2];
      // Outer layer rounding matches outer prop.
      expect(outer.effects?.rounding?.borderRadius).toBe(0.4);
      // Inner light shares the outer radius for visual continuity.
      expect(inner.effects?.rounding?.borderRadius).toBe(0.4);
      // Centre dot rounding matches the inner-dot prop.
      expect(dot.effects?.rounding?.borderRadius).toBe(0.8);
    }
  });
});

describe("QrRounded — determinism", () => {
  it("identical inputs produce identical m0 + identical source shapes", async () => {
    const a = asDocument(await QrRounded.render({}, makeCtx()));
    const b = asDocument(await QrRounded.render({}, makeCtx()));
    expect(String(a.m0)).toBe(String(b.m0));
    expect((a.sources ?? []).length).toBe((b.sources ?? []).length);
  });
});
