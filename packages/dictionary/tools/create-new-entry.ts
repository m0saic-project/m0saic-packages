#!/usr/bin/env ts-node

import * as fs from "fs";
import * as path from "path";
import { parseM0File } from "@m0saic/dsl-file-formats";
import { getFrameCount } from "@m0saic/dsl";

type CliOptions = {
  group: string; // folder path under src/entries/, e.g. "grids" or "layouts/social"
  slug: string;  // folder name for this entry, e.g. "2x2-grid"
  pattern: string | null; // e.g. '2[2(1,1),2(1,1)]'  — null when using --m0
  m0FilePath: string | null; // path to an existing .m0 file
};

function usage(): never {
  console.error("Usage:");
  console.error('  dictionary:new <group> <slug> <pattern-or-m0-file>');
  console.error("");
  console.error("Examples:");
  console.error('  dictionary:new grids 2x2-grid "2[2(1,1),2(1,1)]"');
  console.error("  dictionary:new brand m-33 ./my-pattern.m0");
  process.exit(1);
}

function isM0File(arg: string): boolean {
  return arg.endsWith(".m0") && fs.existsSync(path.resolve(arg));
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);

  const group = args[0];
  const slug = args[1];
  if (!group || !slug) usage();

  // --m0 flag (explicit)
  const m0FlagIndex = args.indexOf("--m0");
  if (m0FlagIndex !== -1) {
    const m0FilePath = args[m0FlagIndex + 1];
    if (!m0FilePath) {
      console.error("❌ --m0 flag requires a file path argument");
      process.exit(1);
    }
    return { group, slug, pattern: null, m0FilePath };
  }

  const third = args[2];
  if (!third) usage();

  // auto-detect: if third arg ends in .m0 and exists on disk, treat as file
  if (isM0File(third)) {
    return { group, slug, pattern: null, m0FilePath: third };
  }

  return { group, slug, pattern: third, m0FilePath: null };
}

function resolveAspectRatio(w: number, h: number) {
  const ratio = w / h;
  // common aspect ratios
  const known: { r: number; label: string }[] = [
    { r: 1, label: "1:1" },
    { r: 16 / 9, label: "16:9" },
    { r: 9 / 16, label: "9:16" },
    { r: 4 / 3, label: "4:3" },
    { r: 3 / 4, label: "3:4" },
    { r: 4 / 5, label: "4:5" },
  ];
  const match = known.find((k) => Math.abs(k.r - ratio) < 0.01);
  const label = match ? match.label : `${w}:${h}`;
  const tolerance = 0.05;
  return {
    ideal: ratio,
    label,
    mode: "warn" as const,
    min: ratio * (1 - tolerance),
    max: ratio * (1 + tolerance),
  };
}

/**
 * Append a lazy-loaded entry to src/browser.ts so the browser bundle
 * can discover and async-resolve it.
 */
function appendToBrowserTs(entry: {
  id: string;
  title: string;
  m0File: string;
  sourceCount: number;
  description: string;
  category: string;
}) {
  const rootDir = path.resolve(__dirname, "..");
  const browserPath = path.join(rootDir, "src", "browser.ts");
  const content = fs.readFileSync(browserPath, "utf8");

  // Build the new entry object literal
  const newEntry = [
    `  {`,
    `    id: ${JSON.stringify(entry.id)},`,
    `    title: ${JSON.stringify(entry.title)},`,
    `    m0saic: "",`,
    `    m0File: ${JSON.stringify(entry.m0File)},`,
    `    sourceCount: ${entry.sourceCount},`,
    `    description: ${JSON.stringify(entry.description)},`,
    `    category: ${JSON.stringify(entry.category)},`,
    `    tags: [],`,
    `  },`,
  ].join("\n");

  // Insert before the closing "];" of the ENTRIES array
  const marker = "\n];";
  const idx = content.indexOf(marker);
  if (idx === -1) {
    console.warn("⚠️  Could not find ENTRIES array end in browser.ts — skipping browser registration");
    return;
  }

  const updated = content.slice(0, idx) + "\n" + newEntry + marker + content.slice(idx + marker.length);
  fs.writeFileSync(browserPath, updated, "utf8");
}

