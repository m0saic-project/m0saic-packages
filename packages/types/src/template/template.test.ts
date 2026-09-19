/**
 * Type-level smoke tests for the post-redesign MosaicTemplate
 * generics and the new schema fields:
 *
 *   - `MosaicTemplate<P>` still compiles (single-arg legacy form).
 *   - `MosaicTemplate<P, O>` constrains `outputsSchema` to `keyof O`.
 *   - `MosaicTemplate<P, O, U>` narrows `ctx.upstreamVariables`.
 *   - `MosaicTemplate<P, O, U, D>` narrows `ctx.upstreamData`.
 *   - The variable-type set is JSON-shaped (no UI affordances).
 */
import type {
  MosaicCodeValue,
  MosaicPropControl,
  MosaicTemplate,
  MosaicTemplateOutputs,
  MosaicTemplateProps,
  MosaicTemplateSidecars,
  MosaicTemplateVariableDefinition,
  MosaicTemplateVariableType,
  TemplateRole,
} from "./template";
import {
  TEMPLATE_ROLES,
  TEMPLATE_ROLE_ID_HINTS,
  isTemplateRole,
} from "./template";
import type {
  MosaicTemplateUpstreamData,
  MosaicTemplateUpstreamVariables,
} from "../engine-context";
import { asAliasId, asAssetId, asTemplateId } from "../identifiers";

// A throwaway renderable just for shape tests (we never invoke
// render in these smoke tests).
const renderStub = async () => ({} as never);

