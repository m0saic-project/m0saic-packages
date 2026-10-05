import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { isValidM0String, parseM0StringComplete } from "@m0saic/dsl";
import { auditRenderedTemplate, getTemplate, getTemplateAsRegistered, resolvePropBindings } from "@m0saic/template-utils";
import { AlpineKpiCardV2 } from "../v2/kpi-card";
import { AlpineKpiCardV3 } from "./kpi-card";

const ID = "@m0saic/alpine/kpi-card/v3";
const W = 1280;
const H = 800;

function makeCtx(width = W, height = H, durationMs = 2000): MosaicEngineContext {
  return {
    mode: "render" as const,
    target: { width, height, fps: 30, durationMs },
    output: { width, height, fps: 30, durationMs, workspaceDir: "/tmp/alpine-kpi-v3" },
    media: {},
  } as unknown as MosaicEngineContext;
}

const render = async (props: Record<string, unknown>, w = W, h = H) =>
  (await AlpineKpiCardV3.render(props as never, makeCtx(w, h))) as MosaicDocument;

const D = AlpineKpiCardV3.defaultProps as Record<string, unknown>;
const srcs = (doc: MosaicDocument) => (doc.sources ?? []) as MosaicSource[];
const statusOf = (doc: MosaicDocument) => (srcs(doc)[0] as { engine?: { renderStatus?: string } } | undefined)?.engine?.renderStatus;
const labelOf = (s: MosaicSource) => (s as { editor?: { label?: string } }).editor?.label;
const keysOn = (doc: MosaicDocument, label: string): string[] => {
  const s = srcs(doc).find((x) => labelOf(x) === label) as { editor?: { binding?: { propKey: string }; bindings?: Array<{ propKey: string }> } } | undefined;
  return (s?.editor?.bindings ?? (s?.editor?.binding ? [s.editor.binding] : [])).map((b) => b.propKey);
};

/** Strip the editor handles: what the card PAINTS, for the v2 parity check. */
const painted = (doc: MosaicDocument): unknown =>
  JSON.parse(JSON.stringify(doc), (k, v) => {
    if (k === "binding" || k === "bindings") return undefined;
    // A rect whose editor held ONLY handles (the card surface, bound to the preset) paints as if it had none.
    if (k === "editor" && v && typeof v === "object" && Object.keys(v as object).length === 0) return undefined;
    return v;
  });

describe("@m0saic/alpine/kpi-card/v3 — template shell", () => {
  it("id, version 3, core tier, mp4 hints", () => {
    expect(String(AlpineKpiCardV3.id)).toBe(ID);
    expect(AlpineKpiCardV3.version).toBe(3);
    expect(AlpineKpiCardV3.outputHints?.format).toEqual({ kind: "video", container: "mp4" });
    // Make opens a video template on this frame: the settled card, after the intro.
    expect(AlpineKpiCardV3.outputHints?.posterTimeMs).toBe(1900);
  });

  it("describes itself in its catalog sidecar only — group fields included; the registry applies it", () => {
    const code = getTemplateAsRegistered(ID)!;
    for (const field of ["label", "description", "tags", "primitive"]) expect((code as unknown as Record<string, unknown>)[field]).toBeUndefined();
    const registered = getTemplate(ID)!;
    expect(registered.label).toBe("Alpine KPI Card");
    expect(registered.primitive).toBe(true);
    const anim = registered.propsSchema?.anim as { meta?: { ui?: unknown }; fields?: Record<string, { meta?: { ui?: { label?: string } } }> };
    expect(anim.meta?.ui).toMatchObject({ label: "Animation", collapsedByDefault: true });
    expect(anim.fields?.introFrac?.meta?.ui?.label).toBe("Intro length");
  });

  it("supersedes v2: the v2 sidecar deprecates it in favour of v3", () => {
    expect(getTemplate(String(AlpineKpiCardV2.id))!.deprecated).toMatchObject({ replacement: ID });
  });

  it("meets every 0.3.1 convention as new work", async () => {
    const audit = await auditRenderedTemplate(getTemplate(ID)!, { record: false });
    expect(audit.findings.map((f) => `${f.convention}: ${f.violations.map((v) => v.detail).join(" | ")}`)).toEqual([]);
    expect(audit.lagging).toEqual([]);
  });

  it("paints exactly what v2 paints — defaults, titled dark down, no delta, portrait, light mode, static", async () => {
    const cases: Array<[Record<string, unknown>, number, number]> = [
      [D, W, H],
      [{ ...D, title: "Q2 PERFORMANCE", subtitle: "Finance", value: "4.8%", delta: "-2.1%", direction: "down", preset: "dark" }, W, H],
      [{ label: "USERS", value: "12,400" }, W, H],
      [{ ...D, title: "Only a title" }, 720, 1280],
      [{ ...D, sparkline: [3, 9, 4, 12], anim: { renderMode: "light" } }, W, H],
      [{ ...D, anim: { reduceMotion: true } }, W, H],
    ];
    for (const [props, w, h] of cases) {
      const v2 = (await AlpineKpiCardV2.render(props as never, makeCtx(w, h))) as MosaicDocument;
      const v3 = await render(props, w, h);
      expect(painted(v3)).toEqual(painted(v2));
    }
  });

  it("defaults: valid m0, frames == sources, deterministic", async () => {
    const doc = await render(D);
    expect(isValidM0String(doc.m0 as unknown as string)).toBe(true);
    const parsed = parseM0StringComplete(doc.m0 as unknown as string, W, H);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe(srcs(doc).length);
    expect(JSON.stringify(await render(D))).toBe(JSON.stringify(doc));
  });

  it("an empty value is an input the card waits on (incomplete), never an error", async () => {
    expect(statusOf(await render({ ...D, value: "  " }))).toBe("incomplete");
  });
});

