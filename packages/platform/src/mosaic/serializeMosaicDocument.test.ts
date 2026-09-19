import {
  canonicalizeDocM0,
  canonicalizeRenderableM0InPlace,
  serializeMosaicDocument,
  serializeMosaicXDocument,
} from "./serializeMosaicDocument";
import { loadMosaicDocument } from "./loadMosaicDocument";
import type {
  MosaicDocument,
  MosaicXDocument,
  MosaicXPipeline,
} from "@m0saic/types";

function doc(m0: string, children?: MosaicDocument["children"]): MosaicDocument {
  const d: MosaicDocument = {
    kind: "mosaic_document",
    size: { width: 640, height: 360 },
    version: 1,
    m0: m0 as MosaicDocument["m0"],
    assets: {} as MosaicDocument["assets"],
    sources: [],
  };
  if (children) d.children = children;
  return d;
}

/** A source-form doc carrying pretty (expanded) m0, for the x-paths. */
function mosaicxDoc(m0: string): MosaicXDocument {
  return {
    kind: "mosaicx_document",
    version: 1,
    m0: m0 as MosaicXDocument["m0"],
    assets: {} as MosaicXDocument["assets"],
    sources: [],
  };
}

/** A root-level chain: `mosaicx_pipeline` whose steps are source-form docs. */
function mosaicxPipeline(): MosaicXPipeline {
  return {
    kind: "mosaicx_pipeline",
    version: 1,
    steps: [
      { durationMs: 1000, file: mosaicxDoc("2[F,F]") },
      { durationMs: 1000, file: mosaicxDoc("F") },
    ],
  };
}

describe("canonicalizeDocM0", () => {
  it("accepts pretty input and returns canonical", () => {
    expect(canonicalizeDocM0("t", "2[F,F]")).toBe("2[1,1]");
  });
  it("throws on invalid m0", () => {
    expect(() => canonicalizeDocM0("t", "2[1]")).toThrow(/invalid m0 layout/);
  });
  it("throws on empty m0", () => {
    expect(() => canonicalizeDocM0("t", "   ")).toThrow(/cannot be empty/);
  });
});

describe("serializeMosaicDocument", () => {
  it("canonicalizes the top-level m0 on emit", () => {
    const out = JSON.parse(serializeMosaicDocument(doc("2[F,F]")));
    expect(out.m0).toBe("2[1,1]");
  });

  it("canonicalizes nested children m0 recursively", () => {
    const parent = doc("2[F,F]", {
      c0: doc("3[F,2[F,F],F]"),
    });
    const out = JSON.parse(serializeMosaicDocument(parent));
    expect(out.m0).toBe("2[1,1]");
    expect(out.children.c0.m0).toBe("3[1,2[1,1],1]");
  });

  it("throws when any nested m0 is invalid", () => {
    const parent = doc("1", { c0: doc("2[1]") });
    expect(() => serializeMosaicDocument(parent)).toThrow(/invalid m0 layout/);
  });

  it("does not mutate the caller's document", () => {
    const d = doc("F");
    serializeMosaicDocument(d);
    expect(d.m0).toBe("F"); // input left untouched; only the clone is canonicalized
  });

  it("canonicalizes pipeline steps", () => {
    const pipe = {
      kind: "mosaic_pipeline",
      version: 1,
      steps: [{ file: doc("2[F,F]") }, { file: doc("F") }],
    } as unknown as Parameters<typeof serializeMosaicDocument>[0];
    const out = JSON.parse(serializeMosaicDocument(pipe));
    expect(out.steps[0].file.m0).toBe("2[1,1]");
    expect(out.steps[1].file.m0).toBe("1");
  });
});

describe("serializeMosaicXDocument", () => {
  it("canonicalizes the placeholder m0 of a template-invocation doc", () => {
    const mx: MosaicXDocument = {
      kind: "mosaicx_document",
      version: 1,
      m0: "F" as MosaicXDocument["m0"],
      assets: {} as MosaicXDocument["assets"],
      sources: [],
    };
    expect(JSON.parse(serializeMosaicXDocument(mx)).m0).toBe("1");
  });

  it("canonicalizes step files under a mosaicx_pipeline root", () => {
    const chain = mosaicxPipeline();
    const out = JSON.parse(serializeMosaicXDocument(chain));
    expect(out.kind).toBe("mosaicx_pipeline");
    expect(out.steps[0].file.m0).toBe("2[1,1]");
    expect(out.steps[1].file.m0).toBe("1");
  });

  it("throws when a mosaicx_pipeline step carries invalid m0", () => {
    const chain = mosaicxPipeline();
    (chain.steps[0].file as MosaicXDocument).m0 = "2[1]" as MosaicXDocument["m0"];
    expect(() => serializeMosaicXDocument(chain)).toThrow(/invalid m0 layout/);
  });

  it("round-trips a mosaicx_pipeline: serialize → parse → serialize is stable", () => {
    const first = serializeMosaicXDocument(mosaicxPipeline());
    const second = serializeMosaicXDocument(JSON.parse(first));
    expect(second).toBe(first);
    // …and the second pass is a no-op because the first already
    // canonicalized: the "F" the fixture authored is gone for good.
    expect(first).not.toContain('"F"');
  });
});

describe("loadMosaicDocument canonicalizes on read", () => {
  it("accepts pretty m0 in a file and returns canonical", () => {
    const raw = JSON.stringify(doc("2[F,F]"));
    const loaded = loadMosaicDocument(raw, "/tmp/x.mosaic") as MosaicDocument;
    expect(loaded.m0).toBe("2[1,1]");
  });

  it("rejects a file carrying invalid m0", () => {
    const raw = JSON.stringify(doc("2[1,1,1]"));
    expect(() => loadMosaicDocument(raw, "/tmp/x.mosaic")).toThrow(/invalid m0 layout/);
  });
});

describe("canonicalizeRenderableM0InPlace", () => {
  it("ignores non-document nodes", () => {
    expect(() => canonicalizeRenderableM0InPlace(null)).not.toThrow();
    expect(() => canonicalizeRenderableM0InPlace({ kind: "other" })).not.toThrow();
  });
});

describe("gate-28 boundary law: a root document always has a canvas", () => {
  it("serializing a sizeless root mosaic_document throws", () => {
    expect(() =>
      serializeMosaicDocument({
        kind: "mosaic_document",
        version: 1,
        m0: "F",
        assets: {},
        sources: [],
      } as never),
    ).toThrow(/root mosaic_document has no canvas/);
  });

  it("pipelines are exempt (steps size per rule 4)", () => {
    expect(() =>
      serializeMosaicDocument({
        kind: "mosaic_pipeline",
        version: 1,
        emit: "multi",
        steps: [],
      } as never),
    ).not.toThrow();
  });
});