describe("MosaicTemplate (post-redesign generics)", () => {
  it("accepts a read-only code handoff prop with language and source", () => {
    interface MyProps extends MosaicTemplateProps {
      setup: MosaicCodeValue;
    }
    const tpl: MosaicTemplate<MyProps> = {
      id: asTemplateId("@m0saic/test/code-handoff/v0"),
      label: "Code handoff",
      version: 1,
      capabilities: { tier: "core" },
      propsSchema: { setup: { type: "code", required: true } },
      defaultProps: {
        setup: {
          language: "javascript",
          code: "console.log('ready');",
        },
      },
      render: renderStub,
    };
    expect(tpl.propsSchema.setup?.type).toBe("code");
    expect(tpl.defaultProps?.setup.language).toBe("javascript");
  });

  it("compiles with the single-arg legacy form (MosaicTemplate<P>)", () => {
    interface MyProps extends MosaicTemplateProps {
      title: string;
    }
    const tpl: MosaicTemplate<MyProps> = {
      id: asTemplateId("@m0saic/test/legacy/v0"),
      label: "Legacy",
      version: 1,
      capabilities: { tier: "core" },
      propsSchema: { title: { type: "string", required: true } },
      defaultProps: { title: "" },
      render: renderStub,
    };
    expect(tpl.id).toBe("@m0saic/test/legacy/v0");
  });

  it("accepts the optional renderCover / renderTutorial members (sync or async)", () => {
    interface MyProps extends MosaicTemplateProps {
      title: string;
    }
    // Sync returns are legal for all three optional render* members; only
    // the required `render` is Promise-only.
    const syncStub = () => ({} as never);
    const tpl: MosaicTemplate<MyProps> = {
      id: asTemplateId("@m0saic/test/cover-tutorial/v0"),
      label: "Cover + tutorial",
      version: 1,
      capabilities: { tier: "core" },
      propsSchema: { title: { type: "string", required: true } },
      defaultProps: { title: "" },
      render: renderStub,
      renderLite: syncStub,
      renderCover: syncStub,
      renderTutorial: renderStub,
    };
    expect(typeof tpl.renderCover).toBe("function");
    expect(typeof tpl.renderTutorial).toBe("function");

    const bare: MosaicTemplate<MyProps> = {
      id: asTemplateId("@m0saic/test/no-cover/v0"),
      label: "No cover",
      version: 1,
      capabilities: { tier: "core" },
      propsSchema: { title: { type: "string", required: true } },
      defaultProps: { title: "" },
      render: renderStub,
    };
    expect(bare.renderCover).toBeUndefined();
    expect(bare.renderTutorial).toBeUndefined();
  });

  it("accepts outputsSchema and constrains keys to keyof O", () => {
    interface MyProps extends MosaicTemplateProps {
      org: string;
    }
    interface MyOutputs extends MosaicTemplateOutputs {
      topContributor: string;
      commitsToday: number;
    }
    const tpl: MosaicTemplate<MyProps, MyOutputs> = {
      id: asTemplateId("@m0saic/test/dashboard/v0"),
      label: "Dashboard",
      version: 1,
      capabilities: { tier: "core" },
      propsSchema: { org: { type: "string", required: true } },
      defaultProps: { org: "" },
      outputsSchema: {
        topContributor: { type: "string", required: true },
        commitsToday: { type: "number", required: true },
      },
      defaultOutputs: { topContributor: "", commitsToday: 0 },
      render: renderStub,
    };
    expect(tpl.outputsSchema?.commitsToday?.type).toBe("number");
    expect(tpl.defaultOutputs?.topContributor).toBe("");
  });

  it("upstreamVariablesSchema keys are constrained to keyof U", () => {
    interface MyProps extends MosaicTemplateProps {
      heading: string;
    }
    interface MyInputs extends MosaicTemplateUpstreamVariables {
      topContributor: string;
      commitsToday?: number;
    }
    const tpl: MosaicTemplate<
      MyProps,
      MosaicTemplateOutputs,
      MyInputs
    > = {
      id: asTemplateId("@m0saic/test/contrib-text/v0"),
      label: "Contributor text",
      version: 1,
      capabilities: { tier: "core" },
      propsSchema: { heading: { type: "string", required: true } },
      defaultProps: { heading: "" },
      upstreamVariablesSchema: {
        topContributor: { type: "string", required: true },
        commitsToday: { type: "number", required: false },
      },
      render: async (_, ctx) => {
        // ctx.upstreamVariables narrows to Readonly<MyInputs>.
        const top: string | undefined = ctx.upstreamVariables?.topContributor;
        const n: number | undefined = ctx.upstreamVariables?.commitsToday;
        void top;
        void n;
        return {} as never;
      },
    };
    expect(tpl.upstreamVariablesSchema?.topContributor?.required).toBe(true);
  });

  it("accepts sidecarsSchema with keys constrained to keyof S (5th generic)", () => {
    interface WatermarkProps extends MosaicTemplateProps {
      source: string;
    }
    interface WatermarkSidecars extends MosaicTemplateSidecars {
      watermark: {
        algorithm: "lsb" | "dct";
        seed: string;
      };
      audit: {
        renderedAt: string;
      };
    }
    const tpl: MosaicTemplate<
      WatermarkProps,
      MosaicTemplateOutputs,
      MosaicTemplateUpstreamVariables,
      MosaicTemplateUpstreamData,
      WatermarkSidecars
    > = {
      id: asTemplateId("@m0saic/forensic/watermark/v0"),
      label: "Forensic Watermark",
      version: 1,
      capabilities: { tier: "core" },
      propsSchema: { source: { type: "string", required: true } },
      defaultProps: { source: "" },
      sidecarsSchema: {
        watermark: {
          type: "object",
          required: true,
          description: "Forensic embedding record",
        },
        audit: {
          type: "object",
          required: false,
        },
      },
      render: renderStub,
    };
    expect(tpl.sidecarsSchema?.watermark?.required).toBe(true);
    expect(tpl.sidecarsSchema?.audit?.required).toBe(false);
  });

  it("MosaicTemplate<P> still compiles (5 generics, all defaults)", () => {
    interface MyProps extends MosaicTemplateProps {
      n: number;
    }
    const tpl: MosaicTemplate<MyProps> = {
      id: asTemplateId("@m0saic/test/defaults/v0"),
      label: "Defaults",
      version: 1,
      capabilities: { tier: "core" },
      propsSchema: { n: { type: "number", required: true } },
      defaultProps: { n: 0 },
      render: renderStub,
    };
    expect(tpl.sidecarsSchema).toBeUndefined();
  });

  it("upstreamDataSchema keys are constrained to keyof D (aliased reads)", () => {
    interface MyProps extends MosaicTemplateProps {
      slot: string;
    }
    interface MyUpData extends MosaicTemplateUpstreamData {
      templateContext: { team: string; season: number };
    }
    const tpl: MosaicTemplate<
      MyProps,
      MosaicTemplateOutputs,
      MosaicTemplateUpstreamVariables,
      MyUpData
    > = {
      id: asTemplateId("@m0saic/test/team-intro/v0"),
      label: "Team intro",
      version: 1,
      capabilities: { tier: "core" },
      propsSchema: { slot: { type: "string", required: true } },
      defaultProps: { slot: "hero" },
      upstreamDataSchema: {
        templateContext: {
          description: "Season-data block published by step 0",
          variables: {
            team: { type: "string", required: true },
            season: { type: "number", required: true },
          },
        },
      },
      render: async (_, ctx) => {
        const team: string | undefined = ctx.upstreamData?.templateContext.team;
        void team;
        return {} as never;
      },
    };
    expect(tpl.upstreamDataSchema?.templateContext?.variables.team?.type).toBe(
      "string",
    );
  });
});

