import * as fs from "node:fs";
import * as path from "node:path";
import { PAGE_SKELETON_CAPTURE_SNIPPET } from "./capture-snippet-source";

type AnonymousRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  k: "block" | "text" | "image" | "control" | "divider";
  r: number;
  d: number;
  _id?: number;
  _ancestorId?: number | null;
};

type CaptureOutput = {
  format: "m0saic-page-skeleton";
  version: 1;
  viewport: { w: number; h: number; dpr?: number };
  rects: AnonymousRect[];
  meta: { total: number; dropped: number };
};

type CaptureApi = {
  parseRadius(value: string | string[], width: number, height: number): number;
  classify(subject: {
    tagName: string;
    w: number;
    h: number;
    painted: boolean;
  }): AnonymousRect["k"];
  isPainted(style: Record<string, unknown>): boolean;
  dedupSameRect(rects: AnonymousRect[]): AnonymousRect[];
  capAndSort(
    rects: AnonymousRect[],
    maxRects?: number,
  ): { rects: AnonymousRect[]; dropped: number };
  buildOutput(
    viewport: { w: number; h: number; dpr?: number },
    rects: AnonymousRect[],
    maxRects?: number,
  ): CaptureOutput;
  collect(
    documentObject: FakeDocument,
    windowObject: FakeWindow,
    options?: { maxRects?: number },
  ): CaptureOutput;
};

// CommonJS is intentional: the production snippet stays directly pasteable in
// DevTools and exports the same pure helper API only when loaded under Node.
const api = require("./capture-snippet.js") as CaptureApi;

type FakeText = {
  nodeType: 3;
  nodeValue: string;
  lineRects: FakeRect[];
};

type FakeComment = {
  nodeType: 8;
  nodeName: "#comment";
  nodeValue: string;
};

type FakeElement = {
  nodeType: 1;
  tagName: string;
  style: Record<string, unknown>;
  childNodes: Array<FakeElement | FakeText | FakeComment>;
  getBoundingClientRect(): FakeRect;
};

type FakeRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type FakeDocument = {
  body: FakeElement;
  createRange(): {
    selectNodeContents(node: FakeText): void;
    getClientRects(): FakeRect[];
    detach(): void;
  };
};

type FakeWindow = {
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
  getComputedStyle(element: FakeElement): Record<string, unknown>;
};

const rect = (left: number, top: number, right: number, bottom: number): FakeRect => ({
  left,
  top,
  right,
  bottom,
});

const element = (
  tagName: string,
  bounds: FakeRect,
  style: Record<string, unknown> = {},
  childNodes: Array<FakeElement | FakeText | FakeComment> = [],
): FakeElement => ({
  nodeType: 1,
  tagName,
  style: {
    display: "block",
    visibility: "visible",
    opacity: "1",
    backgroundColor: "rgba(0, 0, 0, 0)",
    backgroundImage: "none",
    boxShadow: "none",
    ...style,
  },
  childNodes,
  getBoundingClientRect: () => bounds,
});

const text = (nodeValue: string, lineRects: FakeRect[]): FakeText => ({
  nodeType: 3,
  nodeValue,
  lineRects,
});

const comment = (nodeValue: string): FakeComment => ({
  nodeType: 8,
  nodeName: "#comment",
  nodeValue,
});

function fakeDom(body: FakeElement): { documentObject: FakeDocument; windowObject: FakeWindow } {
  let selected: FakeText | undefined;
  return {
    documentObject: {
      body,
      createRange: () => ({
        selectNodeContents: (node) => {
          selected = node;
        },
        getClientRects: () => selected?.lineRects ?? [],
        detach: () => {
          selected = undefined;
        },
      }),
    },
    windowObject: {
      innerWidth: 100,
      innerHeight: 80,
      devicePixelRatio: 2,
      getComputedStyle: (node) => node.style,
    },
  };
}

const anonymousRect = (
  x: number,
  y: number,
  w: number,
  h: number,
  d = 0,
): AnonymousRect => ({ x, y, w, h, k: "block", r: 0, d });

