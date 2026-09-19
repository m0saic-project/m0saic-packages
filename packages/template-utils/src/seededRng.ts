/**
 * Shared seeded PRNGs for template authors.
 *
 * Templates MUST NOT call `Math.random` directly (CLAUDE.md §9). When
 * a template needs randomness — shuffling clips, jittering offsets,
 * picking from a weighted pool — it should accept a `seed: number`
 * prop and instantiate one of these.
 *
 * The two implementations here cover the common cases:
 *
 *   - {@link mulberry32}: 32-bit state, period 2^32, fast and small.
 *     Right pick for most clip-picking / shuffling needs.
 *   - {@link splitmix32}: 32-bit state, designed to spread the seed
 *     bits well. Useful when many sibling RNGs are seeded off
 *     adjacent integers (e.g. one RNG per bucket index).
 *
 * Identical seeds produce identical sequences across runtimes and
 * across host architectures — that's the determinism gate the
 * engine relies on for byte-identical re-renders.
 *
 * Neither is cryptographic. Don't use them for anything other than
 * deterministic visual variation.
 */

export type SeededRng = () => number;

/**
 * mulberry32 — Tommy Ettinger's classic 32-bit PRNG. Returns a
 * function that yields values in `[0, 1)`.
 */
export function mulberry32(seed: number): SeededRng {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * splitmix32 — fast mix function suitable for seeding multiple
 * sibling streams from adjacent integers. Use when a template
 * spawns several RNGs (e.g. one per bucket) and wants them to
 * diverge fast.
 */
export function splitmix32(seed: number): SeededRng {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
    t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  };
}