describe("M0-family prop types (m0, m0c, m0p)", () => {
  it("accepts `type: \"m0\"` for bare layout inputs", () => {
    interface MyProps extends MosaicTemplateProps {
      layout: string;
    }
    const tpl: MosaicTemplate<MyProps> = {
      id: asTemplateId("@m0saic/test/bare-layout/v0"),
      label: "Bare layout",
      version: 1,
      capabilities: { tier: "core" },
      propsSchema: {
        layout: { type: "m0", required: false },
      },
      defaultProps: { layout: "1" },
      render: renderStub,
    };
    expect(tpl.propsSchema.layout?.type).toBe("m0");
  });

  it("accepts `type: \"m0c\"` (labeled layout)", () => {
    interface MyProps extends MosaicTemplateProps {
      layout: string;
    }
    const tpl: MosaicTemplate<MyProps> = {
      id: asTemplateId("@m0saic/test/labeled-layout/v0"),
      label: "Labeled layout",
      version: 1,
      capabilities: { tier: "core" },
      propsSchema: {
        layout: { type: "m0c", required: false },
      },
      defaultProps: { layout: "1" },
      render: renderStub,
    };
    expect(tpl.propsSchema.layout?.type).toBe("m0c");
  });

  it("accepts `type: \"m0p\"` (layout pack)", () => {
    interface MyProps extends MosaicTemplateProps {
      layoutPack: string;
    }
    const tpl: MosaicTemplate<MyProps> = {
      id: asTemplateId("@m0saic/test/layout-pack/v0"),
      label: "Layout pack",
      version: 1,
      capabilities: { tier: "core" },
      propsSchema: {
        layoutPack: { type: "m0p", required: false },
      },
      defaultProps: { layoutPack: "" },
      render: renderStub,
    };
    expect(tpl.propsSchema.layoutPack?.type).toBe("m0p");
  });

  describe("MosaicPropContract", () => {
    it("absent contract → enumerated mode (just declare the prop)", () => {
      interface MyProps extends MosaicTemplateProps {
        layoutPack: string;
      }
      const tpl: MosaicTemplate<MyProps> = {
        id: asTemplateId("@m0saic/test/enumerated/v0"),
        label: "Enumerated pack consumer",
        version: 1,
        capabilities: { tier: "core" },
        propsSchema: {
          layoutPack: { type: "m0p", required: false },
        },
        defaultProps: { layoutPack: "" },
        render: renderStub,
      };
      expect(tpl.propsSchema.layoutPack?.meta?.contract).toBeUndefined();
    });

    it("targeted mode: declares expectedEntries with required flags", () => {
      interface MyProps extends MosaicTemplateProps {
        layoutPack: string;
      }
      const tpl: MosaicTemplate<MyProps> = {
        id: asTemplateId("@m0saic/test/targeted/v0"),
        label: "Targeted pack consumer",
        version: 1,
        capabilities: { tier: "core" },
        propsSchema: {
          layoutPack: {
            type: "m0p",
            required: true,
            meta: {
              contract: {
                expectedEntries: {
                  desktop: {
                    description: "16:9 layout for web video",
                    required: true,
                  },
                  mobile: {
                    description: "9:16 layout for vertical social",
                    required: true,
                  },
                  square: {
                    description: "1:1 layout for feed posts",
                    required: false,
                  },
                },
              },
            },
          },
        },
        defaultProps: { layoutPack: "" },
        render: renderStub,
      };
      const contract = tpl.propsSchema.layoutPack?.meta?.contract;
      expect(contract?.expectedEntries?.desktop?.required).toBe(true);
      expect(contract?.expectedEntries?.square?.required).toBe(false);
    });

    it("strict mode rejects unexpected entries", () => {
      interface MyProps extends MosaicTemplateProps {
        layout: string;
      }
      const tpl: MosaicTemplate<MyProps> = {
        id: asTemplateId("@m0saic/test/strict-m0c/v0"),
        label: "Strict m0c consumer",
        version: 1,
        capabilities: { tier: "core" },
        propsSchema: {
          layout: {
            type: "m0c",
            required: true,
            meta: {
              contract: {
                expectedEntries: {
                  hero: { required: true },
                  cta: { required: true },
                },
                strict: true,
              },
            },
          },
        },
        defaultProps: { layout: "1" },
        render: renderStub,
      };
      expect(tpl.propsSchema.layout?.meta?.contract?.strict).toBe(true);
    });

    it("contract shape is identical for m0c and m0p (only the parent prop type differs)", () => {
      // Same MosaicPropContract type works for both. The semantic
      // meaning of "entries" depends on the prop kind — labels for
      // m0c, variants for m0p.
      interface MyProps extends MosaicTemplateProps {
        labeledLayout: string;
        pack: string;
      }
      const tpl: MosaicTemplate<MyProps> = {
        id: asTemplateId("@m0saic/test/both/v0"),
        label: "Both",
        version: 1,
        capabilities: { tier: "core" },
        propsSchema: {
          labeledLayout: {
            type: "m0c",
            required: false,
            meta: { contract: { expectedEntries: { hero: { required: true } } } },
          },
          pack: {
            type: "m0p",
            required: false,
            meta: { contract: { expectedEntries: { desktop: { required: true } } } },
          },
        },
        defaultProps: { labeledLayout: "1", pack: "" },
        render: renderStub,
      };
      expect(tpl.propsSchema.labeledLayout?.meta?.contract).toBeDefined();
      expect(tpl.propsSchema.pack?.meta?.contract).toBeDefined();
    });
  });
});

