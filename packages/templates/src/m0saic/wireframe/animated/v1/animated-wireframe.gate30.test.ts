/**
 * Gate-30 (v1 prod cut) locks for `@m0saic/wireframe/animated/v1`:
 * real geometry under the header band, the fitted header, cell text-fit
 * (custom labels + the marks ladder), the white default / background knob,
 * unlabeled-cell marks, the wired paper grid, format + audio stamps, the
 * explicit grid defaults, and no cover (dev template).
 */
import { isValidM0String } from "@m0saic/dsl";
import type { M0String } from "@m0saic/dsl";
import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicLavfiSource,
  MosaicMosaicSource,
  MosaicRenderableFile,
  MosaicSource,
  MosaicTextSource,
} from "@m0saic/types";
import "../../utils/wireframeCell";
import { AnimatedWireframe, fitCellText, fitHeader, m0TextEm, middleEllipsize, textEm } from "./animated-wireframe";

function makeCtx(W = 1920, H = 1080, durationMs = 5000): MosaicEngineContext {
  const target = { width: W, height: H, fps: 30, durationMs };
  return {
    mode: "render" as const,
    target,
    output: { ...target, workspaceDir: "/tmp" },
    media: {},
    cache: { get: () => undefined, set: () => {}, getOrCompute: async (_k: string, fn: () => unknown) => fn() },
  } as unknown as MosaicEngineContext;
}

function asDoc(file: MosaicRenderableFile): MosaicDocument {
  expect(file.kind).toBe("mosaic_document");
  return file as MosaicDocument;
}

const m0 = (s: string) => s as M0String;
const render = (props: Parameters<typeof AnimatedWireframe.render>[0], ctx = makeCtx()) =>
  AnimatedWireframe.render(props, ctx).then(asDoc);
const mosaicSources = (doc: MosaicDocument) =>
  doc.sources.filter((s) => (s as MosaicSource).type === "mosaic") as MosaicMosaicSource[];
const headerOf = (doc: MosaicDocument) => doc.sources.find((s) => s.type === "text") as MosaicTextSource | undefined;
const headerText = (doc: MosaicDocument) => {
  const l = headerOf(doc)?.layers?.[0]?.content;
  return l?.kind === "literal" ? l.text : "";
};
const cellTexts = (doc: MosaicDocument, ref: string) => {
  const child = doc.children?.[ref] as MosaicDocument;
  const src = child.sources[0] as MosaicTextSource;
  return (src.layers ?? []).map((l) => (l.content?.kind === "literal" ? l.content.text ?? "" : ""));
};

describe("AnimatedWireframe — gate 30 stamps + defaults", () => {
  it("declares the video/mp4 format and audio off (gate-26 convention; never a placeholder track)", async () => {
    const doc = await render({ M0String: m0("F") });
    expect(doc.format).toEqual({ kind: "video", container: "mp4" });
    expect(doc.audio).toEqual({ mode: "off" });
    expect(AnimatedWireframe.outputHints?.format).toEqual({ kind: "video", container: "mp4" });
  });

  it("defaultProps spell out the shipped debug style on the family's 2×2 default", () => {
    expect(AnimatedWireframe.defaultProps).toEqual({
      M0String: "2(2[1,1],2[1,1])",
      paddingSec: 0.35,
      disableUi: false,
      mode: "debug",
      background: "white",
      unlabeledCells: "marks",
      preset: "none", // the visible unset state of the preset picker (default-props contract, 2026-09-05)
    });
  });

  it("renders byte-identical to the implicit defaults", async () => {
    const explicit = await render({ ...AnimatedWireframe.defaultProps! } as never);
    const implicit = await render({ M0String: m0("2(2[1,1],2[1,1])") });
    expect(JSON.stringify(explicit)).toBe(JSON.stringify(implicit));
  });

  it("is DEPRECATED in favor of the DSL tutorial (founder ruling, gate 30) — kept callable", () => {
    expect(AnimatedWireframe.deprecated).toEqual({
      reason: expect.stringContaining("Superseded by the DSL tutorial"),
      replacement: "@m0saic/dsl-tutorial/v1",
      since: "2026-09-04",
    });
    expect(AnimatedWireframe.internal).toBeUndefined(); // deprecated-hidden, not internal
    expect(AnimatedWireframe.description).toMatch(/^Deprecated — use DSL Tutorial/);
  });

  it("declares NO cover (dev template — the grid default is the face)", () => {
    expect(AnimatedWireframe.renderCover).toBeUndefined();
    expect(AnimatedWireframe.renderTutorial).toBeUndefined();
  });

  it("white canvas by default; transparent opts out; a preset's background wins", async () => {
    expect((await render({ M0String: m0("F") })).backgroundColor).toBe("#ffffff@1.0");
    expect((await render({ M0String: m0("F"), background: "transparent" })).backgroundColor).toBeUndefined();
    expect((await render({ M0String: m0("F"), preset: "thumb-dark" })).backgroundColor).toBe("#0f1116@1.0");
    expect((await render({ M0String: m0("F"), background: "transparent", preset: "thumb-dark" })).backgroundColor).toBe(
      "#0f1116@1.0",
    );
  });
});

