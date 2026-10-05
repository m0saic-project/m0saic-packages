/**
 * Scrapbook v2's props: v1's shape, defaults and validation (imported — v1 is
 * frozen, so they cannot drift), and a BARE schema. What each value is called
 * and what it does lives in `scrapbook.catalog.json` beside the template
 * (0.3.1: code declares what a value IS, the sidecar how Make presents it).
 */
import { definePropsSchema } from "@m0saic/template-utils";
import type { ScrapbookProps } from "../v1/props";

export { DEFAULT_PROPS, resolveProps, type ResolvedProps } from "../v1/props";
export type ScrapbookV2Props = ScrapbookProps;

export const propsSchema = definePropsSchema<ScrapbookV2Props>({
  title: { type: "string", required: false },
  subtitle: { type: "string", required: false },
  photos: {
    type: "media[]",
    required: false,
    meta: { control: { accept: ["image"], picker: "folder", multiple: true } },
  },
  notes: {
    type: "string[]",
    required: false,
  },
  closing: { type: "string", required: false },
  music: {
    type: "media",
    required: false,
    meta: { control: { accept: ["audio"] } },
  },
  perPageMs: { type: "number", required: false, meta: { constraints: { min: 800, max: 20000 } } },
  introMs: { type: "number", required: false, meta: { constraints: { min: 0, max: 15000 } } },
  outroMs: { type: "number", required: false, meta: { constraints: { min: 0, max: 15000 } } },
  xfadeMs: { type: "number", required: false, meta: { constraints: { min: 0, max: 3000 } } },
  drift: { type: "number", required: false, meta: { constraints: { min: 0, max: 1 } } },
  tilt: { type: "number", required: false, meta: { constraints: { min: 0, max: 8 } } },
  paperColor: { type: "string", required: false, meta: { constraints: { isColor: true }, control: { colorPicker: true } } },
  inkColor: { type: "string", required: false, meta: { constraints: { isColor: true }, control: { colorPicker: true } } },
  accentColor: { type: "string", required: false, meta: { constraints: { isColor: true }, control: { colorPicker: true } } },
});
