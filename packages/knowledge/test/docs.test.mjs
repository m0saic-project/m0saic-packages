// Node built-ins only — this runs in the public mirror, where nothing is
// installed. `--build` is the package's build step: the same checks, as a
// one-shot gate (there is nothing to compile; the docs are generated upstream).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = path.join(ROOT, "docs");

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

const checks = {
  "docs/ is present with the front door and the three shelves": () => {
    for (const f of ["README.md", "m0saic-thesis.md", "handbook/README.md", "skills/README.md", "templates/README.md"]) {
      assert.ok(fs.existsSync(path.join(DOCS, f)), `missing docs/${f}`);
    }
  },
  "no reference to private code or the maintainers' internal docs survives": () => {
    const re = /(^|[^/\w])\.ai\/(?!moat\/)|packages\/(?:core|cli|product|types-internal)\b|apps\/mosaic/;
    for (const f of walk(DOCS).filter((p) => p.endsWith(".md"))) {
      const text = fs.readFileSync(f, "utf8");
      assert.ok(!re.test(text), `${path.relative(ROOT, f)} references private code`);
    }
  },
  "every relative markdown link resolves inside docs/": () => {
    const linkRe = /\]\(([^)#\s]+)(?:#[^)]*)?\)/g;
    const broken = [];
    for (const f of walk(DOCS).filter((p) => p.endsWith(".md"))) {
      const text = fs.readFileSync(f, "utf8");
      let m;
      while ((m = linkRe.exec(text))) {
        const target = m[1];
        if (/^[a-z]+:/i.test(target)) continue;
        const abs = path.resolve(path.dirname(f), target);
        if (!fs.existsSync(abs)) broken.push(`${path.relative(ROOT, f)} → ${target}`);
      }
    }
    assert.deepEqual(broken, []);
  },
};

if (process.argv.includes("--build")) {
  // The build: the entry point is copied src/ → dist/ (nothing to compile;
  // the content is docs/), then the same checks run as a one-shot gate.
  const dist = path.join(ROOT, "dist");
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  for (const f of ["index.js", "index.d.ts"]) fs.copyFileSync(path.join(ROOT, "src", f), path.join(dist, f));
  console.log("✓ dist/index.js + index.d.ts written from src/");
  for (const [name, fn] of Object.entries(checks)) { fn(); console.log(`✓ ${name}`); }
} else {
  for (const [name, fn] of Object.entries(checks)) test(name, fn);
}
