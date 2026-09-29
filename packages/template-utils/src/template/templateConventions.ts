/**
 * Template conventions — enforced at the `defineMosaicTemplate` seam.
 *
 * Founder ruling (2026-09-05, gate 33): `defineMosaicTemplate` already does a
 * lot of hidden work (stamping, timing asserts, capability gating, auto-
 * compaction). It is also the one place EVERY registered template passes
 * through, so it is where a convention should fire — at definition time,
 * where the author sees it, not in a test they may never run. A convention
 * that only lives in a test lets a template class degrade for months.
 *
 * Founder direction (2026-09-06): enforce the conventions BEFORE adoption
 * happens. Plan: the internal template-conventions-v1 notes.
 *
 * Two seams, one finding shape:
 *  - DEFINITION time (this file, via {@link enforceTemplateConventions}) —
 *    rules that need only the schema, the defaults, and the browse metadata.
 *  - RENDER time (`auditRenderedTemplate`) — rules that need a rendered
 *    document: bindings, drawn copy. Run by every repo's `check-registry`
 *    build gate; the findings use the same type and posture table.
 *
 * Posture per convention ({@link TEMPLATE_CONVENTION_POSTURE}):
 *  - `"throw"`  — FIRST-PARTY template + violation → THROW
 *                 ({@link TemplateConventionError}) at definition. No escape
 *                 hatch: the fleet passes, and a build must fail before a
 *                 template can load in Mosaic Desktop or the CLI.
 *  - `"record"` — a warning: recorded, printed by the gates, never fatal.
 *                 Used while a migration is in flight; promoted to `"throw"`
 *                 once the fleet passes.
 *  - EXTERNAL repo template (`withExternalTemplateOrigin`) → everything is
 *    RECORDED, never thrown: "one bad template in a repo can't abort the rest
 *    of the load" (the registry's standing posture). Hosts surface the
 *    findings via {@link listTemplateConventionFindings} /
 *    {@link drainTemplateConventionFindings}; `severity` tells a host which
 *    ones its own build would have refused.
 *
 * The layout contract deliberately stays OUT of this seam: it is debug-only by
 * ruling (2026-08-22 — a render with slightly clipped text beats no render).
 */

import type { MosaicTemplate, MosaicTemplateProps } from "@m0saic/types";
import { auditDefaultProps } from "./auditDefaultProps";
import {
  auditBrowseSurface,
  auditColorProps,
  auditDefaultsValidate,
  auditNoLocalPaths,
  auditOutputFormat,
  auditOutputHintsResolve,
  auditPropLabels,
} from "./auditSchemaConventions";
import type { TemplateConventionViolation } from "./auditSchemaConventions";

export type { TemplateConventionViolation } from "./auditSchemaConventions";

export type TemplateConventionName =
  // definition time — enforceTemplateConventions
  | "defaultProps"
  | "colorProps"
  | "noLocalPaths"
  | "browseSurface"
  | "propLabels"
  | "defaultsValidate"
  | "outputFormat"
  | "outputHintsResolve"
  // repo level — auditRepoFrontDoor (keyed by the REPO id, run by the gate)
  | "repoFrontDoor"
  // render time — auditRenderedTemplate
  | "rendersAtDefaults"
  | "bindingsSound"
  | "bindingsCover"
  | "bindingsDeclared"
  | "bindingHints"
  | "canvasFill"
  | "svgGlyphCoverage"
  | "safeMinimumCanvas"
  | "canvasEnvelope"
  | "deterministic"
  | "textFits"
  | "costBudget"
  | "latticeSmooth"
  // build gate / doctor — layout-fingerprints/*.fingerprint vs the current flattened layout
  | "layoutFingerprint";

export type TemplateConventionPosture = "throw" | "record";
export type TemplateConventionSeverity = "error" | "warning";

/** Which conventions fail a first-party build (`throw`) and which only warn
 *  (`record`). Promote a rule by flipping it here once the fleet passes. */