describe("AnimatedWireframe — geometry under the header (the dims lie fix)", () => {
  it("cells print the geometry the engine renders beneath the band, not the bare-canvas one", async () => {
    const doc = await render({ M0String: m0("2(2[1,1],2[1,1])") });
    expect(doc.m0).toBe("10[1,0,0,0,0,0,0,0,0,2(2[1,1],2[1,1])]");
    // 1080 / 10 rows = 108 band → 972 for the layout → 486 per row
    expect(cellTexts(doc, "cell-0")).toContain("960 × 486");
    expect(cellTexts(doc, "cell-0")).not.toContain("960 × 540");
    expect(mosaicSources(doc)).toHaveLength(4);
  });

  it("without the header the bare geometry is printed and the m0 is verbatim", async () => {
    const doc = await render({ M0String: m0("2(2[1,1],2[1,1])"), disableUi: true });
    expect(doc.m0).toBe("2(2[1,1],2[1,1])");
    expect(cellTexts(doc, "cell-0")).toContain("960 × 540");
    expect(cellTexts(doc, "cell-0")).toContain("16:9 · 1.78");
    expect(headerOf(doc)).toBeUndefined();
  });

  it("children are keyed by reveal order regardless of the header's logical slot", async () => {
    const doc = await render({ M0String: m0("3(1,1,1)") });
    expect(Object.keys(doc.children ?? {})).toEqual(["cell-0", "cell-1", "cell-2"]);
    expect(mosaicSources(doc).map((s) => s.ref)).toEqual(["cell-0", "cell-1", "cell-2"]);
  });
});

describe("AnimatedWireframe — header text-fit", () => {
  it("sizes the header to the band (36% of 108px = 39px at 1080p) with the m0 string", async () => {
    const doc = await render({ M0String: m0("2(1,1)") });
    expect(headerOf(doc)?.style?.fontSize).toBe(39);
    expect(headerText(doc)).toBe("m0: 2(1,1)");
  });

  it("scales with the canvas: 4K band → capped 48px; 320×180 band → 12px floor", async () => {
    expect(headerOf(await render({ M0String: m0("F") }, makeCtx(3840, 2160)))?.style?.fontSize).toBe(48);
    expect(headerOf(await render({ M0String: m0("F") }, makeCtx(320, 180)))?.style?.fontSize).toBe(12);
  });

  it("shrinks a long m0 string to the canvas width, then middle-ellipsizes at the floor", () => {
    const short = fitHeader("2(1,1)", 1920, 108);
    expect(short).toEqual({ text: "m0: 2(1,1)", fontSize: 39 });
    const grid = (n: number) => `${n}(${Array(n).fill("10(1,1,1,1,1,1,1,1,1,1)").join(",")})`;
    const medium = fitHeader(grid(4), 1920, 108); // ~95 chars
    expect(medium.fontSize).toBeLessThan(39);
    expect(medium.fontSize).toBeGreaterThan(12);
    expect(medium.text).toBe(`m0: ${grid(4)}`); // whole — it fit by shrinking
    const dense = fitHeader(grid(10), 1920, 108); // the 100-cell string, 233 chars
    expect(dense.fontSize).toBeGreaterThanOrEqual(12);
    expect(dense.fontSize).toBeLessThanOrEqual(14);
    expect(dense.text).toBe(`m0: ${grid(10)}`); // still whole at the floor (m0-aware widths)
    expect(m0TextEm(dense.text) * 12).toBeLessThanOrEqual(1920 * 0.96);
    const absurd = "2(" + Array(200).fill("2(1,1)").join(",") + ")";
    const cut = fitHeader(absurd, 1920, 108);
    expect(cut.fontSize).toBe(12);
    expect(cut.text).toMatch(/^m0: 2\(2\(1,1\).*…/);
    expect(cut.text).toMatch(/\)$/); // keeps the tail
    expect(m0TextEm(cut.text) * 12).toBeLessThanOrEqual(1920 * 0.96);
  });

  it("middleEllipsize keeps head and tail within the em budget", () => {
    const flat = () => 1;
    expect(middleEllipsize("abcdefghij", 20, flat)).toBe("abcdefghij");
    expect(middleEllipsize("abcdefghij", 7, flat)).toBe("abc…hij");
    expect(middleEllipsize("abcdefghij", 3, flat)).toBe("a…j");
    expect(middleEllipsize("abcdefghij", 1, flat)).toBe("…");
  });
});

