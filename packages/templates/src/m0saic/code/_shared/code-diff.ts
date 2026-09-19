/** Deterministic line LCS, motion grouping, and block-level fade coalescing. */

export type SameLineOp = {
  kind: "same";
  text: string;
  fromLine: number;
  toLine: number;
};

export type DeleteLineOp = {
  kind: "del";
  text: string;
  fromLine: number;
  toLine: null;
};

export type AddLineOp = {
  kind: "add";
  text: string;
  fromLine: null;
  toLine: number;
};

export type LineOp = SameLineOp | DeleteLineOp | AddLineOp;

export interface MotionUnitLine {
  text: string;
  fromLine: number | null;
  toLine: number | null;
}

export interface MoveUnit {
  kind: "move";
  fromStartLine: number;
  toStartLine: number;
  /** Destination minus source, in grid lines. */
  deltaLines: number;
  lines: MotionUnitLine[];
}

export interface RemoveUnit {
  kind: "remove";
  fromStartLine: number;
  lines: MotionUnitLine[];
}

export interface AddUnit {
  kind: "add";
  toStartLine: number;
  lines: MotionUnitLine[];
}

export type MotionUnit = MoveUnit | RemoveUnit | AddUnit;
export type MotionGrouping = "block" | "line";

export interface SparseRasterUnit {
  kind: "static" | "remove" | "add";
  lines: MotionUnitLine[];
}

export interface CoalescedMotionPlan {
  staticUnderlay?: SparseRasterUnit;
  removalRaster?: SparseRasterUnit;
  additionRaster?: SparseRasterUnit;
  moves: MoveUnit[];
}

function validateLines(lines: ReadonlyArray<string>, name: string): void {
  if (!Array.isArray(lines)) throw new Error(`${name} must be an array`);
  lines.forEach((line, index) => {
    if (typeof line !== "string") {
      throw new Error(`${name}[${index}] must be a string`);
    }
  });
}

/**
 * Classic O(N·M) exact-line LCS diff.
 *
 * Tie-break is load-bearing: when deleting or adding retains the same LCS
 * length, emit the deletion first. Equal lines always match immediately.
 *
 * The table is a SUFFIX DP (lcs[i][j] = LCS of before[i..], after[j..]) with a
 * forward walk, so its `lcs[i + 1][j] >= lcs[i][j + 1]` tie-break is the exact
 * equivalent of the plan's prefix-table `L[i-1][j] >= L[i][j-1]` — do not
 * "fix" one to match the other's index arithmetic.
 */
export function lcsDiffLines(
  before: ReadonlyArray<string>,
  after: ReadonlyArray<string>,
): LineOp[] {
  validateLines(before, "lcsDiffLines: before");
  validateLines(after, "lcsDiffLines: after");

  const rows = before.length + 1;
  const cols = after.length + 1;
  const lcs = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        before[i] === after[j]
          ? 1 + lcs[i + 1]![j + 1]!
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const ops: LineOp[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      ops.push({
        kind: "same",
        text: before[i]!,
        fromLine: i,
        toLine: j,
      });
      i += 1;
      j += 1;
    } else if (
      i < before.length &&
      (j >= after.length || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)
    ) {
      ops.push({
        kind: "del",
        text: before[i]!,
        fromLine: i,
        toLine: null,
      });
      i += 1;
    } else {
      ops.push({
        kind: "add",
        text: after[j]!,
        fromLine: null,
        toLine: j,
      });
      j += 1;
    }
  }
  return ops;
}

