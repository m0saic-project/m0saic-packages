import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicTemplate,
} from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import { autoCompactRenderable } from "./autoCompactRenderable";
import { defineMosaicTemplate } from "../template/defineMosaicTemplate";

const TARGET = { width: 1000, height: 100 };
// weights [2,8] — reduces to 5(1,0,0,0,1) losslessly at a 1000px canvas.
const REDUCIBLE = "10(0,1,0,0,0,0,0,0,0,1)";
const REDUCED = "5(1,0,0,0,1)";

function doc(overrides?: Partial<MosaicDocument>): MosaicDocument {
  return {
    kind: "mosaic_document",
    version: 1,
    m0: toM0String(REDUCIBLE),
    assets: {} as any,
    sources: [] as any,
    ...overrides,
  };
}

describe("autoCompactRenderable", () => {
  test("reduces a reducible top-level split at the render target", () => {
    const out = autoCompactRenderable(doc(), TARGET, { skip: false }) as MosaicDocument;
    expect(out.m0).toBe(REDUCED);
  });

  test("strips pure-null layers", () => {
    const out = autoCompactRenderable(
      doc({ m0: toM0String("2(1,1){2(-,-)}"), size: TARGET }),
      TARGET,
      { skip: false },
    ) as MosaicDocument;
    expect(out.m0).toBe("2(1,1)");
  });

  test("template-level skip leaves m0 verbatim", () => {
    const out = autoCompactRenderable(doc(), TARGET, { skip: true }) as MosaicDocument;
    expect(out.m0).toBe(REDUCIBLE);
  });

  test("document-level engine.skipAutoCompact leaves m0 verbatim", () => {
    const out = autoCompactRenderable(
      doc({ engine: { skipAutoCompact: true } }),
      TARGET,
      { skip: false },
    ) as MosaicDocument;
    expect(out.m0).toBe(REDUCIBLE);
  });

  test("uses the document's own size over the render target fallback", () => {
    // At width 13 the reduction would drift → strict mode skips it.
    const out = autoCompactRenderable(
      doc({ size: { width: 13, height: 100 } }),
      TARGET,
      { skip: false },
    ) as MosaicDocument;
    expect(out.m0).toBe(REDUCIBLE);
  });

  test("migrates per-cell labels along the rekey map", () => {
    // The two claimants in the 10-split live at child indices 1 and 9; after
    // reduction they move to 0 and 4, so their stableKeys change.
    const before = autoCompactRenderable(doc(), TARGET, { skip: false }) as MosaicDocument;
    // Build labels keyed by the ORIGINAL claimant keys, then re-run with them.
    // Easiest: render the original, grab a claimant key, label it, compact.
    const labels = { "r/fc1": "first", "r/fc9": "second" };
    const out = autoCompactRenderable(
      doc({ labels }),
      TARGET,
      { skip: false },
    ) as MosaicDocument;
    expect(out.m0).toBe(REDUCED);
    // Labels survive (migrated to new keys) — values preserved, none lost.
    expect(Object.values(out.labels ?? {}).sort()).toEqual(["first", "second"]);
    void before;
  });

  test("compacts a sized child but leaves an unsized child untouched", () => {
    const out = autoCompactRenderable(
      doc({
        m0: toM0String("2(1,1)"),
        size: TARGET,
        children: {
          sized: doc({ m0: toM0String(REDUCIBLE), size: TARGET }),
          unsized: doc({ m0: toM0String(REDUCIBLE) }),
        },
      }),
      TARGET,
      { skip: false },
    ) as MosaicDocument;
    const children = out.children as Record<string, MosaicDocument>;
    expect(children.sized.m0).toBe(REDUCED);
    expect(children.unsized.m0).toBe(REDUCIBLE);
  });
});

describe("defineMosaicTemplate auto-compaction", () => {
  function ctx(): MosaicEngineContext {
    return {
      mode: "render" as const,
      output: { ...TARGET, fps: 30, durationMs: 1000, workspaceDir: "/tmp/m0saic-test" },
      target: { ...TARGET, fps: 30, durationMs: 1000 },
      media: {},
      cache: { get: jest.fn(), set: jest.fn(), getOrCompute: jest.fn() } as any,
    } as any;
  }

  function makeTemplate(skipAutoCompact?: boolean): MosaicTemplate<any> {
    return defineMosaicTemplate<any>({
      id: "test/auto-compact" as any,
      label: "Auto-compact test",
      description: "test fixture",
      tags: ["test"],
      version: 1,
      ...(skipAutoCompact != null ? { skipAutoCompact } : {}),
      capabilities: { tier: "core" } as any,
      propsSchema: {},
      defaultProps: {},
      render: async () =>
        ({
          kind: "mosaic_document",
          version: 1,
          m0: toM0String(REDUCIBLE),
          assets: {} as any,
          sources: [] as any,
        }) as MosaicDocument,
    } as any);
  }

  test("render output is auto-compacted by default", async () => {
    const out = (await makeTemplate().render({}, ctx())) as MosaicDocument;
    expect(out.m0).toBe(REDUCED);
  });

  test("skipAutoCompact:true returns verbatim geometry", async () => {
    const out = (await makeTemplate(true).render({}, ctx())) as MosaicDocument;
    expect(out.m0).toBe(REDUCIBLE);
  });

  test("source-carried prop bindings survive the re-key untouched", async () => {
    // Compaction rewrites `m0` (and migrates `labels`) but never touches
    // `sources` — so a binding on a source needs no migration to stay aligned
    // with whatever stableKey its frame gets after the re-key.
    const binding = { propKey: "labels", index: 1 };
    const tmpl = defineMosaicTemplate<any>({
      id: "test/auto-compact-binding" as any,
      label: "Auto-compact binding test",
      description: "test fixture",
      tags: ["test"],
      version: 1,
      capabilities: { tier: "core" } as any,
      propsSchema: {},
      defaultProps: {},
      render: async () =>
        ({
          kind: "mosaic_document",
          version: 1,
          m0: toM0String(REDUCIBLE),
          assets: {} as any,
          sources: [
            { type: "lavfi", color: "#000000", editor: { label: "a", binding } },
            { type: "lavfi", color: "#ffffff", editor: { binding: { propKey: "title" } } },
          ] as any,
        }) as MosaicDocument,
    } as any);
    const out = (await tmpl.render({}, ctx())) as MosaicDocument;
    expect(out.m0).toBe(REDUCED);
    // (the wrapper also stamps `owner` on every source — irrelevant here)
    expect((out.sources[0] as any).editor).toMatchObject({ label: "a", binding });
    expect((out.sources[0] as any).editor.binding).toEqual(binding);
    expect((out.sources[1] as any).editor.binding).toEqual({ propKey: "title" });
  });
});
