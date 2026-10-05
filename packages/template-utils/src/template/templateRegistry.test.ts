import {
  declareTemplateCatalog,
  declareTemplateConventions,
  deepFreezeTemplate,
  drainTemplateRegistrationRejections,
  getTemplate,
  getTemplateAsRegistered,
  getTemplateMeta,
  getTemplateOrigin,
  isReservedTemplateId,
  registerTemplate,
  repoRelativeRegistrationPath,
  requireTemplate,
  withExternalTemplateOrigin,
  withTemplateReloadScope,
  TemplateRegistrationError,
  __resetTemplateRegistryForTests,
} from "./templateRegistry";
import type {
  MosaicTemplate,
  MosaicEngineContext,
  MosaicDocument,
} from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import { authoredCatalogFields } from "@m0saic/platform";
import { defineMosaicTemplate } from "./defineMosaicTemplate";
import { toM0String } from "@m0saic/dsl-stdlib";

function makeCtx(): MosaicEngineContext & { cache?: any } { return { mode: "render" as const,
    target: { width: 100, height: 100, fps: 30, durationMs: 1000 },
    output: {
      width: 100,
      height: 100,
      fps: 30,
      durationMs: 1000,
      workspaceDir: "/tmp",
    },
    media: {},
    cache: ({
      get: () => undefined,
      set: () => {},
      getOrCompute: async (_k: string, fn: () => any) => fn(),
    } as any),
  };
}

/** Minimal registrable template. `marker` rides along so a test can tell WHICH
 *  implementation is sitting in the registry, not merely that one is. */
function makeTemplate(id: string, marker = "impl"): MosaicTemplate<{}> {
  const doc: MosaicDocument = {
    kind: "mosaic_document",
    version: 1,
    assets: {} as any,
    m0: toM0String("F", "test"),
    sources: [],
    fps: 1,
    durationMs: 1,
  };
  return {
    id: asTemplateId(id),
    label: marker,
    version: 1,
    capabilities: { tier: "core" },
    description: "test fixture",
    tags: ["test"],
    propsSchema: {},
    defaultProps: {},
    render: async (_props: {}, _ctx: MosaicEngineContext) => doc,
  };
}

beforeEach(() => {
  // The registry is process-global (see ../processRegistry), so ownership
  // recorded by one test would otherwise decide the outcome of the next.
  __resetTemplateRegistryForTests();
});

test("registerTemplate wraps template via defineMosaicTemplate; loaded has wrapped render", async () => {
  const doc: MosaicDocument = {
    kind: "mosaic_document",
    version: 1,
    assets: {} as any,
    m0: toM0String("F", "test"),
    sources: [],
    fps: 1, durationMs: 1 ,
  };

  const originalRender: MosaicTemplate<{}>["render"] = jest.fn(
    async (_props: {}, _ctx: MosaicEngineContext & { cache?: any }) => doc
  );

  const template: MosaicTemplate<{}> = {
    id: asTemplateId("test/template/v1"),
    label: "Test",
    version: 1,
    capabilities: { tier: "core" },
    description: "test fixture",
    tags: ["test"],
    propsSchema: {},
    defaultProps: {},
    render: originalRender,
  };

  registerTemplate(template);
  const loaded = requireTemplate(template.id);

  // Registry wraps via defineMosaicTemplate, so loaded is the wrapped template
  expect(loaded).not.toBe(template);
  expect(loaded.render).not.toBe(originalRender);
  expect(loaded.id).toBe(template.id);

  await loaded.render({}, makeCtx());
  expect(originalRender).toHaveBeenCalled();
});

// ── Slug-hijack protection ───────────────────────────────────────────
//
// The vector these lock down: registration is `Map.set`, and external repos
// load AFTER the built-in packs, so without a policy the last writer of an id
// wins and a third-party repo can serve its own code under an official id.

