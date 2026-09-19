/**
 * Contract wireframes — the VISUAL half of BOTH dev tripwires, in BOTH
 * directions.
 *
 * A violation described in prose makes you hunt for the cell; drawn, it points
 * at it. And a contract that silently no-ops on success is indistinguishable
 * from a contract that never ran — so the PASS is drawn too.
 *
 * `buildContractWireframe` (layout contract — label-keyed ratio invariants):
 *   - FAIL: gray-box wireframe of every painted frame, OFFENDING boxes filled
 *     red, the violation text as a bottom banner.
 *   - PASS: the same wireframe with every RULE MEMBER filled green and the
 *     banner listing each rule with its measured result ("bar equal height OK
 *     — spread 0.9% <= 2%") — proof the contract ran and what it checked.
 *
 * `buildGeometryContractWireframe` (geometry contract — intent-vs-realized):
 *   - FAIL: realized boxes red, the INTENDED rect drawn as an amber ghost
 *     outline beside/behind each — the drift is visible as the gap between
 *     the two.
 *   - PASS: every expected element green + "N elements exact" in the banner.
 *
 * Deliberately basic — debug surfaces (`debugLayout` / `debugGeometry`), not
 * product surfaces.
 *
 * Offender selection (layout fail):
 *   - per-element rules (`aspect`, `min/max-*`, `within-*`) carry the exact
 *     `sourceIndex` on the violation — highlighted directly.
 *   - `equal-*` relations name only the label set, so offenders are recomputed
 *     from the resolved boxes: nodes whose metric strays from the MEDIAN by
 *     more than the declared tolerance.
 *   - everything else (`gutter-*`, `lattice-*`, `coverage`, `too-few`) lights
 *     up every box of the violated label — coarse but honest.
 *
 * Builders return null when the wireframe cannot be built (unparseable target,
 * no frames) — callers fall back to their non-visual behavior.
 */

import type {
  MosaicColor,
  MosaicDocument,
  MosaicGeometryContractMatch,
  MosaicGeometryViolation,
  MosaicLayoutViolation,
  MosaicSource,
  MosaicTextSource,
} from "@m0saic/types";
import { bakeDocumentInsets, flattenMosaicDocument } from "@m0saic/platform";
import { placeInsetPieces, type InsetPiece } from "../layout/placeInsetPieces";
import { makeColorTile } from "../sources/makeColorTile";
import { resolveDocFrames } from "./frameResolution";
import type { LayoutConstraint, RelationalConstraint } from "./layoutConstraint";
import type { GeometryExpectation } from "./types";

const BG = "#0d1117" as MosaicColor;
const FRAME_FILL = "#8b949e@0.12" as MosaicColor;
const FRAME_STROKE = "#8b949e" as MosaicColor;
const OFFENDER_FILL = "#f85149@0.35" as MosaicColor;
const OFFENDER_STROKE = "#f85149" as MosaicColor;
const MEMBER_FILL = "#2ea043@0.30" as MosaicColor;
const MEMBER_STROKE = "#3fb950" as MosaicColor;
/** Intended-rect ghost (geometry fail): near-transparent amber, loud outline. */
const GHOST_FILL = "#d29922@0.10" as MosaicColor;
const GHOST_STROKE = "#d29922" as MosaicColor;
const BANNER_BG = "#161b22" as MosaicColor;
/** Wireframe legibility cap — a soup of more frames stops being a wireframe. */
const MAX_FRAMES = 300;

type Rect = { x: number; y: number; w: number; h: number };

function bannerText(text: string, fontSize: number, color: string, bold = false): MosaicTextSource {
  return {
    type: "text",
    visual: { backgroundColor: "black@0" },
    layers: [{
      content: { kind: "literal", text: text || " " },
      style: { fontSize, fontColor: color, ...(bold ? { bold: true } : {}) },
      placement: { hAlign: "left", vAlign: "middle" } as never,
    }],
  } as unknown as MosaicTextSource;
}

