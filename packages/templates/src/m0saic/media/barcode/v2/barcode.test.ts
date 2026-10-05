import type {
  MosaicDocument,
  MosaicEngineContext,
  MosaicLavfiSource,
  MosaicRenderableFile,
  MosaicSource,
  MosaicTextSource,
} from "@m0saic/types";
import { auditRenderedTemplate, getTemplate, getTemplateAsRegistered, resolvePropBindings } from "@m0saic/template-utils";
import { Barcode } from "../v1/barcode";
import { BarcodeV2 } from "./barcode";

const ID = "@m0saic/media/barcode/v2";

function makeCtx(): MosaicEngineContext {
  const t = { width: 1080, height: 420, fps: 30, durationMs: 2000 };
  return { mode: "render", target: t, output: { ...t, workspaceDir: "/tmp/barcode-v2-test" }, media: {} } as unknown as MosaicEngineContext;
}

function asDocument(file: MosaicRenderableFile): MosaicDocument {
  expect(file.kind).toBe("mosaic_document");
  return file as MosaicDocument;
}

const statusOf = (doc: MosaicDocument): string | undefined =>
  ((doc.sources ?? [])[0] as { engine?: { renderStatus?: string } } | undefined)?.engine?.renderStatus;

const isLavfi = (src: MosaicSource): src is MosaicLavfiSource => src.type === "lavfi";
const isText = (src: MosaicSource): src is MosaicTextSource => src.type === "text";

const render = async (props: Record<string, unknown>): Promise<MosaicDocument> =>
  asDocument(await BarcodeV2.render(props, makeCtx()));

/** Strip the editor handles: what the barcode PAINTS, for the v1 parity check. */
const painted = (doc: MosaicDocument): unknown =>
  JSON.parse(JSON.stringify(doc), (k, v) => (k === "binding" || k === "bindings" ? undefined : v));