describe("reserved namespace", () => {
  it("treats the @m0saic/ prefix as reserved, case-insensitively", () => {
    expect(isReservedTemplateId("@m0saic/charts/bar-graph/v2")).toBe(true);
    expect(isReservedTemplateId("@M0saic/Charts/Bar-Graph/v2")).toBe(true);
    expect(isReservedTemplateId("@hello/smoke/v1")).toBe(false);
    // Near-misses are NOT reserved by design — a prefix match can't solve
    // confusables, and over-reserving would block legitimate authors.
    expect(isReservedTemplateId("@m0saic-extras/thing/v1")).toBe(false);
  });

  it("refuses an external registration inside the reserved namespace", () => {
    registerTemplate(makeTemplate("@m0saic/charts/bar-graph/v2", "official"));

    const res = withExternalTemplateOrigin("/repos/bad-actor", () =>
      registerTemplate(makeTemplate("@m0saic/charts/bar-graph/v2", "impostor")),
    );

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.rejection.code).toBe(
      "TEMPLATE_ID_RESERVED_NAMESPACE",
    );
    expect(getTemplate("@m0saic/charts/bar-graph/v2")?.label).toBe("official");
  });

  // The squat case: the id is FREE, so an ownership-only check would allow it,
  // and m0saic would find its own slug already taken when it shipped.
  it("refuses a reserved id even when nothing has registered it yet", () => {
    const res = withExternalTemplateOrigin("/repos/bad-actor", () =>
      registerTemplate(makeTemplate("@m0saic/charts/not-shipped-yet/v1")),
    );

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.rejection.code).toBe(
      "TEMPLATE_ID_RESERVED_NAMESPACE",
    );
    expect(getTemplate("@m0saic/charts/not-shipped-yet/v1")).toBeUndefined();
  });

  it("refuses a reserved id registered from the repo's own module body", () => {
    registerTemplate(makeTemplate("@m0saic/alpine/donut/v3", "official"));

    // What an import-time hijack looks like: the call is NOT made by the host's
    // registration loop, so only the ambient origin can catch it.
    withExternalTemplateOrigin("/repos/bad-actor", () => {
      registerTemplate(makeTemplate("@m0saic/alpine/donut/v3", "impostor"));
    });

    expect(getTemplate("@m0saic/alpine/donut/v3")?.label).toBe("official");
  });
});

describe("trusted namespaces (pinned community repo)", () => {
  it("reserves @m0saic-dev/ from ordinary external sources", () => {
    expect(isReservedTemplateId("@m0saic-dev/print/dvd-wrap/v1")).toBe(true);

    const res = withExternalTemplateOrigin("/repos/bad-actor", () =>
      registerTemplate(makeTemplate("@m0saic-dev/print/dvd-wrap/v1", "impostor")),
    );

    expect(res.ok === false && res.rejection.code).toBe(
      "TEMPLATE_ID_RESERVED_NAMESPACE",
    );
    expect(getTemplate("@m0saic-dev/print/dvd-wrap/v1")).toBeUndefined();
  });

  it("reserves @m0saic-community/ too — the third protected namespace", () => {
    expect(isReservedTemplateId("@m0saic-community/pack/thing/v1")).toBe(true);

    const res = withExternalTemplateOrigin("/repos/bad-actor", () =>
      registerTemplate(makeTemplate("@m0saic-community/pack/thing/v1", "impostor")),
    );

    expect(res.ok === false && res.rejection.code).toBe(
      "TEMPLATE_ID_RESERVED_NAMESPACE",
    );
    expect(getTemplate("@m0saic-community/pack/thing/v1")).toBeUndefined();
  });

  it("lets a host-pinned source register inside its granted namespace", () => {
    const res = withExternalTemplateOrigin(
      "community:seed",
      () =>
        registerTemplate(
          makeTemplate("@m0saic-dev/print/dvd-wrap/v1", "community"),
        ),
      { trustedNamespaces: ["@m0saic-dev/"] },
    );

    expect(res.ok).toBe(true);
    expect(getTemplate("@m0saic-dev/print/dvd-wrap/v1")?.label).toBe("community");
    expect(getTemplateOrigin("@m0saic-dev/print/dvd-wrap/v1")).toEqual({
      kind: "external",
      source: "community:seed",
      trustedNamespaces: ["@m0saic-dev/"],
    });
  });

  /**
   * The front door is PACKLESS (`@<publisher>/<slug>/vN`) — the 3-segment
   * community shape. The screen matches on prefix, so segment count must not
   * matter to it; this pins that, and that the grant covers the repo's own
   * handle as of 2026-09-18 (both hosts' COMMUNITY_TRUSTED_NAMESPACES).
   */
  it("grants the repo's own handle, packless id and all", () => {
    const res = withExternalTemplateOrigin(
      "community:seed",
      () =>
        registerTemplate(
          makeTemplate("@m0saic-community/hello-world/v1", "front door"),
        ),
      { trustedNamespaces: ["@m0saic-dev/", "@m0saic-community/"] },
    );

    expect(res.ok).toBe(true);
    expect(getTemplate("@m0saic-community/hello-world/v1")?.label).toBe("front door");
  });

  /**
   * The grant is per-namespace, so a source holding only the founder's
   * publisher must NOT reach the front door's handle. This is the case that
   * would silently break if someone "simplified" the two entries into one
   * `@m0saic-` prefix.
   */
  it("the @m0saic-dev/ grant alone does not reach @m0saic-community/", () => {
    const res = withExternalTemplateOrigin(
      "community:seed",
      () =>
        registerTemplate(
          makeTemplate("@m0saic-community/hello-world/v1", "impostor"),
        ),
      { trustedNamespaces: ["@m0saic-dev/"] },
    );

    expect(res.ok === false && res.rejection.code).toBe(
      "TEMPLATE_ID_RESERVED_NAMESPACE",
    );
    expect(getTemplate("@m0saic-community/hello-world/v1")).toBeUndefined();
  });

  it("a granted namespace does not open the rest of the reserved space", () => {
    const res = withExternalTemplateOrigin(
      "community:seed",
      () =>
        registerTemplate(
          makeTemplate("@m0saic/charts/bar-graph/v2", "impostor"),
        ),
      { trustedNamespaces: ["@m0saic-dev/"] },
    );

    expect(res.ok === false && res.rejection.code).toBe(
      "TEMPLATE_ID_RESERVED_NAMESPACE",
    );
    expect(getTemplate("@m0saic/charts/bar-graph/v2")).toBeUndefined();
  });

  it("ownership still applies inside a trusted namespace", () => {
    registerTemplate(
      makeTemplate("@m0saic-dev/print/dvd-wrap/v1", "first-party-held"),
    );

    const res = withExternalTemplateOrigin(
      "community:seed",
      () =>
        registerTemplate(
          makeTemplate("@m0saic-dev/print/dvd-wrap/v1", "community"),
        ),
      { trustedNamespaces: ["@m0saic-dev/"] },
    );

    expect(res.ok === false && res.rejection.code).toBe(
      "TEMPLATE_ID_OWNED_BY_FIRST_PARTY",
    );
    expect(getTemplate("@m0saic-dev/print/dvd-wrap/v1")?.label).toBe(
      "first-party-held",
    );
  });

  it("lets the pinned source re-register its own ids (refresh loop)", () => {
    const pin = { trustedNamespaces: ["@m0saic-dev/"] };
    withExternalTemplateOrigin(
      "community:seed",
      () =>
        registerTemplate(makeTemplate("@m0saic-dev/community-m/emoji-grid/v1", "v1")),
      pin,
    );

    const res = withExternalTemplateOrigin(
      "community:seed",
      () =>
        registerTemplate(
          makeTemplate("@m0saic-dev/community-m/emoji-grid/v1", "rebuilt"),
        ),
      pin,
    );

    expect(res.ok).toBe(true);
    expect(getTemplate("@m0saic-dev/community-m/emoji-grid/v1")?.label).toBe(
      "rebuilt",
    );
  });
});

