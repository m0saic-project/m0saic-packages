/**
 * Static analysis of ffmpeg `enable` expressions: recover the active time
 * window `[startSec, endSec]` from the machine-generated shapes m0saic
 * templates emit.
 *
 * The engine uses the recovered window to give a source a *lifetime* —
 * trimming its upstream chain to the window and gating heavy per-pixel
 * filters (`geq`) so off-window frames cost nothing. See
 * the internal engine-enable-gating-sprint notes.
 *
 * Recognition is deliberately exact (the `tryParseUniformFadeIn`
 * discipline): only the shapes emitted by the m0saic authoring helpers
 * qualify, and the numeric boundary text is preserved VERBATIM so callers
 * can re-emit the exact same numbers (determinism). Anything else — sums of
 * windows, `if(…)` phases, local-time `(t-S)` terms, non-numeric bounds —
 * returns `null`, which callers must treat as "no statically known window"
 * (never as an error).
 */

/**
 * An active window recovered from an enable expression.
 *
 * `startSec === null` means unbounded-from-0 (`lt(t,B)` shapes);
 * `endSec === null` means unbounded-to-stream-end (`gte(t,A)` shapes).
 * At least one bound is always present. `startRaw`/`endRaw` carry the
 * boundary text exactly as it appeared in the expression.
 */
export type EnableWindow = {
  startSec: number | null;
  endSec: number | null;
  startRaw?: string;
  endRaw?: string;
};

// Unsigned ffmpeg numeric literal (same alphabet as core's FF_NUM_SRC):
// digits, optional fraction, optional exponent. Helpers emit `.toFixed(3)`
// or `Number(x.toFixed(3))` text, but accept the general form.
const NUM = String.raw`\d+(?:\.\d+)?(?:[eE][-+]?\d+)?`;

// The four recognized factor shapes, each anchored to the WHOLE factor.
const RE_GTE = new RegExp(`^gte\\(t,(${NUM})\\)$`);
const RE_LT = new RegExp(`^lte?\\(t,(${NUM})\\)$`); // lt(t,B) | lte(t,B)
const RE_BETWEEN = new RegExp(`^between\\(t,(${NUM}),(${NUM})\\)$`);

/** `(…)` where the opening paren closes at the very end — safe to strip. */
function isRedundantParenWrap(s: string): boolean {
  if (s.length < 2 || !s.startsWith("(") || !s.endsWith(")")) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i === s.length - 1;
    }
  }
  return false;
}

function stripWraps(s: string): string {
  while (isRedundantParenWrap(s)) s = s.slice(1, -1);
  return s;
}

/**
 * Split on top-level `*` only (never inside parentheses). Returns `null`
 * when parentheses are unbalanced.
 */
function splitTopLevelProduct(s: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth < 0) return null;
    } else if (c === "*" && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  if (depth !== 0) return null;
  parts.push(s.slice(start));
  return parts;
}

type Bound =
  | { kind: "start"; raw: string }
  | { kind: "end"; raw: string }
  | { kind: "both"; startRaw: string; endRaw: string };

/** Parse ONE factor (already wrap-stripped) as a window bound. */
function parseFactor(factor: string): Bound | null {
  let m = RE_BETWEEN.exec(factor);
  if (m) return { kind: "both", startRaw: m[1], endRaw: m[2] };
  m = RE_GTE.exec(factor);
  if (m) return { kind: "start", raw: m[1] };
  m = RE_LT.exec(factor);
  if (m) return { kind: "end", raw: m[1] };
  return null;
}

/**
 * Recover the active window from an enable expression, or `null` when the
 * window is not statically recoverable.
 *
 * Recognized shapes (post-`substituteLocalTime` normalized input — the time
 * variable must be a bare `t`):
 *
 *   - `gte(t,A)`                       → `[A, ∞)`
 *   - `lt(t,B)` / `lte(t,B)`           → `[0(=null), B)`
 *   - `between(t,A,B)`                 → `[A, B]` (raw or `\,`-escaped commas)
 *   - `gte(t,A)*lt(t,B)` (either order, factors optionally paren-wrapped)
 *
 * Bails (→ `null`) on everything else: multi-window sums, `if(…)` phases,
 * `(t-S)` local-time terms, unbalanced parens, non-finite bounds, negative
 * starts, and empty/inverted windows (`A >= B`).
 */
export function parseEnableWindow(expr: string): EnableWindow | null {
  if (!expr) return null;
  // tracks-style emission escapes commas for embedding in lavfi filter args;
  // the numeric bounds contain no commas, so unescaping first is lossless.
  const unescaped = expr.replace(/\\,/g, ",");
  const e = stripWraps(unescaped.trim());
  if (!e) return null;

  const factors = splitTopLevelProduct(e);
  if (!factors || factors.length === 0 || factors.length > 2) return null;

  let startRaw: string | undefined;
  let endRaw: string | undefined;

  for (const rawFactor of factors) {
    const bound = parseFactor(stripWraps(rawFactor));
    if (!bound) return null;
    if (bound.kind === "both") {
      // between(t,A,B) must be the ONLY factor.
      if (factors.length !== 1) return null;
      startRaw = bound.startRaw;
      endRaw = bound.endRaw;
    } else if (bound.kind === "start") {
      if (startRaw != null) return null; // two start bounds — not a window
      startRaw = bound.raw;
    } else {
      if (endRaw != null) return null; // two end bounds — not a window
      endRaw = bound.raw;
    }
  }

  const startSec = startRaw != null ? Number(startRaw) : null;
  const endSec = endRaw != null ? Number(endRaw) : null;

  if (startSec != null && (!Number.isFinite(startSec) || startSec < 0)) {
    return null;
  }
  if (endSec != null && (!Number.isFinite(endSec) || endSec <= 0)) return null;
  if (startSec != null && endSec != null && startSec >= endSec) return null;

  const win: EnableWindow = { startSec, endSec };
  if (startRaw != null) win.startRaw = startRaw;
  if (endRaw != null) win.endRaw = endRaw;
  return win;
}
