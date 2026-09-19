/**
 * Number theory for the m0 lattice — the arithmetic behind the `latticeSmooth`
 * template convention (handbook `composition-arithmetic.md` §1–§2).
 *
 * An m0 split `N(…)` / `N[…]` lays N equal slots across an axis, so N is the
 * split's BASIS. Every canvas m0saic delivers to is 5-smooth (its only prime
 * factors are 2, 3 and 5: 1080 = 2³·3³·5, 1920 = 2⁷·3·5, …) and the per-axis
 * gcd of the modern family (1080 / 1920 / 2160 / 3840 / 4320 / 7680) is 120.
 * Two facts follow:
 *
 *  - a split count that divides its axis is pixel-exact, and divisors of a
 *    5-smooth number are 5-smooth — a tree whose every split count is 5-smooth
 *    never hits a prime wall at any nesting depth;
 *  - composing two templates costs the LCM of their self-lattices (the LCM of
 *    each one's split counts). Two 5-smooth lattices LCM to a small 5-smooth
 *    number; one rough factor (7, 11, 17, 121 = 11², …) multiplies the whole
 *    composition — the corpus median self-lattice was LCM(120, 121) = 14,520.
 *
 * Pure, web-safe, no node builtins. Every function takes positive safe
 * integers and throws a `RangeError` otherwise (fail fast — a NaN here would
 * surface as a silently-passing convention).
 */

/** The primes a "smooth" split count may be built from. */
export const SMOOTH_PRIMES: readonly number[] = [2, 3, 5];

/** Per-axis gcd of the modern canvas family — the portable basis cap. */
export const FAMILY_GCD = 120;

function assertPositiveInt(n: number, what: string): void {
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new RangeError(`${what}: expected a positive safe integer, got ${String(n)}`);
  }
}

/** Greatest common divisor (non-negative integers; gcd(0, n) = n). */
export function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x;
}

/** Least common multiple. */
export function lcm(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return (Math.abs(a) / gcd(a, b)) * Math.abs(b);
}

/**
 * LCM of a list — a template's SELF-LATTICE when fed its split counts.
 * Returns `Infinity` once the running value exceeds `cap` (default 1e15,
 * past which the number is "astronomical" and further precision is noise;
 * `@m0saic/theming/v1` measured 2.1e11 before its re-lattice).
 * An empty list has lattice 1.
 */
export function lcmAll(ns: Iterable<number>, cap = 1e15): number {
  let l = 1;
  for (const n of ns) {
    assertPositiveInt(n, "lcmAll");
    l = lcm(l, n);
    if (l > cap) return Infinity;
  }
  return l;
}

/**
 * `n` with every factor of 2, 3 and 5 divided out. `1` ⇔ `n` is 5-smooth;
 * otherwise the value IS the multiplier `n` imposes on any composition
 * (121 → 121, 119 → 119, 14 → 7, 68 → 17).
 */
export function roughPart(n: number): number {
  assertPositiveInt(n, "roughPart");
  let r = n;
  for (const p of SMOOTH_PRIMES) while (r % p === 0) r /= p;
  return r;
}

/** True when `n` factors into 2, 3 and 5 only (1 counts). */
export function isSmooth(n: number): boolean {
  return roughPart(n) === 1;
}

/** Prime factorisation by trial division, ascending: `[{ p, e }]`. `1` → `[]`. */
export function factorize(n: number): Array<{ p: number; e: number }> {
  assertPositiveInt(n, "factorize");
  const out: Array<{ p: number; e: number }> = [];
  let r = n;
  const take = (p: number): void => {
    let e = 0;
    while (r % p === 0) {
      r /= p;
      e++;
    }
    if (e > 0) out.push({ p, e });
  };
  take(2);
  take(3);
  for (let p = 5; p * p <= r; p += 2) take(p);
  if (r > 1) out.push({ p: r, e: 1 });
  return out;
}

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
};

function sup(e: number): string {
  return String(e).split("").map((d) => SUPERSCRIPT[d] ?? d).join("");
}

/**
 * Human factorisation for messages: `121` → `11²`, `119` → `7·17`,
 * `1920` → `2⁷·3·5`, `1` → `1`.
 */
export function formatFactors(n: number): string {
  const f = factorize(n);
  if (f.length === 0) return "1";
  return f.map(({ p, e }) => (e === 1 ? String(p) : `${p}${sup(e)}`)).join("·");
}

