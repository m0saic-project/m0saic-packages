/**
 * ============================================================================
 * FREEZE GATE — every template shipped in m0saic 0.2.0 is immutable
 * ============================================================================
 *
 * `packages/templates` was cut for 0.2.0 on 2026-09-17 (release/0.2.0 = dev;
 * the manifest was minted at the cut, founder ruling: hard lock at the cut,
 * not at the tag — `tag` reads `v0.2.0 (pending …)` until npm publish). Someone
 * out there holds the bytes: a shared `/make?t=…` link, a committed `.mosaic`,
 * a rendered deliverable. A frozen template must not change meaning under
 * them. Contract: the agent contract §10. (0.1.0 was withdrawn on 2026-09-14.)
 *
 * THE RULE. Comments only. Any behavioural change requires a new `vN+1/`
 * folder beside the old one. Brand-new templates are not frozen at all —
 * freedom is the default, the freeze is earned by shipping.
 *
 * ⭐ WHY `_shared/` IS IN SCOPE. Dozens of template files import from one of
 * the eight `_shared/` directories. One edit to `alpine/_shared/alpine-theme.ts`
 * moves every alpine template without touching a single `vN/` file, so a
 * freeze that covered only version folders would be theatre. Shared helpers
 * are frozen on the same terms; to change one, copy it into the new version's
 * folder.
 *
 * ⭐ WHY THE FROZEN SET IS AN IMPORT CLOSURE. The same argument applies to a
 * helper that happens to live OUTSIDE a `vN/` or `_shared/` folder — a pack's
 * `utils/`, `internal/`, or a module at the pack root. At the 0.2.0 cut seven
 * such files shaped shipped output (two of them even REGISTER shipped web
 * ids), unfrozen. So {@link collectFrozenFiles} seeds the set with the
 * `vN/` + `_shared/` rule and then follows every relative import (`./`, `../`)
 * from a frozen file to any non-test `.ts` under `src/`, transitively. What a
 * frozen template can reach is frozen. Pack barrels stay out — nothing frozen
 * imports them — so a new template can still register itself.
 *
 * ⭐ WHY THE HASH KEEPS NEWLINES (hash v2). Automatic semicolon insertion
 * makes a line break a TOKEN in JavaScript: `return path;` and
 * `return\n    path;` are different programs (the second returns undefined).
 * Hash v1 collapsed EVERY whitespace run — newlines included — to one space,
 * so that edit to a frozen `_shared` helper hashed identically and slipped
 * through (adversary 2026-09-17). v2 keeps a newline where the source had
 * one, collapses horizontal whitespace, trims each line and folds blank lines:
 * re-indentation and blank-line churn still hash alike; moving a token to the
 * next line does not. The LINE TERMINATORS are the spec's four — LF, CR, and
 * the Unicode LS (U+2028) / PS (U+2029): each ends a `//` comment, makes a
 * block comment span lines, and is a line break for ASI, so the scanner treats
 * them exactly like `\n` (a `// …<U+2028>evil()` would otherwise hash as a
 * comment while Node executes `evil()`). `FREEZE_HASH_VERSION` rides in the
 * manifest so a manifest minted under one hasher is refused by another
 * OUTRIGHT rather than reported as "everything changed".
 *
 * ⭐ WHY THE MANIFEST ALSO PINS THE REGISTRY. Hashing frozen FILES cannot see
 * a NEW file (not in the manifest) registering a shipped id with different
 * defaults, or a pack barrel repointed at a different registering module
 * while the original stays byte-identical. The registry now refuses a second
 * first-party registration of an id (TEMPLATE_ID_ALREADY_REGISTERED) and
 * records the registering module; the manifest's `registry` section pins,
 * per shipped id, that file and a hash of the definition fields that decide
 * shipped behaviour. check-registry Stage 0c holds the live registry to it.
 *
 * ⭐ WHY THE PIN ALSO COVERS THE RENDER BODY. The definition fields (defaults,
 * schema, hints, flags) decide what `/make?t=<id>` renders — but so does the
 * render function, and a registered template used to be mutable: an unfrozen
 * file could reassign `getTemplate("<shipped id>").render` after registration
 * with the file hash, the field pin and the gate all green (adversary
 * 2026-09-17, bypass 3). The registry now deep-freezes every registration,
 * and the pin covers the canonical source text (comments stripped, hash v2
 * form) of the COMPILED `render` / `renderLite` / `renderCover` /
 * `resolveOutputHints` — the dist functions the registry actually runs,
 * reached through the wrapper link `defineMosaicTemplate` leaves
 * (Symbol.for("m0saic.templateWrappedFrom")). Over compiled output,
 * deliberately: it is deterministic for a build, and it means a TypeScript /
 * tsconfig / template-utils change that alters the emitted body of a frozen
 * render legitimately moves the pin and REQUIRES a re-mint at a release — that
 * is the desired signal, not noise. Stage 0c says "redefined (render body)"
 * when only the function text moved.
 *
 * ⭐ WHY THE WEB REGISTRY IS PINNED TOO. Mosaic Web bundles `src/web.ts`, not
 * `src/index.ts`, and the two entries reach a template through different
 * import paths (pack barrels, cherry-picked slugs, one `.web.ts` stand-in).
 * A pin held only against the node registry would let a new unfrozen file
 * register a shipped `web: true` id on the WEB side with different defaults
 * — Stage 0 green (new file), 0b green (id still on web), 0c green (node
 * untouched) — and every `/make?t=` link the 0.2.0 CLI prints would render
 * something else. So a `web: true` pin is ALSO held against the registry the
 * browser entry builds (loaded in a fresh child process, exactly as
 * `gen-web-template-ids` does); where the web side legitimately differs from
 * node at mint (`brand/community-m/v1` registers from `community-m.web.ts`),
 * the pin records `webFile` / `webDefinitionSha256` beside the node values.
 *
 * ⭐ WHY THIS FILE HAS NO IMPORTS BEYOND NODE BUILTINS. `@m0saic/templates` is
 * vendored into the published `m0saic` tarball, and `verifyStagedRequires` in
 * scripts/build-publish-artifact.mjs scans every staged file for non-builtin
 * `require(` / `from "…"`. Reaching for the TypeScript compiler here — the
 * obvious way to strip comments — would put a `typescript` require inside the
 * artifact and fail publish:audit, the same gate that proves `sharp` cannot
 * reach it. Hence the hand-rolled scanner below.
 */

