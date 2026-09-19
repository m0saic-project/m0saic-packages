/**
 * Body scenes — the section's images with restrained Ken Burns drift,
 * windowed cross-dissolves, burned captions, and the audio bed.
 *
 * Z-order comes from the m0's nested overlay structure (image k is the
 * overlay of k−1 and paints above it), never from source-array position.
 * Each image only ever FADES IN — its predecessor sits opaque underneath,
 * so one canonical alpha ramp is a true dissolve with no luminance dip
 * (R4: alpha + typed window, both). Every covered image's window closes
 * shortly after its successor is fully opaque, keeping the tail composite
 * at 2 layers instead of M.
 *
 * Captions are DRAWTEXT by necessity (`buildSvgTextSource` merges every
 * layer and drops per-layer `enable` — an svg caption source would show
 * all cues at once, forever): ONE text source per section (R5), one layer
 * per cue, each enable-gated `between(t, start, end)`, renderMode
 * {kind:"video"} so the gates evaluate per frame. Cue times are
 * narration-relative == step-local (cards cut INTO narration, so the
 * body's t=0 is the narration's first sample).
 *
 * Narration is a `mediaType:"audio"` source on the top overlay leaf —
 * mandatory even for real audio files (an MP3 with ID3 cover art probes
 * hasVideo:true; the declaration keeps it out of the video composite while
 * still contributing its audio). It starts at t=0 and the step's last
 * xfadeOut ≤ tailPad milliseconds are pad silence, which is what makes a
 * body step legal as the A side of a crossfade. The music bed is
 * replicated per step with `playback.clipStartMs = musicStartMs +
 * scene.startMs` (there is no pipeline-spanning audio track, no ducking,
 * no afade — engine gaps by design, documented not faked).
 */

import { fadeInExpr, makeColorTile, measureText } from "@m0saic/template-utils";
import type {
  MosaicAssetManifest,
  MosaicColor,
  MosaicDocument,
  MosaicSource,
} from "@m0saic/types";

import { ASPECT_TABLE, buildBodyM0, classifyAspect } from "../layout";
import type { AspectSpec } from "../layout";
import { kenBurnsCamera } from "../kenburns";
import type { StoryPlan, StoryScene, StoryVariant } from "../plan";
import type { StoryCue, StorySectionOverrides } from "../props";
import type { StoryTheme } from "../theme";
import { textCell } from "./card";

/** How long after a successor is fully opaque the covered image stays live. */
const WINDOW_SLACK_SEC = 0.25;

/** Drawtext is shaped by fontconfig while we measure bundled Roboto — leave margin. */
const CAPTION_SAFE_W = 0.9;

const CAPTION_MIN_FONT = 14;

/** One resolved, probe-verified image for a section. */
export type ResolvedImage = {
  /** Raw path string as it appears in the story (the ctx.media key). */
  path: string;
  /** Deterministic manifest key (positional — collision-free by construction). */
  assetKey: string;
};

export type SectionMedia = {
  images: ResolvedImage[];
  /** Per-image subject anchors from overrides.imageFocus (0..1 fractions). */
  focus: Array<{ x: number; y: number } | undefined>;
  /** Narration clip (raw path + manifest key) when the section declares one. */
  narration?: ResolvedImage;
};

/** The music bed, shared by every scene (undefined = no music). */
export type MusicBed = {
  path: string;
  assetKey: string;
};