describe("ownership", () => {
  it("refuses an external overwrite of a first-party id outside the reserved namespace", () => {
    registerTemplate(makeTemplate("legacy/unprefixed/v1", "official"));

    const res = withExternalTemplateOrigin("/repos/bad-actor", () =>
      registerTemplate(makeTemplate("legacy/unprefixed/v1", "impostor")),
    );

    expect(res.ok === false && res.rejection.code).toBe(
      "TEMPLATE_ID_OWNED_BY_FIRST_PARTY",
    );
    expect(getTemplate("legacy/unprefixed/v1")?.label).toBe("official");
  });

  it("registers an external template in its own namespace and records the source", () => {
    const res = withExternalTemplateOrigin("/repos/acme", () =>
      registerTemplate(makeTemplate("@acme/card/v1", "acme")),
    );

    expect(res.ok).toBe(true);
    expect(getTemplate("@acme/card/v1")?.label).toBe("acme");
    expect(getTemplateOrigin("@acme/card/v1")).toEqual({
      kind: "external",
      source: "/repos/acme",
    });
  });

  // The rebuild → "Refresh repos" loop. Blocking this would break authoring.
  it("lets the same source re-register its own id", () => {
    withExternalTemplateOrigin("/repos/acme", () =>
      registerTemplate(makeTemplate("@acme/card/v1", "v1")),
    );
    const res = withExternalTemplateOrigin("/repos/acme", () =>
      registerTemplate(makeTemplate("@acme/card/v1", "v2-rebuilt")),
    );

    expect(res.ok).toBe(true);
    expect(getTemplate("@acme/card/v1")?.label).toBe("v2-rebuilt");
  });

  it("refuses a different external source taking an id another source holds", () => {
    withExternalTemplateOrigin("/repos/acme", () =>
      registerTemplate(makeTemplate("@acme/card/v1", "acme")),
    );

    const res = withExternalTemplateOrigin("/repos/copycat", () =>
      registerTemplate(makeTemplate("@acme/card/v1", "copycat")),
    );

    expect(res.ok === false && res.rejection.code).toBe(
      "TEMPLATE_ID_OWNED_BY_OTHER_SOURCE",
    );
    expect(res.ok === false && res.rejection.ownedBy).toEqual({
      kind: "external",
      source: "/repos/acme",
    });
    expect(getTemplate("@acme/card/v1")?.label).toBe("acme");
  });

  // First-party can RECLAIM a slug an external repo holds — the safe
  // direction, so it is deliberately unguarded (a hot reload after an external
  // load re-registers every built-in id). First-party over FIRST-PARTY is the
  // guarded case — see "first-party duplicate registration" below.
  it("lets first-party registration reclaim an externally held id", () => {
    withExternalTemplateOrigin("/repos/acme", () =>
      registerTemplate(makeTemplate("@acme/card/v1", "acme")),
    );

    const res = registerTemplate(makeTemplate("@acme/card/v1", "reclaimed"));

    expect(res.ok).toBe(true);
    expect(getTemplate("@acme/card/v1")?.label).toBe("reclaimed");
    expect(getTemplateOrigin("@acme/card/v1")).toEqual({ kind: "first-party" });
  });
});

