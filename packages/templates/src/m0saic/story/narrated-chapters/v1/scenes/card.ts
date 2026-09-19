/**
 * Card scenes — title / section-card / outro. One builder, three band
 * configs (layout.ts CARD_BANDS). Every band is a REAL m0 cell (Rect
 * Thesis); text is svg-rasterized (R9: static text never spawns drawtext),
 * so fitting uses the same bundled font `measureText` measures — the 0.90
 * caption safety factor is a drawtext concern, not ours; quote-card's 0.98
 * usable-width convention applies.
 */

import { makeColorTile, measureText, resolveFontFile } from "@m0saic/template-utils";
import type { MosaicAssetManifest, MosaicColor, MosaicDocument, MosaicSource } from "@m0saic/types";

import { ASPECT_TABLE, buildCardM0, CARD_BANDS, classifyAspect } from "../layout";
import type { CardBand } from "../layout";
import type { StoryPlan, StoryScene, StoryVariant } from "../plan";
import type { StoryTheme } from "../theme";
import { musicSource } from "./body";
import type { MusicBed } from "./body";

const MIN_FONT_PX = 16;
const USABLE_W = 0.98;
const LINE_HEIGHT = 1.25; // measureText/textToPath default — svg mode is pinned to it

export function buildCardDoc(
  scene: StoryScene,
  variant: StoryVariant,
  plan: StoryPlan,
  theme: StoryTheme,
  music?: MusicBed,
): MosaicDocument {
  if (scene.kind === "body") {
    throw new Error(`buildCardDoc: got a body scene ("${scene.name}")`);
  }
  const bands = CARD_BANDS[scene.kind];
  const spec = ASPECT_TABLE[classifyAspect(variant.width, variant.height)];
  const S = Math.min(variant.width, variant.height);
  const safeW = Math.floor(variant.width * spec.cardSafeW);
  const totalWeight = bands.reduce((a, b) => a + b.weight, 0);

  const sources: MosaicSource[] = bands.map((band) => {
    const bandH = Math.floor((variant.height * band.weight) / totalWeight);
    switch (band.kind) {
      case "spacer":
        return makeColorTile(theme.canvas) as MosaicSource;
      case "bar":
        // A short centered accent bar: one tile, carved by inset — no extra cells.
        return makeColorTile(theme.accent, {
          placement: { inset: { left: 0.44, right: 0.44 } },
        }) as MosaicSource;
      case "kicker":
        return textCell(
          kickerText(scene),
          {
            maxFont: Math.round(S * spec.subScale),
            maxW: safeW,
            bandH,
            color: theme.accent,
            bold: true,
            label: `${scene.name}/kicker`,
          },
        );
      case "heading":
        return textCell(scene.heading, {
          maxFont: Math.round(S * spec.headingScale),
          maxW: safeW,
          bandH,
          color: theme.ink,
          bold: true,
          label: `${scene.name}/heading`,
        });
      case "sub":
        return textCell(scene.subheading ?? "", {
          maxFont: Math.round(S * spec.subScale),
          maxW: safeW,
          bandH,
          color: theme.muted,
          label: `${scene.name}/sub`,
        });
    }
  });

  // The music bed rides every step (there is no pipeline-spanning audio
  // track), offset into the file by the scene's global start.
  const assets: MosaicAssetManifest = {} as MosaicAssetManifest;
  if (music !== undefined) {
    (assets as Record<string, unknown>)[music.assetKey] = {
      kind: "file",
      path: music.path,
      mediaType: "audio",
    };
    sources.push(musicSource(music, scene, plan, `${scene.name}/music`));
  }

  return {
    kind: "mosaic_document",
    version: 1,
    m0: buildCardM0(bands, music !== undefined ? 1 : 0),
    assets,
    sources,
    size: { width: variant.width, height: variant.height },
    fps: plan.fps,
    durationMs: scene.visibleMs + scene.xfadeOutMs,
    backgroundColor: theme.canvas,
    editor: { label: `${variant.name}/${scene.name}` },
  };
}

function kickerText(scene: StoryScene): string {
  return `PART ${String((scene.sectionIndex ?? 0) + 1).padStart(2, "0")}`;
}

type TextCellOptions = {
  maxFont: number;
  maxW: number;
  bandH: number;
  color: MosaicColor;
  bold?: boolean;
  label: string;
};

