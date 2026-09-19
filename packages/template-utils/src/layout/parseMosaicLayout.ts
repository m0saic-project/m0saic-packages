import type {
  MosaicEngineContext
} from "@m0saic/types";

import {
  parseM0StringToLogicalFrames,
  parseM0StringToRenderFrames,
  parseM0StringToFullGraph,
  type LogicalFrame,
  type RenderFrame,
  type EditorFrame,
} from "@m0saic/dsl";

/**
 * Utilities for templates that need to inspect the concrete layout of an M0 string
 * for the current output resolution.
 *
 * Granularity levels (4-tier model):
 * - parseMosaicFrames: logical-order frames (0-based logicalIndex, stable meta)
 * - parseMosaicRenderFrames: paint-order frames (0-based paintOrder, logicalIndex)
 * - parseMosaicEditorFrames: full structural graph for UI/advanced semantics
 *
 * Uses ctx.output.width/height as the canvas size.
 */

function requireCanvasSize(ctx: MosaicEngineContext): { width: number; height: number } {
  const { width, height } = ctx.output;

  if (!width || !height) {
    throw new Error(
      `parseMosaicLayout requires ctx.output.width/height to be defined`
    );
  }

  return { width, height };
}

/**
 * Logical-order frames (tiles only) with stable meta.
 * Use for templates that need correct tile ordering and identity.
 */
export function parseMosaicFrames(
  M0String: string,
  ctx: MosaicEngineContext
): LogicalFrame[] {
  const { width, height } = requireCanvasSize(ctx);
  return parseM0StringToLogicalFrames(M0String, width, height);
}

/**
 * Paint-order frames for engine/ffmpeg composition.
 * Use when you need paintOrder + logicalIndex binding.
 */
export function parseMosaicRenderFrames(
  M0String: string,
  ctx: MosaicEngineContext
): RenderFrame[] {
  const { width, height } = requireCanvasSize(ctx);
  return parseM0StringToRenderFrames(M0String, width, height);
}

/**
 * Full structural + overlay-aware frame list for advanced templates / UI.
 * Includes group/root nodes, passthrough/null frames, overlay depth, stable keys, etc.
 */
export function parseMosaicEditorFrames(
  M0String: string,
  ctx: MosaicEngineContext
): EditorFrame[] {
  const { width, height } = requireCanvasSize(ctx);
  return parseM0StringToFullGraph(M0String, width, height);
}