describe("capture snippet pure helpers", () => {
  it("keeps the template handoff payload byte-for-byte aligned with the pasteable source", () => {
    const source = fs
      .readFileSync(path.join(__dirname, "capture-snippet.js"), "utf8")
      .trimEnd();
    expect(PAGE_SKELETON_CAPTURE_SNIPPET).toBe(source);
  });

  it("parses px and percent radii, takes the largest corner, and clamps to a pill", () => {
    expect(api.parseRadius("7.6px", 100, 40)).toBe(8);
    expect(api.parseRadius("50%", 32, 20)).toBe(10);
    expect(api.parseRadius(["2px", "30%", "7px", "bad"], 100, 40)).toBe(12);
    expect(api.parseRadius("999px", 12, 8)).toBe(4);
    expect(api.parseRadius("1rem", 100, 40)).toBe(0);
  });

  it("classifies the closed rect-kind set", () => {
    expect(api.classify({ tagName: "img", w: 80, h: 60, painted: false })).toBe(
      "image",
    );
    expect(api.classify({ tagName: "button", w: 80, h: 30, painted: true })).toBe(
      "control",
    );
    expect(api.classify({ tagName: "hr", w: 80, h: 1, painted: false })).toBe(
      "divider",
    );
    expect(api.classify({ tagName: "div", w: 80, h: 2, painted: true })).toBe(
      "divider",
    );
    expect(api.classify({ tagName: "section", w: 80, h: 30, painted: true })).toBe(
      "block",
    );
  });

  it("detects each meaningful paint path without treating transparency as paint", () => {
    expect(api.isPainted({ backgroundColor: "rgba(1, 2, 3, 0)" })).toBe(false);
    expect(api.isPainted({ backgroundColor: "rgb(1 2 3 / 0.5)" })).toBe(true);
    expect(api.isPainted({ backgroundImage: "linear-gradient(red, blue)" })).toBe(true);
    expect(api.isPainted({ boxShadow: "0 1px 2px rgb(0 0 0 / 0.2)" })).toBe(true);
    expect(
      api.isPainted({ borderTopWidth: "1px", borderTopColor: "rgb(0, 0, 0)" }),
    ).toBe(true);
  });

  it("lets a same-rect descendant win and inherit its emitted ancestor radius", () => {
    const deduped = api.dedupSameRect([
      { ...anonymousRect(10, 10, 80, 30), r: 12, _id: 1, _ancestorId: null },
      {
        ...anonymousRect(11, 11, 78, 28, 1),
        k: "control",
        _id: 2,
        _ancestorId: 1,
      },
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toMatchObject({ k: "control", r: 12, _id: 2 });
  });

  it("caps in deterministic depth, area, y, x order", () => {
    const input = [
      anonymousRect(10, 0, 10, 10, 1),
      anonymousRect(20, 5, 20, 20, 0),
      anonymousRect(0, 5, 20, 20, 0),
      anonymousRect(5, 0, 50, 20, 0),
    ];
    const first = api.capAndSort(input, 3);
    const second = api.capAndSort(input, 3);

    expect(first).toEqual(second);
    expect(first.dropped).toBe(1);
    expect(first.rects.map((entry) => [entry.x, entry.y])).toEqual([
      [5, 0],
      [0, 5],
      [20, 5],
    ]);
  });

  it("emits schema v1 only, stripping collector bookkeeping", () => {
    const output = api.buildOutput(
      { w: 100, h: 80, dpr: 2 },
      [{ ...anonymousRect(0, 0, 20, 20), _id: 7, _ancestorId: null }],
    );
    expect(output).toEqual({
      format: "m0saic-page-skeleton",
      version: 1,
      viewport: { w: 100, h: 80, dpr: 2 },
      rects: [{ x: 0, y: 0, w: 20, h: 20, k: "block", r: 0, d: 0 }],
      meta: { total: 1, dropped: 0 },
    });
  });
});

describe("capture snippet DOM collector", () => {
  it("collects anonymous clipped geometry, line boxes, and visible descendants only", () => {
    const sameRectButton = element("BUTTON", rect(10, 10, 90, 40));
    const body = element("BODY", rect(0, 0, 100, 80), {}, [
      comment("framework marker"),
      element(
        "DIV",
        rect(10, 10, 90, 40),
        { backgroundColor: "rgb(30, 30, 30)", borderTopLeftRadius: "12px" },
        [sameRectButton],
      ),
      element("IMG", rect(90, 8, 115, 28)),
      element(
        "DIV",
        rect(0, 0, 50, 50),
        { visibility: "hidden", backgroundColor: "rgb(1, 1, 1)" },
        [
          element("SPAN", rect(4, 45, 44, 65), {
            visibility: "visible",
            backgroundColor: "rgb(2, 2, 2)",
          }),
        ],
      ),
      element(
        "DIV",
        rect(0, 0, 100, 80),
        { opacity: "0.01", backgroundColor: "rgb(3, 3, 3)" },
        [
          element("IMG", rect(0, 0, 40, 40), {
            opacity: "1",
          }),
        ],
      ),
      element("SCRIPT", rect(0, 0, 100, 80), { backgroundColor: "rgb(4, 4, 4)" }),
      element("P", rect(10, 50, 90, 75), {}, [
        text("this private text must never leave the page", [
          rect(10.2, 51.2, 82.7, 60.6),
          rect(10.2, 63.2, 55.8, 72.6),
        ]),
      ]),
      element("HR", rect(10, 76, 90, 77)),
    ]);
    const { documentObject, windowObject } = fakeDom(body);

    const output = api.collect(documentObject, windowObject);

    expect(output.rects).toHaveLength(6);
    expect(output.rects.find((entry) => entry.k === "control")).toMatchObject({
      x: 10,
      y: 10,
      w: 80,
      h: 30,
      r: 12,
    });
    expect(output.rects.find((entry) => entry.k === "image")).toMatchObject({
      x: 90,
      y: 8,
      w: 10,
      h: 20,
    });
    expect(output.rects.filter((entry) => entry.k === "text")).toHaveLength(2);
    expect(output.rects.some((entry) => entry.k === "divider")).toBe(true);
    expect(JSON.stringify(output)).not.toContain("private text");
    expect(output.viewport).toEqual({ w: 100, h: 80, dpr: 2 });
  });

  it("caps text line boxes at twelve per text node", () => {
    const lines = Array.from({ length: 15 }, (_, i) => rect(1, i * 2, 50, i * 2 + 1));
    const body = element("BODY", rect(0, 0, 100, 80), {}, [
      element("P", rect(0, 0, 100, 40), {}, [text("anonymous", lines)]),
    ]);
    const { documentObject, windowObject } = fakeDom(body);

    expect(
      api.collect(documentObject, windowObject).rects.filter((entry) => entry.k === "text"),
    ).toHaveLength(12);
  });
});
