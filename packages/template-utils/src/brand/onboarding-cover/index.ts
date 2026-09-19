/**
 * The mosaic-branding cover kit — hoisted from `packages/templates` so a
 * template repo that may only import `@m0saic/template-utils` gets the same
 * first-open cover assembler the shipped first-party templates use.
 *
 * Only `onboarding-cover`'s surface is public (`buildBrandedCover`, the
 * `onboarding*` composition helpers, the type ramp, the theme). The
 * screencap-grid cover/tutorial renders and the theme presets are the kit's
 * private closure — they exist here so the kit is byte-identical to the
 * original, not as a second home for those templates.
 */
export * from "./onboarding-cover";
