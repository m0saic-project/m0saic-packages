import type { MosaicDocument } from "@m0saic/types";
import { ctxFor, entriesOn, handlesOf, keysOn, renderStatusOf, sourcesOf, vnextSuite } from "../../../../__tests__/vnextSuite";
import "../../../index"; // registers the alpine commit feed this card nests
import { AgentCommitFeedV1 } from "../v1/commit-feed";
import { AgentCommitFeedV2 } from "./commit-feed";

const D = AgentCommitFeedV2.defaultProps as Record<string, unknown>;
const render = async (props: Record<string, unknown>, w?: number, h?: number) =>
  (await AgentCommitFeedV2.render({ ...D, ...props } as never, ctxFor(AgentCommitFeedV2, { w, h }))) as MosaicDocument;

vnextSuite({
  next: AgentCommitFeedV2,
  prev: AgentCommitFeedV1,
  cases: [
    { name: "dark, no header, static", props: { preset: "dark", title: "", subtitle: "", anim: { renderMode: "premium", introFrac: 0.7, reduceMotion: true } } },
    { name: "all human, custom colours, light mode", props: { commits: [{ title: "fix: a", author: "Ada", area: "core" }, { title: "docs: b", author: "Sam", pr: 7, date: "May 2" }], agentColor: "#22cc88", humanColor: "#aa33ff", anim: { renderMode: "light", introFrac: 0.5, reduceMotion: false } } },
    { name: "portrait", w: 900, h: 900 },
  ],
  bound: ["agentColor", "commits", "humanColor", "preset", "subtitle", "title"],
  unbound: { "anim.introFrac": "timing", theme: "theme source" },
});

describe("@m0saic/agents/commit-feed/v2 — handles", () => {
  it("v1 bound no commit at all (the nested feed named ITS prop); v2 binds every field a row shows", async () => {
    const ctx = ctxFor(AgentCommitFeedV2);
    const v1 = handlesOf(await AgentCommitFeedV1.render({ ...AgentCommitFeedV1.defaultProps } as never, ctx), AgentCommitFeedV1, ctx);
    expect(v1.keys).not.toContain("commits");
    const doc = await render({ anim: { reduceMotion: true } });
    const leaves = sourcesOf(doc)
      .flatMap((x) => (x.editor?.bindings ?? (x.editor?.binding ? [x.editor.binding] : [])) as Array<{ propKey: string; path?: Array<string | number> }>)
      .filter((b) => b.propKey === "commits")
      .map((b) => `${b.path![0]}.${b.path![1]}`);
    // SAMPLE row 0 is an agent commit (chip shows the agent), row 1 a human one (chip shows the area).
    expect(leaves).toEqual(expect.arrayContaining(["0.title", "0.author", "0.agent", "0.date", "1.title", "1.area"]));
    expect(leaves).not.toContain("1.agent");
    expect(sourcesOf(doc).some((x) => ((x.editor?.bindings ?? []) as Array<{ propKey: string }>).some((b) => b.propKey === "rows"))).toBe(false);
    expect(handlesOf(doc, AgentCommitFeedV2, ctx).rejected).toEqual([]);
  });

  it("filtered rows keep their ORIGINAL index", async () => {
    const doc = await render({ commits: [{ title: "", author: "skipped" }, { title: "kept", author: "Ada" }], anim: { reduceMotion: true } });
    expect(entriesOn(doc, "row-title")).toEqual([{ propKey: "commits", path: [1, "title"], kind: "string" }]);
  });

  it("the share bar and the legend dots carry the colour that paints them", async () => {
    const doc = await render({});
    expect(keysOn(doc, "bar-agent")).toEqual(["agentColor"]);
    expect(keysOn(doc, "legend-human-dot")).toEqual(["humanColor"]);
  });

  it("no header: title + subtitle ride the share value", async () => {
    expect(keysOn(await render({ title: "", subtitle: "" }), "share-value")).toEqual(["title", "subtitle"]);
  });

  it("no commits is an input the card waits on, never an error", async () => {
    expect(renderStatusOf(await render({ commits: [] }))).toBe("incomplete");
  });
});
