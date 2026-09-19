import type { MosaicTemplate, MosaicTemplateProps } from "@m0saic/types";
import { defineMosaicTemplate } from "./defineMosaicTemplate";
import { processRegistry } from "../processRegistry";
import type { TemplateOrigin } from "./templateOriginScope";
import {
  FIRST_PARTY_TEMPLATE_ORIGIN,
  currentTemplateOrigin,
  templateRegistrationState,
} from "./templateOriginScope";

export type AnyMosaicTemplate = MosaicTemplate<MosaicTemplateProps>;

// Process-global, not module-local: the desktop app's template hot reload
// re-instantiates this module from fresh dist, and callers that captured
// `requireTemplate` before the reload must still see the registered set.
// See `../processRegistry`.
const templateRegistry = processRegistry<string, AnyMosaicTemplate>("templates");

// ── Slug-hijack protection ───────────────────────────────────────────
//
// Registration is `Map.set`, so without a policy the LAST writer of an id
// wins — and external repos always load AFTER the built-in packs. A repo
// that exports a template with id `@m0saic/charts/bars/v1` would silently
// replace m0saic's own template under m0saic's own name, and every later
// `requireTemplate("@m0saic/charts/bars/v1")` — a saved `.mosaic`, a cron
// render, the Make page — would run the impostor's code instead.
//
// The policy below closes that: the `@m0saic/` namespace is RESERVED, and an
// id already claimed by one registrant can't be taken by another.
//
// Scope, stated honestly: this is an INTEGRITY boundary, not a sandbox.
// Loading an external repo executes its entry module in-process, and code
// running in-process can always reach around any in-process guard. What this
// stops is the supported registration path being used to masquerade as
// first-party — which is both the realistic hijack and the accidental
// collision. The actual security boundary is consent before load
// (`templateTrust` in the desktop app, the `--template-repo` warning in the
// CLI) plus the provenance the UI shows.

/** Who registered an id — defined in templateOriginScope (shared with
 *  `defineMosaicTemplate`, which reads the scope to pick its convention
 *  posture); re-exported here so the public surface is unchanged. */
export type { TemplateOrigin };

/**
 * Id prefixes only first-party packs may register under.
 *
 * Reserving the whole PREFIX (rather than just the ids currently registered)
 * is deliberate: an id like `@m0saic/charts/not-shipped-yet/v1` is unoccupied
 * today, but it reads as official to a user, and squatting it would poison the
 * slug before m0saic ever ships it.
 *
 * Confusable ids (`@m0saic-extras/…`, unicode lookalikes) are NOT covered —
 * they are a display problem, answered by the provenance badge and the
 * third-party warning, not by a prefix match.
 *
 * `@m0saic-dev/` is the founder's publisher in the official community repo.
 * External repos may register under it ONLY when the host opened the origin
 * scope with a matching `trustedNamespaces` entry (the pinned community
 * repo) — see {@link withExternalTemplateOrigin}.
 *
 * `@m0saic-community/` is the community repo's own handle. It carries exactly
 * one id — the front door `@m0saic-community/hello-world/v1`, the repo's
 * greeting rather than any contributor's template — and the pinned repo
 * reaches it through the same `trustedNamespaces` grant as `@m0saic-dev/`.
 *
 * Until 2026-09-18 nothing published under it at all, which made this
 * reservation vacuous and therefore incapable of being wrong. It is load-
 * bearing now: all three protected namespaces (@m0saic, @m0saic-dev,
 * @m0saic-community) are the ones the UI gives official flair to, so what
 * keeps the grant honest is the ed25519 release signature the host verifies
 * BEFORE opening the scope — never a repo's claim about its own identity.
 */
export const RESERVED_TEMPLATE_ID_PREFIXES = [
  "@m0saic/",
  "@m0saic-dev/",
  "@m0saic-community/",
] as const;

export type TemplateRegistrationRejectionCode =
  /** External repo tried to register inside the reserved `@m0saic/` namespace. */
  | "TEMPLATE_ID_RESERVED_NAMESPACE"
  /** External repo tried to overwrite an id a first-party pack registered. */
  | "TEMPLATE_ID_OWNED_BY_FIRST_PARTY"
  /** External repo tried to overwrite an id another external source registered. */
  | "TEMPLATE_ID_OWNED_BY_OTHER_SOURCE";

