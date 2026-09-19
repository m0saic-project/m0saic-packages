import { parseM0StringToRenderFrames } from "@m0saic/dsl";
import { qrToRenderable } from "./qrToRenderable";

describe("qrToRenderable", () => {
  test("empty text throws", () => {
    expect(() =>
      qrToRenderable({ text: "", moduleColor: "#f97316" }),
    ).toThrow(/text.*required/);
    expect(() =>
      qrToRenderable({ text: "   ", moduleColor: "#f97316" }),
    ).toThrow(/text.*required/);
  });

  test("basic flow — every renderable frame gets exactly one source", () => {
    const r = qrToRenderable({
      text: "https://m0saic.io",
      moduleColor: "#f97316",
    });
    const frames = parseM0StringToRenderFrames(
      String(r.m0),
      r.canvasW,
      r.canvasH,
    );
    expect(frames.length).toBeGreaterThan(0);
    expect(r.sources.length).toBe(frames.length);
    // Every source is a lavfi color tile in the requested colour.
    for (const s of r.sources) {
      expect(s.type).toBe("lavfi");
      expect("color" in s ? s.color : undefined).toBe("#f97316");
    }
    // No safe-area metadata in default flow.
    expect(r.safeAreaBounds).toBeUndefined();
    expect(r.safeAreaStableKey).toBeUndefined();
  });

  test("source count stays in lockstep across ECC levels", () => {
    for (const ecc of ["L", "M", "Q", "H"] as const) {
      const r = qrToRenderable({
        text: "https://m0saic.io",
        moduleColor: "#000",
        errorCorrectionLevel: ecc,
      });
      const frames = parseM0StringToRenderFrames(
        String(r.m0),
        r.canvasW,
        r.canvasH,
      );
      expect(r.sources.length).toBe(frames.length);
    }
  });

  test("perCellOverlay attaches an overlay expression per cell", () => {
    const calls: Array<{ i: number; n: number }> = [];
    const r = qrToRenderable({
      text: "https://m0saic.io",
      moduleColor: "#f97316",
      perCellOverlay: (i, n) => {
        calls.push({ i, n });
        return { alpha: `min(1,t/${(i + 1) * 0.01})` };
      },
    });
    expect(calls.length).toBe(r.sources.length);
    expect(calls[0]).toEqual({ i: 0, n: r.sources.length });
    expect(calls[calls.length - 1]).toEqual({
      i: r.sources.length - 1,
      n: r.sources.length,
    });
    // Every source has an overlay attached.
    for (const s of r.sources) {
      expect(s.overlay?.alpha).toBeDefined();
    }
  });

  test("safe-area carve emits a splice key + bounds we can replace", () => {
    const r = qrToRenderable({
      text: "https://m0saic.io",
      moduleColor: "#f97316",
      errorCorrectionLevel: "H",
      version: 6,
      safeArea: { width: 272, height: 272 },
    });
    expect(r.safeAreaStableKey).toBeDefined();
    expect(r.safeAreaBounds).toEqual({
      x: expect.any(Number),
      y: expect.any(Number),
      width: 272,
      height: 272,
    });
    // Source count still matches the m0's frame count (the splice F
    // also gets a source slot — callers replace it before render).
    const frames = parseM0StringToRenderFrames(
      String(r.m0),
      r.canvasW,
      r.canvasH,
    );
    expect(r.sources.length).toBe(frames.length);
    // The exposed splice key is a non-empty string ready for
    // `replaceNodeByStableId` (the round-trip itself is exercised by
    // qrToM0.test.ts in dsl-stdlib).
    expect(typeof r.safeAreaStableKey).toBe("string");
    expect(String(r.safeAreaStableKey).length).toBeGreaterThan(0);
  });

  test("deterministic — identical inputs produce identical output", () => {
    const a = qrToRenderable({
      text: "https://m0saic.io",
      moduleColor: "#f97316",
      errorCorrectionLevel: "H",
    });
    const b = qrToRenderable({
      text: "https://m0saic.io",
      moduleColor: "#f97316",
      errorCorrectionLevel: "H",
    });
    expect(String(a.m0)).toBe(String(b.m0));
    expect(a.sources.length).toBe(b.sources.length);
    expect(a.canvasW).toBe(b.canvasW);
    expect(a.canvasH).toBe(b.canvasH);
  });
});

describe("qrToRenderable — channels pass-through", () => {
  test("default (no channels) → only data channel, empty labels", () => {
    const r = qrToRenderable({ text: "https://m0saic.io", moduleColor: "#f97316" });
    expect(r.channels).toHaveLength(1);
    expect(r.channels[0].channel).toBe("data");
    expect(Object.keys(r.labels)).toEqual([]);
  });

  test("eyes channel opted in → 3 eye frames exposed via channelByRole.eyes", () => {
    const r = qrToRenderable({
      text: "https://m0saic.io",
      moduleColor: "#f97316",
      channels: { eyes: true },
    });
    expect(r.channelByRole.eyes?.frames).toHaveLength(3);
    const labels = r.channelByRole.eyes!.frames.map((f) => r.labels[f.stableKey]);
    expect(labels).toEqual(["qr-eye-tl", "qr-eye-tr", "qr-eye-bl"]);
  });

  test("source count matches frame count when channels are opted in", () => {
    const r = qrToRenderable({
      text: "https://m0saic.io",
      moduleColor: "#f97316",
      channels: { eyes: true },
    });
    const frames = parseM0StringToRenderFrames(
      String(r.m0),
      r.canvasW,
      r.canvasH,
    );
    expect(r.sources.length).toBe(frames.length);
  });
});

