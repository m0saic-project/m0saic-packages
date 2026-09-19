// covers: slug-hijack protection END TO END, against the real adversarial repo
// checked in at `examples/bad-actor-templates`.
//
// The unit matrix in `src/template/templateRegistry.test.ts` locks the policy
// with synthetic templates. This one loads an ACTUAL external repo off disk,
// through the same loader the CLI's `--template-repo` and the desktop app's
// "Add source" use, and asserts an official id survives contact with it. A
// policy that is right in isolation but never reached by the real load path
// would still ship the vulnerability.
//
// Loading uses `reload: true` so the loader takes its CommonJS `require()`
// branch. Its default branch is a native dynamic `import()`, which Jest's VM
// rejects outright ("A dynamic import callback was invoked without
// --experimental-vm-modules") — the same constraint documented in
// `packages/platform/src/template-repos/loadTemplateRepoFromPath.test.ts`.
import * as fs from "node:fs";
import * as path from "node:path";
import { loadTemplateRepoFromPath } from "@m0saic/platform/template-repos";
import type { MosaicTemplate, MosaicTemplateProps } from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  drainTemplateRegistrationRejections,
  getTemplate,
  getTemplateOrigin,
  registerTemplate,
  withExternalTemplateOrigin,
  __resetTemplateRegistryForTests,
} from "../src/template/templateRegistry";
import type { TemplateRegistrationRejection } from "../src/template/templateRegistry";

const BAD_ACTOR_REPO = path.resolve(__dirname, "../../../examples/bad-actor-templates");
// The fixture repo lives in the monorepo (`examples/`), not in this package: a
// standalone checkout (the public mirror) has nothing to hijack with, so the
// suite skips there instead of failing on a missing directory.
const describeWithFixture = fs.existsSync(BAD_ACTOR_REPO) ? describe : describe.skip;

/** The two official ids `examples/bad-actor-templates` goes after. */
const HIJACK_TARGET_VIA_EXPORT = "@m0saic/charts/bar-graph/v2";
const HIJACK_TARGET_VIA_IMPORT = "@m0saic/alpine/donut/v3";
/** The repo's one legitimate template — the positive control. */
const HONEST_ID = "@bad-actor/honest-card/v1";

/** Stand-in for the shipped template at `id`. Registering these here rather
 *  than requiring `@m0saic/templates` keeps template-utils' tests from
 *  depending on a package that depends on IT. */
function makeOfficial(id: string): MosaicTemplate<MosaicTemplateProps> {
  return {
    id: asTemplateId(id),
    label: "OFFICIAL",
    version: 1,
    capabilities: { tier: "core" },
    description: "test fixture",
    tags: ["test"],
    propsSchema: {},
    defaultProps: {},
    render: async () => ({
      kind: "mosaic_document" as const,
      version: 1 as const,
      assets: {} as any,
      m0: toM0String("F", "official"),
      sources: [],
      fps: 1,
      durationMs: 1,
    }),
  } as MosaicTemplate<MosaicTemplateProps>;
}

describeWithFixture("examples/bad-actor-templates cannot take over an official slug", () => {
  let rejections: TemplateRegistrationRejection[] = [];
  let exportedIds: string[] = [];

  beforeAll(async () => {
    __resetTemplateRegistryForTests();

    // Built-in packs register first, exactly as they do at boot.
    registerTemplate(makeOfficial(HIJACK_TARGET_VIA_EXPORT));
    registerTemplate(makeOfficial(HIJACK_TARGET_VIA_IMPORT));

    // Then the user adds an external source. Both halves run inside the origin
    // scope: the import (where the repo's own module body registers) and the
    // host's loop over `templates[]`.
    const loaded = await withExternalTemplateOrigin(BAD_ACTOR_REPO, () =>
      loadTemplateRepoFromPath(BAD_ACTOR_REPO, { reload: true }),
    );

    const errors = loaded.diagnostics.filter((d) => d.severity === "error");
    if (errors.length > 0) {
      throw new Error(
        `bad-actor fixture failed to load — run \`npm run build\` in ${BAD_ACTOR_REPO}:\n` +
          errors.map((e) => `  ${e.code}: ${e.message}`).join("\n"),
      );
    }

    exportedIds = loaded.templates.map((t) => String(t.id));

    withExternalTemplateOrigin(BAD_ACTOR_REPO, () => {
      for (const tmpl of loaded.templates) registerTemplate(tmpl);
    });

    rejections = drainTemplateRegistrationRejections();
  });

  afterAll(() => {
    __resetTemplateRegistryForTests();
  });

  // Guards the guard: if someone "fixes" the fixture by renaming its ids, every
  // assertion below would pass while testing nothing at all.
  it("still actually attempts the hijack", () => {
    expect(exportedIds).toContain(HIJACK_TARGET_VIA_EXPORT);
  });

  it("leaves the official template registered under the exported hijack id", () => {
    expect(getTemplate(HIJACK_TARGET_VIA_EXPORT)?.label).toBe("OFFICIAL");
    expect(getTemplateOrigin(HIJACK_TARGET_VIA_EXPORT)).toEqual({
      kind: "first-party",
    });
  });

  it("leaves the official template registered under the import-time hijack id", () => {
    expect(getTemplate(HIJACK_TARGET_VIA_IMPORT)?.label).toBe("OFFICIAL");
    expect(getTemplateOrigin(HIJACK_TARGET_VIA_IMPORT)).toEqual({
      kind: "first-party",
    });
  });

  it("reports both refusals, attributed to the repo that attempted them", () => {
    const byId = new Map(rejections.map((r) => [r.id, r]));

    expect(byId.get(HIJACK_TARGET_VIA_EXPORT)?.code).toBe(
      "TEMPLATE_ID_RESERVED_NAMESPACE",
    );
    expect(byId.get(HIJACK_TARGET_VIA_IMPORT)?.code).toBe(
      "TEMPLATE_ID_RESERVED_NAMESPACE",
    );
    expect(
      rejections.every((r) => r.attemptedBy === BAD_ACTOR_REPO),
    ).toBe(true);
  });

  // The guard refuses IDS, not repos. Without this, the suite would pass just
  // as well if the loader had rejected the whole repo — or never loaded it.
  it("still registers the repo's legitimate template, marked external", () => {
    expect(getTemplate(HONEST_ID)).toBeDefined();
    expect(getTemplateOrigin(HONEST_ID)).toEqual({
      kind: "external",
      source: BAD_ACTOR_REPO,
    });
  });
});
