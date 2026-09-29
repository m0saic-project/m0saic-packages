import type { MosaicDocument, MosaicTemplate, MosaicTemplatePropDefinition } from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import { weightedSplit } from "@m0saic/dsl-stdlib";

import { COST_BUDGETS, STANDARD_SWEEP_CANVASES, accountableProps, auditRenderedTemplate, diffLayoutFingerprint, drawnAsNumber, fingerprintHash, layoutFingerprintFinding, numberSpellings } from "./auditRenderedTemplate";
import { drainTemplateConventionFindings, listTemplateConventionFindings } from "./templateConventions";

type Props = Record<string, unknown>;
type AnyRec = Record<string, unknown>;
type Src = Record<string, unknown>;

const text = (t: string, extra: Src = {}, svg = true): Src => ({
  type: "text",
  ...(svg ? { rasterizer: "svg" } : {}),
  layers: [{ content: { kind: "literal", text: t } }],
  ...extra,
});
const bound = (t: string, propKey: string, extra: Src = {}): Src => text(t, { editor: { binding: { propKey } }, ...extra });
const doc = (sources: Src[]): MosaicDocument =>
  ({
    kind: "mosaic_document",
    version: 1,
    // one tile is "1"; a 1-way split ("1[1]") is not valid m0
    m0: sources.length <= 1 ? "1" : `${sources.length}[${sources.map(() => "1").join(",")}]`,
    assets: {},
    sources,
  }) as unknown as MosaicDocument;

// Every harness prop carries a description so the render-time rules under test
// stand alone; `bindingHints` (the in-context line) has its own cases below
// with a raw, undescribed schema.
const schema = (s: Record<string, Partial<MosaicTemplatePropDefinition> & { type: MosaicTemplatePropDefinition["type"] }>) =>
  Object.fromEntries(Object.entries(s).map(([k, d]) => [k, { required: false, description: `${k} — what it does`, meta: { ui: { label: k } }, ...d }])) as never;

function tmpl(id: string, render: MosaicTemplate<Props>["render"], extra: Partial<MosaicTemplate<Props>> = {}): MosaicTemplate<Props> {
  return {
    id: asTemplateId(id),
    label: id,
    version: 1,
    description: "t",
    tags: ["test"],
    // Compliant with the `outputFormat` convention so the render-time rules test alone.
    outputHints: { format: { kind: "image", container: "png" } },
    capabilities: { tier: "core" },
    propsSchema: schema({
      title: { type: "string", meta: { control: { placeholder: "auto" }, ui: { label: "Title" } } },
      mode: { type: "string", meta: { constraints: { oneOf: ["a", "b"] }, ui: { label: "Mode" } } },
    }),
    defaultProps: { title: "Hello there", mode: "a" },
    render,
    ...extra,
  } as MosaicTemplate<Props>;
}

beforeEach(() => drainTemplateConventionFindings());

/** The finding for ONE convention. `bindingsDeclared` is TOTAL — any unbound
 *  prop trips it — so a test about another rule filters to its own rule, and
 *  the pairing is asserted once, explicitly. */
type Audit = Awaited<ReturnType<typeof auditRenderedTemplate>>;
const only = (a: Audit, convention: string): Audit["findings"] => a.findings.filter((f) => f.convention === convention);

