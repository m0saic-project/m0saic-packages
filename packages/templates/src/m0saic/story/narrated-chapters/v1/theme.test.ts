import { storyTheme, themeFromStory } from "./theme";

describe("storyTheme", () => {
  it("resolves the dark preset by default", () => {
    expect(storyTheme()).toBe(storyTheme("dark"));
    expect(storyTheme().canvas).toBe("#0d0f12");
  });
});

describe("themeFromStory", () => {
  it("adopts valid brand colors", () => {
    const theme = themeFromStory({
      brand: { accentColor: "#ff8800", backgroundColor: "#101014", textColor: "#ffffff" },
    });
    expect(theme.accent).toBe("#ff8800");
    expect(theme.canvas).toBe("#101014");
    expect(theme.ink).toBe("#ffffff");
  });

  it("falls back per-field on invalid or absent colors", () => {
    const theme = themeFromStory({ brand: { accentColor: "not a color" } });
    expect(theme.accent).toBe(storyTheme().accent);
    expect(theme.canvas).toBe(storyTheme().canvas);
    expect(themeFromStory({})).toEqual(storyTheme());
  });
});