import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";

/** Committed at the package root; the diff IS the review of a freeze change. */
export const FREEZE_MANIFEST_FILE = "frozen.manifest.json";

/** Where frozen sources live, relative to the package root. */
export const FROZEN_SRC_ROOT = "src/m0saic";

/**
 * Version of the canonical form `hashSource` produces. Recorded in the
 * manifest at mint; `checkFreeze` refuses a manifest minted under a different
 * version instead of comparing hashes that cannot match. Bump it whenever the
 * canonical form changes (and re-mint at a release).
 *
 *   1 — comments stripped, every whitespace run (newlines too) → one space.
 *   2 — newlines preserved as tokens (ASI), horizontal runs → one space,
 *       lines trimmed, blank lines folded; LF / CR / U+2028 / U+2029 are all
 *       line terminators. Manifests without the field are v1.
 */
export const FREEZE_HASH_VERSION = 2;

/**
 * What the manifest pins about one registered id. `file` is the registering
 * module as a PACKAGE-relative source path (`src/m0saic/…/x.ts`, mapped back
 * from the dist module that actually ran); `definitionSha256` is
 * {@link definitionSha256} of the registered template (fields AND render
 * bodies); `fieldsSha256` is {@link definitionFieldsSha256} (fields only —
 * lets the gate say whether a moved pin was the data or the render body;
 * absent on pins minted before render bodies joined, whose `definitionSha256`
 * IS the fields-only hash); `web` marks ids the browser entry (`src/web.ts`)
 * registered at mint — the shipped CLI prints `app.m0saic.io/make?t=<id>`
 * links for those, so they may never leave web. `webFile` /
 * `webDefinitionSha256` / `webFieldsSha256` are present ONLY when the browser
 * entry registered the id from a different file or with a different
 * definition than the node entry did at mint (a `.web.ts` stand-in); absent,
 * the web side is held to the node values. Every pinned file (`file` and
 * `webFile`) is itself in `files` — a pin over an unhashed module is not a pin.
 */
export type FreezeRegistryPin = {
  file: string;
  definitionSha256: string;
  fieldsSha256?: string;
  web?: boolean;
  webFile?: string;
  webDefinitionSha256?: string;
  webFieldsSha256?: string;
};

export type FreezeManifest = {
  release: string;
  tag: string;
  commit: string;
  note: string;
  /** {@link FREEZE_HASH_VERSION} the `files` hashes were minted with. Absent = 1. */
  hashVersion?: number;
  /** repo-relative path → canonical hash */
  files: Record<string, string>;
  /** template id → registration pin. Absent on manifests minted before 0.2.0's pins. */
  registry?: Record<string, FreezeRegistryPin>;
};

export type FreezeReport = {
  ok: boolean;
  /**
   * Set when the manifest was minted under a different hasher. Nothing else in
   * the report is computed then: the hashes are incomparable, and "everything
   * changed" would be a lie. Re-mint at a release.
   */
  hashVersionMismatch?: { manifest: number; checker: number; message: string };
  unchanged: string[];
  /** Frozen files whose CODE changed — the violation this gate exists for. */
  changed: string[];
  /** Frozen files that no longer exist — removing shipped behaviour. */
  deleted: string[];
  /** Not in the manifest: new templates, free to change. */
  unfrozen: string[];
  /** Files the scanner could not confidently tokenize (hashed raw, strictly). */
  lowConfidence: string[];
};