describe("MosaicTemplateVariableType", () => {
  it("covers the JSON-shaped set", () => {
    const types: MosaicTemplateVariableType[] = [
      "string",
      "string[]",
      "number",
      "number[]",
      "boolean",
      "boolean[]",
      "object",
      "any",
    ];
    expect(types).toHaveLength(8);
  });

  it("does NOT include UI affordances (media / group / list / m0)", () => {
    // Compile-time: assigning a prop-only literal to the variable
    // type alias is a TS error. We assert at runtime that the
    // disallowed strings do not appear in any allowed-set sample.
    const allowed: readonly MosaicTemplateVariableType[] = [
      "string",
      "string[]",
      "number",
      "number[]",
      "boolean",
      "boolean[]",
      "object",
      "any",
    ];
    for (const banned of ["media", "media[]", "group", "list", "m0"] as const) {
      expect((allowed as readonly string[]).includes(banned)).toBe(false);
    }
  });
});

describe("MosaicTemplateVariableDefinition", () => {
  it("accepts the minimal shape (type + required)", () => {
    const def: MosaicTemplateVariableDefinition = {
      type: "string",
      required: true,
    };
    expect(def.type).toBe("string");
  });

  it("accepts narrow numeric / enum constraints", () => {
    const def: MosaicTemplateVariableDefinition = {
      type: "number",
      required: true,
      description: "Commits in last 24h",
      constraints: { min: 0, max: 10_000 },
    };
    expect(def.constraints?.max).toBe(10_000);
  });

  it("accepts oneOf constraint for enum-style strings", () => {
    const def: MosaicTemplateVariableDefinition = {
      type: "string",
      required: true,
      constraints: { oneOf: ["preview", "stable"] },
    };
    expect(def.constraints?.oneOf).toEqual(["preview", "stable"]);
  });
});

