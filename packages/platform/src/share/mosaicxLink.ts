// Share link ⇄ `.mosaicx`. The link and the file carry the same invocation
// (template id + props + canvas, plus optional fps / duration); this is the
// bridge both ways, so a host can print a link for a file (`m0saic share
// <file.mosaicx>`) or save a received link as a file (the over-cap fallback,
// the Desktop hand-off).

import type { MosaicTemplateInvocationSource, MosaicXDocument } from "@m0saic/types";
import { isMosaicTemplateInvocationSource } from "@m0saic/types";
import { sanitizePropsBag, type TemplateShareAsks, type TemplateShareParams } from "./shareQuery";

/**
 * Lift the share params out of a `.mosaicx`. Requires exactly ONE
 * `template_invocation` source and a positive root size — a multi-invocation
 * doc or a chain has no single "the template" to share. `null` otherwise.
 */
export function shareParamsFromMosaicx(doc: MosaicXDocument): TemplateShareParams | null {
  const invocations = (doc.sources ?? []).filter(isMosaicTemplateInvocationSource);
  if (invocations.length !== 1) return null;
  const inv = invocations[0];
  const size = doc.size;
  if (!size || !(size.width > 0) || !(size.height > 0)) return null;
  const asks: TemplateShareAsks = {};
  if (typeof doc.fps === "number" && doc.fps > 0) asks.fps = Math.round(doc.fps);
  if (typeof doc.durationMs === "number" && doc.durationMs > 0) asks.durationMs = Math.round(doc.durationMs);
  return {
    templateId: String(inv.templateId),
    props: sanitizePropsBag(inv.props) ?? {},
    w: Math.round(size.width),
    h: Math.round(size.height),
    ...(Object.keys(asks).length > 0 ? { asks } : {}),
  };
}

/**
 * The `.mosaicx` a share link denotes: one `template_invocation` at the
 * link's canvas (stamped only when the link carried one — absent, the file
 * resolves at the template's own hint), with fps / durationMs stamped only
 * when the link asked for them. The `m0` is the canonical single-frame placeholder — the real
 * geometry is produced when the invocation resolves at engine time.
 */
export function mosaicxFromShareParams(params: TemplateShareParams): MosaicXDocument {
  const invocation: MosaicTemplateInvocationSource = {
    type: "template_invocation",
    templateId: params.templateId as MosaicTemplateInvocationSource["templateId"],
    props: sanitizePropsBag(params.props) ?? {},
  };
  return {
    kind: "mosaicx_document",
    version: 1,
    m0: "1" as MosaicXDocument["m0"],
    assets: {} as MosaicXDocument["assets"],
    ...(params.w != null && params.h != null ? { size: { width: params.w, height: params.h } } : {}),
    ...(params.asks?.fps != null ? { fps: params.asks.fps } : {}),
    ...(params.asks?.durationMs != null ? { durationMs: params.asks.durationMs } : {}),
    sources: [invocation],
  };
}
