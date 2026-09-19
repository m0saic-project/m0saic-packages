import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { StableKey } from "@m0saic/dsl";
import { parseM0File, parseM0cFile } from "@m0saic/dsl-file-formats";
import type { M0AgentMeta, M0File, M0cFile, M0Label } from "@m0saic/dsl-file-formats";
import { normalizeCandidateContext } from "@m0saic/momo-types";
import type {
  CandidateContext,
  CandidateRef,
  SessionRef,
} from "@m0saic/momo-types";

/**
 * One parsed candidate inside a session, with its agent annotations and
 * typed CandidateContext extracted for convenience. The template doesn't
 * need to re-derive these from the raw header block.
 *
 * `format` distinguishes `.m0` (geometry-only) from `.m0c` (geometry +
 * labels / masks / rank sets / background). `labels` is hoisted from
 * .m0c files only — it's the stableKey-validated label system; .m0
 * files don't carry labels (their agent.regions is a free-form fallback).
 */
export type LoadedCandidate = {
  /** Position info — number is the zero-padded `NNN` from the filename. */
  ref: CandidateRef;
  /** Source format of the candidate file. */
  format: "m0" | "m0c";
  /**
   * The parsed file. M0File for `.m0`, M0cFile for `.m0c`. Discriminate
   * on `format` to narrow.
   */
  file: M0File | M0cFile;
  /** Hoisted from `file.agent` for ergonomic access; null if absent. */
  agent: M0AgentMeta | null;
  /**
   * The typed CandidateContext (already narrowed by the parser per
   * Pillar A). Undefined when the candidate has no agent.context.
   */
  context: CandidateContext | undefined;
  /**
   * Hoisted labels from `.m0c` files. Keyed by stableKey; values are
   * {@link M0Label}. Always `null` for `.m0` candidates (the .m0 format
   * has no labels field — its agent.regions is a free-form fallback).
   */
  labels: Record<StableKey, M0Label> | null;
};

/**
 * The shape `loadSession` returns. Templates consume this to drive
 * per-candidate rendering and per-session summaries.
 */
export type LoadedSession = {
  /** Session-level descriptor derived from the directory name. */
  session: SessionRef;
  /** Candidates in their natural numeric order. */
  candidates: LoadedCandidate[];
};

const CANDIDATE_FILE_RE = /^candidate-(\d+)\.(m0|m0c)$/;

/**
 * Load a sandbox session directory and return a structured view ready
 * for templates to consume.
 *
 * `absPath` is the absolute path to a session directory
 * (e.g. `packages/sandbox/sessions/2026-06-09-bar-graph/`). The function
 * finds every `candidate-NNN.m0` file, sorts them by number, parses
 * each, and hoists the typed `CandidateContext` for convenience.
 *
 * v1 reads `.m0` only; `.m0c` is on the roadmap once the agent loop
 * starts working on context-rich layouts (see the plan's v1.1 note).
 *
 * Pure file-system read; no side effects on the session directory.
 */
export function loadSession(absPath: string): LoadedSession {
  const slug = basename(absPath);
  const dateMatch = slug.match(/^(\d{4}-\d{2}-\d{2})/);

  const entries: {
    num: string;
    format: "m0" | "m0c";
    file: M0File | M0cFile;
  }[] = [];
  for (const name of readdirSync(absPath)) {
    const match = name.match(CANDIDATE_FILE_RE);
    if (!match) continue;
    const text = readFileSync(join(absPath, name), "utf8");
    const ext = match[2] as "m0" | "m0c";
    const file = ext === "m0c" ? parseM0cFile(text) : parseM0File(text);
    entries.push({ num: match[1], format: ext, file });
  }
  entries.sort((a, b) => Number(a.num) - Number(b.num));

  const ofTotal = entries.length;
  const candidates: LoadedCandidate[] = entries.map(({ num, format, file }) => ({
    ref: { number: num, ofTotal },
    format,
    file,
    agent: file.agent ?? null,
    // The file formats carry the context as an opaque wire shape; narrow it
    // to the typed protocol refinement here so templates get real fields.
    context: normalizeCandidateContext(file.agent?.context),
    labels: format === "m0c" ? ((file as M0cFile).labels ?? null) : null,
  }));

  return {
    session: {
      slug,
      startedAt: dateMatch ? dateMatch[1] : undefined,
    },
    candidates,
  };
}