/** Single svg text cell; empty text degrades to an invisible tile. */
export function textCell(text: string, opts: TextCellOptions): MosaicSource {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return makeColorTile("black@0") as MosaicSource;
  }
  const fit = fitHeadingBlock(trimmed, opts.maxW, Math.max(1, opts.bandH), opts.maxFont, opts.bold === true);
  return {
    type: "text",
    rasterizer: "svg",
    renderMode: { kind: "image" },
    layers: [
      {
        content: { kind: "literal", text: fit.text },
        style: {
          fontSize: fit.fontSize,
          fontColor: opts.color,
          ...(opts.bold ? { fontWeight: "bold" as const } : {}),
        },
        placement: { hAlign: "center" as const, vAlign: "middle" as const },
      },
    ],
    editor: { owner: "template", label: opts.label },
  } as unknown as MosaicSource;
}

export type HeadingFit = { text: string; fontSize: number };

/**
 * Real-metrics fitting (mirrors social/quote-card/v1/layout.ts): try one
 * line at the cap, shrink to the width, fall to a two-line greedy wrap, and
 * as the last resort wrap at the floor size and ellipsize what the band
 * cannot hold — NEVER return unwrapped text that overflows the cell (svg
 * lays glyphs at the exact given size; nothing downstream auto-shrinks).
 * The readable floor tracks the cap: a tiny canvas whose cap sits below
 * 16 px keeps its cap instead of being promoted above it.
 */
export function fitHeadingBlock(
  text: string,
  boxW: number,
  boxH: number,
  maxFont: number,
  bold: boolean,
): HeadingFit {
  const floor = Math.max(8, Math.min(MIN_FONT_PX, maxFont));
  const fontPath = bold ? resolveFontFile({ weight: "bold" })?.path : undefined;
  const usableW = Math.floor(boxW * USABLE_W);
  const width = (s: string, f: number) => measureText(s, { fontSize: f, ...(fontPath ? { fontPath } : {}) }).width;
  const clampFont = (v: number) => Math.max(floor, Math.min(maxFont, v));
  const fitToHeight = (lineCount: number) => clampFont(Math.floor(boxH / (lineCount * LINE_HEIGHT)));

  // Single line at the largest size that fits both axes.
  const oneLineFont = clampFont(Math.floor((maxFont * usableW) / Math.max(1, width(text, maxFont))));
  if (width(text, oneLineFont) <= usableW && oneLineFont >= Math.round(maxFont * 0.62)) {
    return { text, fontSize: Math.min(oneLineFont, fitToHeight(1)) };
  }

  // Two-line greedy wrap, then shrink to fit both axes.
  for (let font = maxFont; font >= floor; font = Math.max(floor, Math.floor(font * 0.9))) {
    const lines = greedyWrap(text, (s) => width(s, font), usableW);
    if (lines !== null && lines.length <= 2 && font <= fitToHeight(lines.length)) {
      return { text: lines.join("\n"), fontSize: font };
    }
    if (font === floor) break; // Math.max keeps font pinned at floor — avoid looping forever
  }

  // Last resort: wrap at the floor, keep the lines the band can hold,
  // ellipsize the remainder (quote-card's degrade posture).
  const maxLines = Math.max(1, Math.floor(boxH / (floor * LINE_HEIGHT)));
  const wrapped = greedyWrap(text, (s) => width(s, floor), usableW) ?? hardSlice(text, (s) => width(s, floor), usableW);
  if (wrapped.length > maxLines) {
    const kept = wrapped.slice(0, maxLines);
    kept[kept.length - 1] = `${kept[kept.length - 1].replace(/…$/, "")}…`;
    return { text: kept.join("\n"), fontSize: floor };
  }
  return { text: wrapped.join("\n"), fontSize: floor };
}

/** Character-level fallback when a single word exceeds the box width. */
function hardSlice(text: string, widthOf: (s: string) => number, maxW: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const ch of text) {
    if (widthOf(current + ch) > maxW && current.length > 0) {
      out.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current.length > 0) out.push(current);
  return out.length > 0 ? out : [text];
}

/** Greedy word wrap against real metrics; null when a single word overflows. */
export function greedyWrap(
  text: string,
  widthOf: (s: string) => number,
  maxW: number,
): string[] | null {
  const out: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
    const joined = current.length > 0 ? `${current} ${word}` : word;
    if (widthOf(joined) <= maxW) {
      current = joined;
      continue;
    }
    if (current.length === 0) return null; // single word wider than the box
    out.push(current);
    current = word;
    if (widthOf(current) > maxW) return null;
  }
  if (current.length > 0) out.push(current);
  return out.length > 0 ? out : null;
}
