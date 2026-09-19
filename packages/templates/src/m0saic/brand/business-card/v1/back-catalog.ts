/**
 * @m0saic/brand/business-card/v1 — the back-of-card catalog.
 *
 * The back shows ONE shipped template, picked by the `back` prop. Every
 * entry is rendered LIVE as a nested child (never a bundled poster — the
 * publish gate keeps `assets/templates/*` out of the CLI tarball), so each
 * entry must (a) be registered in the web build too (the QR opens it on
 * Mosaic Web) and (b) freeze to a finished frame at t = 0: a still samples
 * the first frame, and an intro that starts from nothing renders blank.
 * `frozenProps` flips the same knobs the editor covers use (`anim.reduceMotion`
 * / `animation.reduceMotion` / `animate`).
 *
 * Hardcoded on purpose: `template-registry.ts` is 700 lines of data and would
 * ride into the web bundle; `back-catalog.test.ts` cross-checks every row
 * against it instead.
 */

export const WEB_APP_URL = "https://app.m0saic.io";
/** The marketing site — owner of the typeable short links the card prints. */
export const SITE_HOST = "m0saic.io";

export type BackEntry = {
  /** The template rendered on the back. */
  templateId: string;
  /** Short display title (ASCII — svg glyphs). */
  title: string;
  /** Prop overrides layered over the template's defaults (light flavour only). */
  flavour?: Record<string, unknown>;
  /** The one-liner printed under the link. Default `npx m0saic make <id>`. */
  command?: string;
  /** The typeable url as printed. Default `m0saic.io/t/<pack>/<slug>/<vN>` (the site's route). */
  typeable?: string;
  /**
   * Canvas the child renders at. Default: its own `outputHints` (the canvas its
   * layout was designed for). `"cell"` = the poster cell itself — for a
   * template whose layout is ABSOLUTE at the head (hello-world's card is
   * `placeRects`): rendered at its native 1920x1080 and scaled into the cell
   * its pixel-basis splits go sub-pixel when the editor flattens the card.
   */
  slot?: { width: number; height: number } | "cell";
};

export const BACK_KEYS = [
  "hello-world",
  "agent-commit-feed",
  "trace-timeline",
  "year-card",
  "commit-feed",
  "donut",
  "bar-graph",
  "line-chart",
  "kpi-card",
  "heatmap",
  "treemap",
  "leaderboard",
  "timeline",
  "contributor-table",
  "snippet-morph",
] as const;
export type BackKey = (typeof BACK_KEYS)[number];

export const BACK_CATALOG: Record<BackKey, BackEntry> = {
  "hello-world": {
    templateId: "@m0saic/hello-world/v1",
    title: "Hello, World",
    command: "npx m0saic hello-world",
    typeable: `${SITE_HOST}/hello`, // next.config.ts redirect — the showroom's own hand-off line
    slot: "cell",
  },
  // The WeAreDevelopers NA card for the AI-coding majority: who wrote this week's commits.
  "agent-commit-feed": { templateId: "@m0saic/agents/commit-feed/v1", title: "Agent Commit Feed" },
  // The "agents in production" card: one run as a waterfall of tool calls.
  "trace-timeline": { templateId: "@m0saic/agents/trace-timeline/v1", title: "Agent Trace Timeline" },
  // The card for everyone: a year of contributions on one card.
  "year-card": { templateId: "@m0saic/github/year-card/v1", title: "GitHub Year Card" },
  "commit-feed": { templateId: "@m0saic/alpine/commit-feed/v2", title: "Commit Feed" },
  // The alpine charts, not charts/*: the alpine donut carries a legend (the
  // charts one labels the ring only — founder pick 2026-09-16) and the trio
  // shares the alpine chrome with the rest of the catalog.
  donut: { templateId: "@m0saic/alpine/donut/v3", title: "Donut Chart" },
  "bar-graph": { templateId: "@m0saic/alpine/bar-graph/v1", title: "Bar Graph" },
  "line-chart": { templateId: "@m0saic/alpine/line-chart/v2", title: "Line Chart" },
  "kpi-card": { templateId: "@m0saic/alpine/kpi-card/v2", title: "KPI Card" },
  heatmap: { templateId: "@m0saic/alpine/heatmap/v2", title: "Heatmap" },
  treemap: { templateId: "@m0saic/alpine/treemap/v2", title: "Treemap" },
  leaderboard: { templateId: "@m0saic/alpine/leaderboard/v1", title: "Leaderboard" },
  timeline: { templateId: "@m0saic/alpine/timeline/v2", title: "Timeline" },
  "contributor-table": { templateId: "@m0saic/alpine/contributor-table/v1", title: "Contributor Table" },
  "snippet-morph": { templateId: "@m0saic/code/snippet-morph/v1", title: "Code Snippet Morph" },
};

export function pickBack(value: string | undefined): BackKey {
  return (BACK_KEYS as readonly string[]).includes(value ?? "") ? (value as BackKey) : "hello-world";
}

/** The minimal Mosaic Web link — `/make?t=<id>` opens the template at its defaults. */
export function makeUrl(templateId: string): string {
  return `${WEB_APP_URL}/make?t=${templateId}`;
}

/**
 * The url as PRINTED: the site's typeable form (`m0saic.io/t/<pack>/<slug>/<vN>`
 * — `@m0saic/` is implied by the route; hello-world has `/hello`), the same
 * line the mobile showroom tells a phone to type. 39 chars at the longest, so
 * it holds at the 8 pt floor; the app url (`makeUrl`) runs to 64. The QR
 * keeps the app url — a scan never waits on the site's redirect.
 */
export function displayUrl(entry: BackEntry): string {
  return entry.typeable ?? `${SITE_HOST}/t/${entry.templateId.replace(/^@m0saic\//, "")}`;
}

/** The CLI one-liner; `make` writes `out.mp4` / `out.png` when `-o` is omitted. */
export function commandFor(entry: BackEntry): string {
  return entry.command ?? `npx m0saic make ${entry.templateId}`;
}

/**
 * The longest command in the catalog — it sets the ONE size every back's
 * command prints at (mono, so longest = widest). Ties break on catalog order.
 */
export function longestCommand(): string {
  return BACK_KEYS.map((k) => commandFor(BACK_CATALOG[k])).reduce((a, b) => (b.length > a.length ? b : a));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The child's props: its defaults, the entry's flavour, then every motion
 * knob switched off so frame 0 is the finished picture.
 */
export function frozenProps(defaults: Record<string, unknown> | undefined, flavour?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(defaults ?? {}), ...(flavour ?? {}) };
  for (const key of ["anim", "animation"]) {
    if (isRecord(out[key])) out[key] = { ...(out[key] as Record<string, unknown>), reduceMotion: true };
  }
  if (typeof out.animate === "boolean") out.animate = false;
  return out;
}