function createFromM0(group: string, slug: string, m0FilePath: string) {
  const resolvedM0 = path.resolve(m0FilePath);
  if (!fs.existsSync(resolvedM0)) {
    console.error(`❌ .m0 file not found: ${resolvedM0}`);
    process.exit(1);
  }

  const rootDir = path.resolve(__dirname, "..");
  const entriesDir = path.join(rootDir, "src", "entries");
  const groupPath = path.join(...group.split("/"));
  const entryDir = path.join(entriesDir, groupPath, slug);

  if (fs.existsSync(entryDir)) {
    console.error(`❌ Entry folder already exists: ${entryDir}`);
    process.exit(1);
  }

  fs.mkdirSync(entryDir, { recursive: true });

  // parse .m0 file to extract data
  const m0Text = fs.readFileSync(resolvedM0, "utf8");
  const m0 = parseM0File(m0Text);
  const sourceCount = getFrameCount(m0.m0saic);
  if (sourceCount == null) {
    console.error("❌ Could not determine frame count from .m0 pattern (invalid DSL?)");
    process.exit(1);
  }

  // copy .m0 file
  fs.copyFileSync(resolvedM0, path.join(entryDir, "m0saic.m0"));

  const groupSegments = group.split("/");
  const category = groupSegments[groupSegments.length - 1] || "misc";

  // derive aspect ratio from .m0 size header (or default to 1:1)
  const aspectRatio = m0.size
    ? resolveAspectRatio(m0.size.width, m0.size.height)
    : resolveAspectRatio(1, 1);

  // derive recommended resolutions from size
  const recommendedResolutions = m0.size
    ? [
        { width: m0.size.width, height: m0.size.height },
        { width: m0.size.width * 2, height: m0.size.height * 2 },
      ]
    : [
        { width: 1920, height: 1080 },
        { width: 1080, height: 1080 },
      ];

  // pull title from .m0 meta, or derive from slug
  const title = m0.meta?.title || slug;

  // auto-generate description from what we know
  const sizeDesc = m0.size ? `${m0.size.width}x${m0.size.height} ` : "";
  const description = `${sizeDesc}m0saic pattern with ${sourceCount} source frames.`;

  // --- metadata.json ---
  const metadata = {
    id: `${group}/${slug}`,
    title,
    sourceCount,
    description,
    category,
    tags: [] as string[],
    emphasizeAllEqually: false,
    aspectRatio,
    recommendedResolutions,
    artifacts: {
      pretty: false,
      tree: false,
    },
  };

  fs.writeFileSync(
    path.join(entryDir, "metadata.json"),
    JSON.stringify(metadata, null, 2) + "\n",
    "utf8"
  );

  // --- m0saic.ts ---
  const m0saicTs = `import fs from "fs";
import path from "path";
import { parseM0File } from "@m0saic/dsl-file-formats";

const filePath = path.join(__dirname, "m0saic.m0");

if (!fs.existsSync(filePath)) {
  throw new Error(
    [
      \`Missing dictionary asset: \${filePath}\`,
      \`This usually means the dictionary build did not copy .m0 files into dist/.\`,
      \`Fix: ensure packages/dictionary build runs a copy step (e.g. copy src/**/*.m0 -> dist/**).\`,
    ].join("\\n")
  );
}

export const m0saic = parseM0File(fs.readFileSync(filePath, "utf8")).m0;

export default m0saic;
`;

  fs.writeFileSync(path.join(entryDir, "m0saic.ts"), m0saicTs, "utf8");

  // --- index.ts ---
  const indexTs = `import metadataJson from "./metadata.json";
import { m0saic } from "./m0saic";
import type { MosaicDictionaryEntry } from "@m0saic/types";

const metadata = metadataJson as unknown as Omit<MosaicDictionaryEntry, "m0saic">;

export const entry: MosaicDictionaryEntry = {
  ...metadata,
  m0saic,
};

export default entry;
`;

  fs.writeFileSync(path.join(entryDir, "index.ts"), indexTs, "utf8");

  // --- browser.ts ---
  // Add lazy-loaded entry to the browser bundle
  appendToBrowserTs({
    id: metadata.id,
    title: metadata.title,
    m0File: `entries/${group}/${slug}/m0saic.m0`,
    sourceCount,
    description: metadata.description,
    category: metadata.category,
  });

  console.log("✅ Created dictionary entry (from .m0)");
  console.log(`   group:        ${group}`);
  console.log(`   slug:         ${slug}`);
  console.log(`   id:           ${metadata.id}`);
  console.log(`   sourceCount:  ${sourceCount}`);
  console.log(`   size:         ${m0.size ? `${m0.size.width}x${m0.size.height}` : "(not specified)"}`);
  console.log(`   aspectRatio:  ${metadata.aspectRatio.label}`);
  console.log(`   folder:       ${entryDir}`);
}

