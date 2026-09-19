import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicLavfiSource,
  MosaicRenderableFile,
  MosaicSource,
} from "@m0saic/types";
import { makeM0saicTempPrefix } from "@m0saic/platform/paths";
import { QrAnimate } from "./qr-animate";

const TEMPLATE_ID = "@m0saic/media/qr/animate/v1";

function makeCtx(
  overrides?: Partial<MosaicEngineContext["target"]> & {
    workspaceDir?: string;
  },
): MosaicEngineContext {
  const ws =
    overrides?.workspaceDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), makeM0saicTempPrefix("qr-animate-test")));
  return {
    mode: "render" as const,
    target: {
      width: 1080,
      height: 1080,
      fps: 30,
      durationMs: 1500,
      ...overrides,
    },
    output: {
      width: 1080,
      height: 1080,
      fps: 30,
      durationMs: 1500,
      workspaceDir: ws,
      ...overrides,
    },
    media: {},
  };
}

function asDocument(file: MosaicRenderableFile): MosaicDocument {
  expect(file.kind).toBe("mosaic_document");
  return file as MosaicDocument;
}

function getSources(doc: MosaicDocument): MosaicSource[] {
  return doc.sources ?? [];
}

describe(`${TEMPLATE_ID} — render`, () => {
  it("missing qrM0 returns an error mosaic", async () => {
    const doc = asDocument(await QrAnimate.render({}, makeCtx()));
    // Error mosaic still returns a valid document; the title encodes the failure.
    expect(doc.kind).toBe("mosaic_document");
    // makeErrorMosaic shapes the doc with a recognisable title; we just check it's an error path.
    // Source set should be present (the error display) but won't match a normal QR pattern.
    expect(getSources(doc).length).toBeGreaterThan(0);
  });

  it("empty qrM0 string returns an error mosaic", async () => {
    const doc = asDocument(await QrAnimate.render({ qrM0: "   " }, makeCtx()));
    expect(doc.kind).toBe("mosaic_document");
  });

  it("simple 2-frame m0 produces 2 lavfi sources", async () => {
    // `2[F,F]` = 2-row split, both frames visible.
    const doc = asDocument(
      await QrAnimate.render({ qrM0: "2[F,F]" }, makeCtx()),
    );
    const sources = getSources(doc);
    expect(sources).toHaveLength(2);
    expect(sources.every((s) => s.type === "lavfi")).toBe(true);
  });

  it("4-frame 2x2 grid produces 4 lavfi sources, all carrying their own per-tile overlay", async () => {
    // `2[2(F,F),2(F,F)]` = 2 rows, each split into 2 columns → 2×2 grid.
    const doc = asDocument(
      await QrAnimate.render({ qrM0: "2[2(F,F),2(F,F)]" }, makeCtx()),
    );
    const sources = getSources(doc);
    expect(sources).toHaveLength(4);
    expect(sources.every((s) => s.type === "lavfi")).toBe(true);

    // Each tile's overlay alpha gates at a distinct start time (rank-based stagger).
    const alphas = sources.map(
      (s) => (s as MosaicLavfiSource).overlay?.alpha ?? "",
    );
    expect(new Set(alphas).size).toBe(4);
  });

  it("passthrough / null tiles are skipped — only F tiles get sources", async () => {
    // `3[F,-,F]` = 3-row split; middle tile is `-` (null). Only 2 visible.
    const doc = asDocument(
      await QrAnimate.render({ qrM0: "3[F,-,F]" }, makeCtx()),
    );
    expect(getSources(doc)).toHaveLength(2);
  });

  it("every source carries an overlay with alpha + xExpr + yExpr", async () => {
    const doc = asDocument(
      await QrAnimate.render({ qrM0: "2[F,F]" }, makeCtx()),
    );
    const sources = getSources(doc);
    for (const s of sources) {
      const overlay = (s as MosaicLavfiSource).overlay;
      expect(overlay).toBeDefined();
      expect(overlay!.alpha).toBeDefined();
      expect(overlay!.xExpr).toBeDefined();
      expect(overlay!.yExpr).toBeDefined();
    }
  });

  it("rank-0 tile's alpha expression starts at t=0", async () => {
    const doc = asDocument(
      await QrAnimate.render({ qrM0: "2[F,F]" }, makeCtx()),
    );
    const s0 = getSources(doc)[0] as MosaicLavfiSource;
    // buildTileAlphaExpr at rank 0 → `(t-0.000)/<fadeSec>`
    expect(s0.overlay!.alpha).toContain("(t-0.000)");
  });

  it("rank-last tile's alpha expression starts at t = spawnDurSec", async () => {
    const doc = asDocument(
      await QrAnimate.render(
        { qrM0: "2[F,F]", spawnDurMs: 1000 },
        makeCtx(),
      ),
    );
    const sourcesArr = getSources(doc);
    const sLast = sourcesArr[sourcesArr.length - 1] as MosaicLavfiSource;
    // Final tile rank == 1 → startSec == spawnDurSec = 1.000.
    expect(sLast.overlay!.alpha).toContain("(t-1.000)");
  });

  it("tile-0 source is a lavfi solid-colour source with the tileColor", async () => {
    const doc = asDocument(
      await QrAnimate.render(
        { qrM0: "2[F,F]", tileColor: "#abc123" as const },
        makeCtx(),
      ),
    );
    const s0 = getSources(doc)[0] as MosaicLavfiSource;
    expect(s0.type).toBe("lavfi");
    expect((s0 as { color?: string }).color).toBe("#abc123");
  });

  it("invalid spawnDurMs returns an error mosaic (out of range)", async () => {
    const doc = asDocument(
      await QrAnimate.render(
        { qrM0: "F", spawnDurMs: 60_001 },
        makeCtx(),
      ),
    );
    // Error path still produces a document; sources won't match the QR shape.
    expect(doc.kind).toBe("mosaic_document");
  });

  it("determinism — two renders with identical props produce identical docs", async () => {
    const props = { qrM0: "2[2(F,F),2(F,F)]", spawnDurMs: 800, tileColor: "#050314" as const };
    const ctxA = makeCtx();
    const ctxB = makeCtx();
    const docA = asDocument(await QrAnimate.render(props, ctxA));
    const docB = asDocument(await QrAnimate.render(props, ctxB));
    // Sources are the only template-controlled part; compare those.
    expect(JSON.stringify(docA.sources)).toBe(JSON.stringify(docB.sources));
    expect(docA.m0).toBe(docB.m0);
  });

  it("moduleBorderRadius=0 (default) — no rounding effect attached to tiles", async () => {
    const doc = asDocument(
      await QrAnimate.render(
        { qrM0: "2[2(F,F),2(F,F)]", spawnDurMs: 800 },
        makeCtx(),
      ),
    );
    for (const s of doc.sources ?? []) {
      if (s.type !== "lavfi") continue;
      expect(s.effects?.rounding).toBeUndefined();
    }
  });

  it("moduleBorderRadius=1.0 — every tile gets a circular rounding effect", async () => {
    const doc = asDocument(
      await QrAnimate.render(
        { qrM0: "2[2(F,F),2(F,F)]", spawnDurMs: 800, moduleBorderRadius: 1.0 },
        makeCtx(),
      ),
    );
    const tiles = (doc.sources ?? []).filter((s) => s.type === "lavfi");
    expect(tiles.length).toBeGreaterThan(0);
    for (const s of tiles) {
      expect((s as { effects?: { rounding?: { borderRadius: number; cornerStyle: string } } }).effects?.rounding).toEqual({
        borderRadius: 1.0,
        cornerStyle: "rounded",
      });
    }
  });
});