/* ── canonical form ──────────────────────────────────────────────────────── */

/** ECMAScript LineTerminator: LF, CR, LS (U+2028), PS (U+2029). */
const LINE_TERMINATOR_RE = /[\n\r\u2028\u2029]/;
const isLineTerminator = (ch: string): boolean => ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029";

const REGEX_MAY_FOLLOW = new Set("(,=:[!&|?{};+-*%<>~^".split(""));
const REGEX_MAY_FOLLOW_WORDS = new Set([
  "return", "typeof", "case", "in", "of", "new", "delete", "void", "throw",
  "do", "else", "yield", "await",
]);

/**
 * Strip comments, leaving string and template-literal interiors byte-for-byte
 * intact.
 *
 * Whitespace BETWEEN tokens is collapsed, not removed — so `const a={x:1}`
 * and `const a = { x: 1 }` hash DIFFERENTLY. That is deliberate: the rule is
 * "comments only", and reformatting a frozen file is not a comment. Running a
 * formatter over frozen sources SHOULD trip this gate.
 *
 * Newlines are kept (hash v2): a run of whitespace that contains a line break
 * becomes exactly one `\n`, a run without one becomes one space, and a line
 * never starts or ends with a space. So indentation and blank lines are free
 * to change, while `return\n  path;` (which ASI reads as `return;`) hashes
 * differently from `return path;`. A block comment that spans lines counts as
 * a line break too — the spec treats it as a LineTerminator for ASI.
 *
 * "Line break" means every ECMAScript LineTerminator — LF, CR, U+2028 (LS)
 * and U+2029 (PS). The last two are invisible in most editors, and each one
 * ENDS a `//` comment and splits a block comment across lines for ASI, so a
 * scanner that only knew `\n` would hash `// c<U+2028>evil()` as a comment
 * while the engine runs `evil()`. Inside string and template literals they
 * are copied verbatim like every other character (a raw LS in a template
 * literal is a different value from a raw LF).
 *
 * Returns `confident: false` when the source ends inside a string, comment or
 * regex — i.e. the scanner lost its place. Callers MUST then fall back to
 * hashing the raw text: being over-strict (flagging a comment edit) is a safe
 * failure for a freeze; being under-strict (missing a code edit) is not.
 */
export function stripComments(src: string): { text: string; confident: boolean } {
  const out: string[] = [];
  // Last significant CODE character emitted — decides `/` = regex vs division.
  let lastCode = "";
  let lastWord = "";
  let i = 0;
  const n = src.length;

  // ⭐ Dedup spaces AS WE GO. A global `.replace(/ +/g," ")` at the end would
  // also collapse whitespace INSIDE string literals, so `"a  b"` and `"a b"`
  // would hash alike — a real behavioural change going undetected.
  // A space never follows a newline (lines are trimmed at the start) and a
  // newline pops a trailing space (trimmed at the end); two newlines never
  // meet (blank lines fold). Nothing precedes the first token either.
  const pushSpace = (): void => {
    const last = out[out.length - 1];
    if (out.length && last !== " " && last !== "\n") out.push(" ");
  };
  const pushNewline = (): void => {
    if (out[out.length - 1] === " ") out.pop();
    if (out.length && out[out.length - 1] !== "\n") out.push("\n");
  };
  const pushCode = (s: string): void => {
    out.push(s);
    const t = s.trim();
    if (t) { lastCode = t[t.length - 1]!; lastWord = /[A-Za-z_$]/.test(t[0]!) ? t : ""; }
  };

  while (i < n) {
    const c = src[i]!;
    const c2 = src[i + 1];

    // ── comments → one space, so `a/**/b` never becomes `ab` ──
    if (c === "/" && c2 === "/") {
      while (i < n && !isLineTerminator(src[i]!)) i++;
      pushSpace();
      continue;
    }
    if (c === "/" && c2 === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) return { text: src, confident: false }; // unterminated
      const spansLines = LINE_TERMINATOR_RE.test(src.slice(i + 2, end));
      i = end + 2;
      if (spansLines) pushNewline(); else pushSpace();
      continue;
    }

    // ── strings and template literals → verbatim ──
    if (c === '"' || c === "'" || c === "`") {
      const start = i;
      const quote = c;
      i++;
      let closed = false;
      while (i < n) {
        const d = src[i]!;
        if (d === "\\") { i += 2; continue; }
        if (quote === "`" && d === "$" && src[i + 1] === "{") {
          // Nested `${…}` can contain anything, including strings and braces.
          let depth = 1;
          i += 2;
          while (i < n && depth > 0) {
            const e = src[i]!;
            if (e === "{") depth++;
            else if (e === "}") depth--;
            else if (e === '"' || e === "'" || e === "`") {
              const q = e; i++;
              while (i < n && src[i] !== q) { if (src[i] === "\\") i++; i++; }
            }
            i++;
          }
          continue;
        }
        if (d === quote) { i++; closed = true; break; }
        i++;
      }
      if (!closed) return { text: src, confident: false };
      pushCode(src.slice(start, i));
      continue;
    }

    // ── regex literal vs division ──
    if (c === "/") {
      const regexOk =
        lastCode === "" || REGEX_MAY_FOLLOW.has(lastCode) || REGEX_MAY_FOLLOW_WORDS.has(lastWord);
      if (regexOk) {
        const start = i;
        i++;
        let inClass = false;
        let closed = false;
        while (i < n) {
          const d = src[i]!;
          if (d === "\\") { i += 2; continue; }
          if (isLineTerminator(d)) break; // regexes cannot span lines — it was division
          if (d === "[") inClass = true;
          else if (d === "]") inClass = false;
          else if (d === "/" && !inClass) { i++; closed = true; break; }
          i++;
        }
        if (!closed) return { text: src, confident: false };
        while (i < n && /[gimsuyd]/.test(src[i]!)) i++; // flags
        pushCode(src.slice(start, i));
        continue;
      }
      pushCode(c);
      i++;
      continue;
    }

    // ── whitespace → one newline if the run had a line break, else one space ──
    if (c === " " || c === "\t" || isLineTerminator(c)) {
      let sawNewline = false;
      while (i < n && (src[i] === " " || src[i] === "\t" || isLineTerminator(src[i]!))) { if (isLineTerminator(src[i]!)) sawNewline = true; i++; }
      if (sawNewline) pushNewline(); else pushSpace();
      continue;
    }

    // Whole identifiers in one push — otherwise `lastWord` only ever holds a
    // single character and `return /x+/` is misread as division.
    if (/[A-Za-z_$]/.test(c)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_$]/.test(src[i]!)) i++;
      pushCode(src.slice(start, i));
      continue;
    }

    pushCode(c);
    i++;
  }

  return { text: out.join("").trim(), confident: true };
}

