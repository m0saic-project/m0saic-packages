import {
  parseTemplateId,
  formatTemplateId,
  packScopedSlug,
} from "./parseTemplateId";

describe("parseTemplateId", () => {
  const cases: Array<{
    id: string;
    publisher: string;
    pack: string | undefined;
    slug: string;
    version: string;
  }> = [
    {
      id: "@m0saic/charts/bar-graph/v2",
      publisher: "@m0saic",
      pack: "charts",
      slug: "bar-graph",
      version: "v2",
    },
    {
      id: "@m0saic/alpine/bar-graph/v1",
      publisher: "@m0saic",
      pack: "alpine",
      slug: "bar-graph",
      version: "v1",
    },
    {
      // packless community scope: 3-segment, no pack
      id: "@community/hello-world/v1",
      publisher: "@community",
      pack: undefined,
      slug: "hello-world",
      version: "v1",
    },
    {
      // author-scoped community id, also packless
      id: "@jane-doe/widget/v3",
      publisher: "@jane-doe",
      pack: undefined,
      slug: "widget",
      version: "v3",
    },
  ];

  it.each(cases)(
    "parses $id",
    ({ id, publisher, pack, slug, version }) => {
      expect(parseTemplateId(id)).toEqual({ publisher, pack, slug, version });
    },
  );

  it("round-trips through formatTemplateId", () => {
    for (const { id } of cases) {
      expect(formatTemplateId(parseTemplateId(id))).toBe(id);
    }
  });

  it("throws on a string with too few segments", () => {
    expect(() => parseTemplateId("@m0saic/charts")).toThrow(/at least/);
  });

  it("packScopedSlug namespaces slugs by pack (and leaves packless ids bare)", () => {
    // The two bar-graphs share a bare slug but differ once pack-scoped — the
    // coexistence guarantee the manifest dedup relies on.
    expect(packScopedSlug("@m0saic/charts/bar-graph/v2")).toBe("charts/bar-graph");
    expect(packScopedSlug("@m0saic/alpine/bar-graph/v1")).toBe("alpine/bar-graph");
    expect(packScopedSlug("@community/hello-world/v1")).toBe("hello-world");
  });
});