export type TemplateRegistrationRejection = {
  code: TemplateRegistrationRejectionCode;
  /** The id that was refused. */
  id: string;
  /** The external source that attempted the registration. */
  attemptedBy: string;
  /** Who holds the id, when it is already held. */
  ownedBy?: TemplateOrigin;
  message: string;
};

export type TemplateRegistrationResult =
  | { ok: true; id: string }
  | { ok: false; rejection: TemplateRegistrationRejection };

// ── First-party duplicate registration ───────────────────────────────
//
// The external screen above stops an OUTSIDE source from taking a first-party
// id. It said nothing about two FIRST-PARTY files claiming one id — and
// `Map.set` meant the last one imported won. That is a freeze bypass (adversary
// 2026-09-17): a brand-new file (not in frozen.manifest.json, so never hashed)
// imported from an unfrozen pack barrel registers a shipped id with different
// defaults, and every `requireTemplate("<shipped id>")` now runs the new code
// while the frozen original sits byte-identical and green. Same trick with the
// barrel alone: repoint which file registers the id. Closing it: a first-party
// registration of an id already held by first-party THROWS — the build fails
// naming both files. The one legitimate re-registration, the desktop's
// template hot reload (evict require.cache, re-require the pack, which re-runs
// every registerTemplate into the process-global map), opts in explicitly with
// {@link withTemplateReloadScope}.

/** Thrown (never recorded) when first-party code registers an id twice. */
export class TemplateRegistrationError extends Error {
  readonly code = "TEMPLATE_ID_ALREADY_REGISTERED" as const;
  readonly id: string;
  /** Module that holds the id, when provenance was captured. */
  readonly registeredFrom: string | undefined;
  /** Module that tried to take it, when provenance was captured. */
  readonly attemptedFrom: string | undefined;
  constructor(id: string, registeredFrom: string | undefined, attemptedFrom: string | undefined) {
    super(
      `Refused to register "${id}": that id is already registered by first-party ` +
        `${registeredFrom ?? "(unknown file)"}; the second registration came from ` +
        `${attemptedFrom ?? "(unknown file)"}. A shipped id has exactly one registering ` +
        `file — to change behaviour, register a NEW id (vN+1). A hot reload must wrap the ` +
        `re-require in withTemplateReloadScope().`,
    );
    this.name = "TemplateRegistrationError";
    this.id = id;
    this.registeredFrom = registeredFrom;
    this.attemptedFrom = attemptedFrom;
  }
}

/** Registration provenance for one id — additive read surface. */
export type TemplateMeta = {
  id: string;
  origin: TemplateOrigin;
  /**
   * The module that called `registerTemplate`: repo-relative (`packages/…`)
   * when the path sits in a `packages/<name>/(src|dist)/` tree, else absolute.
   * `undefined` when no usable stack frame was available (a browser bundle).
   */
  registeredFrom: string | undefined;
};

/** id → who registered it. Same process-global store as the registry itself,
 *  so ownership survives a hot reload exactly like the templates do. */
const templateOrigins = processRegistry<string, TemplateOrigin>(
  "templateOrigins",
);

/** id → module path that registered it (see {@link TemplateMeta.registeredFrom}). */
const templateRegisteredFrom = processRegistry<string, string>(
  "templateRegisteredFrom",
);

/** Ambient registration state: the origin currently in scope, and rejections
 *  recorded since the last drain. Process-global for the same reason, and
 *  shared with `defineMosaicTemplate` via templateOriginScope. */
const registrationState = templateRegistrationState;
const FIRST_PARTY = FIRST_PARTY_TEMPLATE_ORIGIN;
const currentOrigin = currentTemplateOrigin;

function rejectionLog(): TemplateRegistrationRejection[] {
  let log = registrationState.get("rejections") as
    | TemplateRegistrationRejection[]
    | undefined;
  if (!log) {
    log = [];
    registrationState.set("rejections", log);
  }
  return log;
}

