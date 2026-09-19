import {
  buildTemplateShareQuery,
  hasTemplateShareParams,
  parseTemplateShareQuery,
  sanitizePropsBag,
  sanitizeShareFrom,
  sanitizeShareNote,
  SHARE_NOTE_MAX,
  type TemplateShareParams,
} from "./shareQuery";
import { encodeSharePayload } from "./payloadCodec";

const T = "@m0saic/alpine/contributor-table/v1";

async function validSearch(props: Record<string, unknown> = { title: "Hello" }): Promise<URLSearchParams> {
  const sp = new URLSearchParams();
  sp.set("t", T);
  sp.set("p", await encodeSharePayload(props));
  sp.set("w", "1920");
  sp.set("h", "1080");
  return sp;
}

describe("parseTemplateShareQuery", () => {
  it("parses a minimal valid query", async () => {
    const result = await parseTemplateShareQuery(await validSearch({ title: "Hello" }));
    expect(result).toEqual({ ok: true, params: { templateId: T, props: { title: "Hello" }, w: 1920, h: 1080 } });
  });

  it("t is the ONE required param; p and the canvas are optional (2026-09-13)", async () => {
    const noT = await validSearch();
    noT.delete("t");
    expect(await parseTemplateShareQuery(noT)).toEqual({ ok: false, error: "Missing param: t" });

    const noP = await validSearch();
    noP.delete("p");
    expect(await parseTemplateShareQuery(noP)).toEqual({ ok: true, params: { templateId: T, props: {}, w: 1920, h: 1080 } });

    const bare = new URLSearchParams();
    bare.set("t", T);
    expect(await parseTemplateShareQuery(bare)).toEqual({ ok: true, params: { templateId: T, props: {} } });

    const onlyW = await validSearch();
    onlyW.delete("h");
    expect(await parseTemplateShareQuery(onlyW)).toEqual({ ok: false, error: "Width and height go together" });
  });

  it("an empty query is missing t (the one required param)", async () => {
    const result = await parseTemplateShareQuery(new URLSearchParams(""));
    expect(result).toEqual({ ok: false, error: "Missing param: t" });
  });

  it.each(["", "not an id", "javascript:alert(1)", "@m0saic/x/../y", "a".repeat(301)])(
    "rejects a bad template id: %j",
    async (bad) => {
      const sp = await validSearch();
      sp.set("t", bad);
      const result = await parseTemplateShareQuery(sp);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/template id/i);
    },
  );

  it.each([
    ["w", "0", /width/i],
    ["h", "-1", /height/i],
    ["w", "19.5", /width/i],
    ["w", "abc", /width/i],
    ["h", "99999", /height/i],
  ])("rejects a bad %s=%s", async (key, value, re) => {
    const sp = await validSearch();
    sp.set(key, value);
    const result = await parseTemplateShareQuery(sp);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(re);
  });

  it("rejects an unknown payload version and corrupt payloads", async () => {
    for (const p of ["j{}", "", "zzz", "z!!!!"]) {
      const sp = await validSearch();
      sp.set("p", p);
      const result = await parseTemplateShareQuery(sp);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/payload/i);
    }
  });

  it.each([[[]], ["str"], [null], [42]])("rejects a payload that is not a props object: %j", async (bad) => {
    const sp = await validSearch();
    sp.set("p", await encodeSharePayload(bad));
    const result = await parseTemplateShareQuery(sp);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/props object/);
  });

  it("drops prototype keys and the input-source convention keys", async () => {
    const sp = await validSearch(
      JSON.parse('{"__proto__":{"polluted":1},"constructor":{"x":1},"sourceIds":["/Users/me/a.mp4"],"sourceId":"/x","title":"ok"}'),
    );
    const result = await parseTemplateShareQuery(sp);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.params.props).toEqual({ title: "ok" });
      expect(Object.keys(result.params.props)).toEqual(["title"]);
    }
  });

  it.each([
    ["fps", "0", /fps/],
    ["fps", "241", /fps/],
    ["fps", "1.5", /fps/],
    ["d", "0", /duration/],
    ["d", "x", /duration/],
    ["f", "gif", /format/],
    ["a", "2", /alpha/],
  ])("rejects a bad optional %s=%s", async (key, value, re) => {
    const sp = await validSearch();
    sp.set(key, value);
    const result = await parseTemplateShareQuery(sp);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(re);
  });

  it("reads the optional asks", async () => {
    const sp = await validSearch();
    sp.set("fps", "60");
    sp.set("d", "3500");
    sp.set("f", "image");
    sp.set("a", "1");
    const result = await parseTemplateShareQuery(sp);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.params.asks).toEqual({ fps: 60, durationMs: 3500, outputKind: "image", alpha: true });
    }
  });

  it("ignores a foreign param such as a version pin — the id is the version", async () => {
    const sp = await validSearch();
    sp.set("tv", "3");
    const result = await parseTemplateShareQuery(sp);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.params)).toEqual(["templateId", "props", "w", "h"]);
  });

  it("omits `asks` entirely when no ask is present", async () => {
    const result = await parseTemplateShareQuery(await validSearch());
    expect(result.ok).toBe(true);
    if (result.ok) expect("asks" in result.params).toBe(false);
  });

  it("sanitizes note (control chars, whitespace, length) and from (scheme, size)", async () => {
    const sp = await validSearch();
    sp.set("note", "  get  it\n\nfrom   my repo " + "x".repeat(400));
    sp.set("from", "https://github.com/someone/templates");
    const result = await parseTemplateShareQuery(sp);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.params.note!.length).toBe(SHARE_NOTE_MAX);
      expect(result.params.note!.startsWith("get it from my repo x")).toBe(true);
      expect(result.params.from).toBe("https://github.com/someone/templates");
    }
  });

  it.each(["javascript:alert(1)", "ftp://x.y/z", "/relative", "github.com/x", "https://" + "a".repeat(600)])(
    "drops an unsafe or oversize from=%j without failing the link",
    async (bad) => {
      const sp = await validSearch();
      sp.set("from", bad);
      const result = await parseTemplateShareQuery(sp);
      expect(result.ok).toBe(true);
      if (result.ok) expect("from" in result.params).toBe(false);
    },
  );
});

