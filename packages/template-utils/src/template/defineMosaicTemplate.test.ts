import {
  defineMosaicTemplate,
  unwrapTemplateFunction,
  TEMPLATE_WRAPPED_FROM,
  __resetCapabilityDenialWarnings,
} from "./defineMosaicTemplate";
import { toM0String } from "@m0saic/dsl-stdlib";
import type {
  MosaicTemplate,
  MosaicEngineContext,
  MosaicDocument,
} from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";

function makeCtx(): MosaicEngineContext & { cache?: any } { return { mode: "render" as const,
    target: { width: 1280, height: 720, fps: 60, durationMs: 5000 },
    output: {
      width: 1280,
      height: 720,
      fps: 60,
      durationMs: 5000,
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

describe("defineMosaicTemplate", () => {
  test("5-generic form type-narrows outputs / sidecars / upstream", async () => {
    // This test exists primarily as a compile-time gate: if the
    // generic signature regresses, this stops compiling. Runtime
    // behavior is identical to the 1-generic form.
    type Props = { q: string };
    type Outputs = { fetched: { count: number } };
    type Upstream = { sceneCount: number };
    type UpstreamData = { repositories: { repos: number[] } };
    type Sidecars = { fetched: Outputs["fetched"] };

    const template = defineMosaicTemplate<
      Props,
      Outputs,
      Upstream,
      UpstreamData,
      Sidecars
    >({
      id: asTemplateId("TypedTestTemplate"),
      label: "Typed",
      version: 1,
      capabilities: { tier: "core" },
      description: "test fixture",
      tags: ["test"],
      propsSchema: { q: { type: "string", required: true } },
      defaultProps: { q: "default" },

      async render(_props, ctx) {
        // Type-narrowed reads — these compile only if the generics
        // flow through correctly.
        const _u: number | undefined = ctx.upstreamVariables?.sceneCount;
        const _d: ReadonlyArray<number> | undefined =
          ctx.upstreamData?.repositories?.repos;

        const doc: MosaicDocument = {
          kind: "mosaic_document",
          version: 1,
          assets: {} as any,
          m0: toM0String("F", "typed"),
          sources: [],
          fps: 24,
          durationMs: 1000,
          sidecars: { fetched: { count: 7 } },
        };
        return doc;
      },
    });

    // Runtime sanity: wrapped template still functions. We cast the
    // helper-built ctx since makeCtx() returns the default
    // MosaicEngineContext; the strict generics require U/D to match
    // the typed shape declared above.
    const ctx = makeCtx() as unknown as MosaicEngineContext<Upstream, UpstreamData>;
    const result = await template.render({ q: "x" }, ctx);
    expect(result.kind).toBe("mosaic_document");
  });

  test("1-generic form still compiles unchanged (defaults preserve back-compat)", async () => {
    // No outputs / upstream / sidecars declared. This is the
    // ergonomic shape every existing template uses.
    const template = defineMosaicTemplate<{ a: number }>({
      id: asTemplateId("Default1Gen"),
      label: "Default 1-gen",
      version: 1,
      capabilities: { tier: "core" },
      description: "test fixture",
      tags: ["test"],
      propsSchema: { a: { type: "number", required: true } },
      defaultProps: { a: 1 },
      async render(_p, _c) {
        const doc: MosaicDocument = {
          kind: "mosaic_document",
          version: 1,
          assets: {} as any,
          m0: toM0String("F", "default-1-gen"),
          sources: [],
          fps: 24,
          durationMs: 1000,
        };
        return doc;
      },
    });

    const ctx = makeCtx();
    const result = await template.render({ a: 1 }, ctx);
    expect(result.kind).toBe("mosaic_document");
  });

  test("auto-stamps timing and preserves this", async () => {
    const ctx = makeCtx();

    const template: MosaicTemplate<{ value: number }> = {
      id: asTemplateId("TestTemplate"),
      label: "Test Template",
      version: 1,
      capabilities: { tier: "core" },
      description: "test fixture",
      tags: ["test"],
      propsSchema: {},
      defaultProps: { value: 1 },

      async render(_props, _ctx) {
        if (this.id !== asTemplateId("TestTemplate")) {
          throw new Error("this binding lost");
        }

        const doc: MosaicDocument = {
          kind: "mosaic_document",
          version: 1,
          assets: {} as any,
          m0: toM0String("F", "test"),
          sources: [] as any,
          fps: 24,
          durationMs: 1000,
        };

        return doc;
      },
    };

    const wrapped = defineMosaicTemplate(template);
    const result = await wrapped.render({ value: 1 }, ctx);

    expect(result.kind).toBe("mosaic_document");
    if (result.kind !== "mosaic_document") throw new Error("expected document");

    expect(result.fps).toBe(60);
    // Gate-26 authored-intent law: a doc that DECLARES durationMs keeps it
    // (this fixture authors 1000; the old unconditional 5000 ctx-stamp was
    // exactly the "big buck bunny defaulted to 10 seconds" clobber).
    expect(result.durationMs).toBe(1000);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Level 1 capability gate (F1 Phase 2) — default-deny for
// ctx.secrets / ctx.connections on non-capability-tier templates.
// ─────────────────────────────────────────────────────────────────────

describe("defineMosaicTemplate — Level 1 capability gate", () => {
  // These tests read the denied handles on purpose, which now trips the
  // denial tripwire (see the observability suite below). Silence the
  // advice so the run output stays about assertions.
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  const fakeSecrets = {
    get: async () => "s3cret",
    has: async () => true,
  };
  const fakeConnections = {
    get: async () => ({ url: "http://localhost" }),
    has: async () => true,
  };

  const simpleDoc = (): MosaicDocument => ({
    kind: "mosaic_document",
    version: 1,
    assets: {} as any,
    m0: toM0String("F", "gate"),
    sources: [],
    fps: 60,
    durationMs: 5000,
  });

  const ctxWithCapabilities = () =>
    ({
      ...makeCtx(),
      secrets: fakeSecrets,
      connections: fakeConnections,
    } as unknown as MosaicEngineContext);

  function makeGateTemplate(
    capabilities: MosaicTemplate<Record<string, never>>["capabilities"] | undefined,
    seen: { ctx?: MosaicEngineContext },
  ) {
    return defineMosaicTemplate<Record<string, never>>({
      id: asTemplateId("GateTestTemplate"),
      label: "Gate",
      version: 1,
      ...(capabilities !== undefined ? { capabilities } : ({} as any)),
      description: "test fixture",
      tags: ["test"],
      propsSchema: {},
      defaultProps: {},
      async render(_props, ctx) {
        seen.ctx = ctx;
        return simpleDoc();
      },
      renderLite(_props, ctx) {
        seen.ctx = ctx;
        return simpleDoc();
      },
      renderCover(_props, ctx) {
        seen.ctx = ctx;
        return simpleDoc();
      },
      renderTutorial(_props, ctx) {
        seen.ctx = ctx;
        return simpleDoc();
      },
    });
  }

  test("core tier: secrets/connections stripped; cache and other fields preserved", async () => {
    const seen: { ctx?: MosaicEngineContext } = {};
    const template = makeGateTemplate({ tier: "core" }, seen);
    const ctx = ctxWithCapabilities();

    await template.render({}, ctx);

    expect((seen.ctx as any).secrets).toBeUndefined();
    expect((seen.ctx as any).connections).toBeUndefined();
    // Everything else survives the shallow copy — including the
    // engine-internal cache intersection.
    expect((seen.ctx as any).cache).toBe((ctx as any).cache);
    expect(seen.ctx!.target).toBe(ctx.target);
    expect(seen.ctx!.output).toBe(ctx.output);
    expect(seen.ctx!.media).toBe(ctx.media);
  });

  test("capability tier: secrets/connections pass through untouched", async () => {
    const seen: { ctx?: MosaicEngineContext } = {};
    const template = makeGateTemplate({ tier: "capability", caps: {} }, seen);
    const ctx = ctxWithCapabilities();

    await template.render({}, ctx);

    expect((seen.ctx as any).secrets).toBe(fakeSecrets);
    expect((seen.ctx as any).connections).toBe(fakeConnections);
    expect(seen.ctx).toBe(ctx);
  });

  test("undefined capabilities: treated as core → denied", async () => {
    const seen: { ctx?: MosaicEngineContext } = {};
    const template = makeGateTemplate(undefined, seen);

    await template.render({}, ctxWithCapabilities());

    expect((seen.ctx as any).secrets).toBeUndefined();
    expect((seen.ctx as any).connections).toBeUndefined();
  });

  test("core tier with nothing to strip: ctx stays reference-identical", async () => {
    const seen: { ctx?: MosaicEngineContext } = {};
    const template = makeGateTemplate({ tier: "core" }, seen);
    const bare = makeCtx() as unknown as MosaicEngineContext;

    await template.render({}, bare);

    expect(seen.ctx).toBe(bare);
  });

  test("renderLite is gated identically", async () => {
    const seenCore: { ctx?: MosaicEngineContext } = {};
    const coreTemplate = makeGateTemplate({ tier: "core" }, seenCore);
    await coreTemplate.renderLite!({}, ctxWithCapabilities());
    expect((seenCore.ctx as any).secrets).toBeUndefined();
    expect((seenCore.ctx as any).connections).toBeUndefined();

    const seenCap: { ctx?: MosaicEngineContext } = {};
    const capTemplate = makeGateTemplate({ tier: "capability", caps: {} }, seenCap);
    await capTemplate.renderLite!({}, ctxWithCapabilities());
    expect((seenCap.ctx as any).secrets).toBe(fakeSecrets);
  });

  test("templates without renderLite don't grow one", () => {
    const template = defineMosaicTemplate<Record<string, never>>({
      id: asTemplateId("NoLiteTemplate"),
      label: "NoLite",
      version: 1,
      capabilities: { tier: "core" },
      description: "test fixture",
      tags: ["test"],
      propsSchema: {},
      defaultProps: {},
      async render() {
        return simpleDoc();
      },
    });
    expect(template.renderLite).toBeUndefined();
  });

  test("renderCover / renderTutorial are gated identically", async () => {
    const seenCore: { ctx?: MosaicEngineContext } = {};
    const coreTemplate = makeGateTemplate({ tier: "core" }, seenCore);

    await coreTemplate.renderCover!({}, ctxWithCapabilities());
    expect((seenCore.ctx as any).secrets).toBeUndefined();
    expect((seenCore.ctx as any).connections).toBeUndefined();

    await coreTemplate.renderTutorial!({}, ctxWithCapabilities());
    expect((seenCore.ctx as any).secrets).toBeUndefined();
    expect((seenCore.ctx as any).connections).toBeUndefined();

    const seenCap: { ctx?: MosaicEngineContext } = {};
    const capTemplate = makeGateTemplate({ tier: "capability", caps: {} }, seenCap);

    await capTemplate.renderCover!({}, ctxWithCapabilities());
    expect((seenCap.ctx as any).secrets).toBe(fakeSecrets);

    await capTemplate.renderTutorial!({}, ctxWithCapabilities());
    expect((seenCap.ctx as any).connections).toBe(fakeConnections);
  });

  test("templates without renderCover/renderTutorial don't grow them", () => {
    const template = defineMosaicTemplate<Record<string, never>>({
      id: asTemplateId("NoCoverTemplate"),
      label: "NoCover",
      version: 1,
      capabilities: { tier: "core" },
      description: "test fixture",
      tags: ["test"],
      propsSchema: {},
      defaultProps: {},
      async render() {
        return simpleDoc();
      },
    });
    expect(template.renderCover).toBeUndefined();
    expect(template.renderTutorial).toBeUndefined();
    expect("renderCover" in template).toBe(false);
    expect("renderTutorial" in template).toBe(false);
  });

  test("nested renders cascade the gate in both directions", async () => {
    // Uses the registry-backed nested-render path — the exact seam
    // resolveMosaicx and parent templates go through.
    const { registerTemplate } = await import("./templateRegistry");
    const { renderNestedTemplate } = await import("../render/renderNestedTemplate");

    const observed: Record<string, { secrets?: unknown; connections?: unknown }> = {};
    const observer = (label: string) =>
      async (_props: Record<string, never>, ctx: MosaicEngineContext) => {
        observed[label] = {
          secrets: (ctx as any).secrets,
          connections: (ctx as any).connections,
        };
        return simpleDoc();
      };

    registerTemplate(
      defineMosaicTemplate<Record<string, never>>({
        id: asTemplateId("GateNestedCoreChild"),
        label: "core child",
        version: 1,
        capabilities: { tier: "core" },
        description: "test fixture",
        tags: ["test"],
        propsSchema: {},
        defaultProps: {},
        render: observer("coreChild"),
      }),
    );
    registerTemplate(
      defineMosaicTemplate<Record<string, never>>({
        id: asTemplateId("GateNestedCapChild"),
        label: "capability child",
        version: 1,
        capabilities: { tier: "capability", caps: {} },
        description: "test fixture",
        tags: ["test"],
        propsSchema: {},
        defaultProps: {},
        render: observer("capChild"),
      }),
    );

    // Direction 1: capability-tier parent (sees handles) → core child
    // must NOT see them (gate applies at the child's own wrapper).
    const capParent = defineMosaicTemplate<Record<string, never>>({
      id: asTemplateId("GateNestedCapParent"),
      label: "capability parent",
      version: 1,
      capabilities: { tier: "capability", caps: {} },
      description: "test fixture",
      tags: ["test"],
      propsSchema: {},
      defaultProps: {},
      async render(_props, ctx) {
        await renderNestedTemplate("GateNestedCoreChild", {}, ctx);
        return simpleDoc();
      },
    });
    await capParent.render({}, ctxWithCapabilities());
    expect(observed.coreChild.secrets).toBeUndefined();
    expect(observed.coreChild.connections).toBeUndefined();

    // Direction 2: core-tier parent (already stripped) → capability
    // child does NOT get the handles reintroduced — deny cascades down.
    const coreParent = defineMosaicTemplate<Record<string, never>>({
      id: asTemplateId("GateNestedCoreParent"),
      label: "core parent",
      version: 1,
      capabilities: { tier: "core" },
      description: "test fixture",
      tags: ["test"],
      propsSchema: {},
      defaultProps: {},
      async render(_props, ctx) {
        await renderNestedTemplate("GateNestedCapChild", {}, ctx);
        return simpleDoc();
      },
    });
    await coreParent.render({}, ctxWithCapabilities());
    expect(observed.capChild.secrets).toBeUndefined();
    expect(observed.capChild.connections).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Level 1 gate observability — a withheld handle must SAY it was
// withheld. Silent stripping is indistinguishable from "the host has
// no connection configured", which is what sent a third-party pack
// bisecting the CLI, core and template-utils for a day.
// ─────────────────────────────────────────────────────────────────────

describe("defineMosaicTemplate — capability denial is observable", () => {
  const fakeSecrets = { get: async () => "s3cret", has: async () => true };
  const fakeConnections = {
    get: async () => ({ url: "http://localhost" }),
    has: async () => true,
  };

  const simpleDoc = (): MosaicDocument => ({
    kind: "mosaic_document",
    version: 1,
    assets: {} as any,
    m0: toM0String("F", "gate"),
    sources: [],
    fps: 60,
    durationMs: 5000,
  });

  /** Collects every telemetry event a render emits. */
  function makeSink() {
    const events: any[] = [];
    return { events, sink: { emit: (e: any) => events.push(e) } };
  }

  /**
   * A ctx carrying both handles plus a telemetry sink — what a host
   * with `M0SAIC_CONNECTIONS_FILE` set actually hands the engine.
   */
  function ctxWithHandles(sink?: { emit: (e: any) => void }) {
    return {
      ...makeCtx(),
      secrets: fakeSecrets,
      connections: fakeConnections,
      ...(sink ? { telemetry: sink } : {}),
    } as unknown as MosaicEngineContext;
  }

  /** A template that reaches for `ctx.<field>` while rendering. */
  function makeReader(
    id: string,
    field: "secrets" | "connections",
    tier: "core" | "capability" = "core",
    reads = 1,
  ) {
    const seen: { value?: unknown } = {};
    const template = defineMosaicTemplate<Record<string, never>>({
      id: asTemplateId(id),
      label: "Denial",
      version: 1,
      capabilities:
        tier === "capability" ? { tier: "capability", caps: {} } : { tier: "core" },
      description: "test fixture",
      tags: ["test"],
      propsSchema: {},
      defaultProps: {},
      async render(_props, ctx) {
        for (let i = 0; i < reads; i += 1) {
          seen.value = (ctx as any)[field];
        }
        return simpleDoc();
      },
    });
    return { template, seen };
  }

  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    __resetCapabilityDenialWarnings();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test.each(["secrets", "connections"] as const)(
    "core tier reading ctx.%s: still undefined, but warns with the tier fix",
    async (field) => {
      const { template, seen } = makeReader(`DenialWarn_${field}`, field);

      await template.render({}, ctxWithHandles());

      // The gate's semantics are unchanged — the read is still denied.
      expect(seen.value).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = String(warnSpy.mock.calls[0][0]);
      // The message carries the three things the author needs: which
      // handle, which template, and the declaration that grants it.
      expect(msg).toContain(`ctx.${field}`);
      expect(msg).toContain(`DenialWarn_${field}`);
      expect(msg).toContain(`tier: "capability"`);
    },
  );

  test("denial is reported to telemetry as a warn-level template log", async () => {
    const { events, sink } = makeSink();
    const { template } = makeReader("DenialTelemetry", "connections");

    await template.render({}, ctxWithHandles(sink));

    const denied = events.filter(
      (e) => e.payload?.data?.event === "capability_denied_read",
    );
    expect(denied).toHaveLength(1);
    expect(denied[0].level).toBe("warn");
    expect(denied[0].payload.templateId).toBe("DenialTelemetry");
    expect(denied[0].payload.data).toMatchObject({
      field: "connections",
      declaredTier: "core",
      requiredTier: "capability",
    });
  });

  test("repeat reads inside one render report once, not once per read", async () => {
    const { events, sink } = makeSink();
    const { template } = makeReader("DenialDedupe", "connections", "core", 5);

    await template.render({}, ctxWithHandles(sink));

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(
      events.filter((e) => e.payload?.data?.event === "capability_denied_read"),
    ).toHaveLength(1);
  });

  test("a second render re-reports to telemetry (per-invocation scope)", async () => {
    const { events, sink } = makeSink();
    const { template } = makeReader("DenialPerRender", "connections");

    await template.render({}, ctxWithHandles(sink));
    await template.render({}, ctxWithHandles(sink));

    expect(
      events.filter((e) => e.payload?.data?.event === "capability_denied_read"),
    ).toHaveLength(2);
    // …but the console advice stays one-time per process, so a
    // cron / --watch loop doesn't repeat it forever.
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test("the tripwire is non-enumerable: key set and spread are unchanged", async () => {
    const seen: { keys?: string[]; spread?: Record<string, unknown> } = {};
    const template = defineMosaicTemplate<Record<string, never>>({
      id: asTemplateId("DenialShape"),
      label: "Denial",
      version: 1,
      capabilities: { tier: "core" },
      description: "test fixture",
      tags: ["test"],
      propsSchema: {},
      defaultProps: {},
      async render(_props, ctx) {
        seen.keys = Object.keys(ctx).sort();
        seen.spread = { ...(ctx as any) };
        return simpleDoc();
      },
    });

    await template.render({}, ctxWithHandles());

    expect(seen.keys).not.toContain("secrets");
    expect(seen.keys).not.toContain("connections");
    expect("secrets" in seen.spread!).toBe(false);
    expect("connections" in seen.spread!).toBe(false);
    // Enumerating the ctx must not itself trip the wire.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("nothing withheld → no tripwire (a host with no resolvers is not a mistake)", async () => {
    const { events, sink } = makeSink();
    const { template, seen } = makeReader("DenialNoHandles", "connections");

    await template.render({}, {
      ...makeCtx(),
      telemetry: sink,
    } as unknown as MosaicEngineContext);

    expect(seen.value).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  test("only the withheld handle trips: an absent one stays plain undefined", async () => {
    const { template, seen } = makeReader("DenialPartial", "secrets");

    // Host supplies connections only — reading `secrets` denies nothing.
    await template.render({}, {
      ...makeCtx(),
      connections: fakeConnections,
    } as unknown as MosaicEngineContext);

    expect(seen.value).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("a MISSING capabilities block gets its own wording, not \"tier: core\"", async () => {
    const { events, sink } = makeSink();
    const seen: { value?: unknown } = {};
    const template = defineMosaicTemplate<Record<string, never>>({
      id: asTemplateId("DenialUnsetTier"),
      label: "Denial",
      version: 1,
      // No `capabilities` at all — the required field spread in as any,
      // the way the gate suite's undefined-capabilities case does it.
      ...({} as any),
      description: "test fixture",
      tags: ["test"],
      propsSchema: {},
      defaultProps: {},
      async render(_props, ctx) {
        seen.value = (ctx as any).connections;
        return simpleDoc();
      },
    });

    await template.render({}, ctxWithHandles(sink));

    expect(seen.value).toBeUndefined();
    const msg = String(warnSpy.mock.calls[0][0]);
    // Two different authoring mistakes — "I declared core" vs "I declared
    // nothing" — so the advice must not tell the second author to look for
    // a `tier: "core"` they never wrote.
    expect(msg).toContain("declares no \"capabilities\" block at all");
    expect(msg).not.toContain('declares capabilities: { tier: "core" }');
    expect(
      events.find((e) => e.payload?.data?.event === "capability_denied_read")
        ?.payload.data.declaredTier,
    ).toBe("unset");
  });

  test("a template wrapped TWICE (repo module + registerTemplate) does not trip its own wire: the inner gate recognises the outer tripwire", async () => {
    const { events, sink } = makeSink();
    // reads = 0: the template never touches the handle. Any warning here is
    // the gate reading the outer gate's tripwire — the false positive that
    // fired on every external-repo render once the host supplied handles.
    const { template: once } = makeReader("DenialDoubleWrap", "secrets", "core", 0);
    const twice = defineMosaicTemplate(once as never);

    await twice.render({}, ctxWithHandles(sink));

    expect(warnSpy).not.toHaveBeenCalled();
    expect(events.filter((e) => e.payload?.data?.event === "capability_denied_read")).toHaveLength(0);
  });

  test("a double-wrapped template that DOES read still reports exactly once", async () => {
    const { events, sink } = makeSink();
    const { template: once, seen } = makeReader("DenialDoubleWrapRead", "connections", "core", 3);
    const twice = defineMosaicTemplate(once as never);

    await twice.render({}, ctxWithHandles(sink));

    expect(seen.value).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.payload?.data?.event === "capability_denied_read")).toHaveLength(1);
  });

  test("capability tier: the handle arrives and nothing is reported", async () => {
    const { events, sink } = makeSink();
    const { template, seen } = makeReader("DenialCapTier", "connections", "capability");

    await template.render({}, ctxWithHandles(sink));

    expect(seen.value).toBe(fakeConnections);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(
      events.filter((e) => e.payload?.data?.event === "capability_denied_read"),
    ).toHaveLength(0);
  });
});

describe("defineMosaicTemplate — wrapper link (render identity pin)", () => {
  const doc: MosaicDocument = {
    kind: "mosaic_document", version: 1, assets: {} as any, m0: toM0String("F", "test"),
    sources: [], fps: 60, durationMs: 5000,
  };
  const render = async (_p: {}, _c: MosaicEngineContext) => doc;
  const renderLite = (_p: {}, _c: MosaicEngineContext) => doc;
  const renderCover = (_p: {}, _c: MosaicEngineContext) => doc;
  const renderTutorial = (_p: {}, _c: MosaicEngineContext) => doc as any;
  const base = (): MosaicTemplate<{}> => ({
    id: asTemplateId("test/link/v1"), label: "L", description: "link fixture", tags: ["test"], version: 1, capabilities: { tier: "core" },
    propsSchema: {}, defaultProps: {}, render, renderLite, renderCover, renderTutorial,
  });

  test("every wrapper carries a non-enumerable, non-writable Symbol.for link to the function it wraps", () => {
    const w = defineMosaicTemplate(base());
    expect(TEMPLATE_WRAPPED_FROM).toBe(Symbol.for("m0saic.templateWrappedFrom"));
    for (const [name, orig] of [["render", render], ["renderLite", renderLite], ["renderCover", renderCover], ["renderTutorial", renderTutorial]] as const) {
      const fn = (w as any)[name] as Function;
      expect(fn).not.toBe(orig);
      const d = Object.getOwnPropertyDescriptor(fn, TEMPLATE_WRAPPED_FROM)!;
      expect(d.value).toBe(orig);
      expect(d.enumerable).toBe(false);
      expect(d.writable).toBe(false);
      expect(d.configurable).toBe(false);
      expect(Object.keys(fn)).toEqual([]);
    }
  });

  test("unwrapTemplateFunction walks a double wrap down to the template's own function; a plain function is itself", () => {
    const once = defineMosaicTemplate(base());
    const twice = defineMosaicTemplate(once);
    expect(unwrapTemplateFunction(twice.render)).toBe(render);
    expect(unwrapTemplateFunction(twice.renderLite!)).toBe(renderLite);
    expect(unwrapTemplateFunction(twice.renderCover!)).toBe(renderCover);
    expect(unwrapTemplateFunction(once.render)).toBe(render);
    expect(unwrapTemplateFunction(render)).toBe(render);
    // The unwrapped text is the template's, not the wrapper's — the pin's whole point.
    expect(unwrapTemplateFunction(twice.render).toString()).toBe(render.toString());
    expect(twice.render.toString()).not.toBe(render.toString());
  });

  test("a template without renderLite/renderCover gets no such wrappers (nothing to link)", () => {
    const { renderLite: _l, renderCover: _c, renderTutorial: _t, ...bare } = base();
    const w = defineMosaicTemplate(bare);
    expect(w.renderLite).toBeUndefined();
    expect(w.renderCover).toBeUndefined();
    expect(w.renderTutorial).toBeUndefined();
    expect(unwrapTemplateFunction(w.render)).toBe(render);
  });
});
