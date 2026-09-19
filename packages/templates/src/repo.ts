import type {
  MosaicTemplatePackDescriptor,
  MosaicTemplateRepoDescriptor,
} from "@m0saic/types";
import { asRepoId, asTemplateId } from "@m0saic/types";

export const TEMPLATE_REPO: MosaicTemplateRepoDescriptor = {
  schemaVersion: 1,
  repoId: asRepoId("m0saic/templates"),
  displayName: "m0saic Templates",
  description: "Official templates bundled with m0saic.",
  curator: "m0saic",
  assets: {
    templatesDir: "assets/templates",
  },
  // The front door — what `m0saic hello-world` renders and the first card a
  // newcomer sees (the hello-world convention, 2026-09-14).
  helloWorld: asTemplateId("@m0saic/hello-world/v1"),
};

/**
 * Named packs in this repo — the releasable groupings template ids roll up into
 * (keyed by the `{pack}` segment, e.g. `@m0saic/alpine/bar-graph/v1` → `alpine`).
 *
 * Only packs with their own identity / marketing need a descriptor here; a pack
 * segment without an entry still works (hosts fall back to the raw pack name).
 * The manifest generator emits this array as `manifest.packs`.
 */
export const TEMPLATE_PACKS: MosaicTemplatePackDescriptor[] = [
  {
    id: "alpine",
    title: "Alpine Data Viz",
    description:
      "Friendly mobile-marketing chart pack — rounded cards, soft palette, clean type.",
    publisher: "m0saic",
  },
  {
    id: "web",
    title: "Web",
    description:
      "Privacy-preserving templates that translate anonymous webpage geometry into editable m0 visuals.",
    publisher: "m0saic",
  },
];
