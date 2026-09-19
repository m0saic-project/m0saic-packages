import { parseM0StringToRenderFrames } from "@m0saic/dsl";
import { barcodeToRenderable } from "./barcodeToRenderable";

describe("barcodeToRenderable — input validation", () => {
  test("empty text throws", () => {
    expect(() =>
      barcodeToRenderable({ text: "", moduleColor: "#000" }),
    ).toThrow(/text.*required/);
    expect(() =>
      barcodeToRenderable({ text: "   ", moduleColor: "#000" }),
    ).toThrow(/text.*required/);
  });
});

describe("barcodeToRenderable — Code 128 basic flow", () => {
  test("every renderable frame gets exactly one source", () => {
    const r = barcodeToRenderable({ text: "Hello", moduleColor: "#000" });
    const frames = parseM0StringToRenderFrames(
      String(r.m0),
      r.canvasW,
      r.canvasH,
    );
    expect(frames.length).toBeGreaterThan(0);
    expect(r.sources.length).toBe(frames.length);
  });

  test("every source is a lavfi color tile in the requested colour", () => {
    const r = barcodeToRenderable({ text: "Hello", moduleColor: "#f97316" });
    for (const s of r.sources) {
      expect(s.type).toBe("lavfi");
      expect("color" in s ? s.color : undefined).toBe("#f97316");
    }
  });

  test("source count equals dark-bar count (no HRI by default for Code 128)", () => {
    const r = barcodeToRenderable({ text: "Hello", moduleColor: "#000" });
    const numBars = r.channelByRole.bars?.frames.length ?? 0;
    expect(r.sources.length).toBe(numBars);
    expect(r.humanReadableFrames).toEqual([]);
  });

  test("format defaults to code128", () => {
    const r = barcodeToRenderable({ text: "Hello", moduleColor: "#000" });
    expect(r.format).toBe("code128");
  });
});

describe("barcodeToRenderable — Code 128 with HRI carve", () => {
  test("carve mode adds one source for the HRI splice point", () => {
    const off = barcodeToRenderable({ text: "Hello", moduleColor: "#000" });
    const on = barcodeToRenderable({
      text: "Hello",
      moduleColor: "#000",
      humanReadable: { mode: "carve" },
    });
    expect(on.sources.length).toBe(off.sources.length + 1);
    expect(on.humanReadableFrames).toHaveLength(1);
    expect(on.humanReadableFrames[0].stableKey).toBeDefined();
  });

  test("HRI bounds mode does NOT add a source (no splice point)", () => {
    const off = barcodeToRenderable({ text: "Hello", moduleColor: "#000" });
    const bounds = barcodeToRenderable({
      text: "Hello",
      moduleColor: "#000",
      humanReadable: { mode: "bounds" },
    });
    expect(bounds.sources.length).toBe(off.sources.length);
    expect(bounds.humanReadableFrames).toHaveLength(1);
    expect(bounds.humanReadableFrames[0].stableKey).toBeUndefined();
  });
});

describe("barcodeToRenderable — EAN-13", () => {
  test("default carve mode adds 3 sources for the 3 HRI splice points", () => {
    const r = barcodeToRenderable({
      text: "5901234123457",
      format: "ean13",
      moduleColor: "#000",
    });
    const numBars = r.channelByRole.bars?.frames.length ?? 0;
    expect(r.sources.length).toBe(numBars + 3);
    expect(r.humanReadableFrames).toHaveLength(3);
  });

  test("source-count invariant holds across both ean13 and upca", () => {
    for (const { text, format } of [
      { text: "5901234123457", format: "ean13" as const },
      { text: "036000291452", format: "upca" as const },
    ]) {
      const r = barcodeToRenderable({ text, format, moduleColor: "#000" });
      const frames = parseM0StringToRenderFrames(
        String(r.m0),
        r.canvasW,
        r.canvasH,
      );
      expect(r.sources.length).toBe(frames.length);
    }
  });
});

describe("barcodeToRenderable — UPC-A", () => {
  test("carve mode adds 4 sources (1-5-5-1 splice points)", () => {
    const r = barcodeToRenderable({
      text: "036000291452",
      format: "upca",
      moduleColor: "#000",
    });
    const numBars = r.channelByRole.bars?.frames.length ?? 0;
    expect(r.sources.length).toBe(numBars + 4);
    expect(r.humanReadableFrames).toHaveLength(4);
  });
});

describe("barcodeToRenderable — perCellOverlay hook", () => {
  test("called once per cell with (index, totalCells)", () => {
    const calls: Array<{ i: number; n: number }> = [];
    const r = barcodeToRenderable({
      text: "Hello",
      moduleColor: "#000",
      perCellOverlay: (i, n) => {
        calls.push({ i, n });
        return { alpha: `min(1,t/${(i + 1) * 0.01})` };
      },
    });
    expect(calls.length).toBe(r.sources.length);
    expect(calls[0].i).toBe(0);
    expect(calls[calls.length - 1].i).toBe(r.sources.length - 1);
    for (const c of calls) {
      expect(c.n).toBe(r.sources.length);
    }
  });

  test("overlay attached to every cell when hook returns truthy", () => {
    const r = barcodeToRenderable({
      text: "Hello",
      moduleColor: "#000",
      perCellOverlay: (i) => ({ alpha: `${i}` }),
    });
    for (const s of r.sources) {
      expect("overlay" in s ? s.overlay : undefined).toBeDefined();
    }
  });

  test("no overlay added when hook returns undefined", () => {
    const r = barcodeToRenderable({
      text: "Hello",
      moduleColor: "#000",
      perCellOverlay: () => undefined,
    });
    for (const s of r.sources) {
      expect("overlay" in s ? s.overlay : undefined).toBeUndefined();
    }
  });
});

describe("barcodeToRenderable — channels passthrough", () => {
  test("structural channels enabled flow through to the result", () => {
    const r = barcodeToRenderable({
      text: "Hello",
      moduleColor: "#000",
      channels: { quietZoneLeft: true, startGuard: true },
    });
    expect(r.channelByRole.quietZoneLeft).toBeDefined();
    expect(r.channelByRole.startGuard).toBeDefined();
  });
});

describe("barcodeToRenderable — determinism", () => {
  test("same input twice → byte-identical m0 + identical source count", () => {
    const a = barcodeToRenderable({ text: "M0SAIC", moduleColor: "#f97316" });
    const b = barcodeToRenderable({ text: "M0SAIC", moduleColor: "#f97316" });
    expect(String(a.m0)).toBe(String(b.m0));
    expect(a.sources.length).toBe(b.sources.length);
    expect(a.canvasW).toBe(b.canvasW);
    expect(a.canvasH).toBe(b.canvasH);
  });
});