/**
 * sha256 of the canonical (comment- and format-insensitive) form.
 *
 * ⭐ LINE ENDINGS ARE NORMALIZED FIRST. A Windows clone (core.autocrlf=true)
 * checks sources out as CRLF. `stripComments` collapses `\r` between tokens,
 * but copies template-literal interiors verbatim — so every multi-line template
 * literal would hash differently on Windows and trip the gate on untouched
 * files. Normalizing is not a loosening: JS itself turns CRLF/CR inside a
 * template literal into LF, so the two checkouts are the same program. Escaped
 * `\r` (a backslash in the source) is untouched and still hashes as code.
 */
export function hashSource(src: string): { hash: string; confident: boolean } {
  const { text, confident } = stripComments(src.replace(/\r\n?/g, "\n"));
  return { hash: createHash("sha256").update(text, "utf8").digest("hex"), confident };
}

/** The hasher version a manifest was minted with (absent field = v1). */
export function manifestHashVersion(manifest: Pick<FreezeManifest, "hashVersion">): number {
  return typeof manifest.hashVersion === "number" ? manifest.hashVersion : 1;
}

/**
 * One line for every gate to print when the versions differ. The fix depends
 * on the DIRECTION: a manifest OLDER than the checker needs a release re-mint;
 * a manifest NEWER than the checker means this clone's `dist/freeze.js` is a
 * stale build (branch switched, never rebuilt) — rebuild, never re-mint.
 */
export function describeHashVersionMismatch(manifestVersion: number): string {
  const head = `manifest minted with hash v${manifestVersion}, checker is v${FREEZE_HASH_VERSION} — the hashes are incomparable.`;
  if (manifestVersion > FREEZE_HASH_VERSION) {
    return `${head} The manifest is NEWER than this build of dist/freeze.js: rebuild the package ` +
      `(npm run build --workspace packages/templates); do NOT re-mint.`;
  }
  return `${head} Re-mint at a release (node tools/check-registry.mjs --update-freeze); ` +
    `this is never fixed by editing a frozen file.`;
}

/* ── registry pins ───────────────────────────────────────────────────────── */

/**
 * The template DATA fields whose values decide what a shipped id RENDERS at
 * its defaults and how a host treats it. Browse metadata (label, description,
 * tags, preview) is left out on purpose: it changes what a gallery shows, not
 * what `/make?t=<id>` produces — and it lives in the frozen file anyway. The
 * render functions are pinned beside these — see {@link RENDER_PIN_FIELDS}.
 */
export const DEFINITION_PIN_FIELDS = [
  "version", "capabilities", "role", "primitive", "internal", "deprecated",
  "aspectRatio", "outputHints", "lattice", "defaultFinalizeOpts", "skipAutoCompact",
  "propsSchema", "defaultProps", "outputsSchema", "upstreamVariablesSchema",
  "upstreamDataSchema", "sidecarsSchema", "defaultOutputs",
] as const;