export const TEMPLATE_CONVENTION_POSTURE: Readonly<Record<TemplateConventionName, TemplateConventionPosture>> = {
  defaultProps: "throw",
  colorProps: "throw",
  noLocalPaths: "throw",
  browseSurface: "throw",
  propLabels: "record",
  defaultsValidate: "throw",
  outputFormat: "record",
  outputHintsResolve: "throw",
  repoFrontDoor: "record",
  rendersAtDefaults: "throw",
  bindingsSound: "throw",
  bindingsCover: "record",
  // Shipped 2026-09-25 as `throw` with NO migration: every template that
  // existed is hashed in `frozen.manifest.json` and exempt by construction, so
  // the rule only ever meets new work. Founder ruling — "all templates that
  // exist now are FROZEN; NEW templates should have as many props bound as
  // possible", and there is no fleet to migrate, which is the point of doing it
  // at the start of a line rather than the end.
  bindingsDeclared: "throw",
  // Shipped 2026-09-27 as `throw`. Founder: "a production-grade template
  // adheres to all the surfaces of the ecosystem … it's better to take this
  // tax now". The canvas is the primary surface, so every bound rect says in
  // context what its value does; the tax is one honest sentence per bound
  // prop, paid once in the schema. Safe at throw for the same reason as the
  // roll call: every template that shipped is exempt (`shippedAt`).
  bindingHints: "throw",
  // Shipped 2026-09-25 as `throw`, deliberately: "we need to be greedy about
  // adding conventions because agents, especially non-frontier ones, won't"
  // (founder). A `record` rule teaches nobody — the model never sees the warning.
  // Safe at throw because every template that shipped is exempt (`shipped`) and
  // the one legitimate case declares itself (`useNestedBackgroundColor` default-on).
  canvasFill: "throw",
  svgGlyphCoverage: "throw",
  safeMinimumCanvas: "record",
  canvasEnvelope: "record",
  deterministic: "throw",
  textFits: "throw",
  costBudget: "record",
  // Shipped 2026-09-16 as `record` with 37 templates off the lattice; the sweep
  // that same day took the fleet to zero (gate + the three standard canvases),
  // and the rule was promoted to `throw` — the publish requirement for packs.
  latticeSmooth: "throw",
  layoutFingerprint: "throw",
};

/**
 * The m0saic line by which each convention was ENFORCED — the version axis the
 * lag story needs (founder, 2026-09-25: "conventions change over time, but if we
 * semver them we know: does X template pass conventions at Y semver").
 *
 * A template that fails a rule newer than the line it SHIPPED at is not broken —
 * it met the conventions of its day, and the fix is its next vN. A template that
 * fails a rule OLDER than its own release shipped non-compliant, which is a real
 * defect. `release` in a repo's `frozen.manifest.json` is the other half of the
 * comparison.
 *
 * Everything that predates 0.3.0 is recorded as **0.2.0**, deliberately: at the
 * 0.2.0 freeze the whole shipped fleet passed every rule then in force, so 0.2.0
 * is a TRUE lower bound for all of them. Recording a rule's first draft date
 * instead would claim precision this table does not have. New rules get the line
 * they actually land in.
 */
export const TEMPLATE_CONVENTION_SINCE: Readonly<Record<TemplateConventionName, string>> = {
  defaultProps: "0.2.0",
  colorProps: "0.2.0",
  noLocalPaths: "0.2.0",
  browseSurface: "0.2.0",
  propLabels: "0.2.0",
  defaultsValidate: "0.2.0",
  outputFormat: "0.2.0",
  outputHintsResolve: "0.2.0",
  repoFrontDoor: "0.2.0",
  rendersAtDefaults: "0.2.0",
  bindingsSound: "0.2.0",
  bindingsCover: "0.2.0",
  bindingsDeclared: "0.3.0",
  bindingHints: "0.3.0",
  canvasFill: "0.3.0",
  svgGlyphCoverage: "0.2.0",
  safeMinimumCanvas: "0.2.0",
  canvasEnvelope: "0.2.0",
  deterministic: "0.2.0",
  textFits: "0.2.0",
  costBudget: "0.2.0",
  latticeSmooth: "0.2.0",
  layoutFingerprint: "0.2.0",
};

