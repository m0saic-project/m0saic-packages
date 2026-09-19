/**
 * ============================================================================
 * dsl-tutorial — Step[] pipeline (CHARACTER-LEVEL parse model)
 * ============================================================================
 *
 * The m0 DSL is parsed one CHARACTER at a time, and EVERY significant character
 * is a real step that transforms the geometry cursor (X/Y/W/H) or emits a frame:
 *
 *   digit  `2`      — read a split count (no geometry change yet)
 *   open   `(` `[`  — split the cursor into N children; cursor → first child
 *                     (so W halves on a `(` 2-split, H divides on a `[` 3-split)
 *   comma  `,`      — advance to the next sibling; cursor X (col) or Y (row) moves
 *   leaf   `1` `F`  — EMIT a frame at the cursor (paints; no geometry change)
 *   close  `)` `]`  — pop the split; cursor RESTORES to the parent region
 *   pass   `0` `>`  — a passthrough slot (donates space; no paint)
 *   null   `-`      — a reserved-but-empty slot
 *   overlay`{` `}`  — change the overlay LAYER depth (Z); cursor unchanged
 *
 * Step 0 (before the first character) is the unparsed canvas — the root's own
 * full rect. The cursor RECTS are pulled from the real parse tree (exact, so
 * weighted/passthrough layouts are honest), keyed by source span; the character
 * walk only drives the ORDER + which op each character performs.
 *
 * `Z` is the OVERLAY nesting depth (inside `{}`), NOT a logical/stack index —
 * for a flat layout it stays 0 the whole walk.
 *
 * Pure function of (m0, width, height): same inputs → byte-identical `Step[]`.
 * ============================================================================
 */

import type {
  M0String,
  M0Rect,
  M0NodeKind,
  EditorFrame,
} from "@m0saic/dsl";
import { parseM0StringComplete } from "@m0saic/dsl";

/** A before→after numeric diff. */
export type FieldDiff = { before: number | null; after: number };

/** The inspector fields, in display order. `N` = arity of the split in focus
 *  (the count just read / the split the cursor sits inside) — so a count-read
 *  step registers a value instead of looking like a no-op. */
// Output fields fully describe ONE rect (X/Y/W/H/Z). Internal fields are the
// engine's hidden working state that produced it: N = split arity, R = the
// quantization remainder (leftover px when a split doesn't divide evenly), C =
// the passthrough carry (px a `0`/`>` donates forward, claimed by a later frame).
export type InspectorField = "X" | "Y" | "W" | "H" | "Z" | "N" | "R" | "C";

/** What a character does in the parse. */
export type StepEventType =
  | "count"
  | "enter"
  | "sibling"
  | "emitLeaf"
  | "exit"
  | "passthrough"
  | "null"
  | "overlay";

export type Step = {
  /** 1-based step number. */
  index: number;
  /** Total step count (same on every step). */
  total: number;
  eventType: StepEventType;
  /** Character index into the DSL string this step corresponds to. */
  charIndex: number;
  kind: M0NodeKind;
  stableKey: string;
  /** Leaf index (0-based) for emitLeaf steps; undefined otherwise. */
  leafIndex?: number;
  /** Single-character source span [i, i+1) for the DSL-string caret. */
  span: { start: number; end: number } | null;
  /** The geometry CURSOR rect after this step (the active region). */
  rect: M0Rect;
  /** Inspector diffs (cursor + overlay depth) vs the previous step. */
  fields: Record<InspectorField, FieldDiff>;
  /** Real trace-derived accumulator, each as a before→after diff. */
  accumulator: Record<string, FieldDiff>;
  /** Human narration for the parse banner. */
  narration: string;
  /** Approximate symbol index into the DSL string (1-based significant token). */
  tokenIndex: number;
  /**
   * For `enter` (open) steps: the split's axis + INTERNAL divider positions as
   * fractions (0..1) of the REGION being split. Drives the canvas dotted
   * subdivision drawn the instant a split opens.
   */
  split?: { axis: "row" | "col"; dividers: number[] };
  /**
   * For `enter` (open) steps: the rect of the region being subdivided (the
   * parent), so the canvas can place the dotted dividers. (Distinct from `rect`,
   * which is the cursor = the FIRST child after the split.)
   */
  splitRegion?: M0Rect;
  /** Remainder px THIS child claimed from the enclosing split (drives the R
   *  count-down + the "tile N takes a remainder px" callout). 0 / undefined when
   *  the tile sits on the floor size. */
  remainderClaim?: number;
  /** Passthrough carry px THIS tile absorbed (a `0`/`>` donation landing). */
  carryAbsorbed?: number;
  /** Axis of the split N refers to (the count just read / the enclosing split) —
   *  so the inspector can tag the arity field "cols" vs "rows". Undefined at the
   *  root (no split in focus). */
  axisInFocus?: "row" | "col";
};

