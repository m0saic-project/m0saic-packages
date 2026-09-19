import { validateTemplateRoles } from "./validateTemplateRoles";
import type {
  MosaicTemplate,
  MosaicTemplateProps,
} from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";

const renderStub = async () => ({} as never);

function makeTemplate(
  id: string,
  role?: unknown,
): MosaicTemplate<MosaicTemplateProps> {
  const tpl: MosaicTemplate<MosaicTemplateProps> & { role?: unknown } = {
    id: asTemplateId(id),
    label: id,
    version: 1,
    capabilities: { tier: "core" },
    propsSchema: {},
    defaultProps: {},
    render: renderStub,
  };
  if (role !== undefined) (tpl as { role?: unknown }).role = role;
  return tpl;
}

describe("validateTemplateRoles (opt-in role + naming convention)", () => {
  it("emits no diagnostics for templates without a role", () => {
    const diags = validateTemplateRoles([
      makeTemplate("@m0saic/dj/playlist/v1"),
      makeTemplate("@m0saic/hero/wireframe-cell/v1"),
      makeTemplate("@m0saic/prague/intel/v1"),
    ]);
    expect(diags).toEqual([]);
  });

  it("emits no diagnostic when role matches the id's naming hint", () => {
    const diags = validateTemplateRoles([
      makeTemplate("@m0saic/prague/intel/v1", "data-fetcher"),
      makeTemplate("@m0saic/dj/playlist-fetcher/v1", "data-fetcher"),
      makeTemplate("@m0saic/charts/bar-graph/internal/chart-frame/v1", "building-block"),
      makeTemplate("@m0saic/dj/session-pipeline/v1", "orchestrator"),
      makeTemplate("@m0saic/dev/wireframe-cell/v1", "harness"),
      makeTemplate("@m0saic/any/template/v1", "renderable"),
    ]);
    expect(diags).toEqual([]);
  });

  it("emits TEMPLATE_ROLE_NAMING_MISMATCH (warning) when role and id disagree", () => {
    const diags = validateTemplateRoles([
      makeTemplate("@m0saic/dj/playlist/v1", "data-fetcher"),
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe("TEMPLATE_ROLE_NAMING_MISMATCH");
    expect(diags[0]?.severity).toBe("warning");
    expect(diags[0]?.message).toContain('"@m0saic/dj/playlist/v1"');
    expect(diags[0]?.message).toContain("data-fetcher");
  });

  it("emits TEMPLATE_ROLE_NAMING_MISMATCH when role is outside the closed union", () => {
    const diags = validateTemplateRoles([
      makeTemplate("@m0saic/anything/v1", "consumer"),
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe("TEMPLATE_ROLE_NAMING_MISMATCH");
    expect(diags[0]?.severity).toBe("warning");
    expect(diags[0]?.message).toContain('"consumer"');
    expect(diags[0]?.message).toContain("Allowed");
  });

  it("renderable role is always permissive", () => {
    const diags = validateTemplateRoles([
      makeTemplate("@m0saic/anything/v1", "renderable"),
      makeTemplate("@community/whatever/v9", "renderable"),
      makeTemplate("/odd-shape-but-still-a-string", "renderable"),
    ]);
    expect(diags).toEqual([]);
  });

  it("skips templates missing a string id (handled by other validators)", () => {
    const noId = makeTemplate("@m0saic/x/v1", "data-fetcher");
    (noId as { id?: unknown }).id = undefined;
    const diags = validateTemplateRoles([noId]);
    expect(diags).toEqual([]);
  });

  it("reports each mismatched template independently", () => {
    const diags = validateTemplateRoles([
      makeTemplate("@m0saic/dj/playlist/v1", "data-fetcher"),
      makeTemplate("@m0saic/dj/session-hero/v1", "orchestrator"),
      makeTemplate("@m0saic/prague/intel/v1", "data-fetcher"), // OK
    ]);
    expect(diags).toHaveLength(2);
    for (const d of diags) {
      expect(d.code).toBe("TEMPLATE_ROLE_NAMING_MISMATCH");
      expect(d.severity).toBe("warning");
    }
  });
});