/** `0.x.y` compare. Returns <0, 0, >0. Non-numeric segments sort as 0. */
export function compareConventionVersions(a: string, b: string): number {
  const seg = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [a0, a1, a2] = seg(a);
  const [b0, b1, b2] = seg(b);
  return a0 - b0 || a1 - b1 || a2 - b2;
}

/** Every line the convention table knows about, oldest first. */
export function conventionVersions(): string[] {
  return [...new Set(Object.values(TEMPLATE_CONVENTION_SINCE))].sort(compareConventionVersions);
}

export type ConventionsLevel = {
  /** The newest line whose conventions this template fully meets — `null` when it
   *  fails a rule from the oldest line the table tracks. */
  meets: string | null;
  /** The lines it does NOT meet, and which rules fail, oldest first. */
  behind: Array<{ since: string; conventions: TemplateConventionName[] }>;
};

/**
 * "Does this template pass conventions at version Y?" — answered as the newest
 * line it fully meets, plus what it is behind on.
 *
 * ERROR-severity findings only. A `record`-posture warning is advice, not a
 * failure to meet a line; treating it as one would make "meets 0.2.0" unreachable
 * for a template with one cosmetic note.
 */
export function conventionsLevel(
  findings: ReadonlyArray<{ convention: TemplateConventionName; severity: TemplateConventionSeverity }>,
): ConventionsLevel {
  const versions = conventionVersions();
  const failing = [...new Set(findings.filter((f) => f.severity === "error").map((f) => f.convention))];
  if (failing.length === 0) return { meets: versions[versions.length - 1] ?? null, behind: [] };

  const bySince = new Map<string, TemplateConventionName[]>();
  for (const c of failing) {
    const v = TEMPLATE_CONVENTION_SINCE[c];
    bySince.set(v, [...(bySince.get(v) ?? []), c].sort());
  }
  const behind = [...bySince.entries()]
    .map(([since, conventions]) => ({ since, conventions }))
    .sort((x, y) => compareConventionVersions(x.since, y.since));

  // It meets every line strictly older than its oldest failure.
  const oldestFailure = behind[0].since;
  const met = versions.filter((v) => compareConventionVersions(v, oldestFailure) < 0);
  return { meets: met[met.length - 1] ?? null, behind };
}

