// Descriptors for the non-generator layout operations — the editor
// affordances (Compact / Split / Edit / Draw) exposed to agents as
// structured calls. Param sets mirror the inspector controls in
// `apps/mosaic/web/src/components/viewframe/ViewframeControls.tsx` so the
// same knobs a human can reach are exactly what an agent can set.
//
// These descriptors carry NO build functions — transforms and rect-ops
// are applied editor-side by the existing handlers (compactDocument,
// split, null-out + placeRect) so metadata migration stays in one place.

import type { OperationDescriptor } from "./types";

/**
 * Compact the current layout. Mirrors the Compact inspector section: its
 * toggles + the GCD drift budget. Packing is growth-guarded editor-side
 * (compactDocument) — it's applied only when it beats the lossless baseline, so
 * a Compact is never heavier than just simplifying.
 */
export const compactOperationDescriptor: OperationDescriptor = {
  id: "compact",
  title: "Compact",
  description:
    "Compact the current layout — remove dead layers, reduce split counts (lossless), prune dead metadata, optionally repack rectangles onto minimal layers (growth-guarded) and snap edges to a coarser grid (GCD reduce).",
  category: "operation",
  group: "Operations",
  kind: "transform",
  params: [
    {
      key: "removeNullLayers",
      title: "Remove null layers",
      type: "bool",
      default: true,
      description: "Drop root-chain overlay layers with no rendered tiles.",
    },
    {
      key: "pruneMetadata",
      title: "Prune dead metadata",
      type: "bool",
      default: true,
      description: "Strip labels/masks/fills/ranks that no longer point at a rendered frame.",
    },
    {
      key: "reduceSplits",
      title: "Reduce split counts",
      type: "bool",
      default: true,
      description:
        "Lossless: collapse split counts to their minimum by weight-GCD. Shrinks an already tightly-nested m0 in place; never grows or flattens it. A different strategy from Repack.",
    },
    {
      key: "pack",
      title: "Repack rectangles",
      type: "bool",
      default: false,
      description:
        "Repack all rendered rects onto the fewest possible layers. Growth-guarded: applied only when it actually shrinks the layout — if it would balloon an already-tightly-nested m0, the lossless result (null-removal + split reduction) is kept instead, never heavier. Off by default since lossless simplification already handles most docs; opt in for layer-additive exploration docs where collapsing overlay layers is the win.",
    },
    {
      key: "reorder",
      title: "Reorder for fewer layers",
      type: "bool",
      default: false,
      description:
        "Let packing reorder rects (ignore z-order) for the fewest layers. Off keeps the exact stacking; on may change which rect paints on top where they overlap. Only applies when Repack is on.",
    },
    {
      key: "gcdReduce",
      title: "GCD reduce",
      type: "bool",
      default: false,
      description: "Snap edge coordinates to a coarser shared grid so more rects collapse together.",
    },
    {
      key: "gcdDriftPercent",
      title: "Drift budget",
      type: "float",
      default: 1,
      min: 0.1,
      max: 10,
      step: 0.1,
      visibleWhen: { gcdReduce: true },
      description: "Maximum percent any edge may move during GCD reduction.",
    },
  ],
};

/**
 * Split a frame into N rows or columns. Mirrors the Split inspector
 * section: axis buttons + count stepper + optional weights.
 */
export const splitOperationDescriptor: OperationDescriptor = {
  id: "split",
  title: "Split",
  description:
    "Split a frame of the current layout into N rows or columns, equal or weighted.",
  category: "operation",
  group: "Operations",
  kind: "transform",
  needsDocumentContext: true,
  params: [
    {
      key: "axis",
      title: "Axis",
      type: "enum",
      default: "row",
      options: [
        { value: "row", label: "Rows", description: "Stack the parts vertically (horizontal cuts)." },
        { value: "col", label: "Columns", description: "Place the parts side by side (vertical cuts)." },
      ],
      description: "Whether the frame splits into rows or columns.",
    },
    {
      key: "count",
      title: "Split count",
      type: "int",
      default: 2,
      min: 2,
      max: 100,
      description: "How many parts the frame splits into.",
    },
    {
      key: "weights",
      title: "Weights",
      type: "string",
      default: "",
      placeholder: "30,50,20",
      description:
        "Comma-separated relative weights, one per part. Empty = equal parts. Must have exactly `count` entries when set.",
    },
    {
      key: "target",
      title: "Target frame",
      type: "string",
      default: "",
      placeholder: "hero",
      description:
        "Label of the frame to split (see the document's frame list). Empty = the active/selected frame.",
    },
  ],
};