describe("@m0saic/media/barcode/v2", () => {
  describe("template shell", () => {
    it("id, version 2, bitmap lattice, rgba PNG hints", () => {
      expect(String(BarcodeV2.id)).toBe(ID);
      expect(BarcodeV2.version).toBe(2);
      expect(BarcodeV2.lattice).toEqual({ mode: "bitmap" });
      expect(BarcodeV2.outputHints?.format).toEqual({ kind: "image", container: "png", pixelFormat: "rgba" });
    });

    it("describes itself in its catalog sidecar only; the registry applies it", () => {
      // defineMosaicTemplate applies the declared catalog, so the export carries it
      // too; the CODE's own view is what the file declares (what pins hash).
      const code = getTemplateAsRegistered(ID) as unknown as Record<string, unknown>;
      for (const field of ["label", "description", "tags"]) expect(code[field]).toBeUndefined();
      expect((BarcodeV2 as { label?: string }).label).toBe("Barcode");
      const registered = getTemplate(ID)!;
      expect(registered.label).toBe("Barcode");
      expect(registered.propsSchema?.text?.meta?.ui).toMatchObject({ label: "Payload", primary: true });
      expect(registered.propsSchema?.useNestedBackgroundColor?.meta?.ui?.hidden).toBe(true);
    });

    it("supersedes v1: the v1 sidecar deprecates it in favour of v2", () => {
      expect(getTemplate(String(Barcode.id))!.deprecated).toMatchObject({ replacement: ID });
    });

    it("meets every 0.3.1 convention as new work (canvasFill included)", async () => {
      const audit = await auditRenderedTemplate(getTemplate(ID)!, { record: false });
      expect(audit.findings.map((f) => `${f.convention}: ${f.violations.map((v) => v.detail).join(" | ")}`)).toEqual([]);
      expect(audit.lagging).toEqual([]);
    });
  });

  describe("the ground", () => {
    it("standalone: the quiet zone is document.backgroundColor — no full-canvas tile, every lavfi is a bar", async () => {
      const doc = await render({ text: "HELLO" });
      expect(doc.backgroundColor).toBe("#ffffff@1.0");
      const lavfi = (doc.sources ?? []).filter(isLavfi);
      expect(lavfi.length).toBeGreaterThan(10);
      for (const tile of lavfi) expect(tile.color).toBe("#f97316");
      expect(String(doc.m0).startsWith("1{")).toBe(false);
    });

    it("useNestedBackgroundColor: a composing parent gets v1's base tile back — and v1's exact paint", async () => {
      const cases: Array<Parameters<typeof Barcode.render>[0]> = [
        { text: "HELLO" },
        { text: "HELLO", mode: "dark" },
        { format: "ean13", text: "5901234123457" },
        { showHumanReadable: false },
      ];
      for (const props of cases) {
        const v2 = await render({ ...props, useNestedBackgroundColor: true });
        const v1 = asDocument(await Barcode.render(props, makeCtx()));
        expect(painted(v2)).toEqual(painted(v1));
      }
    });

    it("transparent stays tile-free and background-free, nested or not", async () => {
      for (const nested of [false, true]) {
        const doc = await render({ transparentBackground: true, useNestedBackgroundColor: nested });
        expect(doc.backgroundColor).toBeUndefined();
        expect((doc.sources ?? []).filter(isLavfi).every((t) => t.color === "#f97316")).toBe(true);
      }
    });

    it("the HRI tile tracks the ground (light, dark, transparent)", async () => {
      const bgOf = async (props: Record<string, unknown>) =>
        ((await render(props)).sources ?? []).find(isText)?.visual?.backgroundColor;
      expect(await bgOf({ mode: "light" })).toBe("#ffffff@1.0");
      expect(await bgOf({ mode: "dark" })).toBe("#000000@1.0");
      expect(await bgOf({ transparentBackground: true })).toBeUndefined();
    });
  });

  describe("render", () => {
    it("formats: Code 128 one caption, EAN-13 three (1-6-6), UPC-A four (1-5-5-1)", async () => {
      const captions = async (props: Record<string, unknown>) =>
        ((await render(props)).sources ?? []).filter(isText).map((t) => (t.layers?.[0]?.content as { text: string }).text);
      expect(await captions({ text: "HELLO" })).toEqual(["HELLO"]);
      expect(await captions({ format: "ean13", text: "5901234123457" })).toEqual(["5", "901234", "123457"]);
      expect(await captions({ format: "upca", text: "036000291452" })).toEqual(["0", "36000", "29145", "2"]);
    });

    it("an empty payload is an input the barcode waits on (incomplete), never an error", async () => {
      expect(statusOf(await render({ text: "  " }))).toBe("incomplete");
    });

    it("an unencodable payload is an error mosaic (wrong check digit, letters in UPC-A)", async () => {
      expect(statusOf(await render({ format: "ean13", text: "5901234123450" }))).toBe("error");
      expect(statusOf(await render({ format: "upca", text: "ABCDEFGHIJK" }))).toBe("error");
    });

    it("determinism: double render is JSON-identical", async () => {
      expect(JSON.stringify(await render({}))).toBe(JSON.stringify(await render({})));
    });
  });

  describe("prop bindings (Make canvas handles)", () => {
    const bindingsOf = async (props: Record<string, unknown>) => {
      const doc = await render(props);
      return { doc, ...resolvePropBindings(doc, doc.size!.width, doc.size!.height, { propsSchema: BarcodeV2.propsSchema }) };
    };

    it("every bar and the caption carry the payload — a double-click anywhere edits `text`", async () => {
      const r = await bindingsOf({ text: "HELLO" });
      expect(r.rejected).toEqual([]);
      expect(Object.keys(r.byProp)).toEqual(["text"]);
      expect(r.byProp.text).toHaveLength((r.doc.sources ?? []).length);
    });

    it("caption off: the bars still carry it", async () => {
      const r = await bindingsOf({ showHumanReadable: false });
      expect(r.byProp.text.length).toBeGreaterThan(10);
      expect((r.doc.sources ?? []).filter(isText)).toHaveLength(0);
    });

    it("the nested base tile binds nothing (it is ground, not content)", async () => {
      const r = await bindingsOf({ text: "HELLO", useNestedBackgroundColor: true });
      expect(r.byProp.text).toHaveLength((r.doc.sources ?? []).length - 1);
      expect(r.byProp.text.map((b) => b.sourceIndex)).not.toContain(0);
    });
  });
});
