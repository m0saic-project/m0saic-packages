import { getTemplate } from "@m0saic/template-utils";
import {
  SNIPPET_MORPH_V1_ID,
  SnippetMorphV1,
} from "./index";

describe("code template barrel", () => {
  it("exports and registers snippet-morph v1", () => {
    expect(SnippetMorphV1.id).toBe(SNIPPET_MORPH_V1_ID);
    expect(getTemplate(SNIPPET_MORPH_V1_ID)).toMatchObject({
      id: SNIPPET_MORPH_V1_ID,
      label: SnippetMorphV1.label,
      version: SnippetMorphV1.version,
    });
  });
});