/** Median of a non-empty number list. */
function median(vals: number[]): number {
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── Shared shell ─────────────────────────────────────────────

type Shell = {
  pieces: InsetPiece[];
  add: (source: MosaicSource, r: Rect, importance: number) => void;
};

function openShell(w: number, h: number): Shell {
  const clamp = (r: Rect): Rect => {
    const x = Math.max(0, Math.min(w - 1, Math.round(r.x)));
    const y = Math.max(0, Math.min(h - 1, Math.round(r.y)));
    return { x, y, w: Math.max(1, Math.min(Math.round(r.w), w - x)), h: Math.max(1, Math.min(Math.round(r.h), h - y)) };
  };
  const pieces: InsetPiece[] = [];
  const add = (source: MosaicSource, r: Rect, importance: number): void => {
    const c = clamp(r);
    pieces.push({ rect: { x: c.x, y: c.y, w: c.w, h: c.h, importance }, source });
  };
  add(makeColorTile(BG) as MosaicSource, { x: 0, y: 0, w, h }, 0);
  return { pieces, add };
}

const strokeFor = (color: MosaicColor, alpha: number) =>
  ({ stroke: { position: "inner" as const, width: 0.012, color, alpha } });

function boxTile(fill: MosaicColor, stroke: MosaicColor, strokeAlpha: number): MosaicSource {
  return makeColorTile(fill, { effects: strokeFor(stroke, strokeAlpha) }) as MosaicSource;
}

/**
 * Flatten (auto when nested) → optionally bake inset fibers into geometry
 * (painted view, the default) → resolve frames. Null when nothing drawable.
 */
function resolvePaintedTarget(
  doc: MosaicDocument,
  w: number,
  h: number,
  flatten: boolean | undefined,
  boxes: "painted" | "cells" | undefined,
): { framesByLogical: ReturnType<typeof resolveDocFrames>["framesByLogical"]; labelToIndices: ReturnType<typeof resolveDocFrames>["labelToIndices"] } | null {
  let target = doc;
  const nested = !!(doc.children && Object.keys(doc.children).length > 0);
  if (flatten ?? nested) {
    const flat = flattenMosaicDocument({ file: doc, width: w, height: h, resolveRef: () => null });
    // A failed flatten IS a violation elsewhere; there is no geometry to draw.
    if (!flat.ok) return null;
    target = flat.file;
  }
  // Painted view (default): fold the inset fibers back into real geometry so
  // the drawn boxes are the granular intended rects, not the recovery lattice.
  // Bake failure degrades to the cells view rather than losing the wireframe.
  if ((boxes ?? "painted") === "painted") {
    const baked = bakeDocumentInsets(target, { w, h });
    if (baked.ok) target = baked.doc;
    else if (process.env.M0SAIC_WIREFRAME_DEBUG) console.error("[contractWireframe] bake failed:", baked.error);
  }
  try {
    const { framesByLogical, labelToIndices } = resolveDocFrames(target, w, h);
    if (!framesByLogical.length) return null;
    return { framesByLogical, labelToIndices };
  } catch (e) {
    if (process.env.M0SAIC_WIREFRAME_DEBUG) console.error("[contractWireframe] resolve failed:", e);
    return null;
  }
}

/** Banner (bg + title + up to two lines) + placeInsetPieces + doc wrap. */
function closeShell(
  shell: Shell,
  opts: { w: number; h: number; fps?: number; durationMs?: number; title: string; titleColor: string; lines: string[] },
): MosaicDocument | null {
  const { w, h } = opts;
  const bannerH = Math.max(48, Math.min(140, Math.round(h * 0.16)));
  shell.add(makeColorTile(BANNER_BG) as MosaicSource, { x: 0, y: h - bannerH, w, h: bannerH }, 4);
  const pad = Math.round(bannerH * 0.16);
  const titleFont = Math.max(11, Math.round(bannerH * 0.24));
  const lineFont = Math.max(10, Math.round(bannerH * 0.19));
  const moreLines = Math.max(0, opts.lines.length - 2);
  const title = opts.title + (moreLines ? ` (+${moreLines} more)` : "");
  shell.add(bannerText(title, titleFont, opts.titleColor, true), { x: pad, y: h - bannerH + pad, w: w - 2 * pad, h: titleFont * 1.5 }, 5);
  opts.lines.slice(0, 2).forEach((line, k) => {
    shell.add(
      bannerText(line, lineFont, "#c9d1d9"),
      { x: pad, y: h - bannerH + pad + titleFont * 1.5 + k * lineFont * 1.45, w: w - 2 * pad, h: lineFont * 1.4 },
      5,
    );
  });
  try {
    const { m0, sources } = placeInsetPieces({ rootW: w, rootH: h, pieces: shell.pieces });
    return {
      kind: "mosaic_document",
      version: 1,
      assets: {} as never,
      m0: String(m0) as never,
      sources,
      backgroundColor: BG,
      ...(opts.fps != null ? { fps: opts.fps } : {}),
      ...(opts.durationMs != null ? { durationMs: opts.durationMs } : {}),
      size: { width: w, height: h },
    } as MosaicDocument;
  } catch (e) {
    if (process.env.M0SAIC_WIREFRAME_DEBUG) console.error("[contractWireframe] place failed:", e);
    return null;
  }
}

// ── Layout contract (label-keyed ratio invariants) ───────────

export type ViolationWireframeOptions = {
  templateId: string;
  canvasW: number;
  canvasH: number;
  fps?: number;
  durationMs?: number;
  /** The doc the check judged (pre-flatten; flattened here when nested). */
  doc: MosaicDocument;
  violations: MosaicLayoutViolation[];
  /** The declared rules — names the MEMBER boxes (green on pass) and feeds the
   *  pass banner's per-rule measured summaries. */
  constraints?: LayoutConstraint[];
  relations?: RelationalConstraint[];
  /** Mirror of checkLayout's flatten choice. Default: auto (flatten when nested). */
  flatten?: boolean;
  /**
   * Which rects to draw. `"painted"` (default) bakes `placement.inset` fibers
   * back into the geometry (platform `bakeDocumentInsets`, engine-exact floor
   * math) so the wireframe shows the INTENDED granular rects — what the viewer
   * actually sees, and what `checkLayout` judges. `"cells"` draws the raw
   * quantized split cells (the lattice the insets recover from).
   */
  boxes?: "painted" | "cells";
};

export function buildContractWireframe(opts: ViolationWireframeOptions): MosaicDocument | null {
  const w = Math.max(1, Math.round(opts.canvasW));
  const h = Math.max(1, Math.round(opts.canvasH));

  const resolved = resolvePaintedTarget(opts.doc, w, h, opts.flatten, opts.boxes);
  if (!resolved) return null;
  const { framesByLogical, labelToIndices } = resolved;

  // ── Offender indices ──
  const offenders = new Set<number>();
  for (const v of opts.violations) {
    if (v.sourceIndex != null) {
      offenders.add(v.sourceIndex);
      continue;
    }
    const labels = v.label.split("+");
    const idxs = labels.flatMap((l) => labelToIndices.get(l) ?? []);
    if (idxs.length === 0) continue;
    if (v.rule === "equal-width" || v.rule === "equal-height" || v.rule === "equal-aspect") {
      const metric = (i: number): number => {
        const f = framesByLogical[i];
        return v.rule === "equal-width" ? f.width : v.rule === "equal-height" ? f.height : f.width / Math.max(1, f.height);
      };
      const tol = typeof v.expected === "number" ? v.expected : 0.02;
      const med = median(idxs.map(metric));
      for (const i of idxs) if (med > 0 && Math.abs(metric(i) - med) / med > tol) offenders.add(i);
      // Degenerate spread around the median (e.g. two nodes) — light both ends.
      if (![...offenders].some((i) => idxs.includes(i))) idxs.forEach((i) => offenders.add(i));
    } else {
      idxs.forEach((i) => offenders.add(i));
    }
  }

  // ── Rule members (green on pass) + per-rule pass summaries ──
  const failing = opts.violations.length > 0;
  const members = new Set<number>();
  const relLabels = (rel: RelationalConstraint): string[] => (Array.isArray(rel.label) ? rel.label : [rel.label]);
  for (const rel of opts.relations ?? []) for (const l of relLabels(rel)) (labelToIndices.get(l) ?? []).forEach((i) => members.add(i));
  for (const c of opts.constraints ?? []) (labelToIndices.get(c.label) ?? []).forEach((i) => members.add(i));

  const ruleLines: string[] = [];
  if (!failing) {
    const dim = (i: number, k: "width" | "height" | "aspect"): number => {
      const f = framesByLogical[i];
      return k === "width" ? f.width : k === "height" ? f.height : f.width / Math.max(1, f.height);
    };
    const spreadOf = (vals: number[]): number => {
      const mx = Math.max(...vals), mn = Math.min(...vals);
      return mx > 0 ? (mx - mn) / mx : 0;
    };
    for (const rel of opts.relations ?? []) {
      const labels = relLabels(rel);
      const idxs = labels.flatMap((l) => labelToIndices.get(l) ?? []);
      if (rel.equal && idxs.length >= 2) {
        const kinds: Array<"width" | "height" | "aspect"> = rel.equal === "size" ? ["width", "height"] : [rel.equal];
        const spread = Math.max(...kinds.map((k) => spreadOf(idxs.map((i) => dim(i, k)))));
        const tol = rel.tolerance ?? 0.02;
        ruleLines.push(`"${labels.join("+")}" equal ${rel.equal} OK — spread ${(spread * 100).toFixed(1)}% <= ${(tol * 100).toFixed(1)}% (${idxs.length} nodes)`);
      } else if (rel.gutter) {
        ruleLines.push(`"${labels.join("+")}" ${rel.gutter.axis}-gutters uniform OK (${idxs.length} nodes)`);
      } else {
        ruleLines.push(`"${labels.join("+")}" relation OK (${idxs.length} nodes)`);
      }
    }
    for (const c of opts.constraints ?? []) {
      const n = (labelToIndices.get(c.label) ?? []).length;
      const kinds = [
        c.aspect != null ? `aspect ${c.aspect}` : "",
        c.minWidthFrac != null || c.maxWidthFrac != null ? "width-frac" : "",
        c.minHeightFrac != null || c.maxHeightFrac != null ? "height-frac" : "",
        c.within ? "within" : "",
      ].filter(Boolean).join(", ");
      ruleLines.push(`"${c.label}" ${kinds || "present"} OK (${n} node${n === 1 ? "" : "s"})`);
    }
  }

  // ── Pieces: bg → gray frames → green members / red offenders → banner ──
  const shell = openShell(w, h);
  const drawable = framesByLogical
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.width >= 2 && f.height >= 2);
  const omitted = Math.max(0, drawable.length - MAX_FRAMES);
  for (const { f, i } of drawable.slice(0, MAX_FRAMES)) {
    const hot = offenders.has(i);
    const ok = !hot && members.has(i);
    const fill = hot ? OFFENDER_FILL : ok ? MEMBER_FILL : FRAME_FILL;
    const stroke = hot ? OFFENDER_STROKE : ok ? MEMBER_STROKE : FRAME_STROKE;
    shell.add(boxTile(fill, stroke, hot ? 1 : ok ? 0.9 : 0.55), { x: f.x, y: f.y, w: f.width, h: f.height }, hot || ok ? 2 : 1);
  }

  const lines = failing ? opts.violations.map((v) => v.detail) : ruleLines;
  const title =
    (failing ? `LAYOUT_CONTRACT — ${opts.templateId}` : `LAYOUT_CONTRACT OK — ${opts.templateId}`) +
    ` @ ${w}×${h}` +
    (omitted ? ` (${omitted} frames omitted)` : "");
  return closeShell(shell, {
    w, h,
    fps: opts.fps,
    durationMs: opts.durationMs,
    title,
    titleColor: failing ? "#f85149" : "#3fb950",
    lines,
  });
}

