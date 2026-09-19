/**
 * Layout fingerprints — the file FORMAT (browser-safe half).
 *
 * A template's fingerprint is its flattened layout at the hinted canvas, in
 * the DSL's own `.m0` file format (`@m0saic/dsl-file-formats`): the
 * `# size:` header carries the canvas, `# title:` the template id, and the
 * payload is the canonical m0 string — so it opens in the Layout page, diffs
 * line-for-line in review, and needs no bespoke parser.
 *
 * WHERE it lives (founder ruling 2026-09-06): next to the template source,
 * `src/<pack>/<slug>/vN/<slug>.layout.m0`; a template whose id has no source
 * folder falls back to a central `layout-fingerprints/<key>.m0`. Reading,
 * writing and locating files touch the filesystem and live in the node-only
 * entry: `dev/layoutFingerprintFs.ts` (`@m0saic/template-utils/dist/dev`).
 * This module is reachable from the web bundle through the root barrel, so
 * it must stay free of `node:` imports.
 *
 * A pipeline with several inline documents writes one file per document:
 * `<base>.m0`, `<base>.step2.m0`, `<base>.step3.m0`, … in step order.
 *
 * `created` is pinned to a constant: a re-mint that changes nothing must be
 * byte-identical, or every update would dirty every file.
 */

import { parseM0File, serializeM0File } from "@m0saic/dsl-file-formats";

import type { LayoutFingerprint } from "./auditRenderedTemplate";

/** The central fallback folder, relative to a repo root. */
export const LAYOUT_FINGERPRINTS_DIR = "layout-fingerprints";

/** `@m0saic/code/snippet-morph/v1` → `m0saic__code__snippet-morph__v1`. */
export function layoutFingerprintKey(templateId: string): string {
  return String(templateId).replace(/^@/, "").replace(/\//g, "__");
}

/**
 * The id's path segments after the publisher (`@repo/pack/slug/v1` →
 * `["pack", "slug", "v1"]`) when the id has the `…/<slug>/vN` shape, else
 * null. The sidecar folder is `<srcRoot>/<segments…>/`; the sidecar base is
 * `<slug>.layout`.
 */
export function layoutFingerprintSidecar(templateId: string): { segments: string[]; base: string } | null {
  const segments = String(templateId).replace(/^@[^/]+\//, "").split("/");
  if (segments.length < 3 || !/^v\d+$/.test(segments[segments.length - 1])) return null;
  return { segments, base: `${segments[segments.length - 2]}.layout` };
}

/** File name of document `index` (0-based) for a base: `base.m0`, `base.step2.m0`, … */
export function layoutFingerprintFileName(base: string, index = 0): string {
  return index === 0 ? `${base}.m0` : `${base}.step${index + 1}.m0`;
}

const CREATED = new Date("2026-01-01T00:00:00.000Z");
const APP = "m0saic-layout-fingerprint";

/** Serialize a fingerprint to its `.m0` file(s): `[{ name, content }]`, one per document. */
export function layoutFingerprintFiles(templateId: string, layout: LayoutFingerprint, base = layoutFingerprintKey(templateId)): Array<{ name: string; content: string }> {
  return layout.docs.map((m0, i) => ({
    name: layoutFingerprintFileName(base, i),
    content: serializeM0File({
      m0,
      size: { width: layout.canvas.width, height: layout.canvas.height },
      created: CREATED,
      app: APP,
      meta: {
        title: String(templateId),
        note:
          `Layout fingerprint${layout.docs.length > 1 ? ` (document ${i + 1} of ${layout.docs.length})` : ""}: the flattened layout at the hinted canvas. ` +
          "The build fails when the layout differs; re-mint with `npm run fingerprints:update` and commit the diff.",
      },
    }),
  }));
}

/** Parse one fingerprint file: the canvas it was minted at and its m0. */
export function parseLayoutFingerprintFile(text: string): { size: { width: number; height: number } | null; m0: string } {
  const f = parseM0File(text);
  return { size: f.size, m0: f.m0 };
}
