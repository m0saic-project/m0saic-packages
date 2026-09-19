/**
 * Render-time template conventions — the second seam (plan
 * the internal template-conventions-v1 notes, 2026-09-06).
 *
 * `enforceTemplateConventions` sees only the schema. Prop bindings and drawn
 * copy live on RENDERED sources, so these rules render the template at its
 * `defaultProps` on its hinted canvas and audit the document. Every repo's
 * `check-registry` build gate runs this over the whole registry; findings use
 * the same shape and posture table as the definition-time seam.
 *
 *  - `rendersAtDefaults` — `render(defaultProps, ctx)` resolves. A template
 *    whose required inputs have no default (a media path, a source id) is
 *    SKIPPED, not failed — its defaults are incomplete by design.
 *  - `bindingsSound`     — every `editor.binding` on the ROOT document
 *    resolves against `propsSchema` (`resolvePropBindings(...).rejected` is
 *    empty). Bindings inside nested `mosaic` children belong to the child's
 *    schema and are out of scope here.
 *  - `bindingsCover`     — "prop provenance": a free-text string prop whose
 *    default value is drawn verbatim as text must be bound to a rect. This
 *    is the heuristic form of "bind what you display"; numbers are excluded
 *    on purpose (formatted values rarely equal the raw prop).
 *  - `svgGlyphCoverage`  — every character in `rasterizer: "svg"` text has a
 *    glyph in the font the source resolves to (missing glyphs draw as tofu).
 *    Checked against the REAL font, not an ASCII rule: the bundled Roboto
 *    carries the typographic set (… “ ” · × – —) and lacks arrows / ticks.
 *  - `safeMinimumCanvas` — at its hinted canvas the FLATTENED layout clears
 *    its safe minimum (feasibility ∨ precision floor, per axis). A template
 *    below its own floor at its own default size squashes or culls cells the
 *    moment it opens in Make (weighted-cards, 2026-09-06: a slider-scaled
 *    1303-slot split, a prime, pinned the floor to 1303px on a 720p hint).
 *  - `canvasEnvelope`    — the same check on the standard canvases (opt-in:
 *    `sweepCanvases`); reports which of them fall below the floor.
 *  - `deterministic`     — rendering the defaults twice yields the same
 *    document. Catches the clock, unseeded randomness, ambient state.
 *  - `textFits`          — every `rasterizer: "svg"` text layer fits the
 *    cell it lands on (measured with the rasterizer's own font, after the
 *    placement's inset and padding). Svg text never wraps or scales itself;
 *    an unfitted string clips silently — the #1 agent-authored defect.
 *  - `costBudget`        — the rendered document stays inside the engine's
 *    comfort zone ({@link COST_BUDGETS}): frames, sources, overlay depth,
 *    inline masks — operations, never string length. Agents over-generate;
 *    the walls behind each ceiling are real (quadratic lavfi chains, dropped
 *    overlay layers, argv overflow).
 *  - `latticeSmooth`     — every split count above 12 in the rendered tree
 *    (root + nested children) is 5-smooth (2ᵃ·3ᵇ·5ᶜ), so the layout composes
 *    (handbook composition-arithmetic §1–§2; `../lattice`). The tree is
 *    WALKED, not flattened, so a child whose flatten fails below its floor
 *    is still measured, and with `sweepCanvases` the standard canvases are
 *    checked too (a self-frame on the lattice at its hint can miss at 1080p).
 *    `template.lattice` declares the exceptions: a baked raster (`mode:
 *    "bitmap"`, skipped), content counts (`allow`), a physical canvas.
 *
 * The audit also returns the template's LAYOUT FINGERPRINT — the flattened
 * m0 at the hinted canvas — which the build gate and the doctor compare to
 * the committed `layout-fingerprints/<id>.fingerprint` (`layoutFingerprint`,
 * a throw): an unintended layout change surfaces as a reviewable diff.
 *
 * Capability-tier templates are skipped: they need host handles a bare ctx
 * cannot supply, and some (benchmark runners) spawn processes.
 */

import { resolveTemplateOutputHints } from "./resolveTemplateOutputHints";
import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicTemplate,
  MosaicTemplatePropDefinition,
  MosaicTemplateProps,
} from "@m0saic/types";
import { getComplexityMetricsFast, parseM0StringComplete, validateM0String } from "@m0saic/dsl";
import { bundledFontPath, getCachedFont, getOpentype, measureText, registerBundledFonts, resolveFontFile, setCachedFont } from "@m0saic/text";

import { checkLayoutFloors, flattenMosaicDocument } from "@m0saic/platform";

