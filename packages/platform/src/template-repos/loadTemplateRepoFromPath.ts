import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  MosaicDiagnostic,
  MosaicTemplate,
  MosaicTemplateProps,
  MosaicTemplateRepoDescriptor,
  MosaicTemplateRepoManifest,
} from "@m0saic/types";
import { asDiagnosticCode, asRepoId, asTemplateId } from "@m0saic/types";
import { validateTemplateRoles } from "./validateTemplateRoles";
import { registerHostFirstRepoRoot } from "./hostFirstResolution";
import { parseTemplateId } from "../templateId/parseTemplateId";

// ── Result types ─────────────────────────────────────────────────────

/**
 * Subset of a multi-publisher repo to load. Union semantics: a template is
 * selected when it matches ANY requested publisher or pack key. Passed
 * through to the repo's `getTemplates(selection)` when it exports one (the
 * lazy path — unselected publishers are never evaluated); repos exporting
 * only an eager `templates[]` are filtered host-side by parsed id instead.
 */
export type TemplateRepoSelection = {
  /** Publisher handles (`"m0saic-dev"`; a leading `@` is tolerated). */
  publishers?: string[];
  /** Publisher-scoped pack keys, `"<publisher>/<pack>"` (e.g. `"m0saic-dev/print"`). */
  packs?: string[];
};

export type LoadedTemplateRepo = {
  repo: MosaicTemplateRepoDescriptor;
  templates: MosaicTemplate<MosaicTemplateProps>[];
  manifest?: MosaicTemplateRepoManifest;
  resolved: {
    inputPath: string;
    kind: "folder" | "file";
    manifestPath?: string;
    entryPath?: string;
    entryUrl?: string;
  };
  diagnostics: MosaicDiagnostic[];
};

export type ResolvedEntry = {
  entryPath: string;
  candidates: string[];
};

// ── Native ESM import ────────────────────────────────────────────────
// TypeScript compiles `import()` → `require()` in CJS output, which
// cannot load ESM modules or file:// URLs. This preserves the native
// import() expression at runtime.
const nativeImport = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<any>;

// ── Reload support ───────────────────────────────────────────────────
// A long-running host (Mosaic Desktop) loads an external repo once, then
// the author rebuilds it and asks to refresh. Node's ESM module cache has
// NO eviction API, so re-importing the same `file://` URL silently returns
// the ORIGINAL module — the author's rebuild is invisible until the app
// restarts. Two mechanisms together fix that for CommonJS repos (what
// `tsc` emits by default):
//
//  1. Append a build stamp to the import URL. A distinct URL is a distinct
//     ESM module record, so the entry re-evaluates. The stamp is the
//     newest mtime in the repo's output dir, NOT a counter — an unchanged
//     repo keeps its URL and its cache entry, so repeated refreshes don't
//     leak a module instance per click.
//  2. Evict the entry's directory subtree from `require.cache`. Busting
//     the URL alone only refreshes the ENTRY; its relative imports resolve
//     without the query and would still be served stale. For CJS the whole
//     graph flows through `require.cache`, so evicting the subtree
//     refreshes every sub-module too.
//
// True ESM repos (`.mjs`, or `"type": "module"`) can only have their entry
// refreshed — there is no way to invalidate an already-imported ESM
// sub-module. Those get a warning diagnostic rather than silent staleness.

/** Directories never worth walking for a build stamp. */
const STAMP_SKIP_DIRS = new Set(["node_modules", ".git", ".cache"]);

/** Newest mtime (ms) under `dir`, or null. Bounded so a mis-pointed path
 *  at a huge tree can't stall a refresh. */
function newestMtimeMs(dir: string, budget = 5000): number | null {
  let newest: number | null = null;
  let seen = 0;
  const stack = [dir];
  while (stack.length > 0 && seen < budget) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (seen >= budget) break;
      if (e.isDirectory()) {
        if (!STAMP_SKIP_DIRS.has(e.name)) stack.push(path.join(current, e.name));
        continue;
      }
      seen += 1;
      try {
        const m = fs.statSync(path.join(current, e.name)).mtimeMs;
        if (newest === null || m > newest) newest = m;
      } catch {
        /* vanished mid-walk (build in flight) — skip */
      }
    }
  }
  return newest;
}