describe("@m0saic/alpine/kpi-card/v3 — prop bindings (Make canvas handles)", () => {
  const bindingsOf = async (props: Record<string, unknown>) => {
    const doc = await render(props);
    return { doc, ...resolvePropBindings(doc, W, H, { propsSchema: AlpineKpiCardV3.propsSchema }) };
  };

  it("defaults (no header): title + subtitle ride the label; nothing rejected", async () => {
    const r = await bindingsOf(D);
    expect(r.rejected).toEqual([]);
    expect(keysOn(r.doc, "kpi-label")).toEqual(["label", "title", "subtitle"]);
    expect(keysOn(r.doc, "kpi-delta")).toEqual(["delta"]);
    expect(keysOn(r.doc, "kpi-sublabel")).toEqual(["sublabel"]);
    expect(Object.keys(r.byProp).sort()).toEqual(["delta", "label", "preset", "sublabel", "subtitle", "title", "value", "valueColor"]);
    // The card surface (source 0) is the preset's handle — a choice, not typed.
    expect(r.byProp.preset).toMatchObject([{ sourceIndex: 0, kind: "choice" }]);
  });

  it("a title-only header carries the subtitle; the label drops its add handles", async () => {
    const r = await bindingsOf({ ...D, title: "Q2" });
    expect(r.rejected).toEqual([]);
    expect(keysOn(r.doc, "card-header")).toEqual(["title", "subtitle"]);
    expect(keysOn(r.doc, "kpi-label")).toEqual(["label"]);
  });

  it("no delta and no sublabel: both ride the value rect", async () => {
    const r = await bindingsOf({ label: "USERS", value: "12,400" });
    expect(r.rejected).toEqual([]);
    expect(r.byProp.delta).toHaveLength(1);
    expect(r.byProp.sublabel).toHaveLength(1);
    expect(r.byProp.delta[0].sourceIndex).toBe(r.byProp.value[0].sourceIndex);
    expect(r.byProp.sublabel[0].sourceIndex).toBe(r.byProp.value[0].sourceIndex);
  });

  it("a delta without a sublabel: the sublabel rides the pill", async () => {
    const r = await bindingsOf({ ...D, sublabel: "" });
    expect(keysOn(r.doc, "kpi-delta")).toEqual(["delta", "sublabel"]);
  });

  it("declares what the canvas cannot show: the theme source, the intro timing, the series", () => {
    expect(AlpineKpiCardV3.bindings?.unbound).toEqual({
      "theme.slug": "theme source",
      "theme.preset": "theme source",
      "theme.namespace": "theme source",
      "anim.introFrac": "timing",
      sparkline: "series",
    });
    // `preset` itself is NOT declared away: the card surface carries it (2026-10-01).
    expect(AlpineKpiCardV3.bindings?.unbound).not.toHaveProperty("preset");
  });
});