describe("rejection log", () => {
  it("records every refusal and clears on drain", () => {
    registerTemplate(makeTemplate("@m0saic/charts/bar-graph/v2", "official"));

    withExternalTemplateOrigin("/repos/bad-actor", () => {
      registerTemplate(makeTemplate("@m0saic/charts/bar-graph/v2"));
      registerTemplate(makeTemplate("@m0saic/alpine/donut/v3"));
      registerTemplate(makeTemplate("@bad-actor/fine/v1"));
    });

    const drained = drainTemplateRegistrationRejections();
    expect(drained.map((r) => r.id)).toEqual([
      "@m0saic/charts/bar-graph/v2",
      "@m0saic/alpine/donut/v3",
    ]);
    expect(drained.every((r) => r.attemptedBy === "/repos/bad-actor")).toBe(true);
    // Draining twice must not re-report — hosts drain on every repo refresh.
    expect(drainTemplateRegistrationRejections()).toEqual([]);
  });
});

describe("withExternalTemplateOrigin", () => {
  it("restores the previous origin after a synchronous call", () => {
    withExternalTemplateOrigin("/repos/acme", () => {});

    registerTemplate(makeTemplate("@m0saic/charts/after/v1", "official"));
    expect(getTemplate("@m0saic/charts/after/v1")?.label).toBe("official");
  });

  it("keeps the scope open across an await and closes when it settles", async () => {
    await withExternalTemplateOrigin("/repos/acme", async () => {
      await Promise.resolve();
      // Still external here — the loader's import() resolves inside the scope.
      expect(
        registerTemplate(makeTemplate("@m0saic/charts/during/v1")).ok,
      ).toBe(false);
    });

    expect(registerTemplate(makeTemplate("@m0saic/charts/after/v1")).ok).toBe(true);
  });

  it("restores the origin when the callback throws", () => {
    expect(() =>
      withExternalTemplateOrigin("/repos/acme", () => {
        throw new Error("repo entry blew up");
      }),
    ).toThrow("repo entry blew up");

    expect(registerTemplate(makeTemplate("@m0saic/charts/after/v1")).ok).toBe(true);
  });

  it("restores the origin when an async callback rejects", async () => {
    await expect(
      withExternalTemplateOrigin("/repos/acme", async () => {
        throw new Error("import failed");
      }),
    ).rejects.toThrow("import failed");

    expect(registerTemplate(makeTemplate("@m0saic/charts/after/v1")).ok).toBe(true);
  });
});

