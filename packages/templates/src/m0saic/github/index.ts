/**
 * GitHub data connector pack (F5). The FIRST real consumer of the F1
 * capability surface (host connections + secrets + upstream threading).
 *
 *   - connection.ts  : the `github@default` host connection (side-effect
 *                      registered on import — reaches the app AND the CLI).
 *   - client.ts      : injectable-fetch GitHub REST client.
 *   - week-math.ts   : pure ISO-week / Monday-window arithmetic.
 *
 * Phases 2–3 add `repo-facts-fetcher/v1` (capability-tier fetcher →
 * `githubRepoFacts`) and `weekly-pulse-adapter/v1` (core-tier pure adapter →
 * `weeklyPulse`), exported here as they land.
 */

// Side-effect: registers the `github@default` host connection.
export * from "./connection";
export * from "./client";
export * from "./week-math";
// Side-effect: registers `@m0saic/github/repo-facts-fetcher/v1`.
export * from "./repo-facts-fetcher";
// Side-effect: registers `@m0saic/github/weekly-pulse-adapter/v1`.
export * from "./weekly-pulse-adapter";
// Side-effect: registers `@m0saic/github/weekly-pulse/v1` (the app-runnable,
// capability-tier live pulse — fetch + derive + render in one template).
export * from "./weekly-pulse";
// Side-effect: registers `@m0saic/github/year-card/v1` (a year of contributions on one card).
export * from "./year-card";
