/**
 * `defineHelloWorldTemplate` — the canonical card as a factory.
 *
 * The core `@m0saic/hello-world/v1` is one call to this; its 33-test gate in
 * `packages/templates` locks the card's geometry, motion and layout contract.
 * This file locks the FACTORY surface: what a repo gets when it calls it, and
 * that the core call is exactly the shipped template (defaults, metadata).
 */
import type { MosaicDocument, MosaicEngineContext, MosaicSource } from "@m0saic/types";
import { validateM0String } from "@m0saic/dsl";
import { isSmooth } from "../../lattice/smooth";
import { auditDefaultProps } from "../../template/auditDefaultProps";
import {
  HELLO_WORLD_DESCRIPTION,
  buildHelloGeometry,
  HELLO_WORLD_LABEL,
  HELLO_WORLD_TAGS,
  defineHelloWorldTemplate,
  helloWorldDefaultProps,
} from "./helloWorld";

const ctxFor = (w: number, h: number, durationMs = 2600, fps = 30): MosaicEngineContext => {
  const t = { width: w, height: h, fps, durationMs };
  return { mode: "render", target: t, output: { ...t, workspaceDir: "/tmp/hello-world-factory-test" }, media: {} } as unknown as MosaicEngineContext;
};
type Labelled = MosaicSource & { editor?: { label?: string } };
const allSources = (doc: MosaicDocument): Labelled[] => {
  const kids = (doc as unknown as { children?: Record<string, MosaicDocument> }).children ?? {};
  return [...(doc.sources as Labelled[]), ...Object.values(kids).flatMap((d) => d.sources as Labelled[])];
};

describe("defineHelloWorldTemplate", () => {
  test("the core call IS the shipped template: id, label, tags, 16:9 hint, and the exact default props", () => {
    const t = defineHelloWorldTemplate({ id: "@m0saic/hello-world/v1" });
    expect(String(t.id)).toBe("@m0saic/hello-world/v1");
    expect(t.label).toBe(HELLO_WORLD_LABEL);
    expect(t.description).toBe(HELLO_WORLD_DESCRIPTION);
    expect(t.tags).toEqual([...HELLO_WORLD_TAGS]);
    expect(t.capabilities).toEqual({ tier: "core" });
    expect(t.outputHints).toMatchObject({ width: 1920, height: 1080, fps: 30, durationMs: 2600, format: { kind: "video", container: "mp4" } });
    // Key ORDER and set are part of the contract: share links diff props
    // against these, and the gate test pins the same object.
    expect(Object.keys(t.defaultProps ?? {})).toEqual(["greeting", "accent", "fieldOpacity", "sweep", "markReveal", "animate", "debugLayout"]);
    expect(t.defaultProps).toEqual(helloWorldDefaultProps());
    expect(auditDefaultProps(t)).toEqual([]);
  });

  test("a third-party call: its own id, and `subline` seeds the caption — and only then", () => {
    const t = defineHelloWorldTemplate({ id: "@acme/basics/hello-world/v1", subline: "by Acme Studio", label: "Hello from Acme" });
    expect(String(t.id)).toBe("@acme/basics/hello-world/v1");
    expect(t.label).toBe("Hello from Acme");
    expect(t.defaultProps?.caption).toBe("by Acme Studio");
    expect(t.defaultProps?.greeting).toBe("Hello, world.");
    // The core call carries NO caption key at all (an undefined key would
    // read as a changed prop to the share-link diff).
    expect("caption" in (defineHelloWorldTemplate({ id: "@m0saic/hello-world/v1" }).defaultProps ?? {})).toBe(false);
    expect(auditDefaultProps(t)).toEqual([]);
  });

  test("`defaults` overrides any prop; `tags` / `description` replace the core's", () => {
    const t = defineHelloWorldTemplate({
      id: "@acme/basics/hello-world/v1",
      defaults: { greeting: "Hi.", sweep: "top", animate: false },
      tags: ["hello", "acme"],
      description: "Acme's front door.",
    });
    expect(t.defaultProps).toMatchObject({ greeting: "Hi.", sweep: "top", animate: false, accent: "#EF7525" });
    expect(t.tags).toEqual(["hello", "acme"]);
    expect(t.description).toBe("Acme's front door.");
  });

  test("renders: the third-party card paints its caption, the greeting is bound, the m0 is valid", async () => {
    const t = defineHelloWorldTemplate({ id: "@acme/basics/hello-world/v1", subline: "by Acme Studio" });
    const doc = (await t.render(t.defaultProps ?? {}, ctxFor(640, 360))) as MosaicDocument;
    expect(validateM0String(String(doc.m0)).ok).toBe(true);
    const labels = allSources(doc).map((s) => s.editor?.label ?? "");
    expect(labels).toEqual(expect.arrayContaining(["field", "card", "mark", "wordmark", "greeting", "caption"]));
    const caption = allSources(doc).find((s) => s.editor?.label === "caption") as { layers?: Array<{ content?: { text?: string } }> } | undefined;
    expect(caption?.layers?.[0]?.content?.text).toBe("by Acme Studio");
    // The layout-contract id follows the caller's id (debugLayout / audits name it).
    expect((doc as unknown as { editor?: { label?: string } }).editor?.label).toBe("Hello, World · Hello, world.");
  });

  test("two calls with the same options produce equal documents (pure factory, deterministic render)", async () => {
    const a = defineHelloWorldTemplate({ id: "@acme/basics/hello-world/v1", subline: "by Acme" });
    const b = defineHelloWorldTemplate({ id: "@acme/basics/hello-world/v1", subline: "by Acme" });
    const [da, db] = await Promise.all([a.render(a.defaultProps ?? {}, ctxFor(480, 270)), b.render(b.defaultProps ?? {}, ctxFor(480, 270))]);
    expect(JSON.stringify(da)).toBe(JSON.stringify(db));
  });
});

