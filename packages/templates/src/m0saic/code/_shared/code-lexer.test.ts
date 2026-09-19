import {
  lexTsJs,
  normalizeCodeSource,
  type LexedCodeState,
} from "./code-lexer";

function compact(state: LexedCodeState): string[][] {
  return state.lines.map((line) =>
    line.tokens.map(
      (token) => `${token.kind}@${token.col}:${JSON.stringify(token.text)}`,
    ),
  );
}

function expectLossless(state: LexedCodeState): void {
  for (const line of state.lines) {
    expect(line.tokens.map((token) => token.text).join("")).toBe(line.text);
    let col = 0;
    for (const token of line.tokens) {
      expect(token.col).toBe(col);
      col += Array.from(token.text).length;
    }
    expect(col).toBe(Array.from(line.text).length);
  }
  expect(state.lines.map((line) => line.text).join("\n")).toBe(state.code);
}

describe("lexTsJs goldens", () => {
  it("classifies TS keywords, identifiers, calls, numbers, operators and punctuation", () => {
    expect(compact(lexTsJs("const answer: number = twice(0x2a);")))
      .toMatchInlineSnapshot(`
[
  [
    "keyword@0:\"const\"",
    "plain@5:\" \"",
    "ident@6:\"answer\"",
    "punct@12:\":\"",
    "plain@13:\" \"",
    "keyword@14:\"number\"",
    "plain@20:\" \"",
    "operator@21:\"=\"",
    "plain@22:\" \"",
    "fnCall@23:\"twice\"",
    "punct@28:\"(\"",
    "number@29:\"0x2a\"",
    "punct@33:\");\"",
  ],
]
`);
  });

  it("carries block-comment state across lines and resumes code after close", () => {
    expect(compact(lexTsJs("const x = 1; /* open\nstill comment */ return x;")))
      .toMatchInlineSnapshot(`
[
  [
    "keyword@0:\"const\"",
    "plain@5:\" \"",
    "ident@6:\"x\"",
    "plain@7:\" \"",
    "operator@8:\"=\"",
    "plain@9:\" \"",
    "number@10:\"1\"",
    "punct@11:\";\"",
    "plain@12:\" \"",
    "comment@13:\"/* open\"",
  ],
  [
    "comment@0:\"still comment */\"",
    "plain@16:\" \"",
    "keyword@17:\"return\"",
    "plain@23:\" \"",
    "ident@24:\"x\"",
    "punct@25:\";\"",
  ],
]
`);
  });

  it("tracks multiline template interpolation, nested templates, and expression braces", () => {
    const source = [
      "const message = `hello ${",
      '  user.name ?? "friend"',
      "} / ${`${count}`}!`;",
    ].join("\n");
    expect(compact(lexTsJs(source))).toMatchInlineSnapshot(`
[
  [
    "keyword@0:\"const\"",
    "plain@5:\" \"",
    "ident@6:\"message\"",
    "plain@13:\" \"",
    "operator@14:\"=\"",
    "plain@15:\" \"",
    "string@16:\"\`hello \${\"",
  ],
  [
    "plain@0:\"  \"",
    "ident@2:\"user\"",
    "punct@6:\".\"",
    "ident@7:\"name\"",
    "plain@11:\" \"",
    "operator@12:\"??\"",
    "plain@14:\" \"",
    "string@15:\"\\\"friend\\\"\"",
  ],
  [
    "string@0:\"} / \${\`\${\"",
    "ident@9:\"count\"",
    "string@14:\"}\`}!\`\"",
    "punct@19:\";\"",
  ],
]
`);

    const objectExpression = lexTsJs("`value: ${{ nested: 1 }.nested}`");
    expectLossless(objectExpression);
    const compactObject = compact(objectExpression)[0]!;
    expect(compactObject).toContain('ident@12:"nested"');
    expect(compactObject).toContain('ident@24:"nested"');
    expect(compactObject[compactObject.length - 1]).toBe('string@30:"}`"');
  });
});

describe("lexTsJs normalization and invariants", () => {
  it("normalizes CRLF, expands each tab, and preserves a trailing empty line", () => {
    const state = lexTsJs("\tinterface Box {\r\n\tvalue: string;\r\n}\r\n", "ts", {
      tabWidth: 2,
    });
    expect(state.code).toBe("  interface Box {\n  value: string;\n}\n");
    expect(state.lines).toHaveLength(4);
    expect(state.lines[3]).toEqual({ text: "", tokens: [] });
  });

  it("distinguishes TypeScript-only keywords from JavaScript identifiers", () => {
    expect(lexTsJs("interface Box {}", "ts").lines[0].tokens[0].kind).toBe(
      "keyword",
    );
    expect(lexTsJs("interface Box {}", "js").lines[0].tokens[0].kind).toBe(
      "ident",
    );
  });

  it("keeps escaped quotes and comment markers inside strings", () => {
    const state = lexTsJs('const url = "https://x/\\\"ok"; // tail');
    const strings = state.lines[0].tokens.filter((token) => token.kind === "string");
    expect(strings).toHaveLength(1);
    expect(strings[0].text).toBe('"https://x/\\\"ok"');
    expect(state.lines[0].tokens[state.lines[0].tokens.length - 1]).toMatchObject({
      kind: "comment",
      text: "// tail",
    });
  });

  it("documents regex literals as a color-only gap while retaining every column", () => {
    const state = lexTsJs("const ok = /ab+c/i.test(value);");
    expectLossless(state);
    expect(state.lines[0].tokens.some((token) => token.kind === "operator")).toBe(
      true,
    );
  });

  it("is lossless across the representative syntax corpus", () => {
    for (const source of [
      "",
      "let n = 1_000.5e-2;",
      "function f(a: string) { return `${a}`; }",
      "/* a\n * b\n */ const done = true;",
      "if (x?.y ?? false) console.log('yes');",
    ]) {
      expectLossless(lexTsJs(source));
    }
  });

  it("is byte-identical across two complete runs", () => {
    const source = "/* start\nend */ const value = `x ${fn(42)}`;";
    expect(JSON.stringify(lexTsJs(source, "ts", { tabWidth: 4 }))).toBe(
      JSON.stringify(lexTsJs(source, "ts", { tabWidth: 4 })),
    );
  });

  it("rejects invalid tab widths and languages", () => {
    expect(() => normalizeCodeSource("x", 0)).toThrow(/tabWidth/);
    expect(() => lexTsJs("x", "tsx" as never)).toThrow(/language/);
  });
});
