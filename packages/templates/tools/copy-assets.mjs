// Mirror every "assets" subdir under src/ into dist/ after tsc.
//
// The qr-stamp video template (and any future templates) load static
// PNGs / SVGs from a sibling "assets" dir via `__dirname`. tsc doesn't
// copy non-TS files, so we mirror the asset tree manually here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkgRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(pkgRoot, "src");
const distRoot = path.join(pkgRoot, "dist");

let copied = 0;

function copyAssetsDir(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(dstDir, { recursive: true });
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, ent.name);
    const d = path.join(dstDir, ent.name);
    if (ent.isDirectory()) {
      copyAssetsDir(s, d);
    } else {
      fs.copyFileSync(s, d);
      copied += 1;
    }
  }
}

function walk(srcDir, distDir) {
  if (!fs.existsSync(srcDir)) return;
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const s = path.join(srcDir, ent.name);
    const d = path.join(distDir, ent.name);
    if (ent.name === "assets") {
      copyAssetsDir(s, d);
    } else {
      walk(s, d);
    }
  }
}

walk(srcRoot, distRoot);

console.log(`✅ Mirrored ${copied} asset file(s) from src → dist.`);
