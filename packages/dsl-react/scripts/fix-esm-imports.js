#!/usr/bin/env node
/**
 * Post-build: fix relative imports in ESM output to include .js extensions.
 * Node.js ESM requires explicit file extensions; TypeScript doesn't emit them.
 */
const fs = require("fs");
const path = require("path");

const ESM_DIR = path.join(__dirname, "..", "dist", "esm");

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

function fixImports(filePath) {
  let content = fs.readFileSync(filePath, "utf8");
  const dir = path.dirname(filePath);

  // Match: from "./foo" or export * from "./bar"
  content = content.replace(
    /(from\s+["'])(\.\.?\/[^"']+)(["'])/g,
    (match, pre, specifier, post) => {
      // Already has a RESOLVABLE extension. `/\.\w+$/` was too greedy: a
      // dotted BASENAME like "./mTiles.generated" matched it, so the rewrite
      // was skipped and the ESM build emitted an unresolvable specifier
      // (platform shipped exactly that). Only real module extensions count —
      // everything else is part of the filename.
      // `.node` deliberately NOT listed: no package here imports a native
      // addon by relative specifier, while `foo.node.ts` / `foo.web.ts` IS an
      // established variant-naming convention in this repo — treating it as
      // an extension would reintroduce the same bug under a different name.
      if (/\.(?:js|mjs|cjs|json)$/.test(specifier)) return match;

      // Check if it's a directory (needs /index.js)
      const asDir = path.resolve(dir, specifier);
      if (fs.existsSync(asDir) && fs.statSync(asDir).isDirectory()) {
        return `${pre}${specifier}/index.js${post}`;
      }

      // Otherwise add .js
      return `${pre}${specifier}.js${post}`;
    }
  );

  fs.writeFileSync(filePath, content);
}

const files = walk(ESM_DIR);
for (const f of files) fixImports(f);
console.log(`Fixed ESM imports in ${files.length} files.`);
