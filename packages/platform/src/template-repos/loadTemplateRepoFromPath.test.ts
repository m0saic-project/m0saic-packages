// covers: external template-repo entry resolution + the load-failure
// diagnostics.
//
// NOTE: the RELOAD behavior (rebuild → refresh serving fresh code) is NOT
// tested here. It hinges on Node's real ESM module cache, and Jest's VM
// rejects a native dynamic import ("A dynamic import callback was invoked
// without --experimental-vm-modules") — so a Jest test of it would either
// fail or, worse, pass against a stubbed importer that skips the exact cache
// being exercised. Those assertions live in
// `packages/platform/__tests__/templateRepoReload.test.js`, which runs under
// `node --test` against the built package.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  loadTemplateRepoFromPath,
  resolveTemplateRepoEntry,
} from "./loadTemplateRepoFromPath";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "m0saic-repo-test-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeDir(...segments: string[]): string {
  const dir = path.join(tmpRoot, ...segments);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(file: string, contents = ""): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

describe("resolveTemplateRepoEntry", () => {
  it("prefers dist/index.js — the conventional built entry", () => {
    const dir = makeDir("dist-index");
    const entry = writeFile(path.join(dir, "dist", "index.js"));

    expect(resolveTemplateRepoEntry(dir).entryPath).toBe(entry);
  });

  it("falls back to dist/index.mjs when there is no .js", () => {
    const dir = makeDir("dist-mjs");
    const entry = writeFile(path.join(dir, "dist", "index.mjs"));

    expect(resolveTemplateRepoEntry(dir).entryPath).toBe(entry);
  });

  it("honors package.json main when dist/ has no index", () => {
    const dir = makeDir("pkg-main");
    const entry = writeFile(path.join(dir, "build", "entry.js"));
    writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ main: "build/entry.js" }),
    );

    expect(resolveTemplateRepoEntry(dir).entryPath).toBe(entry);
  });

  it("lets an explicit override beat every convention", () => {
    const dir = makeDir("override");
    writeFile(path.join(dir, "dist", "index.js"));
    const custom = writeFile(path.join(dir, "custom", "entry.js"));

    const res = resolveTemplateRepoEntry(dir, {
      entryOverridePath: "custom/entry.js",
    });
    expect(res.entryPath).toBe(custom);
  });

  it("lets the manifest entry beat dist/index.js", () => {
    const dir = makeDir("manifest-entry");
    writeFile(path.join(dir, "dist", "index.js"));
    const fromManifest = writeFile(path.join(dir, "out", "bundle.js"));

    const res = resolveTemplateRepoEntry(dir, {
      manifestEntry: "out/bundle.js",
    });
    expect(res.entryPath).toBe(fromManifest);
  });

  it("reports the candidates it checked when nothing resolves", () => {
    const dir = makeDir("nothing");

    const res = resolveTemplateRepoEntry(dir);
    expect(res.entryPath).toBeUndefined();
    expect(res.candidates.length).toBeGreaterThan(0);
    expect(res.candidates.some((c) => c.endsWith(path.join("dist", "index.js")))).toBe(
      true,
    );
  });
});

describe("loadTemplateRepoFromPath diagnostics", () => {
  it("errors when the path does not exist", async () => {
    const res = await loadTemplateRepoFromPath(path.join(tmpRoot, "nope"));

    expect(res.templates).toEqual([]);
    expect(
      res.diagnostics.some((d) => d.code === "TEMPLATE_REPO_NOT_FOUND"),
    ).toBe(true);
  });

  // The everyday author mistake: added the source before running the build.
  it("errors with a build hint when the repo is unbuilt", async () => {
    const dir = makeDir("unbuilt");

    const res = await loadTemplateRepoFromPath(dir);

    expect(res.templates).toEqual([]);
    const d = res.diagnostics.find(
      (x) => x.code === "TEMPLATE_REPO_MISSING_BUILD",
    );
    expect(d).toBeDefined();
    expect(d?.message).toMatch(/build step/i);
  });

  it("rejects an unsupported manifest schemaVersion without importing", async () => {
    const dir = makeDir("bad-schema");
    writeFile(path.join(dir, "dist", "index.js"));
    writeFile(
      path.join(dir, "template-manifest.json"),
      JSON.stringify({ schemaVersion: 99 }),
    );

    const res = await loadTemplateRepoFromPath(dir);

    expect(res.templates).toEqual([]);
    expect(
      res.diagnostics.some(
        (d) => d.code === "TEMPLATE_REPO_UNSUPPORTED_SCHEMA",
      ),
    ).toBe(true);
  });

  it("surfaces a malformed manifest as a parse-error diagnostic", async () => {
    const dir = makeDir("bad-json");
    writeFile(path.join(dir, "template-manifest.json"), "{ not json");

    const res = await loadTemplateRepoFromPath(dir);

    expect(
      res.diagnostics.some(
        (d) => d.code === "TEMPLATE_REPO_MANIFEST_PARSE_ERROR",
      ),
    ).toBe(true);
  });
});