// ── Geometry contract (intent-vs-realized) ───────────────────

export type GeometryWireframeOptions = {
  templateId: string;
  canvasW: number;
  canvasH: number;
  fps?: number;
  durationMs?: number;
  /** The doc the check judged. */
  doc: MosaicDocument;
  expectations: GeometryExpectation[];
  violations: MosaicGeometryViolation[];
  /** The checker's expectation → frame matches (drives the green boxes). */
  matched: MosaicGeometryContractMatch[];
  /** Reported in the pass banner. */
  tolerancePx?: number;
  boxes?: "painted" | "cells";
};

/**
 * Draw the geometry contract: every expected element green on pass; on fail
 * the realized box red with the INTENDED rect as an amber ghost outline — the
 * drift is the visible gap between the two.
 */
export function buildGeometryContractWireframe(opts: GeometryWireframeOptions): MosaicDocument | null {
  const w = Math.max(1, Math.round(opts.canvasW));
  const h = Math.max(1, Math.round(opts.canvasH));

  const resolved = resolvePaintedTarget(opts.doc, w, h, undefined, opts.boxes);
  if (!resolved) return null;
  const { framesByLogical } = resolved;

  const failing = opts.violations.length > 0;
  const violatingExp = new Set(opts.violations.map((v) => v.index));
  const frameOfExp = new Map<number, number>();
  for (const m of opts.matched) if (m.sourceIndex != null) frameOfExp.set(m.index, m.sourceIndex);
  const expFrameIdx = new Set(frameOfExp.values());

  const shell = openShell(w, h);

  // Context: every painted frame NOT owned by an expectation, gray.
  const drawable = framesByLogical
    .map((f, i) => ({ f, i }))
    .filter(({ f, i }) => !expFrameIdx.has(i) && f.width >= 2 && f.height >= 2);
  const omitted = Math.max(0, drawable.length - MAX_FRAMES);
  for (const { f } of drawable.slice(0, MAX_FRAMES)) {
    shell.add(boxTile(FRAME_FILL, FRAME_STROKE, 0.55), { x: f.x, y: f.y, w: f.width, h: f.height }, 1);
  }

  // Expectation elements: green when exact; red realized + amber intended ghost when not.
  for (let i = 0; i < opts.expectations.length; i++) {
    const exp = opts.expectations[i];
    const fi = frameOfExp.get(i);
    const frame = fi != null ? framesByLogical[fi] : undefined;
    const frameRect: Rect | undefined = frame ? { x: frame.x, y: frame.y, w: frame.width, h: frame.height } : undefined;
    if (!violatingExp.has(i)) {
      const box = frameRect ?? exp.rect;
      if (box) shell.add(boxTile(MEMBER_FILL, MEMBER_STROKE, 0.9), box, 2);
      continue;
    }
    const vs = opts.violations.filter((v) => v.index === i);
    const realized = vs.find((v) => v.realized)?.realized ?? frameRect;
    const intended = vs.find((v) => v.intended)?.intended ?? exp.rect;
    if (realized) shell.add(boxTile(OFFENDER_FILL, OFFENDER_STROKE, 1), realized, 2);
    if (intended) shell.add(boxTile(GHOST_FILL, GHOST_STROKE, 1), intended, 3);
  }

  const tol = opts.tolerancePx ?? 1;
  const lines = failing
    ? ["red = realized, amber outline = intended", ...opts.violations.map((v) => v.detail)]
    : [`${opts.expectations.length} element${opts.expectations.length === 1 ? "" : "s"} exact — realized == intended (tol ±${tol}px)`];
  const title =
    (failing ? `GEOMETRY_CONTRACT — ${opts.templateId}` : `GEOMETRY_CONTRACT OK — ${opts.templateId}`) +
    ` @ ${w}×${h}` +
    (omitted ? ` (${omitted} frames omitted)` : "");
  return closeShell(shell, {
    w, h,
    fps: opts.fps,
    durationMs: opts.durationMs,
    title,
    titleColor: failing ? "#f85149" : "#3fb950",
    lines,
  });
}
