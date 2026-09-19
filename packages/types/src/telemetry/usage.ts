import type { MosaicTemplateKind } from "../analytics/usageMetrics";
import type { MosaicTelemetrySurface } from "./record";

/** Bumped when the usage-record shape changes incompatibly. */
export const TELEMETRY_USAGE_RECORD_SCHEMA_VERSION = 1;

/**
 * One local feature-usage event — one JSON line in
 * `<m0saic-root>/telemetry/usage/YYYY-MM.jsonl`. LOCAL only; the rollup
 * builder tallies these into `metrics.features` / `templatesUsed`
 * (counts). `templateId` is kept only for first-party (`builtin`)
 * templates. A layout share is a plain `share.layout.copy` line — no
 * layout string, canvas size or shape is ever recorded.
 * `feature` is shape-checked here (`isFeatureKeyShaped`) and a member of
 * the hosts' closed enum by construction (they are the only writers).
 */
export type MosaicUsageRecord = {
  schemaVersion: typeof TELEMETRY_USAGE_RECORD_SCHEMA_VERSION;
  /** Epoch ms. */
  atMs: number;
  surface: MosaicTelemetrySurface;
  feature: string;
  templateId?: string;
  templateKind?: MosaicTemplateKind;
};