/**
 * Deterministic JSON: object keys sorted at every depth, arrays in order,
 * `undefined` members dropped (like JSON.stringify), functions rendered as
 * "[Function]" (a schema's `validate` callback is code, and code is what the
 * FILE hash guards), non-finite numbers as null.
 */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (v === null || v === undefined) return v;
    if (typeof v === "function") return "[Function]";
    if (typeof v === "bigint") return `${v}n`;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : walk(x)));
    if (v instanceof Date) return v.toISOString();
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      const w = walk(o[k]);
      if (w !== undefined) out[k] = w;
    }
    return out;
  };
  return JSON.stringify(walk(value));
}

/**
 * The template functions whose COMPILED source text the pin covers — what a
 * shipped id actually runs, plus `resolveOutputHints`, which hosts call before
 * rendering to seed the canvas (width / height / fps / duration / format) from
 * the props. `renderTutorial` is left out: it is "?"-panel material, never a
 * `/make` output.
 */
export const RENDER_PIN_FIELDS = ["render", "renderLite", "renderCover", "resolveOutputHints"] as const;

/**
 * The link `defineMosaicTemplate` leaves on each wrapper function, pointing at
 * the function it wraps (`TEMPLATE_WRAPPED_FROM` in template-utils). Named by
 * `Symbol.for` so this file needs no import to follow it.
 */
export const TEMPLATE_WRAPPED_FROM_KEY = Symbol.for("m0saic.templateWrappedFrom");

/**
 * Canonical source text of a template function: the innermost function under
 * the wrapper chain, `toString()`-ed, in the hash-v2 canonical form (comments
 * stripped, horizontal whitespace collapsed, newlines kept) — so a comment-only
 * edit to a frozen file moves neither the file hash nor the pin. `undefined`
 * for a non-function (an absent `renderLite`).
 */
export function renderSourceText(fn: unknown): string | undefined {
  if (typeof fn !== "function") return undefined;
  let cur: Function = fn;
  const seen = new Set<Function>();
  for (;;) {
    const inner = (cur as unknown as Record<symbol, unknown>)[TEMPLATE_WRAPPED_FROM_KEY];
    if (typeof inner !== "function" || seen.has(inner)) break;
    seen.add(cur);
    cur = inner;
  }
  return stripComments(Function.prototype.toString.call(cur).replace(/\r\n?/g, "\n")).text;
}

function pickDefinitionFields(template: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const f of DEFINITION_PIN_FIELDS) picked[f] = template[f];
  return picked;
}

/** sha256 of the canonical JSON of a template's {@link DEFINITION_PIN_FIELDS} alone (no render bodies). */
export function definitionFieldsSha256(template: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(pickDefinitionFields(template)), "utf8").digest("hex");
}

/**
 * sha256 of the canonical JSON of a template's {@link DEFINITION_PIN_FIELDS}
 * plus the canonical source text of its {@link RENDER_PIN_FIELDS} — the
 * whole of what decides what a shipped id renders. See the header on why the
 * render bodies are pinned over COMPILED output.
 */
export function definitionSha256(template: Record<string, unknown>): string {
  const picked = pickDefinitionFields(template);
  for (const f of RENDER_PIN_FIELDS) picked[f] = renderSourceText(template[f]);
  return createHash("sha256").update(canonicalJson(picked), "utf8").digest("hex");
}

/**
 * Map a registering module (as `getTemplateMeta().registeredFrom` reports it:
 * repo-relative `packages/templates/dist/…/x.js`, or absolute) to the
 * package-relative SOURCE path the pin stores (`src/…/x.ts`). Anything not
 * under this package's dist/src is returned as given — it still pins.
 */
export function registeringSourcePath(packageRoot: string, registeredFrom: string): string {
  let rel = registeredFrom.split(path.sep).join("/");
  if (path.isAbsolute(registeredFrom)) rel = path.relative(packageRoot, registeredFrom).split(path.sep).join("/");
  else if (rel.startsWith("packages/templates/")) rel = rel.slice("packages/templates/".length);
  if (rel.startsWith("dist/") && rel.endsWith(".js")) rel = `src/${rel.slice("dist/".length, -".js".length)}.ts`;
  return rel;
}

/** One live registration, as check-registry gathers it from the registry.
 *  `fieldsSha256` (fields only) lets a moved pin be told apart: data or render body. */
export type LiveRegistration = { id: string; file: string; definitionSha256: string; fieldsSha256?: string };

/** Gather one live registration from a registered template and its registering source file. */
export function liveRegistrationOf(id: string, file: string, template: Record<string, unknown>): LiveRegistration {
  return { id, file, definitionSha256: definitionSha256(template), fieldsSha256: definitionFieldsSha256(template) };
}

