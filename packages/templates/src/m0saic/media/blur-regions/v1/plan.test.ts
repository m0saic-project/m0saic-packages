import {
  buildBlurRegionsDocument,
  buildBlurRegionsStep,
  evenRound,
  resolveBlurRegionsKnobs,
  stillContainer,
  DEFAULT_STRENGTH,
  IMAGE_STILL_MS,
} from "./plan";

const RECTS = [
  { x: 64, y: 48, w: 240, h: 160 },
  { x: 400, y: 300, w: 200, h: 120 },
];

describe("resolveBlurRegionsKnobs", () => {
  it("applies defaults", () => {
    expect(resolveBlurRegionsKnobs({})).toEqual({ mode: "blur", strength: DEFAULT_STRENGTH });
  });

  it("clamps blur sigma to 1..200", () => {
    expect(resolveBlurRegionsKnobs({ strength: 0 }).strength).toBe(1);
    expect(resolveBlurRegionsKnobs({ strength: 9999 }).strength).toBe(200);
    expect(resolveBlurRegionsKnobs({ strength: 12.6 }).strength).toBe(13);
  });

  it("clamps pixelate block to 2..128", () => {
    expect(resolveBlurRegionsKnobs({ mode: "pixelate", strength: 1 }).strength).toBe(2);
    expect(resolveBlurRegionsKnobs({ mode: "pixelate", strength: 500 }).strength).toBe(128);
    expect(resolveBlurRegionsKnobs({ mode: "pixelate" })).toEqual({
      mode: "pixelate",
      strength: DEFAULT_STRENGTH,
    });
  });
});

describe("evenRound", () => {
  it("rounds to the nearest even integer, min 2", () => {
    expect(evenRound(1279.6)).toBe(1280);
    expect(evenRound(721)).toBe(722);
    expect(evenRound(1)).toBe(2);
  });
});

describe("buildBlurRegionsDocument — geometry: mask", () => {
  const args = {
    inputPath: "/abs/media/hero_1.mp4",
    mediaType: "video" as const,
    size: { width: 1280, height: 720 },
    rectsPx: RECTS,
    knobs: { mode: "blur" as const, strength: 24 },
    geometry: "mask" as const,
  };

  it("builds the two-source overlay document with the golden mask path", () => {
    const doc = buildBlurRegionsDocument(args);
    expect(doc.kind).toBe("mosaic_document");
    expect(doc.m0).toBe("1{1}"); // canonical form of "F{F}"
    expect(doc.size).toEqual({ width: 1280, height: 720 });
    expect(Object.keys(doc.assets)).toHaveLength(1);

    expect(doc.sources).toHaveLength(2);
    const [base, overlay] = doc.sources.map((s) => s as Record<string, any>);
    expect(base.type).toBe("media");
    expect(base.audio).toBeUndefined(); // passthrough — audio follows the source
    expect(base.effects).toBeUndefined();
    expect(base.mask).toBeUndefined();

    expect(overlay.assetId).toBe(base.assetId); // SAME asset, blurred copy
    expect(overlay.audio).toEqual({ enabled: false });
    expect(overlay.effects).toEqual({ blur: 24 });
    expect(overlay.mask).toEqual({
      kind: "inline-mask",
      localPath: "M64 48H304V208H64Z M400 300H600V420H400Z",
      bounds: { x: 0, y: 0, width: 1280, height: 720 },
    });
  });

  it("pixelate mode swaps the effect knob", () => {
    const doc = buildBlurRegionsDocument({
      ...args,
      knobs: { mode: "pixelate", strength: 20 },
    });
    const overlay = doc.sources[1] as Record<string, any>;
    expect(overlay.effects).toEqual({ pixelize: 20 });
    expect(overlay.effects.blur).toBeUndefined();
  });

  it("image inputs carry the image mediaType and no audio field", () => {
    const doc = buildBlurRegionsDocument({ ...args, mediaType: "image" });
    const [base, overlay] = doc.sources.map((s) => s as Record<string, any>);
    expect(base.mediaType).toBe("image");
    expect(overlay.mediaType).toBe("image");
    expect(overlay.audio).toBeUndefined(); // images have no track to disable
    const asset = Object.values(doc.assets)[0] as Record<string, any>;
    expect(asset.mediaType).toBe("image");
  });

  it("zero rects emits the single-cell base document (drawing base case)", () => {
    const doc = buildBlurRegionsDocument({ ...args, rectsPx: [] });
    expect(doc.m0).toBe("1"); // canonical "F" — no overlay layer
    expect(doc.sources).toHaveLength(1);
    const base = doc.sources[0] as Record<string, any>;
    expect(base.mask).toBeUndefined();
    expect(base.effects).toBeUndefined();
    expect(doc.size).toEqual({ width: 1280, height: 720 });
  });

  it("is deterministic: identical args produce deep-equal documents", () => {
    expect(buildBlurRegionsDocument(args)).toEqual(buildBlurRegionsDocument(args));
  });
});

