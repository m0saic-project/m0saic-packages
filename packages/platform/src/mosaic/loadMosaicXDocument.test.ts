import * as path from "path";
import { loadMosaicXDocument } from "./loadMosaicXDocument";
import type {
  MosaicAsset,
  MosaicXDocument,
  MosaicXPipeline,
} from "@m0saic/types";

const abs = (...segments: string[]): string => path.resolve(...segments);
const DEF = abs("/proj/chain.mosaicx");

const pathOf = (doc: unknown, id: string): string => {
  const entry = (doc as { assets?: Record<string, MosaicAsset> }).assets?.[id];
  return entry && entry.kind === "file" ? (entry as { path: string }).path : "";
};

/** Minimal source-form doc; `m0` deliberately pretty so the read-time
 *  canonicalization is observable. */
const mosaicxDoc = (over: Record<string, unknown> = {}) => ({
  kind: "mosaicx_document",
  version: 1,
  m0: "2[F,F]",
  assets: {},
  sources: [],
  ...over,
});

describe("loadMosaicXDocument — accepted roots", () => {
  it("loads a mosaicx_document and canonicalizes its m0", () => {
    const doc = loadMosaicXDocument(JSON.stringify(mosaicxDoc()), DEF);
    expect(doc.kind).toBe("mosaicx_document");
    expect((doc as MosaicXDocument).m0).toBe("2[1,1]");
  });

  it("loads a mosaicx_pipeline root and canonicalizes every step file's m0", () => {
    const raw = JSON.stringify({
      kind: "mosaicx_pipeline",
      version: 1,
      steps: [
        { durationMs: 1000, file: mosaicxDoc() },
        { durationMs: 1000, file: mosaicxDoc({ m0: "F" }) },
      ],
    });
    const chain = loadMosaicXDocument(raw, DEF) as MosaicXPipeline;
    expect(chain.kind).toBe("mosaicx_pipeline");
    const files = chain.steps.map((s) => s.file as MosaicXDocument);
    expect(files[0].m0).toBe("2[1,1]");
    expect(files[1].m0).toBe("1");
  });

  it("absolutizes step-file asset paths against the .mosaicx's own directory", () => {
    const raw = JSON.stringify({
      kind: "mosaicx_pipeline",
      version: 1,
      steps: [
        {
          durationMs: 1000,
          file: mosaicxDoc({ assets: { hero: { kind: "file", path: "hero.mp4" } } }),
        },
      ],
    });
    const chain = loadMosaicXDocument(raw, DEF) as MosaicXPipeline;
    expect(pathOf(chain.steps[0].file, "hero")).toBe(abs("/proj/hero.mp4"));
  });
});

describe("loadMosaicXDocument — rejected roots", () => {
  it.each(["mosaic_document", "mosaic_pipeline"])(
    "rejects the already-resolved kind %s",
    (kind) => {
      const raw = JSON.stringify({ kind, version: 1, m0: "1", assets: {}, sources: [] });
      expect(() => loadMosaicXDocument(raw, DEF)).toThrow(
        /expected kind="mosaicx_document" or "mosaicx_pipeline"/,
      );
    },
  );

  it("names both accepted kinds when the envelope carries no kind at all", () => {
    expect(() => loadMosaicXDocument(JSON.stringify({ version: 1 }), DEF)).toThrow(
      /got "\(unset\)"/,
    );
  });

  it("rejects a non-object payload", () => {
    expect(() => loadMosaicXDocument("42", DEF)).toThrow(/got "number"/);
  });

  it("propagates invalid m0 from a step file (the read-time gate)", () => {
    const raw = JSON.stringify({
      kind: "mosaicx_pipeline",
      version: 1,
      steps: [{ durationMs: 1000, file: mosaicxDoc({ m0: "2[1]" }) }],
    });
    expect(() => loadMosaicXDocument(raw, DEF)).toThrow(/invalid m0 layout/);
  });
});