/** Is this id inside a namespace only first-party packs may register under? */
export function isReservedTemplateId(id: string): boolean {
  const lower = String(id ?? "").toLowerCase();
  return RESERVED_TEMPLATE_ID_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function describeOwner(owner: TemplateOrigin): string {
  return owner.kind === "first-party"
    ? "m0saic (first-party)"
    : `external repo ${owner.source}`;
}

/** Does `id` fall inside one of the origin's host-granted trusted prefixes? */
function isTrustedNamespaceId(
  id: string,
  trustedNamespaces: readonly string[] | undefined,
): boolean {
  if (!trustedNamespaces?.length) return false;
  const lower = String(id ?? "").toLowerCase();
  return trustedNamespaces.some((prefix) => lower.startsWith(prefix.toLowerCase()));
}

/**
 * Decide whether an external registration of `id` is allowed. Returns the
 * rejection to record, or null when the registration may proceed.
 */
function screenExternalRegistration(
  id: string,
  source: string,
  trustedNamespaces?: readonly string[],
): TemplateRegistrationRejection | null {
  if (isReservedTemplateId(id) && !isTrustedNamespaceId(id, trustedNamespaces)) {
    return {
      code: "TEMPLATE_ID_RESERVED_NAMESPACE",
      id,
      attemptedBy: source,
      message:
        `Refused to register "${id}" from external repo ${source}: the ` +
        `"${RESERVED_TEMPLATE_ID_PREFIXES.join('", "')}" namespace is reserved for ` +
        `templates shipped by m0saic. An external repo registering an official-looking ` +
        `id would run its own code under m0saic's name. Rename the template to your ` +
        `own namespace (e.g. "@your-repo/${id.split("/").slice(1).join("/") || "template/v1"}").`,
    };
  }

  // An id present with no recorded origin predates origin tracking (or was
  // written around it). Treat it as first-party — unknown ownership is never
  // a reason to hand the slug to an external repo.
  const owner =
    templateOrigins.get(id) ??
    (templateRegistry.has(id) ? FIRST_PARTY : undefined);
  if (!owner) return null;

  if (owner.kind === "first-party") {
    return {
      code: "TEMPLATE_ID_OWNED_BY_FIRST_PARTY",
      id,
      attemptedBy: source,
      ownedBy: owner,
      message:
        `Refused to register "${id}" from external repo ${source}: that id is ` +
        `already registered by ${describeOwner(owner)}. The existing template is ` +
        `kept. Rename the template to your own namespace.`,
    };
  }

  // Same source re-registering its own id is the rebuild → refresh loop, and
  // must keep working.
  if (owner.source === source) return null;

  return {
    code: "TEMPLATE_ID_OWNED_BY_OTHER_SOURCE",
    id,
    attemptedBy: source,
    ownedBy: owner,
    message:
      `Refused to register "${id}" from external repo ${source}: that id is ` +
      `already registered by ${describeOwner(owner)}. Two external repos claiming ` +
      `one id is a collision, and the first registrant keeps it — remove one of the ` +
      `sources (a removed source frees its ids on the next restart) or ask the ` +
      `author to rename.`,
  };
}

/* ── registration provenance ──────────────────────────────────────────── */

/** File named by one V8 stack frame, or undefined for a frame without one. */
function frameFile(line: string): string | undefined {
  // `    at fn (/abs/file.js:1:2)`  |  `    at /abs/file.js:1:2`  |  `at async fn (file:///…:1:2)`
  const m = /\((.+?):\d+:\d+\)\s*$/.exec(line) ?? /\bat\s+(?:async\s+)?(.+?):\d+:\d+\s*$/.exec(line);
  if (!m) return undefined;
  let file = m[1]!;
  if (file.startsWith("file://")) {
    try { file = decodeURIComponent(file.slice("file://".length)); } catch { /* keep raw */ }
  }
  if (file.startsWith("node:") || file === "<anonymous>") return undefined;
  return file;
}

/** This module's own file (first frame at load) — the frames to skip when
 *  looking for the caller. Undefined inside a bundle without frame files. */
const OWN_FILE: string | undefined = (() => {
  const first = (new Error().stack ?? "").split("\n").slice(1).map(frameFile).find(Boolean);
  return first ?? undefined;
})();

/**
 * Relativize a registering file to the repo root. No `fs` here (this barrel
 * is walked by the web bundle), so the root is recognised structurally: the
 * directory holding `packages/<name>/(src|dist)/…`. Anything else (a vendored
 * install under node_modules, an external repo) stays absolute.
 */
export function repoRelativeRegistrationPath(file: string): string {
  const parts = file.split(/[\\/]+/);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === "packages" && i + 2 < parts.length && (parts[i + 2] === "src" || parts[i + 2] === "dist")) {
      return parts.slice(i).join("/");
    }
  }
  return file;
}