describe("auditRenderedTemplate — the render-time seam", () => {
  it("a compliant template: rendered, no findings, nothing recorded", async () => {
    const a = await auditRenderedTemplate(tmpl("@x/ok/v1", async () => doc([bound("Hello there", "title"), text("mode a")])));
    expect(a.skipped).toBeUndefined();
    expect(a.findings).toEqual([]);
    expect(a.canvas).toEqual({ width: 1280, height: 720 });
    expect(listTemplateConventionFindings()).toEqual([]);
  });

  it("uses the template's outputHints canvas", async () => {
    const a = await auditRenderedTemplate(tmpl("@x/hint/v1", async () => doc([bound("Hello there", "title")]), { outputHints: { width: 1080, height: 1920 } } as never));
    expect(a.canvas).toEqual({ width: 1080, height: 1920 });
  });

  it("bindingsCover (warning): a free-text prop drawn verbatim but unbound", async () => {
    const a = await auditRenderedTemplate(tmpl("@x/cover/v1", async () => doc([text("Hello there"), text("mode a")])));
    const cover = only(a, "bindingsCover");
    expect(cover).toMatchObject([{ severity: "warning", violations: [{ key: "title" }] }]);
    expect(cover[0].violations[0].detail).toMatch(/bindProp\(src, "title"\)/);
    // closed set `mode` is never a coverage target
    expect(cover[0].violations.map((v) => v.key)).not.toContain("mode");
    // ⭐ an unbound DRAWN prop trips BOTH rules: the total roll call (error) and
    // the heuristic that says it is visibly on the canvas (warning).
    expect(a.findings.map((f) => f.convention).sort()).toEqual(["bindingsCover", "bindingsDeclared"]);
    expect(listTemplateConventionFindings()).toHaveLength(2);
  });

  describe("bindingHints (throw) — the value explains itself in place", () => {
    const silentSchema = { title: { type: "string", required: false, meta: { ui: { label: "Title" } } } } as never;
    const silent = (id: string, sources: Src[], extra: Partial<MosaicTemplate<Props>> = {}) =>
      tmpl(id, async () => doc(sources), { propsSchema: silentSchema, defaultProps: { title: "Hello there" }, ...extra } as never);

    it("a bound prop with neither a hint nor a description is an error", async () => {
      const a = await auditRenderedTemplate(silent("@x/hints/v1", [bound("Hello there", "title")]));
      const f = only(a, "bindingHints");
      expect(f).toMatchObject([{ severity: "error", violations: [{ key: "title" }] }]);
      expect(f[0].violations[0].detail).toMatch(/propsSchema\.title\.description/);
      expect(f[0].violations[0].detail).toMatch(/withBindingHint/);
    });

    it("the prop's description satisfies every binding of it; a binding's own hint satisfies its rect", async () => {
      const described = await auditRenderedTemplate(tmpl("@x/hints-desc/v1", async () => doc([bound("Hello there", "title")])));
      expect(only(described, "bindingHints")).toEqual([]);
      const hinted = await auditRenderedTemplate(
        silent("@x/hints-hint/v1", [text("Hello there", { editor: { binding: { propKey: "title", hint: "The big words on the cover." } } })]),
      );
      expect(only(hinted, "bindingHints")).toEqual([]);
    });

    it("reports a prop once however many rects bind it, and reaches bindings in a nested child", async () => {
      const child = doc([bound("Hello there", "title")]);
      const a = await auditRenderedTemplate(
        silent("@x/hints-nested/v1", [bound("Hello there", "title"), { type: "mosaic", ref: "card" }], {
          render: async () => ({ ...doc([bound("Hello there", "title"), { type: "mosaic", ref: "card" }]), children: { card: child } }) as never,
        }),
      );
      expect(only(a, "bindingHints").map((f) => f.violations.map((v) => v.key))).toEqual([["title"]]);
    });

    it("a template that shipped before the rule lags instead of failing", async () => {
      const a = await auditRenderedTemplate(silent("@x/hints-shipped/v1", [bound("Hello there", "title")]), { shippedAt: "0.2.0" });
      expect(only(a, "bindingHints")).toEqual([]);
      expect(a.lagging.map((f) => f.convention)).toContain("bindingHints");
    });
  });

  describe("bindingsDeclared (throw) — the roll call", () => {
    // Every kind of accountable prop, plus one of each thing that is NOT a
    // canvas control, on a template that binds nothing.
    const everything = () =>
      tmpl("@x/rollcall/v1", async () => doc([text("hello")]), {
        propsSchema: schema({
          label: { type: "string", meta: { ui: { label: "Label" } } },
          accent: { type: "string", meta: { constraints: { isColor: true }, control: { colorPicker: true }, ui: { label: "Accent" } } },
          count: { type: "number", meta: { ui: { label: "Count" } } },
          poster: { type: "media", meta: { ui: { label: "Poster" } } },
          tags: { type: "string[]", meta: { ui: { label: "Tags" } } },
          rows: { type: "array" as never, meta: { ui: { label: "Rows" } } },
          region: { type: "json", meta: { control: { picker: "regions" }, ui: { label: "Region" } } },
          // none of these is a canvas control
          enabled: { type: "boolean", meta: { ui: { label: "Enabled" } } },
          mode: { type: "string", meta: { constraints: { oneOf: ["a", "b"] }, ui: { label: "Mode" } } },
          layout: { type: "m0", meta: { ui: { label: "Layout" } } },
          snippet: { type: "code", meta: { ui: { label: "Snippet" } } },
          secret: { type: "number", meta: { ui: { label: "Secret", hidden: true } } },
          friendly: { type: "number", meta: { ui: { label: "Friendly", consumer: "human" } } },
        }),
        defaultProps: { label: "hello", accent: "#fff", count: 1, tags: [], rows: [], region: {}, enabled: true, mode: "a", layout: "1", snippet: { language: "ts", code: "x" } },
      } as never);

    it("names every accountable prop, and ONLY those", async () => {
      const a = await auditRenderedTemplate(everything());
      const f = a.findings.find((x) => x.convention === "bindingsDeclared");
      expect(f).toMatchObject({ severity: "error" }); // throw posture
      expect(f!.violations.map((v) => v.key).sort()).toEqual(["accent", "count", "label", "poster", "region", "rows", "tags"]);
      expect(f!.violations.find((v) => v.key === "accent")!.detail).toMatch(/can carry a color handle/);
      expect(f!.violations.find((v) => v.key === "region")!.detail).toMatch(/can carry a rect handle/);
      expect(f!.violations.find((v) => v.key === "tags")!.detail).toMatch(/string element handle/);
      expect(f!.violations.find((v) => v.key === "label")!.detail).toMatch(/bindings\.unbound = \{ "label": "<reason>" \}/);
    });

    it("a bound prop and a declared prop both satisfy it", async () => {
      const a = await auditRenderedTemplate(
        tmpl("@x/rollcall-ok/v1", async () => doc([bound("hello", "label")]), {
          propsSchema: schema({
            label: { type: "string", meta: { ui: { label: "Label" } } },
            fps: { type: "number", meta: { ui: { label: "FPS" } } },
          }),
          defaultProps: { label: "hello", fps: 30 },
          bindings: { unbound: { fps: "timing" } },
        } as never),
      );
      expect(a.findings.filter((f) => f.convention === "bindingsDeclared")).toEqual([]);
    });

    // ⭐ REGRESSION (2026-09-25): the roll call counted bindings on the ROOT
    // document only. `defineHelloWorldTemplate` — the factory every template
    // repo's front door is one call to — composes its content into a `card`
    // CHILD, so every one of its props read as unbound and the FIRST
    // `npm run build` of every freshly scaffolded repo would have failed a
    // throw-posture gate. Make resolves a binding through children; so does this.
    it("a binding inside a nested CHILD counts — the parent's prop is reachable", async () => {
      const child: Src = {
        kind: "mosaic_document",
        version: 1,
        m0: "1",
        assets: {},
        sources: [bound("Hello there", "title")],
      };
      const nested = (): MosaicDocument =>
        ({
          kind: "mosaic_document",
          version: 1,
          m0: "1",
          assets: {},
          children: { card: child },
          sources: [{ type: "mosaic", ref: "card" }],
        }) as unknown as MosaicDocument;
      const a = await auditRenderedTemplate(
        tmpl("@x/nested-bind/v1", async () => nested(), {
          propsSchema: schema({ title: { type: "string", meta: { ui: { label: "Title" } } } }),
          defaultProps: { title: "Hello there" },
        } as never),
      );
      expect(only(a, "bindingsDeclared")).toEqual([]);
    });

    it("...and a stale declaration for a child-bound prop is still caught", async () => {
      const child: Src = { kind: "mosaic_document", version: 1, m0: "1", assets: {}, sources: [bound("Hello there", "title")] };
      const a = await auditRenderedTemplate(
        tmpl("@x/nested-stale/v1", async () => (({
          kind: "mosaic_document", version: 1, m0: "1", assets: {},
          children: { card: child }, sources: [{ type: "mosaic", ref: "card" }],
        }) as unknown as MosaicDocument), {
          propsSchema: schema({ title: { type: "string", meta: { ui: { label: "Title" } } } }),
          defaultProps: { title: "Hello there" },
          bindings: { unbound: { title: "wrong — it is bound in the child" } },
        } as never),
      );
      expect(only(a, "bindingsDeclared")[0].violations[0].detail).toMatch(/but a source binds it/);
    });

    // ⭐ A colour painted as document.backgroundColor has no source and no rect,
    // so no handle can exist — and it is the PREFERRED way to fill a canvas (a
    // full-frame base rect is a click target that shadows everything behind it).
    // 22 starter templates were failing on exactly this. Founder ruling 2026-09-25.
    describe("a colour that IS the document background needs nothing", () => {
      const withBg = (bg: string | undefined, pageColor: string, extraSources: Src[] = []) =>
        tmpl("@x/bg/v1", async () => {
          const d = doc([text("hello"), ...extraSources]) as unknown as AnyRec;
          if (bg !== undefined) d.backgroundColor = bg;
          return d as unknown as MosaicDocument;
        }, {
          propsSchema: schema({
            pageColor: { type: "string", meta: { constraints: { isColor: true }, control: { colorPicker: true }, ui: { label: "Page" } } },
          }),
          defaultProps: { pageColor },
        } as never);

      it("accounted for, with no binding and no declaration", async () => {
        const a = await auditRenderedTemplate(withBg("#1c2833", "#1c2833"));
        expect(only(a, "bindingsDeclared")).toEqual([]);
      });

      it("case-insensitively — #1C2833 is #1c2833", async () => {
        const a = await auditRenderedTemplate(withBg("#1C2833", "#1c2833"));
        expect(only(a, "bindingsDeclared")).toEqual([]);
      });

      it("a colour that is NOT the background still has to be accounted for", async () => {
        const a = await auditRenderedTemplate(withBg("#000000", "#c0392b"));
        expect(only(a, "bindingsDeclared")[0].violations.map((v) => v.key)).toEqual(["pageColor"]);
      });

      it("no background at all — still accountable", async () => {
        const a = await auditRenderedTemplate(withBg(undefined, "#c0392b"));
        expect(only(a, "bindingsDeclared")[0].violations.map((v) => v.key)).toEqual(["pageColor"]);
      });

      it("a CHILD's background counts too — a nested card sets its own", async () => {
        const child = { kind: "mosaic_document", version: 1, m0: "1", assets: {}, backgroundColor: "#1c2833", sources: [text("x")] };
        const a = await auditRenderedTemplate(
          tmpl("@x/bg-child/v1", async () => (({
            kind: "mosaic_document", version: 1, m0: "1", assets: {},
            children: { card: child }, sources: [{ type: "mosaic", ref: "card" }],
          }) as unknown as MosaicDocument), {
            propsSchema: schema({ pageColor: { type: "string", meta: { constraints: { isColor: true }, control: { colorPicker: true }, ui: { label: "Page" } } } }),
            defaultProps: { pageColor: "#1c2833" },
          } as never),
        );
        expect(only(a, "bindingsDeclared")).toEqual([]);
      });
    });

    it("a template that SHIPPED before the rule reports it as lag, not a finding", async () => {
      const a = await auditRenderedTemplate(everything(), { shippedAt: "0.2.0" });
      // not fatal, not in the shared log…
      expect(a.findings.filter((f) => f.convention === "bindingsDeclared")).toEqual([]);
      // …but VISIBLE, which a bare skip destroyed
      expect(a.lagging.map((f) => f.convention)).toContain("bindingsDeclared");
      expect(a.lagging.find((f) => f.convention === "bindingsDeclared")!.violations.length).toBeGreaterThan(0);
    });

    it("a rule OLDER than the shipped line is still a real error — it shipped non-compliant", async () => {
      // `bindingsDeclared` landed in 0.3.0, so a template claiming to have shipped
      // AT 0.3.0 gets no pass on it.
      const a = await auditRenderedTemplate(everything(), { shippedAt: "0.3.0" });
      expect(a.findings.map((f) => f.convention)).toContain("bindingsDeclared");
      expect(a.lagging).toEqual([]);
    });

    describe("a stale declaration is itself a violation", () => {
      const withDecl = (unbound: Record<string, unknown>, sources = [text("hello")]) =>
        tmpl("@x/stale/v1", async () => doc(sources), {
          propsSchema: schema({
            label: { type: "string", meta: { ui: { label: "Label" } } },
            enabled: { type: "boolean", meta: { ui: { label: "Enabled" } } },
          }),
          defaultProps: { label: "hello", enabled: true },
          bindings: { unbound },
        } as never);

      it("names a prop that cannot carry a handle", async () => {
        const a = await auditRenderedTemplate(withDecl({ label: "n/a", enabled: "a toggle" }));
        const f = a.findings.find((x) => x.convention === "bindingsDeclared")!;
        expect(f.violations.map((v) => v.key)).toEqual(["enabled"]);
        expect(f.violations[0].detail).toMatch(/not a prop that can carry a canvas handle/);
      });

      it("names a prop that IS bound", async () => {
        const a = await auditRenderedTemplate(withDecl({ label: "n/a" }, [bound("hello", "label")]));
        const f = a.findings.find((x) => x.convention === "bindingsDeclared")!;
        expect(f.violations.map((v) => v.key)).toEqual(["label"]);
        expect(f.violations[0].detail).toMatch(/but a source binds it — drop the entry/);
      });

      it("has an empty reason", async () => {
        const a = await auditRenderedTemplate(withDecl({ label: "   " }));
        const f = a.findings.find((x) => x.convention === "bindingsDeclared")!;
        expect(f.violations.map((v) => v.key)).toEqual(["label"]);
        expect(f.violations[0].detail).toMatch(/has no reason/);
      });
    });
  });

  describe("accountableProps", () => {
    it("is the schema-side mirror of classifyBindableProp — kinds, not drawn-ness", () => {
      const got = accountableProps(
        schema({
          a: { type: "string" },
          b: { type: "string", meta: { constraints: { isColor: true } } },
          c: { type: "number" },
          d: { type: "media" },
          e: { type: "number[]" },
          f: { type: "media[]" },
          g: { type: "list" },
          h: { type: "json", meta: { control: { picker: "regions" } } },
          i: { type: "boolean" },
          j: { type: "m0p" },
        }) as never,
      );
      expect(got).toEqual([
        { key: "a", kind: "string" },
        { key: "b", kind: "color" },
        { key: "c", kind: "number" },
        { key: "d", kind: "media" },
        { key: "e", kind: "number element" },
        { key: "f", kind: "media element" },
        { key: "g", kind: "leaf" },
        { key: "h", kind: "rect" },
      ]);
    });

    it("walks group fields with their dotted keys", () => {
      const got = accountableProps(
        schema({
          titles: { type: "group", fields: { main: { type: "string", required: false }, size: { type: "number", required: false } } },
        }) as never,
      );
      expect(got.map((g) => g.key)).toEqual(["titles.main", "titles.size"]);
    });
  });

  describe("canvasFill (throw) — the canvas is filled by the DOCUMENT", () => {
    const fill = (extra: Src = {}): Src => ({ type: "lavfi", color: "#1c2833", ...extra });
    const one = (sources: Src[], defaults: Props = {}) =>
      tmpl("@x/fill/v1", async () => doc(sources), {
        propsSchema: schema({ useNestedBackgroundColor: { type: "boolean", meta: { ui: { label: "Nested bg", hidden: true } } } }),
        defaultProps: defaults,
      } as never);

    it("a static full-canvas colour source is an ERROR, and names the fix", async () => {
      const a = await auditRenderedTemplate(one([fill()]));
      const f = only(a, "canvasFill");
      expect(f).toMatchObject([{ severity: "error", violations: [{ key: "source[0]" }] }]);
      expect(f[0].violations[0].detail).toMatch(/whole 1280×720 canvas/);
      expect(f[0].violations[0].detail).toMatch(/set document\.backgroundColor instead/);
      expect(f[0].violations[0].detail).toMatch(/click target over everything/);
    });

    it("the legacy form counts too — an empty text source with visual.backgroundColor", async () => {
      const legacy: Src = { type: "text", visual: { backgroundColor: "#1c2833" }, layers: [{ content: { kind: "literal", text: "  " } }] };
      expect(only(await auditRenderedTemplate(one([legacy])), "canvasFill")).toHaveLength(1);
    });

    describe("every legitimate full-canvas colour is left alone", () => {
      it("a curtain wipe (overlay.enable / window)", async () => {
        expect(only(await auditRenderedTemplate(one([fill({ overlay: { enable: "gte(t,1)" } })])), "canvasFill")).toEqual([]);
      });
      it("a scrim (overlay.alpha)", async () => {
        expect(only(await auditRenderedTemplate(one([fill({ overlay: { alpha: "0.4" } })])), "canvasFill")).toEqual([]);
      });
      it("a masked shape", async () => {
        expect(only(await auditRenderedTemplate(one([fill({ mask: { kind: "image", assetId: "a" } })])), "canvasFill")).toEqual([]);
      });
      it("a rounded / stroked card (effects)", async () => {
        expect(only(await auditRenderedTemplate(one([fill({ effects: { cornerRadius: 12 } })])), "canvasFill")).toEqual([]);
      });
      it("an inset fill (placement)", async () => {
        expect(only(await auditRenderedTemplate(one([fill({ placement: { inset: 8 } })])), "canvasFill")).toEqual([]);
      });
      it("a lavfi FILTER GRAPH, which is not a fill", async () => {
        expect(only(await auditRenderedTemplate(one([{ type: "lavfi", lavfi: "gradients=s=1280x720" }])), "canvasFill")).toEqual([]);
      });
      it("a colour that does NOT cover the canvas (one half of a split)", async () => {
        expect(only(await auditRenderedTemplate(one([fill(), text("x")])), "canvasFill")).toEqual([]);
      });
      it("text with real content and a background (a chip, not a fill)", async () => {
        const chip: Src = { type: "text", visual: { backgroundColor: "#1c2833" }, layers: [{ content: { kind: "literal", text: "LIVE" } }] };
        expect(only(await auditRenderedTemplate(one([chip])), "canvasFill")).toEqual([]);
      });
    });

    describe("canvas.baseRect — the GENERAL escape, for when the rect is the point", () => {
      const withReason = (reason: unknown) =>
        tmpl("@x/fill-declared/v1", async () => doc([fill()]), {
          propsSchema: schema({}),
          defaultProps: {},
          canvas: { baseRect: reason },
        } as never);

      it("a stated reason satisfies the rule", async () => {
        const a = await auditRenderedTemplate(withReason("the lesson IS the full-rect base under two overlays"));
        expect(only(a, "canvasFill")).toEqual([]);
      });

      it("an EMPTY reason is itself a violation — a checkbox is not a statement", async () => {
        const a = await auditRenderedTemplate(withReason("   "));
        const f = only(a, "canvasFill");
        expect(f[0].violations.map((v) => v.key)).toContain("canvas.baseRect");
        expect(f[0].violations.find((v) => v.key === "canvas.baseRect")!.detail).toMatch(/no reason/);
      });

      it("the two escapes are not interchangeable — the detail names both", async () => {
        const a = await auditRenderedTemplate(one([fill()]));
        const detail = only(a, "canvasFill")[0].violations[0].detail;
        expect(detail).toMatch(/canvas\.baseRect = "<why>"/);
        expect(detail).toMatch(/composed INTO another uses defaultProps\.useNestedBackgroundColor/);
      });
    });

    it("a template that MUST ship the rect declares it — useNestedBackgroundColor default true", async () => {
      expect(only(await auditRenderedTemplate(one([fill()], { useNestedBackgroundColor: true })), "canvasFill")).toEqual([]);
    });

    it("...and declaring it FALSE is no escape", async () => {
      expect(only(await auditRenderedTemplate(one([fill()], { useNestedBackgroundColor: false })), "canvasFill")).toHaveLength(1);
    });

    it("a shipped template reports it as lag — the rule is not retroactive", async () => {
      const a = await auditRenderedTemplate(one([fill()]), { shippedAt: "0.2.0" });
      expect(only(a, "canvasFill")).toEqual([]);
      expect(a.lagging.map((f) => f.convention)).toEqual(["canvasFill"]);
    });

    it("a CHILD filling its own slot is the sanctioned workaround, not the smell", async () => {
      const child = { kind: "mosaic_document", version: 1, m0: "1", assets: {}, sources: [{ type: "lavfi", color: "#1c2833" }] };
      const a = await auditRenderedTemplate(
        tmpl("@x/fill-child/v1", async () => (({
          kind: "mosaic_document", version: 1, m0: "1", assets: {},
          children: { card: child }, sources: [{ type: "mosaic", ref: "card" }],
        }) as unknown as MosaicDocument), { propsSchema: schema({}), defaultProps: {} } as never),
      );
      expect(only(a, "canvasFill")).toEqual([]);
    });
  });

  describe("bindingsCover — drawn NUMBER props (0.3.0)", () => {
    // A template with one bound number and one unbound one, drawn several ways.
    const nums = (render: MosaicTemplate<Props>["render"], defaults: Props = { count: 42, price: 1200 }) =>
      tmpl("@x/nums/v1", render, {
        propsSchema: schema({
          count: { type: "number", meta: { ui: { label: "Count" } } },
          price: { type: "number", meta: { ui: { label: "Price" } } },
        }),
        defaultProps: defaults,
      } as never);

    it("an unbound drawn number warns; the bound one does not", async () => {
      const a = await auditRenderedTemplate(nums(async () => doc([bound("42 items", "count"), text("$1,200 / yr")])));
      const cover = only(a, "bindingsCover");
      expect(cover).toMatchObject([{ severity: "warning", violations: [{ key: "price" }] }]);
      expect(cover[0].violations[0].detail).toMatch(/default 1200, drawn as "1,200".+bindProp\(src, "price"\)/);
    });

    it("both bound: nothing recorded", async () => {
      const a = await auditRenderedTemplate(nums(async () => doc([bound("42 items", "count"), bound("$1,200 / yr", "price")])));
      expect(a.findings).toEqual([]);
      expect(listTemplateConventionFindings()).toEqual([]);
    });

    it("toFixed spellings count — a rate drawn as 4.50 covers the prop 4.5", async () => {
      const a = await auditRenderedTemplate(nums(async () => doc([text("4.50% APR")]), { count: 4.5, price: 1200 }));
      expect(a.findings[0].violations.map((v) => v.key)).toEqual(["count"]);
      expect(a.findings[0].violations[0].detail).toMatch(/drawn as "4.50"/);
    });

    it("a digit INSIDE a longer number is not the prop (12 is not in 2012)", async () => {
      const a = await auditRenderedTemplate(nums(async () => doc([text("© 2012 Acme")]), { count: 12, price: 7 }));
      // 12 hides inside 2012; 7 has no spelling worth matching
      expect(only(a, "bindingsCover")).toEqual([]);
      // the roll call does not care whether a prop is DRAWN — both are unbound
      expect(only(a, "bindingsDeclared")[0].violations.map((v) => v.key)).toEqual(["count", "price"]);
    });

    it("a composite line: the rect already binds another prop, so the fix is bindProps or a split", async () => {
      // `year-card/v1`'s header: one rect draws the handle AND the year, and the
      // single binding belongs to the handle. A bare bindProp would REPLACE it.
      const a = await auditRenderedTemplate(
        tmpl("@x/composite/v1", async () => doc([bound("@qsbuilds · 2026 on GitHub", "handle")]), {
          propsSchema: schema({
            handle: { type: "string", meta: { ui: { label: "Handle" } } },
            year: { type: "number", meta: { ui: { label: "Year" } } },
          }),
          defaultProps: { handle: "@qsbuilds", year: 2026 },
        } as never),
      );
      expect(only(a, "bindingsCover")).toMatchObject([{ severity: "warning", violations: [{ key: "year" }] }]);
      const detail = only(a, "bindingsCover")[0].violations[0].detail;
      expect(detail).toMatch(/already binds "handle" — a composite line/);
      // the fix names bindProps (several handles on ONE rect), never a bare bindProp
      expect(detail).toMatch(/bindProps\(src, \[… , \{ propKey: "year" \}\]\)/);
      expect(detail).not.toMatch(/wrap the source that shows it/);
    });

    it("one rect free and one bound: the free rect is the fix", async () => {
      const a = await auditRenderedTemplate(nums(async () => doc([bound("42 · 1,200 seats", "count"), text("1,200 seats")])));
      expect(a.findings[0].violations[0].detail).toMatch(/bindProp\(src, "price"\)/);
    });

    it("bindProps on one rect covers BOTH props — no finding", async () => {
      const both = (t: string, keys: { propKey: string; kind?: string }[]): Src =>
        text(t, { editor: { bindings: keys } });
      const a = await auditRenderedTemplate(
        tmpl("@x/composite-ok/v1", async () => doc([both("@qsbuilds · 2026 on GitHub", [{ propKey: "handle" }, { propKey: "year", kind: "number" }])]), {
          propsSchema: schema({
            handle: { type: "string", meta: { ui: { label: "Handle" } } },
            year: { type: "number", meta: { ui: { label: "Year" } } },
          }),
          defaultProps: { handle: "@qsbuilds", year: 2026 },
        } as never),
      );
      expect(a.findings).toEqual([]);
    });

    it("a closed / hidden / human number is never a coverage target", async () => {
      const a = await auditRenderedTemplate(
        tmpl("@x/nums-skip/v1", async () => doc([text("24 fps · 48 px · 96 dpi")]), {
          propsSchema: schema({
            fps: { type: "number", meta: { control: { options: [{ value: "24" }, { value: "30" }, { value: "60" }] }, ui: { label: "FPS" } } },
            size: { type: "number", meta: { ui: { label: "Size", hidden: true } } },
            dpi: { type: "number", meta: { ui: { label: "DPI", consumer: "human" } } },
          }),
          defaultProps: { fps: 24, size: 48, dpi: 96 },
        } as never),
      );
      expect(a.findings).toEqual([]);
    });
  });

  describe("numberSpellings / drawnAsNumber", () => {
    it("spells a number the ways a template draws it, dropping single characters", () => {
      expect(numberSpellings(1200)).toEqual(["1200", "1,200"]); // an INTEGER is never spelled 1200.00
      expect(numberSpellings(4.5)).toEqual(["4.5", "4.50"]); // String === toFixed(1) === toLocaleString
      expect(numberSpellings(7)).toEqual([]); // "7" alone is not evidence, and "7.0" is not how 7 is drawn
      expect(numberSpellings(Number.NaN)).toEqual([]);
      expect(numberSpellings(Number.POSITIVE_INFINITY)).toEqual([]);
    });

    it("matches on a digit boundary, both sides", () => {
      expect(drawnAsNumber("42 items", "42")).toBe(true);
      expect(drawnAsNumber("$42", "42")).toBe(true);
      expect(drawnAsNumber("We shipped 42.", "42")).toBe(true); // sentence-final period
      expect(drawnAsNumber("© 2012", "12")).toBe(false);
      expect(drawnAsNumber("3.12 rate", "12")).toBe(false);
      expect(drawnAsNumber("1,200 seats", "200")).toBe(false);
      expect(drawnAsNumber("42.5 kg", "42")).toBe(false);
      expect(drawnAsNumber("no digits", "42")).toBe(false);
      // the second occurrence is the clean one
      expect(drawnAsNumber("2012 and 12 more", "12")).toBe(true);
    });
  });

  it("bindingsSound (error): a binding the schema refuses, with the reason and the fix", async () => {
    const a = await auditRenderedTemplate(
      tmpl("@x/sound/v1", async () => doc([bound("Hello there", "title"), bound("mode a", "mode"), bound("x", "nope")])),
    );
    const sound = a.findings.find((f) => f.convention === "bindingsSound");
    expect(sound).toMatchObject({ severity: "error" });
    expect(sound!.violations.map((v) => v.key).sort()).toEqual(["mode", "nope"]);
    expect(sound!.violations.find((v) => v.key === "mode")!.detail).toMatch(/unsupported-type/);
    expect(sound!.violations.find((v) => v.key === "nope")!.detail).toMatch(/unknown-prop/);
  });

  it("svgGlyphCoverage (error): a character the bundled font lacks, checked against the REAL font", async () => {
    const a = await auditRenderedTemplate(
      tmpl("@x/glyph/v1", async () => doc([bound("Hello there", "title"), text("ok … “quoted” · × – —"), text("bad → ✓"), text("drawtext → is fine", {}, false)])),
    );
    const glyph = a.findings.find((f) => f.convention === "svgGlyphCoverage");
    expect(glyph).toMatchObject({ severity: "error" });
    expect(glyph!.violations.map((v) => v.key).sort()).toEqual(["U+2192", "U+2713"]);
    expect(a.notes).toEqual([]);
  });

  it("rendersAtDefaults (error) when render throws and every required input has a default", async () => {
    const a = await auditRenderedTemplate(tmpl("@x/throws/v1", async () => { throw new Error("boom\nmore"); }));
    expect(a.findings).toMatchObject([{ convention: "rendersAtDefaults", severity: "error", violations: [{ key: "render" }] }]);
    expect(a.findings[0].violations[0].detail).toMatch(/threw: boom$/);
  });

  it("⭐ renders what PRODUCTION renders: a shallow spread over the template's (deep-frozen) defaults — an in-place mutation of a nested default is a rendersAtDefaults error, not hidden by a clone", async () => {
    // Every host hands render() `{ ...defaultProps, ...userProps }`; a registered template is deep-frozen,
    // so `props.items.sort()` throws for the user. The audit used to render a JSON clone and pass this.
    const t = tmpl("@x/mutates/v1", async (props) => {
      const items = props.items as string[];
      items.sort(); // in place — on the frozen default array
      return doc([text(items.join(","))]);
    }, { defaultProps: { title: "Hello there", mode: "a", items: ["b", "a"] } });
    const a = await auditRenderedTemplate(t);
    expect(a.skipped).toBeUndefined();
    expect(a.findings.map((f) => f.convention)).toContain("rendersAtDefaults");
    expect(a.findings.find((f) => f.convention === "rendersAtDefaults")!.violations[0]!.detail).toMatch(/read only|not extensible|Cannot assign|frozen|object is not extensible/i);
    // The audit froze the template's own defaults — exactly what registerTemplate does — and they stay usable read-only.
    expect(Object.isFrozen(t.defaultProps!.items)).toBe(true);

    // The same template copying first (what a correct template does) is clean; the TOP-LEVEL bag stays writable like production's spread.
    const ok = tmpl("@x/copies/v1", async (props) => {
      const items = [...(props.items as string[])].sort();
      (props as Record<string, unknown>).scratch = 1; // top-level write is fine — production hands a fresh shallow copy
      return doc([text(items.join(","))]);
    }, { defaultProps: { title: "Hello there", mode: "a", items: ["b", "a"] } });
    expect((await auditRenderedTemplate(ok)).findings.map((f) => f.convention)).not.toContain("rendersAtDefaults");
  });

  it("SKIPS (no finding) a throwing template whose required inputs have no default", async () => {
    const a = await auditRenderedTemplate(
      tmpl("@x/inputs/v1", async () => { throw new Error("no source"); }, {
        propsSchema: schema({ sourceId: { type: "media", required: true }, title: { type: "string", meta: { control: { placeholder: "x" } } } }),
        defaultProps: { title: "t" },
      }),
    );
    expect(a.skipped).toMatch(/requires inputs with no default: sourceId/);
    expect(a.findings).toEqual([]);
  });

  it("SKIPS capability-tier templates without rendering them", async () => {
    let rendered = false;
    const a = await auditRenderedTemplate(tmpl("@x/cap/v1", async () => { rendered = true; return doc([]); }, { capabilities: { tier: "capability", caps: {} } } as never));
    expect(a.skipped).toMatch(/capability tier/);
    expect(rendered).toBe(false);
  });

  it("audits a pipeline's inline step documents", async () => {
    const pipeline = { kind: "mosaic_pipeline", version: 1, steps: [{ durationMs: 1000, file: doc([text("Hello there")]) }, { durationMs: 1000, ref: "x" }] };
    const a = await auditRenderedTemplate(tmpl("@x/pipe/v1", async () => pipeline as never));
    expect(a.findings.map((f) => f.convention)).toEqual(["bindingsCover", "bindingsDeclared"]);
  });

  it("external + record:false: findings are flagged external and NOT written to the log; a later pass clears an old finding", async () => {
    const t = tmpl("@x/ext/v1", async () => doc([text("Hello there")]));
    const a = await auditRenderedTemplate(t, { external: true, record: false });
    expect(only(a, "bindingsCover")[0]).toMatchObject({ external: true, severity: "warning" });
    // an external pack's throw-posture finding is recorded, never fatal, but
    // KEEPS error severity — the host's publish requirement (see latticeSmooth)
    expect(only(a, "bindingsDeclared")[0]).toMatchObject({ external: true, severity: "error" });
    expect(listTemplateConventionFindings()).toEqual([]);
    await auditRenderedTemplate(t);
    expect(listTemplateConventionFindings()).toHaveLength(2);
    await auditRenderedTemplate(tmpl("@x/ext/v1", async () => doc([bound("Hello there", "title")])));
    expect(listTemplateConventionFindings()).toEqual([]);
  });

  describe("layout floors", () => {
    // 2 frames on a 1000-slot literal basis — precision floor 1000px tall.
    const tall = (): MosaicDocument =>
      ({
        ...doc([bound("Hello there", "title"), text("x")]),
        m0: String(weightedSplit([1, 999], "row", { mode: "literal", claimants: ["1", "1"] })),
      }) as MosaicDocument;

    it("safeMinimumCanvas (warning): the template is below its own floor at its hinted canvas", async () => {
      const a = await auditRenderedTemplate(tmpl("@x/floor/v1", async () => tall(), { outputHints: { width: 1280, height: 720 } } as never));
      const f = a.findings.find((x) => x.convention === "safeMinimumCanvas");
      expect(f).toMatchObject({ severity: "warning", violations: [{ key: "1280×720" }] });
      expect(f!.violations[0].detail).toMatch(/safe minimum is \d+×1000/);
      expect(f!.violations[0].detail).toMatch(/squashed/);
    });

    it("says when the floor breach CULLS cells (below feasibility), not just squashes them", async () => {
      const a = await auditRenderedTemplate(tmpl("@x/floor-cull/v1", async () => tall(), { outputHints: { width: 1280, height: 2 } } as never));
      expect(a.findings.find((x) => x.convention === "safeMinimumCanvas")!.violations[0].detail).toMatch(/culled: content is missing/);
    });

    it("is silent when the hinted canvas clears the floor", async () => {
      const a = await auditRenderedTemplate(tmpl("@x/floor-ok/v1", async () => tall(), { outputHints: { width: 1280, height: 1000 } } as never));
      expect(a.findings.map((x) => x.convention)).not.toContain("safeMinimumCanvas");
    });

    it("canvasEnvelope (warning, opt-in): renders at each sweep canvas and lists the ones below the floor", async () => {
      const a = await auditRenderedTemplate(tmpl("@x/envelope/v1", async () => tall(), { outputHints: { width: 1280, height: 1000 } } as never), {
        sweepCanvases: [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { width: 1080, height: 1080 }, { width: 1280, height: 1000 }],
      });
      // 1080 tall clears 1000; the hinted canvas is skipped; 1920×1080 clears —
      // nothing below, so no finding at all.
      expect(a.findings.map((x) => x.convention)).not.toContain("safeMinimumCanvas");
      expect(a.findings.map((x) => x.convention)).not.toContain("canvasEnvelope");
    });

    it("canvasEnvelope flags exactly the canvases that fall below", async () => {
      const a = await auditRenderedTemplate(tmpl("@x/envelope-2/v1", async () => tall(), { outputHints: { width: 1280, height: 1000 } } as never), {
        sweepCanvases: [{ width: 1920, height: 800 }, { width: 800, height: 1200 }],
      });
      const env = a.findings.find((x) => x.convention === "canvasEnvelope")!;
      expect(env.violations.map((v) => v.key)).toEqual(["1920×800"]);
    });
  });

  describe("deterministic", () => {
    it("THROW-posture finding when two renders of the defaults differ, naming the first differing path", async () => {
      let n = 0;
      const a = await auditRenderedTemplate(tmpl("@x/nondet/v1", async () => ({ ...doc([bound("Hello there", "title")]), label: `run ${++n}` }) as never));
      const f = a.findings.find((x) => x.convention === "deterministic");
      expect(f).toMatchObject({ severity: "error", violations: [{ key: "$.label" }] });
      expect(f!.violations[0].detail).toMatch(/differ at \$\.label/);
    });

    it("silent for a pure render", async () => {
      const a = await auditRenderedTemplate(tmpl("@x/det/v1", async () => doc([bound("Hello there", "title")])));
      expect(a.findings.map((x) => x.convention)).not.toContain("deterministic");
    });
  });

  describe("textFits", () => {
    const svgText = (t: string, fontSize: number, extra: Src = {}): Src => ({
      type: "text",
      rasterizer: "svg",
      layers: [{ content: { kind: "literal", text: t }, style: { fontSize }, ...extra }],
      editor: { binding: { propKey: "title" } },
    });

    it("THROW-posture finding when an svg text layer measures wider than its cell", async () => {
      // The 2-way split is two ROWS of 1280×360 at 1280×720; 400px type
      // measures ~1925×469 and does not fit "Hello there".
      const a = await auditRenderedTemplate(tmpl("@x/clip/v1", async () => doc([svgText("Hello there", 400), text("x")])));
      const f = a.findings.find((x) => x.convention === "textFits");
      expect(f).toMatchObject({ severity: "error", violations: [{ key: "src[0]" }] });
      expect(f!.violations[0].detail).toMatch(/needs \d+×\d+ px but its cell offers \d+×\d+ px/);
    });

    it("honours inset and padding — the same text that fits the raw cell can fail the padded box", async () => {
      const fits = await auditRenderedTemplate(tmpl("@x/fit/v1", async () => doc([svgText("Hello there", 40), text("x")])));
      expect(fits.findings.map((x) => x.convention)).not.toContain("textFits");
      const padded = await auditRenderedTemplate(
        tmpl("@x/fit-pad/v1", async () => doc([svgText("Hello there", 40, { placement: { padding: { left: 0.45, right: 0.45 } } }), text("x")])),
      );
      expect(padded.findings.map((x) => x.convention)).toContain("textFits");
    });

    it("sizes height by the em (glyph ink), and subtracts a plain-number xExpr offset", async () => {
      // 1280×360 rows: a 300px "●" is 300 tall by the em (fits 360) though its
      // font metrics span ~350; the same glyph pushed 1200px right does not fit.
      const ok = await auditRenderedTemplate(tmpl("@x/em/v1", async () => doc([svgText("●", 300), text("x")])));
      expect(ok.findings.map((x) => x.convention)).not.toContain("textFits");
      const pushed = await auditRenderedTemplate(
        tmpl("@x/em-x/v1", async () => doc([svgText("●", 300, { placement: { hAlign: "left", xExpr: "1200" } }), text("x")])),
      );
      expect(pushed.findings.map((x) => x.convention)).toContain("textFits");
    });

    it("ignores drawtext sources and layers without a font size", async () => {
      const a = await auditRenderedTemplate(
        tmpl("@x/fit-skip/v1", async () => doc([{ ...svgText("Hello there", 400), rasterizer: "drawtext" }, { type: "text", rasterizer: "svg", layers: [{ content: { kind: "literal", text: "Hello there" } }] }])),
      );
      expect(a.findings.map((x) => x.convention)).not.toContain("textFits");
    });
  });

  describe("layout fingerprint", () => {
    it("the audit returns the flattened layout with a stable hash and frame count", async () => {
      const a = await auditRenderedTemplate(tmpl("@x/fp/v1", async () => doc([bound("Hello there", "title"), text("x")])));
      expect(a.layout).toMatchObject({ canvas: { width: 1280, height: 720 }, docs: ["2[1,1]"], m0: "2[1,1]", chars: 6, frames: 2 });
      expect(a.layout!.hash).toBe(fingerprintHash("2[1,1]"));
      expect(fingerprintHash("2[1,1]")).toMatch(/^[0-9a-f]{16}$/);
      expect(fingerprintHash("2[1,1]")).not.toBe(fingerprintHash("2[1,2]"));
    });

    it("diffLayoutFingerprint names the divergence and the frame-count move; identical strings are 'same'", () => {
      expect(diffLayoutFingerprint("2[1,1]", "2[1,1]")).toEqual({ same: true, detail: "" });
      const d = diffLayoutFingerprint("2[1,1]", "3[1,1,1]");
      expect(d.same).toBe(false);
      expect(d.detail).toMatch(/at char 0/);
      expect(d.detail).toMatch(/2 frames → now 8 chars \/ 3 frames/);
      expect(layoutFingerprintFinding("@x/fp/v1", "2[1,1]", "3[1,1,1]")).toMatchObject({ convention: "layoutFingerprint", severity: "error" });
      expect(layoutFingerprintFinding("@x/fp/v1", "2[1,1]", "2[1,1]")).toBeNull();
    });
  });

  describe("costBudget (warning)", () => {
    it("flags a document past the frame and source budgets, naming the engine consequence", async () => {
      const n = COST_BUDGETS.frames + 1;
      const many = (): MosaicDocument =>
        ({ kind: "mosaic_document", version: 1, m0: `${n}[${Array(n).fill("1").join(",")}]`, assets: {}, sources: Array.from({ length: n }, () => ({ type: "lavfi", color: "#000" })) }) as unknown as MosaicDocument;
      const a = await auditRenderedTemplate(tmpl("@x/cost/v1", async () => many()));
      const f = a.findings.find((x) => x.convention === "costBudget")!;
      expect(f.severity).toBe("warning");
      expect(f.violations.map((v) => v.key).sort()).toEqual(["frames", "sources"]);
      expect(f.violations[0].detail).toMatch(/exceeds the budget of/);
    });

    it("counts inline masks and overlay depth; a small document is silent", async () => {
      const a = await auditRenderedTemplate(tmpl("@x/cost-ok/v1", async () => doc([bound("Hello there", "title"), text("x")])));
      expect(a.findings.map((x) => x.convention)).not.toContain("costBudget");
    });

    // Overlay depth is measured PER NODE, the way the engine emits it — one
    // document, one chain — and only where inline masks ride the chain (R10).
    /** A base tile under `n` nested full-canvas overlays: `1{1{1}}` for 2. */
    const nest = (n: number): string => `1${"{1".repeat(n)}${"}".repeat(n)}`;
    const masked = (): Src => ({ type: "lavfi", color: "#000", mask: { kind: "inline-mask", shape: "circle" } });
    const chain = (n: number, src: () => Src, extra: Src = {}): MosaicDocument =>
      ({ kind: "mosaic_document", version: 1, m0: nest(n), assets: {}, sources: Array.from({ length: n + 1 }, src), ...extra }) as unknown as MosaicDocument;

    it("measures overlay depth per node, not on the flattened tree: two nested chains of 12 are two nodes of 12", async () => {
      const inner = chain(12, masked, { size: { width: 1280, height: 720 } });
      const outer = chain(12, masked, { children: { card: inner } });
      // the base tile of the outer chain IS the child — flattened, the tree reads 24 deep
      (outer as unknown as { sources: Src[] }).sources[0] = { type: "mosaic", ref: "card" };
      const a = await auditRenderedTemplate(tmpl("@x/cost-nested/v1", async () => outer));
      expect(a.findings.filter((x) => x.convention === "costBudget")).toEqual([]);
    });

    it("names the node whose own chain is past the budget with inline masks riding it", async () => {
      const deep = chain(COST_BUDGETS.overlayDepth + 1, masked, { size: { width: 1280, height: 720 } });
      const root = { ...doc([{ type: "mosaic", ref: "deep" }, text("x")]), children: { deep } } as unknown as MosaicDocument;
      const a = await auditRenderedTemplate(tmpl("@x/cost-deep-child/v1", async () => root));
      const f = a.findings.find((x) => x.convention === "costBudget")!;
      expect(f.violations.map((v) => v.key)).toEqual(["overlayDepth"]);
      expect(f.violations[0].detail).toMatch(/^overlayDepth 21 on child document "deep" exceeds the budget of 20 — the engine drops inline masks past ~25 overlay layers on one node/);
      const atRoot = await auditRenderedTemplate(tmpl("@x/cost-deep-root/v1", async () => chain(COST_BUDGETS.overlayDepth + 1, masked)));
      expect(atRoot.findings.find((x) => x.convention === "costBudget")!.violations[0].detail).toMatch(/^overlayDepth 21 exceeds the budget/);
    });

    it("a deep chain with no inline masks is silent, as the engine's own warning is", async () => {
      const a = await auditRenderedTemplate(tmpl("@x/cost-deep-plain/v1", async () => chain(COST_BUDGETS.overlayDepth + 1, () => ({ type: "lavfi", color: "#000" }))));
      expect(a.findings.map((x) => x.convention)).not.toContain("costBudget");
    });
  });
});

