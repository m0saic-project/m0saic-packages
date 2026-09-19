/**
 * Render-level tests calling NarratedChapters.render directly (unwrapped —
 * defineMosaicTemplate's stamping/assertTiming does not run here; the
 * pipeline-shape invariants those would enforce live in pipeline.test.ts).
 */

import { asAssetId } from "@m0saic/types";
import type {
  MosaicDocument,
  MosaicDocumentPipeline,
  MosaicEngineContext,
  MosaicMediaMetadata,
} from "@m0saic/types";

import { NarratedChapters } from "./narrated-chapters";
import type { StoryDocument } from "./props";

function ctxStub(opts?: {
  width?: number;
  height?: number;
  fps?: number;
  media?: Record<string, Partial<MosaicMediaMetadata>>;
}): MosaicEngineContext {
  const width = opts?.width ?? 1920;
  const height = opts?.height ?? 1080;
  const fps = opts?.fps ?? 30;
  const media: Record<string, Partial<MosaicMediaMetadata>> = {};
  for (const [key, value] of Object.entries(opts?.media ?? {})) {
    media[asAssetId(key) as unknown as string] = value;
  }
  return {
    mode: "render",
    // ctx.target.durationMs is a default-5000 hint on a bare `make` — the
    // template must ignore it for timing, which these tests prove.
    target: { width, height, fps, durationMs: 5000 },
    output: { width, height, fps, durationMs: 5000, workspaceDir: "/tmp" },
    media,
  } as unknown as MosaicEngineContext;
}

const asPipeline = (f: unknown) => f as MosaicDocumentPipeline;
const asDoc = (f: unknown) => f as MosaicDocument;