export function buildBodyDoc(
  scene: StoryScene,
  media: SectionMedia | undefined,
  variant: StoryVariant,
  plan: StoryPlan,
  theme: StoryTheme,
  music?: MusicBed,
): MosaicDocument {
  if (scene.kind !== "body") {
    throw new Error(`buildBodyDoc: got a ${scene.kind} scene ("${scene.name}")`);
  }
  const durationMs = scene.visibleMs + scene.xfadeOutMs;
  const aspect = classifyAspect(variant.width, variant.height);
  const spec = ASPECT_TABLE[aspect];
  const schedule = scene.images ?? [];
  const hasImages = media !== undefined && media.images.length > 0 && schedule.length > 0;
  const cues = scene.cues ?? [];
  const captionsOn = cues.length > 0;
  const narration = media?.narration;

  const assets: MosaicAssetManifest = {} as MosaicAssetManifest;
  const sources: MosaicSource[] = [];

  // -- visual stack: images or the media-free panel -------------------------
  if (hasImages) {
    const fadeSec = Math.max(0.05, (scene.imageFadeMs ?? 500) / 1000);
    schedule.forEach((slot, k) => {
      const image = media.images[slot.imageIndex];
      if (image === undefined) {
        throw new Error(
          `buildBodyDoc: ${scene.name} schedules images[${slot.imageIndex}] but only ${media.images.length} resolved`,
        );
      }
      (assets as Record<string, unknown>)[image.assetKey] = {
        kind: "file",
        path: image.path,
        mediaType: "image",
      };
      const subject = media.focus[slot.imageIndex];
      const startSec = slot.startMs / 1000;
      const next = schedule[k + 1];
      const camera = kenBurnsCamera({
        seed: plan.motion.seed,
        sectionIndex: scene.sectionIndex ?? 0,
        imageIndex: slot.imageIndex,
        startSec,
        endSec: (slot.startMs + slot.durationMs) / 1000,
        intensity: plan.motion.intensity,
        ease: plan.motion.ease,
        ampScale: spec.cameraAmpScale,
        ...(subject !== undefined ? { subjectX: subject.x, subjectY: subject.y } : {}),
      });
      const window = {
        ...(k > 0 ? { startSec } : {}),
        ...(next !== undefined ? { endSec: next.startMs / 1000 + fadeSec + WINDOW_SLACK_SEC } : {}),
      };
      sources.push({
        type: "media",
        mediaType: "image",
        assetId: image.assetKey,
        placement: {
          fit: "cover",
          focusX: subject?.x ?? 0.5,
          focusY: subject?.y ?? spec.coverFocusY,
        },
        ...(camera !== undefined ? { effects: { camera } } : {}),
        overlay: {
          ...(k > 0 ? { alpha: fadeInExpr(startSec, fadeSec, "linear") } : {}),
          ...(Object.keys(window).length > 0 ? { window } : {}),
        },
        editor: { owner: "template", label: `${scene.name}/img${slot.imageIndex}` },
      } as unknown as MosaicSource);
    });
  } else {
    const S = Math.min(variant.width, variant.height);
    sources.push(
      makeColorTile(theme.card) as MosaicSource,
      textCell(scene.heading, {
        maxFont: Math.round(S * spec.headingScale * 0.7),
        maxW: Math.floor(variant.width * spec.cardSafeW),
        bandH: Math.floor(variant.height * 0.3),
        color: theme.muted,
        label: `${scene.name}/panel-heading`,
      }),
    );
  }

  // -- captions: plate + gated drawtext ------------------------------------
  if (captionsOn) {
    sources.push(...buildCaptionSources(scene, cues, variant, aspect, spec, plan, theme));
  }

  // -- audio leaves: narration, then music ----------------------------------
  if (narration !== undefined) {
    (assets as Record<string, unknown>)[narration.assetKey] = {
      kind: "file",
      path: narration.path,
      mediaType: "audio",
    };
    sources.push({
      type: "media",
      mediaType: "audio",
      assetId: narration.assetKey,
      audio: { enabled: true, volume: plan.audio.narrationVolume },
      editor: { owner: "template", label: `${scene.name}/narration` },
    } as unknown as MosaicSource);
  }
  if (music !== undefined) {
    (assets as Record<string, unknown>)[music.assetKey] = {
      kind: "file",
      path: music.path,
      mediaType: "audio",
    };
    sources.push(musicSource(music, scene, plan, `${scene.name}/music`));
  }

  const stackFrames = hasImages ? schedule.length : 2;
  const audioCount = (narration !== undefined ? 1 : 0) + (music !== undefined ? 1 : 0);
  return {
    kind: "mosaic_document",
    version: 1,
    m0: buildBodyM0({ aspect, stackFrames, captions: captionsOn, audioCount }),
    assets,
    sources,
    size: { width: variant.width, height: variant.height },
    fps: plan.fps,
    durationMs,
    backgroundColor: theme.canvas,
    editor: { label: `${variant.name}/${scene.name}` },
  };
}

/** The music-bed source for ANY scene: same file, per-step clip offset. */
export function musicSource(
  music: MusicBed,
  scene: StoryScene,
  plan: StoryPlan,
  label: string,
): MosaicSource {
  return {
    type: "media",
    mediaType: "audio",
    assetId: music.assetKey,
    audio: { enabled: true, volume: plan.audio.musicVolume },
    playback: { clipStartMs: plan.audio.musicStartMs + scene.startMs },
    editor: { owner: "template", label },
  } as unknown as MosaicSource;
}

