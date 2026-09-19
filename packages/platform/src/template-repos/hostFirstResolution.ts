import Module from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Host-first resolution for `@m0saic/*` inside external template repos.
 *
 * An external repo's built entry does `require("@m0saic/template-utils")`
 * and friends. Node resolves that by walking `node_modules` UP FROM THE
 * CHECKOUT, which is wrong in both directions:
 *
 *   - a clone outside the workspace has no `@m0saic/*` beside it and fails
 *     with "Cannot find module '@m0saic/template-utils'", and
 *   - an attacker can plant `<checkout>/node_modules/@m0saic/template-utils`
 *     (or `dist/node_modules/…`) beside an otherwise-verified tree, and that
 *     code runs with whatever namespace the verification granted.
 *
 * The substrate a repo compiles against is the HOST's — the very packages
 * this loader was installed with. So while a repo is loaded (and afterwards,
 * for the lazy `require()`s template code makes at render time), any
 * `@m0saic/<pkg>` / `@m0saic/<pkg>/<subpath>` request that ORIGINATES from a
 * file under a registered repo root is resolved from this package's own
 * directory — never from the checkout's `node_modules`. Everything else
 * (a third-party repo's own non-`@m0saic` packages, relative paths, requests
 * made by host code) is untouched.
 *
 * Mechanism: one wrapper around `Module._resolveFilename` (the CommonJS
 * resolver every `require()` passes through), installed once per process
 * and kept on a global so a re-evaluated copy of this module (a hot reload
 * that evicts the workspace packages from `require.cache`) reuses the same
 * hook instead of stacking another. Roots are stored realpath'd and the
 * requesting file is compared realpath'd too, so a symlinked checkout — or a
 * file symlinked into one — cannot escape the "originates under the repo
 * root" test in either direction.
 *
 * Scope: CommonJS only. An `.mjs` entry's static `import` statements go
 * through Node's ESM resolver, which has no equivalent hook; the loader
 * already steers repos towards CommonJS output for reload reasons.
 */

type ResolveFilename = (
  request: string,
  parent: NodeModule | null | undefined,
  isMain: boolean,
  options?: unknown,
) => string;

type ModuleInternals = {
  _resolveFilename: ResolveFilename;
  _nodeModulePaths(dir: string): string[];
};

type ModuleCtor = new (id: string, parent: NodeModule | null) => NodeModule;

/**
 * The process's REAL `Module` — the object whose `_resolveFilename` every
 * `require()` actually calls. Under plain Node that is what `node:module`
 * exports. Under Jest it is not: Jest hands sandboxed code a `class Module
 * extends RealModule {}` with the statics COPIED onto the subclass, so
 * patching what was imported would patch the copy and leave Node's resolver
 * untouched. The real one is the copy's prototype — walk up while the parent
 * still carries its own `_resolveFilename`. Under plain Node the walk stops
 * immediately (`Function.prototype` has none).
 */
function realNodeModule(): typeof Module {
  let m: unknown = Module;
  for (;;) {
    const parent = Object.getPrototypeOf(m) as unknown;
    if (
      typeof parent !== "function" ||
      !Object.prototype.hasOwnProperty.call(parent, "_resolveFilename")
    ) {
      return m as typeof Module;
    }
    m = parent;
  }
}

/** Test seam: the real Node `Module` (see {@link realNodeModule}). */
export function __realNodeModuleForTests(): typeof Module {
  return realNodeModule();
}

type HookState = {
  installed: boolean;
  original: ResolveFilename | null;
  /** Realpath'd repo roots, each with a trailing separator. */
  roots: Set<string>;
  /** parent filename → realpath (bounded; see `originatesUnderRegisteredRoot`). */
  realpathCache: Map<string, string>;
};

const STATE_KEY = Symbol.for("m0saic.platform.hostFirstResolution");
const HOST_SCOPE_REQUEST = /^@m0saic\/[^/\\]+(?:\/.*)?$/;
const REALPATH_CACHE_LIMIT = 4096;

/**
 * Where the HOST's `@m0saic/*` packages are looked up from: this file's own
 * directory (`dist/cjs/template-repos` in a built install, `src/template-repos`
 * under ts-jest). In a pure-ESM embedding `__dirname` does not exist; the
 * hook then has no host anchor and fails CLOSED for repo-originated
 * `@m0saic/*` requests rather than falling back to the checkout.
 */
const HOST_ANCHOR_DIR: string | null =
  typeof __dirname === "string" ? __dirname : null;

