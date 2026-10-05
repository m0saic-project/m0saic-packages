import type { MosaicDocument } from "@m0saic/types";
import { parseM0StringComplete } from "@m0saic/dsl";
import { auditRenderedTemplate, resolvePropBindings } from "@m0saic/template-utils";
import { isStandIn, markIncomplete, mediaStandInDocument } from "./stand-in";

const opts = { width: 1280, height: 720, name: "Easy Blur", title: "Drop a video here", hint: "Then draw boxes.", handles: [{ propKey: "sourceId" }] };

describe("stand-in (the slot before the footage)", () => {
  it("a slot, a title and a hint — frames match sources, the slot carries the handles and the marker", () => {
    const doc = mediaStandInDocument(opts);
    const parsed = parseM0StringComplete(String(doc.m0), 1280, 720);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe(doc.sources.length);
    expect(doc.sources.map((s) => (s as { editor?: { label?: string } }).editor?.label)).toEqual(["stand-in-slot", "stand-in-title", "stand-in-hint"]);
    expect((doc.sources[0] as { engine?: unknown }).engine).toEqual({ renderStatus: "incomplete", renderError: { message: "Easy Blur: Drop a video here" } });
    expect((doc.sources[0] as { editor?: { bindings?: unknown } }).editor?.bindings).toEqual([{ propKey: "sourceId" }]);
    expect(isStandIn(doc)).toBe(true);
    expect(Object.keys(doc.assets ?? {})).toEqual([]);
  });

  it("no hint → two sources; nested → no marker (the parent marks its ref)", () => {
    const bare = mediaStandInDocument({ ...opts, hint: undefined });
    expect(bare.sources).toHaveLength(2);
    const parsed = parseM0StringComplete(String(bare.m0), 1280, 720);
    if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe(2);
    expect(isStandIn(mediaStandInDocument({ ...opts, nested: true }))).toBe(false);
  });

  it("the slot is a drop target: its media binding resolves against a media prop", () => {
    const doc = mediaStandInDocument(opts);
    const r = resolvePropBindings(doc, 1280, 720, { propsSchema: { sourceId: { type: "media", required: true } } as never });
    expect(r.rejected).toEqual([]);
    expect(r.byProp.sourceId.map((b) => b.kind)).toEqual(["media"]);
  });

  it("is not a canvasFill (the slot is rounded and inset; the canvas is the document's)", async () => {
    const template = { id: "@test/stand-in/v1", propsSchema: { sourceId: { type: "media", required: false, description: "x" } }, defaultProps: {}, render: async () => mediaStandInDocument(opts) };
    const audit = await auditRenderedTemplate(template as never, { record: false, width: 1280, height: 720 });
    expect(audit.findings.filter((f) => f.convention === "canvasFill")).toEqual([]);
  });

  it("markIncomplete stamps any source, in place", () => {
    const src = { type: "lavfi", color: "#000" } as never;
    expect(markIncomplete(src, "x: y")).toBe(src);
    expect(isStandIn({ sources: [src] } as unknown as MosaicDocument)).toBe(true);
  });
});