/** Retained for API compatibility; the character model always walks every char. */
export type StepEventMode = "enter+leaf" | "all";

export type BuildStepsResult = {
  m0: string;
  steps: Step[];
  /** Lexical token count (status bar "Tokens: N"). */
  tokenCount: number;
  /** Structural node count (status bar "Nodes: N"). */
  nodeCount: number;
};

/** Count significant lexical tokens: each maximal digit-run is one token. */
export function countTokens(m0: string): number {
  let n = 0;
  for (let i = 0; i < m0.length; ) {
    const ch = m0[i];
    if (ch >= "0" && ch <= "9") {
      n++;
      i++;
      while (i < m0.length && m0[i] >= "0" && m0[i] <= "9") i++;
      continue;
    }
    if ("()[]{},-F>".includes(ch)) n++;
    i++;
  }
  return n;
}

/** Significant-symbol index (1-based) at a source offset — for the parse banner. */
function symbolIndexAt(m0: string, offset: number): number {
  if (offset <= 0) return 1;
  return Math.max(1, countTokens(m0.slice(0, Math.min(offset, m0.length))));
}

const ZERO_RECT: M0Rect = { x: 0, y: 0, width: 0, height: 0 };
const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const rectOf = (f: EditorFrame): M0Rect => ({ x: f.x, y: f.y, width: f.width, height: f.height });
const spanStart = (f: EditorFrame): number => (f.meta.span ? f.meta.span.start : 0);

/** Interior divider fractions (0..1 of the region extent) between sorted children. */
function dividersOf(node: EditorFrame, children: EditorFrame[]): number[] {
  const axis = node.axis;
  if (!axis) return [];
  const origin = axis === "col" ? node.x : node.y;
  const extent = axis === "col" ? node.width : node.height;
  if (!(extent > 0)) return [];
  const out: number[] = [];
  for (let c = 0; c < children.length - 1; c++) {
    const edge = axis === "col" ? children[c].x + children[c].width : children[c].y + children[c].height;
    const frac = (edge - origin) / extent;
    if (frac > 0.001 && frac < 0.999) out.push(frac);
  }
  return out;
}