describe("NarratedChapters.render", () => {
  it("null props render the built-in demo as an emit:multi pipeline of derived length", async () => {
    const file = asPipeline(await NarratedChapters.render({}, ctxStub()));
    expect(file.kind).toBe("mosaic_pipeline");
    expect(file.emit).toBe("multi");
    // Demo: 3500 + 4×2000 + (3340+4820+4060+5780) + 3000 — NOT ctx's 5000.
    expect(file.durationMs).toBe(32500);
    expect(file.steps).toHaveLength(1); // demo defaults to the requested orientation
  });

  it("the demo adopts the requested canvas orientation — a portrait make previews portrait", async () => {
    const file = asPipeline(await NarratedChapters.render({}, ctxStub({ width: 1080, height: 1920 })));
    expect(file.steps.map((s) => s.name)).toEqual(["portrait"]);
    expect(asPipeline(file.steps[0].file).size).toEqual({ width: 1080, height: 1920 });
  });

  it("derives duration from probed narration audio via ctx.media, keyed by the raw string", async () => {
    const story = {
      schemaVersion: 1,
      title: "Probed",
      sections: [
        { id: "a", narrationAudio: "/abs/a.m4a" },
        { id: "b", narrationAudio: "/abs/b.m4a" },
      ],
    };
    const ctx = ctxStub({
      media: {
        "/abs/a.m4a": { kind: "audio", durationMs: 2640, hasAudio: true },
        "/abs/b.m4a": { kind: "audio", durationMs: 5080, hasAudio: true },
      },
    });
    const file = asPipeline(await NarratedChapters.render({ story }, ctx));
    expect(file.kind).toBe("mosaic_pipeline");
    // 3500 + 2×2000 + (2640+700) + (5080+700) + 3000
    expect(file.durationMs).toBe(3500 + 4000 + 3340 + 5780 + 3000);
  });

  it("a bare story document passed AS the props bag is the story, not a silent demo fallback", async () => {
    // `--props @story.json` spreads the manifest into the props bag itself.
    const bag = {
      schemaVersion: 1,
      title: "Bare",
      sections: [{ id: "only", overrides: { durationMs: 9000 } }],
    } as never;
    const file = asPipeline(await NarratedChapters.render(bag, ctxStub()));
    expect(file.kind).toBe("mosaic_pipeline");
    // 3500 + 2000 + (9000+700) + 3000 — provably the bare story, not the 32500ms demo.
    expect(file.durationMs).toBe(18200);
  });

  it("an explicit story prop always outranks bare-bag sniffing", async () => {
    const bag = {
      story: { schemaVersion: 1, title: "Wins", sections: [{ overrides: { durationMs: 1000 } }] },
      sections: [{ overrides: { durationMs: 9000 } }],
    } as never;
    const file = asPipeline(await NarratedChapters.render(bag, ctxStub()));
    expect(file.durationMs).toBe(3500 + 2000 + 1700 + 3000);
  });

  it("accepts the story as a JSON string (type:'json' contract)", async () => {
    const story = { schemaVersion: 1, title: "S", sections: [{ overrides: { durationMs: 1000 } }] };
    const file = asPipeline(await NarratedChapters.render({ story: JSON.stringify(story) }, ctxStub()));
    expect(file.kind).toBe("mosaic_pipeline");
  });

  it("unresolvable narration → an error frame carrying the three-way fix, not a throw", async () => {
    const story = {
      schemaVersion: 1,
      title: "Missing",
      sections: [{ id: "x", narrationAudio: "assets/audio/03.m4a" }],
    };
    const file = asDoc(await NarratedChapters.render({ story }, ctxStub()));
    expect(file.kind).toBe("mosaic_document");
    const flat = JSON.stringify(file);
    expect(flat).toContain("story-studio build");
    expect(flat).toContain("mediaPaths");
  });

  it("invalid story shape → an error frame naming every problem", async () => {
    const story = { schemaVersion: 9, sections: [] };
    const file = asDoc(await NarratedChapters.render({ story }, ctxStub()));
    expect(file.kind).toBe("mosaic_document");
    const flat = JSON.stringify(file);
    expect(flat).toContain("schemaVersion 9");
    expect(flat).toContain("non-empty");
  });

  it("a malformed story JSON string → an error frame", async () => {
    const file = asDoc(await NarratedChapters.render({ story: "{ nope" }, ctxStub()));
    expect(file.kind).toBe("mosaic_document");
  });

  it("both aspects yield two variant steps at true canvases", async () => {
    const story: StoryDocument = {
      schemaVersion: 1,
      title: "Both",
      outputs: ["landscape", "portrait"],
      sections: [{ overrides: { durationMs: 2000 } }],
    };
    const file = asPipeline(await NarratedChapters.render({ story }, ctxStub()));
    expect(file.steps.map((s) => s.name)).toEqual(["landscape", "portrait"]);
    const nested = file.steps.map((s) => asPipeline(s.file));
    expect(nested[0].size).toEqual({ width: 1920, height: 1080 });
    expect(nested[1].size).toEqual({ width: 1080, height: 1920 });
  });

  it("brand colors flow into the scene docs; invalid ones fall back", async () => {
    const story = {
      schemaVersion: 1,
      title: "Branded",
      brand: { accentColor: "#ff8800", backgroundColor: "not a color" },
      sections: [{ overrides: { durationMs: 2000 } }],
    };
    const file = asPipeline(await NarratedChapters.render({ story }, ctxStub()));
    const inner = asPipeline(file.steps[0].file);
    const flat = JSON.stringify(inner);
    expect(flat).toContain("#ff8800");
    expect(flat).not.toContain("not a color");
  });

  it("is deterministic: identical inputs produce deep-equal output", async () => {
    const a = await NarratedChapters.render({}, ctxStub());
    const b = await NarratedChapters.render({}, ctxStub());
    expect(b).toEqual(a);
  });

  it("provenance is inert: renders are identical with and without it", async () => {
    const base = {
      schemaVersion: 1,
      title: "P",
      sections: [{ overrides: { durationMs: 2000 } }],
    };
    const a = await NarratedChapters.render({ story: base }, ctxStub());
    const b = await NarratedChapters.render(
      { story: { ...base, provenance: { generator: "other/1.0", when: "never" } } },
      ctxStub(),
    );
    expect(b).toEqual(a);
  });

  it("the combined captions .srt rides the first scene doc as a text sidecar", async () => {
    const file = asPipeline(await NarratedChapters.render({}, ctxStub()));
    const firstScene = asDoc(asPipeline(file.steps[0].file).steps[0].file) as unknown as {
      sidecars?: { captions?: { kind: string; ext: string; content: string } };
    };
    const sidecar = firstScene.sidecars?.captions;
    expect(sidecar?.kind).toBe("text");
    expect(sidecar?.ext).toBe("srt");
    // Cue times are story-absolute: the first body starts after title+card.
    expect(sidecar?.content).toContain(" --> ");
    expect(sidecar?.content).toContain("Start at the pavement.");
    expect(sidecar?.content.startsWith("1\n00:00:05,5")).toBe(true); // 3500+2000ms in
  });

  it("TREE-WIDE audio-manifest invariant: every audio source in every scene doc resolves to a kind:'file' asset", async () => {
    const story: StoryDocument = {
      schemaVersion: 1,
      title: "Audio",
      audio: { music: "/abs/bed.m4a" },
      outputs: ["landscape", "portrait"],
      sections: [
        { id: "a", narrationText: "Spoken words here.", narrationAudio: "/abs/a.m4a" },
        { id: "b", narrationText: "More spoken words.", overrides: { durationMs: 2000 } },
      ],
    };
    const ctx = ctxStub({ media: { "/abs/a.m4a": { kind: "audio", durationMs: 2640, hasAudio: true } } });
    const file = asPipeline(await NarratedChapters.render({ story }, ctx));
    let audioSources = 0;
    for (const variantStep of file.steps) {
      for (const sceneStep of asPipeline(variantStep.file).steps) {
        const doc = asDoc(sceneStep.file);
        for (const source of doc.sources ?? []) {
          const s = source as unknown as { mediaType?: string; assetId?: string };
          if (s.mediaType !== "audio") continue;
          audioSources++;
          const entry = (doc.assets as Record<string, { kind?: string }>)[s.assetId!];
          expect(entry?.kind).toBe("file");
        }
      }
    }
    // Music on every scene of both variants + narration on section a's bodies.
    expect(audioSources).toBeGreaterThanOrEqual(2 * (6 + 1));
  });

  it("registers with the expected id and all-optional props", () => {
    expect(String(NarratedChapters.id)).toBe("@m0saic/story/narrated-chapters/v1");
    expect(NarratedChapters.defaultProps).toEqual({});
    for (const def of Object.values(NarratedChapters.propsSchema)) {
      expect(def?.required).toBe(false);
    }
  });
});
