/**
 * Type-level smoke tests for MosaicSource, focusing on the new
 * MosaicRefSource intra-job mirror variant.
 */
import type {
  MosaicDataSource,
  MosaicRefSource,
  MosaicSource,
} from "./source";
import { asAssetId } from "../asset";
import { asAliasId, asFlattenedStableKey } from "../identifiers";

describe("MosaicRefSource", () => {
  it("accepts the minimal mirror shape (flattenedStableKey only)", () => {
    const ref: MosaicRefSource = {
      type: "ref",
      flattenedStableKey: asFlattenedStableKey("title-tile"),
    };
    expect(ref.type).toBe("ref");
    expect(ref.flattenedStableKey).toBe("title-tile");
  });

  it("accepts stepIndex for pipeline back-edge mirrors (earlier step only)", () => {
    // From step 2's perspective, referencing step 0 or step 1 is valid;
    // referencing step 2 or later is a forward reference (engine error).
    const ref: MosaicRefSource = {
      type: "ref",
      flattenedStableKey: asFlattenedStableKey("intro-hero"),
      stepIndex: 0,
    };
    expect(ref.stepIndex).toBe(0);
  });

  it("handles duration mismatch via playback.loopMode (loop|freeze|cut)", () => {
    const looped: MosaicRefSource = {
      type: "ref",
      flattenedStableKey: asFlattenedStableKey("header-strip"),
      playback: { loopMode: "loop" },
    };
    const frozen: MosaicRefSource = {
      type: "ref",
      flattenedStableKey: asFlattenedStableKey("header-strip"),
      playback: { loopMode: "freeze" },
    };
    const cut: MosaicRefSource = {
      type: "ref",
      flattenedStableKey: asFlattenedStableKey("header-strip"),
      playback: { loopMode: "cut" },
    };
    expect(looped.playback?.loopMode).toBe("loop");
    expect(frozen.playback?.loopMode).toBe("freeze");
    expect(cut.playback?.loopMode).toBe("cut");
  });

  it("handles size mismatch via placement.fit (contain|cover)", () => {
    const contained: MosaicRefSource = {
      type: "ref",
      flattenedStableKey: asFlattenedStableKey("thumb"),
      placement: { fit: "contain", hAlign: "center", vAlign: "middle" },
    };
    const covered: MosaicRefSource = {
      type: "ref",
      flattenedStableKey: asFlattenedStableKey("thumb"),
      placement: { fit: "cover" },
    };
    expect(contained.placement?.fit).toBe("contain");
    expect(covered.placement?.fit).toBe("cover");
  });

  it("accepts a cover-crop focus anchor on cover placement", () => {
    const topAnchored: MosaicRefSource = {
      type: "ref",
      flattenedStableKey: asFlattenedStableKey("portrait"),
      placement: { fit: "cover", focusX: 0.5, focusY: 0 },
    };
    expect(topAnchored.placement?.fit).toBe("cover");
    if (topAnchored.placement?.fit === "cover") {
      expect(topAnchored.placement.focusY).toBe(0);
    }
  });

  it("accepts the full standard source decoration on the mirror copy", () => {
    const ref: MosaicRefSource = {
      type: "ref",
      flattenedStableKey: asFlattenedStableKey("title-tile"),
      placement: { fit: "contain", hAlign: "center", vAlign: "middle" },
      playback: { loopMode: "loop", clipStartMs: 1000, clipDurationMs: 2000 },
      effects: { rounding: { borderRadius: 0.1 }, camera: { zoom: 2, focusX: 0.25, focusY: 0.75 } },
      visual: { opacity: 0.9 },
      audio: { enabled: false },
      overlay: { xExpr: "0", yExpr: "0" },
    };
    expect(ref.playback?.clipStartMs).toBe(1000);
    expect(ref.effects?.camera?.zoom).toBe(2);
  });

  it("has no cross-file target field (mirrors are intra-job)", () => {
    const ref: MosaicRefSource = {
      type: "ref",
      flattenedStableKey: asFlattenedStableKey("x"),
    };
    // The previous design exposed a `target: { kind: "file" | ... }`
    // discriminator for cross-document refs. The redesign rejects that
    // — mirroring is bounded to the current render job.
    expect("target" in ref).toBe(false);
  });

  it("has no configMode field (cross-step rules are engine-decided)", () => {
    const ref: MosaicRefSource = {
      type: "ref",
      flattenedStableKey: asFlattenedStableKey("x"),
    };
    expect("configMode" in ref).toBe(false);
  });

  it("accepts chained refs (ref → ref → ... → renderable)", () => {
    // Chains are guaranteed to terminate under the back-edge invariant:
    // each hop walks earlier in evaluation order, and the first node
    // can't be a ref. The type just allows the chain to exist; the
    // engine resolves transitively.
    const head: MosaicRefSource = {
      type: "ref",
      flattenedStableKey: asFlattenedStableKey("mid_ref_cell"),
    };
    const mid: MosaicRefSource = {
      type: "ref",
      flattenedStableKey: asFlattenedStableKey("leaf_media_cell"),
    };
    expect(head.flattenedStableKey).toBe("mid_ref_cell");
    expect(mid.flattenedStableKey).toBe("leaf_media_cell");
  });
});

