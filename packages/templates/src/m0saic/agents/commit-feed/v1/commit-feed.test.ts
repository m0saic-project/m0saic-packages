/**
 * @m0saic/agents/commit-feed/v1 — gate test.
 *
 * Locks the share math, the row mapping onto the nested alpine feed (agent /
 * human kinds, the agent's name on the area chip), determinism, the layout
 * contract across canvases, fail-fast on empty input, and node-cleanliness.
 */
import * as fs from "fs";
import * as path from "path";
import type { MosaicDocument, MosaicEngineContext } from "@m0saic/types";
import { parseM0StringComplete, validateM0String } from "@m0saic/dsl";
import { assertLayout } from "@m0saic/template-utils";
import "../../../alpine/commit-feed/v2"; // the nested feed must be registered
import { AgentCommitFeedV1, SAMPLE_COMMITS, type AgentCommit } from "./commit-feed";

const ID = "@m0saic/agents/commit-feed/v1";

const ctxFor = (w: number, h: number, durationMs = 3000): MosaicEngineContext => {
  const t = { width: w, height: h, fps: 30, durationMs };
  return { mode: "render", target: t, output: { ...t, workspaceDir: "/tmp/agent-commit-feed-test" }, media: {} } as unknown as MosaicEngineContext;
};

const isErrorMosaic = (doc: MosaicDocument): boolean =>
  (doc.sources?.[0] as { engine?: { renderStatus?: string } } | undefined)?.engine?.renderStatus === "error";

const labelsOf = (doc: MosaicDocument): string[] =>
  doc.sources.map((s) => (s as { editor?: { label?: string } }).editor?.label).filter((l): l is string => !!l);

const textOf = (doc: MosaicDocument, label: string): string | undefined => {
  const src = doc.sources.find((s) => (s as { editor?: { label?: string } }).editor?.label === label) as
    | { layers?: Array<{ content?: { text?: string } }> }
    | undefined;
  return src?.layers?.[0]?.content?.text;
};

const render = async (props: Record<string, unknown>, ctx = ctxFor(1280, 800)): Promise<MosaicDocument> =>
  (await AgentCommitFeedV1.render({ ...AgentCommitFeedV1.defaultProps, ...props } as never, ctx)) as MosaicDocument;

const expectValid = (doc: MosaicDocument, W: number, H: number) => {
  expect(isErrorMosaic(doc)).toBe(false);
  expect(validateM0String(String(doc.m0)).ok).toBe(true);
  const parsed = parseM0StringComplete(String(doc.m0), W, H);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.ir.renderFrames.length).toBe(doc.sources.length);
  expect(doc.size).toEqual({ width: W, height: H });
};

describe(`${ID} — template shell`, () => {
  it("metadata: id, core tier, video hints at 1280×800", () => {
    expect(String(AgentCommitFeedV1.id)).toBe(ID);
    expect(AgentCommitFeedV1.capabilities).toEqual({ tier: "core" });
    expect(AgentCommitFeedV1.outputHints?.format).toEqual({ kind: "video", container: "mp4" });
    expect([AgentCommitFeedV1.outputHints?.width, AgentCommitFeedV1.outputHints?.height]).toEqual([1280, 800]);
    expect(SAMPLE_COMMITS.length).toBe(7);
  });

  it("defaults: a valid card with the share band and the nested feed; 4 of 7 sample commits are agent-authored", async () => {
    const doc = await render({});
    expectValid(doc, 1280, 800);
    expect(textOf(doc, "share-value")).toBe("57%");
    expect(textOf(doc, "share-label")).toBe("agent-authored");
    expect(textOf(doc, "legend-agent-text")).toBe("4 by Claude Code, Copilot, Cursor");
    expect(textOf(doc, "legend-human-text")).toBe("3 by humans");
    for (const l of ["card-header", "share-tile", "bar-agent", "bar-human", "legend-agent-dot", "legend-human-dot", "feed"]) expect(labelsOf(doc)).toContain(l);
    const feed = doc.children!.feed as MosaicDocument;
    expect(feed.kind).toBe("mosaic_document");
    expect(feed.sources.length).toBeGreaterThan(7);
    expect(isErrorMosaic(feed)).toBe(false);
    expect(doc.editor?.label).toContain("57% agent-authored");
  });

  it("share math: all agents → 100%, no agents → 0%, a single human reads as one", async () => {
    const agents: AgentCommit[] = SAMPLE_COMMITS.map((c) => ({ ...c, agent: "Claude Code" }));
    expect(textOf(await render({ commits: agents }), "share-value")).toBe("100%");
    const humans: AgentCommit[] = SAMPLE_COMMITS.map(({ agent: _a, ...c }) => c);
    const h = await render({ commits: humans });
    expect(textOf(h, "share-value")).toBe("0%");
    expect(textOf(h, "legend-agent-text")).toBe("0 by agents");
    const one = await render({ commits: [SAMPLE_COMMITS[0], SAMPLE_COMMITS[1]] });
    expect(textOf(one, "legend-human-text")).toBe("1 by a human");
  });

  it("caps at 7 rows and counts the share over the drawn rows", async () => {
    const many: AgentCommit[] = [...SAMPLE_COMMITS, ...SAMPLE_COMMITS.map((c) => ({ ...c, agent: "Copilot" }))];
    const doc = await render({ commits: many });
    expect(textOf(doc, "share-value")).toBe("57%");
  });

  it("determinism: double render is JSON-identical", async () => {
    const a = await render({});
    const b = await render({});
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("empty commits fail fast with an error card", async () => {
    expect(isErrorMosaic(await render({ commits: [] }))).toBe(true);
  });

  it("reduceMotion and the animated path both render; dark preset too", async () => {
    expectValid(await render({ anim: { reduceMotion: true } }), 1280, 800);
    expectValid(await render({ preset: "dark" }), 1280, 800);
  });
});

describe(`${ID} — layout contract (canvas sweep)`, () => {
  const CANVASES: ReadonlyArray<readonly [number, number]> = [[1280, 800], [1920, 1080], [1280, 720], [1080, 1080], [1600, 900]];
  it.each(CANVASES)("defaults hold at %d×%d", async (w, h) => {
    const ctx = ctxFor(w, h);
    const doc = await render({}, ctx);
    expectValid(doc, w, h);
    const stamp = (await render({ debugLayout: true }, ctx)).editor as { layoutContract?: { ok: boolean; violations: unknown[] } } | undefined;
    expect(stamp?.layoutContract?.ok).toBe(true);
    expect(() =>
      assertLayout(doc, ctx, ID, {
        constraints: [
          { label: "share-value", textFits: {} },
          { label: "legend-agent-text", textFits: {} },
          { label: "feed", minHeightFrac: 0.4 },
        ],
        flatten: false,
      }),
    ).not.toThrow();
  });
});

describe(`${ID} — ships in the web build`, () => {
  it("imports no node builtins", () => {
    for (const f of ["commit-feed.ts", "index.ts"]) {
      const src = fs.readFileSync(path.join(__dirname, f), "utf8");
      expect(src).not.toMatch(/from\s+["'](node:|fs["']|path["']|child_process|os["'])/);
      expect(src).not.toMatch(/__dirname/);
    }
  });
});