/** One-line description + fix per convention, for error messages and gates. */
export const TEMPLATE_CONVENTION_FIX: Readonly<Record<TemplateConventionName, string>> = {
  defaultProps:
    `"a knob shows what it does": declare the value in defaultProps (booleans / closed sets), or add meta.control.placeholder naming the unset behaviour (plain strings / numbers). A closed set must contain the unset state (add a "none" option and default it) — never default a real value over "unset".`,
  colorProps:
    `a colour-valued prop declares BOTH constraints.isColor: true and control.colorPicker: true, so the editor shows a swatch picker instead of a text box.`,
  noLocalPaths:
    `defaultProps must not contain absolute filesystem paths — they exist only on the authoring machine. Ship a bundled asset by relative reference, or leave the input empty.`,
  browseSurface:
    `give the template a non-empty description and at least one tag — the Templates page and the manifest are built from them.`,
  propLabels:
    `give every visible prop a meta.ui.label — the panel otherwise falls back to the raw key (internal templates are exempt: a building block has no panel).`,
  outputFormat:
    `declare the deliverable in outputHints.format — { kind: "video", container: "mp4" } for motion, { kind: "image", container: "png" } for a still (pixelFormat: "rgba" when it ships alpha). Without it the CLI defaults the output to out.mp4 and a Make share link at defaults carries an f= ask. A template with an outputFormat knob declares the knob's DEFAULT (the knob still wins at render). Building blocks (internal: true) are exempt.`,
  outputHintsResolve:
    `keep resolveOutputHints pure and consistent — return an object, the same object on every call at defaultProps, and at defaults agree with the static outputHints for every field you return (the static hints are what the manifest and cards show). Never throw: an unknown prop value resolves to the default.`,
  repoFrontDoor:
    `declare the repo's front door — repo.helloWorld = the id of the template a newcomer renders first. The canonical card is one call, defineHelloWorldTemplate({ id, subline }) from @m0saic/template-utils; a pack with its own look points the field at its own template. Hosts read the field (m0saic hello-world --template-repo, Make's Start here) and the manifest carries it.`,
  defaultsValidate:
    `defaultProps must pass the template's own schema: a default outside its oneOf, beyond its min/max, of the wrong type, or over a list bound is a knob that shows one thing and renders another. (A required input with no default is fine — inputs are not defaults.)`,
  rendersAtDefaults:
    `render(defaultProps) must succeed on the hinted canvas — a template whose defaults cannot render shows an error card in Make. (Templates whose required inputs have no default are skipped, not failed.)`,
  bindingsSound:
    `every editor.binding must resolve against propsSchema: the prop must exist and be bindable, list props need an index, structured (json / list) props need a path AND a kind — see bindProp / bindPropPath in @m0saic/template-utils.`,
  bindingsCover:
    `a prop drawn as text should be bound to the rect that shows it (bindProp(src, "<key>")) so Make's double-click edits it in place. Bind the rect that SHOWS the prop, even when its value is empty.`,
  bindingsDeclared:
    `every prop that CAN carry a canvas handle is either bound on the rect that shows it (bindProp / bindProps / bindPropPath / bindPropRect) or named in template.bindings.unbound with the reason it has none ({ fps: "timing" }). The accountable props are free-text and colour strings, numbers, media, one element of a basic list, one leaf of json / list / array, and a regions-picker rect; booleans, closed sets, group containers, the m0 family, code and hidden / human props are never canvas things. A declaration naming an unknown prop, or one that is actually bound, is itself a violation — a stale entry is worse than none. Templates hashed in frozen.manifest.json are exempt.`,
  bindingHints:
    `every bound rect must show one line in context — what changing the value does and what it looks like — because Make puts it under the inline editor, on the tile card and in the handle's tooltip, and a person who double-clicks should not have to open the settings or a manual. It comes from the binding's own hint (bindProp(src, "<key>", i, { hint: "…" }) / withBindingHint(src, "…")) or, for every binding of the prop at once, the prop's description (propsSchema.<key>.description). One plain sentence; never the value itself. A companion leaf (filled only by a media drop) needs none. Templates hashed in frozen.manifest.json are exempt.`,
  canvasFill:
    `fill the canvas with document.backgroundColor, never a full-canvas colour rect. A base rect is a click target that covers everything — it gets selected in Make any time the pointer is not on a smaller tile — and the document background does the same job with no rect at all. Only a STATIC, fully opaque, unshaped fill counts: a curtain wipe (overlay.enable / window), a scrim (overlay.alpha), a masked shape and a rounded card are all legitimate and never flagged. Two declared exceptions, and they mean different things: canvas.baseRect = "<why>" is the general one (the rect IS the subject — a lesson about full-rect nodes, a tutorial surface), and defaultProps.useNestedBackgroundColor = true is the narrow one (this template is COMPOSED INTO another, whose slot its own backgroundColor cannot fill). An empty baseRect reason is refused.`,
  svgGlyphCoverage:
    `every character drawn with rasterizer:"svg" must have a glyph in the font it resolves to; missing glyphs render as tofu. Use an ASCII stand-in ("->" for an arrow) or a font that has the character.`,
  safeMinimumCanvas:
    `at its own hinted canvas, the template's flattened layout must clear its safe minimum (per-axis max of the feasibility and precision floors) — below it cells are squashed or culled at the template's DEFAULT size. Bound weightedSplit totals with a precision budget (never scale raw slider values into slots), or raise outputHints to a canvas the layout actually needs.`,
  canvasEnvelope:
    `the layout should clear its safe minimum on the standard canvases too (1080p landscape / portrait / square); a canvas it cannot clear is one users will pick in Make and get squashed or culled cells. Declare the supported range, or make the geometry ratio-based.`,
  deterministic:
    `render(defaultProps) must produce the same document twice — no Math.random, no clock, no ambient state, no per-call ids. Randomness takes a seed prop; identical seeds give identical output.`,
  textFits:
    `every svg-rasterized text layer must fit the cell it lands on at the hinted canvas (measured with the rasterizer's own font, after inset and padding) — svg text never wraps or scales on its own. Fit it with fitSvgText / svgLabel, shorten it, or give the cell more room.`,
  costBudget:
    `keep the rendered document inside the engine's comfort zone (see COST_BUDGETS): frame count, source count, overlay depth and inline-mask count each have a ceiling past which renders slow down quadratically, drop layers, or overflow the process argv — operations, not string length (a baked-inset m0 is long and cheap). Collapse detail into fewer, larger cells; nest a child document instead of stacking overlays.`,
  latticeSmooth:
    `every split count above 12 in the rendered layout (root document and every nested child) must be 5-smooth — 2ᵃ·3ᵇ·5ᶜ — so the layout composes: inlining one template into another costs the LCM of their split counts, and one rough factor (7, 11, 121 = 11²) multiplies the whole composition. Cap weighted bands with weightedSplit(…, { precision: 120 }) — never round each weight to a cap on its own, that sums to 120 ± 1 (119/121); place rect soups with placeInsetPieces / placeOptimizedPieces (they pick divisors of the axis); take a self-frame's pitch from the divisors of its side, not round(side / K). Counts ≤ 12 with a rough factor are content fill and pass; a larger content count (53 ISO weeks) is declared as lattice: { allow: [{ count, reason }] }; a baked raster (QR, barcode, logo trace) declares lattice: { mode: "bitmap" }.`,
  layoutFingerprint:
    `the flattened layout at the hinted canvas changed from the committed fingerprint (the <slug>.layout.m0 beside the template, or layout-fingerprints/<key>.m0 for ids without a source folder). If the change is intended, re-mint with \`npm run fingerprints:update\` and commit the new file so the diff is reviewed; if not, a shared helper or a default drifted.`,
};