describe("MosaicPropControl — file-extension filter", () => {
  it("a file picker can declare the extensions it reads", () => {
    const control: MosaicPropControl = {
      picker: "file",
      extensions: ["srt", "txt", "lrc"],
    };
    expect(control.extensions).toEqual(["srt", "txt", "lrc"]);
  });
});

describe("MosaicPropControl — options + optionsFrom", () => {
  it("accepts options with optional image and description fields", () => {
    const control: MosaicPropControl = {
      options: [
        {
          value: "alice",
          label: "Alice",
          image: asAssetId("alice_headshot"),
          description: "Recently uploaded a highlight",
        },
        { value: "bob", label: "Bob" }, // image / description optional
      ],
    };
    expect(control.options?.[0]?.image).toBe("alice_headshot");
    expect(control.options?.[1]?.description).toBeUndefined();
  });

  it("accepts optionsFrom binding to an upstream data alias", () => {
    const control: MosaicPropControl = {
      optionsFrom: {
        data: asAliasId("pragueAthletes"),
        arrayPath: "athletes",
        valueKey: "id",
        labelKey: "name",
        imageKey: "headshotAssetId",
        descriptionKey: "tagline",
      },
    };
    expect(control.optionsFrom?.data).toBe("pragueAthletes");
    expect(control.optionsFrom?.imageKey).toBe("headshotAssetId");
  });

  it("optionsFrom + options coexist (static options act as fallback)", () => {
    // Editor resolves optionsFrom first; falls back to options when
    // the publisher is missing, the fetch fails, or the resolved
    // array is empty.
    const control: MosaicPropControl = {
      optionsFrom: {
        data: asAliasId("pragueAthletes"),
        arrayPath: "athletes",
        valueKey: "id",
        labelKey: "name",
        imageKey: "headshotAssetId",
      },
      options: [
        { value: "__placeholder__", label: "No athletes available" },
      ],
    };
    expect(control.optionsFrom).toBeDefined();
    expect(control.options?.[0]?.value).toBe("__placeholder__");
  });

  it("optionsFrom keys other than valueKey are optional", () => {
    const control: MosaicPropControl = {
      optionsFrom: {
        data: asAliasId("simpleList"),
        valueKey: "id",
        // labelKey, imageKey, descriptionKey, arrayPath all omitted
      },
    };
    expect(control.optionsFrom?.valueKey).toBe("id");
    expect(control.optionsFrom?.labelKey).toBeUndefined();
  });
});