/**
 * Edit (move / resize) an existing frame, addressed by label. Reduces to
 * the null-out + placeRect + relabel primitive editor-side: scale applies
 * first, then pixel deltas.
 */
export const editOperationDescriptor: OperationDescriptor = {
  id: "edit",
  title: "Edit frame",
  description:
    "Move or resize one existing frame of the current layout, addressed by its label — scale it by a percentage and/or nudge position and size by pixels.",
  category: "operation",
  group: "Operations",
  kind: "rect-op",
  needsDocumentContext: true,
  params: [
    {
      key: "target",
      title: "Target frame",
      type: "string",
      default: "",
      placeholder: "hero",
      required: true,
      description: "Label of the frame to edit (see the document's frame list).",
    },
    {
      key: "scalePercent",
      title: "Scale",
      type: "float",
      default: 100,
      min: 1,
      max: 1000,
      description:
        "Resize the frame to this percent of its current size, centered in place. 120 = 20% bigger; 100 = unchanged.",
    },
    {
      key: "dx",
      title: "Move X",
      type: "int",
      default: 0,
      description: "Move the frame horizontally by this many pixels (negative = left).",
    },
    {
      key: "dy",
      title: "Move Y",
      type: "int",
      default: 0,
      description: "Move the frame vertically by this many pixels (negative = up).",
    },
    {
      key: "dw",
      title: "Resize W",
      type: "int",
      default: 0,
      description: "Grow (positive) or shrink (negative) the frame's width by this many pixels.",
    },
    {
      key: "dh",
      title: "Resize H",
      type: "int",
      default: 0,
      description: "Grow (positive) or shrink (negative) the frame's height by this many pixels.",
    },
  ],
};

/**
 * Draw a new frame on the canvas from an English-shaped description:
 * an anchor position plus a size in percent of the canvas. Editor-side
 * this is a single placeRect overlay — cheap and always valid.
 */
export const drawOperationDescriptor: OperationDescriptor = {
  id: "draw",
  title: "Draw frame",
  description:
    "Draw one new frame onto the current layout at a described position — anchor (corner/edge/center) plus a size in percent of the canvas.",
  category: "operation",
  group: "Operations",
  kind: "rect-op",
  needsDocumentContext: true,
  params: [
    {
      key: "anchor",
      title: "Anchor",
      type: "enum",
      default: "center",
      options: [
        { value: "top-left", label: "Top left" },
        { value: "top", label: "Top" },
        { value: "top-right", label: "Top right" },
        { value: "left", label: "Left" },
        { value: "center", label: "Center" },
        { value: "right", label: "Right" },
        { value: "bottom-left", label: "Bottom left" },
        { value: "bottom", label: "Bottom" },
        { value: "bottom-right", label: "Bottom right" },
      ],
      description: "Where the new frame sits on the canvas.",
    },
    {
      key: "widthPercent",
      title: "Width",
      type: "float",
      default: 25,
      min: 1,
      max: 100,
      description: "Width of the new frame as a percent of the canvas width.",
    },
    {
      key: "heightPercent",
      title: "Height",
      type: "float",
      default: 25,
      min: 1,
      max: 100,
      description: "Height of the new frame as a percent of the canvas height.",
    },
    {
      key: "marginPercent",
      title: "Margin",
      type: "float",
      default: 0,
      min: 0,
      max: 45,
      description: "Inset from the anchored edges, as a percent of the canvas (ignored for center).",
    },
    {
      key: "label",
      title: "Label",
      type: "string",
      default: "",
      placeholder: "callout",
      description: "Optional label for the new frame.",
    },
  ],
};

/**
 * All non-generator operation descriptors, in display order. The unified
 * operation catalog an agent routes over is `generators.descriptors`
 * (tagged kind "generator") + this list — see `@m0saic/momo`'s
 * operationCatalog.
 */
export const descriptors: OperationDescriptor[] = [
  compactOperationDescriptor,
  splitOperationDescriptor,
  editOperationDescriptor,
  drawOperationDescriptor,
];