function state(): HookState {
  const g = globalThis as unknown as Record<symbol, HookState | undefined>;
  let s = g[STATE_KEY];
  if (!s) {
    s = { installed: false, original: null, roots: new Set(), realpathCache: new Map() };
    g[STATE_KEY] = s;
  }
  return s;
}

function withSep(p: string): string {
  return p.endsWith(path.sep) ? p : p + path.sep;
}

/** Is `request` a bare `@m0saic/<pkg>` or `@m0saic/<pkg>/<subpath>` specifier? */
export function isHostScopedRequest(request: string): boolean {
  return HOST_SCOPE_REQUEST.test(request);
}

/** The registered roots (realpath'd, trailing separator) — for tests and diagnostics. */
export function registeredHostFirstRepoRoots(): string[] {
  return [...state().roots];
}

/**
 * Does `filename` (the requesting module's file) live under a registered
 * repo root? Raw prefix first; on a miss, the realpath (cached) — Node's
 * CommonJS filenames are already real paths by default, so the fast path
 * almost always decides.
 */
export function originatesUnderRegisteredRoot(filename: string): boolean {
  const s = state();
  if (s.roots.size === 0) return false;
  const under = (f: string): boolean => {
    for (const root of s.roots) if (f.startsWith(root)) return true;
    return false;
  };
  if (under(filename)) return true;
  let real = s.realpathCache.get(filename);
  if (real === undefined) {
    try {
      real = fs.realpathSync(filename);
    } catch {
      real = filename;
    }
    if (s.realpathCache.size >= REALPATH_CACHE_LIMIT) s.realpathCache.clear();
    s.realpathCache.set(filename, real);
  }
  return real !== filename && under(real);
}

/** A fake parent module anchored in the host — the `paths` Node walks are the host's. */
function hostParent(): NodeModule {
  if (HOST_ANCHOR_DIR === null) {
    throw new Error(
      "host-first resolution: no CommonJS host anchor (pure-ESM embedding) — " +
        "cannot resolve @m0saic/* for an external template repo",
    );
  }
  const real = realNodeModule();
  const internals = real as unknown as ModuleInternals;
  const anchorFile = path.join(HOST_ANCHOR_DIR, "__m0saic_host_anchor__.js");
  const parent = new (real as unknown as ModuleCtor)(anchorFile, null);
  parent.filename = anchorFile;
  parent.paths = internals._nodeModulePaths(HOST_ANCHOR_DIR);
  return parent;
}

/**
 * Resolve a host-scoped request from the host. Exported so a caller can ask
 * "what would the host give this repo?" without going through `require`.
 */
export function resolveFromHost(request: string): string {
  const s = state();
  const real = realNodeModule();
  const resolve = s.original ?? (real as unknown as ModuleInternals)._resolveFilename;
  return resolve.call(real, request, hostParent(), false, undefined);
}

function hookedResolveFilename(
  this: unknown,
  request: string,
  parent: NodeModule | null | undefined,
  isMain: boolean,
  options?: unknown,
): string {
  const s = state();
  const original = s.original as ResolveFilename;
  if (
    isHostScopedRequest(request) &&
    parent &&
    typeof parent.filename === "string" &&
    originatesUnderRegisteredRoot(parent.filename)
  ) {
    return resolveFromHost(request);
  }
  return original.call(realNodeModule(), request, parent, isMain, options);
}

/** Install the resolver wrapper. Idempotent — a second call is a no-op. */
export function installHostFirstResolution(): void {
  const s = state();
  if (s.installed) return;
  const internals = realNodeModule() as unknown as ModuleInternals;
  s.original = internals._resolveFilename;
  internals._resolveFilename = hookedResolveFilename as ResolveFilename;
  s.installed = true;
}

/**
 * Register a repo root so `@m0saic/*` requests from files under it resolve
 * host-first. Installs the hook on first use. The root stays registered for
 * the life of the process: template code `require()`s lazily at render
 * time, long after the loader returned.
 */
export function registerHostFirstRepoRoot(repoRoot: string): void {
  const s = state();
  const resolved = path.resolve(repoRoot);
  s.roots.add(withSep(resolved));
  try {
    s.roots.add(withSep(fs.realpathSync(resolved)));
  } catch {
    /* not on disk (yet) — the literal path still applies */
  }
  s.realpathCache.clear();
  installHostFirstResolution();
}

/** Test seam: forget every root and restore the original resolver. */
export function __resetHostFirstResolutionForTests(): void {
  const s = state();
  s.roots.clear();
  s.realpathCache.clear();
  if (s.installed && s.original) {
    (realNodeModule() as unknown as ModuleInternals)._resolveFilename = s.original;
  }
  s.installed = false;
  s.original = null;
}
