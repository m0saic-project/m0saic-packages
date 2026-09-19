import type { MosaicDocument, MosaicTemplate, MosaicTemplatePropDefinition } from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import { weightedSplit } from "@m0saic/dsl-stdlib";

import { COST_BUDGETS, STANDARD_SWEEP_CANVASES, auditRenderedTemplate, diffLayoutFingerprint, fingerprintHash, layoutFingerprintFinding } from "./auditRenderedTemplate";
import { drainTemplateConventionFindings, listTemplateConventionFindings } from "./templateConventions";

type Props = Record<string, unknown>;
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

const schema = (s: Record<string, Partial<MosaicTemplatePropDefinition> & { type: MosaicTemplatePropDefinition["type"] }>) =>
  Object.fromEntries(Object.entries(s).map(([k, d]) => [k, { required: false, meta: { ui: { label: k } }, ...d }])) as never;

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
    expect(a.findings).toMatchObject([{ convention: "bindingsCover", severity: "warning", violations: [{ key: "title" }] }]);
    expect(a.findings[0].violations[0].detail).toMatch(/bindProp\(src, "title"\)/);
    // closed set `mode` is never a coverage target
    expect(a.findings[0].violations.map((v) => v.key)).not.toContain("mode");
    expect(listTemplateConventionFindings()).toHaveLength(1);
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
    expect(a.findings.map((f) => f.convention)).toEqual(["bindingsCover"]);
  });

  it("external + record:false: findings are flagged external and NOT written to the log; a later pass clears an old finding", async () => {
    const t = tmpl("@x/ext/v1", async () => doc([text("Hello there")]));
    const a = await auditRenderedTemplate(t, { external: true, record: false });
    expect(a.findings[0]).toMatchObject({ external: true, severity: "warning" });
    expect(listTemplateConventionFindings()).toEqual([]);
    await auditRenderedTemplate(t);
    expect(listTemplateConventionFindings()).toHaveLength(1);
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
