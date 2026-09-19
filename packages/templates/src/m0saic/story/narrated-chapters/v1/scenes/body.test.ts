import { isValidM0String, parseM0StringToRenderFrames } from "@m0saic/dsl";

import { hamilton, resolveTiming } from "../plan";
import type { StoryPlan } from "../plan";
import { storyTheme } from "../theme";
import { buildBodyDoc, focusFromOverrides } from "./body";
import type { SectionMedia } from "./body";

const THEME = storyTheme();
const landscape = { name: "landscape" as const, width: 1920, height: 1080 };
const portrait = { name: "portrait" as const, width: 1080, height: 1920 };

function planWith(images: string[], overrides: Record<string, unknown> = {}): StoryPlan {
  const r = resolveTiming(
    {
      schemaVersion: 1,
      title: "T",
      motion: { seed: 7, intensity: 1 },
      sections: [{ id: "a", title: "A", images, overrides: { durationMs: 6000, ...overrides } }],
    },
    { fps: 30, target: { width: 1920, height: 1080 }, narrationDurationMs: () => undefined },
  );
  if ("error" in r) throw new Error(r.error);
  return r.plan;
}

function mediaFor(paths: string[]): SectionMedia[] {
  return [
    {
      images: paths.map((p, k) => ({ path: p, assetKey: `img_0_${k}` })),
      focus: paths.map(() => undefined),
    },
  ];
}

describe("buildBodyDoc — image stack", () => {
  const paths = ["/abs/1.jpg", "/abs/2.jpg", "/abs/3.jpg"];
  const plan = planWith(paths);
  const body = plan.scenes.find((s) => s.kind === "body")!;
  const doc = buildBodyDoc(body, mediaFor(paths)[0], landscape, plan, THEME);

  it("one frame per scheduled image, manifest entry per source, valid m0", () => {
    expect(String(doc.m0)).toBe("F{F{F}}");
    expect(isValidM0String(String(doc.m0))).toBe(true);
    expect(doc.sources).toHaveLength(3);
    expect(parseM0StringToRenderFrames(String(doc.m0), 1920, 1080)).toHaveLength(3);
    expect(Object.keys(doc.assets)).toEqual(["img_0_0", "img_0_1", "img_0_2"]);
  });

  it("dwell schedule covers the FULL step (visible + xfadeOut) exactly", () => {
    const total = (body.images ?? []).reduce((a, s) => a + s.durationMs, 0);
    expect(total).toBe(body.visibleMs + body.xfadeOutMs);
  });

  it("images only ever FADE IN; the base image has no ramp", () => {
    const flat = doc.sources.map((s) => JSON.stringify(s));
    expect(flat[0]).not.toContain('"alpha"');
    expect(flat[1]).toContain('"alpha"');
    expect(flat[2]).toContain('"alpha"');
    // A dissolve fades in linearly — canonical ramp, no fade-out anywhere.
    expect(flat[1]).toContain("min(1,max(0,(t-");
  });

  it("covered images carry a window that closes after their successor is opaque", () => {
    const first = doc.sources[0] as unknown as { overlay?: { window?: { startSec?: number; endSec?: number } } };
    const last = doc.sources[2] as unknown as { overlay?: { window?: { startSec?: number; endSec?: number } } };
    expect(first.overlay?.window?.endSec).toBeGreaterThan(0);
    expect(first.overlay?.window?.startSec).toBeUndefined(); // base visible from t=0
    expect(last.overlay?.window?.startSec).toBeGreaterThan(0);
    expect(last.overlay?.window?.endSec).toBeUndefined(); // last runs to the end
  });

  it("every image covers with the aspect table's focus default", () => {
    for (const s of doc.sources) {
      const flat = JSON.stringify(s);
      expect(flat).toContain('"fit":"cover"');
    }
    const portraitDoc = buildBodyDoc(body, mediaFor(paths)[0], portrait, plan, THEME);
    expect(JSON.stringify(portraitDoc.sources[0])).toContain('"focusY":0.42');
  });

  it("camera zoom, when present, is a plain number", () => {
    for (const s of doc.sources) {
      const cam = (s as unknown as { effects?: { camera?: { zoom?: unknown } } }).effects?.camera;
      if (cam !== undefined) expect(typeof cam.zoom).toBe("number");
    }
  });

  it("is deterministic", () => {
    expect(buildBodyDoc(body, mediaFor(paths)[0], landscape, plan, THEME)).toEqual(doc);
  });
});

describe("buildBodyDoc — media-free panel", () => {
  const plan = planWith([]);
  const body = plan.scenes.find((s) => s.kind === "body")!;

  it("renders the themed panel with the section heading", () => {
    const doc = buildBodyDoc(body, { images: [], focus: [] }, landscape, plan, THEME);
    expect(String(doc.m0)).toBe("F{F}");
    expect(doc.sources).toHaveLength(2);
    expect(JSON.stringify(doc)).toContain('"A"');
  });

  it("missing media entirely takes the same path", () => {
    const doc = buildBodyDoc(body, undefined, landscape, plan, THEME);
    expect(String(doc.m0)).toBe("F{F}");
  });
});