describe("buildHelloGeometry — the card widens for long lines instead of truncating them", () => {
  test("the default card at 1920×1080 is ~64% of the short side, snapped to 5-smooth sides (latticeSmooth)", () => {
    const g = buildHelloGeometry({ W: 1920, H: 1080, greeting: "Hello, world.", caption: "" });
    // 64% of 1080 = 691, a prime — the card is a child canvas, so it snaps to
    // the nearest 5-smooth width (675 = 3³·5²) and a 5-smooth height.
    expect(g.card.w).toBe(675);
    expect(isSmooth(g.card.w)).toBe(true);
    expect(isSmooth(g.card.h)).toBe(true);
    expect(Math.abs(g.card.w - Math.round(0.64 * 1080))).toBeLessThanOrEqual(20);
  });

  test("the card stays 5-smooth on both sides across canvases", () => {
    for (const [W, H] of [[1280, 720], [1080, 1920], [640, 360], [3840, 2160]] as const) {
      const g = buildHelloGeometry({ W, H, greeting: "Hello, world.", caption: "by m0saic" });
      expect(isSmooth(g.card.w)).toBe(true);
      expect(isSmooth(g.card.h)).toBe(true);
      expect(g.card.x + g.card.w).toBeLessThanOrEqual(W);
      expect(g.card.y + g.card.h).toBeLessThanOrEqual(H);
    }
  });

  test("a starter's subline at 640×360 widens the card and is NOT ellipsized", () => {
    const caption = "by m0saic Template Starter Base";
    const g = buildHelloGeometry({ W: 640, H: 360, greeting: "Hello, world.", caption });
    expect(g.card.w).toBeGreaterThan(Math.round(0.64 * 360));
    expect(g.card.w).toBeLessThanOrEqual(Math.round(0.92 * 640));
    expect(g.caption?.text).toBe(caption);
    expect(g.caption?.rect.w).toBeLessThanOrEqual(g.card.w);
  });

  test("the widening is capped at 92% of the canvas; past it the line shrinks, then truncates", () => {
    const long = "x".repeat(400);
    const g = buildHelloGeometry({ W: 640, H: 360, greeting: long, caption: "" });
    expect(g.card.w).toBe(Math.round(0.92 * 640));
    expect(g.greeting.text.endsWith("…")).toBe(true);
    expect(g.greeting.rect.w).toBeLessThanOrEqual(g.card.w);
  });
});

