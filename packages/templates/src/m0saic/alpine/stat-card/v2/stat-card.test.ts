import { keysOn, vnextSuite, ctxFor } from "../../../../__tests__/vnextSuite";
import { AlpineStatCard } from "../v1/stat-card";
import { AlpineStatCardV2 } from "./stat-card";

vnextSuite({
  next: AlpineStatCardV2,
  prev: AlpineStatCard,
  catalog: { primitive: true },
  cases: [
    { name: "dark, down, no icon", props: { preset: "dark", direction: "down", delta: "-3.1%", icon: undefined, accent: "#22cc88" } },
    { name: "no delta, no sublabel, static", props: { delta: "", sublabel: "", anim: { reduceMotion: true } } },
    { name: "light mode, portrait", props: { renderMode: "light" }, w: 720, h: 1280 },
    { name: "transparent card", props: { backgroundColor: "black@0" } },
  ],
  bound: ["accent", "backgroundColor", "delta", "label", "preset", "sublabel", "value"],
  unbound: {
    "theme.slug": "theme source",
    "theme.preset": "theme source",
    "theme.namespace": "theme source",
    "anim.introFrac": "timing",
    iconPath: "agent value",
  },
});

describe("@m0saic/alpine/stat-card/v2 — handles", () => {
  it("the delta and sublabel rects stay bound when empty (handles to add one)", async () => {
    const doc = await AlpineStatCardV2.render({ ...AlpineStatCardV2.defaultProps, delta: "", sublabel: "" } as never, ctxFor(AlpineStatCardV2));
    expect(keysOn(doc, "stat-delta")).toEqual(["delta"]);
    expect(keysOn(doc, "stat-sublabel")).toEqual(["sublabel"]);
  });

  it("Make opens on the settled card", () => {
    expect(AlpineStatCardV2.outputHints?.posterTimeMs).toBe(2850);
  });
});