describe("buildTemplateShareQuery", () => {
  it("pins the param order", async () => {
    const qs = await buildTemplateShareQuery({ templateId: T, props: { a: 1 }, w: 1920, h: 1080 });
    expect(Array.from(qs.keys())).toEqual(["t", "p", "w", "h"]);
    expect(qs.get("p")!.startsWith("z")).toBe(true);
  });

  it("a template at its defaults on its own canvas is just ?t=<id> (2026-09-13)", async () => {
    const qs = await buildTemplateShareQuery({ templateId: T, props: {} });
    expect(Array.from(qs.keys())).toEqual(["t"]);
    const both = await buildTemplateShareQuery({ templateId: T, props: {}, w: 1920, h: 1080 });
    expect(Array.from(both.keys())).toEqual(["t", "w", "h"]);
    await expect(buildTemplateShareQuery({ templateId: T, props: {}, w: 1920 })).rejects.toThrow(/go together/);
  });

  it("appends the asks and the handshake in a fixed order", async () => {
    const qs = await buildTemplateShareQuery({
      templateId: T,
      props: { a: 1 },
      w: 1280,
      h: 720,
      asks: { fps: 24, durationMs: 5000, outputKind: "video", alpha: false },
      note: "From my repo",
      from: "https://example.com/repo",
    });
    expect(Array.from(qs.keys())).toEqual(["t", "p", "w", "h", "fps", "d", "f", "a", "note", "from"]);
    expect(qs.get("fps")).toBe("24");
    expect(qs.get("d")).toBe("5000");
    expect(qs.get("f")).toBe("video");
    expect(qs.get("a")).toBe("0");
    expect(qs.get("note")).toBe("From my repo");
    expect(qs.get("from")).toBe("https://example.com/repo");
  });

  it("omits an unsafe from and an empty note", async () => {
    const qs = await buildTemplateShareQuery({ templateId: T, props: { a: 1 }, w: 1, h: 1, note: "   ", from: "javascript:alert(1)" });
    expect(Array.from(qs.keys())).toEqual(["t", "p", "w", "h"]);
  });

  it("never carries sourceIds even if a caller passes them", async () => {
    const qs = await buildTemplateShareQuery({ templateId: T, props: { sourceIds: ["/x"], title: "t" }, w: 1, h: 1 });
    const parsed = await parseTemplateShareQuery(qs);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.params.props).toEqual({ title: "t" });
  });

  it("build → parse round-trips the whole param set", async () => {
    const params: TemplateShareParams = {
      templateId: T,
      props: { title: "Round trip ✓", rows: [{ n: 1 }, { n: 2 }], nested: { deep: { ok: true } } },
      w: 1080,
      h: 1920,
      asks: { fps: 30, alpha: true },
      note: "note",
      from: "https://x.y/z",
    };
    const qs = await buildTemplateShareQuery(params);
    // Through a string, as a real URL would carry it.
    const parsed = await parseTemplateShareQuery(new URLSearchParams(qs.toString()));
    expect(parsed).toEqual({ ok: true, params });
  });
});

describe("hasTemplateShareParams", () => {
  it("needs only t (2026-09-13: p and the canvas are optional)", () => {
    expect(hasTemplateShareParams(new URLSearchParams("?t=x&p=zA&w=1&h=1"))).toBe(true);
    expect(hasTemplateShareParams(new URLSearchParams("?t=x&w=1&h=1"))).toBe(true);
    expect(hasTemplateShareParams(new URLSearchParams("?t=x"))).toBe(true);
    expect(hasTemplateShareParams(new URLSearchParams("?p=zA&w=1&h=1"))).toBe(false);
    expect(hasTemplateShareParams(new URLSearchParams(""))).toBe(false);
  });
});

describe("sanitizers", () => {
  it("sanitizePropsBag", () => {
    expect(sanitizePropsBag(null)).toBeNull();
    expect(sanitizePropsBag([1])).toBeNull();
    expect(sanitizePropsBag("x")).toBeNull();
    expect(sanitizePropsBag({ a: 1, sourceId: "x", prototype: 1 })).toEqual({ a: 1 });
  });
  it("sanitizeShareNote", () => {
    expect(sanitizeShareNote(undefined)).toBeUndefined();
    expect(sanitizeShareNote("")).toBeUndefined();
    expect(sanitizeShareNote(" a  b ")).toBe("a b");
    expect(sanitizeShareNote("tab\there")).toBe("tab here");
  });
  it("sanitizeShareFrom", () => {
    expect(sanitizeShareFrom("http://a.b")).toBe("http://a.b");
    expect(sanitizeShareFrom(" https://a.b/c ")).toBe("https://a.b/c");
    expect(sanitizeShareFrom("mailto:x@y")).toBeUndefined();
    expect(sanitizeShareFrom("")).toBeUndefined();
  });
});