/** Every positive divisor of `n`, ascending (trial division to √n). */
export function divisors(n: number): number[] {
  assertPositiveInt(n, "divisors");
  const small: number[] = [];
  const large: number[] = [];
  for (let d = 1; d * d <= n; d++) {
    if (n % d !== 0) continue;
    small.push(d);
    if (d * d !== n) large.push(n / d);
  }
  return small.concat(large.reverse());
}

/** The 5-smooth divisors of `n`, ascending — the exact split counts available
 *  on axis `n` that also compose. On a 5-smooth axis this is every divisor. */
export function smoothDivisors(n: number): number[] {
  return divisors(n).filter(isSmooth);
}

/** The universal portable basis menu: `divisors(120)` — 16 values. */
export const FAMILY_BASIS_MENU: readonly number[] = divisors(FAMILY_GCD);

/**
 * Enumerate 5-smooth numbers around `n` and pick by predicate. Exhaustive over
 * 2ᵃ·3ᵇ·5ᶜ with each exponent bounded by log(limit), so O(log³) — fine for any
 * split count or pixel dimension.
 */
function smoothExtreme(n: number, mode: "ceil" | "floor"): number {
  assertPositiveInt(n, mode === "ceil" ? "ceilToSmooth" : "floorToSmooth");
  // The ceiling candidate never needs to exceed the next power of two ≥ n.
  const limit = mode === "ceil" ? 2 ** Math.ceil(Math.log2(n)) : n;
  let best = mode === "ceil" ? Infinity : 1;
  for (let a = 1; a <= limit; a *= 2) {
    for (let b = a; b <= limit; b *= 3) {
      for (let c = b; c <= limit; c *= 5) {
        if (mode === "ceil") {
          if (c >= n && c < best) best = c;
        } else if (c <= n && c > best) {
          best = c;
        }
      }
    }
  }
  return best;
}

/** Smallest 5-smooth integer ≥ `n` (99 → 100, 101 → 108, 121 → 125). The
 *  self-frame helper: a frame slot count or a basis cap rounded onto the lattice. */
export function ceilToSmooth(n: number): number {
  return smoothExtreme(n, "ceil");
}

/** Largest 5-smooth integer ≤ `n` (119 → 108, 121 → 120, 7 → 6). */
export function floorToSmooth(n: number): number {
  return smoothExtreme(n, "floor");
}

/**
 * The 5-smooth integer nearest `n` (ties go up), optionally capped at `max` —
 * for a parent handing a child a slot: a rough slot axis (980 = 2²·5·7²,
 * 290 = 2·5·29) is inherited by every divisor-picking split inside the child,
 * so the parent snaps the SLOT, not the child its output. Returns `n` when it
 * is already smooth or below 1.
 */
export function nearestSmooth(n: number, max = Infinity): number {
  if (!Number.isSafeInteger(n) || n < 1 || isSmooth(n)) return n;
  const lo = floorToSmooth(n);
  const hi = ceilToSmooth(n);
  return hi <= max && hi - n <= n - lo ? hi : lo;
}

/**
 * Snap a slot rect's width and height to the nearest 5-smooth sizes without
 * leaving the `W`×`H` canvas (growth is only taken when it fits; otherwise the
 * slot shrinks). Position is untouched — the parent's own bands carry it.
 */
export function snapSlot<R extends { x: number; y: number; w: number; h: number }>(rect: R, W: number, H: number): R {
  return { ...rect, w: nearestSmooth(rect.w, Math.max(1, W - rect.x)), h: nearestSmooth(rect.h, Math.max(1, H - rect.y)) };
}

/** Split counts at or below this may carry a rough factor (content fill) — mirrored
 *  from `latticeReport.ts` so the builders and the convention agree on the boundary. */
const SMALL_BASIS = 12;

