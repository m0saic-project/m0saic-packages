/**
 * Type-level smoke tests for MosaicFileMeta.
 *
 * MosaicFileMeta is the user-authored content metadata block,
 * structurally identical to M0FileMeta from `@m0saic/dsl-file-formats`.
 * File-lifecycle stamps (created/app/appVersion) live at the top
 * level of MosaicDocument / MosaicDocumentPipeline, NOT in this type.
 */
import type {
  MosaicFileMeta,
  MosaicGeometryEditRecord,
  MosaicRenderableEditorMeta,
  MosaicSourceEditorMeta,
} from "./meta";

describe("MosaicFileMeta", () => {
  it("accepts the empty object (all fields optional)", () => {
    const m: MosaicFileMeta = {};
    expect(m).toEqual({});
  });

  it("accepts every documented field", () => {
    const m: MosaicFileMeta = {
      title: "Launch hero",
      author: "createwithm0saic@gmail.com",
      source: "@m0saic/hero/ffmpeg-pulse/title/v1",
      note: "Render for Q2 launch",
    };
    expect(m.title).toBe("Launch hero");
    expect(m.source).toBe("@m0saic/hero/ffmpeg-pulse/title/v1");
  });

  it("matches M0FileMeta's shape (title, author, source, note)", () => {
    // Compile-time: every field on this type should also be a valid
    // field of M0FileMeta — they are structurally identical by design.
    const m: MosaicFileMeta = {
      title: "x",
      author: "y",
      source: "z",
      note: "w",
    };
    const keys = Object.keys(m).sort();
    expect(keys).toEqual(["author", "note", "source", "title"]);
  });

  it("does NOT carry file-lifecycle stamps (those live at doc top-level)", () => {
    // Compile-time: these fields would compile-error if present on
    // MosaicFileMeta. They belong on MosaicDocument / MosaicDocumentPipeline
    // top-level, matching the M0File / M0cFile / M0pFile pattern.
    const m: MosaicFileMeta = {};
    expect("created" in m).toBe(false);
    expect("app" in m).toBe(false);
    expect("appVersion" in m).toBe(false);
  });
});

describe("MosaicGeometryEditRecord", () => {
  it("accepts a full move_subtree record", () => {
    const r: MosaicGeometryEditRecord = {
      kind: "move_subtree",
      fromKey: "r/gcolc0/growc1",
      toKey: "r/ov1c0/growc2/fc1",
      prevRect: { x: 0, y: 0, w: 480, h: 270 },
      nextRect: { x: 960, y: 540, w: 480, h: 270 },
      canvas: { w: 1920, h: 1080 },
      movedSourceCount: 3,
      at: "2026-07-06T00:00:00.000Z",
    };
    expect(r.kind).toBe("move_subtree");
    expect(r.movedSourceCount).toBe(3);
  });

  it("rides on MosaicRenderableEditorMeta.geometryEdits (editor-only slot)", () => {
    const editor: MosaicRenderableEditorMeta = {
      owner: "user",
      geometryEdits: [
        {
          kind: "move_rect_only",
          fromKey: "r/fc0",
          toKey: "r/ov1c0/fc0",
          prevRect: { x: 0, y: 0, w: 100, h: 100 },
          nextRect: { x: 50, y: 50, w: 100, h: 100 },
          canvas: { w: 200, h: 200 },
          movedSourceCount: 1,
        },
      ],
    };
    expect(editor.geometryEdits).toHaveLength(1);
    expect(editor.geometryEdits?.[0]?.kind).toBe("move_rect_only");
  });

  it("accepts a V2 rebuild record with scope + z + nodes", () => {
    const r: MosaicGeometryEditRecord = {
      kind: "rebuild",
      fromKey: "r/gcolc1",
      toKey: "r/ov1c0",
      prevRect: { x: 0, y: 0, w: 500, h: 800 },
      nextRect: { x: 0, y: 0, w: 300, h: 800 },
      canvas: { w: 1000, h: 800 },
      movedSourceCount: 2,
      scope: "subtree",
      z: { op: "front", prevPaintIndex: 0, nextPaintIndex: 3 },
      nodes: [
        {
          fromKey: "r/gcolc1/fc0",
          toKey: "r/fc7",
          prevRect: { x: 0, y: 0, w: 500, h: 400 },
          nextRect: { x: 0, y: 0, w: 300, h: 400 },
        },
      ],
      at: "2026-07-06T12:00:00.000Z",
    };
    expect(r.kind).toBe("rebuild");
    expect(r.scope).toBe("subtree");
    expect(r.z?.op).toBe("front");
    expect(r.nodes).toHaveLength(1);
  });

  it("V1 records leave the rebuild fields absent", () => {
    const r: MosaicGeometryEditRecord = {
      kind: "move_subtree",
      fromKey: "r/a",
      toKey: "r/b",
      prevRect: { x: 0, y: 0, w: 10, h: 10 },
      nextRect: { x: 1, y: 1, w: 10, h: 10 },
      canvas: { w: 100, h: 100 },
      movedSourceCount: 1,
    };
    expect(r.scope).toBeUndefined();
    expect(r.z).toBeUndefined();
    expect(r.nodes).toBeUndefined();
  });
});

describe("MosaicSourceEditorMeta — binding.onClear", () => {
  it("accepts the two clear actions on `binding` and on `bindings[]`", () => {
    const m: MosaicSourceEditorMeta = {
      binding: { propKey: "days", path: [2, "day"], kind: "number", onClear: "remove-element" },
      bindings: [
        { propKey: "days", path: [2, "day"], kind: "number", onClear: "remove-element" },
        { propKey: "days", path: [2, "title"], kind: "string", onClear: "unset-leaf" },
        { propKey: "days", path: [2, "note"], kind: "string" },
      ],
    };
    expect(m.binding?.onClear).toBe("remove-element");
    expect(m.bindings?.map((b) => b.onClear)).toEqual(["remove-element", "unset-leaf", undefined]);
    // seedDraft: the prefill for an EMPTY leaf (an add handle) — a string
    const seeded: MosaicSourceEditorMeta = {
      binding: { propKey: "days", path: [6, "day"], kind: "number", onClear: "remove-element", seedDraft: "17" },
      bindings: [{ propKey: "days", path: [6, "day"], kind: "number", seedDraft: "17" }, { propKey: "days", path: [6, "title"], kind: "string" }],
    };
    expect(seeded.binding?.seedDraft).toBe("17");
    expect(seeded.bindings?.map((b) => b.seedDraft)).toEqual(["17", undefined]);
  });
});