describe('MosaicPropControl — flavor: "criteriaFilter" + criteria catalog', () => {
  it("accepts a full criteria catalog (every kind + per-kind extras)", () => {
    const control: MosaicPropControl = {
      flavor: "criteriaFilter",
      criteria: [
        { key: "q", label: "Search term", kind: "search" },
        {
          key: "date",
          label: "Date",
          kind: "date",
          modifiers: ["EQUALS", "BETWEEN", "IS_NULL"],
        },
        {
          key: "rating",
          label: "Rating",
          kind: "number",
          modifiers: ["EQUALS", "GREATER_THAN", "LESS_THAN"],
          min: 0,
          max: 100,
        },
        { key: "title", label: "Title", kind: "text", modifiers: ["INCLUDES"] },
        {
          key: "tags",
          label: "Tags",
          kind: "idSet",
          modifiers: ["INCLUDES", "INCLUDES_ALL", "EXCLUDES"],
          hierarchical: true,
          optionsFromConnection: {
            kind: "tags",
            connectionFromProp: "connectionId",
          },
        },
        { key: "organized", label: "Organized", kind: "boolean" },
      ],
    };
    expect(control.flavor).toBe("criteriaFilter");
    expect(control.criteria).toHaveLength(6);
    expect(control.criteria?.[4]?.hierarchical).toBe(true);
    expect(control.criteria?.[4]?.optionsFromConnection?.kind).toBe("tags");
  });

  it("kind values are constrained to the closed set (type-only)", () => {
    const control: MosaicPropControl = {
      flavor: "criteriaFilter",
      criteria: [
        // @ts-expect-error — "enum" is not a criterion kind
        { key: "x", label: "X", kind: "enum" },
      ],
    };
    expect(control.criteria?.[0]?.key).toBe("x");
  });
});