describe(`${TEMPLATE_ID} — Step 2 (M region via labels)`, () => {
  // 4-tile 2×2 grid. We'll mark tile 0 as the "safe-area" so the test
  // asserts the safe-area cell becomes a mosaic ref and the other 3
  // stay as module tiles.
  const FIXTURE_M0 = "2[2(F,F),2(F,F)]";

  async function renderWithLabels(safeAreaLogicalIndex: number, extras?: Partial<{
    centreLabel: string;
    mColor: string;
  }>) {
    // Compute the stableKey for the requested logicalIndex by parsing
    // the fixture m0 the same way the template does.
    const { queryFrames } = await import("@m0saic/dsl-stdlib");
    const frames = queryFrames(FIXTURE_M0, { width: 1080, height: 1080 }).logical();
    const targetSk = frames[safeAreaLogicalIndex]!.meta.stableKey as unknown as string;
    const qrLabels = { [targetSk]: { text: extras?.centreLabel ?? "safe-area" } };
    return asDocument(
      await QrAnimate.render(
        {
          qrM0: FIXTURE_M0,
          qrLabels,
          mColor: (extras?.mColor as `#${string}`) ?? ("#f97316" as const),
          ...(extras?.centreLabel ? { centreLabel: extras.centreLabel } : {}),
        },
        makeCtx(),
      ),
    );
  }

  it("labels present + match → safe-area cell becomes a mosaic ref into the M sub-doc", async () => {
    const doc = await renderWithLabels(0);
    const sources = getSources(doc);
    expect(sources).toHaveLength(4);
    expect(sources[0]!.type).toBe("mosaic");
    expect((sources[0] as { ref?: string }).ref).toBe("m_logo");
    for (let i = 1; i < 4; i += 1) {
      expect(sources[i]!.type).toBe("lavfi");
    }
    // The safe-area ref carries no parent overlay — the M sub-doc tiles
    // self-time via their own alpha expressions.
    expect((sources[0] as { overlay?: unknown }).overlay).toBeUndefined();
  });

  it("M sub-doc lands in children.m_logo with 33 masked lavfi sources from brand/m-33", async () => {
    const doc = await renderWithLabels(0);
    const child = doc.children?.m_logo;
    expect(child).toBeDefined();
    const childDoc = child as MosaicDocument;
    expect(childDoc.kind).toBe("mosaic_document");
    expect(childDoc.sources).toHaveLength(33);
    expect(childDoc.sources!.every((s) => s.type === "lavfi")).toBe(true);
    // Each M tile carries its own per-rank loading-UI alpha — base
    // breathing (cos) plus a rank-aware shimmer band (mod).
    for (const s of childDoc.sources!) {
      const a = (s as MosaicLavfiSource).overlay?.alpha ?? "";
      expect(a).toContain("cos(");
      expect(a).toContain("mod(t,");
    }
  });

  it("M sub-doc sources carry inline-mask silhouettes from brand/m-33 in order", async () => {
    const doc = await renderWithLabels(0);
    const child = doc.children!.m_logo as MosaicDocument;
    // brand/m-33 now ships its masks inside its .m0c file, surfaced at
    // runtime as `entry.masks` (keyed by StableKey). The source-order
    // helper resolves each source index to its StableKey, giving us a
    // positional view onto the legacy mask channel.
    const { entries, getSourceOrderStableKeys } = await import("@m0saic/dictionary");
    const entry = entries.byId["brand/m-33"]!;
    const sourceKeys = getSourceOrderStableKeys(entry);
    const masks = sourceKeys.map((k) => entry.masks?.[k] ?? null);
    const maskedIdx = masks.findIndex((m) => m !== null);
    expect(maskedIdx).toBeGreaterThanOrEqual(0);
    const masked = child.sources![maskedIdx] as MosaicLavfiSource & {
      mask?: { kind: string; localPath: string; bounds: { width: number; height: number } };
    };
    expect(masked.mask?.kind).toBe("inline-mask");
    expect(masked.mask?.localPath).toBe(masks[maskedIdx]!.localPath);
    expect(masked.mask?.bounds).toEqual(masks[maskedIdx]!.bounds);
    // Null-mask body cells (StableKeys whose mask entry is null in the
    // .m0c) get no source.mask at all — the engine treats absence + null
    // the same way (no silhouette).
    const unmaskedIdx = masks.findIndex((m) => m === null);
    if (unmaskedIdx >= 0) {
      const unmasked = child.sources![unmaskedIdx] as MosaicLavfiSource & { mask?: unknown };
      expect(unmasked.mask).toBeUndefined();
    }
  });

  it("M sub-doc tiles use mColor", async () => {
    const doc = await renderWithLabels(0, { mColor: "#abcdef" });
    const child = doc.children!.m_logo as MosaicDocument;
    const tile = child.sources![0] as MosaicLavfiSource & { color?: string };
    expect(tile.color).toBe("#abcdef");
  });

  it("default variant 'light' → white backgroundColor on the doc", async () => {
    const doc = asDocument(
      await QrAnimate.render({ qrM0: FIXTURE_M0 }, makeCtx()),
    );
    expect(doc.backgroundColor).toBe("#ffffff");
  });

  it("variant 'dark' → black backgroundColor on the doc", async () => {
    const doc = asDocument(
      await QrAnimate.render({ qrM0: FIXTURE_M0, variant: "dark" }, makeCtx()),
    );
    expect(doc.backgroundColor).toBe("#000000");
  });

  it("explicit bgColor overrides variant default", async () => {
    const doc = asDocument(
      await QrAnimate.render(
        { qrM0: FIXTURE_M0, variant: "dark", bgColor: "#123456" as const },
        makeCtx(),
      ),
    );
    expect(doc.backgroundColor).toBe("#123456");
  });

  it("default tileColor is brand orange", async () => {
    const doc = asDocument(
      await QrAnimate.render({ qrM0: FIXTURE_M0 }, makeCtx()),
    );
    const firstModule = doc.sources![0] as MosaicLavfiSource & { color?: string };
    expect(firstModule.color).toBe("#f97316");
  });

  it("M sub-doc tile entrance gates at modulesEnd + mDelay (1.000 + 0.220 + 0.200 = 1.420s)", async () => {
    const doc = asDocument(
      await QrAnimate.render(
        {
          qrM0: FIXTURE_M0,
          spawnDurMs: 1000,
          tileFadeMs: 220,
          mDelayMs: 200,
          mInDurMs: 500,
          mTileFadeMs: 220,
          qrLabels: await (async () => {
            const { queryFrames } = await import("@m0saic/dsl-stdlib");
            const frames = queryFrames(FIXTURE_M0, { width: 1080, height: 1080 }).logical();
            return {
              [frames[0]!.meta.stableKey as unknown as string]: { text: "safe-area" },
            };
          })(),
        },
        makeCtx(),
      ),
    );
    // The rank-0 M tile's entrance smoothstep gates at exactly mStartSec
    // = modulesEnd (1.220) + mDelay (0.200) = 1.420s.
    const child = doc.children!.m_logo as MosaicDocument;
    const rank0Alpha = (child.sources![0] as MosaicLavfiSource).overlay?.alpha ?? "";
    expect(rank0Alpha).toContain("(t-1.420)");
  });

  it("module alpha includes exit smoothstep at exitStart", async () => {
    // exitStart = spawnDur + tileFade + mDelay + mInDur + idleDur
    //           = 1000 + 220 + 200 + 500 + 1500 = 3420ms = 3.420s
    const doc = asDocument(
      await QrAnimate.render(
        {
          qrM0: FIXTURE_M0,
          spawnDurMs: 1000,
          tileFadeMs: 220,
          mDelayMs: 200,
          mInDurMs: 500,
          idleDurMs: 1500,
          fadeOutDurMs: 700,
        },
        makeCtx(),
      ),
    );
    // No labels → all tiles are modules; each module expression includes
    // a `(t-3.420)` exit gate.
    for (const s of getSources(doc) as MosaicLavfiSource[]) {
      expect(s.overlay?.alpha).toContain("(t-3.420)");
    }
  });

  it("labels present but no match → degrades to module-only behavior", async () => {
    const doc = asDocument(
      await QrAnimate.render(
        {
          qrM0: FIXTURE_M0,
          qrLabels: { "r/nonexistent": { text: "safe-area" } },
        },
        makeCtx(),
      ),
    );
    const sources = getSources(doc);
    expect(sources.every((s) => s.type === "lavfi")).toBe(true);
    expect(doc.children).toBeUndefined();
    // No M-phase overlay anywhere — all alphas are module entrance smoothsteps.
    for (const s of sources) {
      const alpha = (s as MosaicLavfiSource).overlay?.alpha ?? "";
      expect(alpha).not.toContain("if(lt(t,");
      expect(alpha).not.toContain("cos(");
    }
  });

  it("custom centreLabel finds the right cell", async () => {
    // Label tile 2 as "m-slot" (custom centreLabel).
    const doc = await renderWithLabels(2, { centreLabel: "m-slot" });
    const sources = getSources(doc);
    expect(sources[2]!.type).toBe("mosaic");
    // Other tiles stay as modules.
    expect(sources[0]!.type).toBe("lavfi");
    expect(sources[1]!.type).toBe("lavfi");
    expect(sources[3]!.type).toBe("lavfi");
  });

  it("safe-area excluded from module rank set — remaining 3 modules span ranks 0, 0.5, 1", async () => {
    // Safe-area at logicalIndex 0 (TL). The 3 module tiles get diagonal
    // ranks based on their (x, y) — order in the source array reflects
    // DFS logical order, not rank order. We just assert the rank SET
    // covers [0, 0.5, 1] (one tile at each end + one in the middle).
    const doc = await renderWithLabels(0);
    const moduleSources = getSources(doc).slice(1) as MosaicLavfiSource[];
    expect(moduleSources).toHaveLength(3);
    const alphas = moduleSources.map((s) => s.overlay?.alpha ?? "");
    expect(alphas.some((a) => a.includes("(t-0.000)"))).toBe(true);
    expect(alphas.some((a) => a.includes("(t-1.000)"))).toBe(true);
    // The middle rank (0.5) → start time 0.500.
    expect(alphas.some((a) => a.includes("(t-0.500)"))).toBe(true);
  });
});

