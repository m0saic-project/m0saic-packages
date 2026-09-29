/**
 * What an m0saic artifact is MADE OF — the classification half of "which
 * versions do I have?".
 *
 * The CLI and Desktop both BUNDLE their whole `@m0saic/*` closure and pin every
 * version, which is what makes a shipped artifact immune to anything published
 * later. That guarantee is only useful if the artifact can say what it contains,
 * and until 2026-09-26 neither could: `m0saic versions` named five of the CLI's
 * eleven packages (`template-utils` — the convention gate — among the missing)
 * and Desktop had no surface at all.
 *
 * Resolution stays with the HOST (each resolves versions from its own
 * `node_modules`, which is the only truthful source). What lives here is the
 * part that would otherwise drift in two places: which repo a package publishes
 * from, and which tier it belongs to.
 */

/**
 * The four tiers a reader thinks in.
 *
 * `community` is the catalog, not substrate (founder, 2026-09-26): the two
 * community packages are seeded into Desktop at mint time, but the LIVE copy
 * comes from GitHub — signed tagged releases for the templates, the head of
 * `main` for the Community M data. Their npm copies lag by design, so the
 * repo is the link that matters. The CLI bundles neither.
 */
export type MosaicPackageTier = "language" | "substrate" | "product" | "community";

export type MosaicPackageInfo = {
  name: string;
  tier: MosaicPackageTier;
  /** False for the moat — those ship inside artifacts and publish nowhere. */
  published: boolean;
  /** npm page, when npm is the transport. */
  npmUrl?: string;
  /** Public source, when there is one. */
  repoUrl?: string;
};

const LANGUAGE_REPO = "https://github.com/m0saic-dsl/m0";
const SUBSTRATE_REPO = "https://github.com/m0saic-project/m0saic-packages";

/** The language: self-contained, its own semver per package. */
const LANGUAGE = ["dsl", "dsl-stdlib", "dsl-file-formats", "dsl-visual-tests"];

/** The substrate: the lockstep set, versioned with the CLI line, plus the
 *  vocabulary and data packages that publish on their own clocks. */
const SUBSTRATE = [
  "types", "platform", "text", "template-utils", "dictionary", "dsl-react",
  "templates", "momo-types", "knowledge",
];

/** The community catalog: each package IS its public repo (the founder mints
 *  and signs it from the monorepo), and GitHub — not npm — is the transport
 *  hosts update from. */
const COMMUNITY: Readonly<Record<string, string>> = {
  "community-templates": "https://github.com/m0saic-project/m0saic-community-templates",
  "community-m": "https://github.com/m0saic-project/community-m",
};

const npmUrl = (name: string): string => `https://www.npmjs.com/package/${name}`;

/**
 * Classify one `@m0saic/*` package. Anything not in the published lists is the
 * MOAT (core, cli, product, types-internal, momo, sandbox …): it ships inside
 * the artifact and publishes nowhere, so it links nowhere rather than linking
 * to a 404.
 */
export function describeMosaicPackage(name: string): MosaicPackageInfo {
  const short = name.startsWith("@m0saic/") ? name.slice("@m0saic/".length) : name;
  if (LANGUAGE.includes(short)) {
    return { name, tier: "language", published: true, npmUrl: npmUrl(name), repoUrl: LANGUAGE_REPO };
  }
  if (SUBSTRATE.includes(short)) {
    return { name, tier: "substrate", published: true, npmUrl: npmUrl(name), repoUrl: SUBSTRATE_REPO };
  }
  if (short in COMMUNITY) {
    return { name, tier: "community", published: true, repoUrl: COMMUNITY[short] };
  }
  return { name, tier: "product", published: false };
}

/** Tier order for display: the language, what templates compile against, the
 *  product that ships around them, then the catalog seeded on top. */
export const MOSAIC_PACKAGE_TIER_ORDER: readonly MosaicPackageTier[] = ["language", "substrate", "product", "community"];

/** One human label per tier. */
export const MOSAIC_PACKAGE_TIER_LABEL: Readonly<Record<MosaicPackageTier, string>> = {
  language: "Language",
  substrate: "Substrate",
  product: "Product (bundled, not published)",
  community: "Community (seeded; updates from GitHub)",
};

/** Sort a bundled list for display: by tier, then by name. */
export function sortMosaicPackages<T extends { name: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    const ta = MOSAIC_PACKAGE_TIER_ORDER.indexOf(describeMosaicPackage(a.name).tier);
    const tb = MOSAIC_PACKAGE_TIER_ORDER.indexOf(describeMosaicPackage(b.name).tier);
    return ta - tb || a.name.localeCompare(b.name);
  });
}
