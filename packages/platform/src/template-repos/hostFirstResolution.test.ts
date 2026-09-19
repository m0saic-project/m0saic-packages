// covers: host-first `@m0saic/*` resolution for external template repos —
// a planted `<checkout>/node_modules/@m0saic/…` is never evaluated, a clone
// with no node_modules at all still resolves the host's packages, everything
// else resolves exactly as before, and symlinks cannot escape the root test.
//
// These drive Node's REAL CommonJS resolver, not Jest's module registry:
// Jest hands sandboxed code a COPY of `Module` (statics copied onto a
// subclass, `createRequire` swapped for its own), so both the hook and the
// `require` under test go through `__realNodeModuleForTests()` — the same
// `Module._resolveFilename` path a loaded repo takes in the CLI and the
// desktop app.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  __realNodeModuleForTests,
  __resetHostFirstResolutionForTests,
  installHostFirstResolution,
  isHostScopedRequest,
  originatesUnderRegisteredRoot,
  registerHostFirstRepoRoot,
  registeredHostFirstRepoRoots,
  resolveFromHost,
} from "./hostFirstResolution";

type Internals = { _resolveFilename: unknown; _cache: Record<string, unknown> };

const Module = __realNodeModuleForTests();
const createRequire = Module.createRequire.bind(Module);

// These tests resolve the REAL sibling package (`packages/template-utils`)
// through Node's require. A standalone checkout that has not synced that
// sibling yet (the public mirror, mid-increment) has nothing to resolve, so
// the suites that need it skip instead of failing at module load.
const HOST_TEMPLATE_UTILS_DIR = path.resolve(__dirname, "..", "..", "..", "template-utils");
const HAS_HOST_TEMPLATE_UTILS = fs.existsSync(HOST_TEMPLATE_UTILS_DIR);
const HOST_TEMPLATE_UTILS = HAS_HOST_TEMPLATE_UTILS ? fs.realpathSync(HOST_TEMPLATE_UTILS_DIR) : HOST_TEMPLATE_UTILS_DIR;
const describeWithHost = HAS_HOST_TEMPLATE_UTILS ? describe : describe.skip;

let tmpRoot: string;

beforeEach(() => {
  __resetHostFirstResolutionForTests();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "m0saic-host-first-"));
});

