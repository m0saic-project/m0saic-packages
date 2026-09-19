import {
  CODE_THEME_PRESETS,
  CODE_THEME_PRESET_KEYS,
  CODE_TOKEN_KINDS,
  codeTheme,
  resolveCodeColor,
  resolveCodeSyntaxTheme,
  type CodeTheme,
} from "./code-theme";

const CHROME_KEYS: Array<Exclude<keyof CodeTheme, "syntax">> = [
  "canvas",
  "editor",
  "titleBar",
  "border",
  "title",
  "gutter",
  "lineNumber",
  "trafficClose",
  "trafficMinimize",
  "trafficMaximize",
];

describe("code theme", () => {
  it("defines every chrome and syntax token as strict hex in every preset", () => {
    for (const theme of Object.values(CODE_THEME_PRESETS)) {
      for (const key of CHROME_KEYS) {
        expect(theme[key]).toMatch(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i);
      }
      expect(Object.keys(theme.syntax).sort()).toEqual(
        [...CODE_TOKEN_KINDS].sort(),
      );
      for (const kind of CODE_TOKEN_KINDS) {
        expect(theme.syntax[kind]).toMatch(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i);
      }
    }
  });

  it("defaults to the canonical dark editor and resolves light by identity", () => {
    expect(codeTheme()).toBe(CODE_THEME_PRESETS.dark);
    expect(codeTheme("dark")).toBe(CODE_THEME_PRESETS.dark);
    expect(codeTheme("light")).toBe(CODE_THEME_PRESETS.light);
  });

  it("locks the stable preset keys and curated dark identities", () => {
    expect(CODE_THEME_PRESET_KEYS).toEqual([
      "dark",
      "light",
      "merge-conflict",
      "rubber-duck",
    ]);
    expect(codeTheme("merge-conflict")).toBe(
      CODE_THEME_PRESETS["merge-conflict"],
    );
    expect(codeTheme("rubber-duck")).toBe(CODE_THEME_PRESETS["rubber-duck"]);
    expect(CODE_THEME_PRESETS["merge-conflict"].canvas).not.toBe(
      CODE_THEME_PRESETS.dark.canvas,
    );
    expect(CODE_THEME_PRESETS["rubber-duck"].syntax.keyword).not.toBe(
      CODE_THEME_PRESETS.dark.syntax.keyword,
    );
  });

  it("uses explicit token overrides and falls back for cleared pickers", () => {
    const resolved = resolveCodeSyntaxTheme(CODE_THEME_PRESETS.dark, {
      keyword: "#123456",
      string: "none",
      comment: "  ",
      number: "#abcdef80",
    });
    expect(resolved.keyword).toBe("#123456");
    expect(resolved.string).toBe(CODE_THEME_PRESETS.dark.syntax.string);
    expect(resolved.comment).toBe(CODE_THEME_PRESETS.dark.syntax.comment);
    expect(resolved.number).toBe("#ABCDEF80");
    expect(resolved.fnCall).toBe(CODE_THEME_PRESETS.dark.syntax.fnCall);
  });

  it("rejects colors the SVG rasterizer cannot represent", () => {
    expect(() => resolveCodeColor("red", "#000000")).toThrow(/#RRGGBB/);
    expect(() =>
      resolveCodeSyntaxTheme(CODE_THEME_PRESETS.dark, { plain: "#123" }),
    ).toThrow(/#RRGGBB/);
  });
});