/**
 * The `precision` a weighted split should pass to `weightedSplit` so its basis
 * lands on the 5-smooth lattice, given integer band weights (usually pixels):
 *
 *  - `sum > cap` → the cap: Hamilton scaling makes the total EXACTLY the cap,
 *    and GCD-reduction then yields one of its divisors (5-smooth for 120).
 *    Rounding each weight to the cap on its own sums to cap ± 1 — the
 *    119/121 lattice the alpine kit shipped with.
 *  - `sum ≤ cap` but rough and above the small-basis carve-out, with unequal
 *    weights → `floorToSmooth(sum)`: pixel bands keep 1 slot ≈ 1 px (never
 *    MORE slots than pixels, so feasibility holds) and drift ≤ 1 px onto a
 *    smooth basis. Skipped when that would leave fewer slots than bands.
 *  - otherwise `undefined`: a smooth or tiny sum keeps its basis, and CONTENT
 *    patterns are never rescaled — equal weights (13 rows), or equal items
 *    interleaved with equal gutters ([6,1,6,1,6]): Hamilton onto fewer slots
 *    would leave one row shorter than its siblings, which is not a lattice
 *    fix but a broken list. Those keep their basis and the convention reports
 *    them; the fix is at the call site (pick item/gutter weights whose total
 *    is smooth, or move the gutters into the fiber with latticeCellInset).
 */
export function latticePrecision(weights: readonly number[], opts: { cap?: number; smallBasis?: number } = {}): number | undefined {
  const cap = opts.cap ?? FAMILY_GCD;
  const small = opts.smallBasis ?? SMALL_BASIS;
  if (weights.length === 0) return undefined;
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum > cap) return cap;
  if (sum <= small || isSmooth(sum)) return undefined;
  if (isContentPattern(weights)) return undefined;
  const p = floorToSmooth(sum);
  return p >= weights.length ? p : undefined;
}

/** Equal weights, or equal items interleaved with equal gutters — content
 *  cardinality that a proportional rescale would visibly distort. */
function isContentPattern(weights: readonly number[]): boolean {
  if (weights.every((w) => w === weights[0])) return true;
  if (weights.length < 3) return false;
  const items = weights.filter((_, i) => i % 2 === 0);
  const gutters = weights.filter((_, i) => i % 2 === 1);
  return items.every((w) => w === items[0]) && gutters.every((w) => w === gutters[0]);
}

/** Hamilton (largest-remainder) scaling to exactly `target` slots, every band ≥ 1 —
 *  the same allocation `weightedSplit`'s `precision` performs. */
function hamilton(weights: readonly number[], target: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const ideal = weights.map((w) => (w / sum) * target);
  const out = ideal.map((v) => Math.max(1, Math.floor(v)));
  let remainder = target - out.reduce((a, b) => a + b, 0);
  if (remainder > 0) {
    // Rank by what each band is still OWED (a band clamped up to 1 is owed nothing).
    const order = ideal.map((v, i) => ({ i, owed: v - out[i] })).sort((a, b) => b.owed - a.owed || a.i - b.i);
    for (let j = 0; j < remainder; j++) out[order[j % order.length].i]++;
  } else if (remainder < 0) {
    const order = out.map((v, i) => ({ i, v })).filter((x) => x.v > 1).sort((a, b) => b.v - a.v || a.i - b.i);
    for (let j = 0; remainder < 0 && j < order.length; j++) {
      const take = Math.min(order[j].v - 1, -remainder);
      out[order[j].i] -= take;
      remainder += take;
    }
  }
  return out;
}

const isSymmetric = (w: readonly number[]): boolean => w.every((v, i) => v === w[w.length - 1 - i]);
/** Two values alternating — items and gutters — with at least three bands. */
const isAlternating = (w: readonly number[]): boolean => w.length >= 3 && w.every((v, i) => v === w[i % 2]);
/** Largest per-band change as a fraction of the whole axis. */
function maxFractionDrift(before: readonly number[], after: readonly number[]): number {
  const sb = before.reduce((a, b) => a + b, 0);
  const sa = after.reduce((a, b) => a + b, 0);
  return Math.max(...before.map((w, i) => Math.abs(w / sb - after[i] / sa)));
}

/** A rewrite may move any band by at most this fraction of the axis (2 % — a
 *  few px on a 100 px cell; the visual budget the handbook calls "drift"). */
export const LATTICE_MAX_DRIFT = 0.02;

