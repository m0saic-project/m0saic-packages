import { isValidM0String, parseM0StringToRenderFrames } from "@m0saic/dsl";
import { parseM0cFile } from "@m0saic/dsl-file-formats";
import { barcodeDescriptor, barcodeGenerator } from "./barcodeGenerator";

describe("barcodeGenerator — basic flow", () => {
  test("Code 128 default flow produces a valid m0", () => {
    const r = barcodeGenerator({ text: "Hello" });
    expect(isValidM0String(r.m0)).toBe(true);
    expect(r.sourceCount).toBeGreaterThan(0);
    expect(r.idealCanvas).toBeDefined();
    expect(r.idealCanvas!.width).toBeGreaterThan(0);
    expect(r.idealCanvas!.height).toBeGreaterThan(0);
  });

  test("empty text throws", () => {
    expect(() => barcodeGenerator({ text: "" })).toThrow(/text is required/);
    expect(() => barcodeGenerator({ text: "   " })).toThrow(/text is required/);
  });

  test("displayFields.resolvedPayload echoes the canonical payload", () => {
    const code128 = barcodeGenerator({ text: "Hello" });
    expect(code128.displayFields?.resolvedPayload).toBe("Hello");

    const ean = barcodeGenerator({ format: "ean13", text: "590123412345" });
    // 12-digit input → 13-digit canonical form with auto-appended check.
    expect(ean.displayFields?.resolvedPayload).toBe("5901234123457");

    const upc = barcodeGenerator({ format: "upca", text: "03600029145" });
    expect(upc.displayFields?.resolvedPayload).toBe("036000291452");
  });
});

describe("barcodeGenerator — format dispatch", () => {
  test("each format produces a valid m0", () => {
    for (const { text, format } of [
      { text: "Hello", format: "code128" as const },
      { text: "5901234123457", format: "ean13" as const },
      { text: "036000291452", format: "upca" as const },
    ]) {
      const r = barcodeGenerator({ text, format });
      expect(isValidM0String(r.m0)).toBe(true);
      expect(r.sourceCount).toBeGreaterThan(0);
    }
  });

  test("invalid format string falls back to code128", () => {
    // @ts-expect-error — testing runtime guard against bad data.
    const r = barcodeGenerator({ text: "Hello", format: "code3of9" });
    expect(isValidM0String(r.m0)).toBe(true);
  });

  test("EAN-13 with wrong check digit throws (delegated to encoder)", () => {
    expect(() =>
      barcodeGenerator({ format: "ean13", text: "5901234123450" }),
    ).toThrow(/check digit/);
  });
});

describe("barcodeGenerator — HRI carve", () => {
  test("showHumanReadable: true (default) adds sources for HRI splice points", () => {
    const off = barcodeGenerator({ text: "Hello", showHumanReadable: false });
    const on = barcodeGenerator({ text: "Hello", showHumanReadable: true });
    expect(on.sourceCount).toBe(off.sourceCount + 1);
  });

  test("EAN-13 with HRI adds 3 extra sources (leading + left + right)", () => {
    const off = barcodeGenerator({
      format: "ean13",
      text: "5901234123457",
      showHumanReadable: false,
    });
    const on = barcodeGenerator({
      format: "ean13",
      text: "5901234123457",
      showHumanReadable: true,
    });
    expect(on.sourceCount).toBe(off.sourceCount + 3);
  });

  test("UPC-A with HRI adds 4 extra sources (1-5-5-1)", () => {
    const off = barcodeGenerator({
      format: "upca",
      text: "036000291452",
      showHumanReadable: false,
    });
    const on = barcodeGenerator({
      format: "upca",
      text: "036000291452",
      showHumanReadable: true,
    });
    expect(on.sourceCount).toBe(off.sourceCount + 4);
  });

  test("humanReadableHeightPct grows the canvas vertically", () => {
    const thin = barcodeGenerator({ text: "Hello", humanReadableHeightPct: 5 });
    const thick = barcodeGenerator({ text: "Hello", humanReadableHeightPct: 40 });
    expect(thick.idealCanvas!.height).toBeGreaterThan(thin.idealCanvas!.height);
  });
});

