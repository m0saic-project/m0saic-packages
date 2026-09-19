import { listRegisteredTemplateIds } from "@m0saic/template-utils";

import { templateRegistry } from "./template-registry";
import { TEMPLATE_PACKS } from "./repo";
import "./m0saic"; // side-effect: register every template

describe("official template registry", () => {
  it("publishes Page Skeleton through the web pack", () => {
    expect(
      templateRegistry.find(
        (entry) => entry.templateId === "@m0saic/web/page-skeleton/v1",
      ),
    ).toMatchObject({
      slug: "page-skeleton",
      exportName: "PageSkeleton",
      title: "Page Skeleton",
      tags: expect.arrayContaining(["loading", "animated"]),
    });
    expect(TEMPLATE_PACKS.find((pack) => pack.id === "web")).toMatchObject({
      title: "Web",
      publisher: "m0saic",
    });
  });

  it("publishes Code Snippet Morph with its public export", () => {
    expect(
      templateRegistry.find(
        (entry) => entry.templateId === "@m0saic/code/snippet-morph/v1",
      ),
    ).toMatchObject({
      slug: "code-snippet-morph",
      exportName: "SnippetMorphV1",
      title: "Code Snippet Morph",
      tags: expect.arrayContaining(["code", "developer", "animation"]),
    });
  });

  // The registry header's contract: ALL registered templates belong here —
  // including internal ones — so preview assets and repo metadata resolve
  // for every template. Both directions, so a typo'd row fails too.
  it("has a row for every registered template", () => {
    const rows = new Set(templateRegistry.map((entry) => entry.templateId));
    const missing = listRegisteredTemplateIds()
      .map(String)
      .filter((id) => !rows.has(id));
    expect(missing).toEqual([]);
  });

  it("has a registered template behind every row", () => {
    const registered = new Set(listRegisteredTemplateIds().map(String));
    const dead = templateRegistry
      .map((entry) => entry.templateId)
      .filter((id) => !registered.has(id));
    expect(dead).toEqual([]);
  });
});