/** The first stack frame outside this module: whoever called registerTemplate. */
function captureRegisteredFrom(): string | undefined {
  const stack = new Error().stack;
  if (!stack) return undefined;
  for (const line of stack.split("\n").slice(1)) {
    const file = frameFile(line);
    if (!file || file === OWN_FILE) continue;
    return repoRelativeRegistrationPath(file);
  }
  return undefined;
}

function reloadScopeOpen(): boolean {
  return registrationState.get("allowReplace") === true;
}

// ── Immutable registrations ──────────────────────────────────────────
//
// The duplicate-id guard above stops a second REGISTRATION of a shipped id.
// It said nothing about the first one being edited in place: `Map.get` hands
// out the live object, so an unfrozen file (or the unfrozen pack barrel) could
// run `getTemplate("<shipped id>").render = (p, c) => orig({...p, accent},
// c)` after registration — freeze 343 unchanged, pins held, gate exit 0,
// rendered document changed (adversary 2026-09-17, bypass 3). Closing it: the
// wrapped template is DEEP-FROZEN before it enters the map. Compiled TS emits
// "use strict", so the assignment above is a TypeError naming the property at
// the impostor's import time — the build fails, not the render.
//
// Scope: own enumerable data properties, recursively, over PLAIN objects and
// arrays only (the template, propsSchema, defaultProps, outputHints, lattice,
// deprecated, tags, …). Functions are left as they are (the slot that holds
// them is what goes read-only; freezing `render` itself would also pin its
// `prototype`, which nothing needs), and so is any class instance or exotic
// object (Map, Set, Buffer, Date) a template might carry — the engine may
// own those. Nothing in template-utils, the doctor or the conventions writes
// onto a registered template (findings live in their own process-global
// list), so no side-table is needed; the freeze is purely a lock.
//
// A hot reload REPLACES the map entry (`withTemplateReloadScope`) — a fresh
// object for the id, which is not a mutation of the frozen one.

/** Plain data object: `{}`-literal shaped (Object.prototype or null proto). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep-freeze a template definition (see "Immutable registrations" above).
 * Returns the same object. Idempotent; cycle-safe; a frozen subtree is not
 * re-walked. Exported for the registry tests and for hosts that hand a
 * template around without registering it.
 */
export function deepFreezeTemplate<T>(value: T): T {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== "object") return;
    if (!Array.isArray(v) && !isPlainObject(v)) return; // class instance / exotic — the engine may own it
    if (seen.has(v)) return;
    seen.add(v);
    for (const key of Object.keys(v)) {
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (d && "value" in d) walk(d.value); // data properties only — never invoke a getter
    }
    Object.freeze(v);
  };
  walk(value);
  return value;
}

/**
 * Register a template under its id.
 *
 * Generic in P so you can pass MosaicTemplate<CalendarProps> etc.
 *
 * IMPORTANT:
 * We wrap via defineMosaicTemplate() here so ALL registry-loaded templates
 * automatically enforce engine timing invariants (stamping + assertions),
 * including nested templates.
 *
 * Registrations are attributed to the ambient origin — first-party unless the
 * call happens inside {@link withExternalTemplateOrigin}. External
 * registrations are screened against the reserved namespace and existing
 * ownership; a refused one is RECORDED (drain it with
 * {@link drainTemplateRegistrationRejections}) and returned, never thrown, so
 * one bad template in a repo can't abort the rest of the load.
 *
 * A FIRST-PARTY registration of an id first-party already holds THROWS
 * {@link TemplateRegistrationError} (`TEMPLATE_ID_ALREADY_REGISTERED`), naming
 * both registering files — unless the call sits inside
 * {@link withTemplateReloadScope}. First-party may still reclaim an id an
 * external repo holds (the safe direction; a hot reload after an external
 * load relies on it).
 *
 * Every registration records the calling module as provenance — read it with
 * {@link getTemplateMeta}. The freeze gate pins it: a shipped id must keep
 * registering from the file that shipped it.
 *
 * The registered object is DEEP-FROZEN (first-party and external alike —
 * see {@link deepFreezeTemplate}): `getTemplate` / `requireTemplate` return
 * that same frozen object, so `getTemplate(id).render = …` or
 * `getTemplate(id).defaultProps.x = …` throws a TypeError under strict mode
 * instead of silently changing what a shipped id renders.
 */
