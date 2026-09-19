/**
 * Forensic-watermarking primitives for m0saic templates.
 *
 * Public surface for template authors building payload-embedding
 * templates (the v1 case: `@m0saic/forensic/watermark/video/v1`).
 *
 * See the internal forensic-watermarking notes for the design.
 */

export * from "./gf";
export * from "./bch";
export * from "./mask";
export * from "./slotPlanner";
export * from "./alphaPerCell";
export * from "./encoder";
export * from "./decoder";