/** Why a pinned id reads as redefined: its data fields moved, or only a render body did. */
export type RedefinedReason = "fields" | "render body";

export type RegistryPinReport = {
  ok: boolean;
  /** Pins the manifest carries. 0 → the manifest predates pins (nothing to hold). */
  pinned: number;
  held: string[];
  /** Pinned ids no longer registered at all. */
  missing: { id: string; file: string }[];
  /** Pinned ids now registered from a different file. */
  moved: { id: string; pinnedFile: string; file: string }[];
  /** Pinned ids whose definition hashes differently — `reason` says whether the
   *  data fields moved or only a render body did (see {@link RedefinedReason}). */
  redefined: { id: string; file: string; reason: RedefinedReason }[];
  /** Registered but not pinned: new work, free. */
  unpinned: string[];
};

/** Hold the live registry to the manifest's pins (Stage 0c). */
export function checkRegistryPins(
  manifest: Pick<FreezeManifest, "registry">,
  live: readonly LiveRegistration[],
): RegistryPinReport {
  const pins = manifest.registry ?? {};
  const byId = new Map(live.map((l) => [l.id, l]));
  const report: RegistryPinReport = {
    ok: true, pinned: Object.keys(pins).length, held: [], missing: [], moved: [], redefined: [], unpinned: [],
  };
  for (const id of Object.keys(pins).sort()) {
    const pin = pins[id]!;
    const now = byId.get(id);
    if (!now) { report.missing.push({ id, file: pin.file }); continue; }
    if (now.file !== pin.file) { report.moved.push({ id, pinnedFile: pin.file, file: now.file }); continue; }
    if (now.definitionSha256 !== pin.definitionSha256) {
      // A pin minted before render bodies joined stored the fields-only hash
      // as `definitionSha256`; either way, unchanged fields mean the render
      // body is what moved.
      const pinnedFields = pin.fieldsSha256 ?? pin.definitionSha256;
      const reason: RedefinedReason = now.fieldsSha256 !== undefined && now.fieldsSha256 === pinnedFields ? "render body" : "fields";
      report.redefined.push({ id, file: now.file, reason });
      continue;
    }
    report.held.push(id);
  }
  for (const l of live) if (!(l.id in pins)) report.unpinned.push(l.id);
  report.unpinned.sort();
  report.ok = report.missing.length === 0 && report.moved.length === 0 && report.redefined.length === 0;
  return report;
}

/** Ids the manifest pinned as being on web at mint (sorted). */
export function pinnedWebIds(manifest: Pick<FreezeManifest, "registry">): string[] {
  const pins = manifest.registry ?? {};
  return Object.keys(pins).filter((id) => pins[id]!.web === true).sort();
}

/**
 * The `web: true` pins as the BROWSER registry must satisfy them: the web
 * values where the mint recorded a divergence, the node values otherwise.
 * Feed the result to {@link checkRegistryPins} together with the live
 * registrations of `src/web.ts` (gathered in a fresh process — see
 * check-registry Stage 0c). Ids the web entry added since the mint show up
 * as `unpinned` there: new work.
 */
export function webRegistryPins(manifest: Pick<FreezeManifest, "registry">): Pick<FreezeManifest, "registry"> {
  const pins = manifest.registry ?? {};
  const web: Record<string, FreezeRegistryPin> = {};
  for (const id of pinnedWebIds(manifest)) {
    const p = pins[id]!;
    const pin: FreezeRegistryPin = { file: p.webFile ?? p.file, definitionSha256: p.webDefinitionSha256 ?? p.definitionSha256 };
    const fields = p.webFieldsSha256 ?? (p.webDefinitionSha256 === undefined ? p.fieldsSha256 : undefined);
    if (fields !== undefined) pin.fieldsSha256 = fields;
    web[id] = pin;
  }
  return { registry: web };
}

/**
 * Pins whose registering file is NOT itself in `files`. A pin over an unhashed
 * module holds the definition but not the code it runs — at the 0.2.0 cut two
 * shipped web ids registered from helpers outside every `vN/` folder. The
 * import closure freezes them now; this is the invariant that keeps it so.
 * `(unknown)` provenance (no usable stack frame) counts as unfrozen.
 */
export function unfrozenPinFiles(manifest: Pick<FreezeManifest, "files" | "registry">): { id: string; file: string }[] {
  const out: { id: string; file: string }[] = [];
  const pins = manifest.registry ?? {};
  for (const id of Object.keys(pins).sort()) {
    const p = pins[id]!;
    for (const file of [p.file, p.webFile]) {
      if (file !== undefined && manifest.files[file] === undefined) out.push({ id, file });
    }
  }
  return out;
}

/* ── which files are frozen ──────────────────────────────────────────────── */

