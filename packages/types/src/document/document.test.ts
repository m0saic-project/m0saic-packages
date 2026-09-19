/**
 * Type-level smoke tests for the post-redesign MosaicDocument shape:
 * sources hoisted, outputs map present, config dissolved, meta header
 * added.
 */
import type { M0String } from "@m0saic/dsl";
import type { MosaicDocument } from "./document";
import { asAssetId } from "../asset";
import { asAliasId, asFlattenedStableKey } from "../identifiers";

// Type-test fixtures only — `m0` is a branded string, so cast at the
// boundary like callers do at JSON parse time.
const m0 = (s: string): M0String => s as unknown as M0String;

// covers: T:document, T:document.kind, T:document.version, T:document.m0,
//         T:document.assets, T:document.sources, T:document.children,
//         T:document.size, T:document.fps, T:document.durationMs,
//         T:document.target, T:document.format, T:document.audio,
//         T:document.color, T:document.metadata, T:document.backgroundColor,
//         T:document.encodes,
//         T:document.created, T:document.app, T:document.appVersion,
//         T:document.meta, T:document.meta.title, T:document.meta.author,
//         T:document.meta.source, T:document.meta.note
describe("MosaicDocument (post-redesign shape)", () => {
  it("accepts the minimal shape (kind + version + m0 + assets + sources)", () => {
    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      m0: m0("1"),
      assets: {},
      sources: [{ type: "lavfi", color: "#000000" }],
    };
    expect(doc.kind).toBe("mosaic_document");
    expect(doc.sources).toHaveLength(1);
  });

  it("hoists sources to top level (no config wrapper)", () => {
    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      m0: m0("2(1,1)"),
      assets: {},
      sources: [
        { type: "lavfi", color: "#000000" },
        { type: "lavfi", color: "#ffffff" },
      ],
    };
    // Compile-time: there is no `config` field on MosaicDocument.
    expect("config" in doc).toBe(false);
    expect(doc.sources).toHaveLength(2);
  });

  it("accepts flat output knobs (one geometry per doc)", () => {
    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      m0: m0("1"),
      assets: {},
      sources: [{ type: "lavfi", color: "#000000" }],
      size: { width: 1920, height: 1080 },
      fps: 30,
      durationMs: 5000,
      target: "web-mp4",
    };
    expect(doc.target).toBe("web-mp4");
    expect(doc.size?.width).toBe(1920);
  });

  it("accepts encodes map for multi-codec deliverables", () => {
    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      m0: m0("1"),
      assets: {},
      sources: [{ type: "lavfi", color: "#000000" }],
      size: { width: 1920, height: 1080 },
      target: "web-mp4",
      encodes: {
        webm: { format: { kind: "video", container: "webm", videoCodec: "libvpx-vp9" } },
        thumbnail: { size: { width: 320, height: 180 } },
      },
    };
    expect(Object.keys(doc.encodes ?? {})).toHaveLength(2);
    expect(doc.encodes?.thumbnail?.size?.width).toBe(320);
  });

  it("accepts top-level file-lifecycle stamps (created, app, appVersion)", () => {
    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      created: "2026-05-12T10:00:00.000Z",
      app: "m0saic-cli",
      appVersion: "0.1.0",
      m0: m0("1"),
      assets: {},
      sources: [{ type: "lavfi", color: "#000000" }],
    };
    expect(doc.created).toBe("2026-05-12T10:00:00.000Z");
    expect(doc.app).toBe("m0saic-cli");
    expect(doc.appVersion).toBe("0.1.0");
  });

  it("accepts null for app and appVersion (M0-family convention)", () => {
    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      created: "2026-05-12T10:00:00.000Z",
      app: null,
      appVersion: null,
      m0: m0("1"),
      assets: {},
      sources: [{ type: "lavfi", color: "#000000" }],
    };
    expect(doc.app).toBeNull();
    expect(doc.appVersion).toBeNull();
  });

  it("accepts a MosaicFileMeta content-metadata header", () => {
    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      m0: m0("1"),
      assets: {},
      sources: [{ type: "lavfi", color: "#000000" }],
      meta: {
        title: "Launch hero",
        author: "createwithm0saic@gmail.com",
        source: "@m0saic/hero/ffmpeg-pulse/title/v1",
        note: "Q2 launch",
      },
    };
    expect(doc.meta?.title).toBe("Launch hero");
    expect(doc.meta?.source).toBe("@m0saic/hero/ffmpeg-pulse/title/v1");
  });

  it("accepts children for nested compositions", () => {
    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      m0: m0("1"),
      assets: {},
      sources: [{ type: "mosaic", ref: "child_a" }],
      children: {
        child_a: {
          kind: "mosaic_document",
          version: 1,
          m0: m0("1"),
          assets: {},
          sources: [
            {
              type: "media",
              mediaType: "video",
              assetId: asAssetId("vid_a"),
            },
          ],
        },
      },
    };
    expect(doc.children?.child_a?.kind).toBe("mosaic_document");
  });

  it("accepts a MosaicRefSource in the sources array (intra-job mirror)", () => {
    const doc: MosaicDocument = {
      kind: "mosaic_document",
      version: 1,
      m0: m0("1"),
      assets: {},
      sources: [
        {
          type: "ref",
          flattenedStableKey: asFlattenedStableKey("title-tile"),
        },
      ],
    };
    expect(doc.sources[0]?.type).toBe("ref");
  });

  // covers: T:document.variables, T:document.variables#role=1-nested-return,
  //         T:document.variables#role=2-pipeline-step
  describe("variables (back-edge data transport)", () => {
    it("is optional — minimal doc remains valid without it", () => {
      const doc: MosaicDocument = {
        kind: "mosaic_document",
        version: 1,
        m0: m0("1"),
        assets: {},
        sources: [{ type: "lavfi", color: "#000000" }],
      };
      expect(doc.variables).toBeUndefined();
    });

    it("accepts mixed-type JSON values", () => {
      const doc: MosaicDocument = {
        kind: "mosaic_document",
        version: 1,
        m0: m0("1"),
        assets: {},
        sources: [{ type: "lavfi", color: "#000000" }],
        variables: {
          topContributor: "alice",
          commitsToday: 42,
          isLeader: true,
          contributors: ["alice", "bob"],
          stats: { open: 3, closed: 17 },
          nothing: null,
        },
      };
      expect(doc.variables?.commitsToday).toBe(42);
      expect(doc.variables?.contributors).toEqual(["alice", "bob"]);
    });

    it("coexists with meta and output knobs", () => {
      const doc: MosaicDocument = {
        kind: "mosaic_document",
        version: 1,
        m0: m0("1"),
        assets: {},
        sources: [{ type: "lavfi", color: "#000000" }],
        meta: { title: "Sports reel" },
        size: { width: 1920, height: 1080 },
        variables: { team: "lakers", season: 2025 },
      };
      expect(doc.variables?.team).toBe("lakers");
      expect(doc.meta?.title).toBe("Sports reel");
    });

    it("accepts a MosaicDataSource carrying variables", () => {
      const doc: MosaicDocument = {
        kind: "mosaic_document",
        version: 1,
        m0: m0("1"),
        assets: {},
        sources: [
          {
            type: "data",
            alias: asAliasId("templateContext"),
            variables: { team: "lakers", season: 2025 },
          },
        ],
      };
      expect(doc.sources[0]?.type).toBe("data");
    });
  });

  // covers: T:document.labels (.m0c content arrives via template props, not via a ref field)
  describe("labels (per-cell labels keyed by local stableKey)", () => {
    it("is optional — minimal doc remains valid without it", () => {
      const doc: MosaicDocument = {
        kind: "mosaic_document",
        version: 1,
        m0: m0("1"),
        assets: {},
        sources: [{ type: "lavfi", color: "#000000" }],
      };
      expect(doc.labels).toBeUndefined();
    });

    it("accepts per-cell labels keyed by local stableKey", () => {
      const doc: MosaicDocument = {
        kind: "mosaic_document",
        version: 1,
        m0: m0("2(left,right)"),
        assets: {},
        sources: [
          { type: "lavfi", color: "#ff0000" },
          { type: "lavfi", color: "#00ff00" },
        ],
        labels: {
          left: "Left clip",
          right: "Right clip",
        },
      };
      expect(doc.labels?.left).toBe("Left clip");
    });

    it("coexists with variables, sidecars, children", () => {
      const doc: MosaicDocument = {
        kind: "mosaic_document",
        version: 1,
        m0: m0("1"),
        assets: {},
        sources: [{ type: "lavfi", color: "#000000" }],
        labels: { hero: "Header strip" },
        variables: { brandColor: "#ff8a00" },
        sidecars: { audit: { renderedAt: "2026-05-12T00:00:00Z" } },
      };
      expect(doc.labels?.hero).toBe("Header strip");
      expect(doc.variables?.brandColor).toBe("#ff8a00");
      expect(doc.sidecars?.audit).toBeDefined();
    });
  });

  // covers: T:document.sidecars
  describe("sidecars (end-user structured-data delivery)", () => {
    it("is optional — minimal doc remains valid without it", () => {
      const doc: MosaicDocument = {
        kind: "mosaic_document",
        version: 1,
        m0: m0("1"),
        assets: {},
        sources: [{ type: "lavfi", color: "#000000" }],
      };
      expect(doc.sidecars).toBeUndefined();
    });

    it("accepts a structured forensic-watermark sidecar payload", () => {
      const doc: MosaicDocument = {
        kind: "mosaic_document",
        version: 1,
        m0: m0("1"),
        assets: {},
        sources: [{ type: "lavfi", color: "#000000" }],
        sidecars: {
          watermark: {
            algorithm: "lsb",
            seed: "abc123",
            embeddedAt: [
              { frame: 0, region: { x: 100, y: 200, w: 32, h: 32 } },
              { frame: 30, region: { x: 100, y: 200, w: 32, h: 32 } },
            ],
            recoveryKey: "...",
          },
        },
      };
      expect(doc.sidecars?.watermark).toBeDefined();
    });

    it("coexists with variables (different audiences, same doc)", () => {
      // variables → for downstream templates
      // sidecars  → for the end user
      const doc: MosaicDocument = {
        kind: "mosaic_document",
        version: 1,
        m0: m0("1"),
        assets: {},
        sources: [{ type: "lavfi", color: "#000000" }],
        variables: { brand: "acme" },
        sidecars: { audit: { renderedAt: "2026-05-12T00:00:00Z" } },
      };
      expect(doc.variables?.brand).toBe("acme");
      expect(doc.sidecars?.audit).toBeDefined();
    });

    it("accepts multiple named sidecars (one file each on disk)", () => {
      // Each top-level key becomes its own JSON file:
      //   {output-basename}.watermark.json
      //   {output-basename}.audit.json
      //   {output-basename}.captions.json
      const doc: MosaicDocument = {
        kind: "mosaic_document",
        version: 1,
        m0: m0("1"),
        assets: {},
        sources: [{ type: "lavfi", color: "#000000" }],
        sidecars: {
          watermark: { algorithm: "dct" },
          audit: { renderedBy: "@m0saic/cli" },
          captions: [{ startMs: 0, endMs: 1000, text: "Hello" }],
        },
      };
      expect(Object.keys(doc.sidecars ?? {})).toHaveLength(3);
    });
  });
});
