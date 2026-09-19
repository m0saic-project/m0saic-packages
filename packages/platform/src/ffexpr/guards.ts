/**
 * Expression validation guards.
 */

/**
 * Throw if `expr` references standalone `x` or `y` tokens.
 *
 * Overlay offset expressions must not reference ffmpeg's `x`/`y`
 * variables (the overlay's own position) — doing so would create
 * a circular dependency. Authors should use `W`/`H` macros and
 * numeric offsets instead.
 */
export function forbidXY(expr: string): void {
  if (/\bx\b/.test(expr) || /\by\b/.test(expr)) {
    throw new Error(
      `overlay expr may not reference x/y; use offsets only. expr="${expr}"`,
    );
  }
}