/**
 * Caption frames for the band carved by buildBodyM0. Portrait: [plate,
 * text]. Landscape/square get an extra leading TRANSPARENT tile claiming
 * the split's top band so the images show through: [topSpacer, plate,
 * text]. The plate fills its real band cell (small insets only — the
 * engine caps inset at 0.49/side, which is why the band is carved, not
 * painted).
 */
function buildCaptionSources(
  scene: StoryScene,
  cues: StoryCue[],
  variant: StoryVariant,
  aspect: ReturnType<typeof classifyAspect>,
  spec: AspectSpec,
  plan: StoryPlan,
  theme: StoryTheme,
): MosaicSource[] {
  const S = Math.min(variant.width, variant.height);
  const isBand = aspect === "portrait";
  const plateColor: MosaicColor = "#000000@0.55" as MosaicColor;
  const plate =
    plan.captions.plate === "never"
      ? (makeColorTile("black@0") as MosaicSource)
      : (makeColorTile(plateColor, {
          placement: { inset: { top: 0.05, left: 0.05, right: 0.05, bottom: 0.12 } },
        }) as MosaicSource);

  // Fit once per section against every cue (no per-cue jitter): shrink the
  // font until each cue wraps within the line budget. The wrap ALWAYS runs
  // at least once — a tiny canvas whose cap starts below the floor must
  // still produce layers, never an empty wrapped list.
  const boxW = Math.floor(variant.width * 0.85 * CAPTION_SAFE_W);
  let fontSize = Math.max(CAPTION_MIN_FONT, Math.round(S * spec.captionScale));
  let wrapped: string[][] = cues.map((cue) => wrapCue(cue.text, fontSize, boxW));
  while (!wrapped.every((lines) => lines.length <= spec.captionLines) && fontSize > CAPTION_MIN_FONT) {
    fontSize = Math.max(CAPTION_MIN_FONT, Math.floor(fontSize * 0.9));
    wrapped = cues.map((cue) => wrapCue(cue.text, fontSize, boxW));
  }

  const text: MosaicSource = {
    type: "text",
    renderMode: { kind: "video" }, // per-layer enable gates evaluate per FRAME
    layers: cues.map((cue, i) => ({
      content: { kind: "literal", text: wrapped[i].join("\n") },
      style: { fontSize, fontColor: theme.ink },
      placement: { hAlign: "center" as const, vAlign: "middle" as const, padding: { x: 0.07, y: 0.1 } },
      overlay: { enable: `between(t,${(cue.startMs / 1000).toFixed(3)},${(cue.endMs / 1000).toFixed(3)})` },
    })),
    editor: { owner: "template", label: `${scene.name}/captions` },
  } as unknown as MosaicSource;

  return isBand ? [plate, text] : [makeColorTile("black@0") as MosaicSource, plate, text];
}

/** Greedy word-wrap against real metrics; oversized words stay whole (drawtext clips). */
function wrapCue(text: string, fontSize: number, maxW: number): string[] {
  const width = (s: string) => measureText(s, { fontSize }).width;
  const out: string[] = [];
  let current = "";
  for (const word of text.replace(/\n/g, " ").split(/\s+/).filter((w) => w.length > 0)) {
    const joined = current.length > 0 ? `${current} ${word}` : word;
    if (width(joined) <= maxW || current.length === 0) {
      current = joined;
    } else {
      out.push(current);
      current = word;
    }
  }
  if (current.length > 0) out.push(current);
  return out.length > 0 ? out : [text];
}

/** Per-image subject anchors from a section's overrides, length-tolerant. */
export function focusFromOverrides(
  overrides: StorySectionOverrides | undefined,
  imageCount: number,
): Array<{ x: number; y: number } | undefined> {
  const raw = overrides?.imageFocus;
  const out: Array<{ x: number; y: number } | undefined> = new Array(imageCount).fill(undefined);
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < imageCount && i < raw.length; i++) {
    const f = raw[i];
    if (
      typeof f === "object" &&
      f !== null &&
      typeof f.x === "number" &&
      f.x >= 0 &&
      f.x <= 1 &&
      typeof f.y === "number" &&
      f.y >= 0 &&
      f.y <= 1
    ) {
      out[i] = { x: f.x, y: f.y };
    }
  }
  return out;
}