describe("latticeSmooth — split counts above 12 are 5-smooth (throw posture)", () => {
  /** Two claimants on a literal basis of `slots` — the split count IS `slots`. */
  const basisDoc = (slots: number, axis: "row" | "col" = "row"): MosaicDocument =>
    ({
      ...doc([bound("Hello there", "title"), text("x")]),
      m0: String(weightedSplit([1, slots - 1], axis, { mode: "literal", claimants: ["1", "1"] })),
    }) as MosaicDocument;
  const latticeFinding = (a: Awaited<ReturnType<typeof auditRenderedTemplate>>) => a.findings.find((f) => f.convention === "latticeSmooth");

  it("a 5-smooth basis (30 = 2·3·5) is on the lattice — no finding", async () => {
    const a = await auditRenderedTemplate(tmpl("@x/lattice-ok/v1", async () => basisDoc(30)));
    expect(latticeFinding(a)).toBeUndefined();
    expect(a.notes.filter((n) => n.startsWith("latticeSmooth"))).toEqual([]);
  });

  it("an external pack's finding is recorded, not fatal, but keeps error severity — the doctor's publish requirement", async () => {
    const a = await auditRenderedTemplate(tmpl("@x/lattice-ext/v1", async () => basisDoc(121)), { external: true, record: false });
    expect(latticeFinding(a)).toMatchObject({ severity: "error", external: true });
  });

  it("121 (the cap-and-round fencepost) is an error naming the count, the factor, and the precision fix", async () => {
    const a = await auditRenderedTemplate(tmpl("@x/lattice-121/v1", async () => basisDoc(121)));
    const f = latticeFinding(a);
    expect(f).toMatchObject({ severity: "error", violations: [{ key: "N=121" }] });
    expect(f!.violations[0].detail).toContain("split count 121 (row ×1) = 11² is not 5-smooth");
    expect(f!.violations[0].detail).toContain("one slot off 120");
    expect(f!.violations[0].detail).toContain("weightedSplit(…, { precision: 120 })");
    // Recorded in the shared log like every other render-time rule.
    expect(listTemplateConventionFindings().map((x) => x.convention)).toContain("latticeSmooth");
  });

  it("a small rough count (7 weekday rows) is content fill — no finding", async () => {
    const a = await auditRenderedTemplate(tmpl("@x/lattice-7/v1", async () => basisDoc(7)));
    expect(latticeFinding(a)).toBeUndefined();
  });

  it("lattice.mode \"bitmap\" skips the rule with a note", async () => {
    const a = await auditRenderedTemplate(tmpl("@x/lattice-bitmap/v1", async () => basisDoc(121), { lattice: { mode: "bitmap" } } as never));
    expect(latticeFinding(a)).toBeUndefined();
    expect(a.notes).toContain('latticeSmooth: skipped — lattice.mode is "bitmap" (a baked raster is never live-composed)');
  });

  it("lattice.allow accepts a declared content count and notes the reason", async () => {
    const extra = { lattice: { allow: [{ count: 53, reason: "one row per ISO week" }] } } as never;
    const a = await auditRenderedTemplate(tmpl("@x/lattice-allow/v1", async () => basisDoc(53), extra));
    expect(latticeFinding(a)).toBeUndefined();
    expect(a.notes).toContain("latticeSmooth: allowed content counts 53 (one row per ISO week)");
    // The declaration is per count: an undeclared rough count still surfaces.
    const b = await auditRenderedTemplate(tmpl("@x/lattice-allow-miss/v1", async () => basisDoc(121), extra));
    expect(latticeFinding(b)).toMatchObject({ violations: [{ key: "N=121" }] });
  });

  it("a nested child's rough basis is caught — the tree is walked, not just the root", async () => {
    const nested = (): MosaicDocument =>
      ({
        kind: "mosaic_document",
        version: 1,
        assets: {},
        m0: "1",
        sources: [{ type: "mosaic", ref: "kid", editor: { label: "slot" } }],
        children: { kid: basisDoc(121, "col") },
      }) as unknown as MosaicDocument;
    const a = await auditRenderedTemplate(tmpl("@x/lattice-nested/v1", async () => nested()));
    const f = latticeFinding(a);
    expect(f).toMatchObject({ violations: [{ key: "N=121" }] });
    expect(f!.violations[0].detail).toContain("(col ×1)");
  });

  it("a child document that declares itself a bitmap (engine.lattice) is skipped with its subtree", async () => {
    const nested = (): MosaicDocument =>
      ({
        kind: "mosaic_document",
        version: 1,
        assets: {},
        m0: "1",
        sources: [{ type: "mosaic", ref: "qr", editor: { label: "qr" } }],
        children: { qr: { ...basisDoc(37, "col"), engine: { lattice: { mode: "bitmap" } } } },
      }) as unknown as MosaicDocument;
    const a = await auditRenderedTemplate(tmpl("@x/lattice-bitmap-child/v1", async () => nested()));
    expect(latticeFinding(a)).toBeUndefined();
    expect(a.notes).toContain("latticeSmooth: 1 bitmap child document(s) skipped at 1280×720 (engine.lattice.mode)");
  });

  it("lattice.canvas \"physical\" drops the rough-canvas finding and charges the canvas for the counts it explains", async () => {
    // 1130 = 2·5·113: a 113-slot split is the canvas's doing; 137 is not.
    const a = await auditRenderedTemplate(
      tmpl("@x/lattice-physical/v1", async () => basisDoc(113, "col"), {
        lattice: { canvas: "physical" },
        outputHints: { width: 1130, height: 720, format: { kind: "image", container: "png" } },
      } as never),
    );
    expect(latticeFinding(a)).toBeUndefined();
    expect(a.notes.some((n) => n.includes("declared physical"))).toBe(true);
    const b = await auditRenderedTemplate(
      tmpl("@x/lattice-physical-miss/v1", async () => basisDoc(137, "row"), {
        lattice: { canvas: "physical" },
        outputHints: { width: 1130, height: 720, format: { kind: "image", container: "png" } },
      } as never),
    );
    expect(latticeFinding(b)!.violations.map((v) => v.key)).toEqual(["N=137"]);
  });

  it("a rough hinted canvas is reported once, first, even when the layout itself is smooth", async () => {
    const a = await auditRenderedTemplate(
      tmpl("@x/lattice-canvas/v1", async () => basisDoc(30), { outputHints: { width: 1200, height: 628, format: { kind: "image", container: "png" } } } as never),
    );
    const f = latticeFinding(a);
    expect(f!.violations.map((v) => v.key)).toEqual(["canvas"]);
    expect(f!.violations[0].detail).toContain("height 628 = 2²·157 is not 5-smooth");
  });
});

describe("latticeSmooth — the sweep canvases are checked too", () => {
  it("a layout that is on the lattice at its hint but rough on a sweep canvas is reported with the canvas in the key", async () => {
    // Smooth at the 1280×720 hint (basis 30), rough (121) whenever the height is 1080.
    const byCanvas = (ctx: { target: { width: number; height: number } }): MosaicDocument =>
      ({
        ...doc([bound("Hello there", "title"), text("x")]),
        m0: String(weightedSplit([1, ctx.target.height === 1080 ? 120 : 29], "row", { mode: "literal", claimants: ["1", "1"] })),
      }) as MosaicDocument;
    const a = await auditRenderedTemplate(tmpl("@x/lattice-sweep/v1", async (_p, ctx) => byCanvas(ctx as never)), { sweepCanvases: STANDARD_SWEEP_CANVASES });
    const f = a.findings.find((x) => x.convention === "latticeSmooth");
    expect(f!.violations.map((v) => v.key)).toEqual(["1920×1080:N=121", "1080×1080:N=121"]);
    expect(f!.violations[0].detail).toMatch(/^at 1920×1080: split count 121/);
  });
});
