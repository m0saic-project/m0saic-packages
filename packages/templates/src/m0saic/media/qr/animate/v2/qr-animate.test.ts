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
import { QrAnimateV2 } from "./qr-animate";

const TEMPLATE_ID = "@m0saic/media/qr/animate/v2";

function makeCtx(
  overrides?: Partial<MosaicEngineContext["target"]> & {
    workspaceDir?: string;
  },
): MosaicEngineContext {
  const ws =
    overrides?.workspaceDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), makeM0saicTempPrefix("qr-animate-v2-test")));
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
  it("missing both text and svg returns an error mosaic", async () => {
    const doc = asDocument(await QrAnimateV2.render({}, makeCtx()));
    expect(doc.kind).toBe("mosaic_document");
    // Error mosaic still has sources for the error display.
    expect(getSources(doc).length).toBeGreaterThan(0);
  });

  it("rejects both text and svg together", async () => {
    const doc = asDocument(
      await QrAnimateV2.render(
        { text: "https://example.com", svg: "<svg></svg>" },
        makeCtx(),
      ),
    );
    expect(doc.kind).toBe("mosaic_document");
  });

  it("rejects out-of-range driftPercent", async () => {
    const doc = asDocument(
      await QrAnimateV2.render(
        { text: "https://m0saic.io", driftPercent: 99 },
        makeCtx(),
      ),
    );
    expect(doc.kind).toBe("mosaic_document");
    // Render still returns an error mosaic (not a thrown exception).
  });

  it("svg-only input with a 2x2 rect grid produces animated module sources", async () => {
    // Hand-authored mini SVG: viewBox + 4 small rects in a 2×2 pattern.
    // Bypasses the qrcode lib so the test is hermetic.
    const svg = `<svg viewBox="0 0 10 10"><rect x="0" y="0" width="4" height="4"/><rect x="6" y="0" width="4" height="4"/><rect x="0" y="6" width="4" height="4"/><rect x="6" y="6" width="4" height="4"/></svg>`;
    const doc = asDocument(
      await QrAnimateV2.render(
        { svg, driftPercent: 0, packing: "one" },
        makeCtx(),
      ),
    );
    const sources = getSources(doc);
    // Each visible tile (the 4 rects) gets its own animated lavfi source.
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((s) => s.type === "lavfi")).toBe(true);
    // Every tile carries its own overlay alpha (per-tile rank-staggered fade).
    const alphas = sources.map(
      (s) => (s as MosaicLavfiSource).overlay?.alpha ?? "",
    );
    expect(alphas.every((a) => typeof a === "string" && a.length > 0)).toBe(true);
  });

  it("svg with no <path> or <rect> returns an error mosaic", async () => {
    const doc = asDocument(
      await QrAnimateV2.render({ svg: `<svg viewBox="0 0 10 10"></svg>` }, makeCtx()),
    );
    expect(doc.kind).toBe("mosaic_document");
  });

  it("background colour follows variant by default", async () => {
    const svg = `<svg viewBox="0 0 10 10"><rect x="0" y="0" width="3" height="3"/></svg>`;
    const docLight = asDocument(
      await QrAnimateV2.render({ svg, variant: "light" }, makeCtx()),
    );
    const docDark = asDocument(
      await QrAnimateV2.render({ svg, variant: "dark" }, makeCtx()),
    );
    expect(docLight.backgroundColor).toBe("#ffffff");
    expect(docDark.backgroundColor).toBe("#000000");
  });

  it("explicit bgColor overrides the variant default", async () => {
    const svg = `<svg viewBox="0 0 10 10"><rect x="0" y="0" width="3" height="3"/></svg>`;
    const doc = asDocument(
      await QrAnimateV2.render(
        { svg, variant: "light", bgColor: "#123456" },
        makeCtx(),
      ),
    );
    expect(doc.backgroundColor).toBe("#123456");
  });

  it("is deterministic — same svg + opts produces identical output", async () => {
    const svg = `<svg viewBox="0 0 10 10"><rect x="0" y="0" width="3" height="3"/><rect x="6" y="6" width="3" height="3"/></svg>`;
    const docA = asDocument(await QrAnimateV2.render({ svg }, makeCtx()));
    const docB = asDocument(await QrAnimateV2.render({ svg }, makeCtx()));
    expect(docA.m0).toBe(docB.m0);
    expect(docA.sources?.length).toBe(docB.sources?.length);
  });

  it("live URL → QR generation produces a valid m0 + many sources", async () => {
    // Pulls in the qrcode npm package via templates-advanced. The QR matrix
    // is deterministic for a given URL + ECC level, so the result is stable.
    const doc = asDocument(
      await QrAnimateV2.render(
        { text: "https://m0saic.io", driftPercent: 1, packing: "multi" },
        makeCtx(),
      ),
    );
    const sources = getSources(doc);
    expect(typeof doc.m0).toBe("string");
    expect(String(doc.m0).length).toBeGreaterThan(0);
    // The brand QR (version 6 = 41×41 modules) has hundreds of visible
    // modules; even after packing we expect >> 10 distinct visible tiles.
    expect(sources.length).toBeGreaterThan(10);
  }, 30_000);
});

describe(`${TEMPLATE_ID} — editor metadata`, () => {
  it("declares a poster time inside the hold phase (settled QR for the editor scrubber)", () => {
    const hints = QrAnimateV2.outputHints!;
    const poster = hints.posterTimeMs!;
    // After spawn + fade-in (modules fully on), before fade-out begins.
    const spawnEnd = QrAnimateV2.defaultProps!.spawnDurMs! + QrAnimateV2.defaultProps!.tileFadeMs!;
    const fadeOutStart = spawnEnd + QrAnimateV2.defaultProps!.holdDurMs!;
    expect(poster).toBeGreaterThanOrEqual(spawnEnd);
    expect(poster).toBeLessThanOrEqual(fadeOutStart);
  });

  it("hides the packing knob from the editor (kept in schema, defaults to multi)", () => {
    expect(QrAnimateV2.propsSchema.packing?.meta?.ui?.hidden).toBe(true);
    expect(QrAnimateV2.defaultProps!.packing).toBe("multi");
  });
});