/** Does this entry load as ESM? `.mjs`, or `.js` under a `"type":"module"`
 *  package. `.cjs` is always CommonJS. */
function isEsmEntry(entryPath: string): boolean {
  const ext = path.extname(entryPath).toLowerCase();
  if (ext === ".mjs") return true;
  if (ext === ".cjs") return false;
  // Walk up for the nearest package.json.
  let dir = path.dirname(entryPath);
  for (let i = 0; i < 10; i += 1) {
    const pkgPath = path.join(dir, "package.json");
    if (fileExists(pkgPath)) {
      try {
        return JSON.parse(fs.readFileSync(pkgPath, "utf-8")).type === "module";
      } catch {
        return false;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

/** The host's CommonJS `require`, or null in a pure-ESM embedding. */
function hostRequire():
  | (((id: string) => unknown) & { cache?: Record<string, unknown> })
  | null {
  const fromGlobal = (
    globalThis as unknown as { require?: (id: string) => unknown }
  ).require;
  if (typeof fromGlobal === "function") {
    return fromGlobal as ReturnType<typeof hostRequire>;
  }
  return typeof require !== "undefined"
    ? (require as unknown as ReturnType<typeof hostRequire>)
    : null;
}

/** Evict `dir`'s subtree from the CommonJS require cache. No-op when the
 *  host has no `require` (pure-ESM embedding). Returns entries cleared.
 *
 *  Matches on the REAL path as well as the given one: `require.cache` is
 *  keyed by realpath, while the caller's path is only `path.resolve`d, so any
 *  symlink between them (macOS `/var` → `/private/var`, a symlinked checkout,
 *  a linked workspace) would silently match nothing and leave the whole
 *  subtree stale. */
function evictRequireCacheSubtree(dir: string): number {
  const cache = hostRequire()?.cache;
  if (!cache) return 0;

  const prefixes = new Set<string>([dir + path.sep]);
  try {
    prefixes.add(fs.realpathSync(dir) + path.sep);
  } catch {
    /* dir vanished (build in flight) — the literal prefix still applies */
  }

  let cleared = 0;
  for (const key of Object.keys(cache)) {
    for (const prefix of prefixes) {
      if (key.startsWith(prefix)) {
        delete cache[key];
        cleared += 1;
        break;
      }
    }
  }
  return cleared;
}

// ── Helpers ──────────────────────────────────────────────────────────

function diag(
  code: string,
  message: string,
  severity: "error" | "warning" = "error",
): MosaicDiagnostic {
  return { code: asDiagnosticCode(code), message, severity };
}

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Determine which entry file to import for a template repo folder.
 *
 * Returns the chosen entry path and the list of candidates checked.
 */
export function resolveTemplateRepoEntry(
  folderPath: string,
  opts?: {
    entryOverridePath?: string;
    manifestEntry?: string;
  },
): ResolvedEntry | { entryPath: undefined; candidates: string[] } {
  const candidates: string[] = [];

  // 1) Explicit override (from CLI --template-repo-entry)
  if (opts?.entryOverridePath) {
    const resolved = path.resolve(folderPath, opts.entryOverridePath);
    candidates.push(resolved);
    if (fileExists(resolved)) return { entryPath: resolved, candidates };
  }

  // 2) Manifest-specified entry
  if (opts?.manifestEntry) {
    const resolved = path.resolve(folderPath, opts.manifestEntry);
    candidates.push(resolved);
    if (fileExists(resolved)) return { entryPath: resolved, candidates };
  }

  // 3) dist/index.js
  const distIndex = path.resolve(folderPath, "dist", "index.js");
  candidates.push(distIndex);
  if (fileExists(distIndex)) return { entryPath: distIndex, candidates };

  // 4) dist/index.mjs
  const distMjs = path.resolve(folderPath, "dist", "index.mjs");
  candidates.push(distMjs);
  if (fileExists(distMjs)) return { entryPath: distMjs, candidates };

  // 5) package.json main/exports
  const pkgPath = path.resolve(folderPath, "package.json");
  if (fileExists(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const main =
        (typeof pkg.exports === "string"
          ? pkg.exports
          : typeof pkg.exports === "object" && pkg.exports["."]
            ? typeof pkg.exports["."] === "string"
              ? pkg.exports["."]
              : pkg.exports["."].import || pkg.exports["."].default
            : undefined) || pkg.main;

      if (main) {
        const resolved = path.resolve(folderPath, main);
        candidates.push(resolved);
        if (fileExists(resolved)) return { entryPath: resolved, candidates };
      }
    } catch {
      // ignore malformed package.json
    }
  }

  return { entryPath: undefined, candidates };
}

// ── Main loader ──────────────────────────────────────────────────────

export async function loadTemplateRepoFromPath(
  inputPath: string,
  opts?: {
    entryOverridePath?: string;
    cwd?: string;
    /**
     * Re-read the repo from disk even if this process already imported it.
     *
     * Off by default — a one-shot host (the CLI) imports once per process
     * and never needs it. A long-running host (Mosaic Desktop's "Refresh
     * repos") MUST pass `true`, or the author's rebuild is invisible until
     * the app restarts. See the "Reload support" note above for what this
     * can and cannot refresh.
     */
    reload?: boolean;
    /** Load only part of a multi-publisher repo. Omit to load everything. */
    selection?: TemplateRepoSelection;
  },
): Promise<LoadedTemplateRepo> {
  const diagnostics: MosaicDiagnostic[] = [];
  const cwd = opts?.cwd ?? process.cwd();
  const resolvedInput = path.resolve(cwd, inputPath);

  const isDir = isDirectory(resolvedInput);
  const isFile = !isDir && fileExists(resolvedInput);
  const kind: "folder" | "file" = isDir ? "folder" : "file";

  if (!isDir && !isFile) {
    diagnostics.push(
      diag(
        "TEMPLATE_REPO_NOT_FOUND",
        `Template repo path does not exist: ${resolvedInput}`,
      ),
    );
    return {
      repo: { repoId: asRepoId(""), displayName: "", schemaVersion: 0 },
      templates: [],
      resolved: { inputPath, kind },
      diagnostics,
    };
  }

  // ── File path: import directly ───────────────────────────────────
  if (isFile) {
    return importAndValidate({
      inputPath,
      kind: "file",
      entryPath: resolvedInput,
      repoRoot: path.dirname(resolvedInput),
      diagnostics,
      reload: opts?.reload === true,
      selection: opts?.selection,
    });
  }

  // ── Folder path ──────────────────────────────────────────────────
  let manifest: MosaicTemplateRepoManifest | undefined;
  let manifestPath: string | undefined;

  // Try loading manifest
  const manifestCandidate = path.resolve(
    resolvedInput,
    "template-manifest.json",
  );
  if (fileExists(manifestCandidate)) {
    manifestPath = manifestCandidate;
    try {
      const raw = JSON.parse(fs.readFileSync(manifestCandidate, "utf-8"));
      if (raw.schemaVersion !== 1) {
        diagnostics.push(
          diag(
            "TEMPLATE_REPO_UNSUPPORTED_SCHEMA",
            `template-manifest.json has unsupported schemaVersion ${raw.schemaVersion} (expected 1)`,
          ),
        );
        return {
          repo: raw.repo ?? {
            repoId: asRepoId(""),
            displayName: "",
            schemaVersion: raw.schemaVersion,
          },
          templates: [],
          manifest: raw,
          resolved: {
            inputPath,
            kind: "folder",
            manifestPath,
          },
          diagnostics,
        };
      }
      manifest = raw as MosaicTemplateRepoManifest;
    } catch (err: any) {
      diagnostics.push(
        diag(
          "TEMPLATE_REPO_MANIFEST_PARSE_ERROR",
          `Failed to parse template-manifest.json: ${err.message}`,
        ),
      );
    }
  }

  // Resolve entry
  const entryResult = resolveTemplateRepoEntry(resolvedInput, {
    entryOverridePath: opts?.entryOverridePath,
    manifestEntry: manifest?.entryModule,
  });

  if (!entryResult.entryPath) {
    diagnostics.push(
      diag(
        "TEMPLATE_REPO_MISSING_BUILD",
        `Could not find entry module for template repo at ${resolvedInput}.\n` +
          `  Checked:\n${entryResult.candidates.map((c) => `    - ${c}`).join("\n")}\n` +
          `  Hint: Run the repo's build step, or provide --template-repo-entry.`,
      ),
    );
    return {
      repo: manifest?.repo ?? {
        repoId: asRepoId(""),
        displayName: "",
        schemaVersion: 0,
      },
      templates: [],
      manifest,
      resolved: {
        inputPath,
        kind: "folder",
        manifestPath,
      },
      diagnostics,
    };
  }

  const result = await importAndValidate({
    inputPath,
    kind: "folder",
    entryPath: entryResult.entryPath,
    repoRoot: resolvedInput,
    manifestPath,
    manifest,
    diagnostics,
    reload: opts?.reload === true,
    selection: opts?.selection,
  });

  return result;
}

/** Does this template id fall inside the requested selection? */
function templateMatchesSelection(
  id: string,
  selection: TemplateRepoSelection,
): boolean {
  let publisher: string;
  let pack: string | undefined;
  try {
    const parsed = parseTemplateId(asTemplateId(id));
    publisher = String(parsed.publisher).replace(/^@/, "");
    pack = parsed.pack;
  } catch {
    return false;
  }
  const wantPublishers = (selection.publishers ?? []).map((p) =>
    p.replace(/^@/, ""),
  );
  const wantPacks = (selection.packs ?? []).map((k) => k.replace(/^@/, ""));
  if (wantPublishers.includes(publisher)) return true;
  return pack !== undefined && wantPacks.includes(`${publisher}/${pack}`);
}

function hasSelectionCriteria(selection: TemplateRepoSelection): boolean {
  return Boolean(selection.publishers?.length || selection.packs?.length);
}

// ── Import + validate ────────────────────────────────────────────────

async function importAndValidate(ctx: {
  inputPath: string;
  kind: "folder" | "file";
  entryPath: string;
  /** The checkout — every file under it resolves `@m0saic/*` host-first. */
  repoRoot: string;
  manifestPath?: string;
  manifest?: MosaicTemplateRepoManifest;
  diagnostics: MosaicDiagnostic[];
  reload?: boolean;
  selection?: TemplateRepoSelection;
}): Promise<LoadedTemplateRepo> {
  const { inputPath, kind, entryPath, manifestPath, manifest, diagnostics } =
    ctx;
  const entryUrl = pathToFileURL(entryPath).href;

  // Host-first `@m0saic/*` for the repo's code — registered BEFORE the entry
  // is imported so its very first `require("@m0saic/template-utils")` already
  // resolves from the host, never from `<checkout>/node_modules`. Persistent:
  // template code keeps `require()`ing lazily at render time. An entry that
  // lives outside the checkout (an explicit --template-repo-entry pointing
  // elsewhere) gets its own directory registered too. See hostFirstResolution.
  registerHostFirstRepoRoot(ctx.repoRoot);
  const entryDirForHook = path.dirname(entryPath);
  if (!entryDirForHook.startsWith(path.resolve(ctx.repoRoot) + path.sep)) {
    registerHostFirstRepoRoot(entryDirForHook);
  }

  // On reload, drop the CJS graph and re-evaluate. See "Reload support" above.
  let importUrl = entryUrl;
  let reloadViaRequire: ((id: string) => unknown) | null = null;
  if (ctx.reload) {
    const entryDir = path.dirname(entryPath);
    evictRequireCacheSubtree(entryDir);

    const esm = isEsmEntry(entryPath);
    const req = hostRequire();

    if (!esm && req) {
      // CommonJS: re-require through the CJS loader rather than a
      // cache-busted `import()`.
      //
      // A busted URL LOOKS like it should work, and for a single-file entry it
      // does — but Node's ESM→CJS translation mis-serves a re-imported graph
      // when the entry `require()`s the same child twice. That is not exotic:
      // it's exactly what `tsc` emits for a barrel file that does
      // `import { X } from "./x"` alongside `export * from "./x"`, and the
      // failure is silent — the child's exports come back EMPTY, so
      // `templates` fills with `undefined` and the repo appears to export
      // nothing. Going straight through `require()` re-evaluates the whole
      // subtree correctly, which is what the eviction above set up.
      reloadViaRequire = req;
    } else {
      const stamp = newestMtimeMs(entryDir);
      if (stamp !== null) {
        importUrl = `${entryUrl}?m0saicBuild=${Math.round(stamp)}`;
      }
      if (esm) {
        diagnostics.push(
          diag(
            "TEMPLATE_REPO_ESM_RELOAD_PARTIAL",
            `Repo entry ${path.basename(entryPath)} loads as ESM. Node cannot ` +
              `invalidate an already-imported ESM module, so only the ENTRY file ` +
              `re-reads on refresh — changes in files it imports keep serving the ` +
              `previously-loaded code until the app restarts. Build the repo as ` +
              `CommonJS (tsc's default "module": "commonjs") or bundle to a single ` +
              `entry file for a reliable rebuild → refresh loop.`,
            "warning",
          ),
        );
      }
    }
  }

  let mod: any;
  try {
    mod = reloadViaRequire
      ? reloadViaRequire(entryPath)
      : await nativeImport(importUrl);
  } catch (err: any) {
    diagnostics.push(
      diag(
        "TEMPLATE_REPO_IMPORT_FAILED",
        `Failed to import template repo entry ${entryPath}:\n  ${err.message}`,
      ),
    );
    return {
      repo: manifest?.repo ?? {
        repoId: asRepoId(""),
        displayName: "",
        schemaVersion: 0,
      },
      templates: [],
      manifest,
      resolved: { inputPath, kind, manifestPath, entryPath, entryUrl },
      diagnostics,
    };
  }

  // Extract repo descriptor
  let repo: MosaicTemplateRepoDescriptor | undefined = mod.repo;
  if (!repo && manifest?.repo) {
    repo = manifest.repo;
  }

  if (!repo) {
    diagnostics.push(
      diag(
        "TEMPLATE_REPO_MISSING_EXPORT",
        `Template repo module at ${entryPath} does not export "repo" (MosaicTemplateRepoDescriptor), ` +
          `and no template-manifest.json with repo descriptor was found.`,
      ),
    );
    return {
      repo: { repoId: asRepoId(""), displayName: "", schemaVersion: 0 },
      templates: [],
      manifest,
      resolved: { inputPath, kind, manifestPath, entryPath, entryUrl },
      diagnostics,
    };
  }

  // Validate repo descriptor
  if (!repo.repoId || typeof repo.repoId !== "string") {
    diagnostics.push(
      diag(
        "TEMPLATE_REPO_INVALID_DESCRIPTOR",
        `repo.repoId is missing or empty`,
      ),
    );
  }
  if (!repo.displayName || typeof repo.displayName !== "string") {
    diagnostics.push(
      diag(
        "TEMPLATE_REPO_INVALID_DESCRIPTOR",
        `repo.displayName is missing or empty`,
      ),
    );
  }
  if (repo.schemaVersion !== 1) {
    diagnostics.push(
      diag(
        "TEMPLATE_REPO_UNSUPPORTED_SCHEMA",
        `repo.schemaVersion is ${repo.schemaVersion}, expected 1`,
      ),
    );
  }

  // Check manifest/module repoId consistency
  if (manifest?.repo && mod.repo) {
    if (manifest.repo.repoId !== mod.repo.repoId) {
      diagnostics.push(
        diag(
          "TEMPLATE_REPO_ID_MISMATCH",
          `Manifest repoId "${manifest.repo.repoId}" does not match module repoId "${mod.repo.repoId}". Using module value.`,
          "warning",
        ),
      );
    }
  }

  // Extract templates. With no selection the historical preference holds
  // (eager `templates[]` first). With a selection, `getTemplates(selection)`
  // is preferred — it's the lazy path where unselected publishers are never
  // evaluated; an eager-only repo is filtered host-side by parsed id.
  const selection =
    ctx.selection && hasSelectionCriteria(ctx.selection)
      ? ctx.selection
      : undefined;
  let templates: MosaicTemplate<MosaicTemplateProps>[] = [];
  if (selection && typeof mod.getTemplates === "function") {
    try {
      templates = mod.getTemplates(selection);
    } catch (err: any) {
      diagnostics.push(
        diag(
          "TEMPLATE_REPO_INVALID_TEMPLATES",
          `getTemplates() threw: ${err.message}`,
        ),
      );
    }
  } else if (Array.isArray(mod.templates)) {
    templates = mod.templates;
  } else if (typeof mod.getTemplates === "function") {
    try {
      templates = mod.getTemplates();
    } catch (err: any) {
      diagnostics.push(
        diag(
          "TEMPLATE_REPO_INVALID_TEMPLATES",
          `getTemplates() threw: ${err.message}`,
        ),
      );
    }
  } else {
    diagnostics.push(
      diag(
        "TEMPLATE_REPO_MISSING_EXPORT",
        `Template repo module does not export "templates" array or "getTemplates()" function.`,
      ),
    );
  }

  if (!Array.isArray(templates)) {
    diagnostics.push(
      diag(
        "TEMPLATE_REPO_INVALID_TEMPLATES",
        `"templates" export is not an array`,
      ),
    );
    templates = [];
  }

  // Belt-and-braces: `getTemplates()` may ignore the selection argument
  // (repos that predate it), and the eager-array path never saw it. The
  // returned set is filtered by parsed id either way.
  if (selection) {
    templates = templates.filter(
      (t) => t != null && templateMatchesSelection(String(t?.id ?? ""), selection),
    );
  }

  // Validate individual templates. Hole entries get their own error: an
  // `undefined` slot means the entry module's imports didn't resolve (a
  // partially-evaluated barrel file, a typo'd re-export), and reporting that
  // as "missing id" would send the author hunting in the wrong file. Filter
  // them out too, so downstream `t.id` reads can't throw.
  const holeCount = templates.filter((t) => t == null).length;
  if (holeCount > 0) {
    diagnostics.push(
      diag(
        "TEMPLATE_REPO_INVALID_TEMPLATES",
        `${holeCount} entr${holeCount === 1 ? "y" : "ies"} in repo ` +
          `"${repo.repoId}"'s templates[] ${holeCount === 1 ? "is" : "are"} ` +
          `undefined. The entry module exported the array but not the values — ` +
          `usually a barrel file whose imports didn't resolve. Check that every ` +
          `template in templates[] is actually imported and exported.`,
      ),
    );
    templates = templates.filter((t) => t != null);
  }

  for (const t of templates) {
    if (!t.id || typeof t.id !== "string") {
      diagnostics.push(
        diag(
          "TEMPLATE_REPO_INVALID_TEMPLATES",
          `A template in repo "${repo.repoId}" is missing a valid "id" field`,
          "warning",
        ),
      );
    }
  }

  // Check for duplicate IDs within repo
  const seen = new Set<string>();
  for (const t of templates) {
    if (t.id && seen.has(t.id)) {
      diagnostics.push(
        diag(
          "TEMPLATE_REPO_DUPLICATE_ID",
          `Duplicate template id "${t.id}" in repo "${repo.repoId}"`,
          "warning",
        ),
      );
    }
    if (t.id) seen.add(t.id);
  }

  // Role naming-convention check (opt-in: only templates that declare a
  // role get validated; mismatch is a warning, never an error).
  diagnostics.push(...validateTemplateRoles(templates));

  return {
    repo,
    templates,
    manifest,
    resolved: { inputPath, kind, manifestPath, entryPath, entryUrl },
    diagnostics,
  };
}
