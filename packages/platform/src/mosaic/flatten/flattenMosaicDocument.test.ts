import type {
  MosaicAssetManifest,
  MosaicDocument,
  MosaicSource,
} from "@m0saic/types";
import { asAssetId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import { parseM0StringToRenderFrames, toCanonicalM0String } from "@m0saic/dsl";
import { flattenMosaicDocument } from "./flattenMosaicDocument";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const W = 1920;
const H = 1080;

// Carry the desired path alongside the assetId via a symbol-keyed side
// channel so `makeDoc` can auto-build the manifest from the sources array.
// The factory call sites stay one-liners — `mediaSrc("a.png")` — which is
// what every existing test expects.
const PATH = Symbol("test:path");

function mediaSrc(path: string): MosaicSource {
  const id = path.replace(/[^a-z0-9]/gi, "_");
  const src = {
    type: "media",
    mediaType: "image",
    assetId: asAssetId(id),
    [PATH]: path,
  } as unknown as MosaicSource;
  return src;
}

function mosaicSrc(ref: string): MosaicSource {
  return { type: "mosaic", ref } as MosaicSource;
}

function buildAssetsFromSources(sources: MosaicSource[]): MosaicAssetManifest {
  const assets: MosaicAssetManifest = {} as MosaicAssetManifest;
  for (const s of sources) {
    if (s.type !== "media") continue;
    const path = (s as unknown as Record<symbol, string>)[PATH];
    if (typeof path !== "string") continue;
    const id = (s as { assetId: string }).assetId;
    (assets as Record<string, unknown>)[id] = {
      kind: "file",
      path,
      mediaType: "image",
    };
  }
  return assets;
}

function makeDoc(
  m0: string,
  sources: MosaicSource[],
  children?: Record<string, MosaicDocument>,
): MosaicDocument {
  const assets = buildAssetsFromSources(sources);
  // Children's own asset entries flow up into the parent at flatten time;
  // for makeDoc we just initialize an empty manifest on each level and
  // copy each source's path into the local manifest.
  return {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String(m0, "test/makeDoc"),
    assets,
    sources,
    ...(children ? { children } : {}),
  };
}

const noResolve = () => null;

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe("flattenMosaicDocument", () => {
  // ── Basic: parent "1" with child "2(1,1)" ─────────────────
  test("basic: single mosaic source is replaced by child DSL and sources", () => {
    const child = makeDoc("2(1,1)", [mediaSrc("a.png"), mediaSrc("b.png")]);
    const parent = makeDoc("1", [mosaicSrc("inner")], { inner: child });

    const result = flattenMosaicDocument({ file: parent, width: W, height: H, resolveRef: noResolve });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(toCanonicalM0String(result.file.m0)).toBe("2(1,1)");
    expect(result.file.sources).toHaveLength(2);
    expect((result.file.assets as any)[(result.file.sources[0] as any).assetId]?.path).toBe("a.png");
    expect((result.file.assets as any)[(result.file.sources[1] as any).assetId]?.path).toBe("b.png");
  });

  // ── Engine-internal asset kinds (post-plan renderables) ───
  // `buildMosaicPlanFromRenderable` mutates the in-memory doc, minting
  // engine-internal assets (e.g. "node-output" for child-mosaic nodes).
  // Strict validation rejects those, but a geometry-only caller (the
  // Showcase render feed) can opt to tolerate them via
  // `acceptedEngineInternalKinds` and still recover the flattened m0.
  test("engine-internal asset: rejected by default, tolerated when opted in", () => {
    const child = makeDoc("2(1,1)", [mediaSrc("a.png"), mediaSrc("b.png")]);
    const parent = makeDoc("1", [mosaicSrc("inner")], { inner: child });
    // Mimic the engine minting a node-output entry into the manifest.
    (parent.assets as Record<string, unknown>)["node_root"] = {
      kind: "node-output",
    };

    const strict = flattenMosaicDocument({
      file: parent,
      width: W,
      height: H,
      resolveRef: noResolve,
    });
    expect(strict.ok).toBe(false);
    if (!strict.ok) {
      expect(strict.diagnostics.some((d) => d.code === "ASSET_KIND_UNKNOWN")).toBe(true);
    }

    const tolerant = flattenMosaicDocument({
      file: parent,
      width: W,
      height: H,
      resolveRef: noResolve,
      acceptedEngineInternalKinds: ["node-output", "lavfi", "workspace-file"],
    });
    expect(tolerant.ok).toBe(true);
    if (tolerant.ok) {
      expect(toCanonicalM0String(tolerant.file.m0)).toBe("2(1,1)");
    }
  });

  // ── Nested: 2 tiles, second is mosaic ─────────────────────
  test("nested: second tile is mosaic, first stays as-is", () => {
    const child = makeDoc("3[1,1,1]", [
      mediaSrc("c1.png"),
      mediaSrc("c2.png"),
      mediaSrc("c3.png"),
    ]);
    const parent = makeDoc("2(1,1)", [mediaSrc("x.png"), mosaicSrc("inner")], {
      inner: child,
    });

    const result = flattenMosaicDocument({ file: parent, width: W, height: H, resolveRef: noResolve });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(toCanonicalM0String(result.file.m0)).toBe("2(1,3[1,1,1])");
    expect(result.file.sources).toHaveLength(4);
    expect((result.file.assets as any)[(result.file.sources[0] as any).assetId]?.path).toBe("x.png");
    expect((result.file.assets as any)[(result.file.sources[1] as any).assetId]?.path).toBe("c1.png");
    expect((result.file.assets as any)[(result.file.sources[2] as any).assetId]?.path).toBe("c2.png");
    expect((result.file.assets as any)[(result.file.sources[3] as any).assetId]?.path).toBe("c3.png");

    // Verify the new source count matches what the parser expects
    const frames = parseM0StringToRenderFrames(result.file.m0, W, H);
    expect(frames).toHaveLength(result.file.sources.length);
  });

  // ── Overlays preserved ────────────────────────────────────
  test("overlays: child DSL with overlays is preserved in output", () => {
    const child = makeDoc("1{1}", [mediaSrc("base.png"), mediaSrc("overlay.png")]);
    const parent = makeDoc("1", [mosaicSrc("inner")], { inner: child });

    const result = flattenMosaicDocument({ file: parent, width: W, height: H, resolveRef: noResolve });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(toCanonicalM0String(result.file.m0)).toBe("1{1}");
    expect(result.file.sources).toHaveLength(2);
    expect((result.file.assets as any)[(result.file.sources[0] as any).assetId]?.path).toBe("base.png");
    expect((result.file.assets as any)[(result.file.sources[1] as any).assetId]?.path).toBe("overlay.png");

    const frames = parseM0StringToRenderFrames(result.file.m0, W, H);
    expect(frames).toHaveLength(2);
  });

  // ── 0-run overlay growth ──────────────────────────────────
  test("0-run overlay growth: child with 0{1}1 pattern is preserved", () => {
    const child = makeDoc("2(0{1},1)", [
      mediaSrc("overlay.png"),
      mediaSrc("claimant.png"),
    ]);
    const parent = makeDoc("1", [mosaicSrc("inner")], { inner: child });

    const result = flattenMosaicDocument({ file: parent, width: W, height: H, resolveRef: noResolve });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const canonical = toCanonicalM0String(result.file.m0);
    expect(canonical).toBe("2(0{1},1)");
    expect(result.file.sources).toHaveLength(2);

    // Verify frame count matches sources and stackOrder is contiguous
    const frames = parseM0StringToRenderFrames(canonical, W, H);
    expect(frames).toHaveLength(2);

    // stackOrder values should be contiguous 0..N-1
    const paintOrders = frames.map((f) => f.paintOrder).sort((a, b) => a - b);
    expect(paintOrders).toEqual([0, 1]);
  });

  // ── Cycle detection ───────────────────────────────────────
  test("cycle: A -> B -> A yields MOSAIC_CYCLE_DETECTED", () => {
    const docA = makeDoc("1", [mosaicSrc("B")]);
    const docB = makeDoc("1", [mosaicSrc("A")]);

    const resolveRef = (ref: string) => {
      if (ref === "B") return docB;
      if (ref === "A") return docA;
      return null;
    };

    const result = flattenMosaicDocument({ file: docA, width: W, height: H, resolveRef });

    expect(result.ok).toBe(false);

    const diags = (result as any).diagnostics;
    expect(diags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "MOSAIC_CYCLE_DETECTED",
          severity: "error",
        }),
      ]),
    );
  });

  // ── REF_NOT_FOUND ─────────────────────────────────────────
  test("unresolvable ref yields MOSAIC_REF_NOT_FOUND", () => {
    const parent = makeDoc("1", [mosaicSrc("nonexistent")]);

    const result = flattenMosaicDocument({ file: parent, width: W, height: H, resolveRef: noResolve });

    expect(result.ok).toBe(false);

    const diags = (result as any).diagnostics;
    expect(diags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "MOSAIC_REF_NOT_FOUND",
          severity: "error",
        }),
      ]),
    );
    expect(diags[0].message).toContain("nonexistent");
  });

  // ── Already flat → passthrough ────────────────────────────
  test("document with no mosaic sources returns as-is", () => {
    const doc = makeDoc("2(1,1)", [mediaSrc("a.png"), mediaSrc("b.png")]);

    const result = flattenMosaicDocument({ file: doc, width: W, height: H, resolveRef: noResolve });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.file).toBe(doc); // same object identity (no copy)
  });

  // ── Both tiles are mosaic sources ─────────────────────────
  test("multiple mosaic sources are all inlined in correct order", () => {
    const childA = makeDoc("2[1,1]", [mediaSrc("a1.png"), mediaSrc("a2.png")]);
    const childB = makeDoc("1", [mediaSrc("b1.png")]);
    const parent = makeDoc("2(1,1)", [mosaicSrc("A"), mosaicSrc("B")], {
      A: childA,
      B: childB,
    });

    const result = flattenMosaicDocument({ file: parent, width: W, height: H, resolveRef: noResolve });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(toCanonicalM0String(result.file.m0)).toBe("2(2[1,1],1)");
    expect(result.file.sources).toHaveLength(3);
    expect((result.file.assets as any)[(result.file.sources[0] as any).assetId]?.path).toBe("a1.png");
    expect((result.file.assets as any)[(result.file.sources[1] as any).assetId]?.path).toBe("a2.png");
    expect((result.file.assets as any)[(result.file.sources[2] as any).assetId]?.path).toBe("b1.png");

    const frames = parseM0StringToRenderFrames(result.file.m0, W, H);
    expect(frames).toHaveLength(3);
  });

  // ── Overlay chain collapse: parent "1{1}" child "1{1}" ───
  test("overlay chain: parent 1{1} + child 1{1} produces 1{1{1}} not 1{1}{1}", () => {
    // Child is a tile with its own overlay
    const child = makeDoc("1{1}", [mediaSrc("base.png"), mediaSrc("childOverlay.png")]);
    // Parent is a tile with overlay; the tile (source 0) is a mosaic ref,
    // the overlay (source 1) is a regular media source.
    const parent = makeDoc("1{1}", [mosaicSrc("inner"), mediaSrc("parentOverlay.png")], {
      inner: child,
    });

    const result = flattenMosaicDocument({ file: parent, width: W, height: H, resolveRef: noResolve });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Naive splice would have produced "1{1}{1}" — verify it's collapsed
    const canonical = toCanonicalM0String(result.file.m0);
    expect(canonical).toBe("1{1{1}}");

    // Sources: child base, child overlay, parent overlay
    expect(result.file.sources).toHaveLength(3);
    expect((result.file.assets as any)[(result.file.sources[0] as any).assetId]?.path).toBe("base.png");
    expect((result.file.assets as any)[(result.file.sources[1] as any).assetId]?.path).toBe("childOverlay.png");
    expect((result.file.assets as any)[(result.file.sources[2] as any).assetId]?.path).toBe("parentOverlay.png");

    // Validate frame count matches source count
    const frames = parseM0StringToRenderFrames(result.file.m0, W, H);
    expect(frames).toHaveLength(3);
  });

  // ── Sibling ref: child resolves ref from parent's children ─
  test("child resolves sibling ref from parent children map", () => {
    // Mirrors the bar-graph template pattern:
    // root has children { "chart-frame", "plot-area" }
    // chart-frame's source references "plot-area" which lives on root, not chart-frame
    const plotArea = makeDoc("2(1,1)", [mediaSrc("bar1.png"), mediaSrc("bar2.png")]);
    const chartFrame = makeDoc("1{1}", [
      mediaSrc("card.png"),
      mosaicSrc("plot-area"),  // ref lives on ROOT, not on chartFrame
    ]);
    const root = makeDoc("1", [mosaicSrc("chart-frame")], {
      "chart-frame": chartFrame,
      "plot-area": plotArea,
    });

    const result = flattenMosaicDocument({ file: root, width: W, height: H, resolveRef: noResolve });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // chart-frame's "1{1}" with plot-area inlined into overlay position:
    // source 0 = card.png, source 1 = plot-area "2(1,1)" → bar1+bar2
    // So flattened chart-frame = "1{2(1,1)}" with 3 sources
    // Root inlines that into its "1" → "1{2(1,1)}" with 3 sources
    expect(toCanonicalM0String(result.file.m0)).toBe("1{2(1,1)}");
    expect(result.file.sources).toHaveLength(3);
    expect((result.file.assets as any)[(result.file.sources[0] as any).assetId]?.path).toBe("card.png");
    expect((result.file.assets as any)[(result.file.sources[1] as any).assetId]?.path).toBe("bar1.png");
    expect((result.file.assets as any)[(result.file.sources[2] as any).assetId]?.path).toBe("bar2.png");
  });

  // ── Deep nesting (grandchild) ─────────────────────────────
  test("multi-level nesting: parent -> child -> grandchild", () => {
    const grandchild = makeDoc("2(1,1)", [mediaSrc("g1.png"), mediaSrc("g2.png")]);
    const child = makeDoc("1", [mosaicSrc("gc")], { gc: grandchild });
    const parent = makeDoc("1", [mosaicSrc("c")], { c: child });

    const result = flattenMosaicDocument({ file: parent, width: W, height: H, resolveRef: noResolve });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(toCanonicalM0String(result.file.m0)).toBe("2(1,1)");
    expect(result.file.sources).toHaveLength(2);
    expect((result.file.assets as any)[(result.file.sources[0] as any).assetId]?.path).toBe("g1.png");
    expect((result.file.assets as any)[(result.file.sources[1] as any).assetId]?.path).toBe("g2.png");
  });
});