describe("first-party duplicate registration (freeze bypass, adversary 2026-09-17)", () => {
  const ID = "@m0saic/charts/bar-graph/v2";
  const HERE = "packages/template-utils/src/template/templateRegistry.test.ts";

  it("throws a typed TEMPLATE_ID_ALREADY_REGISTERED error naming both files, keeps the first", () => {
    registerTemplate(makeTemplate(ID, "shipped"));

    let caught: unknown;
    try { registerTemplate(makeTemplate(ID, "impostor")); } catch (err) { caught = err; }

    expect(caught).toBeInstanceOf(TemplateRegistrationError);
    const e = caught as TemplateRegistrationError;
    expect(e.code).toBe("TEMPLATE_ID_ALREADY_REGISTERED");
    expect(e.id).toBe(ID);
    expect(e.registeredFrom).toBe(HERE);
    expect(e.attemptedFrom).toBe(HERE);
    expect(e.message).toContain(ID);
    expect(e.message).toContain(HERE);
    expect(e.message).toContain("withTemplateReloadScope");
    // The shipped template is untouched.
    expect(getTemplate(ID)?.label).toBe("shipped");
  });

  it("records registration provenance, repo-relative, readable via getTemplateMeta", () => {
    registerTemplate(makeTemplate(ID, "shipped"));
    expect(getTemplateMeta(ID)).toEqual({
      id: ID,
      origin: { kind: "first-party" },
      registeredFrom: HERE,
    });
    expect(getTemplateMeta("@m0saic/never/registered/v1")).toBeUndefined();
  });

  it("records the external source's provenance too", () => {
    withExternalTemplateOrigin("/repos/acme", () => registerTemplate(makeTemplate("@acme/card/v1")));
    const meta = getTemplateMeta("@acme/card/v1");
    expect(meta?.origin).toEqual({ kind: "external", source: "/repos/acme" });
    expect(meta?.registeredFrom).toBe(HERE);
  });

  it("withTemplateReloadScope lets the hot reload re-register (replacing entry + provenance), then closes", () => {
    registerTemplate(makeTemplate(ID, "before"));

    const res = withTemplateReloadScope(() => registerTemplate(makeTemplate(ID, "rebuilt")));
    expect(res.ok).toBe(true);
    expect(getTemplate(ID)?.label).toBe("rebuilt");
    expect(getTemplateMeta(ID)?.registeredFrom).toBe(HERE);

    // Scope closed: the guard is back.
    expect(() => registerTemplate(makeTemplate(ID, "again"))).toThrow(TemplateRegistrationError);
  });

  it("withTemplateReloadScope closes when the callback throws, and after an async callback settles", async () => {
    registerTemplate(makeTemplate(ID, "before"));
    expect(() => withTemplateReloadScope(() => { throw new Error("half-written dist"); })).toThrow("half-written dist");
    expect(() => registerTemplate(makeTemplate(ID, "again"))).toThrow(TemplateRegistrationError);

    await withTemplateReloadScope(async () => {
      await Promise.resolve();
      expect(registerTemplate(makeTemplate(ID, "async-rebuilt")).ok).toBe(true);
    });
    expect(getTemplate(ID)?.label).toBe("async-rebuilt");
    expect(() => registerTemplate(makeTemplate(ID, "again"))).toThrow(TemplateRegistrationError);
  });

  it("does not disturb the external paths: same-source refresh replaces, other-source is recorded not thrown", () => {
    withExternalTemplateOrigin("/repos/acme", () => registerTemplate(makeTemplate("@acme/card/v1", "v1")));
    const refreshed = withExternalTemplateOrigin("/repos/acme", () =>
      registerTemplate(makeTemplate("@acme/card/v1", "v2-rebuilt")),
    );
    expect(refreshed.ok).toBe(true);
    expect(getTemplate("@acme/card/v1")?.label).toBe("v2-rebuilt");

    const other = withExternalTemplateOrigin("/repos/copycat", () =>
      registerTemplate(makeTemplate("@acme/card/v1", "copycat")),
    );
    expect(other.ok).toBe(false);
    expect(drainTemplateRegistrationRejections().map((r) => r.code)).toEqual(["TEMPLATE_ID_OWNED_BY_OTHER_SOURCE"]);

    // An external attempt on a first-party id is still RECORDED, never thrown.
    registerTemplate(makeTemplate(ID, "shipped"));
    const hijack = withExternalTemplateOrigin("/repos/bad-actor", () => registerTemplate(makeTemplate(ID, "impostor")));
    expect(hijack.ok).toBe(false);
    expect(getTemplate(ID)?.label).toBe("shipped");
  });

  it("__resetTemplateRegistryForTests clears provenance with the rest", () => {
    registerTemplate(makeTemplate(ID, "shipped"));
    __resetTemplateRegistryForTests();
    expect(getTemplateMeta(ID)).toBeUndefined();
    expect(registerTemplate(makeTemplate(ID, "fresh")).ok).toBe(true);
  });
});