/** Maximal contiguous same-vector moves, removals, and additions. */
export function groupMotionUnits(ops: ReadonlyArray<LineOp>): MotionUnit[] {
  if (!Array.isArray(ops)) {
    throw new Error("groupMotionUnits: ops must be an array");
  }
  const units: MotionUnit[] = [];

  for (const op of ops) {
    const previous = units[units.length - 1];
    if (op.kind === "same") {
      const deltaLines = op.toLine - op.fromLine;
      const line: MotionUnitLine = {
        text: op.text,
        fromLine: op.fromLine,
        toLine: op.toLine,
      };
      const lastLine = previous?.lines[previous.lines.length - 1];
      if (
        previous?.kind === "move" &&
        previous.deltaLines === deltaLines &&
        lastLine?.fromLine === op.fromLine - 1 &&
        lastLine.toLine === op.toLine - 1
      ) {
        previous.lines.push(line);
      } else {
        units.push({
          kind: "move",
          fromStartLine: op.fromLine,
          toStartLine: op.toLine,
          deltaLines,
          lines: [line],
        });
      }
      continue;
    }

    if (op.kind === "del") {
      const line: MotionUnitLine = {
        text: op.text,
        fromLine: op.fromLine,
        toLine: null,
      };
      const lastLine = previous?.lines[previous.lines.length - 1];
      if (
        previous?.kind === "remove" &&
        lastLine?.fromLine === op.fromLine - 1
      ) {
        previous.lines.push(line);
      } else {
        units.push({
          kind: "remove",
          fromStartLine: op.fromLine,
          lines: [line],
        });
      }
      continue;
    }

    const line: MotionUnitLine = {
      text: op.text,
      fromLine: null,
      toLine: op.toLine,
    };
    const lastLine = previous?.lines[previous.lines.length - 1];
    if (
      previous?.kind === "add" &&
      lastLine?.toLine === op.toLine - 1
    ) {
      previous.lines.push(line);
    } else {
      units.push({
        kind: "add",
        toStartLine: op.toLine,
        lines: [line],
      });
    }
  }

  return units;
}

/** Split blocks into one-line units without changing any line mapping. */
export function refineMotionUnits(
  units: ReadonlyArray<MotionUnit>,
  grouping: MotionGrouping,
): MotionUnit[] {
  if (grouping === "block") {
    return units.map((unit) => ({
      ...unit,
      lines: unit.lines.map((line) => ({ ...line })),
    })) as MotionUnit[];
  }

  const refined: MotionUnit[] = [];
  for (const unit of units) {
    for (const line of unit.lines) {
      if (unit.kind === "move") {
        refined.push({
          kind: "move",
          fromStartLine: line.fromLine!,
          toStartLine: line.toLine!,
          deltaLines: unit.deltaLines,
          lines: [{ ...line }],
        });
      } else if (unit.kind === "remove") {
        refined.push({
          kind: "remove",
          fromStartLine: line.fromLine!,
          lines: [{ ...line }],
        });
      } else {
        refined.push({
          kind: "add",
          toStartLine: line.toLine!,
          lines: [{ ...line }],
        });
      }
    }
  }
  return refined;
}

/** Collapse block-level fades and static lines into three sparse raster units. */
export function coalesceFadeUnits(
  units: ReadonlyArray<MotionUnit>,
  grouping: "block" = "block",
): CoalescedMotionPlan {
  if (grouping !== "block") {
    throw new Error(`coalesceFadeUnits: unsupported grouping ${JSON.stringify(grouping)}`);
  }
  const staticLines: MotionUnitLine[] = [];
  const removalLines: MotionUnitLine[] = [];
  const additionLines: MotionUnitLine[] = [];
  const moves: MoveUnit[] = [];

  for (const unit of units) {
    if (unit.kind === "remove") removalLines.push(...unit.lines.map((line) => ({ ...line })));
    else if (unit.kind === "add") additionLines.push(...unit.lines.map((line) => ({ ...line })));
    else if (unit.deltaLines === 0) staticLines.push(...unit.lines.map((line) => ({ ...line })));
    else moves.push({ ...unit, lines: unit.lines.map((line) => ({ ...line })) });
  }

  return {
    ...(staticLines.length > 0
      ? { staticUnderlay: { kind: "static" as const, lines: staticLines } }
      : {}),
    ...(removalLines.length > 0
      ? { removalRaster: { kind: "remove" as const, lines: removalLines } }
      : {}),
    ...(additionLines.length > 0
      ? { additionRaster: { kind: "add" as const, lines: additionLines } }
      : {}),
    moves,
  };
}