describe(`${TEMPLATE_ID} — rounded finder eyes`, () => {
  // A uniform N×N all-F grid with no quiet zone, so the three finder
  // regions land on real cells. matrixSize=15 keeps the finders (7×7 at
  // the three corners) disjoint.
  const MSIZE = 15;
  const QZ = 0;
  function allFGrid(n: number): string {
    const row = `${n}(` + new Array(n).fill("F").join(",") + ")";
    return `${n}[` + new Array(n).fill(row).join(",") + "]";
  }
  const GRID = allFGrid(MSIZE); // 15×15 = 225 F cells
  const FINDER_CELLS = 3 * 7 * 7; // 147 cells across the three finders

  function roundedTiles(doc: MosaicDocument): MosaicLavfiSource[] {
    return getSources(doc).filter(
      (s): s is MosaicLavfiSource =>
        s.type === "lavfi" && s.effects?.rounding !== undefined,
    );
  }

  it("eyes unset → no eye rounding; plain per-cell behavior", async () => {
    const doc = asDocument(
      await QrAnimate.render(
        { qrM0: GRID, matrixSize: MSIZE, quietZone: QZ },
        makeCtx(),
      ),
    );
    expect(getSources(doc)).toHaveLength(MSIZE * MSIZE); // 225, no added frames
    expect(roundedTiles(doc)).toHaveLength(0);
  });

  it("eyes:true → overlays 9 eye frames (3 concentric layers × 3 finders)", async () => {
    const plain = asDocument(
      await QrAnimate.render(
        { qrM0: GRID, matrixSize: MSIZE, quietZone: QZ },
        makeCtx(),
      ),
    );
    const eyed = asDocument(
      await QrAnimate.render(
        { qrM0: GRID, matrixSize: MSIZE, quietZone: QZ, eyes: true },
        makeCtx(),
      ),
    );
    // 3 finders × (outer + inner-light + centre dot) = 9 new leaves.
    expect(getSources(eyed).length - getSources(plain).length).toBe(9);
    // Exactly those 9 carry rounding (modules default to no rounding):
    // 6 at the outer/inner-light radius (0.35) + 3 circular dots (1.0).
    const rounded = roundedTiles(eyed);
    expect(rounded).toHaveLength(9);
    const radii = rounded.map((s) => s.effects!.rounding!.borderRadius).sort();
    expect(radii.filter((r) => r === 1.0)).toHaveLength(3); // dots
    expect(radii.filter((r) => r === 0.35)).toHaveLength(6); // outer + ring
  });

  it("eyes:true → underlying finder cells are suppressed (fully transparent)", async () => {
    const eyed = asDocument(
      await QrAnimate.render(
        { qrM0: GRID, matrixSize: MSIZE, quietZone: QZ, eyes: true },
        makeCtx(),
      ),
    );
    const transparent = getSources(eyed).filter(
      (s) => s.type === "lavfi" && (s as MosaicLavfiSource).overlay?.alpha === "0",
    );
    expect(transparent).toHaveLength(FINDER_CELLS); // 147 hidden finder cells
  });

  it("eyes object → custom corner radii are honored", async () => {
    const eyed = asDocument(
      await QrAnimate.render(
        {
          qrM0: GRID,
          matrixSize: MSIZE,
          quietZone: QZ,
          eyes: { outerBorderRadius: 0.2, innerDotBorderRadius: 0.9 },
        },
        makeCtx(),
      ),
    );
    const radii = roundedTiles(eyed).map((s) => s.effects!.rounding!.borderRadius);
    expect(radii.filter((r) => r === 0.9)).toHaveLength(3); // custom dots
    // outer + inner-light default to the custom outer radius (0.2).
    expect(radii.filter((r) => r === 0.2)).toHaveLength(6);
  });

  it("determinism — identical eyes props produce identical sources", async () => {
    const props = {
      qrM0: GRID,
      matrixSize: MSIZE,
      quietZone: QZ,
      eyes: true as const,
    };
    const a = asDocument(await QrAnimate.render(props, makeCtx()));
    const b = asDocument(await QrAnimate.render(props, makeCtx()));
    expect(JSON.stringify(a.sources)).toBe(JSON.stringify(b.sources));
    expect(a.m0).toBe(b.m0);
  });

  it("eyes + real brand QR → M safe-area ref preserved AND eyes rendered", async () => {
    const { registry } = await import("@m0saic/dictionary");
    const qr = registry.byId["brand/qr"];
    expect(qr).toBeDefined();
    const doc = asDocument(
      await QrAnimate.render(
        { qrM0: qr!.m0, qrLabels: qr!.labels, eyes: true },
        makeCtx({ width: 1222, height: 1222 }),
      ),
    );
    const sources = getSources(doc);
    // The centre safe-area cell still dispatches to the M sub-doc…
    expect(sources.some((s) => s.type === "mosaic")).toBe(true);
    expect(doc.children?.m_logo).toBeDefined();
    // …and the three rounded eyes are present (9 rounded tiles).
    expect(roundedTiles(doc)).toHaveLength(9);
  });
});
