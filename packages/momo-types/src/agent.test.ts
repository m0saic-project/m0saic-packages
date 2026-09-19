import { normalizeM0AgentMeta } from "./agent";

describe("normalizeM0AgentMeta", () => {
  it("keeps multi-line markdown in note / question / response", () => {
    const note = "first line\n\n- a\n- b";
    const question = "## Q\n\nis this aligned?";
    const out = normalizeM0AgentMeta({
      note,
      question,
      response: { body: "yes\n\n- looks good" },
    });
    expect(out?.note).toBe(note);
    expect(out?.question).toBe(question);
    expect(out?.response?.body).toBe("yes\n\n- looks good");
  });

  it("narrows a raw JSON context into the typed refinement", () => {
    const out = normalizeM0AgentMeta({
      note: "n",
      context: { category: "chart", unknownField: 1 },
    });
    expect(out?.context).toEqual({ category: "chart", extras: { unknownField: 1 } });
  });

  it("collapses an all-empty block to null", () => {
    expect(normalizeM0AgentMeta({ note: "  ", regions: {} })).toBeNull();
  });
});