describe("immutable registrations (post-registration mutation bypass, adversary 2026-09-17)", () => {
  const ID = "@m0saic/charts/bar-graph/v2";

  /** A template with nested data at every level the pin cares about. */
  function richTemplate(id: string): MosaicTemplate<{ accent: string; series: number[] }> {
    const base = makeTemplate(id, "shipped") as unknown as MosaicTemplate<{ accent: string; series: number[] }>;
    return {
      ...base,
      propsSchema: {
        accent: { type: "string", label: "Accent", default: "#000" } as any,
        series: { type: "array", label: "Series", default: [1, 2, 3] } as any,
      },
      defaultProps: { accent: "#000", series: [1, 2, 3] },
      outputHints: { width: 100, height: 100, format: { kind: "image", container: "png" } } as any,
      lattice: { allow: [{ count: 53, reason: "ISO weeks" }] },
      deprecated: { reason: "test", since: "0.2.0" } as any,
    };
  }

  it("the registered object is the one getTemplate/requireTemplate return, and it is frozen", () => {
    registerTemplate(richTemplate(ID));
    const got = getTemplate(ID)!;
    expect(requireTemplate(ID)).toBe(got);
    expect(Object.isFrozen(got)).toBe(true);
  });

  it("reassigning render on a registered template throws a TypeError naming the property (strict mode)", () => {
    registerTemplate(richTemplate(ID));
    const tmpl = getTemplate(ID)!;
    const orig = tmpl.render;
    // The exact bypass: an unfrozen file wrapping the shipped render after registration.
    expect(() => {
      (tmpl as any).render = (p: any, c: any) => orig({ ...p, accent: "#ff0000" }, c);
    }).toThrow(TypeError);
    expect(() => { (tmpl as any).render = orig; }).toThrow(/render/);
    expect(getTemplate(ID)!.render).toBe(orig);
  });

  it("defaultProps, propsSchema.x, outputHints, lattice, deprecated and nested arrays are frozen too", () => {
    registerTemplate(richTemplate(ID));
    const tmpl = getTemplate(ID)! as any;
    expect(() => { tmpl.defaultProps = {}; }).toThrow(TypeError);
    expect(() => { tmpl.defaultProps.accent = "#ff0000"; }).toThrow(/accent/);
    expect(() => { tmpl.defaultProps.series.push(4); }).toThrow(TypeError);
    expect(() => { tmpl.defaultProps.series[0] = 99; }).toThrow(TypeError);
    expect(() => { tmpl.propsSchema.accent.default = "#ff0000"; }).toThrow(/default/);
    expect(() => { tmpl.propsSchema.accent = {}; }).toThrow(/accent/);
    expect(() => { delete tmpl.propsSchema.accent; }).toThrow(TypeError);
    expect(() => { tmpl.outputHints.format.container = "mp4"; }).toThrow(/container/);
    expect(() => { tmpl.lattice.allow[0].count = 7; }).toThrow(/count/);
    expect(() => { tmpl.lattice.allow.length = 0; }).toThrow(TypeError);
    expect(() => { delete tmpl.deprecated; }).toThrow(TypeError);
    expect(() => { tmpl.deprecated.reason = "changed"; }).toThrow(/reason/);
    expect(() => { tmpl.tags.push("evil"); }).toThrow(TypeError);
    expect(() => { tmpl.newField = 1; }).toThrow(TypeError);
    expect(Object.isFrozen(tmpl.defaultProps.series)).toBe(true);
    expect(Object.isFrozen(tmpl.lattice.allow)).toBe(true);
    expect(Object.isFrozen(tmpl.lattice.allow[0])).toBe(true);
    // Untouched: the shipped definition still reads as shipped.
    expect(tmpl.defaultProps).toEqual({ accent: "#000", series: [1, 2, 3] });
  });

  it("freezes external-origin registrations the same way", () => {
    withExternalTemplateOrigin("/repos/acme", () => registerTemplate(richTemplate("@acme/card/v1")));
    const tmpl = getTemplate("@acme/card/v1")! as any;
    expect(Object.isFrozen(tmpl)).toBe(true);
    expect(() => { tmpl.render = () => null; }).toThrow(TypeError);
    expect(() => { tmpl.defaultProps.accent = "#ff0000"; }).toThrow(TypeError);
  });

  it("does not freeze functions or class instances a template carries (the engine may own those)", () => {
    class Handle { count = 0; }
    const handle = new Handle();
    const t = richTemplate(ID) as any;
    t.propsSchema.accent.validate = (v: unknown) => typeof v === "string";
    t.defaultProps.handle = handle;
    registerTemplate(t);
    const tmpl = getTemplate(ID)! as any;
    expect(Object.isFrozen(tmpl.render)).toBe(false);
    expect(Object.isFrozen(tmpl.propsSchema.accent.validate)).toBe(false);
    expect(Object.isFrozen(tmpl.defaultProps.handle)).toBe(false);
    tmpl.defaultProps.handle.count = 1; // the instance itself stays mutable
    expect(handle.count).toBe(1);
    expect(() => { tmpl.defaultProps.handle = new Handle(); }).toThrow(TypeError); // its slot does not
  });

  it("deepFreezeTemplate is idempotent and cycle-safe", () => {
    const a: any = { x: { y: [1] } };
    a.self = a;
    a.x.back = a;
    expect(deepFreezeTemplate(a)).toBe(a);
    expect(deepFreezeTemplate(a)).toBe(a);
    expect(Object.isFrozen(a) && Object.isFrozen(a.x) && Object.isFrozen(a.x.y)).toBe(true);
  });

  it("withTemplateReloadScope still REPLACES the entry — a new frozen object, not a mutation", () => {
    registerTemplate(richTemplate(ID));
    const before = getTemplate(ID)!;
    withTemplateReloadScope(() => registerTemplate({ ...richTemplate(ID), label: "rebuilt" }));
    const after = getTemplate(ID)!;
    expect(after).not.toBe(before);
    expect(after.label).toBe("rebuilt");
    expect(before.label).toBe("shipped");
    expect(Object.isFrozen(after)).toBe(true);
  });

  it("the frozen template still renders through its wrapper", async () => {
    registerTemplate(richTemplate(ID));
    const doc = await requireTemplate(ID).render({ accent: "#000", series: [1] }, makeCtx());
    expect(doc.kind).toBe("mosaic_document");
  });
});