// covers: T:template.TEMPLATE_ROLES, T:template.TemplateRole,
//         T:template.isTemplateRole, T:template.TEMPLATE_ROLE_ID_HINTS,
//         T:template.MosaicTemplate.role
describe("TemplateRole (optional role tag + naming hints)", () => {
  it("exposes the closed list of recognized roles", () => {
    expect([...TEMPLATE_ROLES]).toEqual([
      "renderable",
      "data-fetcher",
      "adapter",
      "building-block",
      "orchestrator",
      "harness",
    ]);
  });

  it("isTemplateRole accepts every union member and rejects everything else", () => {
    for (const ok of TEMPLATE_ROLES) {
      expect(isTemplateRole(ok)).toBe(true);
    }
    for (const bad of [
      "",
      "Renderable",
      "renderer",
      "fetcher",
      "datafetcher",
      "data_fetcher",
      "consumer",
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isTemplateRole(bad)).toBe(false);
    }
  });

  it("renderable hint is permissive (accepts any id)", () => {
    const hint = TEMPLATE_ROLE_ID_HINTS.renderable;
    for (const id of [
      "@m0saic/anything/v1",
      "@community/whatever/v9",
      "/no/slashes-here",
      "x",
    ]) {
      expect(hint.test(id)).toBe(true);
    }
  });

  it("data-fetcher hint accepts /fetcher/, /intel/, /prologue/", () => {
    const hint = TEMPLATE_ROLE_ID_HINTS["data-fetcher"];
    expect(hint.test("@m0saic/dj/playlist-fetcher/v1")).toBe(true);
    expect(hint.test("@m0saic/prague/intel/v1")).toBe(true);
    expect(hint.test("@m0saic/prague/prologue/v1")).toBe(true);
    expect(hint.test("@m0saic/dj/playlist/v1")).toBe(false);
    expect(hint.test("@m0saic/dj/loader/v1")).toBe(false);
  });

  it("adapter hint accepts /adapter/, /bridge/", () => {
    const hint = TEMPLATE_ROLE_ID_HINTS.adapter;
    expect(hint.test("@m0saic/github/weekly-pulse-adapter/v1")).toBe(true);
    expect(hint.test("@m0saic/x/team-a-bridge/v1")).toBe(true);
    expect(hint.test("@m0saic/x/adapter/v1")).toBe(true);
    expect(hint.test("@m0saic/github/repo-facts-fetcher/v1")).toBe(false);
    expect(hint.test("@m0saic/x/transform/v1")).toBe(false);
  });

  it("building-block hint accepts /internal/, /building-block/, /block/", () => {
    const hint = TEMPLATE_ROLE_ID_HINTS["building-block"];
    expect(hint.test("@m0saic/charts/bar-graph/internal/chart-frame/v1")).toBe(true);
    expect(hint.test("@m0saic/pack/building-block/widget/v1")).toBe(true);
    expect(hint.test("@m0saic/pack/block/tile/v1")).toBe(true);
    expect(hint.test("@m0saic/pack/widget/v1")).toBe(false);
  });

  it("orchestrator hint accepts /pipeline/, /orchestrator/, /flow/", () => {
    const hint = TEMPLATE_ROLE_ID_HINTS.orchestrator;
    expect(hint.test("@m0saic/dj/session-pipeline/v1")).toBe(true);
    expect(hint.test("@m0saic/dj/session-orchestrator/v1")).toBe(true);
    expect(hint.test("@m0saic/dj/session-flow/v1")).toBe(true);
    expect(hint.test("@m0saic/dj/session-hero/v1")).toBe(false);
  });

  it("harness hint accepts /harness/, /wireframe/, /scaffold/", () => {
    const hint = TEMPLATE_ROLE_ID_HINTS.harness;
    expect(hint.test("@m0saic/internal/wireframe-cell/v1")).toBe(true);
    expect(hint.test("@m0saic/dev/harness/v1")).toBe(true);
    expect(hint.test("@m0saic/dev/scaffold/v1")).toBe(true);
    expect(hint.test("@m0saic/internal/cell/v1")).toBe(false);
  });

  it("MosaicTemplate.role compiles when set, and is optional", () => {
    interface P extends MosaicTemplateProps {}
    const withRole: MosaicTemplate<P> = {
      id: asTemplateId("@m0saic/prague/intel/v1"),
      label: "Prague Intel",
      version: 1,
      capabilities: { tier: "core" },
      role: "data-fetcher",
      propsSchema: {},
      defaultProps: {},
      render: renderStub,
    };
    const withoutRole: MosaicTemplate<P> = {
      id: asTemplateId("@m0saic/test/plain/v1"),
      label: "Plain",
      version: 1,
      capabilities: { tier: "core" },
      propsSchema: {},
      defaultProps: {},
      render: renderStub,
    };
    expect(withRole.role).toBe("data-fetcher");
    expect(withoutRole.role).toBeUndefined();
  });

  // Type-level: role must come from the closed union. Uncommenting
  // the @ts-expect-error below would compile if the union widened.
  it("role values are constrained to the closed union (type-only)", () => {
    const role: TemplateRole = "data-fetcher";
    expect(isTemplateRole(role)).toBe(true);
    // @ts-expect-error — "consumer" is not in TEMPLATE_ROLES
    const bad: TemplateRole = "consumer";
    expect(isTemplateRole(bad)).toBe(false);
  });
});

describe('MosaicPropControl — picker: "regions"', () => {
  it("accepts the regions picker with a cardinality + shapes block", () => {
    const control: MosaicPropControl = {
      picker: "regions",
      regions: { min: 1, max: 50, shapes: ["rect"] },
    };
    expect(control.picker).toBe("regions");
    expect(control.regions?.max).toBe(50);
    expect(control.regions?.shapes).toEqual(["rect"]);
  });

  it("accepts a single-region declaration (max 1, bounds optional)", () => {
    const control: MosaicPropControl = {
      picker: "regions",
      regions: { max: 1 },
    };
    expect(control.regions?.min).toBeUndefined();
    expect(control.regions?.max).toBe(1);
  });

  it("shapes are constrained to the draw-tool union (type-only)", () => {
    const control: MosaicPropControl = {
      picker: "regions",
      regions: { shapes: ["rect", "ellipse", "polygon", "lasso"] },
    };
    expect(control.regions?.shapes).toHaveLength(4);
    const bad: MosaicPropControl = {
      picker: "regions",
      // @ts-expect-error — "wand" is not a MosaicRegionShapeKind
      regions: { shapes: ["wand"] },
    };
    expect(bad.picker).toBe("regions");
  });
});