describe("barcodeGenerator — channels passthrough", () => {
  test("enabled channels add labels in the m0c", () => {
    const r = barcodeGenerator({
      text: "Hello",
      channelQuietZoneLeft: true,
      channelStartGuard: true,
    });
    expect(r.m0c).toBeDefined();
    const parsed = parseM0cFile(r.m0c!);
    const labelTexts = Object.values(parsed.labels!).map((l) => l.text);
    expect(labelTexts).toContain("barcode-quiet-zone-left");
    expect(labelTexts).toContain("barcode-start-guard");
  });

  test("no advanced channels enabled → labels still include bars + HRI roles", () => {
    const r = barcodeGenerator({ text: "Hello" });
    expect(r.m0c).toBeDefined();
    const parsed = parseM0cFile(r.m0c!);
    const labelTexts = Object.values(parsed.labels!).map((l) => l.text);
    // Bar labels are always emitted (one per dark bar) + the HRI splice
    // label when carved (default).
    expect(labelTexts.some((t) => t.startsWith("barcode-bar-"))).toBe(true);
    expect(labelTexts).toContain("barcode-hri-text");
  });
});

describe("barcodeGenerator — labels tier", () => {
  test("silent tier suppresses m0c entirely", () => {
    const r = barcodeGenerator({ text: "Hello", labels: "silent" });
    expect(r.m0c).toBeUndefined();
  });

  test("signposts tier (default) emits m0c", () => {
    const r = barcodeGenerator({ text: "Hello" });
    expect(r.m0c).toBeDefined();
  });
});

describe("barcodeGenerator — aspect-ratio knobs", () => {
  test("barHeightModules grows the canvas vertically without changing width", () => {
    const short = barcodeGenerator({ text: "Hello", barHeightModules: 20 });
    const tall = barcodeGenerator({ text: "Hello", barHeightModules: 80 });
    expect(tall.idealCanvas!.width).toBe(short.idealCanvas!.width);
    expect(tall.idealCanvas!.height).toBeGreaterThan(short.idealCanvas!.height);
  });

  test("out-of-range barHeightModules is clamped to (8, 256)", () => {
    const tiny = barcodeGenerator({ text: "Hello", barHeightModules: 0 });
    const huge = barcodeGenerator({ text: "Hello", barHeightModules: 9999 });
    expect(tiny.idealCanvas!.height).toBeGreaterThan(0);
    expect(huge.idealCanvas!.height).toBeGreaterThan(tiny.idealCanvas!.height);
  });

  test("non-integer barHeightModules falls back to default", () => {
    const r = barcodeGenerator({ text: "Hello", barHeightModules: 2.5 });
    expect(r.idealCanvas!.height).toBe(
      barcodeGenerator({ text: "Hello" }).idealCanvas!.height,
    );
  });

  test("invalid humanReadableHeightPct clamps to allowed range", () => {
    const lo = barcodeGenerator({ text: "Hello", humanReadableHeightPct: -10 });
    const hi = barcodeGenerator({ text: "Hello", humanReadableHeightPct: 999 });
    expect(lo.idealCanvas!.height).toBeGreaterThan(0);
    expect(hi.idealCanvas!.height).toBeGreaterThan(0);
  });
});

describe("barcodeGenerator — determinism", () => {
  test("identical params → byte-identical m0", () => {
    const a = barcodeGenerator({ text: "M0SAIC" });
    const b = barcodeGenerator({ text: "M0SAIC" });
    expect(a.m0).toBe(b.m0);
    expect(a.sourceCount).toBe(b.sourceCount);
  });

  test("sourceCount equals the visible-frame count of the m0", () => {
    for (const { text, format } of [
      { text: "Hello", format: "code128" as const },
      { text: "5901234123457", format: "ean13" as const },
      { text: "036000291452", format: "upca" as const },
    ]) {
      const r = barcodeGenerator({ text, format });
      const frames = parseM0StringToRenderFrames(
        r.m0,
        r.idealCanvas!.width,
        r.idealCanvas!.height,
      );
      expect(r.sourceCount).toBe(frames.length);
    }
  });
});

describe("barcodeDescriptor", () => {
  test("has the canonical shape", () => {
    expect(barcodeDescriptor.id).toBe("barcode");
    expect(barcodeDescriptor.category).toBe("brand");
    expect(barcodeDescriptor.group).toBe("Core");
    expect(barcodeDescriptor.params.length).toBeGreaterThan(0);
  });

  test("format param has 3 options matching BarcodeFormat union", () => {
    const formatParam = barcodeDescriptor.params.find((p) => p.key === "format");
    expect(formatParam).toBeDefined();
    expect(formatParam!.type).toBe("enum");
    const values = formatParam!.options!.map((o) => o.value);
    expect(values).toEqual(["code128", "ean13", "upca"]);
  });

  test("text + resolvedPayload + format are exposed as top-level params", () => {
    const keys = barcodeDescriptor.params.map((p) => p.key);
    expect(keys).toContain("format");
    expect(keys).toContain("text");
    expect(keys).toContain("resolvedPayload");
  });
});
