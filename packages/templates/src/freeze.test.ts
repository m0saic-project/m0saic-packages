import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  FREEZE_HASH_VERSION,
  canonicalJson,
  checkFreeze,
  checkRegistryPins,
  collectFrozenFiles,
  definitionFieldsSha256,
  definitionSha256,
  describeHashVersionMismatch,
  hashSource,
  isFrozenPath,
  liveRegistrationOf,
  manifestHashVersion,
  mintFreezeManifest,
  pinnedWebIds,
  registeringSourcePath,
  relativeImportSpecifiers,
  renderSourceText,
  stripComments,
  unfrozenPinFiles,
  webRegistryPins,
  RENDER_PIN_FIELDS,
  TEMPLATE_WRAPPED_FROM_KEY,
} from "./freeze";
import { defineMosaicTemplate, registerTemplate, getTemplate, TEMPLATE_WRAPPED_FROM, __resetTemplateRegistryForTests } from "@m0saic/template-utils";

/**
 * The freeze gate is only as good as this scanner. Two failure directions,
 * with very different costs:
 *   under-strict — a CODE change hashes the same → a frozen template silently
 *                  moves under people who already hold its output. Unacceptable.
 *   over-strict  — a COMMENT edit trips the gate → annoying, recoverable.
 * These tests pin both, and the ambiguous cases must fail toward over-strict.
 */

const h = (s: string): string => hashSource(s).hash;

describe("stripComments — comment insensitivity", () => {
  it("hashes a comment-only rewrite identically", () => {
    const a = `// one\nexport const x = 1; /* two */\n`;
    const b = `/* completely different prose */\nexport const x = 1;\n`;
    expect(h(a)).toBe(h(b));
  });

  it("hashes an added JSDoc block identically", () => {
    const bare = `export function f(a: number) { return a * 2; }\n`;
    const documented = `/**\n * Doubles a.\n * @param a the input\n */\nexport function f(a: number) { return a * 2; }\n`;
    expect(h(documented)).toBe(h(bare));
  });

  it("is insensitive to how much HORIZONTAL whitespace sits between tokens", () => {
    expect(h(`const a = 1;`)).toBe(h(`const a    =\t  1;`));
  });

  it("is insensitive to indentation and blank lines (hash v2 keeps newlines, folds the rest)", () => {
    const tight = `function f(a) {\nreturn a;\n}\n`;
    const airy = `function f(a) {\n\n\n        return a;   \n\n}\n\n\n`;
    expect(h(airy)).toBe(h(tight));
    expect(stripComments(airy).text).toBe(`function f(a) {\nreturn a;\n}`);
  });

  it("folds a comment-only line into no line at all", () => {
    expect(h(`a();\n// note\nb();\n`)).toBe(h(`a();\nb();\n`));
    expect(h(`a();\n/* note */\nb();\n`)).toBe(h(`a();\nb();\n`));
    expect(h(`a(); // trailing\nb();\n`)).toBe(h(`a();\nb();\n`));
  });

  it("DOES trip on reformatting — 'comments only' does not include prettier", () => {
    // Over-strict on purpose: a formatter run over a frozen template is a
    // change to a frozen file, and the gate should say so.
    expect(h(`const a={x:1};`)).not.toBe(h(`const a = { x: 1 };`));
  });

  it("never glues tokens together when a comment is removed", () => {
    // `a/**/b` must not canonicalize to `ab`, which would collide with a real
    // identifier rename.
    expect(stripComments(`a/**/b`).text).not.toContain("ab");
  });
});

describe("stripComments — code sensitivity (the whole point)", () => {
  it.each([
    [`export const x = 1;`, `export const x = 2;`, "a literal"],
    [`const a = 1;`, `const b = 1;`, "an identifier"],
    [`f(a, b);`, `f(b, a);`, "argument order"],
    [`const c = "#ff0000";`, `const c = "#ff0001";`, "a colour inside a string"],
    [`const t = \`hi \${name}\`;`, `const t = \`hi \${other}\`;`, "a template expression"],
    [`if (a) g();`, `if (!a) g();`, "a negation"],
  ])("detects a change to %s → %s (%s)", (before, after) => {
    expect(h(before)).not.toBe(h(after));
  });

  it("⭐ preserves string interiors byte-for-byte — whitespace there IS behaviour", () => {
    expect(h(`const s = "a  b";`)).not.toBe(h(`const s = "a b";`));
  });

  it("preserves newlines inside template literals", () => {
    expect(h("const s = `a\nb`;")).not.toBe(h("const s = `a b`;"));
  });

  // ⭐ The ASI bypass (adversary 2026-09-17). `return path;` and
  // `return\n  path;` are different programs — the second returns undefined —
  // and hash v1 (every whitespace run → one space) could not tell them apart.
  it("⭐ detects a token moved to the next line — ASI makes a line break semantic", () => {
    expect(h(`function f(p) {\n  return p;\n}\n`)).not.toBe(h(`function f(p) {\n  return\n    p;\n}\n`));
    expect(h(`const x = a\n(b)`)).not.toBe(h(`const x = a(b)`));
    expect(h(`let y = 1\n++z`)).not.toBe(h(`let y = 1 ++z`));
  });

  it("treats a block comment that spans lines as a line break (the spec does, for ASI)", () => {
    expect(h(`return /* a\n b */ p;`)).toBe(h(`return\np;`));
    expect(h(`return /* a b */ p;`)).toBe(h(`return p;`));
    expect(h(`return /* a\n b */ p;`)).not.toBe(h(`return p;`));
  });
});