describe("scheduling interplay", () => {
  it("minImageDwellMs caps the shown images and Σ dwell still covers the step", () => {
    const paths = ["/a.jpg", "/b.jpg", "/c.jpg", "/d.jpg", "/e.jpg"];
    const plan = planWith(paths, { minImageDwellMs: 2200 });
    const body = plan.scenes.find((s) => s.kind === "body")!;
    // step = 6000 + X; at 2200ms min dwell only 3 fit (6600 > step ≥ 4400+X).
    expect((body.images ?? []).length).toBeLessThan(paths.length);
    expect(plan.diagnostics.some((d) => d.includes("STORY_IMAGES_DROPPED"))).toBe(true);
    const total = (body.images ?? []).reduce((a, s) => a + s.durationMs, 0);
    expect(total).toBe(body.visibleMs + body.xfadeOutMs);
  });

  it("imageWeights shape the dwell; a bad list falls back with a diagnostic", () => {
    const plan = planWith(["/a.jpg", "/b.jpg"], { imageWeights: [3, 1] });
    const body = plan.scenes.find((s) => s.kind === "body")!;
    const [a, b] = body.images ?? [];
    expect(a.durationMs).toBeGreaterThan(b.durationMs * 2);

    const bad = planWith(["/a.jpg", "/b.jpg"], { imageWeights: [1, 2, 3] });
    expect(bad.diagnostics.some((d) => d.includes("STORY_IMAGE_WEIGHTS_IGNORED"))).toBe(true);
  });
});

