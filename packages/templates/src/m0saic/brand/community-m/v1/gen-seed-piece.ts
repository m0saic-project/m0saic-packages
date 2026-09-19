/**
 * Write the founder's seed piece — `ms/001/root/piece.mosaic` in the bundled
 * `@m0saic/community-m` package — from `buildSeedPiece()`.
 *
 * Usage:  node dist/m0saic/brand/community-m/v1/gen-seed-piece.js
 *
 * Then, from `packages/community-m`, re-pin the claim record and rebuild the
 * index (the public repo's own tools):
 *   node tools/new-slot.mjs --m 001 --root --regen && node tools/assemble.mjs && node tools/validate.mjs
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { seedCommunityDir } from "./paths";
import { seedPieceJson } from "./seedPiece";

const out = path.join(seedCommunityDir(), "ms", "001", "root", "piece.mosaic");
const next = seedPieceJson();
const prev = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : null;
if (prev === next) {
  console.log(`[gen-seed-piece] unchanged: ${out}`);
} else {
  fs.writeFileSync(out, next);
  console.log(`[gen-seed-piece] wrote ${out} (${next.length} chars) — re-pin: cd packages/community-m && node tools/new-slot.mjs --m 001 --root --regen && node tools/assemble.mjs`);
}