import { resolveDocFrames, resolvePropBindings } from "../geometry-contract/frameResolution";
import { latticeViolations } from "../lattice/latticeReport";
import { walkPropDefinitions } from "./auditSchemaConventions";
import { deepFreezeTemplate } from "./templateRegistry";
import type { TemplateConventionViolation } from "./auditSchemaConventions";
import { makeTemplateConventionFinding, recordTemplateConventionFinding, clearTemplateConventionFinding } from "./templateConventions";
import type { TemplateConventionFinding, TemplateConventionName } from "./templateConventions";

export type AuditRenderedTemplateOptions = {
  /** Canvas; defaults to the template's `outputHints`, then 1280×720. */
  width?: number;
  height?: number;
  /** Mark findings as recorded for an external repo (never fatal). */
  external?: boolean;
  /** `ctx.output.workspaceDir` for the render; a scratch path by default. */
  workspaceDir?: string;
  /** Also record the findings in the shared convention log (default true). */
  record?: boolean;
  /** Extra canvases to render at for the `canvasEnvelope` rule (the standard
   *  set is {@link STANDARD_SWEEP_CANVASES}); none by default — a build gate
   *  renders once, a sweep is opt-in. */
  sweepCanvases?: ReadonlyArray<{ width: number; height: number }>;
};

/** The canvases a `--sweep` walks: 1080p landscape, portrait, square. */
export const STANDARD_SWEEP_CANVASES: ReadonlyArray<{ width: number; height: number }> = [
  { width: 1920, height: 1080 },
  { width: 1080, height: 1920 },
  { width: 1080, height: 1080 },
];

/** The flattened layout at a canvas — what `layout-fingerprints/*.fingerprint` stores. */
export type LayoutFingerprint = {
  canvas: { width: number; height: number };
  /** Flattened m0 per root document, in step order (one `.m0` file each on disk). */
  docs: string[];
  /** `docs` joined by "\n" — the string the hash and the diff are taken over. */
  m0: string;
  /** FNV-1a (64-bit, hex) of `m0` — a short id for logs; the file holds the string. */
  hash: string;
  chars: number;
  frames: number;
};

/**
 * Ceilings for `costBudget` (advisory — record posture). Each maps to a real
 * engine wall, and every one counts OPERATIONS, not characters: the m0
 * string never reaches ffmpeg, and a baked-inset layout (`placeInsetPieces`)
 * is thousands of passthrough slots for a handful of frames. The lavfi chain
 * is quadratic in ops (founder measurement 2026-09-06), so frames, sources
 * and overlay layers are the levers; string length is a tutorial-display
 * concern, not a cost.
 */
export const COST_BUDGETS = {
  /** Rendered leaves. Past a few hundred tiles the argv-era planner budgets bite. */
  frames: 400,
  /** Root sources. */
  sources: 400,
  /** Overlay nesting. The engine drops inline masks past ~25 layers. */
  overlayDepth: 20,
  /** Inline masks. Hundreds overflow the mask resolver's argv. */
  inlineMasks: 200,
} as const;

export type RenderedTemplateAudit = {
  templateId: string;
  canvas: { width: number; height: number };
  /** The flattened layout at `canvas` (absent when nothing rendered). */
  layout?: LayoutFingerprint;
  /** Set when the template was not rendered; `findings` is then empty. */
  skipped?: string;
  /** Rules that could not run (e.g. the font could not be loaded). */
  notes: string[];
  findings: TemplateConventionFinding[];
};

const RENDER_TIME_CONVENTIONS: readonly TemplateConventionName[] = [
  "rendersAtDefaults",
  "bindingsSound",
  "bindingsCover",
  "svgGlyphCoverage",
  "safeMinimumCanvas",
  "canvasEnvelope",
  "deterministic",
  "textFits",
  "costBudget",
  "latticeSmooth",
];

/** FNV-1a over UTF-16 code units, two 32-bit lanes → 16 hex chars. Pure JS: no `node:crypto`, so the web bundle stays clean. */
export function fingerprintHash(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c + i), 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** Build the fingerprint record for a set of root documents at a canvas. */
export function layoutFingerprintOf(docs: MosaicDocument[], width: number, height: number): LayoutFingerprint | undefined {
  const parts: string[] = [];
  let frames = 0;
  for (const doc of docs) {
    const m0 = flattenedM0(doc, width, height);
    if (!m0) continue;
    parts.push(m0);
    try {
      frames += getComplexityMetricsFast(m0).frameCount;
    } catch {
      /* invalid m0 is someone else's finding */
    }
  }
  if (parts.length === 0) return undefined;
  const m0 = parts.join("\n");
  return { canvas: { width, height }, docs: parts, m0, hash: fingerprintHash(m0), chars: m0.length, frames };
}

