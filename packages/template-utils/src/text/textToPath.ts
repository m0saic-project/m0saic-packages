/**
 * textToPath / measureText / bundledFontPath moved to the low-level
 * `@m0saic/text` package so the renderer core (`@m0saic/core`) can share the
 * same glyph-path engine (core can't depend on template-utils).
 *
 * Re-exported here so existing template authors keep importing it from
 * `@m0saic/template-utils` under their habitual namespace.
 */
export * from "@m0saic/text";
