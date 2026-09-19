export * from "./validateOutputConfig";

/**
 * Free-tier container-metadata attribution string.
 *
 * Injected by the render layer into `metadata.comment` when:
 *   1. The user has not typed anything in Comment, AND
 *   2. `checkLicenseStatus()` reports free tier.
 *
 * Lives here (not in `@m0saic/product`) so the web app can render
 * it as a placeholder without crossing the public/private package
 * boundary. The product gate that decides whether to *write* it
 * still lives in `@m0saic/product`; this constant is just the
 * payload.
 *
 * Comment is the only metadata atom we claim — Title / Description
 * / Author / Copyright stay user-owned (legal / ownership
 * implications). Comment is the universal "editor identity" field
 * (Premiere, Resolve, ffmpeg's own `encoder` atom all stamp here).
 */
export const M0SAIC_FREE_TIER_COMMENT =
  "Made with m0saic — https://m0saic.io";