/**
 * Compare a committed fingerprint string with the current layout. `same`
 * when byte-identical; else a detail naming where they diverge and how the
 * frame counts moved — the reviewable half of an unintended layout change.
 */
export function diffLayoutFingerprint(stored: string, current: string): { same: boolean; detail: string } {
  if (stored === current) return { same: true, detail: "" };
  let i = 0;
  const n = Math.min(stored.length, current.length);
  while (i < n && stored[i] === current[i]) i++;
  const frames = (m0: string): string => {
    try {
      return String(getComplexityMetricsFast(m0.split("\n")[0]).frameCount);
    } catch {
      return "?";
    }
  };
  const snip = (m0: string): string => m0.slice(Math.max(0, i - 12), i + 28).replace(/\n/g, "⏎");
  return {
    same: false,
    detail:
      `flattened layout differs from the committed fingerprint at char ${i} ` +
      `(committed ${stored.length} chars / ${frames(stored)} frames → now ${current.length} chars / ${frames(current)} frames): ` +
      `…${snip(stored)}… → …${snip(current)}…`,
  };
}

/** The `layoutFingerprint` finding for a changed layout (null when unchanged). */
export function layoutFingerprintFinding(templateId: string, stored: string, current: string, external = false): TemplateConventionFinding | null {
  const d = diffLayoutFingerprint(stored, current);
  if (d.same) return null;
  return makeTemplateConventionFinding(templateId, "layoutFingerprint", [{ key: "layout", detail: d.detail }], external);
}

/** `costBudget` violations for one root document at a canvas. */
function costViolations(doc: MosaicDocument, width: number, height: number): TemplateConventionViolation[] {
  const out: TemplateConventionViolation[] = [];
  const m0 = flattenedM0(doc, width, height);
  if (!m0 || !validateM0String(m0).ok) return out;
  const over = (key: keyof typeof COST_BUDGETS, value: number, consequence: string): void => {
    if (value > COST_BUDGETS[key]) out.push({ key, detail: `${key} ${value} exceeds the budget of ${COST_BUDGETS[key]} — ${consequence}` });
  };
  let frames = 0;
  try {
    frames = getComplexityMetricsFast(m0).frameCount;
  } catch {
    /* ignore */
  }
  over("frames", frames, "past a few hundred tiles the planner's per-process budgets bite and the canvas blanks.");
  const sources = (doc.sources ?? []) as unknown as AnyRecord[];
  over("sources", sources.length, "every source is an ffmpeg input or filter; hundreds multiply the graph.");
  let depth = 0;
  try {
    const parsed = parseM0StringComplete(m0, width, height);
    if (parsed.ok) for (const f of parsed.ir.editorFrames) depth = Math.max(depth, Number((f as AnyRecord).overlayDepth ?? 0));
  } catch {
    /* ignore */
  }
  over("overlayDepth", depth, "the engine drops inline masks past ~25 overlay layers; nest a child document instead.");
  const masks = sources.filter((s) => s && typeof s === "object" && (s.mask as AnyRecord | undefined)?.kind === "inline-mask").length;
  over("inlineMasks", masks, "hundreds of inline masks overflow the mask resolver's argv.");
  return out;
}

/** Resolve a `MosaicBoxFrac` (number | {x,y,top,right,bottom,left}) to per-side fractions. */
function sides(v: unknown): { top: number; right: number; bottom: number; left: number } {
  if (typeof v === "number") return { top: v, right: v, bottom: v, left: v };
  const o = (v ?? {}) as Record<string, unknown>;
  const n = (k: string, fallback: number): number => (typeof o[k] === "number" ? (o[k] as number) : fallback);
  const x = n("x", 0);
  const y = n("y", 0);
  return { top: n("top", y), right: n("right", x), bottom: n("bottom", y), left: n("left", x) };
}