describe("repoRelativeRegistrationPath", () => {
  it("relativizes a packages/<name>/(src|dist) path to the repo root", () => {
    expect(repoRelativeRegistrationPath("/Users/x/src/m0saic/packages/templates/dist/m0saic/alpine/donut/v3/donut.js"))
      .toBe("packages/templates/dist/m0saic/alpine/donut/v3/donut.js");
    expect(repoRelativeRegistrationPath("C:\\src\\m0saic\\packages\\templates\\src\\m0saic\\x.ts"))
      .toBe("packages/templates/src/m0saic/x.ts");
  });

  it("uses the LAST packages/<name>/(src|dist) match, so a home directory named packages cannot confuse it", () => {
    expect(repoRelativeRegistrationPath("/home/packages/m0saic/packages/templates/src/a.ts"))
      .toBe("packages/templates/src/a.ts");
  });

  it("leaves anything else absolute (a vendored install, an external repo)", () => {
    expect(repoRelativeRegistrationPath("/usr/lib/node_modules/m0saic/vendor/@m0saic/templates/dist/x.js"))
      .toBe("/usr/lib/node_modules/m0saic/vendor/@m0saic/templates/dist/x.js");
    expect(repoRelativeRegistrationPath("/repos/acme/dist/index.js")).toBe("/repos/acme/dist/index.js");
  });
});

