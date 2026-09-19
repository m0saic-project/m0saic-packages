const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "src");
const dist = path.join(root, "dist");

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

const files = walk(src).filter(f =>
  f.endsWith(".m0") ||
  f.endsWith(".m0c") ||
  f.endsWith("metadata.json") ||
  f.endsWith("m0saic_pretty.txt") ||
  f.endsWith("m0saic_tree.txt") ||
  f.endsWith("m0saic_visual.txt") ||
  f.endsWith("m0saic_visual_art.txt") ||
  f.endsWith("m0saic_visual_areas.txt") ||
  f.endsWith("_ranks.json") ||
  f.endsWith("_masks.json") ||
  f.endsWith(path.sep + "masks.json") ||
  f.endsWith("preview.png") ||
  f.match(/wireframe_\d+x\d+\.mp4$/)
);

for (const file of files) {
  const rel = path.relative(src, file);
  const outFile = path.join(dist, rel);
  ensureDir(path.dirname(outFile));
  fs.copyFileSync(file, outFile);
}

console.log(`Copied ${files.length} dictionary assets to dist/`);