/** First differing key path between two JSON-able values ("" when equal). */
function firstDiff(a: unknown, b: unknown, path = "$"): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return path;
  if (Array.isArray(a) !== Array.isArray(b)) return path;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  for (const k of new Set([...ka, ...kb])) {
    const d = firstDiff((a as AnyRecord)[k], (b as AnyRecord)[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

/** `textFits` violations for the svg text layers of a document at a canvas. */
function textFitViolations(doc: MosaicDocument, width: number, height: number, notes: string[]): TemplateConventionViolation[] {
  const out: TemplateConventionViolation[] = [];
  const { framesByLogical } = resolveDocFrames(doc, width, height);
  const sources = (doc.sources ?? []) as unknown as AnyRecord[];
  sources.forEach((src, i) => {
    if (!src || src.type !== "text" || src.rasterizer !== "svg" || !Array.isArray(src.layers)) return;
    const frame = framesByLogical[i];
    if (!frame) return;
    const base = (src.style ?? {}) as AnyRecord;
    const srcPlacement = (src.placement ?? {}) as AnyRecord;
    for (const [li, layer] of (src.layers as AnyRecord[]).entries()) {
      const content = layer?.content as AnyRecord | undefined;
      if (!content || content.kind !== "literal" || typeof content.text !== "string" || !content.text.trim()) continue;
      const style = { ...base, ...((layer.style ?? {}) as AnyRecord) };
      const fontSize = style.fontSize;
      if (typeof fontSize !== "number" || !(fontSize > 0)) continue;
      const placement = { ...srcPlacement, ...((layer.placement ?? {}) as AnyRecord) };
      const inset = sides(placement.inset);
      const pad = sides(placement.padding);
      const insetW = frame.width * Math.max(0, 1 - inset.left - inset.right);
      const insetH = frame.height * Math.max(0, 1 - inset.top - inset.bottom);
      // A plain-number xExpr / yExpr is a pixel offset from the box's left /
      // top (multi-colour code lines place one token per layer this way);
      // the token must fit from that offset to the far edge.
      const px = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : 0);
      const availW = insetW * Math.max(0, 1 - pad.left - pad.right) - Math.max(0, px(placement.xExpr));
      const availH = insetH * Math.max(0, 1 - pad.top - pad.bottom) - Math.max(0, px(placement.yExpr));
      const font = fontFor({
        text: content.text,
        svg: true,
        family: typeof style.fontFamily === "string" ? style.fontFamily : undefined,
        weight: style.fontWeight as DrawnText["weight"],
        style: style.fontStyle as DrawnText["style"],
      });
      let m: { width: number; height: number; lines: number };
      try {
        m = measureText(content.text, { fontSize, ...(font ? { fontPath: font.path } : {}) });
      } catch (err) {
        notes.push(`textFits: could not measure src[${i}] layer ${li}: ${firstLine(err)}`);
        continue;
      }
      // Height by the EM, not ascent+descent: glyph ink lives inside the em
      // box, and cells are sized to it — a 23px "●" in a 28px cell is fine
      // even though its font metrics span 30px. Extra lines add a line step.
      const lineHeight = typeof style.lineHeight === "number" ? style.lineHeight : 1.25;
      const inkH = fontSize + Math.max(0, m.lines - 1) * fontSize * lineHeight;
      // Advance width carries side bearings the ink does not use (a "●" at
      // 23px advances 14px, inks ~11): a tenth of an em is metric slack, not
      // clipping. Real clipping overflows by whole words.
      const slack = Math.max(1, fontSize * 0.1);
      if (m.width > availW + slack || inkH > availH + slack) {
        const snippet = content.text.replace(/\s+/g, " ").slice(0, 32) + (content.text.length > 32 ? "…" : "");
        out.push({
          key: `src[${i}]${src.layers.length > 1 ? `.layer[${li}]` : ""}`,
          detail:
            `"${snippet}" at ${fontSize}px needs ${Math.round(m.width)}×${Math.round(inkH)} px but its cell offers ` +
            `${Math.round(availW)}×${Math.round(availH)} px at ${width}×${height} — svg text clips silently.`,
        });
      }
    }
  });
  return out;
}

const dims = (c: { width: number; height: number }): string => `${Math.round(c.width)}×${Math.round(c.height)}`;

/** The flattened m0 of a document at a canvas (children inlined), or null. */
function flattenedM0(doc: MosaicDocument, width: number, height: number): string | null {
  const hasChildren = !!doc.children && Object.keys(doc.children).length > 0;
  try {
    const flat = flattenMosaicDocument({ file: doc, width, height, resolveRef: () => null });
    if (flat.ok) return String(flat.file.m0);
  } catch {
    /* fall through */
  }
  // Flatten parses at the canvas, so BELOW the feasibility floor it fails on
  // the very 0-size cells this rule reports. A flat document's own m0 is the
  // rendered layout, so read the floors off it directly; a nested one whose
  // flatten failed is left to the planner's diagnostics.
  return hasChildren ? null : String(doc.m0);
}

/** Violations for docs whose flattened layout is below its floor at a canvas. */
function floorViolations(docs: MosaicDocument[], width: number, height: number): TemplateConventionViolation[] {
  const out: TemplateConventionViolation[] = [];
  for (const doc of docs) {
    const m0 = flattenedM0(doc, width, height);
    if (!m0) continue;
    const check = checkLayoutFloors(m0, { width, height });
    if (!check || !check.below) continue;
    const f = check.floors;
    out.push({
      key: dims({ width, height }),
      detail:
        `at ${dims({ width, height })} the layout's safe minimum is ${dims(f.safeMin)} ` +
        `(feasibility ${dims(f.feasibility)}, precision ${dims(f.precision)}) — ` +
        (check.culls ? "cells are culled: content is missing." : "cells are squashed."),
    });
  }
  return out;
}

type SchemaMap = Record<string, MosaicTemplatePropDefinition>;
type AnyRecord = Record<string, unknown>;

function ctxFor(width: number, height: number, fps: number, durationMs: number, workspaceDir: string): MosaicEngineContext {
  const target = { width, height, fps, durationMs };
  return { mode: "render", target, output: { ...target, workspaceDir }, media: {} } as unknown as MosaicEngineContext;
}

function firstLine(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split("\n")[0].slice(0, 200);
}

/** Root-document list of a renderable: the document itself, or a pipeline's inline step files. */
function documentsOf(renderable: unknown): MosaicDocument[] {
  const r = renderable as AnyRecord | null;
  if (!r || typeof r !== "object") return [];
  if (r.kind === "mosaic_document" && Array.isArray(r.sources)) return [r as unknown as MosaicDocument];
  if (r.kind === "mosaic_pipeline" && Array.isArray(r.steps)) {
    return (r.steps as AnyRecord[])
      .map((s) => s.file)
      .filter((f): f is MosaicDocument => !!f && typeof f === "object" && Array.isArray((f as AnyRecord).sources));
  }
  return [];
}

/**
 * Every m0 string in a rendered tree: the document's own, then each nested
 * child's (recursively; a pipeline child contributes its step files). The tree
 * is walked rather than flattened so a child that cannot flatten at this canvas
 * (below its own floor) is still measured. `mosaicx_*` children are
 * invocations, not geometry — counted in `skipped`, never scanned. Shared
 * subtrees are visited once. A document whose `engine.lattice.mode` is
 * `"bitmap"` (a QR the parent assembled) is counted in `skipped.bitmap` and
 * not scanned, subtree included.
 */
function collectM0Strings(
  doc: MosaicDocument,
  out: string[] = [],
  skipped: { mosaicx: number; bitmap: number } = { mosaicx: 0, bitmap: 0 },
  seen: Set<unknown> = new Set(),
): { m0s: string[]; skipped: { mosaicx: number; bitmap: number } } {
  if (seen.has(doc)) return { m0s: out, skipped };
  seen.add(doc);
  // A document that declares itself a baked raster (a QR assembled by the
  // parent) is skipped with its subtree — the per-document form of
  // `template.lattice.mode`.
  if (doc.engine?.lattice?.mode === "bitmap") {
    skipped.bitmap++;
    return { m0s: out, skipped };
  }
  if (typeof doc.m0 === "string") out.push(doc.m0);
  const children = (doc as unknown as AnyRecord).children as Record<string, unknown> | undefined;
  if (children && typeof children === "object") {
    for (const child of Object.values(children)) {
      const kind = (child as AnyRecord | null)?.kind;
      if (typeof kind === "string" && kind.startsWith("mosaicx_")) {
        skipped.mosaicx++;
        continue;
      }
      for (const d of documentsOf(child)) collectM0Strings(d, out, skipped, seen);
    }
  }
  return { m0s: out, skipped };
}

/** Literal text drawn by a text source's layers: `[text, resolvedStyle]`. */
type DrawnText = { text: string; svg: boolean; family?: string; weight?: number | "normal" | "bold"; style?: "normal" | "italic" };

function drawnTextOf(doc: MosaicDocument): DrawnText[] {
  const out: DrawnText[] = [];
  for (const src of (doc.sources ?? []) as unknown as AnyRecord[]) {
    if (!src || src.type !== "text" || !Array.isArray(src.layers)) continue;
    const svg = src.rasterizer === "svg";
    const base = (src.style ?? {}) as AnyRecord;
    for (const layer of src.layers as AnyRecord[]) {
      const content = layer?.content as AnyRecord | undefined;
      if (!content || content.kind !== "literal" || typeof content.text !== "string") continue;
      const style = { ...base, ...((layer.style ?? {}) as AnyRecord) };
      out.push({
        text: content.text,
        svg,
        family: typeof style.fontFamily === "string" ? style.fontFamily : undefined,
        weight: style.fontWeight as DrawnText["weight"],
        style: style.fontStyle as DrawnText["style"],
      });
    }
  }
  return out;
}

const CLOSED_OR_PICKED = (def: MosaicTemplatePropDefinition): boolean => {
  const c = def.meta?.constraints as AnyRecord | undefined;
  const k = def.meta?.control as AnyRecord | undefined;
  return Boolean(
    (Array.isArray(c?.oneOf) && (c!.oneOf as unknown[]).length > 0) ||
      c?.isColor ||
      (Array.isArray(k?.options) && (k!.options as unknown[]).length > 0) ||
      k?.optionsFrom ||
      k?.optionsFromConnection ||
      k?.colorPicker ||
      k?.picker,
  );
};

/** Free-text string props: the ones Make would bind as plain text. */
function freeTextProps(schema: SchemaMap | undefined): string[] {
  const keys: string[] = [];
  walkPropDefinitions(schema, (key, def) => {
    if (def.type !== "string") return;
    if (def.meta?.ui?.hidden) return;
    if (def.meta?.ui?.consumer === "human") return;
    if (CLOSED_OR_PICKED(def)) return;
    keys.push(key);
  });
  return keys;
}

function valueAt(obj: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as AnyRecord)[k] : undefined), obj);
}