/**
 * A path is a frozen SEED when it is a non-test `.ts` under `src/m0saic/` that
 * sits in a version folder (`…/v3/…`) or a shared folder (`…/_shared/…`).
 * The full frozen set is the relative-import closure of the seeds — see
 * {@link collectFrozenFiles}; a file reached that way is frozen although this
 * predicate says false for it, so the gate and the hook ask the MANIFEST
 * (`files[rel] !== undefined`), never this predicate alone, whether a path is
 * held. This predicate decides what is NEW WORK: a seed-shaped path absent
 * from the manifest.
 *
 * Deliberately NOT seeds: `*.test.ts` (adding tests to a frozen template is
 * the one way to improve it without moving it), `*.d.ts`, and the PACK-level
 * barrels (`src/m0saic/<pack>/index.ts`) — a new template has to register
 * itself. Barrels inside a version folder ARE frozen. (`gen-*.ts` tooling
 * inside a version folder is a seed like any other file there.)
 */
export function isFrozenPath(relPath: string): boolean {
  const p = relPath.split(path.sep).join("/");
  if (!p.startsWith(`${FROZEN_SRC_ROOT}/`)) return false;
  if (!isFreezableSource(p)) return false;
  // NOTE: no special case for `index.ts`. A pack-level barrel
  // (`src/m0saic/alpine/index.ts`) is already excluded by the rule below — it
  // sits in neither a version nor a shared folder. A barrel INSIDE a frozen
  // version (`…/v1/index.ts`, 79 of them) IS frozen: repointing
  // `export { default } from "./theming"` at another module, or dropping an
  // export, changes shipped behaviour just as surely as editing the logic.
  const segments = p.split("/");
  return segments.some((s) => /^v\d+$/.test(s) || s === "_shared");
}

/** Non-test, non-declaration TypeScript source — the only thing the freeze hashes. */
function isFreezableSource(p: string): boolean {
  return p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith(".d.ts");
}

/**
 * Relative module specifiers (`./x`, `../x`) a source file imports, read off
 * its comment-stripped text so a commented-out import is not a dependency.
 * Covers `import … from`, bare `import "…"`, `export … from`, `import("…")`
 * and `require("…")`. Package imports (`@m0saic/…`) are not returned — those
 * are Tier 2 by the launch plan, vendored beside this package.
 */
export function relativeImportSpecifiers(src: string): string[] {
  const { text } = stripComments(src.replace(/\r\n?/g, "\n"));
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const spec = m[1]!;
    if (spec.startsWith("./") || spec.startsWith("../")) out.push(spec);
  }
  return out;
}

/**
 * Resolve one relative specifier from `fromAbs` to a freezable `.ts` file
 * under `<packageRoot>/src`, TypeScript-style (`x` → `x.ts` | `x/index.ts`;
 * a `.js` specifier maps to its `.ts` source). Returns the package-relative
 * path, or undefined for anything else (an asset, a test, a path outside
 * `src/`, a module that does not exist).
 */
function resolveFrozenImport(packageRoot: string, fromAbs: string, spec: string): string | undefined {
  const srcRoot = path.join(packageRoot, "src");
  const target = path.resolve(path.dirname(fromAbs), spec);
  const candidates = target.endsWith(".ts")
    ? [target]
    : target.endsWith(".js")
      ? [`${target.slice(0, -".js".length)}.ts`]
      : [`${target}.ts`, path.join(target, "index.ts")];
  for (const abs of candidates) {
    if (!abs.startsWith(srcRoot + path.sep)) continue;
    let isFile = false;
    try { isFile = fs.statSync(abs).isFile(); } catch { /* not there */ }
    if (!isFile) continue;
    const rel = path.relative(packageRoot, abs).split(path.sep).join("/");
    return isFreezableSource(rel) ? rel : undefined;
  }
  return undefined;
}

/**
 * Every currently-frozen file, package-relative and sorted: the
 * {@link isFrozenPath} seeds plus every freezable `.ts` under `src/` they
 * reach through relative imports, transitively. What a frozen template can
 * run is frozen — a helper in `utils/` or at a pack root is shipped behaviour
 * exactly as a `_shared/` one is (see the header).
 */
export function collectFrozenFiles(packageRoot: string): string[] {
  const seeds: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      const rel = path.relative(packageRoot, abs).split(path.sep).join("/");
      if (isFrozenPath(rel)) seeds.push(rel);
    }
  };
  walk(path.join(packageRoot, FROZEN_SRC_ROOT));
  const frozen = new Set(seeds);
  const queue = [...seeds];
  while (queue.length) {
    const rel = queue.pop()!;
    const abs = path.join(packageRoot, rel);
    let src: string;
    try { src = fs.readFileSync(abs, "utf8"); } catch { continue; }
    for (const spec of relativeImportSpecifiers(src)) {
      const dep = resolveFrozenImport(packageRoot, abs, spec);
      if (dep !== undefined && !frozen.has(dep)) { frozen.add(dep); queue.push(dep); }
    }
  }
  return [...frozen].sort();
}