afterEach(() => {
  __resetHostFirstResolutionForTests();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function write(file: string, contents: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

/** A checkout with a built entry and a PLANTED `@m0saic/template-utils`
 *  beside it. Evaluating the plant drops a marker file — the assertion. */
function writeRepoWithPlant(dir: string, plantDir = path.join(dir, "node_modules")): {
  entry: string;
  marker: string;
  plant: string;
} {
  const marker = path.join(dir, "PLANT-WAS-EVALUATED");
  const plant = write(
    path.join(plantDir, "@m0saic", "template-utils", "index.js"),
    `require("fs").writeFileSync(${JSON.stringify(marker)}, "evaluated");\n` +
      `throw new Error("planted @m0saic/template-utils was evaluated");\n`,
  );
  write(
    path.join(plantDir, "@m0saic", "template-utils", "package.json"),
    JSON.stringify({ name: "@m0saic/template-utils", main: "index.js" }),
  );
  const entry = write(
    path.join(dir, "dist", "index.js"),
    `const tu = require("@m0saic/template-utils");\n` +
      `module.exports = { where: require.resolve("@m0saic/template-utils"), hasDefine: typeof tu.defineMosaicTemplate };\n`,
  );
  return { entry, marker, plant };
}

describe("isHostScopedRequest", () => {
  it("matches @m0saic/<pkg> and @m0saic/<pkg>/<subpath> only", () => {
    expect(isHostScopedRequest("@m0saic/template-utils")).toBe(true);
    expect(isHostScopedRequest("@m0saic/platform/template-repos")).toBe(true);
    expect(isHostScopedRequest("@m0saic/types")).toBe(true);
    expect(isHostScopedRequest("@m0saic")).toBe(false);
    expect(isHostScopedRequest("@m0saic/")).toBe(false);
    expect(isHostScopedRequest("@m0saic-dev/x")).toBe(false);
    expect(isHostScopedRequest("sharp")).toBe(false);
    expect(isHostScopedRequest("@twemoji/svg")).toBe(false);
    expect(isHostScopedRequest("./m0saic/x")).toBe(false);
    expect(isHostScopedRequest("/abs/@m0saic/x")).toBe(false);
  });
});

describe("registerHostFirstRepoRoot", () => {
  it("installs the resolver wrapper once and keeps it across registrations", () => {
    const internals = Module as unknown as Internals;
    const before = internals._resolveFilename;
    registerHostFirstRepoRoot(path.join(tmpRoot, "a"));
    const hooked = internals._resolveFilename;
    expect(hooked).not.toBe(before);
    registerHostFirstRepoRoot(path.join(tmpRoot, "b"));
    installHostFirstResolution();
    expect(internals._resolveFilename).toBe(hooked);
    expect(registeredHostFirstRepoRoots().length).toBeGreaterThanOrEqual(2);
    __resetHostFirstResolutionForTests();
    expect(internals._resolveFilename).toBe(before);
  });

  it("stores roots realpath'd, so a symlinked checkout path still matches its real files", () => {
    const real = path.join(tmpRoot, "real-checkout");
    fs.mkdirSync(path.join(real, "dist"), { recursive: true });
    const link = path.join(tmpRoot, "linked-checkout");
    fs.symlinkSync(real, link, "dir");
    registerHostFirstRepoRoot(link);
    // Node hands the resolver REAL filenames — the real path must be in.
    expect(originatesUnderRegisteredRoot(path.join(fs.realpathSync(real), "dist", "index.js"))).toBe(true);
    // …and the literal (link) spelling too.
    expect(originatesUnderRegisteredRoot(path.join(link, "dist", "index.js"))).toBe(true);
    expect(originatesUnderRegisteredRoot(path.join(tmpRoot, "elsewhere", "index.js"))).toBe(false);
  });

  it("a file symlinked INTO the root from outside is not treated as repo code", () => {
    const repo = path.join(tmpRoot, "repo");
    fs.mkdirSync(path.join(repo, "dist"), { recursive: true });
    const outside = write(path.join(tmpRoot, "outside", "lib.js"), "module.exports = 1;\n");
    const linked = path.join(repo, "dist", "lib.js");
    fs.symlinkSync(outside, linked, "file");
    registerHostFirstRepoRoot(repo);
    // Node hands the resolver the file's REAL path (`outside/lib.js`), which
    // is not under the root — so the link grants nothing.
    expect(originatesUnderRegisteredRoot(fs.realpathSync(linked))).toBe(false);
  });
});

describeWithHost("host-first resolution through Node's real require", () => {
  it("a planted <checkout>/node_modules/@m0saic/template-utils is never evaluated — the host module wins", () => {
    const repo = path.join(tmpRoot, "planted");
    const { entry, marker, plant } = writeRepoWithPlant(repo);
    registerHostFirstRepoRoot(repo);

    const req = createRequire(entry);
    const mod = req(entry) as { where: string; hasDefine: string };

    expect(fs.existsSync(marker)).toBe(false);
    expect(mod.hasDefine).toBe("function");
    expect(fs.realpathSync(mod.where).startsWith(HOST_TEMPLATE_UTILS + path.sep)).toBe(true);
    expect(mod.where.startsWith(repo + path.sep)).toBe(false);
    expect(Object.keys((Module as unknown as Internals)._cache)).not.toContain(plant);
  });

  it("a plant under dist/node_modules (the entry's own directory) loses the same way", () => {
    const repo = path.join(tmpRoot, "planted-dist");
    const { entry, marker } = writeRepoWithPlant(repo, path.join(repo, "dist", "node_modules"));
    registerHostFirstRepoRoot(repo);
    const mod = createRequire(entry)(entry) as { where: string };
    expect(fs.existsSync(marker)).toBe(false);
    expect(fs.realpathSync(mod.where).startsWith(HOST_TEMPLATE_UTILS + path.sep)).toBe(true);
  });

  it("without the hook the same plant WOULD be evaluated (proves the test is real)", () => {
    const repo = path.join(tmpRoot, "unhooked");
    const { entry, marker } = writeRepoWithPlant(repo);
    // No registration → Node's ordinary walk finds the plant first.
    expect(() => createRequire(entry)(entry)).toThrow(/planted @m0saic\/template-utils was evaluated/);
    expect(fs.existsSync(marker)).toBe(true);
  });

  it("a repo OUTSIDE any workspace (no node_modules anywhere near) resolves @m0saic/template-utils via the host", () => {
    const repo = path.join(tmpRoot, "orphan");
    // tmpRoot is under os.tmpdir(): no node_modules on the walk up.
    const entry = write(
      path.join(repo, "dist", "index.js"),
      `const { defineMosaicTemplate } = require("@m0saic/template-utils");\n` +
        `const types = require("@m0saic/types");\n` +
        `module.exports = { ok: typeof defineMosaicTemplate === "function" && typeof types.asTemplateId === "function" };\n`,
    );
    const unhooked = createRequire(entry);
    expect(() => unhooked(entry)).toThrow(/Cannot find module '@m0saic\/template-utils'/);

    registerHostFirstRepoRoot(repo);
    const mod = createRequire(entry)(entry) as { ok: boolean };
    expect(mod.ok).toBe(true);
  });

  it("lazy requires made later, from a sub-module, at 'render time', still resolve host-first", () => {
    const repo = path.join(tmpRoot, "lazy");
    const { marker } = writeRepoWithPlant(repo);
    const sub = write(
      path.join(repo, "dist", "packs", "thing.js"),
      `exports.render = () => require("@m0saic/template-utils").defineMosaicTemplate;\n`,
    );
    registerHostFirstRepoRoot(repo);
    const mod = createRequire(sub)(sub) as { render: () => unknown };
    // Nothing resolved at load time; the require happens inside render().
    expect(typeof mod.render()).toBe("function");
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("leaves non-@m0saic requests and relative paths to the checkout's own walk", () => {
    const repo = path.join(tmpRoot, "others");
    write(path.join(repo, "node_modules", "left-pad", "index.js"), 'module.exports = "checkout-left-pad";\n');
    write(path.join(repo, "node_modules", "left-pad", "package.json"), '{"name":"left-pad","main":"index.js"}');
    write(path.join(repo, "dist", "helper.js"), 'module.exports = "helper";\n');
    const entry = write(
      path.join(repo, "dist", "index.js"),
      `module.exports = { lp: require("left-pad"), h: require("./helper"), sharp: (() => { try { require("sharp-does-not-exist"); return "found"; } catch (e) { return e.code; } })() };\n`,
    );
    registerHostFirstRepoRoot(repo);
    const mod = createRequire(entry)(entry) as { lp: string; h: string; sharp: string };
    expect(mod.lp).toBe("checkout-left-pad");
    expect(mod.h).toBe("helper");
    expect(mod.sharp).toBe("MODULE_NOT_FOUND");
  });

  it("the real Module was patched (not Jest's copy) and host code stays on the ordinary walk", () => {
    registerHostFirstRepoRoot(path.join(tmpRoot, "some-repo"));
    // Jest's sandbox copy of Module is what `import Module from "node:module"`
    // gives test code; the hook must live on the REAL one underneath it.
    const jestCopy = require("node:module") as unknown as Internals;
    const real = Module as unknown as Internals;
    expect(jestCopy).not.toBe(real);
    // The real one is the end of the chain: nothing above it owns a resolver.
    expect(Object.prototype.hasOwnProperty.call(Object.getPrototypeOf(real), "_resolveFilename")).toBe(false);
    expect(Object.getPrototypeOf(jestCopy)).toBe(real);
    expect((real._resolveFilename as { name: string }).name).toBe("hookedResolveFilename");
    // Host code (this file is not under any root) resolves as before.
    const here = createRequire(__filename);
    expect(fs.realpathSync(here.resolve("@m0saic/template-utils")).startsWith(HOST_TEMPLATE_UTILS + path.sep)).toBe(true);
  });

  it("a checkout whose package.json self-names @m0saic/template-utils with exports cannot self-resolve", () => {
    // Node's `trySelf` would answer a bare request with the requesting
    // package's OWN exports when the names match. The host anchor parent
    // used for the override is not under the checkout, so that route is shut.
    const repo = path.join(tmpRoot, "self-named");
    const marker = path.join(repo, "SELF-WAS-EVALUATED");
    write(
      path.join(repo, "package.json"),
      JSON.stringify({ name: "@m0saic/template-utils", exports: { ".": "./self.js" } }),
    );
    write(path.join(repo, "self.js"), `require("fs").writeFileSync(${JSON.stringify(marker)}, "x"); throw new Error("self-resolved");\n`);
    const entry = write(path.join(repo, "dist", "index.js"), `module.exports = require.resolve("@m0saic/template-utils");\n`);
    registerHostFirstRepoRoot(repo);
    const where = createRequire(entry)(entry) as string;
    expect(fs.existsSync(marker)).toBe(false);
    expect(fs.realpathSync(where).startsWith(HOST_TEMPLATE_UTILS + path.sep)).toBe(true);
  });

  it("resolveFromHost answers from the host regardless of any root", () => {
    expect(fs.realpathSync(resolveFromHost("@m0saic/template-utils")).startsWith(HOST_TEMPLATE_UTILS + path.sep)).toBe(true);
    expect(() => resolveFromHost("@m0saic/this-package-does-not-exist")).toThrow(/Cannot find module/);
  });
});