function fontFor(t: DrawnText): { path: string; label: string } | null {
  try {
    registerBundledFonts();
    const resolved = resolveFontFile({ family: t.family, weight: t.weight, style: t.style });
    const path = resolved?.path ?? bundledFontPath();
    return { path, label: t.family ?? "the bundled font" };
  } catch {
    return null;
  }
}

/** Load a font from disk once (node only); null when this host cannot. */
function loadFont(path: string): { charToGlyph(ch: string): { index: number } } | null {
  const cached = getCachedFont(path);
  if (cached) return cached as unknown as { charToGlyph(ch: string): { index: number } };
  try {
    const ot = getOpentype() as unknown as { loadSync?: (p: string) => unknown };
    if (typeof ot.loadSync !== "function") return null;
    const font = ot.loadSync(path);
    setCachedFont(path, font as never);
    return font as { charToGlyph(ch: string): { index: number } };
  } catch {
    return null;
  }
}

/**
 * Render `template` at its defaults and audit the render-time conventions.
 * Never throws for a template failure — a throwing render IS a finding (or a
 * skip when the template's required inputs have no default).
 */
export async function auditRenderedTemplate<P extends MosaicTemplateProps>(
  template: MosaicTemplate<P>,
  opts: AuditRenderedTemplateOptions = {},
): Promise<RenderedTemplateAudit> {
  const templateId = String(template.id);
  // The canvas a host would seed at defaults: static hints, with a
  // prop-aware resolver's answer merged over them.
  const hints = resolveTemplateOutputHints(template, template.defaultProps as never) as AnyRecord;
  const width = opts.width ?? (typeof hints.width === "number" ? hints.width : 1280);
  const height = opts.height ?? (typeof hints.height === "number" ? hints.height : 720);
  const fps = typeof hints.fps === "number" ? hints.fps : 30;
  const durationMs = typeof hints.durationMs === "number" ? hints.durationMs : 4000;
  const external = opts.external ?? false;
  const shouldRecord = opts.record ?? true;
  const audit: RenderedTemplateAudit = { templateId, canvas: { width, height }, notes: [], findings: [] };
  const violationsByConvention = new Map<TemplateConventionName, TemplateConventionViolation[]>();
  const push = (c: TemplateConventionName, v: TemplateConventionViolation): void => {
    const l = violationsByConvention.get(c) ?? [];
    if (!l.some((x) => x.key === v.key && x.detail === v.detail)) l.push(v);
    violationsByConvention.set(c, l);
  };

  if (template.capabilities?.tier === "capability") {
    audit.skipped = "capability tier — needs host handles a bare ctx cannot supply";
    return audit;
  }

  const schema = template.propsSchema as SchemaMap | undefined;
  const defaults = (template.defaultProps ?? {}) as AnyRecord;
  // Render what PRODUCTION renders. Every host hands render() a SHALLOW copy
  // of defaultProps (`{ ...template.defaultProps, ...userProps }` — CLI make,
  // desktop preview, web Make, core resolveMosaicx), and a registered
  // template is deep-frozen, so the nested default objects/arrays reach the
  // template FROZEN: a render that sorts, pushes or assigns into one of them
  // throws a TypeError for the user. A JSON clone here (the old shape) handed
  // the template fresh mutable copies and hid exactly that class of failure
  // from the gate and from `m0saic doctor`. `deepFreezeTemplate` is idempotent
  // — a no-op on a registered template, and the registry's own treatment for
  // one audited before registration.
  const productionDefaults = (): P => ({ ...deepFreezeTemplate(defaults) }) as P;
  const missingRequired = Object.entries(schema ?? {})
    .filter(([k, d]) => d?.required && defaults[k] === undefined)
    .map(([k]) => k);

  let rendered: unknown;
  try {
    const ctx = ctxFor(width, height, fps, durationMs, opts.workspaceDir ?? "/tmp/m0saic-template-audit");
    rendered = await template.render(productionDefaults(), ctx);
  } catch (err) {
    if (missingRequired.length > 0) {
      audit.skipped = `requires inputs with no default: ${missingRequired.join(", ")}`;
      return audit;
    }
    push("rendersAtDefaults", { key: "render", detail: `render(defaultProps) at ${width}×${height} threw: ${firstLine(err)}` });
  }

  const docs = documentsOf(rendered);
  for (const v of floorViolations(docs, width, height)) push("safeMinimumCanvas", v);

  // Same inputs, same document. A second render at the same canvas must
  // equal the first byte for byte (through JSON — the on-disk truth).
  if (rendered !== undefined) {
    try {
      const ctx2 = ctxFor(width, height, fps, durationMs, opts.workspaceDir ?? "/tmp/m0saic-template-audit");
      const again = await template.render(productionDefaults(), ctx2);
      const a = JSON.parse(JSON.stringify(rendered));
      const b = JSON.parse(JSON.stringify(again));
      const diff = firstDiff(a, b);
      if (diff) {
        push("deterministic", { key: diff, detail: `two renders of defaultProps at ${width}×${height} differ at ${diff} — a clock, Math.random, an ambient read, or a per-call id is leaking into the document.` });
      }
    } catch (err) {
      push("deterministic", { key: "render", detail: `the second render of defaultProps threw where the first did not: ${firstLine(err)}` });
    }
  }

  for (const doc of docs) {
    for (const v of textFitViolations(doc, width, height, audit.notes)) push("textFits", v);
    for (const v of costViolations(doc, width, height)) push("costBudget", v);
  }

  // latticeSmooth — the split counts of the whole rendered tree, at the hinted
  // canvas and (with `sweepCanvases`) on the standard ones: a self-frame that
  // is on the lattice at its 360² hint can still land on 99 divisions at 1080p.
  // The probe canvases are 5-smooth, so what this catches is CONSTRUCTION (a
  // basis rounded off the lattice), not hostile-canvas degradation.
  const lattice = template.lattice;
  const latticeAllowed = (lattice?.allow ?? []).filter((a) => a && Number.isSafeInteger(a.count) && a.count > 0);
  const latticeCheck = (rendered: MosaicDocument[], canvas: { width: number; height: number }, keyPrefix: string): void => {
    const walked = { m0s: [] as string[], skipped: { mosaicx: 0, bitmap: 0 } };
    for (const doc of rendered) collectM0Strings(doc, walked.m0s, walked.skipped);
    if (walked.skipped.mosaicx > 0) audit.notes.push(`latticeSmooth: ${walked.skipped.mosaicx} mosaicx child(ren) not scanned at ${dims(canvas)} (invocations, not geometry)`);
    if (walked.skipped.bitmap > 0) audit.notes.push(`latticeSmooth: ${walked.skipped.bitmap} bitmap child document(s) skipped at ${dims(canvas)} (engine.lattice.mode)`);
    const physicalCanvas = lattice?.canvas === "physical";
    for (const v of latticeViolations(walked.m0s, { canvas, allow: latticeAllowed.map((a) => a.count), physicalCanvas })) {
      push("latticeSmooth", keyPrefix ? { key: `${keyPrefix}:${v.key}`, detail: `at ${dims(canvas)}: ${v.detail}` } : v);
    }
  };
  if (docs.length > 0) {
    if (lattice?.mode === "bitmap") {
      audit.notes.push('latticeSmooth: skipped — lattice.mode is "bitmap" (a baked raster is never live-composed)');
    } else {
      if (latticeAllowed.length > 0) {
        audit.notes.push(`latticeSmooth: allowed content counts ${latticeAllowed.map((a) => `${a.count} (${a.reason})`).join(", ")}`);
      }
      if (lattice?.canvas === "physical") audit.notes.push(`latticeSmooth: hinted canvas ${width}×${height} declared physical (lattice.canvas) — a rough axis is not reported; the counts it explains are charged to it`);
      latticeCheck(docs, { width, height }, "");
    }
  }
  audit.layout = layoutFingerprintOf(docs, width, height);

  for (const sweep of opts.sweepCanvases ?? []) {
    if (sweep.width === width && sweep.height === height) continue;
    try {
      const ctx = ctxFor(sweep.width, sweep.height, fps, durationMs, opts.workspaceDir ?? "/tmp/m0saic-template-audit");
      const swept = documentsOf(await template.render(productionDefaults(), ctx));
      for (const v of floorViolations(swept, sweep.width, sweep.height)) push("canvasEnvelope", v);
      // A physical-canvas template (a print trim) previewed on a standard canvas
      // scales its DPI to fit; the rough factors are its own inches, so only
      // its hinted canvas is a lattice statement.
      if (swept.length > 0 && lattice?.mode !== "bitmap" && lattice?.canvas !== "physical") latticeCheck(swept, { width: sweep.width, height: sweep.height }, dims(sweep));
    } catch (err) {
      audit.notes.push(`canvasEnvelope: render at ${dims(sweep)} threw: ${firstLine(err)}`);
    }
  }

  const boundRootKeys = new Set<string>();
  for (const doc of docs) {
    const r = resolvePropBindings(doc, width, height, { propsSchema: schema });
    for (const [key, list] of Object.entries(r.byProp)) {
      if (list.some((b) => b.childPath.length === 0)) boundRootKeys.add(key);
    }
    for (const rej of r.rejected) {
      if (rej.childPath.length > 0) continue;
      push("bindingsSound", {
        key: rej.propKey,
        detail: `binding on "${rej.propKey}" was rejected (${rej.reason}) — ${REJECTION_HINT[rej.reason]}`,
      });
    }
  }

  if (docs.length > 0) {
    const drawn = docs.flatMap(drawnTextOf);
    const drawnText = drawn.map((d) => d.text);
    for (const key of freeTextProps(schema)) {
      const value = valueAt(defaults, key);
      if (typeof value !== "string" || value.trim().length < 2) continue;
      if (boundRootKeys.has(key)) continue;
      if (!drawnText.some((t) => t.includes(value))) continue;
      push("bindingsCover", {
        key,
        detail: `"${key}" (default ${JSON.stringify(value.length > 40 ? `${value.slice(0, 37)}…` : value)}) is drawn as text but no source binds it — wrap the source that shows it: bindProp(src, "${key}").`,
      });
    }

    let fontUnavailable = false;
    const seen = new Set<string>();
    for (const t of drawn) {
      if (!t.svg) continue;
      const chars = [...t.text].filter((ch) => ch.charCodeAt(0) > 0x7f && ch !== "\n");
      if (chars.length === 0) continue;
      const font = fontFor(t);
      const face = font ? loadFont(font.path) : null;
      if (!face) {
        fontUnavailable = true;
        continue;
      }
      for (const ch of chars) {
        const code = ch.codePointAt(0) ?? 0;
        const id = `${font!.path}:${code}`;
        if (seen.has(id)) continue;
        seen.add(id);
        if (face.charToGlyph(ch).index === 0) {
          push("svgGlyphCoverage", {
            key: `U+${code.toString(16).toUpperCase().padStart(4, "0")}`,
            detail: `"${ch}" (U+${code.toString(16).toUpperCase().padStart(4, "0")}) has no glyph in ${font!.label} — it renders as tofu.`,
          });
        }
      }
    }
    if (fontUnavailable) audit.notes.push("svgGlyphCoverage: a font could not be loaded on this host; the rule was not fully checked");
  }

  for (const convention of RENDER_TIME_CONVENTIONS) {
    const violations = violationsByConvention.get(convention) ?? [];
    if (violations.length === 0) {
      if (shouldRecord) clearTemplateConventionFinding(templateId, convention);
      continue;
    }
    const finding = makeTemplateConventionFinding(templateId, convention, violations, external);
    if (shouldRecord) recordTemplateConventionFinding(finding);
    audit.findings.push(finding);
  }
  return audit;
}

const REJECTION_HINT: Record<string, string> = {
  "unknown-prop": "no such prop in propsSchema (check the dotted path; group fields nest as \"group.field\").",
  "unsupported-type": "that prop type is not bindable (closed pickers, media, booleans, and whole lists never are; a rect binding fits only a json prop with picker: \"regions\" and regions.max: 1).",
  "index-required": "a string[] / number[] prop binds ONE element — pass the index (bindProp(src, key, i)).",
  "path-required": "a json / list prop binds ONE leaf — pass its path (bindPropPath(src, key, [i, \"field\"], kind)).",
  "kind-required": "a structured binding must declare the leaf's kind (\"string\" | \"number\" | \"color\") — use bindPropPath.",
};