describe('MosaicPropControl — picker: "cue-track"', () => {
  it("accepts the cue-track picker with a media binding + cardinality block", () => {
    const control: MosaicPropControl = {
      picker: "cue-track",
      cueTrack: { mediaFromProp: "songId", maxCues: 400 },
    };
    expect(control.picker).toBe("cue-track");
    expect(control.cueTrack?.mediaFromProp).toBe("songId");
    expect(control.cueTrack?.maxCues).toBe(400);
  });

  it("accepts a bare declaration (both config fields optional)", () => {
    const control: MosaicPropControl = {
      picker: "cue-track",
      cueTrack: {},
    };
    expect(control.cueTrack?.mediaFromProp).toBeUndefined();
    expect(control.cueTrack?.maxCues).toBeUndefined();
  });

  it("accepts the picker without a cueTrack block at all", () => {
    const control: MosaicPropControl = { picker: "cue-track" };
    expect(control.picker).toBe("cue-track");
    expect(control.cueTrack).toBeUndefined();
  });

  it("accepts a vocabulary block — every field optional (a non-lyric consumer)", () => {
    const control: MosaicPropControl = {
      picker: "cue-track",
      cueTrack: {
        mediaFromProp: "sourceId",
        maxCues: 24,
        vocabulary: {
          item: "spin",
          media: "video",
          pasteHint: "One winner per line — the option label, or ? for random.",
        },
      },
    };
    expect(control.cueTrack?.vocabulary?.item).toBe("spin");
    expect(control.cueTrack?.vocabulary?.items).toBeUndefined();
    expect(control.cueTrack?.vocabulary?.collection).toBeUndefined();
    expect(control.cueTrack?.vocabulary?.media).toBe("video");
    expect(control.cueTrack?.vocabulary?.beatLabel).toBeUndefined();
  });

  it("accepts the full lyric vocabulary (the karaoke consumer)", () => {
    const control: MosaicPropControl = {
      picker: "cue-track",
      cueTrack: {
        mediaFromProp: "songId",
        wordTiming: true,
        vocabulary: {
          item: "line",
          items: "lines",
          collection: "lyrics",
          media: "song",
          beatLabel: "[Instrumental]",
        },
      },
    };
    expect(control.cueTrack?.vocabulary).toEqual({
      item: "line",
      items: "lines",
      collection: "lyrics",
      media: "song",
      beatLabel: "[Instrumental]",
    });
  });
});

describe("MosaicTemplate.resolveOutputHints (prop-aware output hints)", () => {
  it("is an optional pure function of the template's own props", () => {
    type P = { platform?: string };
    const tmpl: MosaicTemplate<P> = {
      id: asTemplateId("@test/creator/sized/v1"),
      label: "Sized",
      version: 1,
      description: "canvas follows a knob",
      tags: ["test"],
      capabilities: { tier: "core" },
      propsSchema: { platform: { type: "string", required: false } },
      defaultProps: { platform: "wide" },
      outputHints: { width: 1920, height: 1080 },
      resolveOutputHints: (props) =>
        props.platform === "tall" ? { width: 1080, height: 1920 } : {},
      render: async () => ({}) as never,
    };
    expect(tmpl.resolveOutputHints?.({ platform: "tall" })).toEqual({ width: 1080, height: 1920 });
    expect(tmpl.resolveOutputHints?.(tmpl.defaultProps as P)).toEqual({});
  });
});
