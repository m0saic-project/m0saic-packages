import fs from "fs";
import path from "path";
import { parseM0File } from "@m0saic/dsl-file-formats";

const filePath = path.join(__dirname, "m0saic.m0");

if (!fs.existsSync(filePath)) {
  throw new Error(
    [
      `Missing dictionary asset: ${filePath}`,
      `This usually means the dictionary build did not copy .m0 files into dist/.`,
      `Fix: ensure packages/dictionary build runs a copy step (e.g. copy src/**/*.m0 -> dist/**).`,
    ].join("\n")
  );
}

export const m0saic = parseM0File(fs.readFileSync(filePath, "utf8")).m0;

export default m0saic;
