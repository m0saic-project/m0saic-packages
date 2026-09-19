#!/usr/bin/env ts-node

import * as fs from "fs";
import * as path from "path";

function prettyMosaic(input: string): string {
  const src = input.replace(/\s+/g, ""); // strip existing whitespace
  let out = "";
  let indent = 0;

  const pad = () => "  ".repeat(indent); // 2-space indent

  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === "(" || ch === "[") {
      // e.g. "64(" stays on same line
      out += ch + "\n";
      indent++;
      out += pad();
      i++;
      continue;
    }

    if (ch === ",") {
      out += ",\n" + pad();
      i++;
      continue;
    }

    if (ch === ")" || ch === "]") {
      indent--;
      // look ahead: if next non-space is a comma, keep it on this line
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j++;
      const next = src[j];

      out += "\n" + pad() + ch;

      if (next === ",") {
        out += ",";
        i = j + 1; // skip the comma we just consumed
        out += "\n" + pad();
      } else {
        i++;
      }
      continue;
    }

    // digits, 0, 1, etc.
    out += ch;
    i++;
  }

  return out.trim() + "\n";
}

function main() {
  const [, , inputPathArg, outputPathArg] = process.argv;
  if (!inputPathArg || !outputPathArg) {
    console.error("Usage: pretty-m0saic <inputFlat> <outputPretty>");
    process.exit(1);
  }

  const inputPath = path.resolve(inputPathArg);
  const outputPath = path.resolve(outputPathArg);

  const flat = fs.readFileSync(inputPath, "utf8");
  const pretty = prettyMosaic(flat);

  fs.writeFileSync(outputPath, pretty, "utf8");
  console.log(`✅ Wrote pretty m0saic to ${outputPath}`);
}

main();
