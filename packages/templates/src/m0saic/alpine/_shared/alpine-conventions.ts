/**
 * ============================================================================
 * Alpine — what the 0.3.1 generation shares (NEW file; the older _shared
 * modules are frozen with the templates that shipped on them)
 * ============================================================================
 *
 * 1. BARE group fields. `alpine-anim.ts`'s `fBool` / `fStr` / `fEnum` /
 *    `ALPINE_ANIM_FIELDS` bake each field's label and description into code;
 *    since 0.3.1 that copy lives in the template's catalog sidecar
 *    (`props."anim.reduceMotion".label` …), so a 0.3.1 template builds its
 *    `anim` / `theme` groups from these instead — what each value IS, nothing
 *    about how Make presents it.
 * 2. The `bindingsDeclared` answers every Alpine card gives the same way:
 *    the theme source is not on the canvas, and neither is the intro timing.
 * 3. ADD handles. A prop whose rect does not exist yet (no header until there
 *    is a title) rides a rect that does, so the canvas can bring it back —
 *    `withAddHandles` appends entries to a rect the frozen chrome already
 *    bound, keeping its own.
 * ============================================================================
 */

import type { MosaicSource } from "@m0saic/types";
import type { PropBindingEntry } from "@m0saic/template-utils";
import { withAddHandles } from "../../_shared/canvas-handles";

/* ── 1. Bare field builders (copy lives in the sidecar) ─────────────────── */

export const bBool = (): any => ({ type: "boolean", required: false });
export const bStr = (): any => ({ type: "string", required: false });
export const bEnum = (oneOf: string[]): any => ({ type: "string", required: false, meta: { constraints: { oneOf } } });
export const bNum = (control?: any, constraints?: any): any => ({
  type: "number",
  required: false,
  ...(control || constraints ? { meta: { ...(constraints ? { constraints } : {}), ...(control ? { control } : {}) } } : {}),
});
/** A 0..1 slider (the `fFrac` shape, minus its copy). */
export const bFrac = (): any => bNum({ flavor: "slider", step: 0.05 }, { min: 0, max: 1 });

/** The shared `anim` fields — `ALPINE_ANIM_FIELDS` without its copy. */
export const ALPINE_ANIM_FIELDS_BARE: Record<string, any> = {
  reduceMotion: bBool(),
  introFrac: bFrac(),
  easing: bEnum(["easeOut", "smoothstep", "easeInOut", "linear"]),
};

/** The opt-in producer-theming group (`ThemeSourceConfig`), without its copy. */
export const ALPINE_THEME_GROUP_BARE: any = {
  type: "group",
  required: false,
  fields: { slug: bStr(), preset: bStr(), namespace: bStr(), forceFetch: bBool() },
};

/* ── 2. bindingsDeclared answers every Alpine card shares ───────────────── */

/** The theme source picks tokens for the whole card — no rect shows it. */
export const ALPINE_THEME_UNBOUND = {
  "theme.slug": "theme source",
  "theme.preset": "theme source",
  "theme.namespace": "theme source",
} as const;

/** The intro's share of the clip — timing, never a rect. */
export const ALPINE_ANIM_UNBOUND = { "anim.introFrac": "timing" } as const;

/* ── 3. ADD handles ─────────────────────────────────────────────────────── */

type Bound = MosaicSource & { editor?: { label?: string } };

// The generic handle helpers live with the rest of the pack's shared code.
export { withAddHandles } from "../../_shared/canvas-handles";

/** The Alpine header rect in a composed card's sources (`tag(…, "card-header")`), if any. */
export function findCardHeader(sources: ReadonlyArray<MosaicSource>): MosaicSource | undefined {
  return sources.find((s) => (s as Bound).editor?.label === "card-header");
}

const hasText = (v: unknown): boolean => typeof v === "string" && v.trim().length > 0;

/**
 * The card header's ADD handles, for a composed card's `sources` (in place).
 * The frozen chrome binds the title / subtitle it DRAWS; this hangs the one it
 * does not: a header showing only one of them carries the other, and a card
 * with no header at all offers both on its `anchor` — the first source tagged
 * `anchorLabel` (the card's first content rect; a list = the first label present), so a header can be brought
 * back from the canvas.
 */
export function bindHeaderAddHandles(
  sources: ReadonlyArray<MosaicSource>,
  shown: { title?: unknown; subtitle?: unknown },
  anchorLabel: string | readonly string[],
  keys: { title: string; subtitle: string } = { title: "title", subtitle: "subtitle" },
): void {
  const missing: PropBindingEntry[] = [
    ...(hasText(shown.title) ? [] : [{ propKey: keys.title }]),
    ...(hasText(shown.subtitle) ? [] : [{ propKey: keys.subtitle }]),
  ];
  if (missing.length === 0) return;
  const header = findCardHeader(sources);
  const anchors = typeof anchorLabel === "string" ? [anchorLabel] : anchorLabel;
  const anchor = anchors.find((l) => sources.some((s) => (s as Bound).editor?.label === l));
  const target = header ?? sources.find((s) => (s as Bound).editor?.label === anchor);
  if (target) withAddHandles(target, missing);
}

/**
 * The card surface — the first full-canvas rounded colour tile the alpine
 * card chrome paints (`alpineCard`'s `cardSurface`, always the first source of
 * the composed document) — made a HANDLE (founder, 2026-10-01): a card that
 * fills the canvas is the click target over everything, and a click on it
 * should mean something. Bound to `preset`, the card is where the theme gets
 * changed — the one knob the user view had no door to. The `canvasFill`
 * convention flags a full-canvas rounded card that carries no handle.
 */
export const CARD_HANDLES: ReadonlyArray<PropBindingEntry> = [{ propKey: "preset" }];
export function bindCardSurface<T extends MosaicSource>(sources: T[], entries: ReadonlyArray<PropBindingEntry> = CARD_HANDLES): T[] {
  const card = sources.find((s) => {
    const src = s as unknown as { type?: string; color?: unknown; effects?: { rounding?: unknown }; mask?: unknown; overlay?: unknown };
    return src.type === "lavfi" && typeof src.color === "string" && !!src.effects?.rounding && !src.mask && !src.overlay;
  });
  if (card) withAddHandles(card, entries);
  return sources;
}