describe("hamilton", () => {
  it("distributes exactly with ties to the lower index", () => {
    expect(hamilton(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(hamilton(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(hamilton(7, [1, 1])).toEqual([4, 3]);
    expect(hamilton(6000, [3, 1])).toEqual([4500, 1500]);
  });

  it("sums are always exact", () => {
    for (const [total, weights] of [
      [6600, [1, 2, 3]],
      [5555, [7, 11, 13, 17]],
      [1, [5, 5]],
    ] as Array<[number, number[]]>) {
      expect(hamilton(total, weights).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});

describe("buildBodyDoc — captions + audio (Phase 5)", () => {
  function fullPlan() {
    const r = resolveTiming(
      {
        schemaVersion: 1,
        title: "T",
        audio: { narrationVolume: 0.9, musicVolume: 0.2, music: "/abs/bed.m4a", musicStartMs: 500 },
        sections: [
          {
            id: "a",
            title: "A",
            narrationText: "First sentence here. Second sentence follows on nicely.",
            narrationAudio: "/abs/a.m4a",
            images: ["/abs/1.jpg"],
          },
        ],
      },
      { fps: 30, target: { width: 1920, height: 1080 }, narrationDurationMs: () => 5000 },
    );
    if ("error" in r) throw new Error(r.error);
    return r.plan;
  }

  const plan = fullPlan();
  const body = plan.scenes.find((s) => s.kind === "body")!;
  const media: SectionMedia = {
    images: [{ path: "/abs/1.jpg", assetKey: "img_0_0" }],
    focus: [undefined],
    narration: { path: "/abs/a.m4a", assetKey: "nar_0" },
  };
  const music = { path: "/abs/bed.m4a", assetKey: "music_bed" };
  const doc = buildBodyDoc(body, media, landscape, plan, THEME, music);

  it("frame order is [stack…, captions…, audio…] and counts match at both aspects", () => {
    // Landscape: 1 image + (topSpacer, plate, text) + narration + music = 6.
    expect(doc.sources).toHaveLength(6);
    expect(parseM0StringToRenderFrames(String(doc.m0), 1920, 1080)).toHaveLength(6);
    // Portrait's band is a real cell: 1 image + (plate, text) + 2 audio = 5.
    const portraitDoc = buildBodyDoc(body, media, portrait, plan, THEME, music);
    expect(portraitDoc.sources).toHaveLength(5);
    expect(parseM0StringToRenderFrames(String(portraitDoc.m0), 1080, 1920)).toHaveLength(5);
  });

  it("the portrait caption band is a REAL bottom cell, not an overlay strip", () => {
    const portraitDoc = buildBodyDoc(body, media, portrait, plan, THEME, music);
    const frames = parseM0StringToRenderFrames(String(portraitDoc.m0), 1080, 1920) as Array<{
      y: number;
      height: number;
    }>;
    // Plate frame (index 1) sits in the bottom ~32% band.
    expect(frames[1].y).toBeGreaterThan(1200);
  });

  it("AUDIO-MANIFEST INVARIANT: every audio source's assetId has a kind:'file' manifest entry", () => {
    // The whole defence against a silently silent render.
    for (const source of doc.sources) {
      const s = source as unknown as { mediaType?: string; assetId?: string };
      if (s.mediaType !== "audio") continue;
      const entry = (doc.assets as Record<string, { kind?: string; path?: string }>)[s.assetId!];
      expect(entry?.kind).toBe("file");
      expect(typeof entry?.path).toBe("string");
    }
  });

  it("narration is a mediaType:'audio' leaf at the section volume, starting at t=0", () => {
    const narration = doc.sources.find(
      (s) => (s as unknown as { assetId?: string }).assetId === "nar_0",
    ) as unknown as { mediaType: string; audio: { enabled: boolean; volume: number }; playback?: unknown };
    expect(narration.mediaType).toBe("audio");
    expect(narration.audio).toEqual({ enabled: true, volume: 0.9 });
    expect(narration.playback).toBeUndefined(); // narration starts at the step's t=0
  });

  it("the music bed is offset by musicStartMs + scene.startMs", () => {
    const bed = doc.sources.find(
      (s) => (s as unknown as { assetId?: string }).assetId === "music_bed",
    ) as unknown as { audio: { volume: number }; playback: { clipStartMs: number } };
    expect(bed.audio.volume).toBe(0.2);
    expect(bed.playback.clipStartMs).toBe(500 + body.startMs);
  });

  it("captions are ONE drawtext video source with per-cue between() gates", () => {
    const text = doc.sources.find((s) => (s as unknown as { type: string }).type === "text") as unknown as {
      rasterizer?: string;
      renderMode: { kind: string };
      layers: Array<{ overlay: { enable: string } }>;
    };
    expect(text.rasterizer).toBeUndefined(); // drawtext — svg drops per-layer enable
    expect(text.renderMode).toEqual({ kind: "video" });
    expect(text.layers.length).toBe(body.cues!.length);
    for (const layer of text.layers) {
      expect(layer.overlay.enable).toMatch(/^between\(t,\d+\.\d{3},\d+\.\d{3}\)$/);
    }
  });

  it("a body step is a legal xfade A-side: narration ends before the crossfade tail", () => {
    // visible = narration + tailPad ⇒ narration never reaches the xfadeOut
    // region carried at the step's end.
    expect(body.narrationMs!).toBeLessThanOrEqual(body.visibleMs);
  });

  it("no narration/music degrades cleanly (captions still render from narrationText)", () => {
    const bare = buildBodyDoc(body, { images: media.images, focus: [undefined] }, landscape, plan, THEME);
    // image + (topSpacer, plate, text) = 4 frames, no audio leaves.
    expect(bare.sources).toHaveLength(4);
    expect(parseM0StringToRenderFrames(String(bare.m0), 1920, 1080)).toHaveLength(4);
  });
});

describe("buildBodyDoc — caption edge cases", () => {
  it("small canvases render captions at the floor font instead of crashing", () => {
    const r = resolveTiming(
      {
        schemaVersion: 1,
        title: "Tiny",
        sections: [{ id: "a", narrationText: "Words to caption here.", overrides: { durationMs: 3000 } }],
      },
      { fps: 30, target: { width: 320, height: 240 }, narrationDurationMs: () => undefined },
    );
    if ("error" in r) throw new Error(r.error);
    const body = r.plan.scenes.find((s) => s.kind === "body")!;
    const tiny = { name: "landscape" as const, width: 320, height: 240 };
    const doc = buildBodyDoc(body, { images: [], focus: [] }, tiny, r.plan, THEME);
    const text = doc.sources.find((s) => (s as unknown as { type: string }).type === "text" && JSON.stringify(s).includes("between")) as unknown as {
      layers: Array<{ style: { fontSize: number } }>;
    };
    expect(text.layers.length).toBeGreaterThan(0);
    expect(text.layers[0].style.fontSize).toBeGreaterThanOrEqual(14);
  });

  it("captions.plate 'never' keeps the frame but paints a transparent plate", () => {
    const r = resolveTiming(
      {
        schemaVersion: 1,
        title: "NoPlate",
        captions: { plate: "never" },
        sections: [{ id: "a", narrationText: "Caption without a plate.", overrides: { durationMs: 3000 } }],
      },
      { fps: 30, target: { width: 1920, height: 1080 }, narrationDurationMs: () => undefined },
    );
    if ("error" in r) throw new Error(r.error);
    const body = r.plan.scenes.find((s) => s.kind === "body")!;
    const doc = buildBodyDoc(body, { images: [], focus: [] }, landscape, r.plan, THEME);
    // Frame count unchanged (panel 2 + spacer/plate/text 3); plate is black@0.
    expect(doc.sources).toHaveLength(5);
    expect(JSON.stringify(doc.sources)).toContain("black@0");
    expect(JSON.stringify(doc.sources)).not.toContain("#000000@0.55");
  });
});

describe("focusFromOverrides", () => {
  it("accepts in-range anchors, drops junk, and is length-tolerant", () => {
    const out = focusFromOverrides(
      { imageFocus: [{ x: 0.2, y: 0.3 }, { x: 5, y: 0 }, "junk" as never] },
      2,
    );
    expect(out).toEqual([{ x: 0.2, y: 0.3 }, undefined]);
    expect(focusFromOverrides(undefined, 2)).toEqual([undefined, undefined]);
  });
});