export type TemplateConventionFinding = {
  templateId: string;
  convention: TemplateConventionName;
  /** True when the finding was recorded instead of thrown (external-repo posture). */
  external: boolean;
  /** `"error"` = a throw-posture convention (a first-party build refuses it);
   *  `"warning"` = a record-posture convention (printed, never fatal). */
  severity: TemplateConventionSeverity;
  violations: TemplateConventionViolation[];
};

export type EnforceConventionsOptions = {
  /** `"throw"` (first-party default) or `"record"` (external repos). */
  mode?: "throw" | "record";
};

function describe(finding: TemplateConventionFinding): string {
  const n = finding.violations.length;
  return (
    `${finding.templateId} breaks the "${finding.convention}" convention — ${n} violation${n === 1 ? "" : "s"}:\n` +
    finding.violations.map((v) => `  • ${v.detail}`).join("\n") +
    `\nFix: ${TEMPLATE_CONVENTION_FIX[finding.convention]}`
  );
}

export class TemplateConventionError extends Error {
  readonly templateId: string;
  /** The first fatal finding's convention (every fatal finding is in `findings`). */
  readonly convention: TemplateConventionName;
  readonly violations: TemplateConventionViolation[];
  readonly findings: TemplateConventionFinding[];
  constructor(finding: TemplateConventionFinding | TemplateConventionFinding[]) {
    const findings = Array.isArray(finding) ? finding : [finding];
    if (findings.length === 0) throw new Error("TemplateConventionError: at least one finding");
    super(findings.map(describe).join("\n\n"));
    this.name = "TemplateConventionError";
    this.templateId = findings[0].templateId;
    this.convention = findings[0].convention;
    this.violations = findings[0].violations;
    this.findings = findings;
  }
}

// Module-level log keyed on globalThis so a second copy of this module (dual
// CJS/ESM loads, jest module registries) reads the same list.
const LOG_KEY = "__m0saicTemplateConventionFindings";
function log(): TemplateConventionFinding[] {
  const g = globalThis as Record<string, unknown>;
  if (!Array.isArray(g[LOG_KEY])) g[LOG_KEY] = [];
  return g[LOG_KEY] as TemplateConventionFinding[];
}