describe("AnimatedWireframe — cell text-fit", () => {
  it("marks: W × H + ratio at a comfortable cell; ratio dropped, then dims, as the cell narrows", () => {
    const wide = fitCellText({ cellW: 960, cellH: 486, label: undefined, minTextSize: 14 });
    expect(wide.text.split("\n")).toEqual(["960 × 486", "160:81 · 1.98"]);
    expect(wide.showOrder).toBe(true);
    expect(wide.textSize).toBe(87); // min side × 0.18

    const narrow = fitCellText({ cellW: 48, cellH: 972, label: undefined, minTextSize: 14 });
    expect(narrow.showOrder).toBe(true);
    // "48 × 972" at the 14px floor needs ~8 × 13 × 0.72 ≈ 76px > 48 → number only
    expect(narrow.text).toBe("");

    const squat = fitCellText({ cellW: 400, cellH: 27, label: undefined, minTextSize: 14 });
    expect(squat.showOrder).toBe(true);
    expect(squat.text).toBe(""); // no room under the index for even one line
  });

  it("custom label: one line replacing the marks, shrunk to the cell, cut at the floor", () => {
    const short = fitCellText({ cellW: 960, cellH: 486, label: "Hero", minTextSize: 14 });
    expect(short).toEqual({ text: "Hero", textSize: 87, showOrder: false });

    const long = fitCellText({
      cellW: 640,
      cellH: 405,
      label: "Hero story with a very very long headline that keeps going and going",
      minTextSize: 14,
    });
    expect(long.showOrder).toBe(false);
    expect(long.text).toMatch(/^Hero story/);
    expect(long.textSize).toBeLessThan(72);
    expect(long.textSize).toBeGreaterThanOrEqual(14);
    expect(long.text).toBe("Hero story with a very very long headline that keeps going and going"); // whole
    // modelled width at the nested cell's real line size must fit the padded cell
    const linePx = Math.round(Math.round(long.textSize * 0.75) * 1.25);
    expect(textEm(long.text) * linePx).toBeLessThanOrEqual(640 - 2 * 16);

    const tiny = fitCellText({ cellW: 80, cellH: 90, label: "An unreasonably long label for a thumbnail cell", minTextSize: 14 });
    expect(tiny.textSize).toBe(14);
    expect(tiny.text.endsWith("…")).toBe(true);
    expect(tiny.text.length).toBeLessThan(12);

    expect(fitCellText({ cellW: 200, cellH: 200, label: "   ", minTextSize: 14 })).toEqual({
      text: "",
      textSize: 36,
      showOrder: false,
    });
  });

  it("labeled cells drop their number; unlabeled cells keep their marks (v2 parity); empty opts out", async () => {
    const cellOf = (doc: MosaicDocument, ref: string) =>
      (doc.children?.[ref] as MosaicDocument).sources[0] as MosaicTextSource;
    const marks = await render({ M0String: m0("3(1,1,1)"), labels: ["Nav", "", "Aside"], disableUi: true });
    expect(cellTexts(marks, "cell-0")).toEqual(["Nav"]); // label only, no index layer
    expect(cellTexts(marks, "cell-1")).toEqual(["640 × 1080", "16:27 · 0.59", "2"]); // marks + index
    expect(cellTexts(marks, "cell-2")).toEqual(["Aside"]);
    expect(cellOf(marks, "cell-1").layers).toHaveLength(3);

    const empty = await render({
      M0String: m0("3(1,1,1)"),
      labels: ["Nav", "", "Aside"],
      unlabeledCells: "empty",
      disableUi: true,
    });
    // a blank cell is still a RENDERABLE text source (the engine refuses `layers: []`)
    expect(cellTexts(empty, "cell-1")).toEqual([""]);
    expect(cellOf(empty, "cell-1").layers).toHaveLength(1);
    // a whitespace-only label counts as UNLABELED (base/v2's rule) → marks
    const blankLabel = await render({ M0String: m0("2(1,1)"), labels: ["   ", "B"], disableUi: true });
    expect(cellTexts(blankLabel, "cell-0")).toEqual(["960 × 1080", "8:9 · 0.89", "1"]);
    expect(cellTexts(blankLabel, "cell-1")).toEqual(["B"]);
  });
});