/**
 * Rewrite integer band weights so the split's basis lands on the 5-smooth
 * lattice — the structure-preserving form of {@link latticePrecision}, for
 * kits that build splits from pixel bands or proportions alike:
 *
 *  - the basis is judged AFTER GCD reduction (the engine's basis): a reduced
 *    total that is smooth or ≤ `smallBasis` is left alone, and so are
 *    ALL-EQUAL weights (content cardinality — 13 rows stay 13 rows);
 *  - otherwise the bands are Hamilton-scaled to the largest smooth total that
 *    is ≤ the cap AND ≤ the reduced total — feasibility is never worse than
 *    the split the author had (never more slots than before, never more slots
 *    than pixels) — walking down the smooth numbers until the result keeps the
 *    input's SYMMETRY (`[pad, mid, pad]`) and ALTERNATION (items / gutters:
 *    every item still equals every item) and moves no band by more than
 *    {@link LATTICE_MAX_DRIFT} of the axis — or two pixels, or one slot of the
 *    target basis, whichever is largest (a sub-cap split is pixel bands, and
 *    a coarse basis cannot move by less than a slot);
 *  - when no such total exists the weights are returned unchanged and the
 *    convention reports the split — the fix is structural (gutters into the
 *    fiber with latticeCellInset, a different content count), not a distortion.
 *
 * Pass the result to `weightedSplit` as its weights (it GCD-reduces).
 */
export function latticeWeights(weights: readonly number[], opts: { cap?: number; smallBasis?: number } = {}): number[] {
  const cap = opts.cap ?? FAMILY_GCD;
  const small = opts.smallBasis ?? SMALL_BASIS;
  const ws = weights.map((w) => Math.max(1, Math.round(w)));
  if (ws.length === 0) return ws;
  const sum = ws.reduce((a, b) => a + b, 0);
  const reduced = sum / ws.reduce((g, w) => gcd(g, w), 0);
  if (reduced <= cap && (reduced <= small || isSmooth(reduced))) return ws;
  if (ws.every((w) => w === ws[0])) return ws;
  const symmetric = isSymmetric(ws);
  const alternating = isAlternating(ws);
  const budget = Math.min(cap, reduced);
  // The drift budget is a fraction of the axis — but a sub-cap split is pixel
  // bands (1 slot ≈ 1 px), where two pixels on a 14 px status bar is 14 % of
  // the axis and invisible on screen; and on a coarse basis one slot IS several
  // percent (a 19-slot [9,3,7] can only move in 1/18ths). Allow the largest of
  // the three: 2 % of the axis, two pixels, one slot of the target basis.
  for (let target = floorToSmooth(budget); target >= ws.length; target = floorToSmooth(target - 1)) {
    const out = hamilton(ws, target);
    if (maxFractionDrift(ws, out) > Math.max(LATTICE_MAX_DRIFT, 2 / sum, 1 / target)) break;
    if (symmetric && !isSymmetric(out)) continue;
    if (alternating && !isAlternating(out)) continue;
    return out;
  }
  return ws;
}

/**
 * The pixel size of each section a weighted split will ACTUALLY produce on an
 * axis of `totalPx` — the engine's own arithmetic, reproduced: the weights are
 * GCD-reduced (what `weightedSplit` emits), the axis is divided into that many
 * equal slots with the remainder handed out outside-in (edges first, centre
 * last), and each section sums its slots. Use it to derive anything that must
 * register with a quantized cell (an inset computed against the cell's real
 * width) instead of against the ideal fraction — the handbook's "derive
 * dependents from the same quantized geometry". Locked against the parser by
 * its test.
 */
export function quantizedSections(totalPx: number, weights: readonly number[]): number[] {
  const ws = weights.map((w) => Math.max(1, Math.round(w)));
  if (ws.length === 0) return [];
  const g = ws.reduce((a, w) => gcd(a, w), 0) || 1;
  const reduced = ws.map((w) => w / g);
  const parts = reduced.reduce((a, b) => a + b, 0);
  const T = Math.max(0, Math.trunc(totalPx));
  const base = Math.trunc(T / parts);
  const rem = T - base * parts;
  const slots = new Array<number>(parts).fill(base);
  let k = 0;
  let left = 0;
  let right = parts - 1;
  while (k < rem && left <= right) {
    slots[left] += 1;
    k += 1;
    if (k >= rem) break;
    if (right !== left) {
      slots[right] += 1;
      k += 1;
    }
    left += 1;
    right -= 1;
  }
  const out: number[] = [];
  let i = 0;
  for (const w of reduced) {
    let px = 0;
    for (let j = 0; j < w; j++) px += slots[i++];
    out.push(px);
  }
  return out;
}