/** Build the ordered, character-level Step[] for an m0 layout at a canvas size. */
export function buildSteps(
  m0: M0String | string,
  width: number,
  height: number,
  _opts?: { stepEvents?: StepEventMode },
): BuildStepsResult {
  const s = String(m0);
  const result = parseM0StringComplete(s, width, height, { trace: true });
  if (!result.ok) {
    throw new Error(`dsl-tutorial: m0 parse failed — ${result.error?.message ?? "unknown"}`);
  }
  const editor: EditorFrame[] = result.ir.editorFrames;
  const nodeCount = editor.length;
  const tokenCount = countTokens(s);

  // R / C are the hidden engine state, computed from geometry in the walk below:
  //  · R = the split's quantization remainder — leftover px when a region doesn't
  //    divide evenly across its children (the resolved tiles absorb it, so it's
  //    invisible in X/Y/W/H). Exact for uniform splits (the tutorial's main case).
  //  · C = the passthrough carry — px a `0`/`>` donates forward, claimed by the
  //    next tile.
  const remainderOf = (node: EditorFrame, count: number): number => {
    if (count <= 0 || !node.axis) return 0;
    const r = rectOf(node);
    const ext = Math.round(node.axis === "col" ? r.width : r.height);
    return ext % count;
  };

  // Index the parse tree by span start (split-node lookup) and parent (children).
  const nodeBySpanStart = new Map<number, EditorFrame>();
  const childrenByParent = new Map<string, EditorFrame[]>();
  let root: EditorFrame | undefined;
  for (const f of editor) {
    if (f.meta.span) nodeBySpanStart.set(f.meta.span.start, f);
    const p = f.meta.parentStableKey as string | null;
    if (p) {
      const list = childrenByParent.get(p) ?? [];
      list.push(f);
      childrenByParent.set(p, list);
    } else if (!root) {
      root = f;
    }
  }
  // A child is an OVERLAY layer (not a split cell) when its own stableKey segment
  // starts with `ov` (e.g. `r/ov1c0` for `…{F}`). Overlay children must NOT count
  // toward split ARITY (`3(F,F,F){F}` is a 3-split, N=3 — the overlay is a Z layer,
  // not a 4th column). They're still emitted as leaves via the post-`)` walk, so
  // excluding them here only corrects the arity — never drops the overlay tile.
  const isOverlayChild = (f: EditorFrame): boolean => {
    const k = (f.meta.stableKey as string) ?? "";
    return k.slice(k.lastIndexOf("/") + 1).startsWith("ov");
  };
  const sortedChildrenOf = (key: string): EditorFrame[] =>
    (childrenByParent.get(key) ?? [])
      .filter((f) => !isOverlayChild(f))
      .slice()
      .sort((a, b) => spanStart(a) - spanStart(b));

  // Classify each digit char: part of a split COUNT (followed by `(`/`[`) vs a
  // leaf `1`. `countRunStart[i]` = where the count run begins (for split lookup).
  const n = s.length;
  const isCount = new Array<boolean>(n).fill(false);
  const countRunStart = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; ) {
    if (isDigit(s[i])) {
      let e = i;
      while (e < n && isDigit(s[e])) e++;
      const next = e < n ? s[e] : "";
      if (next === "(" || next === "[") {
        for (let k = i; k < e; k++) {
          isCount[k] = true;
          countRunStart[k] = i;
        }
      }
      i = e;
    } else i++;
  }

  // ── Character walk ──
  const rootRect: M0Rect = root ? rectOf(root) : ZERO_RECT;
  type Frame = { node: EditorFrame; children: EditorFrame[]; idx: number };
  const stack: Frame[] = [];
  let cursor: M0Rect = rootRect;
  let overlayDepth = 0;
  let leafIdx = 0;
  let prevRect: M0Rect = rootRect;
  let prevZ = 0;
  let prevN = 0;
  let prevR = 0;
  let prevC = 0;
  // Arity / remainder of each split currently open (parallel to `stack`), so a
  // count-read step shows that split's values and inner steps show the enclosing
  // split's. `carryPx` is the running passthrough carry (donated px in flight).
  // Each open split tracks its RUNNING remainder (`rem`, decremented as children
  // claim leftover px), the floor extent (`floor`), and its axis — so R counts
  // DOWN tile-by-tile instead of snapping to 0 at the split close.
  const countStack: number[] = [];
  const remainderStack: { rem: number; floor: number; axis: "row" | "col" }[] = [];
  let carryPx = 0;

  /** Floor extent of a k-way split of `node` along its axis (px each child gets
   *  before the remainder is sprinkled on). */
  const floorOf = (node: EditorFrame, count: number): number => {
    if (count <= 0 || !node.axis) return 0;
    const r = rectOf(node);
    const ext = Math.round(node.axis === "col" ? r.width : r.height);
    return Math.floor(ext / count);
  };

  /** The child currently under `cursor` claims its share of the enclosing split's
   *  remainder: extra = cursorExtent − floor − (carry it absorbs). Decrements the
   *  open split's running `rem` and returns the px claimed (0 if it sits on the
   *  floor). Geometry-driven, so it's correct whichever children the engine fattened
   *  — and the `carryAbsorbed` term keeps a passthrough donation from masquerading
   *  as remainder. */
  const claimRemainder = (carryAbsorbed: number): number => {
    const top = remainderStack[remainderStack.length - 1];
    if (!top || top.rem <= 0) return 0;
    const childExt = Math.round(top.axis === "col" ? cursor.width : cursor.height);
    const extra = childExt - top.floor - carryAbsorbed;
    if (extra <= 0) return 0;
    const take = Math.min(extra, top.rem);
    top.rem -= take;
    return take;
  };
  const acc: Record<string, number> = {};
  let prevAccSnapshot: Record<string, number> = {};
  const diff = (before: number | null, after: number): FieldDiff => ({ before, after });

  const steps: Step[] = [];

  for (let i = 0; i < n; i++) {
    const ch = s[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") continue;

    let eventType: StepEventType = "count";
    let kind: M0NodeKind = "frame";
    let stableKey = "";
    let leafIndex: number | undefined;
    let split: { axis: "row" | "col"; dividers: number[] } | undefined;
    let splitRegion: M0Rect | undefined;
    let narration = "";
    let readCount: number | null = null;
    let readRemainder: number | null = null;
    let readAxis: "row" | "col" | undefined;
    let remainderClaim = 0;
    let carryAbsorbed = 0;

    if (isDigit(ch) && isCount[i]) {
      eventType = "count";
      const node = nodeBySpanStart.get(countRunStart[i]);
      kind = node?.kind ?? "group";
      stableKey = (node?.meta.stableKey as string) ?? "";
      if (node?.axis) {
        const kids = sortedChildrenOf(node.meta.stableKey as string).length;
        readCount = kids;
        readRemainder = remainderOf(node, kids);
        readAxis = node.axis;
        if (node.axis === "col") acc["grid.cols"] = kids;
        else acc["grid.rows"] = kids;
        narration = `Read split count — ${kids} ${node.axis === "col" ? "columns" : "rows"}.`;
      } else {
        narration = "Read split count.";
      }
    } else if (ch === "(" || ch === "[") {
      eventType = "enter";
      const cs = i > 0 && isCount[i - 1] ? countRunStart[i - 1] : i;
      const node = nodeBySpanStart.get(cs);
      const axis: "row" | "col" = node?.axis ?? (ch === "(" ? "col" : "row");
      if (node) {
        const children = sortedChildrenOf(node.meta.stableKey as string);
        stack.push({ node, children, idx: 0 });
        countStack.push(children.length);
        remainderStack.push({
          rem: remainderOf(node, children.length),
          floor: floorOf(node, children.length),
          axis,
        });
        if (children[0]) cursor = rectOf(children[0]);
        splitRegion = rectOf(node);
        split = { axis, dividers: dividersOf(node, children) };
        kind = node.kind;
        stableKey = node.meta.stableKey as string;
        narration = `Split into ${children.length} ${axis === "col" ? "columns" : "rows"}.`;
      }
    } else if (ch === ")" || ch === "]") {
      eventType = "exit";
      const top = stack.pop();
      countStack.pop();
      const closed = remainderStack.pop();
      if (top) {
        cursor = rectOf(top.node);
        kind = top.node.kind;
        stableKey = top.node.meta.stableKey as string;
      }
      // Safety net: any remainder px not itemized to a leaf (e.g. absorbed by a
      // nested split-child) is accounted for here so R never lingers past close.
      const leftover = closed?.rem ?? 0;
      narration =
        leftover > 0
          ? `Close split — ${leftover} remainder px absorbed by nested regions, restore the parent.`
          : "Close split — restore the parent region.";
    } else if (ch === ",") {
      eventType = "sibling";
      const top = stack[stack.length - 1];
      if (top) {
        top.idx++;
        const c = top.children[top.idx];
        if (c) {
          cursor = rectOf(c);
          kind = c.kind;
          stableKey = c.meta.stableKey as string;
        }
      }
      narration = "Advance to the next sibling.";
    } else if (ch === "F" || (ch === "1" && !isCount[i])) {
      eventType = "emitLeaf";
      const top = stack[stack.length - 1];
      const c = top ? top.children[top.idx] : undefined;
      if (c) {
        cursor = rectOf(c);
        stableKey = c.meta.stableKey as string;
      }
      leafIndex = leafIdx++;
      kind = "frame";
      acc["tile.index"] = leafIndex;
      acc["tile.w"] = cursor.width;
      acc["tile.h"] = cursor.height;
      // This tile claims any donated passthrough space in flight (C → 0) and its
      // share of the split's quantization remainder (R counts down). Order matters:
      // the carry it absorbs is netted out so a donation isn't miscounted as a
      // remainder px.
      carryAbsorbed = carryPx;
      remainderClaim = claimRemainder(carryAbsorbed);
      carryPx = 0;
      narration =
        `Emit tile ${leafIndex + 1} — ${cursor.width}×${cursor.height} at (${cursor.x}, ${cursor.y}).` +
        (carryAbsorbed > 0 ? ` Absorbs ${carryAbsorbed}px donated by a passthrough.` : "") +
        (remainderClaim > 0
          ? ` Claims ${remainderClaim} leftover remainder px (one of the fat tiles).`
          : "");
    } else if (ch === "0" || ch === ">") {
      eventType = "passthrough";
      const top = stack[stack.length - 1];
      const c = top ? top.children[top.idx] : undefined;
      if (c) {
        cursor = rectOf(c);
        stableKey = c.meta.stableKey as string;
      }
      kind = "passthrough";
      // The parse tree's rect for a passthrough is CUMULATIVE: in a run of `>`s each
      // one already holds every donation in flight before it, so its extent IS the
      // carry — not an increment. (Adding it re-counted the run: the brand M's
      // 136-column rows reported a 146,300px carry on a 1,920px canvas, and tiles
      // "absorbing" 80,311px — 2026-09-05.) The carry already in flight is netted
      // out of the remainder claim for the same reason: only THIS slot's own fat
      // (remainder) px count, else they'd be claimed again by the receiving tile.
      const carryBefore = carryPx;
      remainderClaim = claimRemainder(carryBefore);
      const cumulative = top ? (top.node.axis === "col" ? cursor.width : cursor.height) : 0;
      const donated = Math.max(0, cumulative - carryBefore);
      carryPx = Math.max(carryBefore, cumulative);
      narration = `Passthrough — donate ${donated}px forward (carry now ${carryPx}px), claimed by the next tile.`;
    } else if (ch === "-") {
      eventType = "null";
      const top = stack[stack.length - 1];
      const c = top ? top.children[top.idx] : undefined;
      if (c) {
        cursor = rectOf(c);
        stableKey = c.meta.stableKey as string;
      }
      kind = "null";
      remainderClaim = claimRemainder(0);
      narration =
        "Null slot — reserve space, paint nothing." +
        (remainderClaim > 0 ? ` (holds ${remainderClaim} remainder px)` : "");
    } else if (ch === "{") {
      eventType = "overlay";
      overlayDepth++;
      kind = "group";
      narration = `Open overlay layer ${overlayDepth}.`;
    } else if (ch === "}") {
      eventType = "overlay";
      overlayDepth = Math.max(0, overlayDepth - 1);
      kind = "group";
      narration = "Close overlay layer.";
    } else {
      continue; // unknown punctuation — not a step
    }

    const z = overlayDepth;
    // N = arity of the split in focus. A count-read step shows the count it just
    // read (before the split is pushed); inner steps show the enclosing split's
    // size; root (no split open) is 0.
    const currentN =
      readCount != null ? readCount : countStack.length ? countStack[countStack.length - 1] : 0;
    // Axis the arity refers to: the count just read, else the enclosing split's.
    const axisInFocus = readAxis ?? (stack.length ? stack[stack.length - 1].node.axis : undefined);
    // R mirrors N: a count-read shows that split's remainder; inner steps show the
    // enclosing split's; root shows 0. C is the running passthrough carry balance.
    const currentR =
      readRemainder != null
        ? readRemainder
        : remainderStack.length
          ? remainderStack[remainderStack.length - 1].rem
          : 0;
    const currentC = carryPx;
    const fields: Record<InspectorField, FieldDiff> = {
      X: diff(prevRect.x, cursor.x),
      Y: diff(prevRect.y, cursor.y),
      W: diff(prevRect.width, cursor.width),
      H: diff(prevRect.height, cursor.height),
      Z: diff(prevZ, z),
      N: diff(prevN, currentN),
      R: diff(prevR, currentR),
      C: diff(prevC, currentC),
    };

    const accumulator: Record<string, FieldDiff> = {};
    for (const k of Object.keys(acc)) {
      const before = k in prevAccSnapshot ? prevAccSnapshot[k] : null;
      accumulator[k] = diff(before, acc[k]);
    }

    steps.push({
      index: steps.length + 1,
      total: 0, // filled after the walk
      eventType,
      charIndex: i,
      kind,
      stableKey,
      leafIndex,
      span: { start: i, end: i + 1 },
      rect: { x: cursor.x, y: cursor.y, width: cursor.width, height: cursor.height },
      fields,
      accumulator,
      narration,
      tokenIndex: symbolIndexAt(s, i),
      split,
      splitRegion,
      remainderClaim: remainderClaim > 0 ? remainderClaim : undefined,
      carryAbsorbed: carryAbsorbed > 0 ? carryAbsorbed : undefined,
      axisInFocus,
    });

    prevRect = cursor;
    prevZ = z;
    prevN = currentN;
    prevR = currentR;
    prevC = currentC;
    prevAccSnapshot = { ...acc };
  }

  const total = steps.length;
  for (const st of steps) st.total = total;

  return { m0: s, steps, tokenCount, nodeCount };
}