describe("buildBlurRegionsDocument — real geometry (inset default / exact)", () => {
  const args = {
    inputPath: "/abs/media/hero_1.mp4",
    mediaType: "video" as const,
    size: { width: 1280, height: 720 },
    rectsPx: RECTS,
    knobs: { mode: "blur" as const, strength: 24 },
  };

  it("inset: region cells are real m0, sources are frame-aligned windowed copies", () => {
    const doc = buildBlurRegionsDocument({ ...args, geometry: "inset" });
    expect(doc.kind).toBe("mosaic_document");
    expect(doc.sources).toHaveLength(3); // base + 2 region cells
    const sources = doc.sources.map((s) => s as Record<string, any>);
    const base = sources.find((s) => s.editor?.label === "blur-regions:base")!;
    expect(base.effects).toBeUndefined();
    expect(base.mask).toBeUndefined();
    expect(base.placement?.sourceRect).toBeUndefined();
    const regions = sources.filter((s) => s.editor?.label === "blur-regions:region");
    expect(regions).toHaveLength(2);
    // Each region cell declares the EXACT source window it shows —
    // placement.sourceRect equals the drawn rect (canvas ≡ source dims).
    const windows = regions.map((r) => r.placement?.sourceRect);
    expect(windows).toEqual(expect.arrayContaining(RECTS));
    for (const r of regions) {
      expect(r.mask).toBeUndefined(); // geometry, not mask
      expect(r.effects).toEqual({ blur: 24 }); // no camera machinery
      expect(r.placement?.fit).toBe("cover"); // same-size window ⇒ 1:1
      expect(r.audio).toEqual({ enabled: false });
    }
    // At least one hand-drawn rect needs inset recovery on this lattice.
    expect(regions.some((r) => r.placement?.inset != null)).toBe(true);
  });

  it("inset m0 is dramatically shorter than exact for precision-PINNED rects", () => {
    // Coprime-ish hand-drawn coords (the realistic draw output) — the
    // gcd-friendly RECTS above don't show the gap (exact is tiny there).
    const pinned = [
      { x: 55, y: 86, w: 743, h: 517 },
      { x: 861, y: 301, w: 301, h: 203 },
    ];
    const inset = buildBlurRegionsDocument({ ...args, rectsPx: pinned, geometry: "inset" });
    const exact = buildBlurRegionsDocument({ ...args, rectsPx: pinned, geometry: "exact" });
    expect(inset.m0.length).toBeLessThan(exact.m0.length / 5);
    // Exact places precisely — no recovery insets.
    for (const s of exact.sources.map((x) => x as Record<string, any>)) {
      expect(s.placement?.inset).toBeUndefined();
    }
    expect(exact.sources).toHaveLength(3);
  });

  it("both real-geometry flavors are deterministic", () => {
    for (const geometry of ["inset", "exact"] as const) {
      expect(buildBlurRegionsDocument({ ...args, geometry })).toEqual(
        buildBlurRegionsDocument({ ...args, geometry }),
      );
    }
  });
});

describe("buildBlurRegionsStep", () => {
  const stepArgs = {
    inputPath: "/abs/media/hero_1.mp4",
    stepBaseName: "hero_1",
    mediaType: "video" as const,
    size: { width: 1280, height: 720 },
    durationMs: 5730,
    rectsPx: RECTS,
    knobs: { mode: "blur" as const, strength: 24 },
    geometry: "mask" as const,
  };

  it("video: probed duration, mp4 per-step format (inert under single-emit)", () => {
    const step = buildBlurRegionsStep(stepArgs);
    expect(step.name).toBe("hero_1");
    expect(step.label).toBe("hero_1");
    expect(step.durationMs).toBe(5730);
    const file = step.file as Record<string, any>;
    expect(file.format).toEqual({ kind: "video", container: "mp4" });
    expect(file.size).toEqual({ width: 1280, height: 720 });
  });

  it("image: single-frame duration and matched still container", () => {
    const step = buildBlurRegionsStep({
      ...stepArgs,
      inputPath: "/abs/media/poster.jpg",
      mediaType: "image",
      durationMs: undefined,
    });
    expect(step.durationMs).toBe(IMAGE_STILL_MS);
    expect((step.file as Record<string, any>).format).toEqual({
      kind: "image",
      container: "jpeg",
    });
  });
});

describe("stillContainer", () => {
  it("matches jpeg inputs, defaults to png", () => {
    expect(stillContainer("/a/b.jpg")).toBe("jpeg");
    expect(stillContainer("/a/b.JPEG")).toBe("jpeg");
    expect(stillContainer("/a/b.png")).toBe("png");
    expect(stillContainer("/a/b.webp")).toBe("png");
  });
});
