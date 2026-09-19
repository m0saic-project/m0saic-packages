import { validateM0String } from "@m0saic/dsl";

import { alpineCard, paint, EMPTY, rowSplit, overlay, type Node } from "./alpine-card";
import { ALPINE_PRESETS } from "./alpine-theme";
import { makeColorTile } from "@m0saic/template-utils";

const theme = ALPINE_PRESETS.light;
const body: Node = paint(makeColorTile(theme.primary));
const W = 1920;
const H = 1080;

describe("alpine-card", () => {
  it("produces a valid m0 root with a header band when titled", () => {
    const card = alpineCard({ theme, W, H, title: "BAR CHART", subtitle: "Sales by Channel" });
    const root = card.compose(body);
    const res = validateM0String(root.m0);
    expect(res.ok).toBe(true);
    // card surface + header text + body fill = 3 sources, surface first (DFS order)
    expect(root.sources.length).toBe(3);
    expect(root.sources[0].type).toBe("lavfi"); // card surface
    expect(card.backgroundColor).toBe(theme.canvas);
  });

  it("reserves a header band: titled content rect is shorter than untitled", () => {
    const titled = alpineCard({ theme, W, H, title: "X", subtitle: "y" });
    const bare = alpineCard({ theme, W, H });
    expect(titled.contentRect.h).toBeLessThan(bare.contentRect.h);
    // untitled: full inner height, content placed directly (no header split)
    expect(bare.contentRect.y).toBe(bare.contentRect.x); // both === pad
    expect(bare.contentRect.h).toBe(H - 2 * bare.contentRect.x);
    // titled: body pushed down by the header
    expect(titled.contentRect.y).toBeGreaterThan(titled.contentRect.x);
  });

  it("contentRect width spans the padded inner region", () => {
    const card = alpineCard({ theme, W, H, padding: 100 });
    expect(card.contentRect.x).toBe(100);
    expect(card.contentRect.w).toBe(W - 200);
  });

  it("is deterministic — identical inputs yield identical m0", () => {
    const a = alpineCard({ theme, W, H, title: "T", subtitle: "S" }).compose(body);
    const b = alpineCard({ theme, W, H, title: "T", subtitle: "S" }).compose(body);
    expect(a.m0).toBe(b.m0);
  });

  it("kit combinators compose to valid m0", () => {
    const n = overlay([
      paint(makeColorTile(theme.card)),
      rowSplit([{ weight: 1, node: paint(makeColorTile(theme.primary)) }, { weight: 1, node: EMPTY }]),
    ]);
    expect(validateM0String(n.m0).ok).toBe(true);
  });
});

describe("alpine-card — header prop binding (Make inline edit)", () => {
  const header = (card: ReturnType<typeof alpineCard>) =>
    card.compose(body).sources.find((s) => (s as { editor?: { label?: string } }).editor?.label === "card-header") as
      | { editor?: { label?: string; binding?: { propKey: string; index?: number }; bindings?: Array<{ propKey: string; layer?: number }> } }
      | undefined;

  it("binds each header layer to its prop: title+subtitle → two layer bindings; one layer → a single binding", () => {
    const both = header(alpineCard({ theme, W, H, title: "T", subtitle: "S" }))?.editor;
    expect(both?.bindings).toEqual([{ propKey: "title", layer: 0 }, { propKey: "subtitle", layer: 1 }]);
    expect(both?.binding).toBeUndefined();
    expect(header(alpineCard({ theme, W, H, title: "T" }))?.editor?.binding).toEqual({ propKey: "title" });
    expect(header(alpineCard({ theme, W, H, subtitle: "S" }))?.editor?.binding).toEqual({ propKey: "subtitle" });
    expect(header(alpineCard({ theme, W, H }))).toBeUndefined();
  });

  it("honours custom keys and opts out with `false`", () => {
    expect(header(alpineCard({ theme, W, H, title: "T", headerBinding: { title: "chrome.heading" } }))?.editor?.binding).toEqual({ propKey: "chrome.heading" });
    // only the title key given → with both layers present only the title layer binds (a single binding)
    expect(header(alpineCard({ theme, W, H, title: "T", subtitle: "S", headerBinding: { title: "chrome.heading" } }))?.editor?.binding).toEqual({ propKey: "chrome.heading" });
    expect(header(alpineCard({ theme, W, H, subtitle: "S", headerBinding: { title: "x" } }))?.editor?.binding).toBeUndefined();
    expect(header(alpineCard({ theme, W, H, title: "T", headerBinding: false }))?.editor?.binding).toBeUndefined();
    // the layout-contract tag is unaffected either way
    expect(header(alpineCard({ theme, W, H, title: "T", headerBinding: false }))?.editor?.label).toBe("card-header");
  });
});