describe("AnimatedWireframe — paper grid (gate-29 finding, same resolver)", () => {
  it("grid-paper preset appends ONE static lattice as the top overlay leaf (no header in thumb mode)", async () => {
    const doc = await render({ M0String: m0("2(1,1)"), preset: "grid-paper" });
    expect(doc.m0).toBe("2(1,1){1}");
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    expect(doc.sources).toHaveLength(3);
    const lattice = doc.sources[2] as MosaicLavfiSource;
    expect(lattice.type).toBe("lavfi");
    expect(lattice.mask?.kind).toBe("inline-mask");
    expect(lattice.overlay?.alpha).toBe("0.08");
    expect(lattice.overlay?.startAtSec).toBeUndefined(); // visible from t=0; cells slide in beneath
    expect(mosaicSources(doc)).toHaveLength(2);
  });

  it("theme.paperGrid in debug mode rides over the header stack and nests past a root overlay", async () => {
    const doc = await render({
      M0String: m0("2(1,1){2[-,1]}"),
      theme: { paperGrid: { enabled: true, stepFrac: 0.1, alpha: 0.3 } },
    });
    expect(doc.m0).toBe("10[1,0,0,0,0,0,0,0,0,2(1,1){2[-,1]}]{1}");
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    // header text + 3 cells + lattice
    expect(doc.sources).toHaveLength(5);
    expect((doc.sources[4] as MosaicLavfiSource).overlay?.alpha).toBe("0.3");
  });

  it("without a paper grid the m0 is the caller's string verbatim (header off) — no extra sources", async () => {
    const doc = await render({ M0String: m0("2(1,1){2[-,1]}"), preset: "thumb-light" });
    expect(doc.m0).toBe("2(1,1){2[-,1]}");
    expect(doc.sources).toHaveLength(3);
  });
});

describe("AnimatedWireframe — reveal timing (unchanged contract)", () => {
  it("staggers cells across [lead, total − trail] and the last slide settles before the end", async () => {
    const doc = await render({ M0String: m0("4[1,1,1,1]"), paddingSec: 0.5, disableUi: true }, makeCtx(1920, 1080, 3000));
    const starts = mosaicSources(doc).map((s) => s.overlay?.startAtSec ?? -1);
    expect(starts[0]).toBe(0.5);
    expect(starts[3]).toBeCloseTo(2.5, 6);
    expect(starts[3] + 0.3).toBeLessThanOrEqual(3);
    expect(doc.durationMs).toBe(3000);
  });

  it("null and passthrough slots never get a cell", async () => {
    const doc = await render({ M0String: m0("3(0{2[-,1]},0{2[1,-]},1)"), disableUi: true });
    expect(mosaicSources(doc)).toHaveLength(3);
    expect(doc.m0).toBe("3(0{2[-,1]},0{2[1,-]},1)");
  });
});