/* ── the gate ────────────────────────────────────────────────────────────── */

export function readFreezeManifest(packageRoot: string): FreezeManifest | null {
  const p = path.join(packageRoot, FREEZE_MANIFEST_FILE);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as FreezeManifest;
}

/**
 * Compare the working tree against the committed manifest.
 * `changed` and `deleted` are build errors; `unfrozen` is new work.
 */
export function checkFreeze(packageRoot: string, manifest: FreezeManifest): FreezeReport {
  const report: FreezeReport = {
    ok: true, unchanged: [], changed: [], deleted: [], unfrozen: [], lowConfidence: [],
  };
  const minted = manifestHashVersion(manifest);
  if (minted !== FREEZE_HASH_VERSION) {
    report.ok = false;
    report.hashVersionMismatch = { manifest: minted, checker: FREEZE_HASH_VERSION, message: describeHashVersionMismatch(minted) };
    return report;
  }
  // The manifest is the law: a file it lists is held while it exists on disk,
  // even if it fell out of the import closure (which only happens when a
  // frozen importer changed — itself a failure). The closure adds new work.
  const present = new Set<string>(collectFrozenFiles(packageRoot));
  for (const rel of Object.keys(manifest.files)) {
    if (!present.has(rel) && fs.existsSync(path.join(packageRoot, rel))) present.add(rel);
  }

  for (const rel of [...present].sort()) {
    const expected = manifest.files[rel];
    if (expected === undefined) { report.unfrozen.push(rel); continue; }
    const { hash, confident } = hashSource(fs.readFileSync(path.join(packageRoot, rel), "utf8"));
    if (!confident) report.lowConfidence.push(rel);
    if (hash === expected) report.unchanged.push(rel);
    else report.changed.push(rel);
  }
  for (const rel of Object.keys(manifest.files)) {
    if (!present.has(rel)) report.deleted.push(rel);
  }

  report.ok = report.changed.length === 0 && report.deleted.length === 0;
  return report;
}

/**
 * Mint a manifest from the current tree — the deliberate act at a release.
 * `registry` is every live registration of the NODE entry (the caller loads
 * the registry; this file stays free of it), which ids the browser entry
 * registered, and — when given — the browser entry's own live registrations
 * (`webLive`, gathered in a fresh process): a `web: true` pin records
 * `webFile` / `webDefinitionSha256` / `webFieldsSha256` only where the web
 * side differs from node.
 *
 * Throws when a pin would name a file the manifest does not hash (an
 * `(unknown)` provenance, or a registering module outside the frozen set):
 * a pin over unhashed code is not a lock, and a mint must never produce one.
 */
export function mintFreezeManifest(
  packageRoot: string,
  meta: { release: string; tag: string; commit: string; note: string },
  registry?: { live: readonly LiveRegistration[]; webIds?: readonly string[]; webLive?: readonly LiveRegistration[] },
): FreezeManifest {
  const files: Record<string, string> = {};
  for (const rel of collectFrozenFiles(packageRoot)) {
    files[rel] = hashSource(fs.readFileSync(path.join(packageRoot, rel), "utf8")).hash;
  }
  const manifest: FreezeManifest = { ...meta, hashVersion: FREEZE_HASH_VERSION, files };
  if (registry) {
    const web = new Set(registry.webIds ?? []);
    const webById = new Map((registry.webLive ?? []).map((l) => [l.id, l]));
    const pins: Record<string, FreezeRegistryPin> = {};
    for (const l of [...registry.live].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      const pin: FreezeRegistryPin = { file: l.file, definitionSha256: l.definitionSha256 };
      if (l.fieldsSha256 !== undefined) pin.fieldsSha256 = l.fieldsSha256;
      if (web.has(l.id)) {
        pin.web = true;
        const w = webById.get(l.id);
        if (w && (w.file !== l.file || w.definitionSha256 !== l.definitionSha256)) {
          pin.webFile = w.file;
          pin.webDefinitionSha256 = w.definitionSha256;
          if (w.fieldsSha256 !== undefined) pin.webFieldsSha256 = w.fieldsSha256;
        }
      }
      pins[l.id] = pin;
    }
    manifest.registry = pins;
    const unfrozen = unfrozenPinFiles(manifest);
    if (unfrozen.length) {
      throw new Error(
        `refusing to mint: ${unfrozen.length} registry pin(s) name a file the manifest does not hash — ` +
          unfrozen.map((u) => `${u.id} ← ${u.file}`).join("; ") +
          `. A pin over unhashed code is not a lock; the frozen set is the import closure of every vN/ and _shared/ file, so this means the registering module was not reached from a frozen file (or its provenance is unknown).`,
      );
    }
  }
  return manifest;
}