export function registerTemplate<P extends MosaicTemplateProps>(
  template: MosaicTemplate<P>
): TemplateRegistrationResult {
  const origin = currentOrigin();
  const id = String(template?.id ?? "");

  // Screen BEFORE defineMosaicTemplate: a refused registration should not run
  // the wrapper machinery over an untrusted template at all.
  if (origin.kind === "external") {
    const rejection = screenExternalRegistration(
      id,
      origin.source,
      origin.trustedNamespaces,
    );
    if (rejection) {
      rejectionLog().push(rejection);
      return { ok: false, rejection };
    }
  }

  const registeredFrom = captureRegisteredFrom();

  if (origin.kind === "first-party" && templateRegistry.has(id) && !reloadScopeOpen()) {
    // An id with no recorded origin predates origin tracking — first-party.
    const owner = templateOrigins.get(id) ?? FIRST_PARTY;
    if (owner.kind === "first-party") {
      throw new TemplateRegistrationError(id, templateRegisteredFrom.get(id), registeredFrom);
    }
  }

  // Conventions fire inside defineMosaicTemplate, which reads the same
  // ambient origin: first-party violations THROW at registration; an external
  // repo's are recorded (a bad template never aborts the rest of the load).
  const wrapped = deepFreezeTemplate(defineMosaicTemplate(template));
  templateRegistry.set(
    wrapped.id,
    wrapped as AnyMosaicTemplate // erase P into the registry
  );
  templateOrigins.set(wrapped.id, origin);
  if (registeredFrom === undefined) templateRegisteredFrom.delete(wrapped.id);
  else templateRegisteredFrom.set(wrapped.id, registeredFrom);
  return { ok: true, id: wrapped.id };
}

/**
 * Run `fn` with first-party RE-registration allowed: inside it, registering
 * an id first-party already holds replaces the entry (and its provenance)
 * instead of throwing.
 *
 * ONLY for the desktop's template hot reload (`apps/mosaic/electron/
 * templateHotReload.js`): it evicts the template stack from `require.cache`
 * and re-requires `@m0saic/templates`, which re-runs every module-scope
 * `registerTemplate` against the process-global registry. Nothing else has a
 * reason to register a shipped id twice — a build, a test, or a pack that
 * does is the bypass the throw exists to catch, so do not reach for this to
 * silence one. The flag lives in the process-global registration state, so
 * the freshly re-instantiated copy of this module reads it too. Sync and
 * async `fn` both close the scope when they settle; like the origin scope it
 * is ambient, so keep reloads sequential.
 */
export function withTemplateReloadScope<T>(fn: () => T): T {
  const previous = registrationState.get("allowReplace");
  const restore = () => {
    if (previous === undefined) registrationState.delete("allowReplace");
    else registrationState.set("allowReplace", previous);
  };
  registrationState.set("allowReplace", true);
  let result: T;
  try {
    result = fn();
  } catch (err) {
    restore();
    throw err;
  }
  if (isThenable(result)) {
    return (result as Promise<unknown>).then(
      (value) => { restore(); return value; },
      (err) => { restore(); throw err; },
    ) as unknown as T;
  }
  restore();
  return result;
}

function isThenable(v: unknown): v is Promise<unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { then?: unknown }).then === "function"
  );
}

