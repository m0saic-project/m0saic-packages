import type {
  MosaicTemplateProps,
  MosaicRenderableFile,
  MosaicEngineContext,
} from "@m0saic/types";
import { requireTemplate } from "../template/templateRegistry";
import { renderTemplateToRenderableFile } from "./renderTemplateToRenderableFile";

/**
 * Optional slot info a parent template can pass to a nested render
 * call. When supplied, the helper builds a child context whose
 * {@link MosaicEngineContext.target} reflects the slot dimensions
 * rather than the parent's canvas. Templates that render adaptively
 * (pixel-aware effects, text sizing, perf-aware element counts)
 * read `ctx.target.{width,height}` and get the slot-specific values.
 *
 * Parents that don't care about slot-awareness omit `slot`; the
 * child sees the parent's `ctx.target` unchanged — matching the
 * pre-2026-05-15 behavior.
 *
 * `fps` and `durationMs` default to the parent's `target` values
 * when omitted; pass them only if the slot has different timing.
 */
export type RenderNestedSlot = {
  width: number;
  height: number;
  fps?: number;
  durationMs?: number;
};

export type RenderNestedOpts = {
  slot?: RenderNestedSlot;
};

export async function renderNestedTemplate(
  templateId: string,
  props: MosaicTemplateProps,
  context: MosaicEngineContext,
  opts?: RenderNestedOpts,
): Promise<MosaicRenderableFile> {
  const template = requireTemplate(templateId);

  const childCtx: MosaicEngineContext = opts?.slot
    ? {
        ...context,
        target: {
          width: opts.slot.width,
          height: opts.slot.height,
          fps: opts.slot.fps ?? context.target.fps,
          durationMs: opts.slot.durationMs ?? context.target.durationMs,
        },
      }
    : context;

  const rendered = await renderTemplateToRenderableFile(template, props, childCtx);

  // Without `slot`, the child rendered against the PARENT's ctx.target, so
  // the wrapper-stamped `size` ("stamp at write time") describes the parent
  // canvas — NOT this child's natural aspect. The engine's natural-dims
  // inference (buildChildMosaicSource) trusts a declared `size` as the
  // aspect signal and letterboxes the child into any differently-shaped
  // cell, which put gutters around every slot-less nested child (e.g. the
  // wireframe cell templates). Strip the misleading stamp so slot-less
  // children keep exact-fit; slot-aware callers carry accurate sizes and
  // get intentional letterboxing.
  if (!opts?.slot && rendered.kind === "mosaic_document" && rendered.size) {
    const { size: _parentCanvasStamp, ...rest } = rendered;
    return rest as MosaicRenderableFile;
  }

  return rendered;
}
