import type { MosaicTemplateProps } from "@m0saic/types";

/**
 * Job + JobSet + JobRun — the persistent shapes behind the Jobs page
 * (the Handbrake-style power surface for scheduling renders).
 *
 * Lives in `@m0saic/platform` (not in `@m0saic/types`) because Jobs
 * is an application feature, not part of the file-format or
 * render-engine contract. Template authors and external tooling
 * don't need to read jobs.json — only Mosaic-app surfaces (the web
 * Jobs page, the Electron scheduler) do. `@m0saic/types` stays
 * focused on the ecosystem-facing contract; cross-process app
 * shapes like this one go through platform.
 *
 * The Electron main process consumes these as plain JSON via
 * `~/.m0saic/jobs/*.json` (no TypeScript dependency at runtime;
 * this file is for the TypeScript-side consumers).
 *
 * Storage: ~/.m0saic/jobs/{jobs,sets,runs}.json + ~/.m0saic/jobs/runs/.
 */

/* ── Job inputs ────────────────────────────────────────────────────── */

/**
 * What a Job renders. Mirrors the CLI's accepted inputs:
 *   - mosaic-file  → a fully-described .mosaic document (either
 *                    `kind: "mosaic_document"` or `kind: "mosaic_pipeline"`)
 *   - mosaicx-file → a source-form .mosaicx (`kind: "mosaicx_document"`,
 *                    carries `template_invocation` sources). The runner
 *                    resolves it via `resolveMosaicx` (same lowering the
 *                    Make path performs) before planning — this is what
 *                    lets a cron job drive a template pipeline end-to-end.
 *   - m0-file      → a bare .m0 / .m0c (rendered with neutral fill sources)
 *   - template     → a registered template id + props (no file needed)
 *
 * The runner dispatches on the PARSED file's `kind`, not just the input
 * kind — a `.mosaicx` document supplied under `mosaic-file` still
 * resolves correctly (the Jobs UI infers `mosaicx-file` from the file
 * extension, but hand-authored jobs.json entries shouldn't break).
 */
export type JobInput =
  | { kind: "mosaic-file"; path: string }
  | { kind: "mosaicx-file"; path: string }
  | { kind: "m0-file"; path: string }
  | { kind: "template"; templateId: string; props: MosaicTemplateProps };

/**
 * Render parameters mirroring the existing render IPC contract. `output`
 * supports `{{name}}` and `{{date}}` tokens — see runJob for substitution
 * rules. `toolchain` exposes the existing LGPL/GPL ffmpeg split.
 */
export type JobRenderArgs = {
  width: number;
  height: number;
  output: string;
  fps?: number;
  durationMs?: number;
  outputKind?: "video" | "image";
  alpha?: boolean;
  toolchain?: "lgpl" | "gpl";
};

/* ── Schedules ─────────────────────────────────────────────────────── */

/**
 * v1 schedule kinds:
 *   - manual → only fires when a user clicks Run now
 *   - cron   → standard 5-field expression, dispatched by node-cron in
 *              the Electron main process. Only fires while the app is
 *              open; this is documented constraint.
 *
 * File-watch and webhook triggers are deferred to follow-on phases.
 */
export type JobSchedule =
  | { kind: "manual" }
  | { kind: "cron"; expr: string; tz?: string };

/* ── Jobs + Sets ───────────────────────────────────────────────────── */

/** Persistent JSON-shape Job. Immutable from the runner's perspective —
 *  edits create a new updatedAt. */
export type Job = {
  id: string;
  name: string;
  setId?: string;
  input: JobInput;
  render: JobRenderArgs;
  schedule: JobSchedule;
  enabled: boolean;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
};

/**
 * Named group of jobs. Jobs in a set without their own schedule inherit
 * the set's schedule; otherwise the job-level schedule wins. Set
 * defaults are merged into each member job's render args (job-level
 * values still take precedence).
 */
export type JobSet = {
  id: string;
  name: string;
  defaults: Partial<JobRenderArgs>;
  schedule?: JobSchedule;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

/* ── Runs ──────────────────────────────────────────────────────────── */

export type JobRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

/**
 * One execution of a Job. The `renderId` bridges to the existing
 * RenderEvent stream so the Jobs UI and the RenderHero overlay can
 * subscribe to the same live data.
 *
 * The `m0` / `width` / `height` triple is captured at run start
 * from the resolved renderable so the RenderHero overlay can render
 * its layout-aware viewframe (DSL math + plan-truth tile fills) for
 * Jobs runs the same way it does for Make. Pipelines don't have a
 * single canonical m0 string — those fields are left undefined and
 * the Hero falls back to the plain brand-mark M.
 */
export type JobRun = {
  id: string;
  jobId: string;
  setId?: string;
  triggeredBy: "manual" | "cron" | "set-run";
  status: JobRunStatus;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number;
  finalOutput?: string;
  error?: string;
  renderId?: string;
  /** Canonical m0 string of the rendered document (top-level only). */
  m0?: string;
  width?: number;
  height?: number;
};

/* ── Persistence envelope ──────────────────────────────────────────── */

/**
 * jobs.json / sets.json / runs.json all share this envelope so we can
 * version the storage format independently of the in-memory types.
 * Bump JOBS_SCHEMA_VERSION when adding required fields; JobStore.read
 * is responsible for migrating older payloads forward.
 */
export const JOBS_SCHEMA_VERSION = 1 as const;

export type JobsFile = {
  schemaVersion: typeof JOBS_SCHEMA_VERSION;
  jobs: Job[];
};

export type JobSetsFile = {
  schemaVersion: typeof JOBS_SCHEMA_VERSION;
  sets: JobSet[];
};

export type JobRunsFile = {
  schemaVersion: typeof JOBS_SCHEMA_VERSION;
  runs: JobRun[];
};