/**
 * Run `fn` with every `registerTemplate` call inside it attributed to an
 * external repo `source`.
 *
 * Hosts MUST wrap both halves of loading an external repo:
 *
 *   1. the import itself — a repo's entry module can call `registerTemplate`
 *      from its own top-level body, which never passes through the host's
 *      registration loop; and
 *   2. the host's own loop over the repo's exported `templates`.
 *
 * Async `fn` is supported (the scope closes when the returned promise
 * settles), but the scope is AMBIENT, not per-call: while one is open, an
 * unrelated registration elsewhere would be attributed to `source` too. Every
 * host loads repos sequentially, which is what makes that safe — keep it that
 * way rather than loading repos concurrently.
 *
 * `opts.trustedNamespaces` lets the HOST grant this source specific reserved
 * prefixes (e.g. `["@m0saic-dev/"]` for the pinned official community repo).
 * Grant it only to sources the host itself controls — never because a repo's
 * own descriptor asked for it.
 */
export function withExternalTemplateOrigin<T>(
  source: string,
  fn: () => T,
  opts?: { trustedNamespaces?: readonly string[] },
): T {
  const previous = registrationState.get("origin");
  const restore = () => {
    if (previous === undefined) registrationState.delete("origin");
    else registrationState.set("origin", previous);
  };

  const origin: TemplateOrigin = opts?.trustedNamespaces?.length
    ? { kind: "external", source, trustedNamespaces: opts.trustedNamespaces }
    : { kind: "external", source };
  registrationState.set("origin", origin);

  let result: T;
  try {
    result = fn();
  } catch (err) {
    restore();
    throw err;
  }

  if (isThenable(result)) {
    return (result as Promise<unknown>).then(
      (value) => {
        restore();
        return value;
      },
      (err) => {
        restore();
        throw err;
      },
    ) as unknown as T;
  }

  restore();
  return result;
}

/** Who registered this id, or undefined if it isn't registered. */
export function getTemplateOrigin(id: string): TemplateOrigin | undefined {
  return templateOrigins.get(id);
}

/**
 * Registration provenance for an id: who registered it and from which module.
 * Undefined when the id is not registered. An id with no recorded origin
 * (registered before origin tracking) reads as first-party.
 */
export function getTemplateMeta(id: string): TemplateMeta | undefined {
  if (!templateRegistry.has(id)) return undefined;
  return {
    id,
    origin: templateOrigins.get(id) ?? FIRST_PARTY,
    registeredFrom: templateRegisteredFrom.get(id),
  };
}

/**
 * Take every registration refused since the last drain, and clear the log.
 *
 * Draining rather than reading is deliberate: rejections have to reach the
 * user (a CLI error, an app warning), and a log nobody empties would re-report
 * the same hijack on every subsequent repo refresh.
 */
export function drainTemplateRegistrationRejections(): TemplateRegistrationRejection[] {
  const log = rejectionLog();
  const drained = log.slice();
  log.length = 0;
  return drained;
}

/**
 * Get a template by id. Returns undefined if not registered.
 *
 * Generic in P so callers can tell TS what props shape they expect. The
 * object is the registered one — deep-frozen; copy before you change it.
 */
export function getTemplate<P extends MosaicTemplateProps = MosaicTemplateProps>(
  id: string
): MosaicTemplate<P> | undefined {
  return templateRegistry.get(id) as MosaicTemplate<P> | undefined;
}

/**
 * Require a template by id. Throws if not found.
 *
 * This is the one your code is trying to import.
 */
export function requireTemplate<
  P extends MosaicTemplateProps = MosaicTemplateProps
>(id: string): MosaicTemplate<P> {
  const tmpl = getTemplate<P>(id);
  if (!tmpl) {
    throw new Error(`Template with id "${id}" is not registered`);
  }
  return tmpl;
}

export function listRegisteredTemplateIds(): string[] {
  return Array.from(templateRegistry.keys()).sort();
}

/**
 * Clear the registry, its ownership records, and the ambient registration
 * state. TEST-ONLY — production never wants this (a hot reload deliberately
 * preserves the store).
 *
 * `__resetProcessRegistriesForTests` does NOT cover this module: it clears the
 * outer store, so the next `processRegistry()` call mints fresh maps — but this
 * module captured its map references at load time and keeps reading the old
 * ones. Clearing in place is what actually resets what this module sees.
 */
export function __resetTemplateRegistryForTests(): void {
  templateRegistry.clear();
  templateOrigins.clear();
  templateRegisteredFrom.clear();
  registrationState.clear();
}