// ─────────────────────────────────────────────────────────────
// Parent overlay push-down (gate 30 — the animated wireframe's twins lied)
// ─────────────────────────────────────────────────────────────

describe("flattenMosaicDocument — parent overlay push-down", () => {
  const lavfi = (color: string, overlay?: Record<string, unknown>): MosaicSource =>
    ({ type: "lavfi", color, ...(overlay ? { overlay } : {}) }) as unknown as MosaicSource;
  const gatedRef = (ref: string, overlay: Record<string, unknown>): MosaicSource =>
    ({ type: "mosaic", ref, overlay }) as unknown as MosaicSource;
  const REVEAL = {
    startAtSec: 2,
    enable: "gte(t,2.000)",
    yExpr: "-(1-min(lt/0.3,1))*H*0.08",
    alpha: "min(lt/0.5,1)",
    blendMode: "screen",
  };

  test("a gated/animated mosaic ref pushes its overlay onto every inlined source, macros baked at the PARENT slot", () => {
    const child = makeDoc("2(1,1)", [lavfi("#111"), lavfi("#222")]);
    const parent = makeDoc("2(1,1)", [lavfi("#000"), gatedRef("inner", REVEAL)], { inner: child });
    const result = flattenMosaicDocument({ file: parent, width: W, height: H, resolveRef: noResolve });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toCanonicalM0String(result.file.m0)).toBe("2(1,2(1,1))");
    const [base, a, b] = result.file.sources as Array<{ overlay?: Record<string, unknown> }>;
    expect(base.overlay).toBeUndefined();
    // The ref sat in the right half: W=960, H=1080 at that slot; lt → (t-2).
    const expected = {
      startAtSec: 2,
      enable: "gte(t,2.000)",
      yExpr: "-(1-min((t-2)/0.3,1))*1080*0.08",
      alpha: "min((t-2)/0.5,1)",
      blendMode: "screen",
    };
    expect(a.overlay).toEqual(expected);
    expect(b.overlay).toEqual(expected);
  });

  test("an inlined source with its own overlay keeps it; gate and alpha compose by product, offsets by sum", () => {
    const child = makeDoc("2(1,1)", [
      lavfi("#111", { enable: "lt(t,5)", alpha: "0.5", yExpr: "10", startAtSec: 1 }),
      lavfi("#222"),
    ]);
    const parent = makeDoc("1", [gatedRef("inner", REVEAL)], { inner: child });
    const result = flattenMosaicDocument({ file: parent, width: W, height: H, resolveRef: noResolve });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [a, b] = result.file.sources as Array<{ overlay?: Record<string, unknown> }>;
    expect(a.overlay).toEqual({
      startAtSec: 1, // the child's own timing wins
      enable: "(lt(t,5))*(gte(t,2.000))",
      alpha: "(0.5)*(min((t-2)/0.5,1))",
      yExpr: "(10)+(-(1-min((t-2)/0.3,1))*1080*0.08)",
      blendMode: "screen",
    });
    expect(b.overlay).toEqual({
      startAtSec: 2,
      enable: "gte(t,2.000)",
      yExpr: "-(1-min((t-2)/0.3,1))*1080*0.08",
      alpha: "min((t-2)/0.5,1)",
      blendMode: "screen",
    });
  });

  test("no parent overlay → inlined sources are untouched (byte-identical to before)", () => {
    const child = makeDoc("2(1,1)", [lavfi("#111"), lavfi("#222", { alpha: "0.5" })]);
    const parent = makeDoc("1", [mosaicSrc("inner")], { inner: child });
    const result = flattenMosaicDocument({ file: parent, width: W, height: H, resolveRef: noResolve });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.sources).toEqual([lavfi("#111"), lavfi("#222", { alpha: "0.5" })]);
  });

  test("nested two levels: the inner ref's overlay bakes at ITS slot, the outer's at the outer slot", () => {
    const leaf = makeDoc("1", [lavfi("#111")]);
    const mid = makeDoc("2[1,1]", [lavfi("#222"), gatedRef("leaf", { yExpr: "H*0.5" })], { leaf });
    const parent = makeDoc("2(1,1)", [lavfi("#000"), gatedRef("mid", { enable: "gte(t,1)" })], { mid });
    const result = flattenMosaicDocument({ file: parent, width: W, height: H, resolveRef: noResolve });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toCanonicalM0String(result.file.m0)).toBe("2(1,2[1,1])");
    const srcs = result.file.sources as Array<{ overlay?: Record<string, unknown> }>;
    expect(srcs[1].overlay).toEqual({ enable: "gte(t,1)" });
    // leaf sat in the bottom half of the right column: 960×540 → H*0.5 = 270
    expect(srcs[2].overlay).toEqual({ enable: "gte(t,1)", yExpr: "540*0.5" });
  });
});
