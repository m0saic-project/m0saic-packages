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
 *  - `bindingsCover`     — "prop provenance": a free-text string prop, or a
 *    number prop, whose default value is drawn verbatim as text must be bound
 *    to a rect. This is the heuristic form of "bind what you display". Numbers
 *    joined the rule in 0.3.0 (agent-authored templates draw counts and prices
 *    straight from a prop): a number is only evidence when one of its honest
 *    spellings ({@link numberSpellings}) lands in drawn text at a DIGIT
 *    BOUNDARY, so `12` is not read out of `2012` and `1,200` is not read as
 *    `200`. A prop drawn only inside rects that already bind ANOTHER prop (a
 *    composite line, `"@qsbuilds · 2026 on GitHub"`) is reported with ITS fix
 *    instead — `bindProps` puts several handles on one rect, or the line splits
 *    — because a bare `bindProp` there would replace the existing handle.
 *  - `bindingsDeclared` — the ROLL CALL (throw, 2026-09-25): every prop that
 *    CAN carry a canvas handle is either bound, or named in
 *    `template.bindings.unbound` with the reason it has none. Where
 *    `bindingsCover` guesses from drawn text and misses formatted values, empty
 *    defaults and colours, this enumerates the SCHEMA, so it is total and
 *    kind-agnostic — a new handle kind is covered the day it exists. A stale
 *    declaration (unknown prop, or one that is actually bound) is a violation
 *    too. A template that SHIPPED before the rule reports it in `lagging`, not
 *    `findings` (`shippedAt`) — behind, not broken.
 *    Bindings count from ANYWHERE in the tree (a nested child reaches the
 *    parent's props). One limit remains and is by design: the audit renders at
 *    `defaultProps`, so a rect the template only creates when a prop is NON-EMPTY
 *    reads as unbound — which is the existing "bind even when the value is empty"
 *    rule biting, and the fix is to bind it unconditionally or declare it.
 *  - `bindingHints`      — (throw, 2026-09-27) every bound rect shows one line
 *    in context: the binding's `hint`, else the prop's `description`. Make puts
 *    it under the inline editor, on the tile card and in the handle's tooltip,
 *    so a person who double-clicks learns what the value does without opening
 *    the settings. The tax is one honest sentence per bound prop, paid once in
 *    the schema. Companion leaves need none; shipped templates lag like any
 *    post-hoc rule.
 *  - `canvasFill`        — (throw, 2026-09-25) the canvas is filled by
 *    `document.backgroundColor`, NOT by a full-canvas colour rect. A base rect is
 *    a click target over everything — selected in Make any time the pointer is
 *    not on a smaller tile — and the document background does the same with no
 *    rect. Only a STATIC, opaque, unshaped fill counts ({@link isPlainColorFill}):
 *    a curtain wipe, a scrim, a mask and a rounded card each carry a field that
 *    excludes them. Declared exceptions: `canvas.baseRect` (general — "the rect
 *    IS the point") and {@link NESTED_BG_PROP} (narrow — "I am composed into
 *    another template"); an empty `baseRect` reason is itself a violation.
 *    Root documents only — a CHILD filling its slot is the
 *    sanctioned workaround while the engine ignores a child's own
 *    `backgroundColor`, declared by defaulting {@link NESTED_BG_PROP} to true.
 *    Shipped templates report it in `lagging` like any post-hoc rule.
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

import { checkLayoutFloors, flattenMosaicDocument, sourceBindings } from "@m0saic/platform";

import { resolveDocFrames, resolvePropBindings } from "../geometry-contract/frameResolution";
import { latticeViolations } from "../lattice/latticeReport";
import { walkPropDefinitions } from "./auditSchemaConventions";
import { deepFreezeTemplate } from "./templateRegistry";
import type { TemplateConventionViolation } from "./auditSchemaConventions";
import { TEMPLATE_CONVENTION_SINCE, compareConventionVersions, makeTemplateConventionFinding, recordTemplateConventionFinding, clearTemplateConventionFinding } from "./templateConventions";
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
  /**
   * The m0saic line this template SHIPPED at — a repo's `frozen.manifest.json`
   * `release`, passed for ids the manifest pins.
   *
   * Findings from a convention introduced AFTER that line are not applied
   * retroactively: they move to {@link AuditRenderedTemplateResult.lagging}
   * instead of `findings`, so the build is not broken by a rule that did not
   * exist when the template shipped — but the lag stays VISIBLE and countable,
   * which a bare "skip" destroyed. A convention at or BEFORE that line still
   * lands in `findings`: the template shipped non-compliant, and that is real.
   *
   * Absent ⇒ every convention applies in full (a new template, or a repo that
   * has shipped nothing yet).
   */
  shippedAt?: string;
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
  /** Overlay nesting on ONE node — the chain the engine emits for one document,
   *  never the tree flattened (R10, 2026-09-27). The engine drops inline masks
   *  past ~25 layers; counted only where inline masks ride the chain, as the
   *  engine's own OVERLAY_CHAIN_DEEP warning is. */
  overlayDepth: 20,
  /** Inline masks on one node. Hundreds overflow the mask resolver's argv. */
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
  /**
   * Findings from conventions introduced AFTER {@link
   * AuditRenderedTemplateOptions.shippedAt} — this template is BEHIND, not
   * broken, and the fix is its next vN. Never recorded in the shared convention
   * log and never fatal; a gate counts them so the lag is in front of you.
   */
  lagging: TemplateConventionFinding[];
};

const RENDER_TIME_CONVENTIONS: readonly TemplateConventionName[] = [
  "rendersAtDefaults",
  "bindingsSound",
  "bindingsCover",
  "bindingsDeclared",
  "bindingHints",
  "canvasFill",
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
  const over = (key: keyof typeof COST_BUDGETS, value: number, consequence: string, node: string | null = null): void => {
    if (value > COST_BUDGETS[key]) {
      const where = node === null ? "" : ` on child document "${node}"`;
      out.push({ key, detail: `${key} ${value}${where} exceeds the budget of ${COST_BUDGETS[key]} — ${consequence}` });
    }
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
  // Overlay depth and inline masks are PER NODE, the way the engine measures
  // them (buildMosaicNode: the chain ONE document's composite command emits,
  // warned only when inline masks ride it — a deep mask-free chain renders
  // slower, which the estimate already shows, and never loses a pixel). The
  // flattened figure inlined every child, so a template that followed this
  // rule's own advice ("nest a child document") read DEEPER the more it
  // nested: Lyric Stack read 30 with no node past 10 (R10, 2026-09-27).
  let worstDepth: { value: number; node: string | null } = { value: 0, node: null };
  let worstMasks: { value: number; node: string | null } = { value: 0, node: null };
  forEachDocumentNode(doc, (node, label) => {
    const srcs = ((node as unknown as AnyRecord).sources as unknown[] | undefined) ?? [];
    const masks = srcs.filter((s) => s && typeof s === "object" && ((s as AnyRecord).mask as AnyRecord | undefined)?.kind === "inline-mask").length;
    if (masks > worstMasks.value) worstMasks = { value: masks, node: label };
    if (masks === 0 || typeof node.m0 !== "string") return;
    const size = (node as unknown as AnyRecord).size as { width?: number; height?: number } | undefined;
    let depth = 0;
    try {
      const parsed = parseM0StringComplete(node.m0, size?.width ?? width, size?.height ?? height);
      if (parsed.ok) for (const f of parsed.ir.editorFrames) depth = Math.max(depth, Number((f as AnyRecord).overlayDepth ?? 0));
    } catch {
      /* ignore */
    }
    if (depth > worstDepth.value) worstDepth = { value: depth, node: label };
  });
  over("overlayDepth", worstDepth.value, "the engine drops inline masks past ~25 overlay layers on one node; nest a child document instead.", worstDepth.node);
  over("inlineMasks", worstMasks.value, "hundreds of inline masks on one node overflow the mask resolver's argv.", worstMasks.node);
  return out;
}

/**
 * Every document NODE of a rendered tree — what the engine composes as one
 * overlay chain — with its label: null for the root, the child's key under
 * `children` below it. Same skips as {@link collectM0Strings}: a `mosaicx_*`
 * child is an invocation, a bitmap lattice is a baked raster; neither is a
 * chain of this document's own. Shared subtrees are visited once.
 */
function forEachDocumentNode(
  doc: MosaicDocument,
  visit: (node: MosaicDocument, label: string | null) => void,
  label: string | null = null,
  seen: Set<unknown> = new Set(),
): void {
  if (!doc || typeof doc !== "object" || seen.has(doc)) return;
  seen.add(doc);
  if (doc.engine?.lattice?.mode === "bitmap") return;
  visit(doc, label);
  const children = (doc as unknown as AnyRecord).children as Record<string, unknown> | undefined;
  if (!children || typeof children !== "object") return;
  for (const [key, child] of Object.entries(children)) {
    const kind = (child as AnyRecord | null)?.kind;
    if (typeof kind === "string" && kind.startsWith("mosaicx_")) continue;
    for (const d of documentsOf(child)) forEachDocumentNode(d, visit, key, seen);
  }
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
type DrawnText = { text: string; svg: boolean; family?: string; weight?: number | "normal" | "bold"; style?: "normal" | "italic"; boundTo: string[] };

function drawnTextOf(doc: MosaicDocument): DrawnText[] {
  const out: DrawnText[] = [];
  for (const src of (doc.sources ?? []) as unknown as AnyRecord[]) {
    if (!src || src.type !== "text" || !Array.isArray(src.layers)) continue;
    const svg = src.rasterizer === "svg";
    const base = (src.style ?? {}) as AnyRecord;
    // Every prop this rect already carries — `sourceBindings` is the ONE reader
    // of both wire shapes (`editor.binding` and `bindProps`' `editor.bindings`),
    // so `bindingsCover` can tell "nothing binds this" from "this rect is
    // already spoken for" (a composite line).
    const boundTo = sourceBindings(src.editor as never)
      .map((b) => b.propKey)
      .filter((k): k is string => typeof k === "string");
    for (const layer of src.layers as AnyRecord[]) {
      const content = layer?.content as AnyRecord | undefined;
      if (!content || content.kind !== "literal" || typeof content.text !== "string") continue;
      const style = { ...base, ...((layer.style ?? {}) as AnyRecord) };
      out.push({
        text: content.text,
        svg,
        boundTo,
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

/**
 * Every prop that CAN carry a canvas handle, with the kind it would carry —
 * the `bindingsDeclared` roll call. This is the schema-side mirror of
 * `classifyBindableProp`: it asks "could a rect edit this?", never "is it drawn?".
 *
 * A list / structured prop is accountable as a WHOLE even though a binding names
 * one element or one leaf: the checkable statement is "this prop is reachable on
 * the canvas somewhere", and per-element completeness is not knowable from the
 * schema (the drawn count is content).
 */
export function accountableProps(schema: SchemaMap | undefined): Array<{ key: string; kind: string }> {
  const out: Array<{ key: string; kind: string }> = [];
  walkPropDefinitions(schema, (key, def) => {
    if (def.meta?.ui?.hidden) return;
    if (def.meta?.ui?.consumer === "human") return;
    const colour = Boolean(def.meta?.constraints?.isColor || (def.meta?.control as AnyRecord | undefined)?.colorPicker);
    switch (def.type) {
      case "string":
        // A colour picker is a HANDLE (a swatch on the rect); any other closed
        // set is a mode, not a value the canvas shows.
        if (colour) out.push({ key, kind: "color" });
        else if (!CLOSED_OR_PICKED(def)) out.push({ key, kind: "string" });
        return;
      case "number":
        if (!CLOSED_OR_PICKED(def)) out.push({ key, kind: "number" });
        return;
      case "media":
        out.push({ key, kind: "media" });
        return;
      case "string[]":
        out.push({ key, kind: colour ? "color element" : "string element" });
        return;
      case "number[]":
        out.push({ key, kind: "number element" });
        return;
      case "media[]":
        out.push({ key, kind: "media element" });
        return;
      case "json":
      case "list":
      case "array":
        out.push({ key, kind: isRectPicker(def) ? "rect" : "leaf" });
        return;
      // Never a canvas thing: boolean (false renders no rect to click), group (a
      // container — its fields are walked), the m0 family (the value IS the
      // composition of every rect, not one of them), code (read-only by
      // contract), m0c/m0p likewise.
      default:
        return;
    }
  });
  return out;
}

/** The prop a template defaults to `true` when it MUST ship the base rect — it is
 *  designed to be composed into another template, whose slot its own
 *  `backgroundColor` cannot fill (the engine lifts that from the primary output
 *  only). */
export const NESTED_BG_PROP = "useNestedBackgroundColor";

/**
 * A STATIC, fully opaque, unshaped solid-colour fill — the `canvasFill` smell
 * when it covers the whole canvas.
 *
 * Every exclusion here is a legitimate full-canvas colour that must NOT be
 * flagged, and each is structural rather than guessed: an `overlay` means the
 * fill is conditional or translucent (a curtain wipe carries `enable` / `window`,
 * a scrim carries `alpha`, a blend carries `blendMode`); a `mask` makes it a
 * shape; `placement` insets it; `effects` round or stroke it into a card.
 */
function isPlainColorFill(src: AnyRecord): boolean {
  if (src.overlay || src.mask || src.placement || src.effects) return false;
  // The canonical form: `makeColorTile(color)` → a lavfi source carrying `color`
  // (the union is `{ lavfi } XOR { color }`, so a filter graph is not a fill).
  if (src.type === "lavfi") return typeof src.color === "string";
  // The legacy form several brand templates still use: a text source with no
  // text and a `visual.backgroundColor` (makeColorTile's own doc names it).
  if (src.type === "text") {
    if (typeof (src.visual as AnyRecord | undefined)?.backgroundColor !== "string") return false;
    const layers = Array.isArray(src.layers) ? (src.layers as AnyRecord[]) : [];
    return layers.every((l) => {
      const c = l?.content as AnyRecord | undefined;
      return !c || c.kind !== "literal" || typeof c.text !== "string" || c.text.trim() === "";
    });
  }
  return false;
}

/**
 * Every `backgroundColor` in a rendered tree, lowercased.
 *
 * A colour painted as the DOCUMENT BACKGROUND has no source and therefore no
 * rect, so no canvas handle can exist for it — `bindingsDeclared` must not
 * demand one (founder ruling 2026-09-25). It is also the PREFERRED way to fill a
 * canvas: a full-frame base rect is a smell, because it becomes a click target
 * that shadows everything behind it whenever the pointer is not on a smaller
 * tile. The rule would otherwise have punished the pattern the handbook
 * recommends — 22 templates in the starter repo alone.
 */
/** Every source in the tree — root documents and nested children alike. */
function forEachSourceInTree(docs: MosaicDocument[], visit: (src: AnyRecord) => void, seen = new Set<unknown>()): void {
  for (const doc of docs) {
    if (!doc || typeof doc !== "object" || seen.has(doc)) continue;
    seen.add(doc);
    for (const src of ((doc as unknown as AnyRecord).sources as unknown[] | undefined) ?? []) {
      if (src && typeof src === "object") visit(src as AnyRecord);
    }
    const children = (doc as unknown as AnyRecord).children as Record<string, unknown> | undefined;
    if (children && typeof children === "object") {
      for (const child of Object.values(children)) forEachSourceInTree(documentsOf(child), visit, seen);
    }
  }
}

function backgroundColorsOf(doc: MosaicDocument, out = new Set<string>(), seen = new Set<unknown>()): Set<string> {
  if (!doc || typeof doc !== "object" || seen.has(doc)) return out;
  seen.add(doc);
  const bg = (doc as unknown as AnyRecord).backgroundColor;
  if (typeof bg === "string" && bg.trim()) out.add(bg.trim().toLowerCase());
  const children = (doc as unknown as AnyRecord).children as Record<string, unknown> | undefined;
  if (children && typeof children === "object") {
    for (const child of Object.values(children)) {
      for (const d of documentsOf(child)) backgroundColorsOf(d, out, seen);
    }
  }
  return out;
}

/** A one-region regions picker — the `rect` handle (see `bindPropRect`). */
function isRectPicker(def: MosaicTemplatePropDefinition): boolean {
  const k = def.meta?.control as AnyRecord | undefined;
  return k?.picker === "regions";
}

/** Number props Make would bind as a plain value — same exclusions as
 *  {@link freeTextProps}: hidden, human-facing (a derived view never enters
 *  `render()`) and closed / picked sets are not coverage targets. */
function drawnNumberProps(schema: SchemaMap | undefined): string[] {
  const keys: string[] = [];
  walkPropDefinitions(schema, (key, def) => {
    if (def.type !== "number") return;
    if (def.meta?.ui?.hidden) return;
    if (def.meta?.ui?.consumer === "human") return;
    if (CLOSED_OR_PICKED(def)) return;
    keys.push(key);
  });
  return keys;
}

/** The ways a template plausibly draws a raw number prop VERBATIM. A string has
 *  one spelling; a number has several honest ones, so the net is wider — with
 *  two guards, both paid for by a false positive on the shipped fleet:
 *
 *   - a one-character spelling ("7") is dropped. Every sentence with a digit
 *     contains it, so it is not evidence.
 *   - `toFixed` is offered only for a value that ALREADY has decimals. Nothing
 *     draws an integer count as "1.0", but plenty of chrome draws a version or
 *     a speed that reads that way (`dsl-tutorial/chrome/v1`, `stepTotal: 1`).
 *
 *  What survives is matched on a digit boundary by {@link drawnAsNumber}. */
export function numberSpellings(v: number): string[] {
  if (!Number.isFinite(v)) return [];
  const out = [String(v), v.toLocaleString("en-US")];
  if (!Number.isInteger(v)) out.push(v.toFixed(1), v.toFixed(2));
  return [...new Set(out)].filter((s) => s.length >= 2);
}

const DIGIT = /[0-9]/;
const digitAt = (s: string, i: number): boolean => DIGIT.test(s[i] ?? "");

/** `includes` with a digit boundary. `12` must not match inside `2012` or
 *  `3.12`, and a drawn `1,200` must not be read as the prop `200` — a separator
 *  only blocks the match when a digit sits on its far side (a trailing "42." at
 *  the end of a sentence still counts). */
export function drawnAsNumber(text: string, token: string): boolean {
  let i = text.indexOf(token);
  while (i >= 0) {
    const end = i + token.length;
    const before = text[i - 1];
    const after = text[end];
    const okBefore = !digitAt(text, i - 1) && !((before === "." || before === ",") && digitAt(text, i - 2));
    const okAfter = !digitAt(text, end) && !((after === "." || after === ",") && digitAt(text, end + 1));
    if (okBefore && okAfter) return true;
    i = text.indexOf(token, i + 1);
  }
  return false;
}

function valueAt(obj: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as AnyRecord)[k] : undefined), obj);
}

/** Only the font triple matters here — `textFits` calls this with a bare
 *  layer it built itself, not with a walked {@link DrawnText}. */
function fontFor(t: Pick<DrawnText, "family" | "weight" | "style">): { path: string; label: string } | null {
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
  const audit: RenderedTemplateAudit = { templateId, canvas: { width, height }, notes: [], findings: [], lagging: [] };
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
  // ⭐ Bindings ANYWHERE in the tree, root or nested child. `bindingsCover`
  // compares root bindings against root drawn text and is self-consistent, but
  // the ROLL CALL asks a different question — "can the user reach this prop on
  // the canvas?" — and Make resolves a binding through children, so a template
  // that composes its content into a child document (the hello-world card puts
  // everything in a `card` child) reaches its props perfectly well. Counting
  // root-only reported every one of them as unbound.
  const boundAnywhereKeys = new Set<string>();
  for (const doc of docs) {
    const r = resolvePropBindings(doc, width, height, { propsSchema: schema });
    for (const [key, list] of Object.entries(r.byProp)) {
      if (list.some((b) => b.childPath.length === 0)) boundRootKeys.add(key);
      boundAnywhereKeys.add(key);
    }
    for (const rej of r.rejected) {
      if (rej.childPath.length > 0) continue;
      push("bindingsSound", {
        key: rej.propKey,
        detail: `binding on "${rej.propKey}" was rejected (${rej.reason}) — ${REJECTION_HINT[rej.reason]}`,
      });
    }
  }

  // ── bindingsDeclared (throw) — the roll call ───────────────────────────────
  // Exempt for a template the repo already shipped: it is hashed in
  // `frozen.manifest.json`, never edited in place, and a requirement it cannot
  // satisfy without a vN+1 is noise rather than a gate.
  if (docs.length > 0) {
    const declared = (template.bindings?.unbound ?? {}) as Record<string, unknown>;
    const accountable = accountableProps(schema);
    const keys = new Set(accountable.map((a) => a.key));
    const backgrounds = new Set<string>();
    for (const doc of docs) backgroundColorsOf(doc, backgrounds);
    for (const { key, kind } of accountable) {
      if (boundAnywhereKeys.has(key)) continue;
      // A colour that IS the document background has no rect to bind (and is the
      // preferred way to fill a canvas) — accounted for by construction.
      if (kind === "color") {
        const v = valueAt(defaults, key);
        if (typeof v === "string" && backgrounds.has(v.trim().toLowerCase())) continue;
      }
      if (Object.prototype.hasOwnProperty.call(declared, key)) continue;
      push("bindingsDeclared", {
        key,
        detail: `"${key}" can carry a ${kind} handle but nothing binds it — bind the rect that shows it (bindProp(src, "${key}")), or declare why it has none: bindings.unbound = { "${key}": "<reason>" }.`,
      });
    }
    // A stale declaration is worse than none: it says a reviewer looked, when
    // the prop has since been bound, renamed or removed.
    for (const [key, reason] of Object.entries(declared)) {
      if (!keys.has(key)) {
        push("bindingsDeclared", {
          key,
          detail: `bindings.unbound names "${key}", which is not a prop that can carry a canvas handle (unknown, hidden, a closed set, a boolean, a group, an m0 prop or code) — drop the entry.`,
        });
        continue;
      }
      if (boundAnywhereKeys.has(key)) {
        push("bindingsDeclared", {
          key,
          detail: `bindings.unbound says "${key}" has no canvas handle, but a source binds it — drop the entry, the binding is the truth.`,
        });
        continue;
      }
      if (typeof reason !== "string" || reason.trim().length === 0) {
        push("bindingsDeclared", {
          key,
          detail: `bindings.unbound["${key}"] has no reason — one honest word is the point of the declaration (e.g. "timing", "geometry", "determinism").`,
        });
      }
    }
  }

  // ── bindingHints (throw) — the value explains itself in place ──────────────
  // Founder, 2026-09-27: a production-grade template adheres to every surface
  // of the ecosystem, and Make's canvas is now the primary one. A person who
  // double-clicks a rect sees a label and a value; the line under it says what
  // changing it does. It comes from the binding's `hint`, else the prop's
  // `description`, so the tax is one honest sentence per bound prop, paid once
  // in the schema. A companion leaf is never shown in a form and needs none.
  if (docs.length > 0) {
    const defs = new Map<string, MosaicTemplatePropDefinition>();
    walkPropDefinitions(schema, (key, def) => defs.set(key, def));
    const silent: string[] = [];
    forEachSourceInTree(docs, (src) => {
      for (const b of sourceBindings(src.editor as { binding?: unknown; bindings?: unknown } | undefined)) {
        if ((b as { companion?: unknown }).companion) continue;
        const def = defs.get(b.propKey);
        if (!def) continue; // an unknown prop is bindingsSound's finding
        const hint = (b as { hint?: unknown }).hint;
        if (typeof hint === "string" && hint.trim()) continue;
        if (typeof def.description === "string" && def.description.trim()) continue;
        if (!silent.includes(b.propKey)) silent.push(b.propKey);
      }
    });
    for (const key of silent) {
      push("bindingHints", {
        key,
        detail: `the rect bound to "${key}" shows nothing in context — a person who double-clicks it sees a label and a value, and nothing says what changing it does. Give the prop a description (propsSchema.${key}.description = "what it does and what it looks like"), or the binding its own line (bindProp(src, "${key}", i, { hint }) / withBindingHint(src, "…")).`,
      });
    }
  }

  // ── canvasFill (throw) — the canvas is filled by the DOCUMENT, not by a rect ──
  // Root documents only. A CHILD filling its slot is the sanctioned workaround
  // for the engine gap, not the smell.
  // Two escapes, and they mean DIFFERENT things. `canvas.baseRect` is the general
  // one: "the rect IS the point" (a lesson about full-rect nodes, a tutorial
  // surface painting its own page). `useNestedBackgroundColor` is narrow: "I am
  // composed into another template, whose slot my own backgroundColor cannot
  // fill." Neither may stand in for the other, and an empty reason is refused —
  // a declaration with nothing in it is a checkbox, not a statement.
  const baseRectReason = (template as { canvas?: { baseRect?: unknown } }).canvas?.baseRect;
  const baseRectDeclared = typeof baseRectReason === "string" && baseRectReason.trim().length > 0;
  if (typeof baseRectReason === "string" && !baseRectDeclared) {
    push("canvasFill", {
      key: "canvas.baseRect",
      detail: `canvas.baseRect is declared with no reason — say why this template ships a full-canvas rect (e.g. "the lesson IS the full-rect base under two overlays"), or drop the field and use document.backgroundColor.`,
    });
  }
  if (!baseRectDeclared && valueAt(defaults, NESTED_BG_PROP) !== true) {
    for (const doc of docs) {
      const { framesByLogical } = resolveDocFrames(doc, width, height);
      const sources = (doc.sources ?? []) as unknown as AnyRecord[];
      for (let i = 0; i < framesByLogical.length; i++) {
        const f = framesByLogical[i];
        const src = sources[i];
        if (!f || !src || !isPlainColorFill(src)) continue;
        if (f.x !== 0 || f.y !== 0 || f.width !== width || f.height !== height) continue;
        push("canvasFill", {
          key: `source[${i}]`,
          detail: `source ${i} is a static ${String(src.color ?? (src.visual as AnyRecord | undefined)?.backgroundColor)} fill covering the whole ${width}×${height} canvas — set document.backgroundColor instead and drop the source. A base rect is a click target over everything: in Make it is selected whenever the pointer is not on a smaller tile. (A template whose SUBJECT is that rect declares it: canvas.baseRect = "<why>". A template that must ship it because it is composed INTO another uses defaultProps.${NESTED_BG_PROP} = true instead.)`,
        });
      }
    }
  }

  if (docs.length > 0) {
    const drawn = docs.flatMap(drawnTextOf);
    // A prop drawn only inside rects that already carry ANOTHER prop's binding
    // is a COMPOSITE line, and its fix is not a bare `bindProp` (that would
    // replace the rect's existing handle): one rect takes several bindings
    // through `bindProps`, or the line splits so each prop gets its own rect.
    const coverage = (key: string, what: string, matches: DrawnText[]): string => {
      if (matches.some((m) => m.boundTo.length === 0)) {
        return `"${key}" (${what}) is drawn as text but no source binds it — wrap the source that shows it: bindProp(src, "${key}").`;
      }
      const owners = [...new Set(matches.flatMap((m) => m.boundTo))].map((k) => `"${k}"`).join(" / ");
      return `"${key}" (${what}) is drawn as text, but every rect that shows it already binds ${owners} — a composite line. Add this prop to that rect: bindProps(src, [… , { propKey: "${key}" }]), or split the line so each prop has its own rect.`;
    };
    for (const key of freeTextProps(schema)) {
      const value = valueAt(defaults, key);
      if (typeof value !== "string" || value.trim().length < 2) continue;
      if (boundRootKeys.has(key)) continue;
      const matches = drawn.filter((d) => d.text.includes(value));
      if (matches.length === 0) continue;
      push("bindingsCover", { key, detail: coverage(key, `default ${JSON.stringify(value.length > 40 ? `${value.slice(0, 37)}…` : value)}`, matches) });
    }
    for (const key of drawnNumberProps(schema)) {
      const value = valueAt(defaults, key);
      if (typeof value !== "number") continue;
      if (boundRootKeys.has(key)) continue;
      let spelling: string | undefined;
      let matches: DrawnText[] = [];
      for (const n of numberSpellings(value)) {
        matches = drawn.filter((d) => drawnAsNumber(d.text, n));
        if (matches.length > 0) { spelling = n; break; }
      }
      if (!spelling) continue;
      push("bindingsCover", { key, detail: coverage(key, `default ${value}, drawn as ${JSON.stringify(spelling)}`, matches) });
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
    // A convention NEWER than the line this template shipped at is lag, not a
    // defect: kept out of `findings` and out of the shared log, but returned so a
    // gate can count it. One at or before that line is a real error — the
    // template shipped non-compliant.
    if (opts.shippedAt && compareConventionVersions(TEMPLATE_CONVENTION_SINCE[convention], opts.shippedAt) > 0) {
      audit.lagging.push(finding);
      if (shouldRecord) clearTemplateConventionFinding(templateId, convention);
      continue;
    }
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