/** Every finding recorded so far, oldest first. */
export function listTemplateConventionFindings(): readonly TemplateConventionFinding[] {
  return log().slice();
}

/** Drain the log (tests / a host that surfaced them). */
export function drainTemplateConventionFindings(): TemplateConventionFinding[] {
  const out = log().slice();
  log().length = 0;
  return out;
}

/** Record a finding. One entry per (template, convention): a template
 *  re-registered on hot reload replaces its earlier finding instead of
 *  stacking duplicates. Render-time audits record through here too. */
export function recordTemplateConventionFinding(finding: TemplateConventionFinding): void {
  const l = log();
  const i = l.findIndex((f) => f.templateId === finding.templateId && f.convention === finding.convention);
  if (i >= 0) l[i] = finding;
  else l.push(finding);
}

/** Forget a (template, convention) finding — a re-registered template that
 *  now PASSES clears its earlier finding, so the log never reports a breakage
 *  that is already fixed. */
export function clearTemplateConventionFinding(templateId: string, convention: TemplateConventionName): void {
  const l = log();
  const i = l.findIndex((f) => f.templateId === templateId && f.convention === convention);
  if (i >= 0) l.splice(i, 1);
}

/** Build a finding with the severity its convention's posture implies. */
export function makeTemplateConventionFinding(
  templateId: string,
  convention: TemplateConventionName,
  violations: TemplateConventionViolation[],
  external: boolean,
): TemplateConventionFinding {
  return {
    templateId,
    convention,
    external,
    severity: TEMPLATE_CONVENTION_POSTURE[convention] === "throw" ? "error" : "warning",
    violations,
  };
}

type DefinitionTimeAudit = {
  convention: TemplateConventionName;
  run: <P extends MosaicTemplateProps>(template: MosaicTemplate<P>) => TemplateConventionViolation[];
};

const DEFINITION_TIME_AUDITS: readonly DefinitionTimeAudit[] = [
  { convention: "defaultProps", run: (t) => auditDefaultProps(t) },
  { convention: "colorProps", run: (t) => auditColorProps(t) },
  { convention: "noLocalPaths", run: (t) => auditNoLocalPaths(t) },
  { convention: "browseSurface", run: (t) => auditBrowseSurface(t) },
  { convention: "propLabels", run: (t) => auditPropLabels(t) },
  { convention: "defaultsValidate", run: (t) => auditDefaultsValidate(t) },
  { convention: "outputFormat", run: (t) => auditOutputFormat(t) },
  { convention: "outputHintsResolve", run: (t) => auditOutputHintsResolve(t) },
];

/**
 * Run every definition-time convention against `template`. In `"throw"` mode
 * (the first-party posture) every throw-posture violation is collected and
 * thrown as ONE {@link TemplateConventionError}, so the author sees all of
 * them in a single build failure; record-posture violations are recorded as
 * warnings. In `"record"` mode (external repos) everything is recorded.
 * Returns the findings (empty = fully compliant). Pure apart from the log.
 */
export function enforceTemplateConventions<P extends MosaicTemplateProps>(
  template: MosaicTemplate<P>,
  opts: EnforceConventionsOptions = {},
): TemplateConventionFinding[] {
  const mode = opts.mode ?? "throw";
  const templateId = String(template.id);
  const findings: TemplateConventionFinding[] = [];
  const fatal: TemplateConventionFinding[] = [];
  for (const audit of DEFINITION_TIME_AUDITS) {
    const violations = audit.run(template);
    if (violations.length === 0) {
      clearTemplateConventionFinding(templateId, audit.convention);
      continue;
    }
    const finding = makeTemplateConventionFinding(templateId, audit.convention, violations, mode === "record");
    recordTemplateConventionFinding(finding);
    findings.push(finding);
    if (mode === "throw" && finding.severity === "error") fatal.push(finding);
  }
  if (fatal.length > 0) throw new TemplateConventionError(fatal);
  return findings;
}