describe("hash version — an old manifest under a new hasher fails loudly, never as 'everything changed'", () => {
  it("is v2 today, and a manifest without the field reads as v1", () => {
    expect(FREEZE_HASH_VERSION).toBe(2);
    expect(manifestHashVersion({})).toBe(1);
    expect(manifestHashVersion({ hashVersion: 2 })).toBe(2);
  });

  it("checkFreeze refuses a v1 manifest outright, computing nothing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m0saic-freeze-"));
    try {
      fs.mkdirSync(path.join(dir, "src/m0saic/pack/v1"), { recursive: true });
      fs.writeFileSync(path.join(dir, "src/m0saic/pack/v1/t.ts"), "export const t = 1;\n");
      const v1 = { release: "0.1.0", tag: "v0.1.0", commit: "c", note: "n", files: { "src/m0saic/pack/v1/t.ts": "0".repeat(64) } };
      const r = checkFreeze(dir, v1);
      expect(r.ok).toBe(false);
      expect(r.hashVersionMismatch).toEqual({ manifest: 1, checker: 2, message: describeHashVersionMismatch(1) });
      expect(r.hashVersionMismatch!.message).toContain("manifest minted with hash v1, checker is v2");
      expect(r.changed).toEqual([]);
      expect(r.deleted).toEqual([]);

      // A freshly minted manifest carries the version and passes.
      const minted = mintFreezeManifest(dir, { release: "0.2.0", tag: "v0.2.0", commit: "c", note: "n" });
      expect(minted.hashVersion).toBe(FREEZE_HASH_VERSION);
      expect(minted.registry).toBeUndefined();
      const r2 = checkFreeze(dir, minted);
      expect(r2.ok).toBe(true);
      expect(r2.hashVersionMismatch).toBeUndefined();
      expect(r2.unchanged).toEqual(["src/m0saic/pack/v1/t.ts"]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("registry pins — a shipped id keeps its registering file and its definition", () => {
  const tmpl = (over: Record<string, unknown> = {}) => ({
    id: "@m0saic/pack/thing/v1", label: "Thing", description: "d", tags: ["x"], version: 1,
    capabilities: { tier: "core" }, propsSchema: { n: { type: "number", validate: () => true } },
    defaultProps: { n: 1, s: "a" }, outputHints: { width: 1080 }, render: () => null, ...over,
  });

  it("canonicalJson is key-order independent and renders functions as a placeholder", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[2,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJson({ f: () => 1, n: NaN })).toBe('{"f":"[Function]","n":null}');
  });

  it("definitionSha256 ignores browse metadata and key order but sees defaults, schema, hints, flags", () => {
    const base = definitionSha256(tmpl());
    expect(definitionSha256(tmpl({ label: "Renamed", description: "other", tags: [] }))).toBe(base);
    expect(definitionSha256({ ...tmpl(), defaultProps: { s: "a", n: 1 } })).toBe(base);
    expect(definitionSha256(tmpl({ defaultProps: { n: 2, s: "a" } }))).not.toBe(base);
    expect(definitionSha256(tmpl({ propsSchema: { n: { type: "string" } } }))).not.toBe(base);
    expect(definitionSha256(tmpl({ outputHints: { width: 720 } }))).not.toBe(base);
    expect(definitionSha256(tmpl({ deprecated: { since: "0.2.0" } }))).not.toBe(base);
    expect(definitionSha256(tmpl({ internal: true }))).not.toBe(base);
    expect(definitionSha256(tmpl({ lattice: { mode: "bitmap" } }))).not.toBe(base);
  });

  it("⭐ definitionSha256 pins the render body: a different render function moves it while the fields hold", () => {
    const base = definitionSha256(tmpl());
    const fields = definitionFieldsSha256(tmpl());
    // Same fields, different render text → definition moved, fields did not.
    const swapped = tmpl({ render: (p: any) => ({ ...p, accent: "#ff0000" }) });
    expect(definitionSha256(swapped)).not.toBe(base);
    expect(definitionFieldsSha256(swapped)).toBe(fields);
    // renderLite / renderCover join the pin; renderTutorial does not.
    expect(definitionSha256(tmpl({ renderLite: () => null }))).not.toBe(base);
    expect(definitionSha256(tmpl({ renderCover: () => null }))).not.toBe(base);
    expect(definitionSha256(tmpl({ renderTutorial: () => null }))).toBe(base);
    expect(RENDER_PIN_FIELDS).toEqual(["render", "renderLite", "renderCover", "resolveOutputHints"]);
    // Same function, same text → same pin (deterministic for a build).
    expect(definitionSha256(tmpl())).toBe(base);
  });

  it("renderSourceText is the canonical (comment-stripped, hash-v2) text of the function itself", () => {
    // Two functions whose bodies differ only by comments / horizontal whitespace hash alike.
    const a = function render(p: number) { return p + 1; }; // trailing comment sits outside the text
    const b = function render(p: number) { /* doc */ return   p + 1; };
    expect(renderSourceText(a)).toBe(renderSourceText(b));
    expect(renderSourceText(a)).toBe(stripComments(a.toString()).text);
    // A moved token is a different program.
    const c = function render(p: number) { return p + 2; };
    expect(renderSourceText(c)).not.toBe(renderSourceText(a));
    expect(renderSourceText(undefined)).toBeUndefined();
    expect(renderSourceText({})).toBeUndefined();
  });

  it("⭐ follows defineMosaicTemplate's wrapper link down to the template's own function (the registry hands out wrappers)", () => {
    expect(TEMPLATE_WRAPPED_FROM_KEY).toBe(TEMPLATE_WRAPPED_FROM);
    __resetTemplateRegistryForTests();
    const render = async (_p: any, _c: any) => null as any;
    const renderLite = (_p: any, _c: any) => null as any;
    const raw = { ...tmpl({ id: "@m0saic/pack/thing/v9", render, renderLite }) } as any;
    // Module-level wrap, then registerTemplate wraps again — two links deep.
    const defined = defineMosaicTemplate(raw);
    registerTemplate(defined);
    const registered = getTemplate("@m0saic/pack/thing/v9") as any;
    expect(registered.render).not.toBe(render);
    expect(renderSourceText(registered.render)).toBe(renderSourceText(render));
    expect(renderSourceText(registered.renderLite)).toBe(renderSourceText(renderLite));
    // So every wrapping layer pins alike, and a different template body does not.
    expect(definitionSha256(registered)).toBe(definitionSha256(raw));
    expect(definitionSha256(registered)).toBe(definitionSha256(defined as any));
    expect(definitionSha256(registered)).not.toBe(definitionSha256({ ...raw, render: async () => ({ changed: true }) }));
    // The wrapper text itself never leaks into the pin: two different templates
    // through the same wrapper do not collide on it.
    const other = defineMosaicTemplate({ ...raw, id: "@m0saic/pack/other/v9", render: async () => 1 } as any);
    expect(definitionSha256(other as any)).not.toBe(definitionSha256(defined as any));
    __resetTemplateRegistryForTests();
  });

  it("liveRegistrationOf carries both hashes so a moved pin can be told apart", () => {
    const l = liveRegistrationOf("@m0saic/pack/thing/v1", "src/m0saic/pack/thing/v1/thing.ts", tmpl());
    expect(l).toEqual({
      id: "@m0saic/pack/thing/v1", file: "src/m0saic/pack/thing/v1/thing.ts",
      definitionSha256: definitionSha256(tmpl()), fieldsSha256: definitionFieldsSha256(tmpl()),
    });
  });

  it("registeringSourcePath maps the dist module that ran back to the frozen source file", () => {
    const root = path.resolve("/repo/packages/templates");
    expect(registeringSourcePath(root, "packages/templates/dist/m0saic/alpine/donut/v3/donut.js")).toBe("src/m0saic/alpine/donut/v3/donut.ts");
    expect(registeringSourcePath(root, path.join(root, "dist/m0saic/x/v1/x.js"))).toBe("src/m0saic/x/v1/x.ts");
    expect(registeringSourcePath(root, "packages/templates/src/m0saic/x/v1/x.ts")).toBe("src/m0saic/x/v1/x.ts");
    expect(registeringSourcePath(root, "packages/template-utils/dist/brand/hello.js")).toBe("packages/template-utils/dist/brand/hello.js");
  });

  it("mint records every live registration (sorted) with its web flag; checkRegistryPins holds the tree to it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m0saic-freeze-"));
    try {
      // A pin must name a hashed file (the mint refuses otherwise), so the pinned modules exist.
      for (const rel of ["src/m0saic/a/v1/a.ts", "src/m0saic/b/v1/b.ts", "src/m0saic/z/v1/z.ts"]) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), `export const x = "${rel}";\n`);
      }
      const live = [
        { id: "@m0saic/b/v1", file: "src/m0saic/b/v1/b.ts", definitionSha256: "b".repeat(64), fieldsSha256: "e".repeat(64) },
        { id: "@m0saic/a/v1", file: "src/m0saic/a/v1/a.ts", definitionSha256: "a".repeat(64), fieldsSha256: "d".repeat(64) },
      ];
      const m = mintFreezeManifest(dir, { release: "0.2.0", tag: "t", commit: "c", note: "n" }, { live, webIds: ["@m0saic/a/v1"] });
      expect(Object.keys(m.registry!)).toEqual(["@m0saic/a/v1", "@m0saic/b/v1"]);
      expect(m.registry!["@m0saic/a/v1"]).toEqual({ file: "src/m0saic/a/v1/a.ts", definitionSha256: "a".repeat(64), fieldsSha256: "d".repeat(64), web: true });
      expect(m.registry!["@m0saic/b/v1"]).toEqual({ file: "src/m0saic/b/v1/b.ts", definitionSha256: "b".repeat(64), fieldsSha256: "e".repeat(64) });
      // A live registration without the fields hash pins without it.
      const bare = mintFreezeManifest(dir, { release: "0.2.0", tag: "t", commit: "c", note: "n" }, { live: [{ id: "@m0saic/z/v1", file: "src/m0saic/z/v1/z.ts", definitionSha256: "z".repeat(64) }] });
      expect(bare.registry!["@m0saic/z/v1"]).toEqual({ file: "src/m0saic/z/v1/z.ts", definitionSha256: "z".repeat(64) });
      expect(pinnedWebIds(m)).toEqual(["@m0saic/a/v1"]);

      // Unchanged → held; a new id → unpinned (free).
      const ok = checkRegistryPins(m, [...live, { id: "@m0saic/c/v2", file: "src/m0saic/c/v2/c.ts", definitionSha256: "c".repeat(64) }]);
      expect(ok.ok).toBe(true);
      expect(ok.held).toEqual(["@m0saic/a/v1", "@m0saic/b/v1"]);
      expect(ok.unpinned).toEqual(["@m0saic/c/v2"]);
      expect(ok.pinned).toBe(2);

      // (1) the id vanished; (2) re-registered from another file (barrel swap /
      // new file); (3) same file, different defaults.
      const bad = checkRegistryPins(m, [
        { id: "@m0saic/a/v1", file: "src/m0saic/a/v2/a.ts", definitionSha256: "a".repeat(64) },
      ]);
      expect(bad.ok).toBe(false);
      expect(bad.missing).toEqual([{ id: "@m0saic/b/v1", file: "src/m0saic/b/v1/b.ts" }]);
      expect(bad.moved).toEqual([{ id: "@m0saic/a/v1", pinnedFile: "src/m0saic/a/v1/a.ts", file: "src/m0saic/a/v2/a.ts" }]);
      const redefined = checkRegistryPins(m, [live[0]!, { ...live[1]!, definitionSha256: "f".repeat(64), fieldsSha256: "0".repeat(64) }]);
      expect(redefined.ok).toBe(false);
      expect(redefined.redefined).toEqual([{ id: "@m0saic/a/v1", file: "src/m0saic/a/v1/a.ts", reason: "fields" }]);
      // (4) same file, same fields, different render body → "render body".
      const body = checkRegistryPins(m, [live[0]!, { ...live[1]!, definitionSha256: "f".repeat(64) }]);
      expect(body.ok).toBe(false);
      expect(body.redefined).toEqual([{ id: "@m0saic/a/v1", file: "src/m0saic/a/v1/a.ts", reason: "render body" }]);
      // A pin minted BEFORE render bodies joined stored the fields-only hash as
      // definitionSha256: unchanged fields under a moved definition read as
      // "render body" — what the 0.2.0 manifest shows until it is re-minted.
      const legacy = { registry: { "@m0saic/a/v1": { file: "src/m0saic/a/v1/a.ts", definitionSha256: "d".repeat(64) } } };
      expect(checkRegistryPins(legacy, [live[1]!]).redefined).toEqual([{ id: "@m0saic/a/v1", file: "src/m0saic/a/v1/a.ts", reason: "render body" }]);
      expect(checkRegistryPins(legacy, [{ ...live[1]!, fieldsSha256: "1".repeat(64) }]).redefined).toEqual([{ id: "@m0saic/a/v1", file: "src/m0saic/a/v1/a.ts", reason: "fields" }]);
      // A live registration without a fields hash cannot claim "render body".
      expect(checkRegistryPins(legacy, [{ id: "@m0saic/a/v1", file: "src/m0saic/a/v1/a.ts", definitionSha256: "f".repeat(64) }]).redefined[0]!.reason).toBe("fields");

      // A manifest without pins holds nothing (0.1.0-era), but reports so.
      expect(checkRegistryPins({}, live)).toMatchObject({ ok: true, pinned: 0, unpinned: ["@m0saic/a/v1", "@m0saic/b/v1"] });
      expect(pinnedWebIds({})).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("hashSource — line endings are checkout noise, not code", () => {
  // A Windows clone with core.autocrlf=true checks frozen files out as CRLF.
  // Outside strings the scanner already collapses `\r`, but a multi-line
  // template literal would carry it verbatim and trip the gate on a file
  // nobody touched. JS itself normalizes CRLF/CR → LF in template literals.
  it("⭐ hashes a CRLF checkout of a multi-line template literal like the LF original", () => {
    const lf = "export const css = `\n  a {\n    color: red;\n  }\n`;\n";
    expect(h(lf.replace(/\n/g, "\r\n"))).toBe(h(lf));
  });

  it("treats a lone CR line break like LF", () => {
    expect(h("const s = `a\rb`;")).toBe(h("const s = `a\nb`;"));
  });

  it("still detects an ESCAPED \\r — that is written behaviour, not a line ending", () => {
    expect(h(`const s = "a\\r\\nb";`)).not.toBe(h(`const s = "a\\nb";`));
  });
});

describe("stripComments — the cases a naive stripper eats", () => {
  it("does not treat // inside a string as a comment", () => {
    const src = `const url = "https://m0saic.io"; const keep = 1;`;
    expect(stripComments(src).text).toContain("keep");
    expect(h(src)).not.toBe(h(`const url = "https://m0saic.io";`));
  });

  it("does not treat /* inside a string as a block comment", () => {
    const src = `const g = "/* not a comment */"; const keep = 1;`;
    expect(stripComments(src).text).toContain("keep");
  });

  it("⭐ survives a regex containing // and keeps the code after it", () => {
    const src = `const re = /a\\/\\/b/; const keep = 1;`;
    const out = stripComments(src);
    expect(out.confident).toBe(true);
    expect(out.text).toContain("keep");
  });

  it("distinguishes division from a regex literal", () => {
    // `a / b / c` is arithmetic; mis-scanning it as a regex would swallow `c`.
    const src = `const r = a / b / c; const keep = 1;`;
    const out = stripComments(src);
    expect(out.text).toContain("keep");
    expect(h(src)).not.toBe(h(`const r = a / b / d; const keep = 1;`));
  });

  it("handles a regex after `return` (word-keyword position)", () => {
    const out = stripComments(`function f() { return /x+/.test(s); }`);
    expect(out.confident).toBe(true);
    expect(out.text).toContain("test");
  });

  it("handles nested ${} inside a template literal", () => {
    const src = "const s = `a${ f({ k: `inner ${v}` }) }b`; const keep = 1;";
    expect(stripComments(src).text).toContain("keep");
  });
});

describe("stripComments — fails SAFE, never silently permissive", () => {
  it.each([
    [`const s = "unterminated;`, "unterminated string"],
    ["const s = `unterminated;", "unterminated template"],
    [`const a = 1; /* never closed`, "unterminated block comment"],
  ])("reports low confidence on %s (%s)", (src) => {
    const out = stripComments(src);
    expect(out.confident).toBe(false);
    // Falling back to the RAW text means comment edits trip the gate — the
    // over-strict direction, which is the safe one.
    expect(out.text).toBe(src);
  });

  it("a low-confidence file still hashes deterministically", () => {
    const src = `const s = "unterminated;`;
    expect(h(src)).toBe(h(src));
  });
});

describe("isFrozenPath", () => {
  it.each([
    ["src/m0saic/alpine/donut/v3/donut.ts", true, "a version folder"],
    ["src/m0saic/alpine/_shared/alpine-theme.ts", true, "a shared helper"],
    ["src/m0saic/dsl-tutorial/v1/_shared/node-kit.ts", true, "shared inside a version"],
    ["src/m0saic/charts/_shared/scale.ts", true, "a pack-level shared helper"],
    ["src/m0saic/theming/v1/index.ts", true, "a barrel INSIDE a frozen version — repointing an export changes behaviour"],
    ["src/m0saic/charts/_shared/index.ts", true, "a shared barrel"],
  ])("freezes %s (%s)", (p, expected) => {
    expect(isFrozenPath(p)).toBe(expected);
  });

  it.each([
    ["src/m0saic/alpine/donut/v3/donut.test.ts", "tests stay editable — adding them is the sanctioned improvement"],
    ["src/m0saic/alpine/index.ts", "barrels must accept new template registrations"],
    ["src/gen-template-audit.ts", "audit tooling is not shipped behaviour"],
    ["src/registry.ts", "registry plumbing sits outside src/m0saic"],
    ["src/m0saic/alpine/donut/v3/types.d.ts", "declaration files emit nothing"],
    ["src/m0saic/alpine/donut/draft.ts", "not in a version or shared folder"],
  ])("does NOT freeze %s (%s)", (p) => {
    expect(isFrozenPath(p)).toBe(false);
  });

  it("accepts any version number, not just v1", () => {
    expect(isFrozenPath("src/m0saic/media/grid/v12/grid.ts")).toBe(true);
  });
});

// ── 2026-09-17 review round ──────────────────────────────────────────────

describe("stripComments — every ECMAScript LineTerminator is a line break (LS / PS, not just LF / CR)", () => {
  // The characters are built at runtime on purpose: a literal U+2028 inside a
  // regex or string in THIS file would itself be a line terminator.
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);

  it("⭐ ends a // comment at U+2028 / U+2029 — the code after it runs, so it hashes as code", () => {
    const innocent = `function f(){ // note\nreturn 1 }`;
    for (const t of [LS, PS]) {
      const evil = `function f(){ // note${t}evil();\nreturn 1 }`;
      expect(h(evil)).not.toBe(h(innocent));
      expect(stripComments(evil).text).toContain("evil()");
    }
  });

  it("⭐ treats a block comment containing U+2028 / U+2029 as spanning lines (ASI: return;)", () => {
    for (const t of [LS, PS]) {
      const split = `return /*${t}*/ x`;
      expect(h(split)).toBe(h("return\nx"));
      expect(h(split)).not.toBe(h("return /**/ x"));
    }
  });

  it("treats a bare U+2028 / U+2029 between tokens as a line break, and a run of them as one", () => {
    for (const t of [LS, PS]) {
      expect(h(`return${t}x`)).toBe(h("return\nx"));
      expect(h(`a${t}${t}\n b`)).toBe(h("a\nb"));
      expect(h(`return${t}x`)).not.toBe(h("return x"));
    }
  });

  it("keeps U+2028 / U+2029 verbatim inside string and template literals (a different value from LF)", () => {
    for (const t of [LS, PS]) {
      expect(h(`const s = \`a${t}b\``)).not.toBe(h("const s = \`a\nb\`"));
      expect(h(`const s = "a${t}b"`)).not.toBe(h('const s = "ab"'));
    }
  });

  it("stops a regex literal at U+2028 like at LF (it was division)", () => {
    expect(stripComments(`a = b /${LS}c/ d`).confident).toBe(true);
  });
});