describe("MosaicSource union", () => {
  it("includes the six variants (media, text, mosaic, lavfi, ref, data)", () => {
    const media: MosaicSource = {
      type: "media",
      mediaType: "video",
      assetId: asAssetId("vid_a"),
    };
    const text: MosaicSource = {
      type: "text",
      layers: [{ content: { kind: "literal", text: "hello" } }],
    };
    const nested: MosaicSource = { type: "mosaic", ref: "child_a" };
    const lavfi: MosaicSource = { type: "lavfi", color: "#000000" };
    const xref: MosaicSource = { type: "ref", flattenedStableKey: asFlattenedStableKey("title-tile") };
    const data: MosaicSource = { type: "data", variables: { x: 1 } };
    const all = [media, text, nested, lavfi, xref, data];
    expect(all.map((s) => s.type)).toEqual([
      "media",
      "text",
      "mosaic",
      "lavfi",
      "ref",
      "data",
    ]);
  });

  it("media playback carries playSpeed alongside the source-time clip window", () => {
    const media: MosaicSource = {
      type: "media",
      mediaType: "video",
      assetId: asAssetId("vid_a"),
      // clipStartMs/clipDurationMs select SOURCE content; playSpeed re-times
      // the window (rendered length = clipDurationMs / playSpeed).
      playback: { playSpeed: 2, clipStartMs: 1000, clipDurationMs: 2000, loopMode: "loop" },
    };
    expect(media.playback?.playSpeed).toBe(2);
    expect(media.playback?.clipStartMs).toBe(1000);
    expect(media.playback?.clipDurationMs).toBe(2000);
  });

  it("exhaustiveness: switch on `type` narrows each variant", () => {
    const sources: MosaicSource[] = [
      { type: "lavfi", color: "#000" },
      { type: "data", variables: { k: 1 } },
      { type: "ref", flattenedStableKey: asFlattenedStableKey("x") },
    ];
    const tags = sources.map((s) => {
      switch (s.type) {
        case "media":
          return "media";
        case "text":
          return "text";
        case "mosaic":
          return "mosaic";
        case "lavfi":
          return "lavfi";
        case "ref":
          return "ref";
        case "data":
          return "data";
      }
    });
    expect(tags).toEqual(["lavfi", "data", "ref"]);
  });
});

describe("MosaicDataSource", () => {
  it("accepts the minimal shape (variables only)", () => {
    const data: MosaicDataSource = {
      type: "data",
      variables: { team: "lakers", season: 2025 },
    };
    expect(data.type).toBe("data");
    expect(data.variables.team).toBe("lakers");
  });

  it("alias is optional", () => {
    const data: MosaicDataSource = {
      type: "data",
      variables: { k: 1 },
    };
    expect(data.alias).toBeUndefined();
  });

  it("accepts an author alias for namespaced reads", () => {
    const data: MosaicDataSource = {
      type: "data",
      alias: asAliasId("templateContext"),
      variables: { team: "lakers" },
    };
    expect(data.alias).toBe("templateContext");
  });

  it("has no per-source carrier override (carrier is engine-fixed)", () => {
    const data: MosaicDataSource = {
      type: "data",
      variables: {},
    };
    // Compile-time: there is no `carrier` field on MosaicDataSource.
    // The shape intentionally rejects per-source visual overrides —
    // if you want pixels + data, use two cells (real source + data
    // source).
    expect("carrier" in data).toBe(false);
  });


  it("supports multiple data sources in one step (one per alias)", () => {
    // Recommended organizational pattern: one MosaicDataSource per
    // logical data block, each with its own alias.
    const sources: MosaicSource[] = [
      {
        type: "data",
        alias: asAliasId("templateContext"),
        variables: { team: "lakers", season: 2025 },
      },
      {
        type: "data",
        alias: asAliasId("designTokens"),
        variables: { brand: "#ff8a00", radius: 12 },
      },
      {
        type: "data",
        alias: asAliasId("seasonData"),
        variables: { wins: 42, losses: 18 },
      },
    ];
    expect(sources).toHaveLength(3);
    expect(sources.every((s) => s.type === "data")).toBe(true);
  });
});

describe("MosaicRefSource — only pixel-producing targets", () => {
  it("flattenedStableKey is required (no alias-based addressing)", () => {
    const ref: MosaicRefSource = {
      type: "ref",
      flattenedStableKey: asFlattenedStableKey("c0_template_context"),
    };
    expect(ref.flattenedStableKey).toBe("c0_template_context");
    // Compile-time: there is no `aliasRef` field on MosaicRefSource.
    // Aliases are exclusively for data reads via ctx.upstreamData,
    // not for visual mirrors.
    expect("aliasRef" in ref).toBe(false);
  });
});