/**
 * The `mark` seam (founder, 2026-09-17) — a repo paints the card's mark cell
 * with its own square image. The community repo's front door uses it for a
 * rendered PNG of the Community M, replaced on every release.
 */
describe("defineHelloWorldTemplate — mark image", () => {
  const MARK = "/abs/community-m/current.png";
  const withMark = (extra?: Record<string, unknown>) =>
    defineHelloWorldTemplate({ id: "@acme/brand/hello-world/v1", mark: { path: MARK }, ...extra });
  const cardOf = (doc: MosaicDocument) =>
    (doc as unknown as { children: Record<string, MosaicDocument> }).children.card;
  const markSource = (doc: MosaicDocument) =>
    allSources(doc).find((s) => s.editor?.label === "mark");

  test("no mark option → the brand M, and the card carries no asset", async () => {
    const doc = (await defineHelloWorldTemplate({ id: "@acme/brand/hello-world/v1" }).render(
      {}, ctxFor(1920, 1080),
    )) as MosaicDocument;
    const mark = markSource(doc)!;
    expect(mark.type).not.toBe("media");
    expect(cardOf(doc).assets).toEqual({});
  });

  test("mark option → a contain-fitted image source bound to the card's asset", async () => {
    const doc = (await withMark().render({}, ctxFor(1920, 1080))) as MosaicDocument;
    const mark = markSource(doc) as MosaicSource & {
      mediaType?: string; assetId?: string; placement?: { fit?: string };
    };
    expect(mark.type).toBe("media");
    expect(mark.mediaType).toBe("image");
    expect(mark.assetId).toBe("hello_mark");
    // Contain, never cover — cropping a mark would cut the glyph.
    expect(mark.placement?.fit).toBe("contain");
    expect(cardOf(doc).assets).toEqual({
      hello_mark: { kind: "file", path: MARK, mediaType: "image" },
    });
  });

  test("a custom assetId flows to both the source and the manifest", async () => {
    const t = defineHelloWorldTemplate({
      id: "@acme/brand/hello-world/v1",
      mark: { path: MARK, assetId: "community_m" },
    });
    const doc = (await t.render({}, ctxFor(1920, 1080))) as MosaicDocument;
    expect((markSource(doc) as { assetId?: string }).assetId).toBe("community_m");
    expect(Object.keys(cardOf(doc).assets)).toEqual(["community_m"]);
  });

  test("an image mark never assembles — no mark-rect tracks even at markReveal 'assemble'", async () => {
    const plain = (await defineHelloWorldTemplate({ id: "@acme/brand/hello-world/v1" }).render(
      { markReveal: "assemble", animate: true }, ctxFor(1920, 1080),
    )) as MosaicDocument;
    // The brand M does assemble — otherwise this test proves nothing.
    expect(allSources(plain).some((s) => s.editor?.label === "mark-rects")).toBe(true);

    const imaged = (await withMark().render(
      { markReveal: "assemble", animate: true }, ctxFor(1920, 1080),
    )) as MosaicDocument;
    expect(allSources(imaged).some((s) => s.editor?.label === "mark-rects")).toBe(false);
    expect(markSource(imaged)!.type).toBe("media");
  });

  test("the document still validates and the still (animate:false) carries the image too", async () => {
    const doc = (await withMark().render({ animate: false }, ctxFor(1080, 1080))) as MosaicDocument;
    expect(validateM0String(doc.m0).ok).toBe(true);
    expect(validateM0String(cardOf(doc).m0).ok).toBe(true);
    expect(markSource(doc)!.type).toBe("media");
  });

  test("the mark option does not leak into props — defaults are unchanged", () => {
    expect(withMark().defaultProps).toEqual(helloWorldDefaultProps());
    expect(auditDefaultProps(withMark())).toEqual([]);
  });
});