describe("collectFrozenFiles — the frozen set is the relative-import closure of the vN/ + _shared/ seeds", () => {
  const write = (root: string, rel: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };

  it("relativeImportSpecifiers reads every relative form off the comment-stripped text and ignores package imports", () => {
    const src = [
      `import { a } from "./a";`,
      `import "../side-effect";`,
      `export * from "./barrel";`,
      `export { x } from '../x';`,
      `const y = require("./y");`,
      `const z = await import("./z");`,
      `import { t } from "@m0saic/template-utils";`,
      `// import "./commented-out";`,
      `/* import "./also-commented"; */`,
    ].join("\n");
    expect(relativeImportSpecifiers(src)).toEqual(["./a", "../side-effect", "./barrel", "../x", "./y", "./z"]);
  });

  it("⭐ freezes a helper outside every vN/ and _shared/ folder when a frozen file imports it — transitively — and nothing else", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m0saic-freeze-closure-"));
    try {
      write(dir, "src/m0saic/wire/base/v1/wire.ts", `import { cell } from "../../utils/cell";\nimport "./index";\nexport const w = cell;\n`);
      write(dir, "src/m0saic/wire/base/v1/index.ts", `export * from "./wire";\n`);
      write(dir, "src/m0saic/wire/utils/cell.ts", `import { grid } from "./grid";\nimport { pad } from "../../_shared/pad";\nexport const cell = grid + pad;\n`);
      write(dir, "src/m0saic/wire/utils/grid.ts", `export const grid = 1;\n`);
      write(dir, "src/m0saic/wire/utils/grid.test.ts", `import "./grid";\n`);
      write(dir, "src/m0saic/wire/utils/unused.ts", `export const unused = 0;\n`);
      write(dir, "src/m0saic/_shared/pad.ts", `export const pad = 2;\n`);
      write(dir, "src/m0saic/wire/index.ts", `import "./base/v1";\nimport "./utils/unused";\n`); // pack barrel: never a seed, not reached
      write(dir, "src/m0saic/wire/base/v1/data.json", "{}"); // assets are not .ts
      write(dir, "src/m0saic/wire/base/v1/asset.ts", `import data from "./data.json";\nexport const d = data;\n`);
      write(dir, "src/outside.ts", `export const o = 1;\n`);
      write(dir, "src/m0saic/wire/base/v1/reach.ts", `import { o } from "../../../../outside";\nexport const r = o;\n`);
      expect(collectFrozenFiles(dir)).toEqual([
        "src/m0saic/_shared/pad.ts",
        "src/m0saic/wire/base/v1/asset.ts",
        "src/m0saic/wire/base/v1/index.ts",
        "src/m0saic/wire/base/v1/reach.ts",
        "src/m0saic/wire/base/v1/wire.ts",
        "src/m0saic/wire/utils/cell.ts", // reached from v1/wire.ts
        "src/m0saic/wire/utils/grid.ts", // reached transitively
        "src/outside.ts", // under src/, reached from a frozen file — frozen although outside src/m0saic
      ]);
      // isFrozenPath still says false for a closure file: the MANIFEST is the test for "held".
      expect(isFrozenPath("src/m0saic/wire/utils/cell.ts")).toBe(false);

      // The gate holds a closure file exactly like a seed, and reports a NEW reachable helper as new work.
      const m = mintFreezeManifest(dir, { release: "0.2.0", tag: "t", commit: "c", note: "n" });
      expect(Object.keys(m.files)).toContain("src/m0saic/wire/utils/cell.ts");
      expect(checkFreeze(dir, m).ok).toBe(true);
      write(dir, "src/m0saic/wire/utils/grid.ts", `export const grid = 2;\n`);
      const r = checkFreeze(dir, m);
      expect(r.ok).toBe(false);
      expect(r.changed).toEqual(["src/m0saic/wire/utils/grid.ts"]);
      // A manifest file that fell out of the closure but still exists stays held (the manifest is the law).
      write(dir, "src/m0saic/wire/utils/grid.ts", `export const grid = 1;\n`);
      write(dir, "src/m0saic/wire/utils/cell.ts", `export const cell = 3;\n`); // no longer imports grid — itself a change
      const r2 = checkFreeze(dir, m);
      expect(r2.changed).toEqual(["src/m0saic/wire/utils/cell.ts"]);
      expect(r2.unchanged).toContain("src/m0saic/wire/utils/grid.ts");
      expect(r2.deleted).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("registry pins — the web registry and the pin-file invariant", () => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "m0saic-freeze-web-"));
  const seed = (root: string): void => {
    fs.mkdirSync(path.join(root, "src/m0saic/a/v1"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/m0saic/a/v1/a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(root, "src/m0saic/a/v1/a.web.ts"), "export const a = 2;\n");
    fs.mkdirSync(path.join(root, "src/m0saic/b/v1"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/m0saic/b/v1/b.ts"), "export const b = 1;\n");
  };
  const nodeLive = [
    { id: "@m0saic/a/v1", file: "src/m0saic/a/v1/a.ts", definitionSha256: "a".repeat(64), fieldsSha256: "1".repeat(64) },
    { id: "@m0saic/b/v1", file: "src/m0saic/b/v1/b.ts", definitionSha256: "b".repeat(64), fieldsSha256: "2".repeat(64) },
  ];

  it("⭐ a web: true pin records the web-side file and definition only where the browser entry differs from node", () => {
    const d = dir();
    try {
      seed(d);
      const webLive = [
        { id: "@m0saic/a/v1", file: "src/m0saic/a/v1/a.web.ts", definitionSha256: "w".repeat(64), fieldsSha256: "3".repeat(64) }, // the .web.ts stand-in
        { id: "@m0saic/b/v1", file: "src/m0saic/b/v1/b.ts", definitionSha256: "b".repeat(64), fieldsSha256: "2".repeat(64) }, // same as node
      ];
      const m = mintFreezeManifest(d, { release: "0.2.0", tag: "t", commit: "c", note: "n" }, { live: nodeLive, webIds: ["@m0saic/a/v1", "@m0saic/b/v1"], webLive });
      expect(m.registry!["@m0saic/a/v1"]).toMatchObject({ web: true, webFile: "src/m0saic/a/v1/a.web.ts", webDefinitionSha256: "w".repeat(64), webFieldsSha256: "3".repeat(64) });
      expect(m.registry!["@m0saic/b/v1"]).toEqual({ file: "src/m0saic/b/v1/b.ts", definitionSha256: "b".repeat(64), fieldsSha256: "2".repeat(64), web: true });

      // The web pins as the browser registry must satisfy them.
      const wp = webRegistryPins(m);
      expect(wp.registry).toEqual({
        "@m0saic/a/v1": { file: "src/m0saic/a/v1/a.web.ts", definitionSha256: "w".repeat(64), fieldsSha256: "3".repeat(64) },
        "@m0saic/b/v1": { file: "src/m0saic/b/v1/b.ts", definitionSha256: "b".repeat(64), fieldsSha256: "2".repeat(64) },
      });
      expect(checkRegistryPins(wp, webLive).ok).toBe(true);
      // The bypass this closes: a NEW file registers a shipped id on web with other defaults while node stays pinned.
      const hijacked = checkRegistryPins(wp, [{ ...webLive[0]!, file: "src/m0saic/a/v1-web/evil.ts" }, webLive[1]!]);
      expect(hijacked.moved).toEqual([{ id: "@m0saic/a/v1", pinnedFile: "src/m0saic/a/v1/a.web.ts", file: "src/m0saic/a/v1-web/evil.ts" }]);
      const redefined = checkRegistryPins(wp, [webLive[0]!, { ...webLive[1]!, definitionSha256: "x".repeat(64), fieldsSha256: "9".repeat(64) }]);
      expect(redefined.redefined).toEqual([{ id: "@m0saic/b/v1", file: "src/m0saic/b/v1/b.ts", reason: "fields" }]);
      const dropped = checkRegistryPins(wp, [webLive[0]!]);
      expect(dropped.missing).toEqual([{ id: "@m0saic/b/v1", file: "src/m0saic/b/v1/b.ts" }]);
      // An id that is not web: true is not a web pin at all; no pins → nothing.
      expect(Object.keys(webRegistryPins(mintFreezeManifest(d, { release: "0.2.0", tag: "t", commit: "c", note: "n" }, { live: nodeLive, webIds: [] })).registry!)).toEqual([]);
      expect(webRegistryPins({}).registry).toEqual({});
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });

  it("⭐ refuses to mint a pin over a file the manifest does not hash; unfrozenPinFiles finds one in a committed manifest", () => {
    const d = dir();
    try {
      seed(d);
      const stray = [...nodeLive, { id: "@m0saic/c/v1", file: "src/m0saic/c/utils/c.ts", definitionSha256: "c".repeat(64) }];
      expect(() => mintFreezeManifest(d, { release: "0.2.0", tag: "t", commit: "c", note: "n" }, { live: stray, webIds: [] }))
        .toThrow(/@m0saic\/c\/v1 ← src\/m0saic\/c\/utils\/c\.ts/);
      const unknown = [...nodeLive, { id: "@m0saic/c/v1", file: "(unknown)", definitionSha256: "c".repeat(64) }];
      expect(() => mintFreezeManifest(d, { release: "0.2.0", tag: "t", commit: "c", note: "n" }, { live: unknown, webIds: [] })).toThrow(/\(unknown\)/);
      const m = mintFreezeManifest(d, { release: "0.2.0", tag: "t", commit: "c", note: "n" }, { live: nodeLive, webIds: [] });
      expect(unfrozenPinFiles(m)).toEqual([]);
      const edited = { ...m, registry: { ...m.registry, "@m0saic/a/v1": { ...m.registry!["@m0saic/a/v1"]!, webFile: "src/m0saic/a/v1/nope.ts" } } };
      expect(unfrozenPinFiles(edited)).toEqual([{ id: "@m0saic/a/v1", file: "src/m0saic/a/v1/nope.ts" }]);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });

  it("RENDER_PIN_FIELDS covers resolveOutputHints — the canvas a shipped id plans at is part of its definition", () => {
    expect([...RENDER_PIN_FIELDS]).toContain("resolveOutputHints");
    const base = { id: "@m0saic/x/v1", defaultProps: { n: 1 }, render: () => ({}) };
    const withHints = { ...base, resolveOutputHints: (p: { n: number }) => ({ width: p.n }) };
    expect(definitionSha256(withHints)).not.toBe(definitionSha256(base));
    expect(definitionFieldsSha256(withHints)).toBe(definitionFieldsSha256(base));
  });

  it("describeHashVersionMismatch points a NEWER manifest at a rebuild, an older one at a release re-mint", () => {
    expect(describeHashVersionMismatch(FREEZE_HASH_VERSION + 1)).toMatch(/rebuild/i);
    expect(describeHashVersionMismatch(FREEZE_HASH_VERSION + 1)).not.toMatch(/--update-freeze/);
    expect(describeHashVersionMismatch(1)).toMatch(/--update-freeze/);
  });
});