describe("qrToRenderable — pack mode pass-through", () => {
  test("pack: true → fewer sources than default + data channel exposes packed rects", () => {
    const baseline = qrToRenderable({
      text: "https://m0saic.io",
      moduleColor: "#f97316",
    });
    const packed = qrToRenderable({
      text: "https://m0saic.io",
      moduleColor: "#f97316",
      pack: true,
    });
    expect(packed.sources.length).toBeLessThan(baseline.sources.length);
    expect(packed.channelByRole.data?.frames.length).toBeGreaterThan(0);
    // First few packed rects are labeled qr-pack-{i}.
    for (let i = 0; i < Math.min(3, packed.channelByRole.data!.frames.length); i++) {
      const frame = packed.channelByRole.data!.frames[i];
      expect(packed.labels[frame.stableKey]).toBe(`qr-pack-${i}`);
    }
  });

  test("pack + eyes combined: both work together", () => {
    const r = qrToRenderable({
      text: "https://m0saic.io",
      moduleColor: "#f97316",
      pack: true,
      channels: { eyes: true },
    });
    expect(r.channelByRole.eyes?.frames).toHaveLength(3);
    expect(r.channelByRole.data?.frames.length).toBeGreaterThan(0);
  });
});

describe("qrToRenderable — safeArea backwards-compat", () => {
  test("safeAreaBounds + safeAreaStableKey still populated AND mirrored in channelByRole.safeArea", () => {
    const r = qrToRenderable({
      text: "https://m0saic.io",
      moduleColor: "#f97316",
      errorCorrectionLevel: "H",
      version: 6,
      safeArea: { width: 272, height: 272 },
    });
    expect(r.safeAreaStableKey).toBeDefined();
    expect(r.safeAreaBounds).toBeDefined();
    expect(r.channelByRole.safeArea?.frames[0].stableKey).toBe(r.safeAreaStableKey);
    expect(r.channelByRole.safeArea?.frames[0].bounds).toEqual(r.safeAreaBounds);
    expect(r.labels[r.safeAreaStableKey!]).toBe("qr-safe-area");
  });
});

describe("qrToRenderable — inline rounded-eye treatment", () => {
  test("eyes: true bakes the concentric eye into the m0 and keeps sources in lockstep", () => {
    const baseline = qrToRenderable({
      text: "https://m0saic.io",
      moduleColor: "#f97316",
    });

    const withEyes = qrToRenderable({
      text: "https://m0saic.io",
      moduleColor: "#f97316",
      backgroundColor: "#ffffff",
      eyes: true,
    });

    // The eye channel is auto-enabled and produces 3 anchored Fs.
    expect(withEyes.channelByRole.eyes?.frames).toHaveLength(3);

    // Frame/source lockstep holds after the splice.
    const frames = parseM0StringToRenderFrames(
      String(withEyes.m0),
      withEyes.canvasW,
      withEyes.canvasH,
    );
    expect(withEyes.sources.length).toBe(frames.length);

    // Each spliced eye expands its single F into 3 nested frames
    // (outer dark, inner light ring, center dot). Vs the no-eyes baseline,
    // every dark cell of every eye region is removed from the base layer
    // and replaced by 9 nested frames (3 per eye). The net depends on how
    // many dark cells the encoder placed inside the eye regions; what we
    // care about here is that the last 9 sources form the eye block and
    // source/frame counts stay in lockstep (asserted above).
    expect(baseline.sources.length).toBeGreaterThan(0);
    expect(frames.length).toBeGreaterThanOrEqual(9); // at least the 9 eye frames

    // The last 9 sources are the eye block — 3 sources per eye, with the
    // middle one being the inner light ring colour.
    const eyeBlock = withEyes.sources.slice(-9);
    expect(eyeBlock).toHaveLength(9);
    for (let eyeIdx = 0; eyeIdx < 3; eyeIdx++) {
      const outer = eyeBlock[eyeIdx * 3 + 0];
      const inner = eyeBlock[eyeIdx * 3 + 1];
      const dot = eyeBlock[eyeIdx * 3 + 2];
      expect("color" in outer ? outer.color : undefined).toBe("#f97316");
      expect("color" in inner ? inner.color : undefined).toBe("#ffffff");
      expect("color" in dot ? dot.color : undefined).toBe("#f97316");
    }
  });

  test("eyes without backgroundColor throws a clear error", () => {
    expect(() =>
      qrToRenderable({
        text: "https://m0saic.io",
        moduleColor: "#000",
        eyes: true,
      }),
    ).toThrow(/backgroundColor.*required/);
  });

  test("eyes: { ... } honours custom radii (sources carry the rounding effect)", () => {
    const r = qrToRenderable({
      text: "https://m0saic.io",
      moduleColor: "#000",
      backgroundColor: "#fff",
      eyes: {
        outerBorderRadius: 0.25,
        innerDotBorderRadius: 0.5,
      },
    });
    const eyeBlock = r.sources.slice(-9);
    const firstOuter = eyeBlock[0];
    const firstDot = eyeBlock[2];
    // Each eye source is a color tile with rounding effects.
    const outerRadius =
      "effects" in firstOuter
        ? firstOuter.effects?.rounding?.borderRadius
        : undefined;
    const dotRadius =
      "effects" in firstDot
        ? firstDot.effects?.rounding?.borderRadius
        : undefined;
    expect(outerRadius).toBe(0.25);
    expect(dotRadius).toBe(0.5);
  });
});