describe("the repo catalog (template-catalog.json, 0.3.1)", () => {
  const V1 = "@acme/cards/quote/v1";
  const V2 = "@acme/cards/quote/v2";
  const DEP = { reason: "v2 binds every prop", replacement: asTemplateId(V2), since: "2026-09-29" };
  /** A 0.3.1-style template: nothing descriptive in the file. */
  const bare = (id: string) => {
    const t = makeTemplate(id) as unknown as Record<string, unknown>;
    delete t.label;
    delete t.description;
    delete t.tags;
    return t as unknown as MosaicTemplate<{}>;
  };

  it("declared first, the catalog applies at registration — before the definition-time conventions judge it", () => {
    declareTemplateCatalog({ [V2]: { label: "Quote Card", description: "Pull quote.", tags: ["social"] } });
    // browseSurface would THROW for a first-party template with no label / description / tags.
    expect(() => registerTemplate(bare(V2))).not.toThrow();
    const t = getTemplate(V2)!;
    expect(t.label).toBe("Quote Card");
    expect(t.tags).toEqual(["social"]);
  });

  it("the as-registered view is the FILE: catalog fields at the file's own values (what a pin hashes)", () => {
    declareTemplateCatalog({ [V1]: { tags: ["retagged"], internal: true, deprecated: DEP } });
    registerTemplate(makeTemplate(V1));
    const resolved = getTemplate(V1)!;
    const written = getTemplateAsRegistered(V1)!;
    expect(resolved.tags).toEqual(["retagged"]);
    expect(resolved.internal).toBe(true);
    expect(resolved.deprecated).toEqual(DEP);
    expect(written.tags).toEqual(["test"]);
    expect(written.internal).toBeUndefined();
    expect(written.deprecated).toBeUndefined();
    expect(written.render).toBe(resolved.render);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(written)).toBe(true);
  });

  it("without a catalog entry, the as-registered view IS the registered template", () => {
    registerTemplate(makeTemplate(V1));
    expect(getTemplateAsRegistered(V1)).toBe(getTemplate(V1));
  });

  it("declared after registration, the same origin's template is restamped; the file view is kept", async () => {
    registerTemplate(makeTemplate(V1));
    const r = declareTemplateCatalog({ [V1]: { deprecated: DEP }, "@acme/none/v1": { tags: ["x"] } });
    expect(r).toEqual({ declared: [V1, "@acme/none/v1"], restamped: [V1] });
    expect(getTemplate(V1)!.deprecated).toEqual(DEP);
    expect(getTemplateAsRegistered(V1)!.deprecated).toBeUndefined();
    expect((await getTemplate(V1)!.render({}, makeCtx())).kind).toBe("mosaic_document");
  });

  it("an entry binds to the origin that declared it: an external repo cannot restyle a first-party template", () => {
    registerTemplate(makeTemplate(V1));
    withExternalTemplateOrigin("/repos/evil", () => declareTemplateCatalog({ [V1]: { internal: true, deprecated: DEP } }));
    expect(getTemplate(V1)!.internal).toBeUndefined();
    expect(getTemplate(V1)!.deprecated).toBeUndefined();
    // …nor on a later first-party re-registration (a hot reload).
    withTemplateReloadScope(() => registerTemplate(makeTemplate(V1, "reloaded")));
    expect(getTemplate(V1)!.internal).toBeUndefined();
  });

  it("a template its own module DEFINES (a repo's export) takes the declared catalog before the conventions", () => {
    declareTemplateCatalog({ [V2]: { label: "Quote Card", description: "Pull quote.", tags: ["social"] } });
    // What a template repo's module does at import: define, then export. No label in code.
    let defined: MosaicTemplate<{}> | undefined;
    expect(() => { defined = defineMosaicTemplate(bare(V2)); }).not.toThrow();
    expect(defined!.label).toBe("Quote Card");
    // …and it still answers for its FILE (nothing descriptive was written there).
    expect(authoredCatalogFields(defined!)).toEqual({});
    registerTemplate(defined!);
    expect(getTemplate(V2)!.tags).toEqual(["social"]);
    expect(getTemplateAsRegistered(V2)!.label).toBeUndefined();
  });

  it("without a declared catalog, a first-party define of an undescribed template still fails browseSurface", () => {
    expect(() => defineMosaicTemplate(bare("@acme/cards/undescribed/v1"))).toThrow(/browseSurface/);
  });

  it("a hot reload re-applies the declared catalog to the fresh registration", () => {
    declareTemplateCatalog({ [V1]: { tags: ["catalogued"] } });
    registerTemplate(makeTemplate(V1, "first"));
    withTemplateReloadScope(() => registerTemplate(makeTemplate(V1, "reloaded")));
    expect(getTemplate(V1)!.label).toBe("reloaded");
    expect(getTemplate(V1)!.tags).toEqual(["catalogued"]);
    expect(getTemplateAsRegistered(V1)!.tags).toEqual(["test"]);
  });
});

describe("declareTemplateConventions — the repo's conventions target (0.3.1)", () => {
  const bareT = (id: string) => {
    const t = makeTemplate(id) as unknown as Record<string, unknown>;
    delete t.label;
    delete t.description;
    delete t.tags;
    return t as unknown as MosaicTemplate<{}>;
  };

  it("a rule newer than the declared target is recorded as a warning at definition time, never thrown", () => {
    declareTemplateConventions("0.1.0"); // older than browseSurface (0.2.0)
    let t: MosaicTemplate<{}> | undefined;
    expect(() => { t = defineMosaicTemplate(bareT("@acme/old/target/v1")); }).not.toThrow();
    expect(t).toBeDefined();
  });

  it("clearing the target restores every rule", () => {
    declareTemplateConventions("0.1.0");
    declareTemplateConventions(undefined);
    expect(() => defineMosaicTemplate(bareT("@acme/old/strict/v1"))).toThrow(/browseSurface/);
  });

  it("the target binds to the origin that declared it", () => {
    withExternalTemplateOrigin("/repos/lenient", () => declareTemplateConventions("0.1.0"));
    expect(() => defineMosaicTemplate(bareT("@acme/first-party/v1"))).toThrow(/browseSurface/);
  });
});