function createFromPattern(group: string, slug: string, pattern: string) {
  const rootDir = path.resolve(__dirname, "..");
  const entriesDir = path.join(rootDir, "src", "entries");
  const groupPath = path.join(...group.split("/"));
  const entryDir = path.join(entriesDir, groupPath, slug);

  if (fs.existsSync(entryDir)) {
    console.error(`❌ Entry folder already exists: ${entryDir}`);
    process.exit(1);
  }

  fs.mkdirSync(entryDir, { recursive: true });

  const groupSegments = group.split("/");
  const category = groupSegments[groupSegments.length - 1] || "misc";

  // --- m0saic_flat.txt ---
  fs.writeFileSync(
    path.join(entryDir, "m0saic_flat.txt"),
    pattern + "\n",
    "utf8"
  );

  // --- m0saic_pretty.txt ---
  fs.writeFileSync(
    path.join(entryDir, "m0saic_pretty.txt"),
    pattern + "\n",
    "utf8"
  );

  // --- m0saic_tree.txt ---
  const treeStub = `// TODO: replace with tree view for:
// ${pattern}
`;
  fs.writeFileSync(
    path.join(entryDir, "m0saic_tree.txt"),
    treeStub,
    "utf8"
  );

  // --- metadata.json ---
  const sourceCount = getFrameCount(pattern);
  const sc = sourceCount ?? 0;
  const metadata = {
    id: `${group}/${slug}`,
    title: slug,
    sourceCount: sc,
    description: `m0saic pattern with ${sc} source frames.`,
    category,
    tags: [] as string[],
    emphasizeAllEqually: false,
    aspectRatio: {
      ideal: 1.7777777777777777,
      label: "16:9",
      mode: "warn",
      min: 1.6,
      max: 2.0,
    },
    recommendedResolutions: [
      { width: 1920, height: 1080 },
      { width: 1080, height: 1080 },
    ],
  };

  fs.writeFileSync(
    path.join(entryDir, "metadata.json"),
    JSON.stringify(metadata, null, 2) + "\n",
    "utf8"
  );

  // --- index.ts ---
  const indexTs = `import metadata from "./metadata.json";

export const entry = metadata;
export default entry;
`;

  fs.writeFileSync(path.join(entryDir, "index.ts"), indexTs, "utf8");

  console.log("✅ Created dictionary entry");
  console.log(`   group:       ${group}`);
  console.log(`   slug:        ${slug}`);
  console.log(`   id:          ${metadata.id}`);
  console.log(`   sourceCount: ${sourceCount ?? "⚠️  could not determine (invalid pattern?)"}`);
  console.log(`   pattern:     ${pattern}`);
  console.log(`   folder:      ${entryDir}`);
}

function main() {
  const { group, slug, pattern, m0FilePath } = parseArgs();

  if (m0FilePath) {
    createFromM0(group, slug, m0FilePath);
  } else {
    createFromPattern(group, slug, pattern!);
  }
}

main();
