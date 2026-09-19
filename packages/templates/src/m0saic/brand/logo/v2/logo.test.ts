import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicRenderableFile,
} from "@m0saic/types";
import { entries, getSourceOrderStableKeys } from "@m0saic/dictionary";
import { TheMosaicMV2 } from "./logo";

type LogoProps = Parameters<typeof TheMosaicMV2.render>[0];

const DICT_ID_M33 = "brand/m-33";
const M33_ENTRY = entries.byId[DICT_ID_M33]!;
const SOURCE_COUNT_M33 = M33_ENTRY.sourceCount;
const M33_SOURCE_KEYS = getSourceOrderStableKeys(M33_ENTRY);
// Source-order array of mask entries — preserves the legacy positional
// shape (`(MosaicMaskEntry | null)[]`) the tests below were built around.
const M33_MASKS: ReadonlyArray<{ localPath: string; bounds: { x: number; y: number; width: number; height: number } } | null> =
  M33_SOURCE_KEYS.map((k) => M33_ENTRY.masks?.[k] ?? null);

function makeCtx(): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width: 1080, height: 1080, fps: 30, durationMs: 3200 },
    output: {
      width: 1080,
      height: 1080,
      fps: 30,
      durationMs: 3200,
      workspaceDir: "/tmp",
    },
    media: {},
    cache: {
      get: () => undefined,
      set: () => {},
      getOrCompute: async (_k: string, fn: () => any) => fn(),
    } as any,
  } as MosaicEngineContext;
}

function asDocument(file: MosaicRenderableFile): MosaicDocument {
  expect(file.kind).toBe("mosaic_document");
  return file as MosaicDocument;
}

async function render(props: Partial<LogoProps>) {
  return TheMosaicMV2.render(props as LogoProps, makeCtx());
}

describe("TheMosaicMV2 — inline-mask carving", () => {
  it("m-33 inlines the default mask set on every tile that has a silhouette", async () => {
    const doc = asDocument(await render({ size: "m-33", animation: "logo_loop" }));
    const sources = doc.sources ?? [];
    expect(SOURCE_COUNT_M33).toBe(33);
    expect(sources.length).toBe(SOURCE_COUNT_M33);
    sources.forEach((s, i) => {
      const m = M33_MASKS[i];
      const actual = (s as { mask?: unknown }).mask;
      if (m) {
        expect(actual).toEqual({
          kind: "inline-mask",
          localPath: m.localPath,
          bounds: m.bounds,
        });
      } else {
        // Null mask entry (the M's solid-rect body): tile is left unmasked.
        expect(actual).toBeUndefined();
      }
    });
  });

  it("masks are attached across every rect-based animation mode", async () => {
    // Pick a source index that has a non-null mask entry — the M's solid-
    // rect body cells have null entries (no silhouette needed). Use the
    // first non-null index from the loaded mask set so the test is stable
    // regardless of where the body cells sit in source order.
    const maskedIdx = M33_MASKS.findIndex((m) => m !== null);
    expect(maskedIdx).toBeGreaterThanOrEqual(0);
    for (const animation of [
      "logo_loop",
      "progress_fill",
      "loading_shimmer",
      "loading_ui_v2",
    ] as const) {
      const doc = asDocument(await render({ size: "m-33", animation, progress: 0.5 }));
      const masked = (doc.sources ?? [])[maskedIdx] as {
        mask?: { kind?: string; localPath?: string };
      };
      expect(masked.mask?.kind).toBe("inline-mask");
      expect(typeof masked.mask?.localPath).toBe("string");
      expect((masked.mask?.localPath ?? "").length).toBeGreaterThan(0);
    }
  });

  it("bitmap variant is pixel-exact and is left unmasked", async () => {
    const doc = asDocument(
      await render({ size: "m-33_bitmap", animation: "progress_fill", progress: 0.5 }),
    );
    const first = (doc.sources ?? [])[0] as { mask?: unknown };
    expect(first.mask).toBeUndefined();
  });
});
